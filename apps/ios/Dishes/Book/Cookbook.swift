// The household's recipes laid out as a book: a cover, contents, a chapter per
// cuisine, each recipe on its own spread, notes pages and an index.
//
// A recipe that fits takes one page opposite its photo — ingredients beside the
// method, the type a size or two smaller if that's what it takes (never below
// `minSize`). One that doesn't gets a full-page photo opposite its ingredients,
// then the method over the page, across as many pages as it needs. The photo
// swaps sides from one recipe to the next so flipping through isn't samey.
//
// Pages are measured with UIKit fonts that match the SwiftUI ones in
// CookbookPages.swift; change a size in one and change it in the other.

import DishesCore
import SwiftUI
import UIKit

/// A recipe with what the household has done with it.
struct BookRecipe: Sendable {
    let recipe: Recipe
    let cooks: Int
    let firstCooked: Date?
    let rating: Double?
    let notes: [BookNote]
}

struct BookNote: Hashable, Sendable {
    let text: String
    let pen: Pen
    let seed: String
}

struct BookEntry: Hashable, Sendable {
    let title: String
    let page: Int
}

enum BookPage: Sendable {
    case endpaper
    case cover(title: String)
    case contents([BookEntry])
    case chapter(name: String, number: Int, count: Int)
    case chapterList(name: String, entries: [BookEntry])
    /// A recipe's photo, as a print pasted onto the page with notes beneath (short recipes).
    case photo(BookRecipe, chapter: String)
    /// A recipe's photo across the whole page (long recipes).
    case fullPhoto(BookRecipe, chapter: String)
    /// The whole recipe on one page, at `size`.
    case recipe(BookRecipe, size: CGFloat, chapter: String)
    case ingredients(BookRecipe, size: CGFloat, chapter: String, notesFit: Bool)
    case method(BookRecipe, steps: [RecipeStep], first: Bool, chapter: String, notes: Bool)
    case notes
    case index([BookEntry])
}

struct Leaf: Identifiable, Sendable {
    let id: Int
    let page: BookPage
    /// The printed page number (nil on the cover and endpapers).
    let number: Int?
    /// Left-hand page of a spread.
    var isLeft: Bool { id % 2 == 0 }
}

struct Cookbook: Sendable {
    let leaves: [Leaf]

    /// Page geometry shared with the page views.
    struct Metrics: Sendable {
        let size: CGSize
        var inset: CGFloat { size.width < 360 ? 22 : 30 }
        var top: CGFloat { 30 }
        var bottom: CGFloat { 42 }
        var bodyWidth: CGFloat { size.width - inset * 2 }
        var bodyHeight: CGFloat { size.height - top - bottom }
    }

    static let minSize: CGFloat = 13
    static let maxSize: CGFloat = 16

