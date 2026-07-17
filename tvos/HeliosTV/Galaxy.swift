import SceneKit
import UIKit

/// The volumetric Milky Way node for the tour finale.
///
/// A single box whose fragment shader raymarches the same emission/dust maps the web atlas
/// paints live (GalaxyVolume.metal — see the header there for the contract with the web build).
/// The maps are the committed PNGs baked by `npm run galaxy-maps`; like the narration clips,
/// they are generated assets the Xcode build cannot produce itself.
///
/// The shader marches in node-local units (1 unit = 1,000 light-years, disk radius 56), so the
/// finale is free to scale and place this node however it likes. `node.opacity` drives the
/// shader's intensity uniform — SceneKit's own opacity does not reach a custom SCNProgram, so
/// the binding below routes it through, which lets ordinary SCNAction fades run the show.
@MainActor
enum Galaxy {

    /// Galaxy-local position of the Sun: azimuth 90° at radius 26 (26,000 ly), matching the web
    /// atlas's solar-system marker and the Orion Spur in the painted maps.
    static let sunLocal = SIMD3<Double>(0, 0.8, 26)

    static func makeNode() -> SCNNode {
        let box = SCNBox(width: 124, height: 8, length: 124, chamferRadius: 0)

        let program = SCNProgram()
        program.vertexFunctionName = "galaxyVertex"
        program.fragmentFunctionName = "galaxyFragment"
        program.isOpaque = false
        // node.opacity → shader intensity, so SCNAction.fadeIn/fadeOut drive the volume.
        program.handleBinding(ofBufferNamed: "uniforms", frequency: .perNode) { stream, node, _, _ in
            var intensity = Float(node.opacity)
            stream.writeBytes(&intensity, count: MemoryLayout<Float>.size)
        }

        let material = box.firstMaterial!
        material.program = program
        // Render the box's inside faces: the analytic ray segment is what draws, and the camera
        // must be free to sit inside the slab mid-flight.
        material.cullMode = .front
        material.writesToDepthBuffer = false
        material.readsFromDepthBuffer = false
        material.blendMode = .alpha  // SceneKit blends premultiplied — the shader's convention

        // The same loud-on-missing policy as OrreryScene's textures: a missing map here would
        // otherwise render an empty black box and look like a mysteriously broken finale.
        material.setValue(SCNMaterialProperty(contents: galaxyImage("galaxy-emission")), forKey: "emissionMap")
        material.setValue(SCNMaterialProperty(contents: galaxyImage("galaxy-dust")), forKey: "dustMap")

        let node = SCNNode(geometry: box)
        node.name = "milky-way"
        node.opacity = 0
        node.isHidden = true
        return node
    }

    /// The Local Group for the finale's last beat: each member as a flat authored portrait
    /// (Milky Way, Andromeda, Triangulum) or a tinted glow (the Clouds and dwarfs), at schematic
    /// positions from the shared catalog. `unitsPerLG` converts catalog Local Group units
    /// (1 = 50,000 ly) into orrery world units. The caller positions the container so the Milky
    /// Way member lands exactly where the volumetric galaxy sits — the crossfade between them is
    /// what sells the zoom-out.
    static func localGroupNode(_ galaxies: [LocalGroupGalaxy], unitsPerLG: Double) -> SCNNode {
        let group = SCNNode()
        group.name = "local-group"
        group.opacity = 0
        group.isHidden = true
        guard let home = galaxies.first(where: { $0.id == "milky-way" }) else { return group }
        let homePosition = position(of: home)

        for galaxy in galaxies {
            var lg = position(of: galaxy)
            // The Clouds sit so close to home that their enlarged portraits would be swallowed by
            // the Milky Way's — push them out along their true bearing, exactly as the web's
            // localDisplayPosition does.
            if galaxy.id == "lmc" || galaxy.id == "smc" {
                lg = homePosition + simd_normalize(lg - homePosition) * (galaxy.id == "lmc" ? 8 : 10)
            }

            let diameter = CGFloat(galaxy.visualSize * 2 * unitsPerLG)
            let plane = SCNPlane(width: diameter, height: diameter)
            let material = plane.firstMaterial!
            material.lightingModel = .constant
            material.diffuse.contents = portrait(for: galaxy)
            material.blendMode = .add
            material.isDoubleSided = true
            material.writesToDepthBuffer = false

            let node = SCNNode(geometry: plane)
            node.name = "lg-\(galaxy.id)"
            node.simdPosition = SIMD3<Float>(lg * unitsPerLG)
            // Face the finale's approach bearing, spin to the position angle, incline by the
            // catalog tilt — the web's buildGalaxy composition. One ten-foot concession: the
            // tilt is capped, because Andromeda's honest ~73° collapses to a needle at this
            // camera distance and the narration is promising "the other great spiral". The web
            // keeps the full inclination; there you can orbit, here the shot is fixed.
            let qa = simd_quatd(from: SIMD3<Double>(0, 0, 1), to: simd_normalize(SIMD3<Double>(0, 0.5547, 0.8321)))
            let qpa = simd_quatd(angle: galaxy.angle * 1.3, axis: SIMD3<Double>(0, 0, 1))
            let qt = simd_quatd(angle: min(galaxy.tilt, 0.9), axis: SIMD3<Double>(1, 0, 0))
            node.simdOrientation = simd_quatf(vector: SIMD4<Float>((qa * qpa * qt).vector))
            group.addChildNode(node)
        }
        return group
    }

    private static func position(of galaxy: LocalGroupGalaxy) -> SIMD3<Double> {
        SIMD3<Double>(galaxy.position[0], galaxy.position[1], galaxy.position[2])
    }

    private static func portrait(for galaxy: LocalGroupGalaxy) -> UIImage {
        let slug = galaxy.variant == "milkyway" ? "milky-way" : galaxy.variant
        if ["milkyway", "andromeda", "triangulum"].contains(galaxy.variant) {
            let name = "local-group-\(slug)-1024"
            if let url = Bundle.main.url(forResource: name, withExtension: "webp", subdirectory: "Media")
                        ?? Bundle.main.url(forResource: name, withExtension: "webp"),
               let image = UIImage(contentsOfFile: url.path) {
                return image
            }
            print("⚠️  \(name).webp missing from the bundle — run `npm run catalog`. \(galaxy.name) falls back to a glow.")
        }
        return glow(hex: galaxy.color)
    }

    /// A soft radial glow in the galaxy's catalog colour — the irregulars and dwarfs have no
    /// authored portrait, matching the web, where they are procedural smudges.
    private static func glow(hex: String) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 128, height: 128)).image { context in
            let color = UIColor(hex: hex)
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                      colors: [color.withAlphaComponent(0.8).cgColor,
                                               color.withAlphaComponent(0).cgColor] as CFArray,
                                      locations: [0, 1])!
            context.cgContext.drawRadialGradient(gradient,
                                                 startCenter: CGPoint(x: 64, y: 64), startRadius: 0,
                                                 endCenter: CGPoint(x: 64, y: 64), endRadius: 64,
                                                 options: [])
        }
    }

    private static func galaxyImage(_ name: String) -> UIImage {
        guard let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Media")
                        ?? Bundle.main.url(forResource: name, withExtension: "png"),
              let image = UIImage(contentsOfFile: url.path) else {
            print("⚠️  \(name).png missing from the bundle — run `npm run galaxy-maps` and add Media/ PNGs to the target. The finale galaxy will render black.")
            return UIImage()
        }
        return image
    }
}
