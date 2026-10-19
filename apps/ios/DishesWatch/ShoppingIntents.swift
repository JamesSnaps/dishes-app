// "Add to shopping in Dishes" on the Watch — Siri on the wrist, Shortcuts,
// and the Action button on an Ultra. It runs without opening the app: the item
// goes to the phone like a tap in the list does (WatchModel.add), queued if the
// phone is out of reach. The iPhone's own AddToShoppingListIntent can't run on
// the Watch, which is why this one exists.

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
        let model = WatchModel.shared
        model.start()
        model.add(name)
        let dialog: IntentDialog = model.reachable
            ? "Added \(name) to the shopping list."
            : "Added \(name). It’ll reach the list when your iPhone is nearby."
        return .result(dialog: dialog)
    }
}

/// Opens the list (Shortcuts, the Action button).
struct OpenShoppingListIntent: AppIntent {
    static var title: LocalizedStringResource { "Open Shopping List" }
    static var description: IntentDescription { "Opens the shopping list in Dishes." }
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        WatchModel.shared.route = .shopping
        return .result()
    }
}

struct DishesWatchShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddToShoppingListIntent(),
            // Not "add to my <name> shopping list": Siri takes that for a Reminders
            // list (the iPhone's ShoppingIntents.swift has the story).
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
            intent: OpenShoppingListIntent(),
            phrases: ["Open shopping in \(.applicationName)", "Show shopping in \(.applicationName)"],
            shortTitle: "Shopping List",
            systemImageName: "cart"
        )
    }
}