    static func make(recipes: [BookRecipe], title: String, page: CGSize, spread: Bool) -> Cookbook {
        let m = Metrics(size: page)
        var pages: [(BookPage, Bool)] = []
        func pad() { if pages.count % 2 == 1 { pages.append((.notes, true)) } }

        // Chapters: cuisines by size, with the uncategorised last.
        let grouped = Dictionary(grouping: recipes) { $0.recipe.cuisine?.trimmingCharacters(in: .whitespaces).capitalized ?? "" }
        let chapters = grouped.keys.sorted { a, b in
            if a.isEmpty != b.isEmpty { return !a.isEmpty }
            let (ca, cb) = (grouped[a]!.count, grouped[b]!.count)
            return ca != cb ? ca > cb : a < b
        }

        pages.append((.endpaper, false))
        pages.append((.cover(title: title), false))
        let contentsAt = pages.count
        pages.append((.contents([]), true))
        pages.append((.notes, true))

        var chapterStarts: [BookEntry] = []
        var recipeStarts: [BookEntry] = []
        var recipeIndex = 0
        for (n, key) in chapters.enumerated() {
            let name = key.isEmpty ? "Everything else" : key
            let list = grouped[key]!.sorted { $0.recipe.title.localizedCaseInsensitiveCompare($1.recipe.title) == .orderedAscending }
            pad()
            chapterStarts.append(BookEntry(title: name, page: pages.count))
            pages.append((.chapter(name: name, number: n + 1, count: list.count), true))
            let listAt = pages.count
            pages.append((.chapterList(name: name, entries: []), true))
            var entries: [BookEntry] = []

            for book in list {
                pad()
                entries.append(BookEntry(title: book.recipe.title, page: pages.count))
                recipeStarts.append(BookEntry(title: book.recipe.title, page: pages.count))
                if let size = onePageSize(book, m) {
                    let photo: BookPage = .photo(book, chapter: name)
                    let text: BookPage = .recipe(book, size: size, chapter: name)
                    pages += recipeIndex % 2 == 0 ? [(photo, true), (text, true)] : [(text, true), (photo, true)]
                } else {
                    let size = ingredientsSize(book, m)
                    let notesFit = ingredientsHeight(book, size, m) + notesHeight(book, m) < m.bodyHeight - 40
                    pages.append((.fullPhoto(book, chapter: name), true))
                    pages.append((.ingredients(book, size: size, chapter: name, notesFit: notesFit), true))
                    let methodPages = paginate(book, m)
                    for (i, steps) in methodPages.enumerated() {
                        let last = i == methodPages.count - 1
                        pages.append((.method(book, steps: steps, first: i == 0, chapter: name, notes: last && !notesFit), true))
                    }
                }
                recipeIndex += 1
            }
            pages[listAt] = (.chapterList(name: name, entries: entries), true)
        }

        pad()
        let indexed = recipeStarts.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        let perPage = max(8, Int((m.bodyHeight - 60) / 22))
        stride(from: 0, to: max(indexed.count, 1), by: perPage).forEach { start in
            pages.append((.index(Array(indexed[start..<min(start + perPage, indexed.count)])), true))
        }
        pad()
        pages[contentsAt] = (.contents(chapterStarts), true)

        // Page numbers count from the cover's back, as a printed book does.
        var leaves: [Leaf] = []
        for (i, (page, numbered)) in pages.enumerated() {
            // One page at a time (folded, or held upright) needs no endpapers or padding.
            if !spread, case .endpaper = page { continue }
            if !spread, case .notes = page, i % 2 == 1 { continue }
            leaves.append(Leaf(id: spread ? i : leaves.count, page: page, number: numbered ? i : nil))
        }
        return Cookbook(leaves: leaves)
    }

    // MARK: Measuring

