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
    private var orbitNodes: [String: SCNNode] = [:]
    /// The date the orbit ellipses were last built for. The elements precess, so scrubbing far
    /// enough has to redraw them — but nowhere near every frame.
    private var orbitsBuiltFor = Date()
    private var featured: [Body] = []
    private var featuredIndex = -1
    private var nextChangeAt: TimeInterval = 0

    // Frame-time sampling. "Seems smooth" is not a number, and we are about to add per-frame
    // input work on top of this — worth knowing the headroom on the oldest hardware we target.
    private var frameCount = 0
    private var windowStart: TimeInterval = 0
    private var worstFrame: TimeInterval = 0
    private var lastFrameAt: TimeInterval = 0

    /// The loop travels *outward*, Sun to Eris. An arbitrary greatest-hits order is fine for an
    /// adult browsing; for a child watching the same loop night after night, the journey itself is
    /// part of what is being taught — things get colder, darker and slower the farther out you go.
    private let tour = ["Sun", "Mercury", "Venus", "Earth", "Mars", "Ceres", "Jupiter", "Saturn",
                        "Uranus", "Neptune", "Pluto", "Haumea", "Makemake", "Eris"]

    /// A camera move, interpolated by hand rather than handed to SCNTransaction.
    ///
    /// SCNTransaction lerps the camera along a straight line while the look-at target snaps to the
    /// destination immediately. Both halves of that are wrong. The straight line drives through the
    /// middle of the system, where the parallax is violent and the inner planets smear past; the
    /// snapped target makes the view spin to catch up. Together they give you whiplash.
    ///
    /// So: bow the path outward and upward, ease the *aim* along with the position, and let long
    /// journeys take longer — whiplash is an angular-rate problem, not a distance problem.
    private struct Flight {
        let from: SIMD3<Double>, control: SIMD3<Double>, to: SIMD3<Double>
        let aimFrom: SIMD3<Double>, aimTo: SIMD3<Double>
        let start: TimeInterval, duration: TimeInterval
        var endsAt: TimeInterval { start + duration }
    }
    private var flight: Flight?
    private var flightEndsAt: TimeInterval = 0

    private let narrator = Narrator()
    private let audio = AmbientAudio()
    /// A shuffle bag of fact indices per body, and the last one played. Every fact is handed out
    /// once in random order before any repeats, then the bag reshuffles — with no fact landing
    /// twice in a row across the reshuffle. Mirrors the web app's ShuffleBag: random each cycle,
    /// but full coverage, so a child eventually hears all of them rather than the same few.
    private var factBags: [String: [Int]] = [:]
    private var lastFact: [String: Int] = [:]
    /// Chosen when the flight starts, delivered on arrival. The index travels with the text so the
    /// spoken clip and the shown card can never drift apart.
    private var pendingLine: (text: String, index: Int)?
    /// Silence after a line finishes, before the camera moves on. Long enough for it to land.
    private static let pauseAfterNarration: TimeInterval = 4.5
    /// Ceiling in case narration never reports finishing — the loop must never wedge.
    private static let maxDwell: TimeInterval = 70

    /// Published for the SwiftUI title card. Read on the main actor from the render callback.
    @Published private(set) var caption: Caption?
    /// The date the scene is currently drawing, and whether that is the live present moment.
    @Published private(set) var clock = Clock(date: Date(), isLive: true)

    struct Caption: Equatable {
        let name: String
        let kind: String
        let distance: String
        let fact: String
    }

    struct Clock: Equatable {
        let date: Date
        let isLive: Bool
    }

    /// How long to hold a world after un-pausing. The ambient pace is otherwise set by the flight
    /// and the narration, not by a constant — see `arrive()`.
    private let resumeHold: TimeInterval = 11

    // MARK: - Time
    //
    // The one continuous input a Siri Remote is genuinely good at is a single-axis thumb drag.
    // On a desktop you spend that on the camera (orbit and zoom). Here the mapping is inverted:
    // the trackpad drives *time*, and the camera is moved by discrete directional clicks. That
    // is the whole interaction bet — continuous input for the continuous variable, discrete
    // input for discrete targets. Free-flying a camera with a glass trackpad is miserable;
    // winding the planets around the Sun with your thumb is not.

    /// Offset from the real present. Zero means "right now", which is the resting state.
    private var timeOffset: TimeInterval = 0
    /// Days per second, carried after the thumb lifts so a flick coasts.
    private var scrubVelocity: Double = 0
    private var isScrubbing = false
    private var lastInteractionAt: TimeInterval = 0
    private var ambientPaused = false

    /// The same bound the web atlas enforces, for the same reason: the JPL elements are only
    /// meaningful across this window, so the UI must not let you leave it.
    private static let minDate = ISO8601DateFormatter().date(from: "1800-01-01T12:00:00Z")!
    private static let maxDate = ISO8601DateFormatter().date(from: "2050-12-31T12:00:00Z")!

    /// A full sweep of the trackpad covers about a year. Slow enough to land on a month, fast
    /// enough that a flick sends the outer planets visibly wheeling.
    private static let daysPerPoint = 0.55
    /// Seconds of stillness before the scene glides home to the present and resumes drifting.
    private static let idleBeforeReturn: TimeInterval = 20

    var displayDate: Date {
        let target = Date().addingTimeInterval(timeOffset)
        return min(max(target, Self.minDate), Self.maxDate)
    }

    private var isLive: Bool { abs(timeOffset) < 60 }

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
        auditNarrationClips()
        audio.start()
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
        // Full influence. The old value (0.08) damped the aim to hide the fact that the target
        // node was being *teleported* to the next planet — the camera then whipped round chasing
        // it. The target is now eased along with the camera, so the aim can track it exactly.
        lookAt.influenceFactor = 1
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

            let node = SCNNode(geometry: geometry)
            scene.rootNode.addChildNode(node)
            orbitNodes[body.name] = node
        }
    }

    /// Rebuilds the ellipses for a new date. Only called when the scrub has moved far enough to
    /// matter — the elements precess slowly, so redrawing these every frame would be waste.
    private func rebuildOrbits(for date: Date) {
        orbitsBuiltFor = date
        for body in catalog.orbiting {
            guard let node = orbitNodes[body.name], let geometry = node.geometry else { continue }
            let vertices = Orbits.orbitPath(body, at: date, segments: 240).map { raw -> SCNVector3 in
                let au = (raw.x * raw.x + raw.y * raw.y + raw.z * raw.z).squareRoot()
                let scaled = au > 0 ? raw / au * displayRadius(au) : raw
                return SCNVector3(Float(scaled.x), Float(scaled.y), Float(scaled.z))
            }
            var indices: [Int32] = []
            for i in 0..<(vertices.count - 1) { indices += [Int32(i), Int32(i + 1)] }
            let rebuilt = SCNGeometry(
                sources: [SCNGeometrySource(vertices: vertices)],
                elements: [SCNGeometryElement(indices: indices, primitiveType: .line)]
            )
            rebuilt.firstMaterial = geometry.firstMaterial
            node.geometry = rebuilt
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

    /// A missing clip does not crash — it quietly downgrades to the robot voice, which looks and
    /// behaves like a perfectly healthy app. That is exactly how the first render shipped zero of
    /// its 73 clips without anyone noticing. So count them, out loud.
    private func auditNarrationClips() {
        var found = 0, expected = 0
        for (name, lines) in catalog.narration {
            for index in lines.indices {
                expected += 1
                let id = "narration-\(name.lowercased())-\(index)"
                let url = Bundle.main.url(forResource: id, withExtension: "m4a", subdirectory: "Media")
                    ?? Bundle.main.url(forResource: id, withExtension: "m4a")
                if url != nil { found += 1 }
            }
        }
        if found == expected {
            print("[narration] \(found)/\(expected) clips bundled")
        } else {
            print("⚠️  [narration] only \(found)/\(expected) clips bundled — the rest fall back to the "
                  + "on-device robot voice. Run: TTS_VOICE=bm_george npm run narration")
        }
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
        guard let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Media")
                        ?? Bundle.main.url(forResource: name, withExtension: ext) else { return nil }
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
        sampleFrameTime(at: time)
        advanceTime(at: time)
        flyCamera(at: time)

        // Positions for whatever moment we are showing — the live present by default, or wherever
        // the thumb has wound the clock to.
        let date = displayDate
        for body in catalog.orbiting {
            bodyNodes[body.name]?.simdPosition = SIMD3<Float>(displayPosition(body, at: date))
        }

        // The ellipses precess. Redraw them only once the scrub has moved a couple of years,
        // which is far below the point where the drift is visible but far above every frame.
        if abs(date.timeIntervalSince(orbitsBuiltFor)) > 2 * 365 * 86400 { rebuildOrbits(for: date) }

        // The music grows colder and emptier the farther out we are — driven by the world we are
        // on, or the one we are flying toward.
        if let body = currentBody {
            audio.setOuterness(auFromSun: Orbits.heliocentricDistanceAU(body, at: date))
        }

        let live = isLive
        if clock.date != date || clock.isLive != live { clock = Clock(date: date, isLive: live) }
        // Keep the caption's distance honest while the clock moves under it — but only once the
        // card is actually up. Mid-flight there is deliberately no card to refresh.
        if caption != nil, let body = currentBody, !live || isScrubbing {
            caption = makeCaption(for: body, at: date)
        }

        // Never start a new move while still flying, or the camera would jump mid-arc.
        guard !ambientPaused, !isScrubbing, flight == nil, time >= nextChangeAt else { return }
        advance(to: date)
    }

    private func advanceTime(at time: TimeInterval) {
        let step = lastFrameAt > 0 ? min(time - lastFrameAt, 0.1) : 0

        if !isScrubbing && scrubVelocity != 0 {
            // Coast, then settle. Exponential decay reads as momentum rather than a hard stop.
            timeOffset += scrubVelocity * step * 86400
            scrubVelocity *= pow(0.12, step)
            if abs(scrubVelocity) < 0.5 { scrubVelocity = 0 }
            clampOffset()
        }

        // Left alone, it goes home. This is a screensaver first: it must always return to showing
        // the real present rather than stranding you in 2043 because you brushed the remote on
        // your way out of the room. Play/Pause (isHoming) does the same thing without the wait.
        let idle = !isScrubbing && scrubVelocity == 0 && time - lastInteractionAt > Self.idleBeforeReturn
        guard isHoming || idle, !isLive else {
            if isLive && isHoming { isHoming = false }
            return
        }
        timeOffset *= pow(isHoming ? 0.02 : 0.25, step)
        if abs(timeOffset) < 60 {
            timeOffset = 0
            isHoming = false
            ambientPaused = false
        }
    }

    private func clampOffset() {
        let target = Date().addingTimeInterval(timeOffset)
        if target < Self.minDate { timeOffset = Self.minDate.timeIntervalSince(Date()); scrubVelocity = 0 }
        if target > Self.maxDate { timeOffset = Self.maxDate.timeIntervalSince(Date()); scrubVelocity = 0 }
    }

    private var currentBody: Body? {
        featured.indices.contains(featuredIndex) ? featured[featuredIndex] : nil
    }

    // MARK: - Input

    func beginScrub() {
        narrator.stop()
        audio.setNarrating(false)
        isScrubbing = true
        scrubVelocity = 0
        ambientPaused = true
        lastInteractionAt = lastFrameAt
    }

    /// `points` is the horizontal travel of the thumb since the gesture began.
    func scrub(toTranslation points: Double, from anchor: TimeInterval) {
        timeOffset = anchor + points * Self.daysPerPoint * 86400
        clampOffset()
        lastInteractionAt = lastFrameAt
    }

    /// `velocity` is the thumb's horizontal speed in points/second when it lifted.
    func endScrub(velocity: Double) {
        isScrubbing = false
        scrubVelocity = velocity * Self.daysPerPoint
        lastInteractionAt = lastFrameAt
    }

    var scrubAnchor: TimeInterval { timeOffset }

    /// Discrete input for a discrete target: step the camera to the next or previous world.
    func step(by delta: Int) {
        guard !featured.isEmpty else { return }
        narrator.stop()
        audio.setNarrating(false)
        ambientPaused = true
        lastInteractionAt = lastFrameAt
        featuredIndex = ((featuredIndex + delta) % featured.count + featured.count) % featured.count
        flyToCurrent(at: displayDate)
    }

    /// Select toggles the ambient drift, so you can hold on a world and just look at it.
    func toggleAmbient() {
        ambientPaused.toggle()
        lastInteractionAt = lastFrameAt
        nextChangeAt = lastFrameAt + resumeHold
    }

    /// Play/Pause snaps the clock back to the present without waiting out the idle timer.
    func returnToNow() {
        scrubVelocity = 0
        isScrubbing = false
        ambientPaused = false
        lastInteractionAt = lastFrameAt
        // Eased rather than instant: watching the planets wind back to where they really are is
        // the most legible possible confirmation of what "live" means.
        isHoming = true
    }

    private var isHoming = false

    private func advance(to date: Date) {
        featuredIndex = (featuredIndex + 1) % featured.count
        flyToCurrent(at: date)
    }

    private func flyToCurrent(at date: Date) {
        guard let body = currentBody, let node = bodyNodes[body.name] else { return }

        let target = SIMD3<Double>(node.simdPosition)
        let vantage = vantagePoint(for: body, at: target)
        let from = SIMD3<Double>(cameraNode.simdPosition)
        let travel = simd_distance(from, vantage)

        // Long hauls take longer, so the view never has to swing fast to keep up.
        let duration = min(15, max(6.5, 5.5 + travel * 0.04))

        // Bow the path outward from the Sun and lift it a little, rather than cutting straight
        // across the middle of the system.
        let midpoint = (from + vantage) * 0.5
        let outward = simd_length(midpoint) > 1 ? simd_normalize(midpoint) : SIMD3<Double>(0, 1, 0)
        let control = midpoint + outward * (travel * 0.3) + SIMD3<Double>(0, travel * 0.14, 0)

        flight = Flight(from: from, control: control, to: vantage,
                        aimFrom: SIMD3<Double>(focusTarget.simdPosition), aimTo: target,
                        start: lastFrameAt, duration: duration)
        flightEndsAt = lastFrameAt + duration

        // Pick the line now, but do not say it yet — it is delivered on arrival. Talking about a
        // world the camera is still travelling towards means the words land on the wrong picture:
        // you hear about Saturn's rings while still looking at Jupiter. Fly first, then speak.
        pendingLine = nextLine(for: body)

        // The card goes with the voice, so it fades out for the journey and returns on arrival.
        // Leaving it up would park text on screen that nothing is reading.
        caption = nil

        // Safety ceiling, replaced the moment the voice reports back.
        nextChangeAt = flightEndsAt + Self.maxDwell
    }

    /// The next fact for this body, drawn at random from its shuffle bag, with its index.
    private func nextLine(for body: Body) -> (text: String, index: Int) {
        let lines = catalog.narration[body.name] ?? []
        guard lines.count > 1 else { return (lines.first ?? body.fact, 0) }

        var bag = factBags[body.name] ?? []
        if bag.isEmpty {
            bag = Array(0..<lines.count).shuffled()
            // Don't let the reshuffle repeat the fact we just ended on.
            if let last = lastFact[body.name], bag.first == last, bag.count > 1 { bag.swapAt(0, 1) }
        }
        let index = bag.removeFirst()
        factBags[body.name] = bag
        lastFact[body.name] = index
        return (lines[index], index)
    }

    /// The camera has landed. Now show the card and say the words, together, as one beat.
    private func arrive() {
        guard let body = currentBody, let pending = pendingLine else { return }
        pendingLine = nil

        caption = makeCaption(for: body, at: displayDate, line: pending.text)

        audio.setNarrating(true)
        narrator.speak(pending.text, clipID: "narration-\(body.name.lowercased())-\(pending.index)") { [weak self] in
            guard let self else { return }
            self.audio.setNarrating(false)
            self.nextChangeAt = self.lastFrameAt + Self.pauseAfterNarration
        }
    }

    private func flyCamera(at time: TimeInterval) {
        guard let flight else {
            // Not flying: hold station on the current world. Without this the planet would slide
            // out of frame the moment you scrub time, since it is orbiting and the camera is not.
            guard let body = currentBody, let node = bodyNodes[body.name] else { return }
            let target = SIMD3<Double>(node.simdPosition)
            focusTarget.simdPosition = node.simdPosition
            let step = lastFrameAt > 0 ? min(time - lastFrameAt, 0.1) : 0
            let ease = 1 - pow(0.06, step)   // frame-rate independent approach
            let wanted = vantagePoint(for: body, at: target)
            cameraNode.simdPosition = SIMD3<Float>(mix(SIMD3<Double>(cameraNode.simdPosition), wanted, t: ease))
            return
        }

        let t = min(1, max(0, (time - flight.start) / flight.duration))
        // Cubic ease in and out: the angular rate is zero at both ends, which is exactly where a
        // hard start or a hard stop would read as a snap.
        let e = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2

        // Quadratic Bezier along the bowed path.
        let inv = 1 - e
        let position = flight.from * (inv * inv) + flight.control * (2 * inv * e) + flight.to * (e * e)
        cameraNode.simdPosition = SIMD3<Float>(position)
        focusTarget.simdPosition = SIMD3<Float>(mix(flight.aimFrom, flight.aimTo, t: e))

        if t >= 1 {
            self.flight = nil
            arrive()
        }
    }

    /// The card shows the words that are being spoken, so a reading adult can follow along with a
    /// child who cannot. Same sentence, two ways in.
    private func makeCaption(for body: Body, at date: Date, line: String? = nil) -> Caption {
        let au = Orbits.heliocentricDistanceAU(body, at: date)
        let when = isLive ? "right now" : "on \(Self.captionDate.string(from: date))"
        return Caption(
            name: body.name.uppercased(),
            kind: body.kind,
            distance: body.name == "Sun"
                ? "The centre of everything"
                : String(format: au < 2 ? "%.3f AU from the Sun, %@" : "%.2f AU from the Sun, %@", au, when),
            fact: line ?? caption?.fact ?? body.fact
        )
    }

    private static let captionDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMMM yyyy"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    private func sampleFrameTime(at time: TimeInterval) {
        if lastFrameAt > 0 { worstFrame = max(worstFrame, time - lastFrameAt) }
        lastFrameAt = time
        frameCount += 1

        if windowStart == 0 { windowStart = time; return }
        let elapsed = time - windowStart
        guard elapsed >= 3 else { return }

        // 60fps is a 16.7ms budget. Report the worst frame in the window too: a good average with
        // an ugly tail is what a stutter actually looks like, and an average alone hides it.
        #if DEBUG
        let fps = Double(frameCount) / elapsed
        print(String(format: "[perf] %.1f fps avg · worst frame %.1f ms · budget 16.7 ms", fps, worstFrame * 1000))
        #endif
        frameCount = 0
        worstFrame = 0
        windowStart = time
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

/// Linear interpolation. simd_mix exists but is fussy about types here, and this reads clearer.
private func mix(_ a: SIMD3<Double>, _ b: SIMD3<Double>, t: Double) -> SIMD3<Double> {
    a + (b - a) * t
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
