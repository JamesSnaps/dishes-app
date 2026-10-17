// The web's recipe card (app/(app)/recipes/_components/recipe-card.tsx), line
// for line: a 4:3 photo or the muted utensils placeholder with the favourite
// heart in the corner, then title, two lines of description, role and cuisine
// badges, and kcal on the left with the total time on the right.
//
// Cards in a row are stretched to the tallest, with the time line pinned to the
// bottom — the web gets that from `h-full` on a CSS grid (RecipeGrid here).

import DishesCore
import SwiftUI

extension EnvironmentValues {
    /// The photo height for the card's column width (4:3), set by RecipeGrid. An
    /// aspect-ratio frame would shrink when the row stretches cards to equal height.
    @Entry var recipeCardImageHeight: CGFloat?
}

struct RecipeCard: View {
    @Environment(AppModel.self) private var app
    @Environment(\.recipeCardImageHeight) private var imageHeight
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if let imageHeight {
                    Color.clear.frame(maxWidth: .infinity).frame(height: imageHeight)
                } else {
                    Color.clear.aspectRatio(4.0 / 3.0, contentMode: .fit)
                }
            }
                .overlay { RecipeImage(recipe: recipe) }
                .clipped()
                .overlay(alignment: .topTrailing) {
                    HeartButton(isFavourite: recipe.isFavourite) {
                        Task { await app.toggleFavourite(recipe) }
                    }
                    .padding(8)
                }

            VStack(alignment: .leading, spacing: 0) {
                Text(recipe.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if let description = recipe.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.mutedForeground)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }
                if recipe.mealRole != nil || recipe.cuisine != nil {
                    HStack(spacing: 6) {
                        if let role = recipe.mealRole, let label = Self.roleLabels[role] { BadgeView(text: label) }
                        if let cuisine = recipe.cuisine { BadgeView(text: cuisine) }
                    }
                    .padding(.top, 8)
                }
                Spacer(minLength: 0)

                HStack(spacing: 4) {
                    if let kcal = recipe.calories {
                        Label("\(Int(kcal)) kcal", systemImage: "flame")
                    }
                    Spacer(minLength: 4)
                    if let time = Format.shortMinutes(recipe.totalMinutes) {
                        Label(time, systemImage: "clock")
                    }
                }
                .labelStyle(TightLabel())
                .font(.system(size: 12))
                .foregroundStyle(Theme.mutedForeground)
                .frame(height: 16)
                .padding(.top, 8)
            }
            .padding(12)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .card()
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    /// MEAL_ROLE_LABELS in @dishes/shared ("other" shows as Extra).
    static let roleLabels = ["main": "Main", "side": "Side", "sauce": "Sauce", "other": "Extra"]
}

/// Icon and text 4pt apart, icon slightly smaller — lucide's h-3 w-3 next to text-xs.
struct TightLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

/// The card grid the web uses: 2 columns on a phone, as many ~200pt columns as
/// fit on an iPad — up to 7 on a 13-inch in landscape, so the width the floating
/// tab bar leaves free is used. Each row is stretched to its tallest card
/// (`fixedSize` on the row), as a CSS grid row is; LazyVGrid can't do that.
/// `maxRows` shows only as many recipes as fill that many rows (Home's sections).
struct RecipeGrid<Card: View>: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let recipes: [Recipe]
    var maxRows: Int?
    @ViewBuilder let card: (Recipe) -> Card
    @State private var width: CGFloat = 0

    private var spacing: CGFloat { sizeClass == .regular ? 18 : 12 }
    private var columns: Int {
        sizeClass == .regular ? max(2, min(7, Int((width + spacing) / (200 + spacing)))) : 2
    }

    var body: some View {
        let columns = columns
        let columnWidth = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        let shown = maxRows.map { Array(recipes.prefix($0 * columns)) } ?? recipes
        let rows = stride(from: 0, to: shown.count, by: columns).map { Array(shown[$0..<min($0 + columns, shown.count)]) }
        LazyVStack(spacing: spacing) {
            ForEach(rows, id: \.first?.id) { row in
                HStack(alignment: .top, spacing: spacing) {
                    ForEach(row) { card($0).frame(maxWidth: .infinity, maxHeight: .infinity) }
                    ForEach(0..<(columns - row.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .environment(\.recipeCardImageHeight, width > 0 ? (columnWidth * 3 / 4).rounded() : nil)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}
