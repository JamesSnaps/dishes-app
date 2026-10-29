// Stats, Wrapped and the taste profile, as the web's /stats, /wrapped and
// /settings/taste. Read-only reports built by the web's own services.

import Charts
import DishesCore
import SwiftUI

// MARK: Stats

struct StatsData: Decodable, Sendable {
    struct Named: Decodable, Sendable, Identifiable, Hashable { var name: String; var count: Int; var id: String { name } }
    struct Top: Decodable, Sendable, Identifiable, Hashable { var id: String; var title: String; var count: Int }
    struct Bucket: Decodable, Sendable, Identifiable, Hashable {
        var label: String; var period: String; var meals: Int; var withNutrition: Int; var heartHealthy: Int
        var id: String { period }
    }
    struct Member: Decodable, Sendable, Identifiable, Hashable { var id: String; var name: String }
    struct Forgotten: Decodable, Sendable, Identifiable, Hashable { var id: String; var title: String; var lastEaten: String }
    struct Totals: Decodable, Sendable {
        var meals: Int; var cooksLogged: Int; var distinctRecipes: Int; var newRecipes: Int
        var avgRating: Double?; var avgCookMinutes: Int?; var libraryTotal: Int; var libraryAdded: Int
    }
    struct Proteins: Decodable, Sendable {
        var oilyFish: Double; var otherFish: Double; var poultry: Double; var pulses: Double; var redMeat: Double; var processedMeat: Double
    }
    struct Summary: Decodable, Sendable {
        var meals: Int; var withNutrition: Int; var heartHealthy: Int; var avgCalories: Double?
        var avgSaturatedFatG: Double?; var avgFiberG: Double?
    }
    struct Report: Decodable, Sendable {
        var range: String
        var person: String?
        var members: [Member]
        var from: String
        var to: String
        var heartFocus: Bool
        var totals: Totals
        var summary: Summary
        var proteinsPerWeek: Proteins
        var buckets: [Bucket]
        var topRecipes: [Top]
        var cuisines: [Named]
        var forgottenFavourites: [Forgotten]
        var neverEaten: Int
    }
    struct Spend: Decodable, Sendable {
        var orders: Int
        var total: Double
        var averagePerOrder: Double?
        var averagePerWeek: Double?
    }
    var report: Report
    var spend: Spend
}

struct StatsScreen: View {
    @State private var data = Remote<StatsData>("stats.report", [.string("3m")])
    @State private var range = "3m"
    @State private var person: String?
    @State private var showingWrapped = false

