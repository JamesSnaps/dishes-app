// What part a recipe plays in a meal, as the web's role badge and dialog
// (recipes/[id]/_components/recipe-role-bar.tsx): a badge in the recipe's
// meta row that opens this sheet to pick Main, Side, Sauce or Extra (tap the
// current one again to clear it), or to draft a side that goes with it.

import DishesCore
import SwiftUI

/// The badge in the meta row: "Main ✎", or a dashed "Set dish type" when unset.
struct RecipeRoleBadge: View {
    let role: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "fork.knife")
                Text(role.flatMap { RecipeCard.roleLabels[$0] } ?? "Set dish type")
                Image(systemName: "pencil")
            }
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .foregroundStyle(role == nil ? Color(light: 0xC2410C, dark: 0xFDBA74) : .white)
            .background {
                if role != nil {
                    Capsule().fill(LinearGradient(colors: [Color(hex: 0xF97316), Color(hex: 0xF43F5E)],
                                                  startPoint: .leading, endPoint: .trailing))
                } else {
                    Capsule().strokeBorder(Color(hex: 0xFB923C).opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(role.flatMap { RecipeCard.roleLabels[$0] }.map { "\($0) dish. Change" } ?? "Set what kind of dish this is")
    }
}

struct RecipeRoleSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    let generateSide: () -> Void
    @State private var role: String?
    @State private var saving = false

    private static let order = ["main", "side", "sauce", "other"]

    init(recipe: Recipe, generateSide: @escaping () -> Void) {
        self.recipe = recipe
        self.generateSide = generateSide
        _role = State(initialValue: recipe.mealRole)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("What kind of dish is this?").font(.system(size: 19, weight: .bold))
            Text("Sides, sauces and extras stay out of the planner’s standalone slots.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.mutedForeground)
            HStack(spacing: 8) {
                ForEach(Self.order, id: \.self) { option in
                    let active = role == option
                    Button { Task { await choose(option) } } label: {
                        Text(RecipeCard.roleLabels[option] ?? option)
                            .font(.system(size: 15, weight: active ? .semibold : .medium))
                            .padding(.horizontal, 16)
                            .frame(height: 36)
                            .foregroundStyle(active ? .white : Color(light: 0x7C2D12, dark: 0xFED7AA))
                            .background {
                                if active {
                                    Capsule().fill(LinearGradient(colors: [Color(hex: 0xF97316), Color(hex: 0xF43F5E)],
                                                                  startPoint: .leading, endPoint: .trailing))
                                } else {
                                    Capsule().fill(Theme.orange50)
                                    Capsule().strokeBorder(Color(hex: 0xFDBA74).opacity(0.8))
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .disabled(saving)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            Text(role.flatMap { RecipeCard.roleLabels[$0] }.map { "\($0). Tap it again to clear." }
                 ?? "Not marked yet, so the planner treats it as a main.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.mutedForeground)
            Button {
                dismiss()
                generateSide()
            } label: {
                Label("Generate a side dish", systemImage: "leaf")
            }
            .buttonStyle(GradientButtonStyle(gradient: .emeraldTeal))
            .frame(maxWidth: 280)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func choose(_ option: String) async {
        let previous = role
        let next: String? = role == option ? nil : option
        role = next
        saving = true
        defer { saving = false }
        let value: JSONValue = next.map { .string($0) } ?? .null
        if await WebAction.run("recipes.setMealRole", [.string(recipe.id), value]) {
            try? await app.engine.patchLocal(.recipes, id: recipe.id, ["mealRole": value])
        } else {
            role = previous
        }
    }
}
