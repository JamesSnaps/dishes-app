import Foundation
import Testing
@testable import DishesCore

/// Answers /api/v1/ai/concepts with `StubConcepts.reply`, as `StubConcepts.type`.
final class StubConcepts: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var type = "application/x-ndjson"
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var reply = ""

    override class func canInit(with request: URLRequest) -> Bool { request.url?.path == "/api/v1/ai/concepts" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: ["Content-Type": Self.type])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.reply.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// The AI waits: the streamed events as the server sends them (lib/ai/job-types.ts),
/// and what a recipe's progress says and how full its ring is.
@Suite(.serialized) struct GenerationEventsTests {
    let api: APIClient = {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubConcepts.self]
        return APIClient(baseURL: URL(string: "http://dishes.test")!, tokens: nil, session: URLSession(configuration: config))
    }()

    static let ask = APIClient.ConceptRequest(prompt: "Something with squash")
    static let idea = #"{"title":"Orzo","description":"Lemony","cuisine":"Italian","tags":[],"difficulty":"easy"}"#

    func events() async throws -> [ConceptsEvent] {
        var out: [ConceptsEvent] = []
        for try await e in api.recipeConceptsStream(Self.ask) { out.append(e) }
        return out
    }

    @Test func readsAStreamALineAtATime() async throws {
        (StubConcepts.type, StubConcepts.status) = ("application/x-ndjson; charset=utf-8", 200)
        StubConcepts.reply = "{\"type\":\"concept\",\"concept\":\(Self.idea)}\n\n{\"type\":\"done\",\"concepts\":[\(Self.idea)]}\n"
        let got = try await events()
        #expect(got.count == 2)
        guard case .concept(let c) = got.first, case .done(let all) = got.last else { Issue.record("wrong events"); return }
        #expect(c.title == "Orzo" && all.count == 1)
    }

    @Test func anOlderServersWholeAnswerStillArrives() async throws {
        (StubConcepts.type, StubConcepts.status) = ("application/json", 200)
        StubConcepts.reply = "{\"concepts\":[\(Self.idea)]}"
        let got = try await events()
        guard case .done(let all) = got.only else { Issue.record("expected one done"); return }
        #expect(all.first?.title == "Orzo")
    }

    @Test func aRefusalBeforeStreamingThrowsTheServersMessage() async throws {
        (StubConcepts.type, StubConcepts.status) = ("application/json", 422)
        StubConcepts.reply = #"{"error":{"code":"invalid_request","message":"AI not configured."}}"#
        await #expect(throws: APIError.http(status: 422, code: "invalid_request", message: "AI not configured.")) { try await events() }
    }

    static func decode<E: Decodable>(_ json: String, as: E.Type = E.self) throws -> E {
        try JSONDecoder().decode(E.self, from: Data(json.utf8))
    }

    @Test func decodesThePlannersEvents() throws {
        #expect(try Self.decode(#"{"type":"facts","facts":["Looking through 142 of your recipes","Choosing 5 dinners"],"photos":["/api/images/a.jpg"]}"#, as: PlanEvent.self)
                == .facts(["Looking through 142 of your recipes", "Choosing 5 dinners"], photos: ["/api/images/a.jpg"]))
        let slot = try Self.decode(#"{"type":"slot","slot":{"dayOfWeek":2,"mealType":"dinner","title":"Dal","description":"Red lentils","cuisine":"Indian","difficulty":"easy","recipeId":"r1","imageUrl":"/t/dal.jpg","libraryIndex":3,"heartStatus":"yes"}}"#, as: PlanEvent.self)
        guard case .slot(let s) = slot else { Issue.record("not a slot"); return }
        #expect(s.id == "2-dinner")
        #expect(s.recipeId == "r1")
        #expect(s.imageUrl == "/t/dal.jpg")
        let newIdea = try Self.decode(#"{"type":"slot","slot":{"dayOfWeek":0,"mealType":"dinner","title":"Miso aubergine","description":"","cuisine":"Japanese","difficulty":"easy","recipeId":null}}"#, as: PlanEvent.self)
        guard case .slot(let n) = newIdea else { Issue.record("not a slot"); return }
        #expect(n.recipeId == nil && n.imageUrl == nil, "a new idea has no recipe and no photo")
        #expect(try Self.decode(#"{"type":"done","slots":[]}"#, as: PlanEvent.self) == .done([]))
        #expect(try Self.decode(#"{"type":"error","message":"AI not configured"}"#, as: PlanEvent.self) == .error("AI not configured"))
        #expect(try Self.decode(#"{"type":"later","x":1}"#, as: PlanEvent.self) == .unknown, "a newer server's event is ignored, not fatal")
    }

    @Test func decodesARecipeBeingWritten() throws {
        #expect(try Self.decode(#"{"type":"progress","stage":"ingredients","ingredients":["orzo","feta"],"steps":0}"#, as: RecipeEvent.self)
                == .progress(.init(stage: .ingredients, ingredients: ["orzo", "feta"])))
        #expect(try Self.decode(#"{"type":"progress","stage":"method","ingredients":[],"steps":3,"revising":true}"#, as: RecipeEvent.self)
                == .progress(.init(stage: .method, steps: 3, revising: true)))
        let done = try Self.decode(#"{"type":"done","recipeId":"r9","title":"Squash orzo","collectionName":"Weeknights"}"#, as: RecipeEvent.self)
        guard case .done(let made) = done else { Issue.record("not done"); return }
        #expect(made.recipeId == "r9" && made.collectionName == "Weeknights")
        #expect(try Self.decode(#"{"type":"error","message":"Rate limited"}"#, as: RecipeEvent.self) == .error("Rate limited"))
    }

    @Test func decodesIdeasAndAddingTheWeek() throws {
        #expect(try Self.decode(#"{"type":"concept","concept":{"title":"Orzo","description":"Lemony","cuisine":"Italian","tags":[],"difficulty":"easy"}}"#, as: ConceptsEvent.self)
                == .concept(.init(title: "Orzo", description: "Lemony", cuisine: "Italian", difficulty: "easy")))
        #expect(try Self.decode(#"{"type":"writing","index":2,"progress":null}"#, as: PlanApplyEvent.self) == .writing(index: 2, progress: nil))
        #expect(try Self.decode(#"{"type":"writing","index":2,"progress":{"stage":"nutrition","ingredients":[],"steps":6}}"#, as: PlanApplyEvent.self)
                == .writing(index: 2, progress: .init(stage: .nutrition, steps: 6)))
        #expect(try Self.decode(#"{"type":"written","index":2,"recipeId":"r3"}"#, as: PlanApplyEvent.self) == .written(index: 2, recipeId: "r3"))
        #expect(try Self.decode(#"{"type":"failed","index":4}"#, as: PlanApplyEvent.self) == .failed(index: 4))
        #expect(try Self.decode(#"{"type":"done"}"#, as: PlanApplyEvent.self) == .done)
    }

    @Test func progressSaysWhereItsGot() {
        #expect(RecipeProgress(stage: .ingredients).label == "Starting on the ingredients")
        #expect(RecipeProgress(stage: .ingredients, ingredients: ["a", "b"]).label == "Ingredients · 2 so far")
        #expect(RecipeProgress(stage: .method, steps: 3).label == "Method · step 3")
        #expect(RecipeProgress(stage: .nutrition, revising: true).label == "Working out the nutrition (second pass, for heart-healthy)")
        let order: [RecipeProgress] = [.init(stage: .grounding), .init(stage: .ingredients, ingredients: ["a"]),
                                       .init(stage: .method, steps: 1), .init(stage: .method, steps: 8), .init(stage: .nutrition)]
        #expect(zip(order, order.dropFirst()).allSatisfy { $0.fraction < $1.fraction }, "the ring only ever fills")
        #expect(order.allSatisfy { $0.fraction > 0 && $0.fraction < 1 }, "never full until it's saved")
    }
}

private extension Array {
    /// The one element, when there's exactly one.
    var only: Element? { count == 1 ? first : nil }
}
