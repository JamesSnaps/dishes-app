// The sync engine's rules, checked against a scripted server. These mirror
// the behaviour of packages/client/src/sync-engine.ts; when a rule changes
// there it changes here (and, once they exist, in fixtures/sync-scenarios).

import Foundation
import Testing
@testable import DishesCore

/// A server that answers from a script and records what it was sent.
actor ScriptedServer: SyncTransport {
    var pulls: [Result<PullResponse, Error>] = []
    var pushes: [([QueuedMutation]) throws -> PushResponse] = []
    private(set) var pulledWith: [String?] = []
    private(set) var pushed: [[QueuedMutation]] = []

    func script(pulls: [Result<PullResponse, Error>] = [], pushes: [([QueuedMutation]) throws -> PushResponse] = []) {
        self.pulls = pulls
        self.pushes = pushes
    }

    nonisolated func pull(cursor: String?, limit: Int) async throws -> PullResponse {
        try await nextPull(cursor)
    }

    nonisolated func push(_ mutations: [QueuedMutation]) async throws -> PushResponse {
        try await nextPush(mutations)
    }

    private func nextPull(_ cursor: String?) throws -> PullResponse {
        pulledWith.append(cursor)
        guard !pulls.isEmpty else { return PullResponse(cursor: cursor ?? "c0", hasMore: false) }
        return try pulls.removeFirst().get()
    }

    private func nextPush(_ mutations: [QueuedMutation]) throws -> PushResponse {
        pushed.append(mutations)
        guard !pushes.isEmpty else {
            return PushResponse(results: mutations.map { MutationResult(opId: $0.opId, status: .applied) }, cursor: "c")
        }
        return try pushes.removeFirst()(mutations)
    }
}

func item(_ id: String, _ name: String, checked: Bool = false) -> JSONValue {
    .object(["id": .string(id), "listId": .string("list"), "ingredientName": .string(name), "isChecked": .bool(checked)])
}

func items(_ store: LocalStore) async throws -> [ShoppingItem] {
    try await store.read { try $0.records(.shoppingItems) }.compactMap(ShoppingItem.init).sorted { $0.id < $1.id }
}

@Suite struct SyncEngineTests {
    let store = try! LocalStore.inMemory()
    let server = ScriptedServer()