    static func height(_ text: String, _ font: UIFont, _ width: CGFloat, lineSpacing: CGFloat = 2) -> CGFloat {
        guard !text.isEmpty else { return 0 }
        let style = NSMutableParagraphStyle()
        style.lineSpacing = lineSpacing
        let rect = (text as NSString).boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude),
                                                   options: [.usesLineFragmentOrigin, .usesFontLeading],
                                                   attributes: [.font: font, .paragraphStyle: style], context: nil)
        return ceil(rect.height * 1.06)
    }

    static func ingredientLine(_ i: Ingredient) -> String {
        let amount = [i.amount, i.unit].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " ")
        let name = [i.name, i.preparation].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ")
        return [amount, name].filter { !$0.isEmpty }.joined(separator: " ") + (i.isOptional ? " (optional)" : "")
    }

    static func sortedSteps(_ r: Recipe) -> [RecipeStep] { r.steps.sorted { $0.position < $1.position } }
    static func sortedIngredients(_ r: Recipe) -> [Ingredient] { r.ingredients.sorted { $0.position < $1.position } }

    static func headerHeight(_ r: Recipe, _ size: CGFloat, _ width: CGFloat) -> CGFloat {
        14 + 8 // running head
            + height(r.title, Paper.uiSerif(size + 9, weight: .medium), width) + 6
            + height(r.description ?? "", Paper.uiSerif(size - 1, italic: true), width) + 8
            + 16 + 17 // serves/time line and rule
    }

    /// The type size at which the whole recipe fits on one page, if any.
    static func onePageSize(_ book: BookRecipe, _ m: Metrics) -> CGFloat? {
        let r = book.recipe
        let ingWidth = m.bodyWidth * 0.36
        let stepWidth = m.bodyWidth * 0.64 - 14 - 16
        for size in stride(from: maxSize - 1, through: minSize, by: -1) {
            let small = Paper.uiSerif(size - 1)
            let ing = sortedIngredients(r).reduce(CGFloat(0)) { $0 + height(ingredientLine($1), small, ingWidth) + 3 }
                + groupLabels(sortedIngredients(r).map(\.groupLabel)) * 22
            let steps = sortedSteps(r).reduce(CGFloat(0)) { $0 + height($1.instruction, small, stepWidth) + 7 }
                + groupLabels(sortedSteps(r).map(\.groupLabel)) * 22
            let total = headerHeight(r, size, m.bodyWidth) + max(ing, steps) + 26 // and "Cook this"
            if total <= m.bodyHeight { return size }
        }
        return nil
    }

    static func groupLabels(_ labels: [String?]) -> CGFloat {
        var count = 0
        var last: String?
        for label in labels where label != last {
            if label?.isEmpty == false { count += 1 }
            last = label
        }
        return CGFloat(count)
    }

    static func ingredientColumns(_ r: Recipe) -> Int { r.ingredients.count > 9 ? 2 : 1 }

    static func ingredientsHeight(_ book: BookRecipe, _ size: CGFloat, _ m: Metrics) -> CGFloat {
        let r = book.recipe
        let columns = ingredientColumns(r)
        let width = (m.bodyWidth - CGFloat(columns - 1) * 16) / CGFloat(columns)
        let all = sortedIngredients(r)
        let lines = all.reduce(CGFloat(0)) { $0 + height(ingredientLine($1), Paper.uiSerif(size - 1), width) + 3 }
            + groupLabels(all.map(\.groupLabel)) * 22
        return 14 + 8 + height(r.description ?? "", Paper.uiSerif(size, italic: true), m.bodyWidth) + 10 + 16 + 17
            + lines / CGFloat(columns) + 20 + 26
    }

    static func ingredientsSize(_ book: BookRecipe, _ m: Metrics) -> CGFloat {
        for size in stride(from: maxSize, through: minSize - 1, by: -1) where ingredientsHeight(book, size, m) <= m.bodyHeight {
            return size
        }
        return minSize - 1
    }

    static func notesHeight(_ book: BookRecipe, _ m: Metrics) -> CGFloat {
        guard !book.notes.isEmpty || book.cooks > 0 else { return 0 }
        return CGFloat(book.notes.count) * 46 + 40
    }

    static let methodSize: CGFloat = 15

    /// Steps split into pages, never mid-step.
    static func paginate(_ book: BookRecipe, _ m: Metrics) -> [[RecipeStep]] {
        let font = Paper.uiSerif(methodSize)
        let width = m.bodyWidth - 22
        var pages: [[RecipeStep]] = [[]]
        var used: CGFloat = 22 // running head
        var lastGroup: String?
        for step in sortedSteps(book.recipe) {
            var h = height(step.instruction, font, width) + 10
            if step.groupLabel != lastGroup, step.groupLabel?.isEmpty == false { h += 24 }
            if pages[pages.count - 1].isEmpty, pages.count == 1 { h += 24 } // the drop cap's extra line
            if used + h > m.bodyHeight - 30, !pages[pages.count - 1].isEmpty {
                pages.append([])
                used = 22
            }
            pages[pages.count - 1].append(step)
            used += h
            lastGroup = step.groupLabel
        }
        return pages
    }
}
