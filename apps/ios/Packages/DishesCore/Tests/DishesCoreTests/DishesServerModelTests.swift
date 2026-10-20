// DishesServerModel (D5): a LanguageModelSession whose model is the server,
// against a stubbed POST /api/v1/ai/respond — what it sends, and that the
// session reads the answer back, text or guided.

import Foundation
import FoundationModels
import Testing
@testable import DishesCore

/// Answers /api/v1/ai/respond with `StubRespond.answer`, keeping each request body.
final class StubRespond: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var answer = ""
    nonisolated(unsafe) static var bodies: [Data] = []

    override class func canInit(with request: URLRequest) -> Bool { request.url?.path == "/api/v1/ai/respond" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; body.append(buffer, count: n) }
            stream.close()
        }
        Self.bodies.append(body)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "text/plain"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.answer.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized) struct DishesServerModelTests {
    let api: APIClient = {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubRespond.self]
        return APIClient(baseURL: URL(string: "http://dishes.test")!, tokens: nil, session: URLSession(configuration: config))
    }()

    @Test func aPlainAnswerComesBackThroughTheSession() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        StubRespond.answer = "Simmer it for two to three hours."
        StubRespond.bodies = []
        let session = LanguageModelSession(model: DishesServerModel(api: api), instructions: "You are a cooking assistant.")
        let answer = try await session.respond(to: "How long does it simmer?")
        #expect(answer.content == "Simmer it for two to three hours.")

        let sent = try JSONDecoder().decode(JSONValue.self, from: try #require(StubRespond.bodies.last))
        let messages = sent.array("messages")
        #expect(messages.map { $0.string("role") } == ["system", "user"])
        #expect(messages.first?.string("content") == "You are a cooking assistant.")
        #expect(sent["schema"] == nil)
    }

    @Test func aGuidedAnswerIsDecodedFromTheJSON() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        StubRespond.answer = #"{"concepts":[{"title":"Dal","description":"Red lentils.","cuisine":"Indian","tags":["vegetarian"],"difficulty":"easy"}]}"#
        StubRespond.bodies = []
        let session = LanguageModelSession(model: DishesServerModel(api: api))
        let list = try await session.respond(to: "A vegetarian curry", generating: ConceptList.self).content
        #expect(list.concepts.map(\.title) == ["Dal"])

        let sent = try JSONDecoder().decode(JSONValue.self, from: try #require(StubRespond.bodies.last))
        #expect(sent["schema"]?.string("title") == "ConceptList")
    }

    @Test func cookAssistFallsBackThroughTheServerModel() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        StubRespond.answer = "Use the same amount of stock with a splash of vinegar."
        StubRespond.bodies = []
        let context = APIClient.CookAssistContext(
            recipeTitle: "Bolognese", stepNumber: 3, stepInstruction: "Pour in the red wine.", stepIngredients: [],
            allIngredients: [.init(amount: "480", unit: "ml", name: "red wine")], allSteps: [.init(number: 3, instruction: "Pour in the red wine.")],
            servingsSummary: nil, messages: [.init(role: "user", content: "I've got no red wine.")])
        var answer = ""
        for try await chunk in CookAssist.onServer(context, api: api) { answer += chunk }
        #expect(answer == StubRespond.answer)
        let sent = try JSONDecoder().decode(JSONValue.self, from: try #require(StubRespond.bodies.last))
        #expect(sent.array("messages").first?.string("content")?.contains("Recipe: Bolognese") == true)
        #expect(sent.array("messages").last?.string("content") == "I've got no red wine.")
    }
}
