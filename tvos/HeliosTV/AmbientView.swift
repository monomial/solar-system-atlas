import SceneKit
import SwiftUI
import UIKit

struct AmbientView: View {
    @StateObject private var orrery = OrreryScene()
    @Environment(\.scenePhase) private var scenePhase

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

            VStack {
                HStack {
                    Spacer()
                    DateChip(clock: orrery.clock).padding(.trailing, 100).padding(.top, 60)
                }
                Spacer()
            }
        }
        .background(.black)
        .animation(.easeInOut(duration: 1.4), value: orrery.caption)
        // Hold off tvOS's Aerial screensaver, the same way a video player does. The screensaver is
        // gated on the system idle timer, and this is an ambient display meant to be left running —
        // there is no such thing as "idle" here. onAppear sets it for the initial launch; the
        // scenePhase change reasserts it, because tvOS clears the flag whenever the app backgrounds.
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            #if DEBUG
            print("[idle] screensaver hold engaged: isIdleTimerDisabled=\(UIApplication.shared.isIdleTimerDisabled)")
            #endif
        }
        .onChange(of: scenePhase) { _, phase in
            UIApplication.shared.isIdleTimerDisabled = (phase == .active)
        }
    }
}

/// Mirrors the web atlas's date chip: a live dot when the scene is showing the real present, the
/// date itself when the clock has been wound elsewhere. It is the only persistent chrome, and it
/// earns that because "is this real, or am I looking at 2043?" is the one question the viewer
/// must never have to guess at.
private struct DateChip: View {
    let clock: OrreryScene.Clock

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMM yyyy"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    var body: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(clock.isLive ? Color.green : Color(red: 1, green: 0.75, blue: 0.35))
                .frame(width: 12, height: 12)
            Text(clock.isLive ? "LIVE" : Self.formatter.string(from: clock.date).uppercased())
                .font(.system(size: 22, weight: .semibold))
                .tracking(2)
                .foregroundStyle(.white.opacity(0.85))
                .monospacedDigit()
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 14)
        .background(.black.opacity(0.45), in: Capsule())
        .animation(.easeInOut(duration: 0.4), value: clock.isLive)
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
                .monospacedDigit()

            Text(caption.fact)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(.white.opacity(0.78))
                .lineSpacing(6)
                .frame(maxWidth: 900, alignment: .leading)

            // Stats appear only in a deep-dive, where the viewer has stopped to study one world.
            if caption.width != nil || caption.day != nil || caption.year != nil {
                HStack(spacing: 40) {
                    stat("WIDTH", caption.width)
                    stat("ONE DAY", caption.day)
                    stat(caption.isMoon ? "ONE ORBIT" : "ONE YEAR", caption.year)
                }
                .padding(.top, 8)
            }
        }
        .shadow(color: .black.opacity(0.85), radius: 18, y: 6)
    }

    @ViewBuilder
    private func stat(_ label: String, _ value: String?) -> some View {
        if let value {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.system(size: 16, weight: .semibold)).tracking(2).foregroundStyle(.white.opacity(0.45))
                Text(value).font(.system(size: 22, weight: .medium)).foregroundStyle(.white.opacity(0.85))
            }
        }
    }
}

private struct OrreryView: UIViewRepresentable {
    let orrery: OrreryScene

    func makeCoordinator() -> Coordinator { Coordinator(orrery: orrery) }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = orrery.makeScene()
        view.delegate = orrery
        orrery.attach(view: view)   // the finale caps the frame rate for its raymarch, then restores it
        view.isPlaying = true            // ambient: never let the render loop idle
        view.rendersContinuously = true
        view.antialiasingMode = .multisampling4X
        view.backgroundColor = .black
        view.preferredFramesPerSecond = 60

        context.coordinator.attachGestures(to: view)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private let orrery: OrreryScene
        private var anchor: TimeInterval = 0
        private weak var menuRecognizer: UIGestureRecognizer?

        init(orrery: OrreryScene) { self.orrery = orrery }

        func attachGestures(to view: SCNView) {
            // Continuous: the thumb drives time.
            let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan))
            view.addGestureRecognizer(pan)

            // Discrete: directional *clicks* move between worlds. Deliberately clicks and not
            // swipes — a swipe on the touch surface is the same gesture as a scrub, and making
            // one input mean two things is how a remote starts feeling haunted.
            addPress(.leftArrow, #selector(handleLeft), to: view)
            addPress(.rightArrow, #selector(handleRight), to: view)
            // Up / Down walk a world's moon family while deep-diving.
            addPress(.upArrow, #selector(handleUp), to: view)
            addPress(.downArrow, #selector(handleDown), to: view)
            // Select drops into a deep-dive on the focused world; Menu / Back climbs back out.
            addPress(.select, #selector(handleSelect), to: view)
            let menu = addPress(.menu, #selector(handleMenu), to: view)
            menu.delegate = self
            menuRecognizer = menu
            addPress(.playPause, #selector(handlePlayPause), to: view)
        }

        @discardableResult
        private func addPress(_ type: UIPress.PressType, _ action: Selector, to view: UIView) -> UITapGestureRecognizer {
            let recognizer = UITapGestureRecognizer(target: self, action: action)
            recognizer.allowedPressTypes = [NSNumber(value: type.rawValue)]
            view.addGestureRecognizer(recognizer)
            return recognizer
        }

        // Only swallow Menu while a deep-dive is open — there it means "back out". At the top level
        // it passes through untouched, so the system's usual "Menu exits the app" still works and
        // the viewer is never trapped.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive press: UIPress) -> Bool {
            gestureRecognizer !== menuRecognizer || orrery.inDeepDive
        }

        @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
            let dx = Double(gesture.translation(in: gesture.view).x)
            switch gesture.state {
            case .began:
                anchor = orrery.scrubAnchor
                orrery.beginScrub()
            case .changed:
                orrery.scrub(toTranslation: dx, from: anchor)
            case .ended, .cancelled:
                orrery.endScrub(velocity: Double(gesture.velocity(in: gesture.view).x))
            default:
                break
            }
        }

        @objc private func handleLeft() { orrery.step(by: -1) }
        @objc private func handleRight() { orrery.step(by: 1) }
        @objc private func handleUp() { orrery.deepStep(by: -1) }
        @objc private func handleDown() { orrery.deepStep(by: 1) }
        @objc private func handleSelect() { orrery.enterDeepDive() }
        @objc private func handleMenu() { orrery.exitDeepDive() }
        @objc private func handlePlayPause() { orrery.returnToNow() }
    }
}
