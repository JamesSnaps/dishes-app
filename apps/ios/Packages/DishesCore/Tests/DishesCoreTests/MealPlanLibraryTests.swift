// The library a draft week is planned from (MealPlanDrafter.library): the
// server's rules, applied by code before the model sees anything.

import Foundation
import Testing
@testable import DishesCore

@Suite struct MealPlanLibraryTests {
    func recipe(_ id: String, _ title: String, favourite: Bool = false, role: String = "main") -> Recipe {
        Recipe(.object(["id": .string(id), "title": .string(title), "isFavourite": .bool(favourite), "mealRole": .string(role),
                        "mealTypes": .array([.string("dinner")])]))!
    }
    func cook(_ recipeId: String, _ date: String, rating: Double? = nil, by member: (String, Double)? = nil) -> CookEntry {
        var json: [String: JSONValue] = ["id": .string(UUID().uuidString), "recipeId": .string(recipeId), "cookedAt": .string(date + "T18:00:00Z")]
        if let rating { json["rating"] = .number(rating) }
        if let member { json["memberRatings"] = .array([.object(["name": .string(member.0), "rating": .number(member.1)])]) }
        return CookEntry(.object(json))!
    }
    let today = MealPlanDrafter.date("2026-10-20")!
    func ask(_ slots: Int, favourites: Bool = false) -> MealPlanDrafter.Ask {
        .init(weekStartDate: "2026-10-26", slots: (0..<slots).map { .init(dayOfWeek: $0, mealType: "dinner") }, favouritesOnly: favourites)
    }
    var household: MealPlanDrafter.Household {
        .init(recipes: [recipe("a", "Curry", favourite: true), recipe("b", "Bolognese"), recipe("c", "Burgers"),
                        recipe("d", "Risotto", favourite: true), recipe("e", "Garlic butter", role: "sauce")],
              plans: [.init(.object(["id": .string("p"), "weekStartDate": .string("2026-10-19")]))!],
              entries: [.init(.object(["id": .string("x"), "mealPlanId": .string("p"), "recipeId": .string("d"), "dayOfWeek": .number(0)]))!],
              cooks: [cook("b", "2026-10-12", rating: 9), cook("c", "2026-06-01", rating: 3), cook("a", "2026-05-01", by: ("Sam", 2))])
    }

    @Test func recentAndDislikedAreKeptOut() {
        let lib = MealPlanDrafter.library(ask(1), household: household, eating: [], today: today, shuffle: { _ in })
        #expect(lib.picks.map(\.recipe.title) == ["Curry"], "mains only; Bolognese cooked last week, Risotto planned, Burgers rated 3")
        #expect(lib.recent == ["Bolognese", "Risotto"])
        #expect(lib.disliked == ["Burgers"])
    }

    @Test func someoneEatingWhoRatedItLowKeepsItOut() {
        let lib = MealPlanDrafter.library(ask(1), household: household, eating: ["sam"], today: today, shuffle: { _ in })
        #expect(!lib.picks.contains { $0.recipe.title == "Curry" })
    }

    @Test func theCooldownRelaxesWhenTooFewAreLeft() {
        let lib = MealPlanDrafter.library(ask(3), household: household, eating: [], today: today, shuffle: { _ in })
        #expect(lib.cooldownUsed == 0)
        #expect(Set(lib.picks.map(\.recipe.title)) == ["Curry", "Bolognese", "Risotto"])
    }

    @Test func favouritesOnly() {
        let lib = MealPlanDrafter.library(ask(2, favourites: true), household: household, eating: [], today: today, shuffle: { _ in })
        #expect(Set(lib.picks.map(\.recipe.title)) == ["Curry", "Risotto"])
    }

    @Test func aVegetarianEatingKeepsMeatOut() {
        var h = household
        h.recipes.append(Recipe(.object(["id": .string("f"), "title": .string("Prawn noodles"), "mealRole": .string("main")]))!)
        h.recipes.append(Recipe(.object(["id": .string("g"), "title": .string("Dal"), "mealRole": .string("main"),
                                         "ingredients": .array([.object(["id": .string("g1"), "ingredientName": .string("red lentils")])])]))!)
        let lib = MealPlanDrafter.library(ask(1), household: h, eating: [], today: today, diets: ["Vegetarian"], shuffle: { _ in })
        #expect(!lib.picks.contains { $0.recipe.title == "Prawn noodles" })
        #expect(lib.picks.contains { $0.recipe.title == "Dal" })
    }
}
