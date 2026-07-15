import Foundation

/// Mirrors the `Planet` type in `app/bodies.ts`. The JSON is generated from that file by
/// `scripts/emit-catalog.mjs`, so this app never carries its own transcription of the JPL
/// element tables — two hand-maintained copies is how the web and the TV quietly start
/// disagreeing about where Pluto is.
struct Body: Decodable {
    struct Elements: Decodable {
        let base: [Double]
        let rate: [Double]
    }

    struct SmallBody: Decodable {
        let epochJD: Double
        let a: Double
        let e: Double
        let i: Double
        let node: Double
        let peri: Double
        let meanAnomaly: Double
        let meanMotion: Double
    }

    /// A moon's orbit around its parent. These are display-only approximations — a circular orbit
    /// from a stored phase, at deliberately compressed spacing — exactly as the web atlas does it,
    /// so a moon stays visible next to its planet instead of vanishing at true scale.
    struct MoonOrbit: Decodable {
        let parent: String
        let orbitKm: Double
        let periodDays: Double
        let inclination: Double
        let phase: Double
        let retrograde: Bool?
    }

    let name: String
    let kind: String
    let color: String
    let accent: String
    let radiusKm: Double
    let radius: Double
    let distanceAU: Double
    let year: String
    let day: String
    let fact: String
    let elements: Elements?
    let smallBody: SmallBody?
    let moon: MoonOrbit?
}

struct Catalog: Decodable {
    let planets: [Body]
    let dwarfs: [Body]
    let moons: [Body]
    let smallBodies: [Body]
    /// Kid-facing lines, several per body, spoken aloud. Written for the ear — see app/bodies.ts.
    let narration: [String: [String]]

    /// The Sun is `planets[0]` and carries no elements — it sits at the origin.
    var sun: Body { planets[0] }
    /// What the ambient scene draws in orbit: the eight planets plus the five dwarfs.
    var orbiting: [Body] { Array(planets.dropFirst()) + dwarfs }

    static func load(from bundle: Bundle = .main) -> Catalog {
        guard let url = bundle.url(forResource: "bodies", withExtension: "json", subdirectory: "Media")
                        ?? bundle.url(forResource: "bodies", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(Catalog.self, from: data)
        else {
            fatalError("bodies.json missing from the bundle — run `npm run catalog`")
        }
        return catalog
    }
}
