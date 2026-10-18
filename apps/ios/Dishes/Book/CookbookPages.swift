// One page of the cookbook. Type sizes and spacing here are what Cookbook.swift
// measures with; keep the two in step or text will run off the page.

import DishesCore
import SwiftUI

struct LeafView: View {
    let leaf: Leaf
    let spread: Bool
    let metrics: Cookbook.Metrics
    var cook: (Recipe) -> Void

    private var spine: HorizontalEdge? { spread ? (leaf.isLeft ? .trailing : .leading) : nil }

    var body: some View {
        switch leaf.page {
        case .endpaper:
            Endpaper(seed: "endpaper\(leaf.id)", spine: spine)
        case .cover(let title):
            CoverPage(title: title, spine: spine)
        case .fullPhoto(let book, let chapter):
            FullPhotoPage(book: book, chapter: chapter)
        default:
            page
        }
    }

    // MARK: Paper pages

    private var page: some View {
        content
            .padding(.horizontal, metrics.inset)
            .padding(.top, metrics.top)
            .padding(.bottom, metrics.bottom)
            .frame(width: metrics.size.width, height: metrics.size.height, alignment: .topLeading)
            .overlay { StainsLayer(stains: stains) }
            .overlay(alignment: leaf.isLeft || !spread ? .bottomLeading : .bottomTrailing) {
                if let number = leaf.number {
                    Text("\(number)")
                        .font(Paper.serif(11))
                        .foregroundStyle(Paper.faint)
                        .padding(.horizontal, metrics.inset)
                        .padding(.bottom, 16)
                }
            }
            .background { PaperTexture(seed: "page\(leaf.id)", spine: spine) }
            .clipped()
    }

    private var stains: [Stain] {
        switch leaf.page {
        case .photo(let b, _): Stains.on(page: b.recipe.id + ".photo", recipe: b.recipe, cooks: b.cooks)
        case .recipe(let b, _, _): Stains.on(page: b.recipe.id + ".recipe", recipe: b.recipe, cooks: b.cooks)
        case .ingredients(let b, _, _, _): Stains.on(page: b.recipe.id + ".ingredients", recipe: b.recipe, cooks: b.cooks)
        case .method(let b, let steps, _, _, _): Stains.on(page: b.recipe.id + ".method\(steps.first?.position ?? 0)", recipe: b.recipe, cooks: b.cooks)
        default: []
        }
    }

    @ViewBuilder
    private var content: some View {
        switch leaf.page {
        case .contents(let entries):
            ListPage(title: "Contents", entries: entries)
        case .chapter(let name, let number, let count):
            ChapterPage(name: name, number: number, count: count)
        case .chapterList(let name, let entries):
            ListPage(title: name, entries: entries)
        case .index(let entries):
            ListPage(title: "Index", entries: entries)
        case .notes:
            NotesPage()
        case .photo(let book, let chapter):
            PhotoPage(book: book, chapter: chapter, metrics: metrics)
        case .recipe(let book, let size, let chapter):
            OnePageRecipe(book: book, size: size, chapter: chapter, width: metrics.bodyWidth, cook: cook)
        case .ingredients(let book, let size, let chapter, let notesFit):
            IngredientsPage(book: book, size: size, chapter: chapter, notesFit: notesFit, metrics: metrics, cook: cook)
        case .method(let book, let steps, let first, _, let notes):
            MethodPage(book: book, steps: steps, first: first, notes: notes)
        case .endpaper, .cover, .fullPhoto:
            EmptyView()
        }
    }
}

// MARK: Pieces shared by the recipe pages

private struct RunningHead: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10.5, weight: .medium, design: .serif))
            .tracking(2)
            .foregroundStyle(Paper.faint)
            .lineLimit(1)
            .frame(height: 14, alignment: .leading)
            .padding(.bottom, 8)
    }
}

private struct Rule: View {
    var body: some View {
        Rectangle().fill(Paper.rule).frame(height: 1).padding(.vertical, 8)
    }
}

enum BookFormat {
    static func minutes(_ m: Int?) -> String? {
        guard let m, m > 0 else { return nil }
        let h = m / 60, r = m % 60
        let hours = h == 0 ? nil : h == 1 ? "1 hour" : "\(h) hours"
        let mins = r == 0 ? nil : "\(r) minutes"
        return [hours, mins].compactMap { $0 }.joined(separator: " ")
    }

