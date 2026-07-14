import SceneKit
import SwiftUI

struct AmbientView: View {
    @StateObject private var orrery = OrreryScene()

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            OrreryView(orrery: orrery)
                .ignoresSafeArea()

            if let caption = orrery.caption {
                TitleCard(caption: caption)
                    .padding(.leading, 100)
                    .padding(.bottom, 100)
                    // Keyed on the name so SwiftUI cross-fades between worlds instead of
                    // mutating the text in place, which would read as a glitch at this size.
                    .id(caption.name)
                    // Pure cross-fade, no slide. A card that moves is fidgety on something you
                    // are meant to leave running, and a slide-up can still be mid-flight when
                    // the eye lands on it — which also let the last line clip off the bottom.
                    .transition(.opacity)
            }
        }
        .background(.black)
        .animation(.easeInOut(duration: 1.4), value: orrery.caption)
    }
}

/// Ten-foot typography. Everything here is much larger and much lower-contrast-tolerant than
/// the web atlas's panels: you are reading this from a sofa, not a desk, and there is no
/// pointer to hover with. One world, one number, one fact — nothing that invites squinting.
private struct TitleCard: View {
    let caption: OrreryScene.Caption

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(caption.kind.uppercased())
                .font(.system(size: 24, weight: .semibold, design: .default))
                .tracking(3)
                .foregroundStyle(.white.opacity(0.55))

            Text(caption.name)
                .font(.system(size: 96, weight: .bold, design: .serif))
                .foregroundStyle(.white)

            Text(caption.distance)
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Color(red: 1, green: 0.83, blue: 0.55))

            Text(caption.fact)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(.white.opacity(0.78))
                .lineSpacing(6)
                .frame(maxWidth: 900, alignment: .leading)
        }
        .shadow(color: .black.opacity(0.85), radius: 18, y: 6)
    }
}

private struct OrreryView: UIViewRepresentable {
    let orrery: OrreryScene

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = orrery.makeScene()
        view.delegate = orrery
        view.isPlaying = true            // ambient: never let the render loop idle
        view.rendersContinuously = true
        view.antialiasingMode = .multisampling4X
        view.backgroundColor = .black
        view.preferredFramesPerSecond = 60
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {}
}
