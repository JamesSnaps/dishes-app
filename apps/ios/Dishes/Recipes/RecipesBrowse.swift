// Recipes' browse mode, which replaced the Home tab (James, 17 Oct 2026: Home
// was "just a collection of recipes mostly"). With no search, chip or filter
// on, Recipes shows tonight's meal and shelves of recipes instead of the whole
// grid; "See all" on a shelf turns on the chip or sort that lists the same
// recipes as a grid. The web's /recipes does the same (recipes-browse.tsx), so
// keep the shelves and their order in step.
//
// Everything but "Suggested for you" is read from the device, so it all works
// with no signal; the suggestions come from the server and are simply left
// out without one.

import DishesCore
import SwiftUI

struct RecipesBrowse: View {
    @Environment(\.horizontalSizeClass) private var width

    enum Shelf: Equatable { case favourites, cookAgain, recent, cuisine(String) }

    let recipes: [Recipe]
    /// When each recipe was last cooked, from the synced cook history.
    let lastCooked: [String: Date]
    let suggested: [TasteData.Suggested]
    let tonight: TonightCard.Meal?
    let cuisines: [(name: String, count: Int)]
    var seeAll: (Shelf) -> Void

    private static let perShelf = 12

    private var gutter: CGFloat { width == .regular ? 32 : 16 }
    private var cardWidth: CGFloat { width == .regular ? 210 : 165 }

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            TonightCard(meal: tonight)
            if let year = WrappedBanner.seasonYear { WrappedBanner(year: year) }

            shelf("Favourites", icon: "heart.fill", recipes: recipes.filter(\.isFavourite)) { seeAll(.favourites) }

            let cooked = recipes.filter { lastCooked[$0.id] != nil }
                .sorted { lastCooked[$0.id]! > lastCooked[$1.id]! }
            shelf("Cook again", icon: "clock.arrow.circlepath", iconColor: Theme.brand, recipes: cooked,
                  caption: { lastCooked[$0.id].map { "Cooked \($0.formatted(.relative(presentation: .named)))" } }) {
                seeAll(.cookAgain)
            }

            let byId = Dictionary(recipes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            let picks = suggested.compactMap { s in byId[s.id].map { (s, $0) } }
            shelf("Suggested for you", icon: "sparkles", iconColor: Color(hex: 0x8B5CF6), recipes: picks.map(\.1),
                  caption: { r in picks.first { $0.1.id == r.id }?.0.whyText }, seeAll: nil)

            shelf("Recently added", icon: nil, recipes: recipes.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }) {
                seeAll(.recent)
            }

            // The most used cuisines, once there are enough of a cuisine to browse.
            ForEach(cuisines.filter { $0.count >= 3 }.prefix(3), id: \.name) { cuisine in
                shelf(cuisine.name, icon: nil, recipes: recipes.filter { $0.cuisine == cuisine.name }) {
                    seeAll(.cuisine(cuisine.name))
                }
            }
        }
    }

    /// A titled row of cards that scrolls sideways, running to the screen's edges.
    @ViewBuilder
    private func shelf(_ title: String, icon: String?, iconColor: Color = Theme.heart, recipes: [Recipe],
                       caption: ((Recipe) -> String?)? = nil, seeAll: (() -> Void)?) -> some View {
        if !recipes.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: title, icon: icon, iconColor: iconColor, action: seeAll)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: width == .regular ? 18 : 12) {
                        let shown = Array(recipes.prefix(Self.perShelf))
                        ForEach(Array(shown.enumerated()), id: \.element.id) { index, recipe in
                            NavigationLink(value: recipe.id) {
                                VStack(alignment: .leading, spacing: 6) {
                                    RecipeCard(recipe: recipe)
                                    if let text = caption?(recipe) {
                                        Text(text)
                                            .font(.system(size: 12))
                                            .foregroundStyle(Theme.mutedForeground)
                                            .lineLimit(2)
                                            .multilineTextAlignment(.leading)
                                            .padding(.horizontal, 2)
                                    }
                                }
                                .frame(width: cardWidth)
                            }
                            .buttonStyle(.plain)
                            // The next few cards' photos, before they scroll in.
                            .onAppear { ImageCache.shared.prefetch(shown.dropFirst(index + 1).prefix(4).compactMap(\.thumbnailURL)) }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .contentMargins(.horizontal, gutter, for: .scrollContent)
                .padding(.horizontal, -gutter)
                .environment(\.recipeCardImageHeight, (cardWidth * 3 / 4).rounded())
            }
        }
    }
}

