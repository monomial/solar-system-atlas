import SceneKit
import UIKit

/// The ambient orrery.
///
/// Positions are computed from the *actual current date* every frame — not a simulation, not
/// a loop. What you are looking at is where the planets are right now. That claim is the
/// whole point of the thing, so nothing here fakes motion: the planets barely move (Earth
/// covers about a degree a day), and all the visual life comes from the camera drifting
/// between worlds and the planets turning on their axes.
///
/// Display scale matches the web atlas: distances are square-root compressed so the outer
/// planets stay on screen, while orbital *angles* stay true. Body radii are the same display
/// radii the web uses. See CLAUDE.md in the repo root.
@MainActor
final class OrreryScene: NSObject, ObservableObject, SCNSceneRendererDelegate {

    private let catalog = Catalog.load()
    private let scene = SCNScene()
    private let cameraNode = SCNNode()
    private let focusTarget = SCNNode()

    private var bodyNodes: [String: SCNNode] = [:]
    private var featured: [Body] = []
    private var featuredIndex = -1
    private var nextChangeAt: TimeInterval = 0

    /// Names the ambient loop lingers on, in the order it visits them.
    private let tour = ["Sun", "Earth", "Saturn", "Jupiter", "Mars", "Neptune", "Venus", "Uranus", "Mercury", "Pluto"]

    /// Published for the SwiftUI title card. Read on the main actor from the render callback.
    @Published private(set) var caption: Caption?

    struct Caption: Equatable {
        let name: String
        let kind: String
        let distance: String
        let fact: String
    }

    /// Seconds each world holds the frame before the camera drifts to the next.
    private let dwell: TimeInterval = 11
    private let flightDuration: TimeInterval = 5.5

    // Same compression the web atlas uses: real angles, readable distances.
    private func displayRadius(_ au: Double) -> Double { au.squareRoot() * 29 }

    private func displayPosition(_ body: Body, at date: Date) -> SIMD3<Double> {
        let raw = Orbits.heliocentricPosition(body, at: date)
        let au = (raw.x * raw.x + raw.y * raw.y + raw.z * raw.z).squareRoot()
        guard au > 0 else { return .zero }
        return raw / au * displayRadius(au)
    }

    // MARK: - Build

    func makeScene() -> SCNScene {
        scene.background.contents = UIColor(red: 0.008, green: 0.012, blue: 0.039, alpha: 1)

        addStarfield()
        addSun()
        addOrbits()
        addPlanets()
        addCamera()

        featured = tour.compactMap { name in
            (catalog.planets + catalog.dwarfs).first { $0.name == name }
        }
        scene.rootNode.addChildNode(focusTarget)
        return scene
    }

    private func addCamera() {
        let camera = SCNCamera()
        camera.fieldOfView = 46
        camera.zNear = 0.1
        camera.zFar = 5000

        // SceneKit gives us the bloom the web build needs a whole post-processing chain for.
        // This is the reason this prototype is SceneKit and not RealityKit: on a TV the glow
        // around the Sun is most of the drama, and here it is four lines.
        camera.wantsHDR = true
        camera.bloomIntensity = 1.1
        camera.bloomThreshold = 0.55
        camera.bloomBlurRadius = 18
        camera.wantsExposureAdaptation = false
        camera.exposureOffset = -0.3

        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 70, 150)

        let lookAt = SCNLookAtConstraint(target: focusTarget)
        lookAt.isGimbalLockEnabled = true
        // Damping keeps the aim from snapping when the target planet is close to the camera.
        lookAt.influenceFactor = 0.08
        cameraNode.constraints = [lookAt]

