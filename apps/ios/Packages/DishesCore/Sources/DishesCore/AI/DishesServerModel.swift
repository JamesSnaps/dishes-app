// The server as a FoundationModels `LanguageModel` (TODO_MOBILE.md, D5): the
// household's own key, behind the same `LanguageModelSession` code the
// on-device model runs, so a job's fallback is its own prompt and schema sent
// elsewhere rather than a separate REST route per job.
//
//   let session = LanguageModelSession(model: DishesServerModel(api: api), instructions: Prompts.cookAssist(context))
//   let draft = try await session.respond(to: text, generating: RecipeDraft.self)
//
// The executor turns the session's transcript into chat messages, sends the
// generation schema (encoded as JSON Schema, which GenerationSchema already
// is) and streams the text back into the session; with a schema, the text is
// the JSON the session decodes. POST /api/v1/ai/respond does the call.
//
// Photos go with their prompt as JPEGs, for the server's model to read (a
// scanned recipe page). What it doesn't do: tools — no job here uses one.

import CoreGraphics
import Foundation
import FoundationModels
import ImageIO
import UniformTypeIdentifiers

@available(iOS 27, macOS 27, *)
public struct DishesServerModel: LanguageModel {
    public typealias Executor = DishesServerExecutor

    let api: APIClient
    /// Have the server add the household's AI settings. Off by default: the
    /// device's prompts already carry them (Prompts.systemAddendum), from the
    /// cached context.
    let settings: Bool
    let maxTokens: Int?

    public init(api: APIClient, settings: Bool = false, maxTokens: Int? = nil) {
        self.api = api
        self.settings = settings
        self.maxTokens = maxTokens
    }

    public var capabilities: LanguageModelCapabilities { LanguageModelCapabilities([.guidedGeneration, .vision]) }
    public var executorConfiguration: DishesServerExecutor.Configuration { .init() }
}

@available(iOS 27, macOS 27, *)
public struct DishesServerExecutor: LanguageModelExecutor {
    public struct Configuration: Hashable, Sendable {}

    public init(configuration: Configuration) throws {}

    public func respond(to request: LanguageModelExecutorGenerationRequest, model: DishesServerModel,
                        streamingInto channel: LanguageModelExecutorGenerationChannel) async throws {
        let schema = try request.schema.map { try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode($0)) }
        let body = APIClient.RespondRequest(messages: Self.messages(request.transcript), schema: schema,
                                            settings: model.settings ? true : nil, maxTokens: model.maxTokens)
        for try await chunk in model.api.respond(body) {
            await channel.send(.response(action: .appendText(chunk, tokenCount: Self.tokens(in: chunk))))
        }
    }

    /// The transcript as chat messages: instructions as the system message,
    /// prompts and answers as user and assistant turns.
    static func messages(_ transcript: Transcript) -> [APIClient.RespondRequest.Message] {
        transcript.compactMap { entry -> APIClient.RespondRequest.Message? in
            switch entry {
            case .instructions(let i): message("system", i.segments)
            case .prompt(let p): message("user", p.segments)
            case .response(let r): message("assistant", r.segments)
            default: nil
            }
        }
    }

    static func message(_ role: String, _ segments: [Transcript.Segment]) -> APIClient.RespondRequest.Message? {
        var images: [APIClient.RespondRequest.Message.Image] = []
        let text = segments.compactMap { segment -> String? in
            switch segment {
            case .text(let t): return t.content
            case .structure(let s): return s.content.jsonString
            case .attachment(let a):
                if case .image(let image) = a.content, let jpeg = jpeg(image.cgImage) {
                    images.append(.init(mimeType: "image/jpeg", data: jpeg.base64EncodedString()))
                }
                return nil
            @unknown default: return nil
            }
        }.joined(separator: "\n")
        guard !text.isEmpty || !images.isEmpty else { return nil }
        return .init(role: role, content: text, images: images.isEmpty ? nil : images)
    }

    /// A photo as a JPEG no wider or taller than 2,000 px: plenty to read a
    /// page, a few hundred KB to send.
    static func jpeg(_ image: CGImage, maxDimension: Int = 2000) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        var image = image
        let longest = max(image.width, image.height)
        if longest > maxDimension {
            let scale = Double(maxDimension) / Double(longest)
            let (w, h) = (Int(Double(image.width) * scale), Int(Double(image.height) * scale))
            guard let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
            else { return nil }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            guard let scaled = context.makeImage() else { return nil }
            image = scaled
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    /// Roughly: the session counts them, the answer doesn't depend on it.
    static func tokens(in text: String) -> Int { max(1, text.count / 4) }
}
