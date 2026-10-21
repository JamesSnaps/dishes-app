// What the entity queries and intents read: this device's database, as the
// screens see it. A query can run with the app in the background (Siri,
// Shortcuts, Spotlight), and reading works then too — a suspended store still
// reads (Store/SharedStore.swift).

import DishesCore
import Foundation

enum IntentData {
    @MainActor private static var store: LocalStore { AppModel.shared.store }

    static func recipes() async throws -> [RecipeEntity] {
        let (store, imageBase) = await MainActor.run { (Self.store, AppModel.serverURL) }
        return try await store.read(load).map { recipe, cooked in
            RecipeEntity(recipe, lastCooked: cooked, thumbnail: imageURL(recipe.thumbnailUrl ?? recipe.imageUrl, base: imageBase))
        }
    }

    static func recipesById() async throws -> [String: Recipe] {
        let store = await MainActor.run { Self.store }
        return try await store.read { r in
            Dictionary(try r.records(.recipes).compactMap(Recipe.init).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        }
    }

    /// Every recipe with the last time it was cooked (ratings without a cook don't count).
    @Sendable static func load(_ r: StoreReader) throws -> [(Recipe, Date?)] {
        var lastCooked: [String: Date] = [:]
        for cook in try r.records(.cookHistory).compactMap(CookEntry.init) where cook.isCook {
            lastCooked[cook.recipeId] = max(lastCooked[cook.recipeId] ?? .distantPast, cook.cookedAt)
        }
        return try r.records(.recipes).compactMap(Recipe.init).map { ($0, lastCooked[$0.id]) }
    }

    /// The meals planned in the weeks around this one (0 is this week).
    static func plannedMeals(weeks: ClosedRange<Int>) async throws -> [PlannedMealEntity] {
        let store = await MainActor.run { Self.store }
        let data = try await store.read(PlanData.load)
        let thisWeek = Week.containing(Date())
        return weeks.flatMap { offset -> [PlannedMealEntity] in
            let week = thisWeek.adding(offset)
            return (0..<7).flatMap { day in data.meals(on: day, in: week).map { PlannedMealEntity($0, on: week.day(day)) } }
        }
    }

    /// The meals on one day, in the order the planner shows them.
    static func meals(on date: Date) async throws -> [PlannedMealEntity] {
        let store = await MainActor.run { Self.store }
        let data = try await store.read(PlanData.load)
        let week = Week.containing(date)
        return data.meals(on: Week.dayIndex(of: date), in: week).map { PlannedMealEntity($0, on: week.day(Week.dayIndex(of: date))) }
    }

    /// Tonight: today's dinner, or the last meal planned for today (as TonightMeal picks it).
    static func tonight() async throws -> PlannedMealEntity? {
        let meals = try await meals(on: Date())
        return meals.first { $0.mealType == "dinner" } ?? meals.last
    }

    /// The active list's items (and any added before a list existed).
    static func shoppingItems() async throws -> [ShoppingItemEntity] {
        let store = await MainActor.run { Self.store }
        return try await store.read(ShoppingData.load).all.map(ShoppingItemEntity.init)
    }

    static func savedMeals() async throws -> [SavedMealEntity] {
        let store = await MainActor.run { Self.store }
        return try await store.read { r in try r.records(.meals).compactMap(SavedMeal.init) }.map(SavedMealEntity.init)
    }

    /// AppModel.imageURL, without the main actor.
    static func imageURL(_ path: String?, base: URL) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: path, relativeTo: base)?.absoluteURL
    }
}
