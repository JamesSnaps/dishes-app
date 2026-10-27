// Meals eaten out (server 1.66.0): reading the synced row, and the one-off
// fresh snapshot a store from an older build takes so it doesn't miss them.

import Foundation
import Testing
@testable import DishesCore

@Suite struct OutsideMealTests {
    let folder: URL = {
        let url = FileManager.default.temporaryDirectory.appending(path: "dishes-\(UUID().uuidString)", directoryHint: .isDirectory)
        try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    @Test func readsTheServersRow() throws {
        // As GET /api/v1/sync sends it: numerics as strings, a timestamp date.
        let json = try JSONDecoder().decode(JSONValue.self, from: Data("""
            {"id": "m1", "date": "2026-10-23", "mealType": "dinner", "kind": "takeaway",
             "title": "Chicken katsu curry", "place": "Kokoro", "portion": "indulgent",
             "components": ["breaded chicken", "katsu sauce", "rice"], "mainIngredients": ["chicken breast", "rice"],
             "menuKcal": null, "calories": 1050, "saturatedFatG": "9.0", "sodiumMg": "2100.0",
             "nutritionSource": "ai", "eatenBy": ["Sam"], "rating": "8.0",
             "memberRatings": [{"name": "Sam", "rating": 8}], "photoUrl": null}
            """.utf8))
        let meal = try #require(OutsideMeal(json))
        #expect(meal.kind == .takeaway)
        #expect(meal.portion == .indulgent)
        #expect(meal.saturatedFatG == 9)
        #expect(meal.sodiumMg == 2100)
        #expect(meal.hasNutrition)
        #expect(meal.label == "Chicken katsu curry at Kokoro")
        #expect(meal.memberRatings.map(\.name) == ["Sam"])
    }

    @Test func oddValuesFallBackToTheServersDefaults() throws {
        let meal = try #require(OutsideMeal(.object([
            "id": .string("m2"), "date": .string("2026-10-24T00:00:00.000Z"),
            "mealType": .string("supper"), "kind": .string("picnic"), "portion": .string("huge"),
        ])))
        #expect(meal.date == "2026-10-24")
        #expect(meal.mealType == "dinner")
        #expect(meal.kind == .eatOut)
        #expect(meal.portion == .typical)
        #expect(!meal.hasNutrition)
        #expect(!meal.isDescribed)
        #expect(meal.label == "Eating out")
        #expect(OutsideMeal(.object(["id": .string("m3")])) == nil)
    }

    @Test func aSkippedMealIsNotAMeal() throws {
        let meal = try #require(OutsideMeal(.object(["id": .string("m4"), "date": .string("2026-10-24"), "kind": .string("skipped")])))
        #expect(!meal.countsAsMeal)
    }

    @Test func coursesComeBackInEatingOrder() throws {
        let json = try JSONDecoder().decode(JSONValue.self, from: Data("""
            {"id": "m5", "date": "2026-10-27", "calories": 1850, "nutritionSource": "ai",
             "courses": [
               {"id": "d", "course": "dessert", "text": "Sticky toffee pudding", "calories": 610},
               {"id": "x", "course": "pudding"},
               {"id": "m", "course": "main", "text": "Ribeye", "menuKcal": 980, "name": "Ribeye & chips"},
               {"id": "s", "course": "starter", "text": " ", "photoUrl": "https://x/s.jpg"}
             ]}
            """.utf8))
        let meal = try #require(OutsideMeal(json))
        #expect(meal.courses.map(\.id) == ["s", "m", "d"])
        #expect(meal.courses[0].text == nil)
        #expect(meal.courses[1].name == "Ribeye & chips")
        #expect(meal.courses[2].calories == 610)
        #expect(meal.isDescribed)
        #expect(meal.coverPhotoUrl == "https://x/s.jpg")
        #expect(meal.usesMenuKcal)
    }

    @Test func aWriteSendsCoursesOnlyWhenTheFormHasThem() throws {
        func body(_ courses: [APIClient.OutsideMealWrite.CourseWrite]?) throws -> [String: Any] {
            var write = APIClient.OutsideMealWrite(date: "2026-10-27", mealType: "dinner", kind: "eat_out", title: nil, place: nil,
                                                   description: nil, menuText: nil, menuKcal: nil, portion: "typical",
                                                   eatenBy: nil, rating: nil, notes: nil)
            write.courses = courses
            return try JSONSerialization.jsonObject(with: JSONEncoder().encode(write)) as! [String: Any]
        }
        #expect(try body(nil)["courses"] == nil)
        #expect(try body([])["courses"] is NSNull)
        let sent = try body([.init(id: "s", course: "starter", text: "Squid", menuKcal: 420, removePhoto: true)])["courses"] as? [[String: Any]]
        #expect(sent?.first?["course"] as? String == "starter")
        #expect(sent?.first?["removePhoto"] as? Bool == true)
    }

    @Test func anOlderStoreStartsAFreshSnapshotOnceAndKeepsItsOutbox() async throws {
        let path = folder.appending(path: "dishes.sqlite").path
        do {
            let old = try LocalStore(path: path, upTo: "v1")
            try await old.write { tx in
                try tx.put(.recipes, .object(["id": .string("r1"), "title": .string("Soup")]))
                try tx.setMeta("cursor", "c9")
                try tx.enqueue(QueuedMutation(opId: "op1", type: "shopping_item.toggle", payload: .object([:]), queuedAt: 1))
            }
        }
        let store = try LocalStore(path: path)
        #expect(try await store.read { try $0.records(.recipes) }.isEmpty)
        #expect(try await store.read { try $0.cursor() } == nil)
        #expect(try await store.read { try $0.pendingCount() } == 1)

        // Only once: the next launch keeps what the snapshot brought.
        try await store.write { try $0.setMeta("cursor", "c10") }
        let again = try LocalStore(path: path)
        #expect(try await again.read { try $0.cursor() } == "c10")
    }

    @Test func aPullStoresThem() async throws {
        let store = try LocalStore.inMemory()
        try await store.write { tx in
            try tx.applyPull(PullResponse(cursor: "c1", hasMore: false, changes: [
                "outsideMeals": [.object(["id": .string("m1"), "date": .string("2026-10-23")])],
            ]))
        }
        let meals = try await store.read { try $0.records(.outsideMeals) }.compactMap(OutsideMeal.init)
        #expect(meals.map(\.id) == ["m1"])
    }
}
