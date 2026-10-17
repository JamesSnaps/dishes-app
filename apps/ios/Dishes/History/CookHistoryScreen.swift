// Every logged cook in the household, newest first and grouped by month —
// the web's Memories wall (photos only) widened to every cook, with ratings,
// who ate it and notes. Reached from "Recently cooked" on Home. Read from the
// device, so it's all there offline.

import DishesCore
import SwiftUI

struct CookHistoryScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    @State private var data = Observed(CookHistoryData())
    @State private var photosOnly = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(title: "Cook history",
                           subtitle: "\(data.value.cookCount) \(data.value.cookCount == 1 ? "cook" : "cooks") · \(data.value.recipeCount) \(data.value.recipeCount == 1 ? "recipe" : "different recipes")") {
                    Toggle(isOn: $photosOnly) { Label("Photos", systemImage: "photo.on.rectangle") }
                        .toggleStyle(.button)
                        .tint(Theme.brand)
                }
                let months = data.value.months(photosOnly: photosOnly)
                if data.loaded && months.isEmpty {
                    EmptyBox(emoji: "📖", message: photosOnly ? "No cook photos yet" : "Nothing cooked yet — log a cook from a recipe")
                }
                ForEach(months, id: \.title) { month in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(month.title.uppercased())
                            .font(.system(size: 12, weight: .semibold))
                            .tracking(0.6)
                            .foregroundStyle(Theme.mutedForeground)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: 12, alignment: .top)], spacing: 12) {
                            ForEach(month.entries) { entry in
                                NavigationLink(value: entry.recipeId) {
                                    CookEntryCard(entry: entry, recipeTitle: data.value.titles[entry.recipeId] ?? "A recipe")
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, width == .regular ? 32 : 16)
            .padding(.vertical, 20)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await app.syncNow() }
        .task { await data.follow(app.store, CookHistoryData.load) }
    }
}

struct CookHistoryData: Sendable {
    struct Month: Sendable { var title: String; var entries: [CookEntry] }

    var entries: [CookEntry] = []
    var titles: [String: String] = [:]
    var cookCount: Int { entries.filter(\.isCook).count }
    var recipeCount: Int { Set(entries.map(\.recipeId)).count }

    @Sendable nonisolated static func load(_ r: StoreReader) throws -> CookHistoryData {
        CookHistoryData(
            entries: try r.records(.cookHistory).compactMap(CookEntry.init).sorted { $0.cookedAt > $1.cookedAt },
            titles: Dictionary(try r.records(.recipes).compactMap(Recipe.init).map { ($0.id, $0.title) },
                               uniquingKeysWith: { a, _ in a }))
    }

    func months(photosOnly: Bool) -> [Month] {
        let shown = photosOnly ? entries.filter { $0.photoUrl != nil } : entries
        var out: [Month] = []
        for entry in shown {
            let title = entry.cookedAt.formatted(.dateTime.month(.wide).year())
            if out.last?.title == title { out[out.count - 1].entries.append(entry) } else { out.append(Month(title: title, entries: [entry])) }
        }
        return out
    }
}
