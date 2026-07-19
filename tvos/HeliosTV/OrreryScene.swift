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

    // MARK: - Finale
    //
    // After Eris, once per loop, the tour pulls back until the whole galaxy resolves: the planets
    // and orbit lines fade, the volumetric Milky Way fades in around the camera, and the flight
    // recedes to a vantage that frames the disk. One narration line lands, then everything fades
    // back and the loop returns to the Sun. The orrery and the galaxy use incompatible display
    // scales (sqrt-compressed AU vs schematic light-years), so this is a staged crossfade — the
    // narration carries the scale jump; the picture never pretends the zoom is continuous.
    /// It then pulls back twice more: first to the Local Group, then through one final long
    /// recession until the cosmic web and CMB wall resolve around every galaxy before fading home.
    private enum Finale { case none, flying, dwelling, flyingLocal, dwellingLocal, flyingUniverse, dwellingUniverse }
    private var finale: Finale = .none
    private let galaxyNode = Galaxy.makeNode()
    private var localGroupNode = SCNNode()
    private let universeNode = Universe.makeNode()
    /// One galaxy unit (1,000 ly) in orrery world units. Sized so the disk dwarfs Eris's orbit
    /// (radius ~240) without leaving the starfield shell or the camera's zFar.
    private static let galaxyScale = 8.0
    /// One Local Group unit (50,000 ly) in world units. Deliberately SMALLER than the volumetric
    /// galaxy's own scale implies (its portrait shrinks ~2.8× in the handoff): the receding
    /// camera plus the shrink is what reads as continued zoom, and true scale would put
    /// Andromeda beyond zFar. Same schematic-distances-enlarged-diameters deal as the web.
    private static let localGroupScale = 30.0
    /// Cosmic-web local half-extent 60 × 14 = 840 world units: large enough to swallow the Local
    /// Group portrait while the 2,100-unit final vantage still fits comfortably inside zFar 5000.
    private static let universeScale = 14.0
    /// The finale renders a full-screen raymarch; the rest of the app renders spheres. Two
    /// hardware measures on a real Apple TV drive what happens here (see git history for the
    /// [perf] traces): the volume is fill-bound, so for the finale's duration the view drops to
    /// half resolution (4× fewer marched pixels — soft glow plus motion plus bloom hide it on a
    /// TV, and the SwiftUI caption is not part of this view) and caps at cinema pacing so the
    /// headroom becomes steadiness. Both restored on exit. And the first draw of a hidden
    /// SCNProgram node compiles its Metal pipeline and uploads its textures — a 300–430 ms hitch
    /// if it happens the frame the finale unhides — so attach() pre-warms all finale nodes.
    private weak var sceneView: SCNView?
    private var nominalScale: CGFloat = 0
    func attach(view: SCNView) {
        sceneView = view
        nominalScale = view.contentScaleFactor
        view.prepare([galaxyNode, localGroupNode, universeNode], completionHandler: nil)
    }
    /// A shuffle bag of fact indices per body, and the last one played. Every fact is handed out
    /// once in random order before any repeats, then the bag reshuffles — with no fact landing
    /// twice in a row across the reshuffle. Mirrors the web app's ShuffleBag: random each cycle,
    /// but full coverage, so a child eventually hears all of them rather than the same few.
    private var factBags: [String: [Int]] = [:]
    private var lastFact: [String: Int] = [:]
    /// Chosen when the flight starts, delivered on arrival. The body and index travel with the text
    /// so the spoken clip and the shown card can never drift apart — and so a deep-dive can speak a
    /// moon rather than whatever world the ambient tour last touched.
    private var pendingLine: (text: String, index: Int, body: Body)?
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
        // Populated only in a deep-dive, where there's time to read stats off the card.
        var width: String? = nil
        var day: String? = nil
        var year: String? = nil
        var isMoon: Bool = false
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
        addMoons()
        addCamera()
        addGalaxy()
        addUniverse()

        featured = tour.compactMap { name in
            (catalog.planets + catalog.dwarfs).first { $0.name == name }
        }
        #if DEBUG
        // Start the loop at Eris so the galaxy finale is seconds away, not a full tour away.
        // Verification-only, like HELIOS_MUTE.
        if ProcessInfo.processInfo.environment["HELIOS_FINALE"] != nil { featuredIndex = featured.count - 1 }
        #endif
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

    /// The galaxy is parked in the scene from the start, hidden, positioned so its Sun-point
    /// (galaxy-local azimuth 90°, radius 26) lands exactly on the orrery's origin. The Sun node is
    /// deliberately NOT faded during the finale: at this scale it reads as a single blooming dot
    /// sitting on the Orion Spur — the "everything you saw is a dot here" the narration points at.
    private func addGalaxy() {
        let s = Self.galaxyScale
        galaxyNode.simdScale = SIMD3<Float>(repeating: Float(s))
        galaxyNode.simdPosition = SIMD3<Float>(-Galaxy.sunLocal * s)
        scene.rootNode.addChildNode(galaxyNode)

        // The Local Group container is placed so its Milky Way portrait sits exactly on the
        // volumetric galaxy — the finale crossfades one for the other mid-recession.
        if let galaxies = catalog.localGroup,
           let home = galaxies.first(where: { $0.id == "milky-way" }) {
            localGroupNode = Galaxy.localGroupNode(galaxies, unitsPerLG: Self.localGroupScale)
            let homeOffset = SIMD3<Double>(home.position[0], home.position[1], home.position[2]) * Self.localGroupScale
            localGroupNode.simdPosition = galaxyNode.simdPosition - SIMD3<Float>(homeOffset)
            scene.rootNode.addChildNode(localGroupNode)
        }
    }

    /// Universe-local origin is our Local Group. Park it on the Milky Way portrait's world
    /// position so the crossfade preserves the one point the viewer already knows.
    private func addUniverse() {
        universeNode.simdScale = SIMD3<Float>(repeating: Float(Self.universeScale))
        universeNode.simdPosition = galaxyNode.simdPosition
        scene.rootNode.addChildNode(universeNode)
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

    // MARK: - Moons
    //
    // Moons exist only for the deep-dive, and only their parent's family is ever visible at once.
    // Their spacing is deliberately compressed, not physical — at true scale a moon would be an
    // invisible speck hard against its planet — exactly as the web atlas does it (see CLAUDE.md).
    // A per-parent group tracks the planet's position but NOT its spin, so the moons orbit cleanly
    // instead of being flung around by the planet's axial rotation.
    private var moonsByParent: [String: [Body]] = [:]
    private var moonNodes: [String: SCNNode] = [:]
    private var moonGroups: [String: SCNNode] = [:]

    private func addMoons() {
        moonsByParent = Dictionary(grouping: catalog.moons) { $0.moon?.parent ?? "" }

        for (parent, moons) in moonsByParent {
            let group = SCNNode()
            group.isHidden = true
            scene.rootNode.addChildNode(group)
            moonGroups[parent] = group

            for moon in moons {
                let geometry = SCNSphere(radius: CGFloat(moon.radius))
                geometry.segmentCount = 28
                let material = geometry.firstMaterial!
                material.lightingModel = .physicallyBased
                // Only Earth's Moon has a real map; the rest are honest colour approximations.
                material.diffuse.contents = texture(for: moon) ?? UIColor(hex: moon.color)
                material.roughness.contents = 0.95
                material.emission.contents = UIColor(hex: moon.color)
                material.emission.intensity = 0.05  // a touch of self-light so far-out moons still read

                let node = SCNNode(geometry: geometry)
                node.name = moon.name
                node.runAction(.repeatForever(.rotate(by: .pi * 2, around: SCNVector3(0, 1, 0), duration: 30)))
                group.addChildNode(node)
                moonNodes[moon.name] = node
            }
        }
    }

    /// Compressed orbit radius: pushes each moon out from the planet's surface by a fixed step, so
    /// a whole family is legible at once. Same formula as the web atlas's compactMoonOrbitRadius.
    private func compactMoonRadius(_ moon: Body) -> Double {
        guard let parent = catalog.planets.first(where: { $0.name == moon.moon?.parent })
            ?? catalog.dwarfs.first(where: { $0.name == moon.moon?.parent }) else { return moon.radius * 3 }
        let family = moonsByParent[moon.moon!.parent] ?? []
        let index = family.firstIndex { $0.name == moon.name } ?? 0
        let largest = family.map(\.radius).max() ?? moon.radius
        let inner = parent.radius + largest + 0.7
        let spacing = max(0.7, largest * 1.45)
        return inner + Double(index) * spacing
    }

    /// A moon's offset from its parent's centre: a circular orbit read off a stored phase, tilted
    /// by the moon's inclination. Display-only — never a solved ellipse.
    private func moonLocalPosition(_ moon: Body, at date: Date) -> SIMD3<Double> {
        let data = moon.moon!
        let turns = date.timeIntervalSince(Orbits.j2000) / 86400 / data.periodDays
        let angle = 2 * .pi * (data.phase + ((data.retrograde ?? false) ? -turns : turns))
        let tilt = Orbits.deg(data.inclination), r = compactMoonRadius(moon)
        return SIMD3(cos(angle) * r, sin(angle) * r * sin(tilt), sin(angle) * r * cos(tilt))
    }

    /// Show only this parent's moon family (nil hides all). Called on entering/leaving a deep-dive.
    private func showMoonFamily(_ parent: String?) {
        for (name, group) in moonGroups { group.isHidden = (name != parent) }
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

    /// Stable clip name for a narration line — spaces become hyphens ("Milky Way" → milky-way),
    /// matching scripts/render-narration.mjs. The audit and the players must never disagree.
    private static func clipID(_ name: String, _ index: Int) -> String {
        "narration-\(name.lowercased().replacingOccurrences(of: " ", with: "-"))-\(index)"
    }

    /// A missing clip does not crash — it quietly downgrades to the robot voice, which looks and
    /// behaves like a perfectly healthy app. That is exactly how the first render shipped zero of
    /// its 73 clips without anyone noticing. So count them, out loud.
    private func auditNarrationClips() {
        var found = 0, expected = 0
        for (name, lines) in catalog.narration {
            for index in lines.indices {
                expected += 1
                let id = Self.clipID(name, index)
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

        // Only the visible family moves — the rest are hidden, so positioning them would be waste.
        if let parent = deepParent, let group = moonGroups[parent], !group.isHidden {
            group.simdPosition = bodyNodes[parent]?.simdPosition ?? group.simdPosition
            for moon in moonsByParent[parent] ?? [] {
                moonNodes[moon.name]?.simdPosition = SIMD3<Float>(moonLocalPosition(moon, at: date))
            }
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
        // card is actually up. Mid-flight there is deliberately no card to refresh, and the
        // galaxy card must not be overwritten with the world the tour last touched.
        if caption != nil, finale == .none, let body = currentBody, !live || isScrubbing {
            caption = makeCaption(for: body, at: date)
        }

        // In a deep-dive the tour is paused, but the family still auto-walks: planet, then each
        // moon, then round again — so a world left on screen slowly shows you its whole system.
        if inDeepDive {
            guard !isScrubbing, flight == nil, time >= nextChangeAt else { return }
            deepStep(by: 1)
            return
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

    // MARK: - Deep-dive
    //
    // Select on a world stops the outward tour and drops into that world's *system* — the planet
    // and each of its moons in turn, with expanded stats. It auto-walks the family; Up/Down step it
    // by hand; Menu leaves. `deepParent` is the anchor (nil = ambient tour is running).
    private var deepParent: String?
    private var deepFamily: [Body] = []
    private var deepIndex = 0
    var inDeepDive: Bool { deepParent != nil }

    /// Whole-family overview position for the planet; parent-centre-plus-offset for a moon.
    private func deepTargetPosition(_ body: Body, at date: Date) -> SIMD3<Double> {
        guard body.name != deepParent else { return displayPosition(body, at: date) }
        let parentName = body.moon?.parent ?? deepParent ?? ""
        let parent = (catalog.planets + catalog.dwarfs).first { $0.name == parentName }
        return (parent.map { displayPosition($0, at: date) } ?? .zero) + moonLocalPosition(body, at: date)
    }

    /// Wide enough to hold the whole moon family when looking at the planet; close on a single moon.
    private func deepVantage(for body: Body, at target: SIMD3<Double>) -> SIMD3<Double> {
        let outward = simd_length(target) > 1 ? simd_normalize(target) : SIMD3<Double>(0, 1, 0)
        let tangent = simd_normalize(simd_cross(outward, SIMD3<Double>(0, 1, 0)))
        if body.name == deepParent {
            let outer = (moonsByParent[body.name] ?? []).map { compactMoonRadius($0) }.max() ?? (body.radius * 3)
            let radius = max(outer * 1.9, body.radius * 6)
            return target + tangent * radius + SIMD3(0, radius * 0.4, 0) - outward * (radius * 0.2)
        }
        // A moon: view it from the SIDE — perpendicular to the planet-moon line — so the planet
        // sits off to one edge of the frame instead of filling the background, and the camera stays
        // well clear of the planet's surface (sitting "between" them put it right up against giant
        // Jupiter for the outer moons). The moon reads as a lit disc against mostly stars.
        let parent = (catalog.planets + catalog.dwarfs).first { $0.name == deepParent }
        let parentPos = parent.map { displayPosition($0, at: displayDate) } ?? .zero
        let toMoon = simd_length(target - parentPos) > 0.001 ? simd_normalize(target - parentPos) : outward
        var side = simd_cross(toMoon, SIMD3<Double>(0, 1, 0))
        side = simd_length(side) > 0.001 ? simd_normalize(side) : tangent
        let dist = body.radius * 7 + 2
        return target + side * dist + SIMD3(0, dist * 0.4, 0)
    }

    private func flyToDeepTarget() {
        guard deepFamily.indices.contains(deepIndex) else { return }
        let body = deepFamily[deepIndex], date = displayDate
        let target = deepTargetPosition(body, at: date)
        flyTo(body: body, target: target, vantage: deepVantage(for: body, at: target))
    }

    // MARK: - Input

    func beginScrub() {
        cancelFinale()
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

    /// Left / Right step between worlds. If a deep-dive is open it closes first, so the arrows
    /// always mean the same thing: move through the solar system.
    func step(by delta: Int) {
        guard !featured.isEmpty else { return }
        cancelFinale()
        if inDeepDive { showMoonFamily(nil); deepParent = nil; deepFamily = [] }
        narrator.stop()
        audio.setNarrating(false)
        ambientPaused = true
        lastInteractionAt = lastFrameAt
        featuredIndex = ((featuredIndex + delta) % featured.count + featured.count) % featured.count
        flyToCurrent(at: displayDate)
    }

    /// Select drops into a deep-dive on the world in focus: its moons appear and the camera pulls
    /// back to hold the whole system, then walks the family reading each one's fact.
    func enterDeepDive() {
        guard !inDeepDive, let body = currentBody else { return }
        cancelFinale()
        narrator.stop()
        audio.setNarrating(false)
        ambientPaused = true
        deepParent = body.name
        deepFamily = [body] + (moonsByParent[body.name] ?? [])
        deepIndex = 0
        showMoonFamily(body.name)
        // Position the family this instant so the first flight aims true, not a frame stale.
        if let group = moonGroups[body.name] {
            group.simdPosition = bodyNodes[body.name]?.simdPosition ?? group.simdPosition
            for moon in deepFamily.dropFirst() { moonNodes[moon.name]?.simdPosition = SIMD3<Float>(moonLocalPosition(moon, at: displayDate)) }
        }
        lastInteractionAt = lastFrameAt
        flyToDeepTarget()
    }

    /// Menu / Back leaves the deep-dive and resumes the ambient tour where it left off.
    func exitDeepDive() {
        guard inDeepDive else { return }
        narrator.stop()
        audio.setNarrating(false)
        showMoonFamily(nil)
        deepParent = nil
        deepFamily = []
        ambientPaused = false
        lastInteractionAt = lastFrameAt
        nextChangeAt = lastFrameAt + resumeHold
        flyToCurrent(at: displayDate)
    }

    /// Up / Down walk the family — planet, then each moon — by hand.
    func deepStep(by delta: Int) {
        guard inDeepDive, !deepFamily.isEmpty else { return }
        narrator.stop()
        audio.setNarrating(false)
        deepIndex = ((deepIndex + delta) % deepFamily.count + deepFamily.count) % deepFamily.count
        lastInteractionAt = lastFrameAt
        flyToDeepTarget()
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
        // Each dwell advances one scale: Milky Way → Local Group → cosmic web → home.
        if finale == .dwelling { beginLocalGroup(); return }
        if finale == .dwellingLocal { beginUniverse(); return }
        if finale == .dwellingUniverse { endFinale(); return }
        // Eris was the last world. Before wrapping to the Sun, pull back and show where all of it lives.
        if finale == .none, !featured.isEmpty, featuredIndex == featured.count - 1 { beginFinale(); return }
        featuredIndex = (featuredIndex + 1) % featured.count
        flyToCurrent(at: date)
    }

    // MARK: - Finale beats

    private func beginFinale() {
        finale = .flying
        narrator.stop()
        audio.setNarrating(false)
        pendingLine = nil
        caption = nil
        sceneView?.preferredFramesPerSecond = 30
        if nominalScale > 0 { sceneView?.contentScaleFactor = nominalScale * 0.5 }
        setSystemFaded(true, duration: 3)
        galaxyNode.removeAllActions()
        galaxyNode.isHidden = false
        // The camera starts INSIDE the volume, so the fade-in reads as the sky itself turning
        // milky before the pull-back reveals what that milk is. Slightly slower than the system
        // fade, so the planets are gone before the galaxy fully arrives.
        galaxyNode.runAction(.fadeIn(duration: 5))

        let center = SIMD3<Double>(galaxyNode.simdPosition)
        let from = SIMD3<Double>(cameraNode.simdPosition)
        // Framing: disk radius is 56·scale; at 46° fov the whole disk wants ~2.4× that distance,
        // approached from ~37° above the plane — the web atlas's "tilted" vantage.
        let vantage = center + SIMD3<Double>(0, 56 * Self.galaxyScale * 1.6, 56 * Self.galaxyScale * 2.1)
        let travel = simd_distance(from, vantage)
        // One long unhurried recession — deliberately past flyTo's 15s ceiling; this is the beat
        // the whole loop has been building to and it must not feel rushed.
        let midpoint = (from + vantage) * 0.5
        let control = midpoint + SIMD3<Double>(0, travel * 0.18, 0)
        flight = Flight(from: from, control: control, to: vantage,
                        aimFrom: SIMD3<Double>(focusTarget.simdPosition), aimTo: center,
                        start: lastFrameAt, duration: 18)
        flightEndsAt = lastFrameAt + 18
        nextChangeAt = flightEndsAt + Self.maxDwell
    }

    /// The camera has settled on the full disk. Speak one Milky Way line, card and voice together.
    private func finaleArrive() {
        finale = .dwelling
        let (text, index) = nextLine(name: "Milky Way",
                                     fallback: "This is the Milky Way, our galaxy. Every star you have ever seen lives in here.")
        caption = Caption(name: "THE MILKY WAY", kind: "Barred spiral galaxy · home",
                          distance: "The Sun is 26,000 light-years from its centre", fact: text)
        audio.setNarrating(true)
        narrator.speak(text, clipID: Self.clipID("Milky Way", index)) { [weak self] in
            guard let self else { return }
            self.audio.setNarrating(false)
            self.nextChangeAt = self.lastFrameAt + Self.pauseAfterNarration
        }
    }

    /// The Milky Way dwell is over: recede again until the neighbours appear. The volume hands
    /// off to the flat portrait inside the Local Group node mid-flight — at this distance the
    /// swap is invisible, and it frees the whole raymarch budget for the rest of the beat.
    private func beginLocalGroup() {
        guard localGroupNode.parent != nil, !localGroupNode.childNodes.isEmpty,
              let galaxies = catalog.localGroup,
              let andromeda = galaxies.first(where: { $0.id == "andromeda" }) else { endFinale(); return }
        finale = .flyingLocal
        caption = nil
        galaxyNode.removeAllActions()
        galaxyNode.runAction(.sequence([.fadeOut(duration: 5), .hide()]))
        localGroupNode.removeAllActions()
        localGroupNode.isHidden = false
        localGroupNode.runAction(.fadeIn(duration: 5))

        let home = SIMD3<Double>(galaxyNode.simdPosition)
        let other = SIMD3<Double>(localGroupNode.simdPosition)
            + SIMD3<Double>(andromeda.position[0], andromeda.position[1], andromeda.position[2]) * Self.localGroupScale
        let centroid = (home + other) * 0.5
        // Far enough back that both great spirals sit in frame with air around them.
        let vantage = centroid + SIMD3<Double>(0, 0.5547, 0.8321) * (simd_distance(home, other) * 1.5)
        let from = SIMD3<Double>(cameraNode.simdPosition)
        let midpoint = (from + vantage) * 0.5
        let control = midpoint + SIMD3<Double>(0, simd_distance(from, vantage) * 0.12, 0)
        flight = Flight(from: from, control: control, to: vantage,
                        aimFrom: SIMD3<Double>(focusTarget.simdPosition), aimTo: centroid,
                        start: lastFrameAt, duration: 14)
        flightEndsAt = lastFrameAt + 14
        nextChangeAt = flightEndsAt + Self.maxDwell
    }

    /// Both great spirals in frame. One Andromeda line, card and voice together.
    private func localGroupArrive() {
        finale = .dwellingLocal
        let (text, index) = nextLine(name: "Local Group",
                                     fallback: "Our galaxy lives in a small family of galaxies called the Local Group.")
        caption = Caption(name: "THE LOCAL GROUP", kind: "Our family of galaxies",
                          distance: "Andromeda is 2.5 million light-years away", fact: text)
        audio.setNarrating(true)
        narrator.speak(text, clipID: Self.clipID("Local Group", index)) { [weak self] in
            guard let self else { return }
            self.audio.setNarrating(false)
            self.nextChangeAt = self.lastFrameAt + Self.pauseAfterNarration
        }
    }

    /// The Local Group dwell is over: one last pull-back until its portrait becomes the origin of
    /// the resolved-galaxy census and the filaments of the cosmic web surround everything.
    private func beginUniverse() {
        guard universeNode.parent != nil else { endFinale(); return }
        finale = .flyingUniverse
        caption = nil
        localGroupNode.removeAllActions()
        localGroupNode.runAction(.sequence([.fadeOut(duration: 5), .hide()]))
        universeNode.removeAllActions()
        universeNode.isHidden = false
        universeNode.runAction(.fadeIn(duration: 5))

        let center = SIMD3<Double>(universeNode.simdPosition)
        // As far back as the geometry allows: the CMB wall sits at 172×14 ≈ 2,408 world units and
        // the camera must stay inside it — the beat needs the web to read as a thing with edges.
        let vantage = center + SIMD3<Double>(0, 0.5547, 0.8321) * 2_280
        let from = SIMD3<Double>(cameraNode.simdPosition)
        let travel = simd_distance(from, vantage)
        let midpoint = (from + vantage) * 0.5
        let control = midpoint + SIMD3<Double>(0, travel * 0.12, 0)
        flight = Flight(from: from, control: control, to: vantage,
                        aimFrom: SIMD3<Double>(focusTarget.simdPosition), aimTo: center,
                        start: lastFrameAt, duration: 16)
        flightEndsAt = lastFrameAt + 16
        nextChangeAt = flightEndsAt + Self.maxDwell
    }

    /// The complete web is in frame. One universe line lands before the existing home transition.
    private func universeArrive() {
        finale = .dwellingUniverse
        let (text, index) = nextLine(name: "Universe",
                                     fallback: "Galaxies gather along a cosmic web, with immense dark voids between its glowing filaments.")
        caption = Caption(name: "THE COSMIC WEB", kind: "The observable universe",
                          distance: "Every point of light is an entire galaxy", fact: text)
        audio.setNarrating(true)
        narrator.speak(text, clipID: Self.clipID("Universe", index)) { [weak self] in
            guard let self else { return }
            self.audio.setNarrating(false)
            self.nextChangeAt = self.lastFrameAt + Self.pauseAfterNarration
        }
    }

    private func endFinale() {
        finale = .none
        caption = nil
        sceneView?.preferredFramesPerSecond = 60
        if nominalScale > 0 { sceneView?.contentScaleFactor = nominalScale }
        galaxyNode.removeAllActions()
        galaxyNode.runAction(.sequence([.fadeOut(duration: 3), .hide()]))
        localGroupNode.removeAllActions()
        localGroupNode.runAction(.sequence([.fadeOut(duration: 3), .hide()]))
        universeNode.removeAllActions()
        universeNode.runAction(.sequence([.fadeOut(duration: 3), .hide()]))
        setSystemFaded(false, duration: 3)
        featuredIndex = 0
        flyToCurrent(at: displayDate)
    }

    /// Any interaction mid-finale bails out fast: the user reached for the remote to *do*
    /// something, and the solar system must be back before their input lands on it.
    private func cancelFinale() {
        guard finale != .none else { return }
        finale = .none
        sceneView?.preferredFramesPerSecond = 60
        if nominalScale > 0 { sceneView?.contentScaleFactor = nominalScale }
        galaxyNode.removeAllActions()
        galaxyNode.runAction(.sequence([.fadeOut(duration: 0.6), .hide()]))
        localGroupNode.removeAllActions()
        localGroupNode.runAction(.sequence([.fadeOut(duration: 0.6), .hide()]))
        universeNode.removeAllActions()
        universeNode.runAction(.sequence([.fadeOut(duration: 0.6), .hide()]))
        setSystemFaded(false, duration: 0.8)
    }

    /// Fades every orbit line and every body except the Sun (see `addGalaxy`). Fade actions run
    /// alongside the permanent rotation actions, so nothing here may removeAllActions().
    private func setSystemFaded(_ faded: Bool, duration: TimeInterval) {
        for (name, node) in bodyNodes where name != "Sun" {
            node.runAction(faded ? .fadeOut(duration: duration) : .fadeIn(duration: duration))
        }
        for node in orbitNodes.values {
            node.runAction(faded ? .fadeOut(duration: duration) : .fadeIn(duration: duration))
        }
    }

    private func flyToCurrent(at date: Date) {
        guard let body = currentBody, let node = bodyNodes[body.name] else { return }
        flyTo(body: body, target: SIMD3<Double>(node.simdPosition), vantage: vantagePoint(for: body, at: SIMD3<Double>(node.simdPosition)))
    }

    /// Sets up a camera flight to a body and queues its narration for arrival. Shared by the
    /// ambient tour and the deep-dive so both bow the path, ease the aim, and speak-on-arrival
    /// identically.
    private func flyTo(body: Body, target: SIMD3<Double>, vantage: SIMD3<Double>) {
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
        let (text, index) = nextLine(for: body)
        pendingLine = (text: text, index: index, body: body)

        // The card goes with the voice, so it fades out for the journey and returns on arrival.
        // Leaving it up would park text on screen that nothing is reading.
        caption = nil

        // Safety ceiling, replaced the moment the voice reports back.
        nextChangeAt = flightEndsAt + Self.maxDwell
    }

    /// The next fact for this body, drawn at random from its shuffle bag, with its index.
    private func nextLine(for body: Body) -> (text: String, index: Int) {
        nextLine(name: body.name, fallback: body.fact)
    }

    /// Name-keyed so the finale can draw from the "Milky Way" bag, which has no Body behind it.
    private func nextLine(name: String, fallback: String) -> (text: String, index: Int) {
        let lines = catalog.narration[name] ?? []
        guard lines.count > 1 else { return (lines.first ?? fallback, 0) }

        var bag = factBags[name] ?? []
        if bag.isEmpty {
            bag = Array(0..<lines.count).shuffled()
            // Don't let the reshuffle repeat the fact we just ended on.
            if let last = lastFact[name], bag.first == last, bag.count > 1 { bag.swapAt(0, 1) }
        }
        let index = bag.removeFirst()
        factBags[name] = bag
        lastFact[name] = index
        return (lines[index], index)
    }

    /// The camera has landed. Now show the card and say the words, together, as one beat.
    private func arrive() {
        guard let pending = pendingLine else { return }
        pendingLine = nil

        caption = makeCaption(for: pending.body, at: displayDate, line: pending.text, detailed: inDeepDive)

        audio.setNarrating(true)
        narrator.speak(pending.text, clipID: Self.clipID(pending.body.name, pending.index)) { [weak self] in
            guard let self else { return }
            self.audio.setNarrating(false)
            self.nextChangeAt = self.lastFrameAt + Self.pauseAfterNarration
        }
    }

    private func flyCamera(at time: TimeInterval) {
        guard let flight else {
            // Dwelling on the galaxy: the vantage is fixed in space, so there is no station to
            // hold — easing back toward Eris here would drag the disk off screen mid-narration.
            guard finale == .none else { return }
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
            switch finale {
            case .flying: finaleArrive()
            case .flyingLocal: localGroupArrive()
            case .flyingUniverse: universeArrive()
            default: arrive()
            }
        }
    }

    /// The card shows the words that are being spoken, so a reading adult can follow along with a
    /// child who cannot. Same sentence, two ways in.
    private func makeCaption(for body: Body, at date: Date, line: String? = nil, detailed: Bool = false) -> Caption {
        let when = isLive ? "right now" : "on \(Self.captionDate.string(from: date))"
        // A moon's "distance" is from its planet; everything else is from the Sun.
        let distance: String
        if let orbit = body.moon {
            distance = "\(Self.grouped(orbit.orbitKm)) km from \(orbit.parent)"
        } else if body.name == "Sun" {
            distance = "The centre of everything"
        } else {
            let au = Orbits.heliocentricDistanceAU(body, at: date)
            distance = String(format: au < 2 ? "%.3f AU from the Sun, %@" : "%.2f AU from the Sun, %@", au, when)
        }

        var caption = Caption(name: body.name.uppercased(), kind: body.kind, distance: distance,
                              fact: line ?? self.caption?.fact ?? body.fact, isMoon: body.moon != nil)
        if detailed {
            caption.width = "\(Self.grouped(body.radiusKm * 2)) km across"
            caption.day = body.day
            caption.year = body.year
        }
        return caption
    }

    private static func grouped(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(Int(value))
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