/// Dishes Wrapped, brought to the top of Recipes in December and January, as
/// the web does. The rest of the year it's under Settings → Insights.
struct WrappedBanner: View {
    let year: Int

    /// The year to play in Wrapped season: December's own, or January's last.
    static var seasonYear: Int? {
        let now = Calendar.current.dateComponents([.year, .month], from: Date())
        guard let year = now.year, let month = now.month else { return nil }
        return month == 12 ? year : month == 1 ? year - 1 : nil
    }

    var body: some View {
        NavigationLink { WrappedScreen(year: year) } label: {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("DISHES WRAPPED")
                        .font(.system(size: 12, weight: .bold))
                        .tracking(2)
                        .opacity(0.85)
                    Text("Your \(String(year)) in food is here ✨")
                        .font(.system(size: 21, weight: .heavy))
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Text("Play it →")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color(hex: 0xE11D48))
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(.white, in: Capsule())
            }
            .foregroundStyle(.white)
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [Color(hex: 0xC026D3), Color(hex: 0xF43F5E), Color(hex: 0xFB923C)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Color(hex: 0xF43F5E).opacity(0.3), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
    }
}

/// Tonight's meal, big enough to see from across the kitchen on an iPad: the
/// photo, what it is, when it's served, and Start cooking. A little smaller on
/// an iPhone, where it sits above the shelves. Once it's cooked (a cook logged
/// today for every dish), green and ticked, with the recipe instead. With
/// nothing planned, a way to the planner instead.
struct TonightCard: View {
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width

    struct Meal: Sendable {
        var request: CookRequest?
        var mealType: String
        var title: String
        var recipe: Recipe?
        var serveAt: String?
        var dishCount: Int
        /// Made already: nothing left to cook tonight.
        var cooked = false
        /// The main dish, else the first, for "View recipe" once it's cooked.
        var mainRecipeId: String?
        /// Not cooking tonight: eating out, a takeaway… (nothing else to cook).
        var out: OutsideMeal? = nil
    }

    let meal: Meal?

    @Sendable nonisolated static func load(_ r: StoreReader) throws -> Meal? {
        let data = try PlanData.load(r)
        guard case let (planned, cooked)? = data.tonight(cooked: PlanData.cookedToday(r)) else {
            // Nothing to cook — because they're out? Say so rather than "nothing planned".
            let now = Date()
            guard let out = data.notCooking("dinner", on: Week.dayIndex(of: now), in: Week.containing(now)) else { return nil }
            return Meal(request: nil, mealType: "dinner", title: out.label, recipe: nil, serveAt: nil, dishCount: 0, out: out)
        }
        let recipes = planned.dishes.compactMap(\.recipe)
        let cookable = CookDish.inStartOrder(recipes.filter { !$0.steps.isEmpty })
        return Meal(request: cookable.isEmpty ? nil : CookRequest(title: planned.title, groupId: planned.groupId, dishes: cookable),
                    mealType: planned.mealType,
                    title: planned.title ?? recipes.first?.title ?? "Tonight’s meal",
                    recipe: recipes.first(where: { $0.imageUrl != nil }) ?? recipes.first,
                    serveAt: planned.serveAt, dishCount: planned.dishes.count, cooked: cooked,
                    mainRecipeId: (planned.dishes.first { $0.entry.mealRole == "main" } ?? planned.dishes.first)?.recipe?.id)
    }

