// Hands-free cooking (TODO_MOBILE.md, C4): cooking mode listens for "next",
// "back", "read it", "start the timer" and "how much butter?", and answers out
// loud — for the iPad propped up out of reach with floury hands.
//
// All on the device: the microphone feeds Speech's SpeechAnalyzer with a
// SpeechTranscriber (its model downloaded once), each finished phrase goes
// through CookCommand, and AVSpeechSynthesizer reads the step or the amount.
// What it hears while it's speaking is ignored, so it doesn't answer itself.
// Nothing is recorded or sent anywhere.
//
//   handsFree.start(hints: ingredientNames) { command in … }
//   handsFree.say("250 grams of butter")

import AVFoundation
import DishesCore
import Observation
import Speech
import SwiftUI

@MainActor @Observable
final class HandsFree {
    enum State: Equatable { case off, starting, listening, failed(String) }

    private(set) var state = State.off
    /// The last thing it heard, shown under the banner so a miss is visible.
    private(set) var heard: String?

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var analyzer: SpeechAnalyzer?
    @ObservationIgnored private var feed: AsyncStream<AnalyzerInput>.Continuation?
    @ObservationIgnored private var listening: Task<Void, Never>?
    @ObservationIgnored private let voice = AVSpeechSynthesizer()
    @ObservationIgnored private let spoken = SpeechEnd()
    /// Until then, what's heard is its own voice.
    @ObservationIgnored private var quietUntil = Date.distantPast

    init() { voice.delegate = spoken }

    func start(hints: [String], onCommand: @escaping @MainActor (CookCommand) -> Void) {
        guard state != .starting, state != .listening else { return }
        state = .starting
        Task {
            do {
                try await begin(hints: hints, onCommand: onCommand)
                state = .listening
            } catch {
                stop()
                state = .failed(Self.explain(error))
            }
        }
    }

    func stop() {
        listening?.cancel()
        listening = nil
        feed?.finish()
        feed = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        if let analyzer { Task { await analyzer.cancelAndFinishNow() } }
        analyzer = nil
        voice.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        state = .off
        heard = nil
    }

    func say(_ text: String) {
        voice.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier.replacingOccurrences(of: "_", with: "-"))
        // Ignore the microphone while speaking, and a moment after.
        quietUntil = .distantFuture
        spoken.finished = { [weak self] in self?.quietUntil = Date().addingTimeInterval(0.6) }
        voice.speak(utterance)
    }

    private func begin(hints: [String], onCommand: @escaping @MainActor (CookCommand) -> Void) async throws {
        guard await AVAudioApplication.requestRecordPermission() else { throw HandsFreeError.noMicrophone }
        let (transcriber, phrases) = try await Self.transcriber()
        if let download = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await download.downloadAndInstall()
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let context = AnalysisContext()
        context.contextualStrings[.general] = ["next step", "go back", "read it", "start the timer", "how much"] + hints
        try await analyzer.setContext(context)

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothHFP])
        try session.setActive(true)

        let engine = AVAudioEngine()
        let input = engine.inputNode.outputFormat(forBus: 0)
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: input),
              let converter = AVAudioConverter(from: input, to: format) else { throw HandsFreeError.audio }
        let (stream, feed) = AsyncStream<AnalyzerInput>.makeStream()
        try await analyzer.start(inputSequence: stream)

        engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: input) { buffer, _ in
            guard let converted = Self.convert(buffer, with: converter, to: format) else { return }
            feed.yield(AnalyzerInput(buffer: converted))
        }
        engine.prepare()
        try engine.start()
        (self.engine, self.analyzer, self.feed) = (engine, analyzer, feed)

        listening = Task { [weak self] in
            do {
                for try await phrase in phrases {
                    let text = phrase.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let self, !text.isEmpty, Date() > self.quietUntil else { continue }
                    self.heard = text
                    if let command = CookCommand(text) { onCommand(command) }
                }
            } catch {
                self?.state = .failed(Self.explain(error))
            }
        }
    }

    /// SpeechTranscriber where it speaks the language (the newer model), else
    /// DictationTranscriber (more devices and languages; the simulator too),
    /// with its finished phrases as text.
    private static func transcriber() async throws -> (any SpeechModule, AsyncThrowingStream<String, Error>) {
        if SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: .current) {
            let module = SpeechTranscriber(locale: locale, preset: .transcription)
            return (module, phrases(module.results) { String($0.text.characters) })
        }
        guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: .current) else { throw HandsFreeError.language }
        let module = DictationTranscriber(locale: locale, preset: .shortDictation)
        return (module, phrases(module.results) { String($0.text.characters) })
    }

    private static func phrases<S: AsyncSequence & Sendable>(_ results: S, text: @escaping @Sendable (S.Element) -> String)
        -> AsyncThrowingStream<String, Error> where S.Element: Sendable {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await result in results { continuation.yield(text(result)) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The microphone's buffer in the transcriber's format.
    nonisolated private static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter,
                                            to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        nonisolated(unsafe) var given = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if given { status.pointee = .noDataNow; return nil }
            given = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil ? out : nil
    }

    static func explain(_ error: Error) -> String {
        switch error {
        case HandsFreeError.noMicrophone: "Dishes needs the microphone for hands-free — allow it in Settings."
        case HandsFreeError.language: "Hands-free doesn’t speak this device’s language yet."
        case HandsFreeError.audio: "The microphone couldn’t be started."
        default: "Hands-free stopped: \(error.localizedDescription)"
        }
    }
}

enum HandsFreeError: Error { case noMicrophone, language, audio }

/// When the voice stops: the delegate an AVSpeechSynthesizer needs.
private final class SpeechEnd: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    var finished: (@MainActor () -> Void)?
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in finished?() }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in finished?() }
    }
}

/// While hands-free is on: what to say, and what it last heard.
struct HandsFreeBanner: View {
    let handsFree: HandsFree

    var body: some View {
        switch handsFree.state {
        case .off:
            EmptyView()
        case .starting:
            pill(icon: "mic", title: "Starting hands-free…", detail: nil, fill: AnyShapeStyle(Theme.brandGradient))
        case .listening:
            pill(icon: "waveform", title: "Listening — “next”, “back”, “read it”, “start the timer”, “how much…?”",
                 detail: handsFree.heard.map { "Heard: “\($0)”" }, fill: AnyShapeStyle(Theme.brandGradient))
        case .failed(let message):
            pill(icon: "mic.slash", title: message, detail: nil, fill: AnyShapeStyle(Theme.destructive))
        }
    }

    private func pill(icon: String, title: String, detail: String?, fill: AnyShapeStyle) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold)).symbolEffect(.variableColor, isActive: handsFree.state == .listening)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                if let detail { Text(detail).font(.system(size: 12)).opacity(0.85).lineLimit(1) }
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(fill, in: Capsule())
        .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
        .padding(.horizontal, 16)
    }
}
