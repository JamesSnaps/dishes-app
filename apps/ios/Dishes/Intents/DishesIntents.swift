// What Siri, Shortcuts, Spotlight and the Action button can do in Dishes
// (TODO_MOBILE.md, Phase D1), besides adding to the shopping list
// (Shopping/ShoppingIntents.swift):
//
//   Open {recipe}                         a Spotlight tap: the recipe's page
//   What's for dinner?                    tonight's meal and serve time, then the planner
//   Start cooking tonight's meal / {recipe}   cooking mode
//   Add {recipe} to the shopping list     online: the server scales and merges it
//   Add {day}'s meals to the shopping list    online, for the same reason
//   Plan {recipe} for {day}               an outbox mutation: works offline
//   Tick off {item}                       an outbox mutation: works offline
//   Start the timer for this step         cooking mode's step, through CookTimers (AlarmKit)
//
// Each one that changes something runs inside AppModel.awake, as it may run
// with the app in the background (Store/SharedStore.swift).

import AppIntents
import DishesCore
import Foundation

// MARK: Parameters

/// A day, as said: "today", "tomorrow" or a weekday (the next one, today included).
enum PlanDay: String, AppEnum {
    case today, tomorrow, monday, tuesday, wednesday, thursday, friday, saturday, sunday

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Day" }
    static var caseDisplayRepresentations: [PlanDay: DisplayRepresentation] {
        [.today: "Today", .tomorrow: "Tomorrow", .monday: "Monday", .tuesday: "Tuesday", .wednesday: "Wednesday",
         .thursday: "Thursday", .friday: "Friday", .saturday: "Saturday", .sunday: "Sunday"]
    }

    func date(from now: Date = Date()) -> Date {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        switch self {
        case .today: return today
        case .tomorrow: return calendar.date(byAdding: .day, value: 1, to: today)!
        default:
            let wanted = [PlanDay.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday].firstIndex(of: self)!
            let ahead = (wanted - Week.dayIndex(of: today) + 7) % 7
            return calendar.date(byAdding: .day, value: ahead, to: today)!
        }
    }

    /// "today", "tomorrow" or "on Friday", for a dialog.
    var spoken: String {
        switch self {
        case .today: "today"
        case .tomorrow: "tomorrow"
        default: "on \(rawValue.capitalized)"
        }
    }
}

enum MealTypeOption: String, AppEnum {
    case breakfast, lunch, dinner, dessert, snack

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Meal" }
    static var caseDisplayRepresentations: [MealTypeOption: DisplayRepresentation] {
        [.breakfast: "Breakfast", .lunch: "Lunch", .dinner: "Dinner", .dessert: "Dessert", .snack: "Snack"]
    }
}

enum DishesIntentError: Error, CustomLocalizedStringResourceConvertible {
    case signedOut, notSaved, offline, nothingPlanned(String), noSteps(String), noTimer

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .signedOut: "Open Dishes and sign in first."
        case .notSaved: "Dishes couldn’t save that on this device."
        case .offline: "Dishes needs a connection for that. Try again when you’re back online."
        case .nothingPlanned(let when): "Nothing’s planned \(when)."
        case .noSteps(let title): "\(title) has no steps to cook from."
        case .noTimer: "This step doesn’t have a timer."
        }
    }
}

/// Signed in, with the household's data on the device.
@MainActor private func readyApp() async throws -> AppModel {
    let app = AppModel.shared
    await app.start()
    guard app.phase == .ready else { throw DishesIntentError.signedOut }
    return app
}

// MARK: Tonight

