// Home, as the web's /home: a time-of-day greeting, search, favourites, the
// "What we've been eating" banner and recently added recipes — plus, first of
// all, tonight's meal as a large card with Start cooking (the bottom pill was
// too easy to miss on an iPad). Everything is read from the device, so it's
// all there with no signal. Sections fill the full width: as many cards as fit
// in one row on iPad, two rows of two on iPhone.

import DishesCore
import SwiftUI

struct HomeScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.openURL) private var openURL
    @State private var recipes = Observed<[Recipe]>([])
    @State private var tonight = Observed<TonightCard.Meal?>(nil)
    @State private var history = Observed(CookHistoryData())
    @State private var showHistory = false
    @State private var pageWidth: CGFloat = 0

    private var firstName: String {
        app.me?.user.displayName.split(separator: " ").first.map(String.init) ?? "there"
    }

    /// apps/web/app/(app)/home/page.tsx: before 12, before 18, after.
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    }

    private var rows: Int { width == .regular ? 1 : 2 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    header
                    searchRow

                    // Tonight and the stats banner side by side when there's room.
                    if pageWidth >= 900 {
                        HStack(alignment: .top, spacing: 18) {
                            TonightCard(meal: tonight.value)
                            statsBanner.frame(width: 340)
                        }
                    } else {
                        TonightCard(meal: tonight.value)
                    }

                    let favourites = recipes.value.filter(\.isFavourite)
                    if !favourites.isEmpty {
                        section("Favourites", icon: "heart.fill", recipes: favourites) {
                            nav.showRecipes(favourites: true)
                        }
                    }

                    if pageWidth < 900 { statsBanner }

                    recentlyCooked

                    let recent = recipes.value.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
                    if !recent.isEmpty {
                        section("Recently Added", icon: nil, recipes: recent) {
                            nav.showRecipes()
                        }
                    }
                }
                .padding(.horizontal, width == .regular ? 32 : 16)
                .padding(.vertical, 20)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
            }
            .background(Theme.background)
            .refreshable { await app.syncNow() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
            .navigationDestination(isPresented: $showHistory) { CookHistoryScreen() }
        }
        .task {
            await recipes.follow(app.store) { r in try r.records(.recipes).compactMap(Recipe.init) }
        }
        .task { await tonight.follow(app.store, TonightCard.load) }
        .task { await history.follow(app.store, CookHistoryData.load) }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(greeting), \(firstName)")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.foreground)
                Text("What shall we cook today?")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.mutedForeground)
            }
            Spacer()
            // On iPhone the avatar is the way into settings, as on the web.
            if width != .regular, let me = app.me {
                Button { nav.tab = .more } label: { Avatar(name: me.user.displayName, size: 42) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Settings")
            }
        }
    }

    /// The last few cooks, with their stars; "See all" opens the full history.
    @ViewBuilder
    private var recentlyCooked: some View {
        let cooks = Array(history.value.entries.filter(\.isCook).prefix(width == .regular ? 3 : 2))
        if !cooks.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Recently cooked", icon: "clock.arrow.circlepath", iconColor: Theme.brand) {
                    showHistory = true
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12, alignment: .top)], spacing: 12) {
                    ForEach(cooks) { entry in
                        NavigationLink(value: entry.recipeId) {
                            CookEntryCard(entry: entry, recipeTitle: history.value.titles[entry.recipeId] ?? "A recipe")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// Looks like the web's search box; tapping it opens Recipes ready to search.
    private var searchRow: some View {
        Button { nav.showRecipes() } label: {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                Text("Search recipes, ingredients…")
                Spacer()
            }
            .font(.system(size: 15))
            .foregroundStyle(Theme.mutedForeground)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Theme.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func section(_ title: String, icon: String?, recipes: [Recipe], seeAll: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: title, icon: icon, action: seeAll)
            RecipeGrid(recipes: recipes, maxRows: rows) { recipe in
                NavigationLink(value: recipe.id) { RecipeCard(recipe: recipe) }
                    .buttonStyle(.plain)
            }
        }
    }

    /// bg-gradient-to-r from-orange-500 to-rose-500, opening Stats.
    private var statsBanner: some View {
        NavigationLink {
            StatsScreen()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("What we’ve been eating").font(.system(size: 15, weight: .semibold))
                    Text("Stats, heart health, who ate what and your Wrapped")
                        .font(.system(size: 12))
                        .opacity(0.85)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Text("See stats →")
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.2), in: Capsule())
            }
            .foregroundStyle(.white)
            .padding(16)
            .frame(maxHeight: .infinity)
            .background(Theme.Gradient.orangeRose.linear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
    }
}

/// Tonight's meal, big enough to see from across the kitchen: the photo, what
/// it is, when it's served, and Start cooking. With nothing planned, a way to
/// the planner instead.
struct TonightCard: View {
    @Environment(AppNav.self) private var nav

    struct Meal: Sendable {
        var request: CookRequest?
        var mealType: String
        var title: String
        var recipe: Recipe?
        var serveAt: String?
        var dishCount: Int
    }

    let meal: Meal?

    @Sendable nonisolated static func load(_ r: StoreReader) throws -> Meal? {
        let data = try PlanData.load(r)
        let meals = data.meals(on: Week.todayIndex, in: Week.containing(Date()))
        guard let planned = meals.first(where: { $0.mealType == "dinner" }) ?? meals.last else { return nil }
        let recipes = planned.dishes.compactMap(\.recipe)
        let cookable = recipes.filter { !$0.steps.isEmpty }.map { CookDish(recipe: $0) }
        return Meal(request: cookable.isEmpty ? nil : CookRequest(title: planned.title, dishes: cookable),
                    mealType: planned.mealType,
                    title: planned.title ?? recipes.first?.title ?? "Tonight’s meal",
                    recipe: recipes.first(where: { $0.imageUrl != nil }) ?? recipes.first,
                    serveAt: planned.serveAt, dishCount: planned.dishes.count)
    }

    var body: some View {
        if let meal {
            HStack(spacing: 16) {
                if let recipe = meal.recipe {
                    RecipeImage(recipe: recipe)
                        .frame(width: 112, height: 112)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.white.opacity(0.35)))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("TONIGHT · \(meal.mealType.uppercased())")
                        .font(.system(size: 12, weight: .bold))
                        .tracking(0.8)
                        .opacity(0.85)
                    Text(meal.title)
                        .font(.system(size: 22, weight: .bold))
                        .lineLimit(2)
                    HStack(spacing: 12) {
                        if let serveAt = meal.serveAt { Label("Serve at \(serveAt)", systemImage: "alarm") }
                        if meal.dishCount > 1 { Label("\(meal.dishCount) dishes", systemImage: "square.stack") }
                        if let time = Format.shortMinutes(meal.recipe?.totalMinutes), meal.dishCount == 1 {
                            Label(time, systemImage: "clock")
                        }
                    }
                    .labelStyle(TightLabel())
                    .font(.system(size: 13, weight: .medium))
                    .opacity(0.9)
                    Spacer(minLength: 0)
                    if let request = meal.request {
                        Button { nav.cooking = request } label: {
                            Label("Start cooking", systemImage: "frying.pan.fill")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.brandDeep)
                                .padding(.horizontal, 16)
                                .frame(height: 40)
                                .background(.white, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(.white)
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 144, alignment: .leading)
            .background(Theme.Gradient.orangeRose.linear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Theme.brand.opacity(0.3), radius: 12, y: 6)
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
                    Text("Plan a meal")
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

