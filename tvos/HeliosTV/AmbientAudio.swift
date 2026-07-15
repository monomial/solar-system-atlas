import AVFoundation

/// A generated ambient drone. There is no audio file — every sample is synthesised live.
///
/// Why synthesise rather than loop a track: the same reason the narration is rendered locally.
/// A fixed loop develops "oh, this bit again" fatigue on the hundredth bedtime, and this thing is
/// built to be left running. A drone whose voices each breathe on their own slow, unrelated cycle
/// never exactly repeats, so it never gets old. It also costs nothing and needs no license.
///
/// The chord is deliberately open — root, fifth, octave, and a high ninth, but no third. A third
/// commits the music to happy or sad; leaving it out keeps the feeling *wondering*, which is the
/// register the whole app is written in.
///
/// The DSP runs on the audio thread and must never allocate or block there. Parameters are plain
/// Doubles written from the main thread and read on the audio thread; the races are benign (a
/// slightly stale target for one block) and everything is smoothed per-sample anyway, so there is
/// no zipper noise. The class is therefore a plain final class, not an actor.
final class AmbientAudio: @unchecked Sendable {

    private let engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private let sampleRate: Double

    // A voice: a sine partial with its own slow amplitude cycle. `brightness` is how much the voice
    // fades out as the journey moves outward — low voices stay, shimmer disappears into the cold.
    private struct Voice {
        let frequency: Double
        let gain: Double
        let lfoRate: Double   // Hz — deliberately unrelated across voices, so nothing lines up
        let brightness: Double
    }

    // A-rooted, open, no third. The two shimmer voices at the top carry brightness 1, so by the
    // time you reach Eris only the sub and the fifth remain: a hollow, cold, almost-empty drone.
    private let voices: [Voice] = [
        Voice(frequency:  55.00, gain: 0.90, lfoRate: 0.037, brightness: 0.00),  // A1 sub root
        Voice(frequency:  82.41, gain: 0.55, lfoRate: 0.041, brightness: 0.12),  // E2 fifth
        Voice(frequency: 110.00, gain: 0.48, lfoRate: 0.053, brightness: 0.28),  // A2 octave
        Voice(frequency: 164.81, gain: 0.30, lfoRate: 0.067, brightness: 0.62),  // E3 fifth
        Voice(frequency: 220.13, gain: 0.22, lfoRate: 0.079, brightness: 0.82),  // A3 (nudged, slow beat)
        Voice(frequency: 246.94, gain: 0.13, lfoRate: 0.101, brightness: 1.00),  // B3 ninth shimmer
        Voice(frequency: 329.63, gain: 0.08, lfoRate: 0.113, brightness: 1.00),  // E4 high shimmer
    ]

    private var phases: [Double]
    private var lfoPhases: [Double]

    // Written from the main thread, read on the audio thread.
    private var targetOuterness: Double = 0   // 0 at the Sun, 1 at Eris
    private var targetDuck: Double = 1         // 1 normally, lower while narration is playing

    private var outerness = 0.0
    private var duck = 1.0

    // Quiet. This is a bed the narration sits on top of, never a thing you notice on its own.
    private let masterGain = 0.12

    init() {
        sampleRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        phases = Array(repeating: 0, count: voices.count)
        // Stagger the breathing so the voices do not all swell together at the start.
        lfoPhases = voices.indices.map { Double($0) * 0.9 }
    }

    func start() {
        guard source == nil else { return }
        let format = engine.mainMixerNode.outputFormat(forBus: 0)

        let node = AVAudioSourceNode { [weak self] _, _, frameCount, audioBufferList -> OSStatus in
            guard let self else { return noErr }
            self.render(Int(frameCount), into: audioBufferList)
            return noErr
        }
        source = node
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)

        do { try engine.start() } catch { print("[audio] engine failed to start: \(error)") }
    }

    /// 0 at the Sun, 1 at the far edge. A square-root curve so the inner planets spread out rather
    /// than all sitting near zero, and the change is felt across the whole journey.
    func setOuterness(auFromSun: Double) {
        let normalised = (auFromSun / 68).squareRoot()   // Eris rounds to ~1
        targetOuterness = min(1, max(0, normalised))
    }

    /// Duck the music well under the voice while a line is playing, then let it breathe back up.
    func setNarrating(_ narrating: Bool) {
        targetDuck = narrating ? 0.38 : 1
    }

    private func render(_ frames: Int, into abl: UnsafeMutablePointer<AudioBufferList>) {
        let buffers = UnsafeMutableAudioBufferListPointer(abl)
        let twoPi = 2 * Double.pi

        // One-pole smoothing toward the targets, ~1.5s glide, so nothing steps or clicks.
        let glide = exp(-1.0 / (1.5 * sampleRate))

        for frame in 0..<frames {
            outerness = targetOuterness + (outerness - targetOuterness) * glide
            duck = targetDuck + (duck - targetDuck) * glide

            var sample = 0.0
            for i in voices.indices {
                let voice = voices[i]
                // Fade bright voices out as the journey moves outward.
                let voiceGain = voice.gain * (1 - voice.brightness * outerness)
                if voiceGain > 0 {
                    // Slow amplitude breath, unique per voice, so the texture never repeats.
                    let breath = 0.55 + 0.45 * 0.5 * (1 + sin(lfoPhases[i]))
                    sample += sin(phases[i]) * voiceGain * breath
                }
                phases[i] += twoPi * voice.frequency / sampleRate
                if phases[i] > twoPi { phases[i] -= twoPi }
                lfoPhases[i] += twoPi * voice.lfoRate / sampleRate
                if lfoPhases[i] > twoPi { lfoPhases[i] -= twoPi }
            }

            // A touch emptier out in the cold, then soft-clipped for safety against any transient sum.
            let out = tanh(sample * masterGain * duck * (1 - 0.22 * outerness))
            for buffer in buffers {
                let channel = buffer.mData!.assumingMemoryBound(to: Float.self)
                channel[frame] = Float(out)
            }
        }
    }
}