struct WhatsForDinnerIntent: AppIntent {
    static var title: LocalizedStringResource { "What’s for Dinner" }
    static var description: IntentDescription { "Says what’s planned for tonight, and when it’s served." }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & OpensIntent {
        _ = try await readyApp()
        guard let meal = try await IntentData.tonight() else {
            return .result(opensIntent: OpenPlannerIntent(), dialog: "Nothing’s planned for tonight yet.")
        }
        let dishes = meal.dishes.count > 1 ? " — \(ListFormatter.localizedString(byJoining: meal.dishes))" : ""
        let dialog: IntentDialog = meal.serveAt.map { "Tonight it’s \(meal.title)\(dishes), served at \($0)." }
            ?? "Tonight it’s \(meal.title)\(dishes)."
        return .result(opensIntent: OpenPlannerIntent(), dialog: dialog)
    }
}

/// The planner on this week. Only opened by other intents ("What's for dinner?").
struct OpenPlannerIntent: AppIntent {
    static var title: LocalizedStringResource { "Open the Planner" }
    static var supportedModes: IntentModes { .foreground }
    static var isDiscoverable: Bool { false }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRequests.shared.showPlan = true
        return .result()
    }
}

// MARK: Recipes

/// A recipe tapped in Spotlight, or "Open {recipe}" in Shortcuts: its page.
struct OpenRecipeIntent: OpenIntent {
    static var title: LocalizedStringResource { "Open Recipe" }

    @Parameter(title: "Recipe")
    var target: RecipeEntity

    init() {}
    init(target: RecipeEntity) { self.target = target }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRequests.shared.openRecipe = target.id
        return .result()
    }
}

// MARK: Cooking

struct StartCookingIntent: AppIntent {
    static var title: LocalizedStringResource { "Start Cooking" }
    static var description: IntentDescription { "Opens cooking mode for a recipe, or for tonight’s whole meal." }
    static var supportedModes: IntentModes { .foreground }

    /// Leave empty for tonight's meal.
    @Parameter(title: "Recipe")
    var recipe: RecipeEntity?

    static var parameterSummary: some ParameterSummary {
        When(\.$recipe, .hasAnyValue) {
            Summary("Start cooking \(\.$recipe)")
        } otherwise: {
            Summary("Start cooking tonight’s meal")
        }
    }

    init() {}
    init(recipe: RecipeEntity?) { self.recipe = recipe }

    @MainActor
    func perform() async throws -> some IntentResult {
        _ = try await readyApp()
        if let recipe {
            guard try await IntentData.recipesById()[recipe.id]?.steps.isEmpty == false else {
                throw DishesIntentError.noSteps(recipe.title)
            }
            AppRequests.shared.cook = .recipe(recipe.id)
        } else {
            guard try await IntentData.tonight() != nil else { throw DishesIntentError.nothingPlanned("for tonight") }
            AppRequests.shared.cook = .tonight
        }
        return .result()
    }
}

/// "Set a timer for this" on cooking mode's step: the step's own timer, or a length said.
struct StartStepTimerIntent: AppIntent {
    static var title: LocalizedStringResource { "Start Step Timer" }
    static var description: IntentDescription { "Starts the timer for a step of the recipe you’re cooking." }

    @Parameter(title: "Step")
    var step: CookingStepEntity

    @Parameter(title: "Minutes", description: "Leave empty for the step’s own time.", inclusiveRange: (1, 600))
    var minutes: Int?

    static var parameterSummary: some ParameterSummary { Summary("Start a timer for \(\.$step)") { \.$minutes } }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let length = minutes ?? step.timerMinutes else { throw DishesIntentError.noTimer }
        let started = await CookTimers.shared.start(label: step.timerLabel ?? "Step \(step.number)", dish: step.recipe,
                                                    seconds: TimeInterval(length * 60), recipeId: step.recipeId, stepIndex: step.stepIndex)
        guard started else { return .result(dialog: "The timer for \(step.timerLabel ?? "step \(step.number)") is already running.") }
        return .result(dialog: "\(Format.minutes(length) ?? "\(length) min") timer started for \(step.timerLabel ?? "step \(step.number)").")
    }
}

// MARK: Planning

struct PlanRecipeIntent: AppIntent {
    static var title: LocalizedStringResource { "Plan a Recipe" }
    static var description: IntentDescription { "Puts a recipe on a day of the meal plan. Works offline." }

