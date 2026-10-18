// A combined meal's ⋯ menu on the planner, as the web's meal-group-card.tsx:
// add it to the shopping list, its cooking schedule, servings for everything,
// rename, move to another day, change the meal type, save it (or update the
// saved meal it came from), split it back into dishes, or remove it.
// Plan changes go through the sync queue, so they work offline; the shopping
// list, schedule and saved-meal actions need a connection.

import DishesCore
import SwiftUI

struct MealMenu: View {
    @Environment(AppModel.self) private var app
    @Environment(\.planActions) private var actions
    let meal: PlannedMeal
    @State private var sheet: Sheet?
    @State private var confirmRemove = false

    private enum Sheet: String, Identifiable { case schedule, servings, rename; var id: String { rawValue } }

    private static let days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    private static let types = ["breakfast", "lunch", "dinner", "dessert", "snack"]

    private var allOnList: Bool { !meal.dishes.isEmpty && meal.dishes.allSatisfy { $0.entry.addedToShoppingListAt != nil } }
    private var day: Int? { meal.dishes.first?.entry.dayOfWeek }

    var body: some View {
        Menu {
            Button(allOnList ? "Add meal to shopping list again" : "Add meal to shopping list", systemImage: "cart") {
                Task { await addToShopping() }
            }
            Button("Cooking schedule…", systemImage: "alarm") { sheet = .schedule }
            Button(meal.servings.map { "Servings for everything (\(Int($0)))" } ?? "Servings for everything",
                   systemImage: "person.2") { sheet = .servings }
            Button("Rename", systemImage: "pencil") { sheet = .rename }
            Menu("Move to…", systemImage: "calendar") {
                ForEach(0..<7, id: \.self) { i in
                    Button(Self.days[i]) { actions?.moveGroup(meal, i) }.disabled(i == day)
                }
            }
            Menu("Change meal type…", systemImage: "fork.knife") {
                ForEach(Self.types, id: \.self) { type in
                    Button(type.capitalized) { actions?.updateGroup(meal, ["mealType": .string(type)]) }
                        .disabled(type == meal.mealType)
                }
            }
            Divider()
            if meal.sourceMealId != nil {
                Button("Update saved meal to match", systemImage: "square.and.arrow.down") {
                    Task {
                        if await WebAction.run("meals.updateFromGroup", [.string(meal.id)],
                                               done: "\(meal.title ?? "Saved meal") now matches this plan.") { await app.syncNow() }
                    }
                }
            } else {
                Button("Save as a meal", systemImage: "bookmark") {
                    Task {
                        if await WebAction.run("meals.saveFromGroup", [.string(meal.id), .string(meal.title ?? "Meal")],
                                               done: "\(meal.title ?? "Meal") is now in your saved meals.") { await app.syncNow() }
                    }
                }
            }
            Button("Split into separate dishes", systemImage: "rectangle.split.1x2") { actions?.deleteGroup(meal, true) }
            Divider()
            Button("Remove meal", systemImage: "trash", role: .destructive) { confirmRemove = true }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 32, height: 32)
                .background(Theme.muted.opacity(0.7), in: Circle())
                .foregroundStyle(Theme.foreground)
        }
        .accessibilityLabel("Meal options")
        // A slip on a phone shouldn't take a whole meal off the plan.
        .confirmationDialog("Remove \(meal.title ?? "this meal")?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove all \(meal.dishes.count) dishes", role: .destructive) { actions?.deleteGroup(meal, false) }
            Button("Split into separate dishes instead") { actions?.deleteGroup(meal, true) }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .schedule:
                NavigationStack {
                    ScrollView { MealScheduleSection(groupId: meal.id).padding(20) }
                        .background(Theme.background)
                        .navigationTitle(meal.title ?? "Meal").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil }.bold() } }
                }
                .presentationDetents([.large])
            case .servings:
                ServingsSheet(initial: meal.servings) { actions?.updateGroup(meal, ["servings": $0.map { .number($0) } ?? .null]) }
                    .presentationDetents([.height(260)])
            case .rename:
                TextPromptSheet(title: "Rename meal", placeholder: "Meal name", text: meal.title ?? "") { name in
                    actions?.updateGroup(meal, ["title": .string(name)])
                    return true
                }
            }
        }
    }

    private func addToShopping() async {
        struct Result: Decodable, Sendable { var added: Int; var merged: Int; var skipped: [String] }
        do {
            let r = try await app.api.action("planner.groupToShopping", [.string(meal.id)], as: Result.self)
            let title = meal.title ?? "Meal"
            if r.added + r.merged == 0 {
                app.toast = r.skipped.isEmpty ? "These dishes have no ingredients." : "Nothing added — it’s all in your pantry."
            } else {
                let parts = [r.added > 0 ? "\(r.added) added" : nil, r.merged > 0 ? "\(r.merged) topped up" : nil,
                             r.skipped.isEmpty ? nil : "\(r.skipped.count) already in your pantry"].compactMap { $0 }
                app.toast = "\(title) added to shopping list — " + parts.joined(separator: " · ")
            }
            await app.syncNow()
        } catch { app.toast = WebAction.explain(error) }
    }
}

/// Servings for every dish in a meal at once.
private struct ServingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let initial: Double?
    var save: (Double?) -> Void
    @State private var servings = 4

    var body: some View {
        NavigationStack {
            Form {
                Stepper("\(servings) serving\(servings == 1 ? "" : "s")", value: $servings, in: 1...40)
                Text("Every dish in the meal is scaled to this.").font(.footnote).foregroundStyle(.secondary)
            }
            .navigationTitle("Servings for everything").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save(Double(servings)); dismiss() }.bold()
                }
            }
            .onAppear { servings = Int(initial ?? 4) }
        }
    }
}
