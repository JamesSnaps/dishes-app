// One recipe, laid out as the web's /recipes/[id]: title and heart, badges for
// cuisine, difficulty, time and servings, the servings stepper, Start Cooking,
// nutrition when there is some, then Overview / Ingredients / Steps tabs with
// the orange underline. When the page is wide enough (iPad landscape, or
// portrait without the sidebar) the ingredients sit beside the method instead
// of behind a tab — decided by the space, not the device.
//
// Scaling multiplies amounts and shows kitchen fractions; unit promotion
// (1000 g → 1 kg) comes with the lib/scale-ingredient.ts port (C2).

import DishesCore
import SwiftUI

struct RecipeDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    let recipeId: String
    @State private var recipe = Observed<Recipe?>(nil)
    @State private var servings: Double?
    @State private var tab = Tab.ingredients
    @State private var pageWidth: CGFloat = 0

    /// Room for a 330pt ingredients column and a readable method beside it.
    private var sideBySide: Bool { pageWidth >= 760 }

    enum Tab { case overview, ingredients, steps }

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
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let id = recipeId
            await recipe.follow(app.store) { r in try r.record(.recipes, id: id).flatMap(Recipe.init) }
        }
    }

    private func scale(_ recipe: Recipe) -> Double {
        guard let base = recipe.servings, base > 0 else { return 1 }
        return (servings ?? base) / base
    }

    private func content(_ recipe: Recipe) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if recipe.imageUrl != nil {
                    Color.clear
                        .aspectRatio(width == .regular ? 2.4 : 1.6, contentMode: .fit)
                        .overlay { RecipeImage(recipe: recipe, thumbnail: false) }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                header(recipe)
                controls(recipe)
                if recipe.calories != nil { nutrition(recipe) }

                if sideBySide {
                    overview(recipe)
                    HStack(alignment: .top, spacing: 28) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Ingredients").font(.system(size: 19, weight: .bold))
                            ingredients(recipe)
                        }
                        .frame(width: 330, alignment: .leading)
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Method").font(.system(size: 19, weight: .bold))
                            steps(recipe)
                        }
                    }
                } else {
                    tabs(recipe)
                    switch tab {
                    case .overview: overview(recipe)
                    case .ingredients: ingredients(recipe)
                    case .steps: steps(recipe)
                    }
                }
            }
            .padding(.horizontal, width == .regular ? 28 : 16)
            .padding(.vertical, 16)
            .frame(maxWidth: 1000)
            .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
    }

    // MARK: Header

    private func header(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text(recipe.title)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer(minLength: 4)
                Button {
                    Task { await app.toggleFavourite(recipe) }
                } label: {
                    Image(systemName: recipe.isFavourite ? "heart.fill" : "heart")
                        .font(.system(size: 22))
                        .foregroundStyle(recipe.isFavourite ? Theme.heart : Theme.mutedForeground)
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(recipe.isFavourite ? "Remove from favourites" : "Add to favourites")
            }
            HStack(spacing: 10) {
                if let cuisine = recipe.cuisine { BadgeView(text: cuisine) }
                if let difficulty = recipe.difficulty { BadgeView(text: difficulty.rawValue.capitalized, style: .outline) }
                if let time = Format.shortMinutes(recipe.totalMinutes) {
                    Label(time, systemImage: "clock").labelStyle(TightLabel())
                }
                if let base = recipe.servings {
                    Label("\(Format.amount(String(servings ?? base)) ?? "") \(recipe.servingsUnit ?? "servings")",
                          systemImage: "person.2")
                        .labelStyle(TightLabel())
                }
            }
            .font(.system(size: 14))
            .foregroundStyle(Theme.mutedForeground)
        }
    }

    private func controls(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let base = recipe.servings, base > 0 {
                let current = servings ?? base
                HStack(spacing: 14) {
                    Image(systemName: "person.2").foregroundStyle(Theme.mutedForeground)
                    Button { servings = max(1, current - 1) } label: { Image(systemName: "minus") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Fewer servings")
                    Text("\(Format.amount(String(current)) ?? "") \(recipe.servingsUnit ?? "servings")")
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                    Button { servings = min(50, current + 1) } label: { Image(systemName: "plus") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("More servings")
                }
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
            }
            Button {
                nav.cooking = CookRequest(dishes: [CookDish(recipe: recipe, scale: scale(recipe))])
            } label: {
                Label("Start Cooking", systemImage: "frying.pan")
            }
            .buttonStyle(.brand)
            .disabled(recipe.steps.isEmpty)
            .frame(maxWidth: width == .regular ? 360 : .infinity)
        }
    }

    /// The amber nutrition callout.
    private func nutrition(_ recipe: Recipe) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "flame").foregroundStyle(Color(hex: 0xEA580C))
            Text("Nutrition").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color(hex: 0x9A3412))
            Spacer()
            Text("\(Int(recipe.calories ?? 0)) kcal per serving")
                .font(.system(size: 14))
                .foregroundStyle(Theme.foreground.opacity(0.8))
        }
        .padding(14)
        .callout(Theme.amber50, Theme.orange50, border: Color(hex: 0xFDE68A))
    }

    // MARK: Tabs

    private func tabs(_ recipe: Recipe) -> some View {
        HStack(spacing: 0) {
            tabButton("Overview", .overview)
            tabButton("Ingredients (\(recipe.ingredients.count))", .ingredients)
            tabButton("Steps (\(recipe.steps.count))", .steps)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
    }

    private func tabButton(_ title: String, _ value: Tab) -> some View {
        Button { withAnimation(.snappy) { tab = value } } label: {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(tab == value ? Theme.brand : Theme.mutedForeground)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(tab == value ? Theme.brand : .clear).frame(height: 2)
                }
        }
        .buttonStyle(.plain)
    }

    private func overview(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let description = recipe.description, !description.isEmpty {
                Text(description).font(.system(size: 16)).foregroundStyle(Theme.foreground.opacity(0.75))
            }
            HStack(spacing: 28) {
                timeColumn("Prep", recipe.prepTimeMinutes)
                timeColumn("Cook", recipe.cookTimeMinutes)
                timeColumn("Total", recipe.totalMinutes)
                Spacer()
            }
            .padding(16)
            .background(Theme.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            if !recipe.tags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(recipe.tags, id: \.self) { BadgeView(text: $0) }
                }
            }
        }
    }

    private func timeColumn(_ label: String, _ minutes: Int?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.foreground)
            Text(Format.shortMinutes(minutes) ?? "—").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
        }
    }

    // MARK: Ingredients and steps

    private func ingredients(_ recipe: Recipe) -> some View {
        let scale = scale(recipe)
        return VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(grouped(recipe.ingredients, label: \.groupLabel).enumerated()), id: \.offset) { _, group in
                if let label = group.label {
                    Text(label).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.brand).padding(.top, 6)
                }
                ForEach(group.items) { ingredient in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle().fill(Theme.brand).frame(width: 6, height: 6)
                        let quantity = Text(Format.quantity(ingredient.amount, ingredient.unit, scale: scale))
                            .font(.system(size: 16, weight: .semibold))
                        let extra = Text([ingredient.preparation.map { ", \($0)" }, ingredient.isOptional ? " (optional)" : nil]
                            .compactMap { $0 }.joined())
                            .foregroundStyle(Theme.mutedForeground)
                        Text("\(quantity) \(ingredient.name)\(extra)")
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.foreground)
                    }
                }
            }
        }
    }

    private func steps(_ recipe: Recipe) -> some View {
        let numbered = recipe.steps.enumerated().map { NumberedStep(number: $0.offset + 1, step: $0.element) }
        return VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(grouped(numbered, label: \.step.groupLabel).enumerated()), id: \.offset) { _, group in
                if let label = group.label {
                    Text(label).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.brand)
                }
                ForEach(group.items) { item in
                    HStack(alignment: .top, spacing: 14) {
                        Text("\(item.number)")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.brandDeep)
                            .frame(width: 28, height: 28)
                            .background(Theme.orange50, in: Circle())
                            .overlay(Circle().strokeBorder(Color(hex: 0xFED7AA)))
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.step.instruction).font(.system(size: 16)).foregroundStyle(Theme.foreground)
                            if let minutes = Format.minutes(item.step.durationMinutes) {
                                Label([item.step.timerLabel, minutes].compactMap { $0 }.joined(separator: " · "),
                                      systemImage: "timer")
                                    .labelStyle(TightLabel())
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Theme.brandDeep)
                            }
                        }
                    }
                }
            }
        }
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
