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