    @Test func snapshotFixtureDecodes() throws {
        // fixtures/wire/pull-snapshot.json: a real dev-server snapshot.
        let url = URL(filePath: #filePath).deletingLastPathComponent()
            .appending(path: "../../../../../../fixtures/wire/pull-snapshot.json").standardized
        let page = try JSONDecoder().decode(PullResponse.self, from: Data(contentsOf: url))
        let recipes = page.changes(in: .recipes).compactMap(Recipe.init)
        #expect(recipes.count == page.changes(in: .recipes).count)
        #expect(recipes.allSatisfy { !$0.ingredients.isEmpty && !$0.steps.isEmpty })
        #expect(recipes.contains { $0.servings == 4 })   // "4.00" on the wire
        #expect(page.changes(in: .shoppingItems).compactMap(ShoppingItem.init).count == page.changes(in: .shoppingItems).count)
        #expect(page.changes(in: .mealPlanEntries).compactMap(MealPlanEntry.init).count == page.changes(in: .mealPlanEntries).count)
        #expect(page.changes(in: .mealPlanGroups).compactMap(MealPlanGroup.init).count == page.changes(in: .mealPlanGroups).count)
        let meals = page.changes(in: .meals).compactMap(SavedMeal.init)
        #expect(!meals.isEmpty && meals.count == page.changes(in: .meals).count)
        #expect(meals.allSatisfy { !$0.slots.isEmpty && $0.slots.allSatisfy { !$0.options.isEmpty } })
        #expect(page.changes(in: .cookHistory).compactMap(CookEntry.init).count == page.changes(in: .cookHistory).count)
    }

    @Test func pullsEveryPageAndSavesTheCursor() async throws {
        await server.script(pulls: [
            .success(PullResponse(cursor: "c1", hasMore: true, changes: ["shoppingItems": [item("a", "Milk")]])),
            .success(PullResponse(cursor: "c2", hasMore: false, changes: ["shoppingItems": [item("b", "Eggs")]],
                                  deleted: ["recipes": ["gone"]])),
        ])
        let outcome = try await SyncEngine(store: store, transport: server).sync()
        #expect(outcome == SyncOutcome(pulled: 3))
        #expect(try await items(store).map(\.name) == ["Milk", "Eggs"])
        #expect(try await store.read { try $0.cursor() } == "c2")
        #expect(await server.pulledWith == [nil, "c1"])
    }

    @Test func ignoresCollectionsItDoesNotKnow() async throws {
        await server.script(pulls: [.success(PullResponse(cursor: "c1", hasMore: false,
                                                          changes: ["pantryItems": [.object(["id": .string("p")])]]))])
        let outcome = try await SyncEngine(store: store, transport: server).sync()
        #expect(!outcome.offline)
    }

    @Test func staleCursorTakesASnapshotAndKeepsTheOutbox() async throws {
        try await store.write { tx in
            try tx.put(.shoppingItems, item("old", "Stale"))
            try tx.setMeta("cursor", "pruned")
        }
        let engine = SyncEngine(store: store, transport: server)
        try await engine.mutate("shopping_item.add", payload: .object(["ingredientName": .string("Bread")]))
        await server.script(
            pulls: [
                .failure(APIError.http(status: 400, code: "invalid_request", message: "cursor")),
                .success(PullResponse(cursor: "fresh", hasMore: false, changes: ["shoppingItems": [item("a", "Milk")]])),
            ],
            // Leave the mutation queued, as a push that never reached the server would.
            pushes: [{ _ in PushResponse(results: [], cursor: "c") }])
        let outcome = try await engine.sync()
        #expect(!outcome.offline)
        #expect(try await items(store).map(\.name) == ["Milk"])
        #expect(await server.pulledWith == ["pruned", nil])
        #expect(try await store.read { try $0.pendingCount() } == 1)
    }

    @Test func settledAndFailedLeaveTheQueueAndFailuresAreReported() async throws {
        let engine = SyncEngine(store: store, transport: server)
        let ok = try await engine.mutate("shopping_item.toggle", payload: .object(["itemId": .string("a")]))
        let dup = try await engine.mutate("shopping_item.toggle", payload: .object(["itemId": .string("b")]))
        let bad = try await engine.mutate("shopping_item.delete", payload: .object(["itemId": .string("c")]))
        await server.script(pushes: [{ ops in
            PushResponse(results: [
                MutationResult(opId: ok, status: .applied),
                MutationResult(opId: dup, status: .duplicate),
                MutationResult(opId: bad, status: .failed, error: "Item not found"),
            ], cursor: "c")
        }])
        let reported = Reported()
        await engine.onMutationsFailed { failures in Task { await reported.add(failures) } }

        let outcome = try await engine.sync()
        #expect(outcome.pushed == 2 && outcome.failed == 1)
        #expect(try await store.read { try $0.pendingCount() } == 0)
        try await Task.sleep(for: .milliseconds(50))
        let failures = await reported.all
        #expect(failures.map(\.type) == ["shopping_item.delete"])
        #expect(failures.first?.error == "Item not found")
    }

    @Test func temporaryRowsGoWhenTheMutationSettles() async throws {
        let engine = SyncEngine(store: store, transport: server)
        try await engine.mutate("meal_plan_entry.add", payload: .object(["recipeId": .string("r")]),
                                optimistic: [.put(.mealPlanEntries, .object(["id": .string("tmp"), "mealPlanId": .string("p")]),
                                                  temporary: true)])
        #expect(try await store.read { try $0.record(.mealPlanEntries, id: "tmp") } != nil)
        await server.script(pulls: [.success(PullResponse(cursor: "c1", hasMore: false, changes: [
            "mealPlanEntries": [.object(["id": .string("real"), "mealPlanId": .string("p")])],
        ]))])

        try await engine.sync()
        let ids = try await store.read { try $0.records(.mealPlanEntries) }.compactMap(\.id)
        #expect(ids == ["real"])
    }

    @Test func pushesInBatchesTheServerAccepts() async throws {
        let engine = SyncEngine(store: store, transport: server)
        for i in 0..<450 {
            try await engine.mutate("shopping_item.add", payload: .object(["ingredientName": .string("item \(i)")]))
        }
        let outcome = try await engine.sync()
        #expect(outcome.pushed == 450)
        #expect(await server.pushed.map(\.count) == [200, 200, 50])
        // In the order they were made.
        #expect(await server.pushed[0].first?.payload.string("ingredientName") == "item 0")
    }

    @Test func transportFailureBacksOffButAnHTTPErrorDoesNot() async throws {
        let engine = SyncEngine(store: store, transport: server)
        await server.script(pulls: [.failure(URLError(.timedOut))])
        #expect(try await engine.sync().offline)
        #expect(await engine.isBackingOff)
        #expect(try await engine.sync().skipped)
        #expect(try await !engine.sync(force: true).offline)

        await server.script(pulls: [.failure(APIError.http(status: 500, code: "internal_error", message: "boom"))])
        #expect(try await engine.sync().offline)
        #expect(await !engine.isBackingOff)
    }

    @Test func signedOutReachesTheApp() async throws {
        await server.script(pulls: [.failure(APIError.signedOut)])
        await #expect(throws: APIError.signedOut) { try await SyncEngine(store: store, transport: server).sync() }
    }

    @Test func cookEntryReadsTheServerRow() throws {
        // As cook_history arrives over sync: rating is a Postgres decimal (a string).
        let json = try JSONDecoder().decode(JSONValue.self, from: Data("""
        {"id":"c1","recipeId":"r1","cookedAt":"2026-10-12T18:30:00.123Z","rating":"8.5",
         "notes":"Crispy","cookedFor":["James","Louis"],
         "memberRatings":[{"name":"Louis","rating":6}],"source":"cook"}
        """.utf8))
        let entry = try #require(CookEntry(json))
        #expect(entry.rating == 8.5)
        #expect(entry.cookedFor == ["James", "Louis"])
        #expect(entry.memberRatings.first?.rating == 6)
        #expect(entry.isCook)
        #expect(entry.cookedAt.timeIntervalSince1970 > 1_791_000_000)
    }

    @Test func heartHealthyNeedsBothFigures() throws {
        let recipe = { (fields: [String: JSONValue]) in
            Recipe(.object(["id": .string("r")].merging(fields) { $1 }))!
        }
        #expect(recipe(["saturatedFatG": .string("2.0"), "fiberG": .string("5.0")]).isHeartHealthy)
        #expect(!recipe(["saturatedFatG": .string("6.0"), "fiberG": .string("5.0")]).isHeartHealthy)
        #expect(!recipe(["saturatedFatG": .string("2.0")]).isHeartHealthy)   // unknown is not low
    }

    @Test func mutateWritesTheChangeAndQueuesItTogether() async throws {
        let engine = SyncEngine(store: store, transport: server)
        try await store.write { try $0.put(.shoppingItems, item("a", "Milk")) }
        try await engine.mutate("shopping_item.toggle",
                                payload: .object(["itemId": .string("a"), "checked": .bool(true)]),
                                optimistic: [.put(.shoppingItems, item("a", "Milk", checked: true))])
        #expect(try await items(store).first?.isChecked == true)
        let queued = try await store.read { try $0.pendingMutations() }
        #expect(queued.map(\.type) == ["shopping_item.toggle"])
        #expect(queued.first?.payload.bool("checked") == true)
    }
}

actor Reported {
    var all: [FailedMutation] = []
    func add(_ more: [FailedMutation]) { all += more }
}
