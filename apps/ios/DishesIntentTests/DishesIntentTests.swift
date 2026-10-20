// Dishes' App Intents run through the system, as Siri and Shortcuts run them
// (AppIntentsTesting, Xcode 27; TODO_MOBILE.md, Phase D1): an entity looked
// up from the device's database, a plan change saved offline through the
// outbox, and "Start cooking" opening cooking mode.
//
// The app is launched against the dev server first (RUNBOOK.md: `pnpm dev`
// on :3000, the stand-in user), so the database has the household in it. A
// household with no recipes skips the tests that need one.

import AppIntentsTesting
import XCTest

@MainActor
final class DishesIntentTests: XCTestCase {
    private let definitions = IntentDefinitions(bundleIdentifier: "uk.collco.dishes")
    private var app: XCUIApplication!

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-DishesDevServer", "http://localhost:3000"]
        app.launch()
        // The first sync: the recipe list has something in it.
        try await Task.sleep(for: .seconds(4))
    }

    private func someRecipe() async throws -> AnyAppEntity {
        let recipes = try await definitions.entities["RecipeEntity"].suggestedEntities()
        guard let recipe = recipes.first else { throw XCTSkip("The dev household has no recipes on this device yet.") }
        return recipe
    }

    func testEverySiriEntityIsThere() throws {
        for name in ["RecipeEntity", "PlannedMealEntity", "ShoppingItemEntity", "SavedMealEntity", "CookingStepEntity"] {
            XCTAssertNoThrow(try definitions.entities[name].isInstance(definitions.entities[name].makeReference(identifier: "x")),
                             "\(name) is registered")
        }
    }

    func testARecipeIsFoundByName() async throws {
        let recipe = try await someRecipe()
        let title: String = try recipe.title
        let firstWord = String(title.split(separator: " ").first ?? "")
        let found = try await definitions.entities["RecipeEntity"].entities(matching: firstWord)
        XCTAssertTrue(found.contains(recipe), "“\(firstWord)” finds \(title)")
        // And by id, the way Siri comes back to one it was given.
        let byId = try await definitions.entities["RecipeEntity"].entities(identifiers: [recipe.identifier.instanceIdentifier])
        XCTAssertEqual(byId, [recipe])
    }

    func testARecipeIsInSpotlight() async throws {
        let recipe = try await someRecipe()
        let title: String = try recipe.title
        let results = try await definitions.entities["RecipeEntity"].spotlightQuery(title)
        XCTAssertTrue(results.contains(recipe), "Spotlight has \(title)")
    }

    /// Plan a recipe for tomorrow's lunch: an outbox mutation, so tomorrow's
    /// meals have it at once, before any sync — the same write that works with
    /// no signal. (It stays planned in the dev household; delete it there.)
    func testPlanningGoesThroughTheOutbox() async throws {
        let recipe = try await someRecipe()
        let title: String = try recipe.title
        let plan = definitions.intents["PlanRecipeIntent"].makeIntent(
            recipe: recipe,
            day: AnyAppEnum(typeIdentifier: "PlanDay", rawValue: "tomorrow"),
            meal: AnyAppEnum(typeIdentifier: "MealTypeOption", rawValue: "lunch"))
        _ = try await plan.run()

        let meals = try await definitions.entities["PlannedMealEntity"].suggestedEntities()
        XCTAssertTrue(try meals.contains { meal in
            let dishes: [String] = try meal.dishes
            let type: String = try meal.mealType
            return type == "lunch" && dishes.contains(title)
        }, "tomorrow's lunch has \(title)")
    }

    /// What a tap on a recipe in Spotlight runs.
    func testOpeningARecipeShowsItsPage() async throws {
        let recipe = try await someRecipe()
        let title: String = try recipe.title
        _ = try await definitions.intents["OpenRecipeIntent"].makeIntent(target: recipe).run()
        XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 10), "\(title)'s page is on screen")
        XCTAssertTrue(app.staticTexts["Ingredients"].firstMatch.waitForExistence(timeout: 5), "with its ingredients")
        // What Siri sees: "add this to Friday" means this recipe.
        let onScreen = try await definitions.entities["RecipeEntity"].viewAnnotations().map(\.entity)
        XCTAssertTrue(onScreen.contains(recipe), "Siri knows \(title) is on screen")
    }

    func testStartCookingOpensCookingMode() async throws {
        let recipe = try await someRecipe()
        let cook = definitions.intents["StartCookingIntent"].makeIntent(recipe: recipe)
        _ = try await cook.run()
        XCTAssertTrue(app.buttons["Next"].waitForExistence(timeout: 10), "cooking mode is on screen")
        // The step, for "how much butter?" and "set a timer for this".
        let steps = try await definitions.entities["CookingStepEntity"].viewAnnotations().map(\.entity)
        XCTAssertEqual(steps.count, 1, "Siri sees the step being cooked")
        let number: Int = try steps[0].number
        XCTAssertEqual(number, 1)
    }
}
