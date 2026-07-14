import XCTest


/// Pins the Swift solver to golden values generated from the TypeScript implementation,
/// which `tests/orbits.test.mjs` in turn pins to a bracketed reference solver that cannot
/// diverge.
///
/// Chain of custody: bisection oracle → orbits.ts → orbit-goldens.json → Orbits.swift.
///
/// This exists because a hand-rolled Kepler solver is exactly where the near-parabolic
/// divergence bug gets reintroduced. "I ported it and it looks right on screen" is precisely
/// the standard that let NEOWISE sit 700 AU from its true position in the web app for as
/// long as the feature existed.
final class OrbitsTests: XCTestCase {

    private struct Goldens: Decodable {
        struct Position: Decodable { let name: String; let date: String; let x: Double; let y: Double; let z: Double }
        struct Solver: Decodable { let e: Double; let meanAnomaly: Double; let eccentricAnomaly: Double }
        let positions: [Position]
        let solver: [Solver]
    }

    private var goldens: Goldens!
    private var bodiesByName: [String: Body] = [:]

    override func setUpWithError() throws {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(bundle.url(forResource: "orbit-goldens", withExtension: "json"),
                                "orbit-goldens.json missing — run `npm run catalog`")
        goldens = try JSONDecoder().decode(Goldens.self, from: Data(contentsOf: url))

        let catalog = Catalog.load(from: bundle)
        for body in catalog.planets + catalog.dwarfs + catalog.smallBodies { bodiesByName[body.name] = body }
    }

    private func date(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return try XCTUnwrap(formatter.date(from: "\(value)T12:00:00Z"))
    }

    /// The near-parabolic comets are the entire reason this file exists. If they ever drop out
    /// of the goldens, the solver's hardest case stops being covered and these tests go quiet
    /// while still passing — the worst possible failure.
    func testGoldensCoverTheNearParabolicRegime() {
        XCTAssertGreaterThanOrEqual(goldens.solver.filter { $0.e > 0.99 }.count, 12,
                                    "goldens should exercise eccentricities above 0.99")
        XCTAssertTrue(goldens.positions.contains { $0.name == "NEOWISE" },
                      "NEOWISE (e=0.9992) should be in the goldens")
    }

    func testSolverMatchesTypeScript() {
        for sample in goldens.solver {
            let actual = Orbits.solveKepler(e: sample.e, m: sample.meanAnomaly)
            XCTAssertEqual(actual, sample.eccentricAnomaly, accuracy: 1e-9,
                           "solveKepler(e: \(sample.e), M: \(sample.meanAnomaly)) diverged from the TypeScript solver")
        }
    }

    /// Kepler's equation must actually hold. This does not depend on the goldens being right,
    /// only on the maths being satisfied, so it is an independent check on the same code.
    func testSolvedAnomaliesSatisfyKeplersEquation() {
        for sample in goldens.solver {
            let e = Orbits.solveKepler(e: sample.e, m: sample.meanAnomaly)
            let residual = abs(e - sample.e * sin(e) - sample.meanAnomaly)
            XCTAssertLessThan(residual, 1e-9, "residual \(residual) rad at e=\(sample.e)")
        }
    }

    func testHeliocentricPositionsMatchTypeScript() throws {
        for golden in goldens.positions {
            let body = try XCTUnwrap(bodiesByName[golden.name], "\(golden.name) missing from the catalog")
            let actual = Orbits.heliocentricPosition(body, at: try date(golden.date))
            // Tight in absolute AU: at Sedna's 544 AU a loose relative tolerance would hide a
            // real divergence, and the failure this guards against was hundreds of AU wide.
            XCTAssertEqual(actual.x, golden.x, accuracy: 1e-9, "\(golden.name) x on \(golden.date)")
            XCTAssertEqual(actual.y, golden.y, accuracy: 1e-9, "\(golden.name) y on \(golden.date)")
            XCTAssertEqual(actual.z, golden.z, accuracy: 1e-9, "\(golden.name) z on \(golden.date)")
        }
    }

    /// A bound body can never travel outside its own apoapsis. Cheap, and it catches the whole
    /// class of "the solver returned something plausible-looking but wrong" failures.
    func testBodiesStayWithinTheirOwnOrbits() throws {
        for (name, body) in bodiesByName {
            guard body.elements != nil || body.smallBody != nil else { continue }
            for year in stride(from: 1800, through: 2050, by: 10) {
                let when = try date("\(year)-06-01")
                let p = Orbits.params(for: body, at: when)
                let r = Orbits.heliocentricDistanceAU(body, at: when)
                XCTAssertLessThanOrEqual(r, p.a * (1 + p.e) + 1e-6, "\(name) outside its apoapsis in \(year)")
                XCTAssertGreaterThanOrEqual(r, p.a * (1 - p.e) - 1e-6, "\(name) inside its periapsis in \(year)")
            }
        }
    }

    /// The catalog is generated from app/bodies.ts, so this is really asserting the generator
    /// ran and the JSON reached the bundle.
    func testCatalogLoaded() {
        XCTAssertEqual(bodiesByName["Earth"]?.radiusKm, 6371)
        XCTAssertNotNil(bodiesByName["Pluto"]?.smallBody)
        XCTAssertNotNil(bodiesByName["Jupiter"]?.elements)
    }
}
