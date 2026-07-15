import AVFoundation

/// Speaks a line, and tells you when it has finished.
///
/// Two backends, in preference order:
///
/// 1. A pre-rendered audio clip from the bundle, if one exists for this line.
/// 2. On-device speech synthesis.
///
/// The clip pipeline does not exist yet, so today every line takes path 2 — and path 2 sounds
/// robotic, because **every speech voice on tvOS is "compact"**. There are 41 English voices on
/// an Apple TV and not one of them is enhanced or premium; unlike iOS there is no way to download
/// the good ones. That is measured, not assumed (see the voice probe in git history).
///
/// So on-device synthesis is a placeholder for hearing whether the *words* work, not a shipping
/// voice. When the clips land, they take over silently, and any line without a clip keeps working
/// instead of going quiet — which means new facts can be written and heard the same day.
@MainActor
final class Narrator: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {

    private let synthesizer = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var onFinish: (() -> Void)?

    /// True when a pre-rendered clip was used, so callers can tell placeholder from real audio.
    private(set) var usedRecordedClip = false

    override init() {
        super.init()
        synthesizer.delegate = self
        // .spokenAudio tells the system this is speech, so it ducks music rather than fighting it.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    /// `clipID` is the stable name a pre-rendered file would carry, e.g. `narration-jupiter-2`.
    func speak(_ line: String, clipID: String, completion: @escaping () -> Void) {
        stop()
        onFinish = completion

        #if DEBUG
        // Silent test runs (HELIOS_MUTE): play nothing, but still report "finished" after a beat so
        // the ambient loop keeps advancing. Keeps the simulator quiet without muting the whole Mac.
        if ProcessInfo.processInfo.environment["HELIOS_MUTE"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.finish() }
            return
        }
        #endif

        let clipURL = Bundle.main.url(forResource: clipID, withExtension: "m4a", subdirectory: "Media")
            ?? Bundle.main.url(forResource: clipID, withExtension: "m4a")
        if let clipURL, let clip = try? AVAudioPlayer(contentsOf: clipURL) {
            usedRecordedClip = true
            clip.delegate = self
            player = clip
            clip.play()
            return
        }

        usedRecordedClip = false
        let utterance = AVSpeechUtterance(string: line)
        utterance.voice = AVSpeechSynthesisVoice(identifier: "com.apple.voice.compact.en-US.Samantha")
            ?? AVSpeechSynthesisVoice(language: "en-US")
        // Slower than default. These are for a four-year-old, and the default rate gabbles.
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
        utterance.postUtteranceDelay = 0
        synthesizer.speak(utterance)
    }

    func stop() {
        onFinish = nil
        player?.stop()
        player = nil
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    }

    private func finish() {
        let completion = onFinish
        onFinish = nil
        completion?()
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish() }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.finish() }
    }
}