    var body: some View {
        WebPage(title: "Stats", subtitle: "What the household has been eating.", data: data, trailing: {
            NavigationLink { WrappedScreen() } label: {
                Label("Wrapped", systemImage: "gift")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.inkForeground)
                    .padding(.horizontal, 14).frame(height: 40)
                    .background(Theme.ink, in: Capsule())
            }
        }) { d in
            let r = d.report
            Picker("Range", selection: $range) {
                Text("4 weeks").tag("4w"); Text("3 months").tag("3m"); Text("12 months").tag("12m")
            }
            .pickerStyle(.segmented)
            if r.members.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip("Everyone", on: person == nil) { person = nil }
                        ForEach(r.members) { m in chip(m.name, on: person == m.id) { person = m.id } }
                    }
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                StatTile(value: "\(r.totals.meals)", label: "Meals planned")
                StatTile(value: "\(r.totals.cooksLogged)", label: "Cooks logged", tint: Theme.successTint.opacity(0.6))
                StatTile(value: "\(r.totals.distinctRecipes)", label: "Different recipes", tint: Theme.muted)
                StatTile(value: "\(r.totals.newRecipes)", label: "New to you", tint: Theme.highlight)
                if let rating = r.totals.avgRating {
                    StatTile(value: String(format: "%.1f★", rating / 2), label: "Average rating", tint: Theme.warningTint)
                }
                if let mins = r.totals.avgCookMinutes, let t = Format.minutes(mins) {
                    StatTile(value: t, label: "Average cook", tint: Theme.muted)
                }
                if d.spend.orders > 0 {
                    StatTile(value: String(format: "£%.0f", d.spend.total), label: "\(d.spend.orders) grocery orders", tint: Theme.successTint.opacity(0.6))
                }
            }
            if !r.buckets.isEmpty {
                WebSection(title: "Meals over time") {
                    Chart(r.buckets) { b in
                        BarMark(x: .value("Period", b.label), y: .value("Meals", b.meals))
                            .foregroundStyle(Theme.chart1)
                        if r.heartFocus {
                            BarMark(x: .value("Period", b.label), y: .value("Heart-healthy", b.heartHealthy))
                                .foregroundStyle(Theme.chart2)
                        }
                    }
                    .frame(height: 180)
                    .padding(14).card()
                }
            }
            HStack(alignment: .top, spacing: 12) {
                if !r.topRecipes.isEmpty {
                    WebSection(title: "Most cooked") {
                        CardList(items: Array(r.topRecipes.prefix(8))) { t in
                            NavigationLink(value: t.id) {
                                HStack { Text(t.title).lineLimit(1); Spacer(); Text("×\(t.count)").foregroundStyle(Theme.mutedForeground) }
                                    .font(.system(size: 14)).padding(.horizontal, 14).padding(.vertical, 10)
                            }.buttonStyle(.plain)
                        }
                    }
                }
                if !r.cuisines.isEmpty {
                    WebSection(title: "Cuisines") {
                        CardList(items: Array(r.cuisines.prefix(8))) { c in
                            HStack { Text(c.name.capitalizedFirst); Spacer(); Text("\(c.count)").foregroundStyle(Theme.mutedForeground) }
                                .font(.system(size: 14)).padding(.horizontal, 14).padding(.vertical, 10)
                        }
                    }
                }
            }
            WebSection(title: "Protein per week") {
                let p = r.proteinsPerWeek
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                    StatTile(value: Self.one(p.oilyFish), label: "Oily fish", tint: Theme.muted)
                    StatTile(value: Self.one(p.otherFish), label: "Other fish", tint: Theme.muted)
                    StatTile(value: Self.one(p.poultry), label: "Poultry", tint: Theme.warningTint)
                    StatTile(value: Self.one(p.pulses), label: "Pulses", tint: Theme.successTint.opacity(0.6))
                    StatTile(value: Self.one(p.redMeat), label: "Red meat", tint: Theme.highlight)
                    StatTile(value: Self.one(p.processedMeat), label: "Processed", tint: Theme.highlight)
                }
            }
            if !r.forgottenFavourites.isEmpty {
                WebSection(title: "Forgotten favourites") {
                    CardList(items: r.forgottenFavourites) { f in
                        NavigationLink(value: f.id) {
                            HStack {
                                Text(f.title).lineLimit(1)
                                Spacer()
                                Text("last \(DeliveriesScreen.short(f.lastEaten))").foregroundStyle(Theme.mutedForeground)
                            }
                            .font(.system(size: 14)).padding(.horizontal, 14).padding(.vertical, 10)
                        }.buttonStyle(.plain)
                    }
                }
            }
            if r.neverEaten > 0 {
                Text("\(r.neverEaten) recipes in the library haven’t been eaten yet.")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
        }
        .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
        .onChange(of: range) { reload() }
        .onChange(of: person) { reload() }
    }

    private func reload() {
        data.args = [.string(range)] + (person.map { [.string($0)] } ?? [])
        Task { await data.load() }
    }

    static func one(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }

    private func chip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 12).frame(height: 32)
                .foregroundStyle(on ? Theme.inkForeground : Theme.secondaryForeground)
                .background(on ? Theme.ink : Theme.secondary, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: Wrapped

struct WrappedData: Decodable, Sendable {
    struct Named: Decodable, Sendable, Identifiable, Hashable { var name: String; var count: Int; var id: String { name } }
    struct Top: Decodable, Sendable, Identifiable, Hashable { var id: String; var title: String; var count: Int }
    struct Totals: Decodable, Sendable {
        var meals: Int; var distinctRecipes: Int; var newRecipes: Int; var daysCooked: Int; var cuisines: Int
        var cooksLogged: Int; var minutesCooking: Int; var photos: Int; var recipesAdded: Int; var aiRecipesAdded: Int
    }
    struct Personality: Decodable, Sendable { var emoji: String; var title: String; var blurb: String }
    struct Quote: Decodable, Sendable { var text: String; var recipe: String; var date: String }
    struct Rated: Decodable, Sendable { var title: String; var rating: Double }
    var year: Int
    var years: [Int]
    var householdName: String
    var inProgress: Bool
    var totals: Totals
    var topRecipes: [Top]
    var topIngredients: [Named]
    var topCuisines: [Named]
    var months: [Int]
    var busiestMonth: Named?
    var favouriteDay: Named?
    var longestStreak: Int
    var topProtein: Named?
    var highestRated: Rated?
    var quote: Quote?
    var personality: Personality?
}

struct WrappedScreen: View {
    @State private var data: Remote<WrappedData>
    @State private var recap: String?
    @State private var writing = false

    private static let monthNames = Calendar.current.shortMonthSymbols

    /// A year to open on (the Wrapped banner, in January, plays the year just
    /// gone); otherwise the server's default.
    init(year: Int? = nil) {
        _data = State(initialValue: Remote("wrapped.report", year.map { [.number(Double($0))] } ?? []))
    }

    var body: some View {
        WebPage(title: "Wrapped", data: data) { w in
            VStack(alignment: .leading, spacing: 6) {
                Text("\(w.householdName)’s \(String(w.year))").font(.system(size: 28, weight: .heavy))
                if w.inProgress { Text("So far this year").font(.system(size: 14)).foregroundStyle(.white.opacity(0.85)) }
                if let p = w.personality {
                    Text("\(p.emoji) \(p.title)").font(.system(size: 20, weight: .bold)).padding(.top, 8)
                    Text(p.blurb).font(.system(size: 15)).foregroundStyle(.white.opacity(0.9))
                }
            }
            .foregroundStyle(.white)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            // Wrapped may be showy (DESIGN.md → Exceptions): terracotta into plum.
            .background(LinearGradient(colors: [Theme.chart1, Theme.chart5], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))

            if w.years.count > 1 {
                Picker("Year", selection: Binding(get: { w.year }, set: { y in data.args = [.number(Double(y))]; recap = nil; Task { await data.load() } })) {
                    ForEach(w.years, id: \.self) { Text(String($0)).tag($0) }
                }
                .pickerStyle(.segmented)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                StatTile(value: "\(w.totals.meals)", label: "Meals")
                StatTile(value: "\(w.totals.distinctRecipes)", label: "Different dishes", tint: Theme.muted)
                StatTile(value: "\(w.totals.daysCooked)", label: "Days cooked", tint: Theme.successTint.opacity(0.6))
                StatTile(value: "\(w.totals.cuisines)", label: "Cuisines", tint: Theme.highlight)
                StatTile(value: Format.minutes(w.totals.minutesCooking) ?? "0", label: "Time cooking", tint: Theme.warningTint)
                StatTile(value: "\(w.longestStreak)", label: "Longest streak (days)", tint: Theme.muted)
                StatTile(value: "\(w.totals.recipesAdded)", label: "Recipes added", tint: Theme.highlight)
                StatTile(value: "\(w.totals.photos)", label: "Photos", tint: Theme.muted)
            }

            WebSection(title: "By month") {
                Chart(Array(w.months.enumerated()), id: \.offset) { item in
                    BarMark(x: .value("Month", Self.monthNames[item.offset % 12]), y: .value("Meals", item.element))
                        .foregroundStyle(Theme.brand)
                }
                .frame(height: 160).padding(14).card()
            }

            VStack(alignment: .leading, spacing: 8) {
                if let m = w.busiestMonth { highlight("📅", "Busiest month", "\(m.name) · \(m.count) meals") }
                if let d = w.favouriteDay { highlight("🗓️", "Favourite day to cook", d.name) }
                if let p = w.topProtein { highlight("🍗", "Top protein", p.name.capitalizedFirst) }
                if let h = w.highestRated { highlight("⭐️", "Highest rated", "\(h.title) · \(String(format: "%.1f", h.rating / 2))/5") }
                if let q = w.quote { highlight("💬", "“\(q.text)”", q.recipe) }
            }

            HStack(alignment: .top, spacing: 12) {
                topList("Top dishes", w.topRecipes.prefix(5).map { ($0.title, $0.count) })
                topList("Top ingredients", w.topIngredients.prefix(5).map { ($0.name.capitalizedFirst, $0.count) })
            }
            topList("Top cuisines", w.topCuisines.prefix(5).map { ($0.name.capitalizedFirst, $0.count) })

            VStack(alignment: .leading, spacing: 10) {
                Label("Your year, in words", systemImage: "sparkles").font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                if let recap {
                    Text(recap).font(.system(size: 15))
                } else {
                    Button(writing ? "Writing…" : "Write our recap") {
                        Task {
                            writing = true; defer { writing = false }
                            if let r = try? await AppModel.shared.api.action("wrapped.recap", [.number(Double(w.year))], as: RecapReply.self) {
                                recap = r.recap
                            } else {
                                AppModel.shared.toast = "Couldn’t write the recap — is AI set up?"
                            }
                        }
                    }
                    .buttonStyle(.wide(.ink))
                    .disabled(writing)
                }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.muted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private struct RecapReply: Decodable, Sendable { var recap: String? }

    private func highlight(_ emoji: String, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 12) {
            Text(emoji).font(.system(size: 24))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 15, weight: .semibold))
                Text(detail).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            Spacer()
        }
        .padding(12).card()
    }

    private func topList(_ title: String, _ rows: [(String, Int)]) -> some View {
        WebSection(title: title) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                    if i > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                    HStack {
                        Text("\(i + 1)").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.brand).frame(width: 18)
                        Text(row.0).lineLimit(1)
                        Spacer()
                        Text("×\(row.1)").foregroundStyle(Theme.mutedForeground)
                    }
                    .font(.system(size: 14)).padding(.horizontal, 12).padding(.vertical, 9)
                }
            }
            .card()
        }
    }
}