    private var large: Bool { width == .regular }

    var body: some View {
        if let meal {
            HStack(spacing: large ? 16 : 14) {
                if let recipe = meal.recipe {
                    RecipeImage(recipe: recipe)
                        .frame(width: large ? 112 : 84, height: large ? 112 : 84)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.white.opacity(0.35)))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Group {
                        if let out = meal.out {
                            Text("\(Image(systemName: "fork.knife")) TONIGHT · \(out.kind.label.uppercased())")
                        } else if meal.cooked {
                            Text("\(Image(systemName: "checkmark.circle.fill")) COOKED TONIGHT · \(meal.mealType.uppercased())")
                        } else {
                            Text("TONIGHT · \(meal.mealType.uppercased())")
                        }
                    }
                    .font(.system(size: 12, weight: .bold))
                    .tracking(0.8)
                    .opacity(0.85)
                    Text(meal.title)
                        .font(.system(size: large ? 22 : 18, weight: .bold))
                        .lineLimit(2)
                    HStack(spacing: 12) {
                        if let serveAt = meal.serveAt, !meal.cooked { Label("Serve at \(serveAt)", systemImage: "alarm") }
                        if meal.dishCount > 1 { Label("\(meal.dishCount) dishes", systemImage: "square.stack") }
                        if let time = Format.shortMinutes(meal.recipe?.totalMinutes), meal.dishCount == 1, !meal.cooked {
                            Label(time, systemImage: "clock")
                        }
                    }
                    .labelStyle(TightLabel())
                    .font(.system(size: 13, weight: .medium))
                    .opacity(0.9)
                    Spacer(minLength: 0)
                    HStack(spacing: 8) {
                        if meal.cooked, let id = meal.mainRecipeId {
                            Button { nav.openRecipe(id) } label: {
                                Label("View recipe", systemImage: "book.fill")
                                    .font(.system(size: 15, weight: .bold))
                                    .lineLimit(1)
                                    .fixedSize()
                                    .foregroundStyle(Color(hex: 0x047857)) // emerald-700 in both modes: it sits on white
                                    .padding(.horizontal, 16)
                                    .frame(height: large ? 40 : 36)
                                    .background(.white, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        } else if let request = meal.request {
                            Button { nav.cooking = request } label: {
                                Label("Start cooking", systemImage: "frying.pan.fill")
                                    .font(.system(size: 15, weight: .bold))
                                    .lineLimit(1)
                                    .fixedSize()
                                    .foregroundStyle(Theme.brandDeep)
                                    .padding(.horizontal, 16)
                                    .frame(height: large ? 40 : 36)
                                    .background(.white, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                        Button { nav.tab = .plan } label: {
                            Text("Plan")
                                .font(.system(size: 14, weight: .semibold))
                                .fixedSize()
                                .padding(.horizontal, 14)
                                .frame(height: large ? 40 : 36)
                                .background(.white.opacity(0.2), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(.white)
            .padding(large ? 16 : 14)
            .frame(maxWidth: .infinity, minHeight: large ? 144 : 112, alignment: .leading)
            .background((meal.cooked ? Theme.Gradient.emeraldTeal : .orangeRose).linear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: (meal.cooked ? Theme.Gradient.emeraldTeal.colors[0] : Theme.brand).opacity(0.3), radius: 12, y: 6)
        } else {
            Button { nav.tab = .plan } label: {
                HStack(spacing: 14) {
                    Image(systemName: "fork.knife")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.brand)
                        .frame(width: 48, height: 48)
                        .background(Theme.orange50, in: Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Nothing planned tonight").font(.system(size: 16, weight: .semibold))
                        Text("Pick something from your recipes in the planner")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                    Spacer()
                    Text("Plan tonight")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                        .background(Theme.brand, in: Capsule())
                }
                .foregroundStyle(Theme.foreground)
                .padding(16)
                .card()
            }
            .buttonStyle(.plain)
        }
    }
}
