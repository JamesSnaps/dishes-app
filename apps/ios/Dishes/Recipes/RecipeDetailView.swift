// One recipe. On iPad (regular width) ingredients sit beside the steps, as the
// desktop web view does; at iPhone width they stack. Scaling multiplies
// amounts and shows kitchen fractions; unit promotion (1000 g → 1 kg) comes
// with the lib/scale-ingredient.ts port (C2).

import DishesCore
import SwiftUI

struct RecipeDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    let recipeId: String
    @State private var recipe = Observed<Recipe?>(nil)
    @State private var servings: Double?

    var body: some View {
        Group {
            if let recipe = recipe.value {
                content(recipe)
            } else if recipe.loaded {
                ContentUnavailableView("Recipe not found", systemImage: "book.closed",
                                       description: Text("It may have been deleted on another device."))
            } else {
                ProgressView()
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let id = recipeId
            await recipe.follow(app.store) { r in try r.record(.recipes, id: id).flatMap(Recipe.init) }
        }
    }

    private func content(_ recipe: Recipe) -> some View {
        let base = recipe.servings ?? 0
        let scale = base > 0 ? (servings ?? base) / base : 1
        return ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header(recipe)
                if width == .regular {
                    HStack(alignment: .top, spacing: 24) {
                        ingredients(recipe, scale: scale)
                            .frame(width: 340)
                        steps(recipe)
                    }
                } else {
                    ingredients(recipe, scale: scale)
                    steps(recipe)
                }
            }
            .padding(width == .regular ? 28 : 16)
            .frame(maxWidth: 1100)
            .frame(maxWidth: .infinity)
        }
        .toolbar {
            Button {
                Task { await app.toggleFavourite(recipe) }
            } label: {
                Label("Favourite", systemImage: recipe.isFavourite ? "heart.fill" : "heart")
            }
            .tint(recipe.isFavourite ? .red : nil)
        }
    }

    private func header(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            RecipeImage(recipe: recipe, thumbnail: false)
                .frame(height: width == .regular ? 320 : 220)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            Text(recipe.title)
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
            if let description = recipe.description, !description.isEmpty {
                Text(description).font(.title3).foregroundStyle(.secondary)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if let cuisine = recipe.cuisine { Chip(text: cuisine, systemImage: "globe.europe.africa") }
                    if let prep = Format.minutes(recipe.prepTimeMinutes) { Chip(text: "Prep \(prep)", systemImage: "knife") }
                    if let cook = Format.minutes(recipe.cookTimeMinutes) { Chip(text: "Cook \(cook)", systemImage: "flame") }
                    if let difficulty = recipe.difficulty { Chip(text: difficulty.rawValue.capitalized, systemImage: "chart.bar") }
                    if let calories = recipe.calories { Chip(text: "\(Int(calories)) kcal", systemImage: "bolt.heart") }
                }
            }
        }
    }

    private func ingredients(_ recipe: Recipe, scale: Double) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Ingredients").font(.title2.bold())
                Spacer()
                if let base = recipe.servings, base > 0 {
                    let current = servings ?? base
                    Stepper(value: Binding(get: { current }, set: { servings = max(1, $0) }), in: 1...50, step: 1) {
                        Text("\(Format.amount(String(current)) ?? "") \(recipe.servingsUnit ?? "servings")")
                            .font(.subheadline.weight(.semibold))
                            .monospacedDigit()
                    }
                    .fixedSize()
                }
            }
            ForEach(Array(grouped(recipe.ingredients, label: \.groupLabel).enumerated()), id: \.offset) { _, group in
                if let label = group.label { Text(label).font(.headline).padding(.top, 4) }
                ForEach(group.items) { ingredient in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle().fill(Theme.brand).frame(width: 7, height: 7)
                        let quantity = Text(Format.quantity(ingredient.amount, ingredient.unit, scale: scale))
                            .font(.body.weight(.semibold))
                            .monospacedDigit()
                        let extra = Text([ingredient.preparation.map { ", \($0)" }, ingredient.isOptional ? " (optional)" : nil]
                            .compactMap { $0 }.joined())
                            .foregroundStyle(.secondary)
                        Text("\(quantity) \(ingredient.name)\(extra)")
                    }
                }
            }
        }
        .padding(18)
        .card()
    }

    private func steps(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Method").font(.title2.bold())
            let numbered = Array(recipe.steps.enumerated())
            ForEach(Array(grouped(numbered.map { NumberedStep(number: $0.offset + 1, step: $0.element) },
                                  label: \.step.groupLabel).enumerated()), id: \.offset) { _, group in
                if let label = group.label { Text(label).font(.headline) }
                ForEach(group.items) { item in
                    HStack(alignment: .top, spacing: 14) {
                        Text("\(item.number)")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(Theme.brandGradient, in: Circle())
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.step.instruction).font(.body)
                            if let minutes = Format.minutes(item.step.durationMinutes) {
                                Label(item.step.timerLabel ?? minutes, systemImage: "timer")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(Theme.brandDeep)
                            }
                        }
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(tint: .teal)
    }
}

private struct NumberedStep: Identifiable {
    var number: Int
    var step: RecipeStep
    var id: String { step.id }
}

/// Consecutive runs that share a section label, in order (recipe sections).
private func grouped<T>(_ items: [T], label: KeyPath<T, String?>) -> [(label: String?, items: [T])] {
    var out: [(label: String?, items: [T])] = []
    for item in items {
        let l = item[keyPath: label]
        if let last = out.last, last.label == l { out[out.count - 1].items.append(item) } else { out.append((l, [item])) }
    }
    return out
}

struct Chip: View {
    let text: String
    let systemImage: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Theme.brand.opacity(0.14), in: Capsule())
            .foregroundStyle(Theme.brandDeep)
    }
}