    static func meta(_ r: Recipe) -> String {
        let serves = r.servings.map { "Serves \(Int($0.rounded()))" }
        return [serves, minutes(r.totalMinutes)].compactMap { $0 }.joined(separator: " · ")
    }

    /// 0–10 as stars, halves included: 9 → ★★★★½.
    static func stars(_ rating: Double) -> String {
        let halves = Int((rating).rounded())
        return String(repeating: "★", count: halves / 2) + (halves % 2 == 1 ? "½" : "")
    }

    static let firstMade: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMMM yyyy"
        return f
    }()
}

/// Tally, a heart for favourites and the household's stars: the marks by a title.
private struct TitleMarks: View {
    let book: BookRecipe

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            if book.recipe.isFavourite { ScribbledHeart() }
            if let rating = book.rating, rating >= 1 {
                Text(BookFormat.stars(rating))
                    .font(Pen.any(book.recipe.id + ".stars").font(0.9))
                    .foregroundStyle(Color(hex: 0xB03A2E).opacity(0.8))
                    .rotationEffect(.degrees(-4))
            }
            if book.cooks > 0 { Tally(count: min(book.cooks, 30), seed: book.recipe.id) }
        }
    }
}

/// The household's notes, then when it was first made.
private struct MarginNotes: View {
    let book: BookRecipe

    private func indent(_ seed: String) -> CGFloat {
        var rng = Seeded(seed + ".indent")
        return CGFloat.random(in: 0...18, using: &rng)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(book.notes, id: \.self) { note in
                Handwriting(text: note.text, pen: note.pen, seed: note.seed)
                    .padding(.leading, indent(note.seed))
            }
            if let first = book.firstCooked {
                Handwriting(text: "First made \(BookFormat.firstMade.string(from: first))",
                            pen: Pen.any(book.recipe.id + ".first"), seed: book.recipe.id + ".first", scale: 0.9)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }
}

private struct CookThis: View {
    let recipe: Recipe
    var cook: (Recipe) -> Void

    var body: some View {
        if !recipe.steps.isEmpty {
            Button { cook(recipe) } label: {
                Text("Cook this ⟶")
                    .font(Paper.serif(13).italic())
                    .foregroundStyle(Paper.accent)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}

private struct IngredientList: View {
    let ingredients: [Ingredient]
    let size: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(ingredients.enumerated()), id: \.element.id) { i, item in
                if let label = item.groupLabel, !label.isEmpty, i == 0 || ingredients[i - 1].groupLabel != label {
                    Text(label).font(Paper.serif(size - 1).italic()).foregroundStyle(Paper.soft).padding(.top, i == 0 ? 0 : 6)
                }
                line(item)
            }
        }
    }

