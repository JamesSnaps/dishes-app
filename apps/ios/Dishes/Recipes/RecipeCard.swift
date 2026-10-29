// The web's recipe card (app/(app)/recipes/_components/recipe-card.tsx), per
// DESIGN.md → Recipe card: a square photo on a plate with the favourite heart
// on it, a serif title under it and one line of meta ("45m · Japanese · Main").
// No card box.
//
// Cards in a row are stretched to the tallest (RecipeGrid), as the web's CSS grid does.

import DishesCore
import SwiftUI

extension EnvironmentValues {
    /// The photo's side for the card's column width (square), set by RecipeGrid. An
    /// aspect-ratio frame would shrink when the row stretches cards to equal height.
    @Entry var recipeCardImageHeight: CGFloat?
}

struct RecipeCard: View {
    @Environment(AppModel.self) private var app
    @Environment(\.recipeCardImageHeight) private var imageHeight
    let recipe: Recipe

    private var meta: String {
        [Format.shortMinutes(recipe.totalMinutes), recipe.cuisine, recipe.mealRole.flatMap { Self.roleLabels[$0] }]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if let imageHeight {
                    Color.clear.frame(maxWidth: .infinity).frame(height: imageHeight)
                } else {
                    Color.clear.aspectRatio(1, contentMode: .fit)
                }
            }
                .overlay { RecipeImage(recipe: recipe) }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    HeartButton(isFavourite: recipe.isFavourite) {
                        Task { await app.toggleFavourite(recipe) }
                    }
                    .padding(8)
                }

            VStack(alignment: .leading, spacing: 2) {
                Text(recipe.title)
                    .font(Theme.serif(16))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if !meta.isEmpty {
                    Text(meta)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.mutedForeground)
                        .lineLimit(1)
                }
                if let kcal = recipe.calories {
                    Label("\(Int(kcal)) kcal", systemImage: "flame")
                        .labelStyle(TightLabel())
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.mutedForeground)
                }
            }
            .padding(.horizontal, 2)
            .padding(.top, 8)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .contentShape(Rectangle())
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
    /// Rows sit further apart than columns: the titles under the photos need the room.
    private var rowSpacing: CGFloat { sizeClass == .regular ? 24 : 20 }
    private var columns: Int {
        sizeClass == .regular ? max(2, min(7, Int((width + spacing) / (200 + spacing)))) : 2
    }

    var body: some View {
        let columns = columns
        let columnWidth = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        let shown = maxRows.map { Array(recipes.prefix($0 * columns)) } ?? recipes
        let rows = stride(from: 0, to: shown.count, by: columns).map { Array(shown[$0..<min($0 + columns, shown.count)]) }
        LazyVStack(spacing: rowSpacing) {
            ForEach(Array(rows.enumerated()), id: \.element.first?.id) { n, row in
                HStack(alignment: .top, spacing: spacing) {
                    ForEach(row) { card($0).frame(maxWidth: .infinity, maxHeight: .infinity) }
                    ForEach(0..<(columns - row.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
                }
                .fixedSize(horizontal: false, vertical: true)
                // The next two rows' photos, before they scroll in.
                .onAppear { ImageCache.shared.prefetch(rows.dropFirst(n + 1).prefix(2).flatMap { $0 }.compactMap(\.thumbnailURL)) }
            }
        }
        .environment(\.recipeCardImageHeight, width > 0 ? columnWidth.rounded() : nil)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}