    @Parameter(title: "Recipe")
    var recipe: RecipeEntity

    @Parameter(title: "Day", default: .today)
    var day: PlanDay

    @Parameter(title: "Meal", default: .dinner)
    var meal: MealTypeOption

    static var parameterSummary: some ParameterSummary { Summary("Plan \(\.$recipe) for \(\.$meal) \(\.$day)") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = try await readyApp()
        let date = day.date()
        let saved = await app.awake {
            let done = await app.planRecipe(recipe.id, week: Week.containing(date), day: Week.dayIndex(of: date), mealType: meal.rawValue)
            if done { await app.syncNow(force: false) }
            return done
        }
        guard saved else { throw DishesIntentError.notSaved }
        return .result(dialog: "\(recipe.title) is planned for \(meal.rawValue) \(day.spoken).")
    }
}

// MARK: Shopping

struct AddRecipeToShoppingIntent: AppIntent {
    static var title: LocalizedStringResource { "Add Recipe to Shopping List" }
    static var description: IntentDescription { "Adds a recipe’s ingredients to the shopping list, skipping what the pantry has." }

    @Parameter(title: "Recipe")
    var recipe: RecipeEntity

    static var parameterSummary: some ParameterSummary { Summary("Add \(\.$recipe) to the shopping list") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = try await readyApp()
        let result = try await app.awake {
            do {
                let result = try await app.api.addRecipeToShopping(recipeId: recipe.id, servings: nil)
                await app.syncNow(force: false)
                return result
            } catch {
                throw app.online ? error : DishesIntentError.offline
            }
        }
        return .result(dialog: result.changed
            ? "Added \(recipe.title) to the shopping list."
            : "Everything for \(recipe.title) is already on the list or in the pantry.")
    }
}

struct AddDayToShoppingIntent: AppIntent {
    static var title: LocalizedStringResource { "Add a Day’s Meals to Shopping List" }
    static var description: IntentDescription { "Adds the ingredients for everything planned on a day to the shopping list." }

    @Parameter(title: "Day", default: .today)
    var day: PlanDay

    static var parameterSummary: some ParameterSummary { Summary("Add the meals \(\.$day) to the shopping list") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = try await readyApp()
        let meals = try await IntentData.meals(on: day.date())
        guard !meals.isEmpty else { throw DishesIntentError.nothingPlanned(day.spoken) }
        let added = try await app.awake {
            var added = 0
            do {
                for meal in meals {
                    // A combined meal goes as one (planner.groupToShopping); a single dish by its entry.
                    let result = if let group = meal.groupId {
                        try await app.api.action("planner.groupToShopping", [.string(group)], as: APIClient.ShoppingAddResult.self)
                    } else {
                        try await app.api.addEntryToShopping(entryId: meal.id)
                    }
                    added += result.added + result.merged
                }
            } catch {
                throw app.online ? error : DishesIntentError.offline
            }
            await app.syncNow(force: false)
            return added
        }
        let titles = ListFormatter.localizedString(byJoining: meals.map(\.title))
        return .result(dialog: added == 0
            ? "Everything for \(titles) is already on the list or in the pantry."
            : "Added \(titles) to the shopping list.")
    }
}

struct TickOffShoppingItemIntent: AppIntent {
    static var title: LocalizedStringResource { "Tick Off Shopping Item" }
    static var description: IntentDescription { "Ticks an item off the shopping list. Works offline." }

    @Parameter(title: "Item")
    var item: ShoppingItemEntity

    static var parameterSummary: some ParameterSummary { Summary("Tick off \(\.$item)") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let app = try await readyApp()
        let ticked = await app.awake {
            let done = await app.setShoppingItem(item.id, checked: true)
            if done { await app.syncNow(force: false) }
            return done
        }
        guard ticked else { throw DishesIntentError.notSaved }
        return .result(dialog: "Ticked off \(item.name).")
    }
}