    private func line(_ i: Ingredient) -> some View {
        let amount = [i.amount, i.unit].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " ")
        let rest = [i.name, i.preparation].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ")
            + (i.isOptional ? " (optional)" : "")
        let text = amount.isEmpty ? Text(rest) : Text("\(Text(amount).fontWeight(.semibold)) \(rest)")
        return text
            .font(Paper.serif(size - 1))
            .foregroundStyle(Paper.ink)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct StepList: View {
    let recipe: Recipe
    let steps: [RecipeStep]
    let size: CGFloat
    var dropCap = false

    /// Steps are numbered through the whole recipe, not per page.
    private func number(_ step: RecipeStep) -> Int {
        (Cookbook.sortedSteps(recipe).firstIndex { $0.id == step.id } ?? 0) + 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { i, step in
                if let label = step.groupLabel, !label.isEmpty, i == 0 || steps[i - 1].groupLabel != label {
                    Text(label).font(Paper.serif(size).italic()).foregroundStyle(Paper.soft).padding(.top, i == 0 ? 0 : 6)
                }
                if dropCap && i == 0, let first = step.instruction.first {
                    HStack(alignment: .top, spacing: 6) {
                        Text(String(first)).font(Paper.serif(size * 2.9)).foregroundStyle(Paper.accent)
                            .padding(.top, -size * 0.35)
                        Text(String(step.instruction.dropFirst()))
                            .font(Paper.serif(size)).foregroundStyle(Paper.ink).lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(number(step))")
                            .font(Paper.serif(size, .semibold)).foregroundStyle(Paper.accent)
                            .frame(width: 14, alignment: .trailing)
                        Text(step.instruction)
                            .font(Paper.serif(size)).foregroundStyle(Paper.ink).lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

// MARK: Recipe pages

/// The photo as a print pasted onto the page, notes underneath.
private struct PhotoPage: View {
    let book: BookRecipe
    let chapter: String
    let metrics: Cookbook.Metrics

    private var tilt: Double {
        var rng = Seeded(book.recipe.id + ".print")
        return Double.random(in: -2.2...2.2, using: &rng)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            RecipeImage(recipe: book.recipe, thumbnail: false)
                .frame(height: metrics.bodyHeight * 0.58)
                .padding(7)
                .background(Color(hex: 0xFBF8F1))
                .shadow(color: .black.opacity(0.22), radius: 5, x: 1, y: 3)
                .rotationEffect(.degrees(tilt))
                .padding(.top, 10)
            MarginNotes(book: book)
            Spacer(minLength: 0)
        }
    }
}

private struct FullPhotoPage: View {
    let book: BookRecipe
    let chapter: String

    var body: some View {
        RecipeImage(recipe: book.recipe, thumbnail: false)
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(chapter.uppercased())
                        .font(.system(size: 10.5, weight: .medium, design: .serif)).tracking(2)
                        .foregroundStyle(Color(hex: 0xE8D9B8))
                    Text(book.recipe.title)
                        .font(Paper.serif(27, .medium))
                        .foregroundStyle(Color(hex: 0xF6EEDC))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 22).padding(.vertical, 18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: 0x2E241B).opacity(0.8))
            }
    }
}

private struct OnePageRecipe: View {
    let book: BookRecipe
    let size: CGFloat
    let chapter: String
    let width: CGFloat
    var cook: (Recipe) -> Void

    var body: some View {
        let r = book.recipe
        VStack(alignment: .leading, spacing: 0) {
            RunningHead(text: chapter)
            HStack(alignment: .top) {
                Text(r.title)
                    .font(Paper.serif(size + 9, .medium)).foregroundStyle(Paper.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                TitleMarks(book: book).padding(.top, 4)
            }
            .padding(.bottom, 6)
            if let d = r.description, !d.isEmpty {
                Text(d).font(Paper.serif(size - 1).italic()).foregroundStyle(Paper.soft).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 8)
            }
            Text(BookFormat.meta(r).uppercased())
                .font(.system(size: 10.5, weight: .medium, design: .serif)).tracking(1)
                .foregroundStyle(Paper.faint).frame(height: 16, alignment: .leading)
            Rule()
            HStack(alignment: .top, spacing: 14) {
                IngredientList(ingredients: Cookbook.sortedIngredients(r), size: size)
                    .frame(width: width * 0.36, alignment: .leading)
                StepList(recipe: r, steps: Cookbook.sortedSteps(r), size: size - 1)
                    .frame(width: width * 0.64 - 14, alignment: .leading)
            }
            Spacer(minLength: 0)
            CookThis(recipe: r, cook: cook)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct IngredientsPage: View {
    let book: BookRecipe
    let size: CGFloat
    let chapter: String
    let notesFit: Bool
    let metrics: Cookbook.Metrics
    var cook: (Recipe) -> Void

    var body: some View {
        let r = book.recipe
        let all = Cookbook.sortedIngredients(r)
        let columns = Cookbook.ingredientColumns(r)
        let half = (all.count + 1) / 2
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                RunningHead(text: r.title)
                Spacer(minLength: 8)
                TitleMarks(book: book)
            }
            if let d = r.description, !d.isEmpty {
                Text(d).font(Paper.serif(size).italic()).foregroundStyle(Paper.soft).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 10)
            }
            Text(BookFormat.meta(r).uppercased())
                .font(.system(size: 10.5, weight: .medium, design: .serif)).tracking(1)
                .foregroundStyle(Paper.faint).frame(height: 16, alignment: .leading)
            Rule()
            if columns == 2 {
                HStack(alignment: .top, spacing: 16) {
                    IngredientList(ingredients: Array(all.prefix(half)), size: size).frame(maxWidth: .infinity, alignment: .leading)
                    IngredientList(ingredients: Array(all.dropFirst(half)), size: size).frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                IngredientList(ingredients: all, size: size)
            }
            if notesFit {
                MarginNotes(book: book).padding(.top, 22)
            }
            Spacer(minLength: 0)
            Text("Method overleaf ⟶")
                .font(Paper.serif(12).italic()).foregroundStyle(Paper.faint)
                .frame(maxWidth: .infinity, alignment: .trailing)
            CookThis(recipe: r, cook: cook)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MethodPage: View {
    let book: BookRecipe
    let steps: [RecipeStep]
    let first: Bool
    let notes: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RunningHead(text: "\(book.recipe.title) · Method")
            StepList(recipe: book.recipe, steps: steps, size: Cookbook.methodSize, dropCap: first)
            if notes {
                MarginNotes(book: book).padding(.top, 22)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: Front and back matter

private struct ListPage: View {
    let title: String
    let entries: [BookEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(Paper.serif(26, .medium)).foregroundStyle(Paper.ink).padding(.bottom, 10)
            if entries.isEmpty {
                Text("No recipes here yet.").font(Paper.serif(14).italic()).foregroundStyle(Paper.soft)
            }
            ForEach(entries, id: \.self) { entry in
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(entry.title).font(Paper.serif(14)).foregroundStyle(Paper.ink).lineLimit(1)
                    Line().stroke(Paper.rule, style: StrokeStyle(lineWidth: 1, dash: [1, 4])).frame(height: 1)
                    Text("\(entry.page)").font(Paper.serif(13)).foregroundStyle(Paper.faint)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: 0, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            return p
        }
    }
}

private struct ChapterPage: View {
    let name: String
    let number: Int
    let count: Int

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Text("CHAPTER \(number)").font(.system(size: 11, weight: .medium, design: .serif)).tracking(3).foregroundStyle(Paper.faint)
            Text(name).font(Paper.serif(38, .medium)).foregroundStyle(Paper.ink).multilineTextAlignment(.center)
            Text("❦").font(Paper.serif(22)).foregroundStyle(Paper.accent)
            Text(count == 1 ? "One recipe" : "\(count) recipes").font(Paper.serif(13).italic()).foregroundStyle(Paper.soft)
            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

/// A ruled page for the household's own notes — and how a spread is evened out.
private struct NotesPage: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Notes").font(Paper.serif(20).italic()).foregroundStyle(Paper.faint).padding(.bottom, 12)
            GeometryReader { geo in
                Path { p in
                    var y: CGFloat = 26
                    while y < geo.size.height {
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: geo.size.width, y: y))
                        y += 28
                    }
                }
                .stroke(Paper.rule.opacity(0.7), lineWidth: 0.8)
            }
        }
    }
}

private struct CoverPage: View {
    let title: String
    let spine: HorizontalEdge?

    private let gold = Color(hex: 0xD9B66A)

    var body: some View {
        ZStack {
            PaperTexture(seed: "cover", spine: spine, base: Color(hex: 0x5B2A26))
            RoundedRectangle(cornerRadius: 4).strokeBorder(gold.opacity(0.55), lineWidth: 1.5).padding(20)
            RoundedRectangle(cornerRadius: 2).strokeBorder(gold.opacity(0.35), lineWidth: 0.8).padding(26)
            VStack(spacing: 16) {
                Text("❦").font(Paper.serif(26)).foregroundStyle(gold)
                Text(title).font(Paper.serif(34, .medium)).foregroundStyle(gold).multilineTextAlignment(.center)
                Rectangle().fill(gold.opacity(0.6)).frame(width: 60, height: 1)
                Text("Recipes, notes and the odd splash of gravy")
                    .font(Paper.serif(14).italic()).foregroundStyle(gold.opacity(0.85)).multilineTextAlignment(.center)
            }
            .padding(46)
        }
    }
}

private struct Endpaper: View {
    let seed: String
    let spine: HorizontalEdge?

    var body: some View {
        ZStack {
            PaperTexture(seed: seed, spine: spine, base: Color(hex: 0xC9AE7A))
            Canvas { context, size in
                let step: CGFloat = 22
                var y: CGFloat = 0
                var row = 0
                while y < size.height + step {
                    var x: CGFloat = row % 2 == 0 ? 0 : step / 2
                    while x < size.width + step {
                        var p = Path()
                        p.move(to: CGPoint(x: x, y: y - 5))
                        p.addLine(to: CGPoint(x: x + 5, y: y))
                        p.addLine(to: CGPoint(x: x, y: y + 5))
                        p.addLine(to: CGPoint(x: x - 5, y: y))
                        p.closeSubpath()
                        context.stroke(p, with: .color(Color(hex: 0x7A5A2E).opacity(0.25)), lineWidth: 0.8)
                        x += step
                    }
                    y += step / 2
                    row += 1
                }
            }
        }
    }
}
