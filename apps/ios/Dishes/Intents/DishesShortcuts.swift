// The App Shortcuts: what Siri understands with no setup, and what Spotlight
// and the Shortcuts app show for Dishes. iOS allows ten.
//
// Every phrase names the app after "in" or "with" (or as the subject), never
// "my <name> shopping list": that's Siri's own Reminders grammar, so Siri
// looks for a Reminders list called "Dishes shopping" and answers "I didn't
// find a Dishes shopping list".
//
// Recipes and shopping items in a phrase come from their queries'
// suggestedEntities; `DishesShortcuts.updateAppShortcutParameters()` runs after
// each sync (AppModel.syncNow), so a new recipe or item is sayable.

import AppIntents

struct DishesShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddToShoppingListIntent(),
            phrases: [
                "Add to shopping in \(.applicationName)",
                "Add an item in \(.applicationName)",
                "Add shopping with \(.applicationName)",
                "Add something to \(.applicationName)",
            ],
            shortTitle: "Add to Shopping",
            systemImageName: "cart.badge.plus"
        )
        AppShortcut(
            intent: WhatsForDinnerIntent(),
            phrases: [
                "What’s for dinner in \(.applicationName)",
                "What’s for tea in \(.applicationName)",
                "What’s cooking tonight in \(.applicationName)",
                "Ask \(.applicationName) what’s for dinner",
            ],
            shortTitle: "What’s for Dinner",
            systemImageName: "fork.knife"
        )
        AppShortcut(
            intent: StartCookingIntent(),
            phrases: [
                "Start cooking tonight’s meal in \(.applicationName)",
                "Start cooking with \(.applicationName)",
                "Cook tonight’s dinner with \(.applicationName)",
            ],
            shortTitle: "Cook Tonight",
            systemImageName: "frying.pan"
        )
        AppShortcut(
            intent: StartCookingIntent(),
            phrases: [
                "Start cooking \(\.$recipe) in \(.applicationName)",
                "Cook \(\.$recipe) with \(.applicationName)",
            ],
            shortTitle: "Cook a Recipe",
            systemImageName: "book"
        )
        AppShortcut(
            intent: AddRecipeToShoppingIntent(),
            phrases: [
                "Add \(\.$recipe) to shopping in \(.applicationName)",
                "Shop for \(\.$recipe) with \(.applicationName)",
            ],
            shortTitle: "Shop for a Recipe",
            systemImageName: "cart"
        )
        AppShortcut(
            intent: AddDayToShoppingIntent(),
            phrases: [
                "Add \(\.$day)’s meals to shopping in \(.applicationName)",
                "Shop for \(\.$day) with \(.applicationName)",
                "Add the meals to shopping in \(.applicationName)",
            ],
            shortTitle: "Shop for a Day",
            systemImageName: "calendar.badge.plus"
        )
        AppShortcut(
            intent: PlanRecipeIntent(),
            phrases: [
                // One parameter per phrase, so the day comes from Siri asking (today by default).
                "Plan \(\.$recipe) in \(.applicationName)",
                "Plan a meal with \(.applicationName)",
            ],
            shortTitle: "Plan a Recipe",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: TickOffShoppingItemIntent(),
            phrases: [
                "Tick off \(\.$item) in \(.applicationName)",
                "I’ve got \(\.$item) in \(.applicationName)",
                "Tick something off in \(.applicationName)",
            ],
            shortTitle: "Tick Off an Item",
            systemImageName: "checkmark.circle"
        )
    }

    static var shortcutTileColor: ShortcutTileColor { .orange }
}
