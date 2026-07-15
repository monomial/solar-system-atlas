import Foundation

/// Two-body orbital math. A direct port of `app/orbits.ts` from the web atlas.
///
/// Deliberately free of SceneKit and UIKit, exactly as the TypeScript original is free of
/// Three.js and the DOM: this is the one part of the app where a wrong answer is
/// indistinguishable from a right one on screen, so it has to be testable in isolation.
///
/// `HeliosTVTests/OrbitsTests.swift` pins this against golden values generated from the
/// TypeScript implementation, which is itself pinned to a bracketed reference solver.
enum Orbits {

    static func deg(_ v: Double) -> Double { v * .pi / 180 }
    static func norm(_ v: Double) -> Double { (v.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) }

    /// J2000 epoch, 2000-01-01T12:00:00Z. Used by the planet math and by the moons' phase clock.
    static let j2000 = Date(timeIntervalSince1970: 946_728_000)
    private static let jdAtUnixEpoch = 2_440_587.5

    /// `(a, e, inclination, meanAnomaly, node, argOfPerihelion)` — a in AU, angles in degrees.
    static func params(for body: Body, at date: Date) -> (a: Double, e: Double, i: Double, m: Double, node: Double, peri: Double) {
        if let o = body.smallBody {
            let jd = date.timeIntervalSince1970 / 86400 + jdAtUnixEpoch
            return (o.a, o.e, o.i, norm(o.meanAnomaly + o.meanMotion * (jd - o.epochJD)), o.node, o.peri)
        }
        guard let elements = body.elements else { return (0, 0, 0, 0, 0, 0) }
        let centuries = date.timeIntervalSince(j2000) / 86400 / 36525
        let v = (0..<6).map { elements.base[$0] + elements.rate[$0] * centuries }
        let (a, e, inc, meanLongitude, longPeri, node) = (v[0], v[1], v[2], v[3], v[4], v[5])
        return (a, e, inc, norm(meanLongitude - longPeri), node, longPeri - node)
    }

    /// Solves Kepler's equation `E - e·sin(E) = M` for the eccentric anomaly.
    ///
    /// Uses a Danby starter with Halley iteration, **not** Newton starting from `E = M`.
    /// This is not a stylistic choice. Newton-from-M diverges as eccentricity approaches 1:
    /// the derivative `1 - e·cos(E)` collapses toward zero near perihelion and Newton lands
    /// on the wrong root. It does not throw and does not produce NaN — it silently returns a
    /// confident wrong answer. In the web atlas that put NEOWISE (e=0.9992) hundreds of AU
    /// from its true position for a quarter of the supported date range, undetected, for as
    /// long as the feature existed.
    ///
    /// If you change this, run OrbitsTests. The failure mode is invisible on screen.
    static func solveKepler(e: Double, m: Double) -> Double {
        var eccentric = m + 0.85 * e * (sin(m) < 0 ? -1 : 1)
        for _ in 0..<60 {
            let f = eccentric - e * sin(eccentric) - m
            let f1 = 1 - e * cos(eccentric)
            let f2 = e * sin(eccentric)
            let step = -f / (f1 - f * f2 / (2 * f1))
            guard step.isFinite else { break }
            eccentric += step
            if abs(step) < 1e-12 { break }
        }
        return eccentric
    }

    private static func point(_ p: (a: Double, e: Double, i: Double, m: Double, node: Double, peri: Double), _ eccentric: Double) -> SIMD3<Double> {
        let xp = p.a * (cos(eccentric) - p.e)
        let yp = p.a * (1 - p.e * p.e).squareRoot() * sin(eccentric)
        let w = deg(p.peri), o = deg(p.node), i = deg(p.i)
        let cw = cos(w), sw = sin(w), co = cos(o), so = sin(o), ci = cos(i), si = sin(i)
        return SIMD3(
            (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
            sw * si * xp + cw * si * yp,
            (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp
        )
    }

    /// Heliocentric position in AU. Returns the origin for bodies with no elements (the Sun).
    static func heliocentricPosition(_ body: Body, at date: Date) -> SIMD3<Double> {
        guard body.elements != nil || body.smallBody != nil else { return .zero }
        let p = params(for: body, at: date)
        return point(p, solveKepler(e: p.e, m: deg(p.m)))
    }

    static func heliocentricDistanceAU(_ body: Body, at date: Date) -> Double {
        let p = heliocentricPosition(body, at: date)
        return (p.x * p.x + p.y * p.y + p.z * p.z).squareRoot()
    }

    /// One closed orbit as `segments`+1 points. Solves the elements once, not once per sample.
    static func orbitPath(_ body: Body, at date: Date, segments: Int) -> [SIMD3<Double>] {
        let p = params(for: body, at: date)
        return (0...segments).map { point(p, (Double($0) / Double(segments)) * 2 * .pi) }
    }
}