// MARK: Taste profile

struct TasteData: Decodable, Sendable {
    struct Profile: Decodable, Sendable {
        var cuisines: [String: Double]
        var ingredients: [String: Double]
        var tags: [String: Double]
        var ratedCookCount: Int
        var updatedAt: String?
    }
    struct Suggested: Decodable, Sendable, Identifiable, Hashable {
        var id: String; var title: String; var cuisine: String?; var whyText: String?
    }
    var profile: Profile?
    var suggested: [Suggested]
}

struct TasteScreen: View {
    @State private var data = Remote<TasteData>("taste.get")
    @State private var confirmClear = false

    var body: some View {
        WebPage(title: "Taste profile", subtitle: "Learned from rated cooks; it steers AI suggestions.", data: data, trailing: {
            Menu {
                Button("Rebuild from cooks", systemImage: "arrow.clockwise") {
                    Task { if await WebAction.run("taste.refresh", done: "Taste profile rebuilt.") { await data.load() } }
                }
                Button("Clear", systemImage: "trash", role: .destructive) { confirmClear = true }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 16, weight: .semibold))
                    .frame(width: 38, height: 38).background(Theme.muted, in: Circle())
            }
            .foregroundStyle(Theme.foreground)
        }) { t in
            if let p = t.profile {
                Text("From \(p.ratedCookCount) rated cook\(p.ratedCookCount == 1 ? "" : "s").")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                weights("Cuisines", p.cuisines, tint: Theme.highlight)
                weights("Ingredients", p.ingredients, tint: Theme.successTint.opacity(0.6))
                weights("Tags", p.tags, tint: Theme.muted)
            } else {
                EmptyBox(emoji: "😋", message: "Rate a few cooks and your tastes appear here")
            }
            if !t.suggested.isEmpty {
                WebSection(title: "You might like") {
                    CardList(items: t.suggested) { s in
                        NavigationLink(value: s.id) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.title).font(.system(size: 15, weight: .medium))
                                if let why = s.whyText { Text(why).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
        .confirmationDialog("Clear the taste profile?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear", role: .destructive) {
                Task { if await WebAction.run("taste.clear") { await data.load() } }
            }
        } message: { Text("It’s rebuilt from your ratings as you log cooks.") }
    }

    private func weights(_ title: String, _ map: [String: Double], tint: Color) -> some View {
        let top = map.sorted { $0.value > $1.value }.prefix(12)
        return WebSection(title: title) {
            if top.isEmpty {
                Text("Nothing yet").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(Array(top), id: \.key) { item in
                        Text(item.key.capitalizedFirst).font(.system(size: 14, weight: .medium))
                            .padding(.horizontal, 12).frame(height: 32)
                            .background(tint, in: Capsule())
                    }
                }
            }
        }
    }
}
