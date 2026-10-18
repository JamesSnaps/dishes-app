// Book mode: the household's recipes as a cookbook you turn the pages of.
// Opens by itself when an iPhone Duo is half-folded and held like a book
// (Hinge.posture == .book), and from the Cookbook button on Recipes on any
// device. A wide screen shows a spread (two pages, the curl turning over the
// spine); a narrow one shows a page at a time. Reduce Motion slides instead.
//
//   .fullScreenCover(item: $nav.book) { CookbookView(request: $0) }

import DishesCore
import SwiftUI
import UIKit

/// Which recipes to bind into the book, and whether the hinge opened it.
struct BookRequest: Identifiable, Equatable {
    let id = UUID()
    /// nil for every recipe.
    var recipeIds: [String]?
    /// Opened by folding: closes again when the phone is opened flat.
    var byHinge = false
}

struct CookbookView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let request: BookRequest

    @State private var recipes = Observed<[Recipe]>([])
    @State private var cooks = Observed<[CookEntry]>([])
    @State private var notes = Remote<[NoteRow]>("notes.list")
    @State private var household = Remote<HouseholdName>("household.get")
    @State private var size: CGSize = .zero
    @State private var book: Cookbook?
    /// The printed page you're on, so a rebuild (new data, or folding to a
    /// spread) opens where you were rather than at the cover.
    @State private var onPage: Int?
    @State private var startAt = 0
    /// Counts rebuilds, so the page controller redraws once the new pages exist.
    @State private var edition = 0

    struct HouseholdName: Decodable, Sendable {
        struct Household: Decodable, Sendable { var name: String }
        var household: Household
    }

    private var spread: Bool { size.width > size.height * 1.05 }
    private var page: CGSize { CGSize(width: spread ? size.width / 2 : size.width, height: size.height) }

    /// Everything the layout depends on; the book is rebuilt when it changes.
    private var layoutKey: String {
        "\(Int(size.width))x\(Int(size.height)).\(recipes.value.count).\(cooks.value.count).\(notes.value?.count ?? -1).\(household.value?.household.name ?? "")"
    }

    var body: some View {
        ZStack {
            Paper.desk.ignoresSafeArea()
            if let book, size != .zero, recipes.loaded {
                PageCurl(count: book.leaves.count, spread: spread, slide: reduceMotion, version: "\(edition)", start: startAt,
                         turned: { i in onPage = book.leaves[i].number ?? onPage }) { i in
                    AnyView(LeafView(leaf: book.leaves[i], spread: spread, metrics: Cookbook.Metrics(size: page), cook: cook)
                        .environment(app)
                        .environment(nav))
                }
                .id("\(spread)\(reduceMotion)")
                .frame(width: size.width, height: size.height)
            } else {
                ProgressView().tint(Paper.page)
            }
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
        .overlay(alignment: .topTrailing) {
            Button { nav.book = nil } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Paper.ink.opacity(0.7))
                    .frame(width: 30, height: 30)
                    .background(Paper.page.opacity(0.85), in: Circle())
                    .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
            }
            .padding(10)
            .accessibilityLabel("Close the cookbook")
        }
        // The status bar stays: on the iPhone Duo hiding it gives up the column
        // the time and signal are drawn in, and the pages slide underneath them.
        .task(id: layoutKey) {
            guard size != .zero, recipes.loaded else { return }
            let made = Cookbook.make(recipes: bookRecipes, title: title, page: page, spread: spread)
            startAt = onPage.flatMap { n in made.leaves.firstIndex { ($0.number ?? -1) >= n } } ?? 0
            book = made
            edition += 1
        }
        .task {
            await recipes.follow(app.store) { r in try r.records(.recipes).compactMap(Recipe.init) }
        }
        .task { await cooks.follow(app.store) { r in try r.records(.cookHistory).compactMap(CookEntry.init) } }
        .task { await notes.load() }
        .task { await household.load() }
    }

    private var title: String {
        // Household names are already "James's Kitchen" and the like.
        household.value?.household.name ?? "Our Kitchen"
    }

    private var bookRecipes: [BookRecipe] {
        let wanted = request.recipeIds.map(Set.init)
        let members = Dictionary(app.members.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
        let byRecipe = Dictionary(grouping: cooks.value, by: \.recipeId)
        let notesByRecipe = Dictionary(grouping: (notes.value ?? []).filter { $0.recipeId != nil }, by: { $0.recipeId! })

        return recipes.value.filter { wanted?.contains($0.id) ?? true }.map { recipe in
            let entries = byRecipe[recipe.id] ?? []
            let made = entries.filter(\.isCook)
            let rated = entries.compactMap(\.rating)
            // Newest first: the household's own notes (in the writer's pen), then cook reviews.
            var written: [(Date, BookNote)] = []
            for note in notesByRecipe[recipe.id] ?? [] {
                let text = note.body.isEmpty ? note.title : note.body
                guard !text.isEmpty else { continue }
                let pen = note.authorId.flatMap { members[$0] }.map(Pen.member) ?? Pen.any(note.id)
                let date = ISO8601DateFormatter().date(from: note.updatedAt) ?? .distantPast
                written.append((date, BookNote(text: Self.clip(text), pen: pen, seed: note.id)))
            }
            for entry in entries {
                guard let text = entry.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { continue }
                written.append((entry.cookedAt, BookNote(text: Self.clip(text), pen: Pen.any(entry.id), seed: entry.id)))
            }
            return BookRecipe(recipe: recipe, cooks: made.count, firstCooked: made.map(\.cookedAt).min(),
                              rating: rated.isEmpty ? nil : rated.reduce(0, +) / Double(rated.count),
                              notes: written.sorted { $0.0 > $1.0 }.prefix(3).map(\.1))
        }
    }

    private static func clip(_ text: String) -> String {
        let flat = text.replacingOccurrences(of: "\n", with: " ")
        return flat.count > 90 ? String(flat.prefix(88)).trimmingCharacters(in: .whitespaces) + "…" : flat
    }

    private func cook(_ recipe: Recipe) {
        nav.book = nil
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            nav.cooking = CookRequest(dishes: [CookDish(recipe: recipe)])
        }
    }
}