        scene.rootNode.addChildNode(cameraNode)
    }

    private func addSun() {
        let body = catalog.sun
        let geometry = SCNSphere(radius: CGFloat(body.radius))
        geometry.segmentCount = 96

        let material = geometry.firstMaterial!
        material.lightingModel = .constant
        material.diffuse.contents = texture(for: body) ?? UIColor(hex: body.color)
        // Pushed above the bloom threshold so the Sun is what actually blooms, not the planets.
        material.emission.contents = texture(for: body) ?? UIColor(hex: body.color)
        material.emission.intensity = 1.35

        let node = SCNNode(geometry: geometry)
        node.name = body.name
        node.runAction(.repeatForever(.rotate(by: .pi * 2, around: SCNVector3(0, 1, 0), duration: 90)))
        scene.rootNode.addChildNode(node)
        bodyNodes[body.name] = node

        let light = SCNLight()
        light.type = .omni
        light.color = UIColor(red: 1, green: 0.85, blue: 0.65, alpha: 1)
        light.intensity = 4300
        light.attenuationEndDistance = 0  // no falloff: Neptune should still be lit
        node.light = light

        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.color = UIColor(red: 0.30, green: 0.36, blue: 0.55, alpha: 1)
        ambient.intensity = 320
        let ambientNode = SCNNode()
        ambientNode.light = ambient
        scene.rootNode.addChildNode(ambientNode)
    }

    private func addPlanets() {
        let now = Date()
        for body in catalog.orbiting {
            let geometry = SCNSphere(radius: CGFloat(body.radius))
            geometry.segmentCount = 64

            let material = geometry.firstMaterial!
            material.lightingModel = .physicallyBased
            material.diffuse.contents = texture(for: body) ?? UIColor(hex: body.color)
            material.roughness.contents = body.name == "Earth" ? 0.85 : 0.95
            material.metalness.contents = 0.0

            let node = SCNNode(geometry: geometry)
            node.name = body.name
            node.simdPosition = SIMD3<Float>(displayPosition(body, at: now))

            // Axial tilt, so the poles do not all point the same boring way.
            let tilt: Double = body.name == "Uranus" ? 97.8 : body.name == "Saturn" ? 26.7 : body.name == "Earth" ? 23.4 : 8
            node.eulerAngles.z = Float(Orbits.deg(tilt))
            node.runAction(.repeatForever(.rotate(by: .pi * 2, around: SCNVector3(0, 1, 0), duration: body.name == "Jupiter" ? 26 : 46)))

            if body.name == "Saturn" { node.addChildNode(saturnRings(for: body)) }

            scene.rootNode.addChildNode(node)
            bodyNodes[body.name] = node
        }
    }

    /// A flat annulus with *radial* UVs, so the ring image maps outward from the planet and the
    /// Cassini Division lands at the right radius. SCNTube would stretch the texture the wrong
    /// way round; this mirrors the custom ring geometry the web build uses.
    private func saturnRings(for body: Body) -> SCNNode {
        let inner = Double(body.radius) * 1.35, outer = Double(body.radius) * 2.3
        let segments = 180

        var vertices: [SCNVector3] = []
        var uvs: [CGPoint] = []
        var indices: [Int32] = []

        for i in 0...segments {
            let angle = Double(i) / Double(segments) * 2 * .pi
            let (c, s) = (cos(angle), sin(angle))
            vertices.append(SCNVector3(Float(c * inner), 0, Float(s * inner)))
            vertices.append(SCNVector3(Float(c * outer), 0, Float(s * outer)))
            uvs.append(CGPoint(x: 0, y: 0.5))
            uvs.append(CGPoint(x: 1, y: 0.5))
            if i < segments {
                let base = Int32(i * 2)
                indices += [base, base + 1, base + 2, base + 1, base + 3, base + 2]
            }
        }

        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices), SCNGeometrySource(textureCoordinates: uvs)],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)]
        )

        let material = geometry.firstMaterial!
        material.lightingModel = .constant
        material.diffuse.contents = image(named: "saturn-ring", ext: "png") ?? UIColor(white: 0.8, alpha: 1)
        material.diffuse.wrapS = .clamp
        material.diffuse.wrapT = .clamp
        material.isDoubleSided = true
        material.blendMode = .alpha
        material.writesToDepthBuffer = false

        return SCNNode(geometry: geometry)
    }

    private func addOrbits() {
        let now = Date()
        for body in catalog.orbiting {
            let path = Orbits.orbitPath(body, at: now, segments: 240)
            let vertices = path.map { raw -> SCNVector3 in
                let au = (raw.x * raw.x + raw.y * raw.y + raw.z * raw.z).squareRoot()
                let scaled = au > 0 ? raw / au * displayRadius(au) : raw
                return SCNVector3(Float(scaled.x), Float(scaled.y), Float(scaled.z))
            }

            var indices: [Int32] = []
            for i in 0..<(vertices.count - 1) { indices += [Int32(i), Int32(i + 1)] }

            let geometry = SCNGeometry(
                sources: [SCNGeometrySource(vertices: vertices)],
                elements: [SCNGeometryElement(indices: indices, primitiveType: .line)]
            )
            let material = geometry.firstMaterial!
            material.lightingModel = .constant
            material.diffuse.contents = UIColor(hex: body.accent).withAlphaComponent(0.16)
            material.writesToDepthBuffer = false

            scene.rootNode.addChildNode(SCNNode(geometry: geometry))
        }
    }

    private func addStarfield() {
        var vertices: [SCNVector3] = []
        var colors: [SIMD3<Float>] = []

        // Same cheap deterministic hash the web build uses, so the sky is stable across launches.
        func seeded(_ n: Double) -> Double {
            let x = sin(n * 999.91) * 43758.5453
            return x - x.rounded(.down)
        }

        for i in 0..<6000 {
            let r = 900 + seeded(Double(i)) * 1400
            let theta = seeded(Double(i) + 8) * 2 * .pi
            let phi = acos(2 * seeded(Double(i) + 18) - 1)
            vertices.append(SCNVector3(
                Float(r * sin(phi) * cos(theta)),
                Float(r * cos(phi) * 0.75),
                Float(r * sin(phi) * sin(theta))
            ))
            // A few warm and cool stars stop the field reading as grey noise.
            if i % 13 == 0 { colors.append(SIMD3(0.60, 0.70, 1.0)) }
            else if i % 17 == 0 { colors.append(SIMD3(1.0, 0.82, 0.67)) }
            else { colors.append(SIMD3(1, 1, 1)) }
        }

        let colorData = Data(bytes: colors, count: colors.count * MemoryLayout<SIMD3<Float>>.stride)
        let colorSource = SCNGeometrySource(
            data: colorData, semantic: .color, vectorCount: colors.count,
            usesFloatComponents: true, componentsPerVector: 3,
            bytesPerComponent: MemoryLayout<Float>.size, dataOffset: 0,
            dataStride: MemoryLayout<SIMD3<Float>>.stride
        )

        let element = SCNGeometryElement(
            indices: (0..<Int32(vertices.count)).map { $0 }, primitiveType: .point
        )
        element.pointSize = 3
        element.minimumPointScreenSpaceRadius = 1.0
        element.maximumPointScreenSpaceRadius = 2.6

        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices), colorSource], elements: [element]
        )
        geometry.firstMaterial?.lightingModel = .constant
        geometry.firstMaterial?.writesToDepthBuffer = false

        let node = SCNNode(geometry: geometry)
        node.runAction(.repeatForever(.rotate(by: .pi * 2, around: SCNVector3(0, 1, 0), duration: 1800)))
        scene.rootNode.addChildNode(node)
    }

    // MARK: - Textures
    //
    // A missing texture in the web build failed *silently* — the planet just rendered as a flat
    // grey sphere with no console error, which is exactly the kind of bug that ships. So this
    // path is loud: if an image is missing we say so, rather than quietly falling back.

    private func texture(for body: Body) -> UIImage? {
        image(named: body.name.lowercased(), ext: "webp")
    }

    private func image(named name: String, ext: String) -> UIImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else { return nil }
        guard let image = UIImage(contentsOfFile: url.path) else {
            print("⚠️  \(name).\(ext) is in the bundle but failed to decode — is WebP supported here?")
            return nil
        }
        return image
    }

    // MARK: - The ambient loop

    nonisolated func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        Task { @MainActor in self.update(at: time) }
    }

    private func update(at time: TimeInterval) {
        // Real positions, for the real current moment, recomputed every frame. The planets are
        // where they actually are.
        let now = Date()
        for body in catalog.orbiting {
            bodyNodes[body.name]?.simdPosition = SIMD3<Float>(displayPosition(body, at: now))
        }

        guard time >= nextChangeAt else { return }
        nextChangeAt = time + dwell
        advance(to: now)
    }

    private func advance(to now: Date) {
        featuredIndex = (featuredIndex + 1) % featured.count
        let body = featured[featuredIndex]
        guard let node = bodyNodes[body.name] else { return }

        let target = SIMD3<Double>(node.simdPosition)
        let vantage = vantagePoint(for: body, at: target)

        focusTarget.simdPosition = node.simdPosition

        SCNTransaction.begin()
        SCNTransaction.animationDuration = flightDuration
        SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        cameraNode.simdPosition = SIMD3<Float>(vantage)
        SCNTransaction.commit()

        let au = Orbits.heliocentricDistanceAU(body, at: now)
        caption = Caption(
            name: body.name.uppercased(),
            kind: body.kind,
            distance: body.name == "Sun"
                ? "The centre of everything"
                : String(format: au < 2 ? "%.3f AU from the Sun, right now" : "%.2f AU from the Sun, right now", au),
            fact: body.fact
        )
    }

    /// Places the camera off to the side of the body rather than between it and the Sun, so the
    /// terminator falls across the disc and the surface texture actually reads. Straight-on
    /// lighting flattens a sphere into a disc; a raking angle is what makes it look like a world.
    private func vantagePoint(for body: Body, at target: SIMD3<Double>) -> SIMD3<Double> {
        if body.name == "Sun" { return SIMD3(0, 46, 128) }

        let outward = simd_normalize(target)
        let tangent = simd_normalize(simd_cross(outward, SIMD3<Double>(0, 1, 0)))
        let distance = Double(body.radius) * 7.5 + 5.5
        let height = Double(body.radius) * 2.4 + 1.5

        return target + tangent * distance + SIMD3(0, height, 0) - outward * (distance * 0.25)
    }
}

extension UIColor {
    /// Hex strings come straight from the shared catalog (`#3e89d8`).
    convenience init(hex: String) {
        let raw = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let value = UInt32(raw, radix: 16) ?? 0x888888
        self.init(
            red: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1
        )
    }
}
