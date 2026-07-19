import Compression
import Metal
import SceneKit
import UIKit

/// The final ambient-tour scale: the same cosmic-web field, resolved-galaxy census and CMB wall
/// as the web atlas. The box is the fadeable root so node.opacity reaches both the custom program
/// and its ordinary SceneKit children as one beat.
@MainActor
enum Universe {
    private static let fieldSize = 128
    private static let fieldBytes = fieldSize * fieldSize * fieldSize * 4
    private static let field = loadField()

    static func makeNode() -> SCNNode {
        let box = SCNBox(width: 120, height: 120, length: 120, chamferRadius: 0)
        let program = SCNProgram()
        program.vertexFunctionName = "universeVertex"
        program.fragmentFunctionName = "universeFragment"
        program.isOpaque = false
        // node.opacity → shader intensity; node is deliberately non-optional so a fade can
        // never silently fall back to full-strength marching.
        program.handleBinding(ofBufferNamed: "uniforms", frequency: .perNode) { stream, node, _, _ in
            var intensity = Float(node.opacity)
            stream.writeBytes(&intensity, count: MemoryLayout<Float>.size)
        }

        let material = box.firstMaterial!
        material.program = program
        material.cullMode = .front
        material.writesToDepthBuffer = false
        material.readsFromDepthBuffer = false
        material.blendMode = .alpha
        material.setValue(SCNMaterialProperty(contents: fieldTexture()), forKey: "fieldTexture")

        let node = SCNNode(geometry: box)
        node.name = "universe"
        node.opacity = 0
        node.isHidden = true
        node.addChildNode(galaxyPoints())
        node.addChildNode(cmbWall())
        return node
    }