/// UIPageViewController, for the real page curl. With `spread` it shows two
/// pages and curls over the spine (pages come in pairs: `count` is even); with
/// `slide` (Reduce Motion) it scrolls a spread or a page at a time instead.
struct PageCurl: UIViewControllerRepresentable {
    let count: Int
    let spread: Bool
    let slide: Bool
    /// Changes when the pages do: the controller then redraws at `start`.
    var version = ""
    /// The leaf to open on.
    var start = 0
    /// Called with the first leaf showing after each turn.
    var turned: (Int) -> Void = { _ in }
    let page: (Int) -> AnyView

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIPageViewController {
        let curl = !slide
        let options: [UIPageViewController.OptionsKey: Any] = curl
            ? [.spineLocation: NSNumber(value: (spread ? UIPageViewController.SpineLocation.mid : .min).rawValue)]
            : [.interPageSpacing: 0]
        context.coordinator.version = version
        let pages = UIPageViewController(transitionStyle: curl ? .pageCurl : .scroll,
                                         navigationOrientation: .horizontal, options: options)
        pages.isDoubleSided = curl && spread
        pages.dataSource = context.coordinator
        pages.delegate = context.coordinator
        pages.view.backgroundColor = .clear
        pages.setViewControllers(context.coordinator.opening(), direction: .forward, animated: false)
        return pages
    }

    func updateUIViewController(_ controller: UIPageViewController, context: Context) {
        context.coordinator.parent = self
        // The view controllers already on screen hold the old pages; swap them for the new ones.
        if context.coordinator.version != version {
            context.coordinator.version = version
            controller.setViewControllers(context.coordinator.opening(), direction: .forward, animated: false)
        }
    }

    @MainActor
    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: PageCurl

        var version = ""

        init(_ parent: PageCurl) { self.parent = parent }

        /// The view controllers to show at `start`: a pair for a curled spread.
        func opening() -> [UIViewController] {
            let start = parent.start
            if !parent.slide && parent.spread {
                let left = max(0, min(start - start % 2, parent.count - 2))
                return [unit(left), unit(left + 1)]
            }
            return [unit(max(0, min(paired ? start / 2 : start, unitCount - 1)))]
        }

        /// Sliding a spread moves both pages together, so a unit is a pair.
        private var paired: Bool { parent.slide && parent.spread }
        var unitCount: Int { paired ? (parent.count + 1) / 2 : parent.count }

        func unit(_ i: Int) -> UIViewController {
            let view: AnyView = paired
                ? AnyView(HStack(spacing: 0) {
                    parent.page(i * 2)
                    if i * 2 + 1 < parent.count { parent.page(i * 2 + 1) }
                })
                : parent.page(i)
            let host = PageHost(rootView: view)
            // Pages are laid out to an exact size (Cookbook.Metrics); the book
            // already sits inside the safe area, so no extra insets here.
            host.safeAreaRegions = []
            host.index = i
            host.view.backgroundColor = .clear
            return host
        }

        func pageViewController(_ pvc: UIPageViewController, viewControllerBefore vc: UIViewController) -> UIViewController? {
            guard let i = (vc as? PageHost)?.index, i > 0 else { return nil }
            return unit(i - 1)
        }

        func pageViewController(_ pvc: UIPageViewController, viewControllerAfter vc: UIViewController) -> UIViewController? {
            guard let i = (vc as? PageHost)?.index, i + 1 < unitCount else { return nil }
            return unit(i + 1)
        }

        func pageViewController(_ pvc: UIPageViewController, didFinishAnimating finished: Bool,
                                previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
            guard completed, let i = (pvc.viewControllers?.first as? PageHost)?.index else { return }
            parent.turned(paired ? i * 2 : i)
        }
    }

    final class PageHost: UIHostingController<AnyView> {
        var index = 0
    }
}
