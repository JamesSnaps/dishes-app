// "Hey Siri, add to shopping in Dishes" — and the same action in
// Shortcuts, on the Action button and from a Shortcuts automation (an NFC tag
// on the fridge). It runs in the background without opening the app, and is
// an outbox mutation like the add card's, so it works with no signal and
// syncs when there is one.
//
// The item goes on exactly as spoken, as the integrations API's quick-add does
// ("2 pints of milk" is the item's name). App Shortcut phrases can't carry free
// text, so Siri asks "What do you want to add?".
//
// Not on the Watch: watchOS only runs intents from an app installed on the
// Watch. Until there's a Watch app, a Shortcut calling
// /api/integrations/shopping-list/quick-add covers it (API.md).

import AppIntents

struct AddToShoppingListIntent: AppIntent {
    static var title: LocalizedStringResource { "Add to Shopping List" }
    static var description: IntentDescription { "Adds an item to the household’s shopping list in Dishes." }

    @Parameter(title: "Item", requestValueDialog: "What do you want to add?")
    var item: String

    static var parameterSummary: some ParameterSummary { Summary("Add \(\.$item) to the shopping list") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let name = item.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw $item.needsValueError("What do you want to add?") }
        let app = AppModel.shared
        await app.start()
        guard app.phase == .ready else { throw ShoppingIntentError.signedOut }
        guard await app.addShoppingItem(name) else { throw ShoppingIntentError.notSaved }
        // Send it now: iOS may suspend the app before the debounced sync runs.
        await app.syncNow(force: false)
        let sent = app.status.state == .idle && app.status.pending == 0
        let dialog: IntentDialog = sent
            ? "Added \(name) to the shopping list."
            : "Added \(name). It’ll reach the list when Dishes is back online."
        return .result(dialog: dialog)
    }
}

enum ShoppingIntentError: Error, CustomLocalizedStringResourceConvertible {
    case signedOut, notSaved

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .signedOut: "Open Dishes and sign in first."
        case .notSaved: "Dishes couldn’t save that on this device."
        }
    }
}

struct DishesShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddToShoppingListIntent(),
            // Never "add to my <name> shopping list": that's Siri's own Reminders
            // grammar, so Siri looks for a Reminders list called "Dishes shopping"
            // and answers "I didn't find a Dishes shopping list". Naming the app
            // after "in" or "with" keeps the request Dishes'.
            phrases: [
                "Add to shopping in \(.applicationName)",
                "Add an item in \(.applicationName)",
                "Add shopping with \(.applicationName)",
                "Add something to \(.applicationName)",
            ],
            shortTitle: "Add to Shopping",
            systemImageName: "cart.badge.plus"
        )
    }

    static var shortcutTileColor: ShortcutTileColor { .orange }
}