    /// Exact port of createUniverseGalaxies: same uint32 generator, density² acceptance, census
    /// colours, anchor lift and 42,000-point target, sampled from the same RGBA bytes.
    private static func galaxyPoints() -> SCNNode {
        let field = fieldData()
        let target = 42_000
        var vertices = [SCNVector3](repeating: SCNVector3Zero, count: target)
        var colors = [SIMD3<Float>](repeating: .zero, count: target)
        var seed: UInt32 = 0x9e3779b9
        func rand() -> Double {
            seed &+= 0x6d2b79f5
            var t = (seed ^ (seed >> 15)) &* (1 | seed)
            t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
            return Double(t ^ (t >> 14)) / 4_294_967_296
        }

        let palette: [SIMD3<Float>] = [0xdfe8ff, 0x9db8ff, 0xffd9a8, 0xf4f4f0, 0xff9d8a].map(linearColor)
        var placed = 0
        field.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self)
            for _ in 0..<(target * 260) where placed < target {
                let x = rand() * Double(fieldSize), y = rand() * Double(fieldSize), z = rand() * Double(fieldSize)
                let offset = (Int(z) * fieldSize * fieldSize + Int(y) * fieldSize + Int(x)) * 4
                let density = Double(bytes[offset]) / 255
                // 1.0 vs the web's 1.7: a renderer concession like the marcher's step range. On a
                // TV every accepted point is a hard screen-space dot, and the full-density cloud
                // crowded out the dark voids the narration is busy promising.
                if rand() >= density * density { continue }
                vertices[placed] = SCNVector3(Float((x / Double(fieldSize) * 2 - 1) * 60),
                                               Float((y / Double(fieldSize) * 2 - 1) * 60),
                                               Float((z / Double(fieldSize) * 2 - 1) * 60))
                let roll = rand()
                let base = palette[roll < 0.48 ? 0 : roll < 0.72 ? 1 : roll < 0.9 ? 2 : roll < 0.97 ? 3 : 4]
                let brightness = Float((0.45 + rand() * 0.55) * (bytes[offset + 3] > 0 ? 1.3 : 1))
                colors[placed] = base * brightness
                placed += 1
            }
        }
        guard placed == target else { fatalError("cosmic-web field produced only \(placed)/\(target) resolved galaxies") }

        let colorData = colors.withUnsafeBytes { Data($0.prefix(placed * MemoryLayout<SIMD3<Float>>.stride)) }
        let colorSource = SCNGeometrySource(data: colorData, semantic: .color, vectorCount: placed,
                                            usesFloatComponents: true, componentsPerVector: 3,
                                            bytesPerComponent: MemoryLayout<Float>.size, dataOffset: 0,
                                            dataStride: MemoryLayout<SIMD3<Float>>.stride)
        let element = SCNGeometryElement(indices: (0..<Int32(placed)).map { $0 }, primitiveType: .point)
        // Pinpoints, like addStarfield: vertex colors through constant lighting and NOTHING else.
        // A flat white emission here ignores the per-galaxy census colors and, over 42k additive
        // points at half-res, melts the whole cloud into one blown-out blob (measured on the
        // simulator before this was pared back). Small radii + additive blend give deep-field
        // sparkle; the marched volume behind supplies the milk.
        element.pointSize = 2
        element.minimumPointScreenSpaceRadius = 0.5
        element.maximumPointScreenSpaceRadius = 1.5
        let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: vertices), colorSource], elements: [element])
        let material = geometry.firstMaterial!
        material.lightingModel = .constant
        material.blendMode = .add
        material.writesToDepthBuffer = false
        material.readsFromDepthBuffer = false

        let node = SCNNode(geometry: geometry)
        node.name = "universe-galaxies"
        node.renderingOrder = 2
        return node
    }

    private static func cmbWall() -> SCNNode {
        let sphere = SCNSphere(radius: 172)
        sphere.segmentCount = 128
        let material = sphere.firstMaterial!
        material.lightingModel = .constant
        material.diffuse.contents = image("cmb-wmap-2048", ext: "webp")
        material.cullMode = .front
        // Quieter than the web's .34: the HDR camera's exposure lifts it on TV, and the wall is
        // this beat's backdrop, never its wallpaper.
        material.transparency = 0.16
        material.blendMode = .alpha
        material.writesToDepthBuffer = false
        material.readsFromDepthBuffer = false
        let node = SCNNode(geometry: sphere)
        node.name = "universe-cmb"
        node.runAction(.repeatForever(.rotate(by: .pi * 2, around: SCNVector3(0, 1, 0), duration: 720)))
        return node
    }

    private static func fieldTexture() -> MTLTexture {
        let data = fieldData()
        guard let device = MTLCreateSystemDefaultDevice() else { fatalError("Metal unavailable while creating cosmic-web texture") }
        let descriptor = MTLTextureDescriptor()
        descriptor.textureType = .type3D
        descriptor.pixelFormat = .rgba8Unorm
        descriptor.width = fieldSize
        descriptor.height = fieldSize
        descriptor.depth = fieldSize
        descriptor.mipmapLevelCount = 1
        descriptor.storageMode = .shared
        descriptor.usage = .shaderRead
        guard let texture = device.makeTexture(descriptor: descriptor) else { fatalError("could not allocate 128³ cosmic-web texture") }
        data.withUnsafeBytes { raw in
            texture.replace(region: MTLRegionMake3D(0, 0, 0, fieldSize, fieldSize, fieldSize),
                            mipmapLevel: 0, slice: 0, withBytes: raw.baseAddress!,
                            bytesPerRow: fieldSize * 4, bytesPerImage: fieldSize * fieldSize * 4)
        }
        return texture
    }

    private static func fieldData() -> Data { field }

    private static func loadField() -> Data {
        guard let url = Bundle.main.url(forResource: "cosmic-web-128", withExtension: "rgba.gz", subdirectory: "Media")
                        ?? Bundle.main.url(forResource: "cosmic-web-128", withExtension: "rgba.gz") else {
            fatalError("cosmic-web-128.rgba.gz missing from the bundle")
        }
        do { return try gunzip(Data(contentsOf: url), expectedSize: fieldBytes) }
        catch { fatalError("cosmic-web-128.rgba.gz failed to decode: \(error)") }
    }

    /// Compression.framework decodes the raw DEFLATE member; this peels the gzip envelope and
    /// validates its advertised size before accepting the exact 8,388,608-byte field.
    private static func gunzip(_ gzip: Data, expectedSize: Int) throws -> Data {
        enum GzipError: Error { case invalidHeader, invalidSize, decodeFailed }
        guard gzip.count >= 18, gzip[0] == 0x1f, gzip[1] == 0x8b, gzip[2] == 8, gzip[3] & 0xe0 == 0 else {
            throw GzipError.invalidHeader
        }
        let flags = gzip[3]
        var offset = 10
        if flags & 0x04 != 0 {
            guard offset + 2 <= gzip.count - 8 else { throw GzipError.invalidHeader }
            let extra = Int(gzip[offset]) | Int(gzip[offset + 1]) << 8
            offset += 2 + extra
        }
        func skipCString() throws {
            while offset < gzip.count - 8, gzip[offset] != 0 { offset += 1 }
            guard offset < gzip.count - 8 else { throw GzipError.invalidHeader }
            offset += 1
        }
        if flags & 0x08 != 0 { try skipCString() }
        if flags & 0x10 != 0 { try skipCString() }
        if flags & 0x02 != 0 { offset += 2 }
        guard offset <= gzip.count - 8 else { throw GzipError.invalidHeader }
        let footer = gzip.count - 4
        let advertised = Int(gzip[footer]) | Int(gzip[footer + 1]) << 8
            | Int(gzip[footer + 2]) << 16 | Int(gzip[footer + 3]) << 24
        guard advertised == expectedSize else { throw GzipError.invalidSize }

        var output = Data(count: expectedSize)
        let decoded = output.withUnsafeMutableBytes { destination in
            gzip.withUnsafeBytes { source in
                compression_decode_buffer(destination.bindMemory(to: UInt8.self).baseAddress!, expectedSize,
                                          source.bindMemory(to: UInt8.self).baseAddress!.advanced(by: offset),
                                          gzip.count - offset - 8, nil, COMPRESSION_ZLIB)
            }
        }
        guard decoded == expectedSize else { throw GzipError.decodeFailed }
        return output
    }

    private static func image(_ name: String, ext: String) -> UIImage {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Media")
                        ?? Bundle.main.url(forResource: name, withExtension: ext),
              let image = UIImage(contentsOfFile: url.path) else {
            fatalError("\(name).\(ext) missing from the bundle or failed to decode")
        }
        return image
    }

    /// THREE.Color converts CSS hex colours from sRGB to its linear working space before writing
    /// the vertex buffer; mirror that conversion rather than merely copying the byte triplets.
    private static func linearColor(_ hex: Int) -> SIMD3<Float> {
        func linear(_ byte: Int) -> Float {
            let value = Float(byte) / 255
            return value < 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return SIMD3(linear(hex >> 16 & 255), linear(hex >> 8 & 255), linear(hex & 255))
    }
}
