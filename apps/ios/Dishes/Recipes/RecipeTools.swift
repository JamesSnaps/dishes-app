// The recipe page's tools from the web: AI tweaks (improve with an
// instruction, make heart-healthy — previewed, then applied or saved as a
// copy), ideas for similar dishes or sides, a generated photo, estimated
// nutrition, a share link or email, and a note about the recipe.

import DishesCore
import SwiftUI

/// The web's GeneratedRecipe: what the AI tools take and answer.
struct DraftRecipe: Codable, Sendable, Hashable {
    struct Ingredient: Codable, Sendable, Hashable {
        var ingredientName: String; var amount: String; var unit: String
        var preparation: String; var isOptional: Bool; var groupLabel: String
    }
    struct Step: Codable, Sendable, Hashable {
        var instruction: String; var durationMinutes: String; var timerLabel: String; var groupLabel: String
    }
    var title: String
    var description: String
    var cuisine: String
    var difficulty: String
    var prepTimeMinutes: Int?
    var cookTimeMinutes: Int?
    var servings: String
    var servingsUnit: String
    var mealRole: String?
    var mealTypes: [String]
    var tags: [String]
    var ingredients: [Ingredient]
    var steps: [Step]
    var notes: String?
    var nutrition: JSONValue?
}

struct TweakReply: Decodable, Sendable { var recipe: DraftRecipe?; var summary: String?; var heartHealthy: Bool? }

/// Improve (with an instruction) or make heart-healthy: the change, previewed.
struct RecipeTweakSheet: View {
    enum Kind { case improve, heartHealthy }
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    let kind: Kind
    var opened: (String) -> Void = { _ in }

    @State private var instruction = ""
    @State private var draft: DraftRecipe?
    @State private var summary: String?
    @State private var working = false

    private static let starters = ["Make it vegetarian", "Make it quicker", "Less spicy", "Dairy-free", "Use the air fryer", "Feed 6 instead"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        Image(systemName: kind == .improve ? "wand.and.stars" : "heart.fill")
                            .font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 42, height: 42)
                            .background(kind == .improve ? Theme.Gradient.violetOrange.linear : Theme.brandGradient,
                                        in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(kind == .improve ? "Improve with AI" : "Make it heart-healthy").font(.system(size: 20, weight: .bold))
                            Text(recipe.title).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    if kind == .improve || draft != nil {
                        VStack(alignment: .leading, spacing: 8) {
                            TextField(draft == nil ? "What would you change?" : "Refine it further…", text: $instruction, axis: .vertical)
                                .lineLimit(2...5).padding(12)
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                            if draft == nil {
                                FlowLayout(spacing: 8) {
                                    ForEach(Self.starters, id: \.self) { s in
                                        Button(s) { instruction = s }.font(.system(size: 13))
                                            .padding(.horizontal, 10).frame(height: 30)
                                            .background(Theme.violet50, in: Capsule()).buttonStyle(.plain)
                                            .foregroundStyle(Theme.foreground)
                                    }
                                }
                            }
                            Button { Task { await ask() } } label: {
                                Label(working ? "Thinking…" : draft == nil ? "Suggest changes" : "Refine", systemImage: "sparkles")
                            }
                            .buttonStyle(.gradient(.violetOrange))
                            .disabled(working || instruction.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    if working && draft == nil {
                        ProgressView("Rewriting the recipe…").frame(maxWidth: .infinity).padding(30)
                    }
                    if let draft { preview(draft) }
                }
                .padding(20).frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .task { if kind == .heartHealthy && draft == nil { await ask() } }
        }
    }

    private func preview(_ d: DraftRecipe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let summary {
                Label(summary, systemImage: "sparkles").font(.system(size: 14)).foregroundStyle(Color(hex: 0x6D28D9))
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.violet50, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            Text(d.title).font(.system(size: 20, weight: .bold))
            let before = Set(recipe.ingredients.map { $0.name.lowercased() })
            WebSection(title: "Ingredients") {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(d.ingredients.enumerated()), id: \.offset) { _, i in
                        let new = !before.contains(i.ingredientName.lowercased())
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("•").foregroundStyle(Theme.brand)
                            Text([Format.quantity(i.amount, i.unit), i.ingredientName, i.preparation.isEmpty ? nil : "(\(i.preparation))"]
                                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " "))
                            if new { BadgeView(text: "New") }
                        }
                        .font(.system(size: 14))
                    }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
            }
            WebSection(title: "Method") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(d.steps.enumerated()), id: \.offset) { n, s in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(n + 1)").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.brand).frame(width: 20)
                            Text(s.instruction).font(.system(size: 14))
                        }
                    }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
            }
            HStack(spacing: 10) {
                Button { Task { await apply(copy: false) } } label: { Label("Update this recipe", systemImage: "checkmark") }
                    .buttonStyle(.brand)
                Button { Task { await apply(copy: true) } } label: { Label("Save as a copy", systemImage: "plus.square.on.square") }
                    .buttonStyle(.outline)
            }
            .disabled(working)
        }
    }

    private func ask() async {
        working = true
        defer { working = false }
        do {
            let reply: TweakReply
            if let draft {
                reply = try await app.api.action("ai.refine", [arg(draft), .string(instruction)], as: TweakReply.self)
            } else if kind == .improve {
                reply = try await app.api.action("ai.improve", [.string(recipe.id), .string(instruction)], as: TweakReply.self)
            } else {
                reply = try await app.api.action("ai.heartHealthy", [.string(recipe.id)], as: TweakReply.self)
            }
            draft = reply.recipe
            summary = reply.summary ?? (kind == .heartHealthy ? (reply.heartHealthy == true ? "Rewritten to the heart-healthy targets." : "Lighter, but it may still miss a target.") : nil)
            instruction = ""
        } catch {
            app.toast = WebAction.explain(error)
        }
    }

    private func apply(copy: Bool) async {
        guard let draft else { return }
        working = true
        defer { working = false }
        do {
            if copy {
                struct Reply: Decodable, Sendable { var recipeId: String? }
                let r = try await app.api.action("ai.saveTweakAsCopy", [.string(recipe.id), arg(draft)], as: Reply.self)
                await app.syncNow()
                app.toast = "Saved as a new recipe."
                dismiss()
                if let id = r.recipeId { opened(id) }
            } else {
                try await app.api.run("ai.applyTweak", [.string(recipe.id), arg(draft)])
                await app.syncNow()
                app.toast = "Recipe updated."
                dismiss()
            }
        } catch {
            app.toast = WebAction.explain(error)
        }
    }
}

/// Five ideas for dishes like this one, or sides for it; pick one and it's written and saved.
struct RecipeIdeasSheet: View {
    enum Kind { case similar, sides }
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    let kind: Kind
    var opened: (String) -> Void = { _ in }
    @State private var note = ""
    @State private var ideas: [APIClient.Concept]?
    @State private var working: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(kind == .similar ? "More like \(recipe.title)" : "Sides for \(recipe.title)").font(.system(size: 20, weight: .bold))
                    TextField(kind == .similar ? "Any twist? (optional — e.g. but vegetarian)" : "Anything in particular? (optional)", text: $note)
                        .padding(12).overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                    Button { Task { await suggest() } } label: {
                        Label(working == "ideas" ? "Thinking…" : ideas == nil ? "Get ideas" : "Five more", systemImage: "sparkles")
                    }
                    .buttonStyle(.gradient(.violetOrange)).disabled(working != nil)
                    if let ideas {
                        ForEach(ideas) { concept in
                            Button { Task { await write(concept) } } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(concept.title).font(.system(size: 16, weight: .bold)).multilineTextAlignment(.leading)
                                    Text(concept.description).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground).multilineTextAlignment(.leading)
                                    HStack {
                                        BadgeView(text: concept.cuisine)
                                        Spacer()
                                        if working == concept.title { ProgressView() } else { Image(systemName: "chevron.right").foregroundStyle(Theme.mutedForeground) }
                                    }
                                }
                                .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
                            }
                            .buttonStyle(.plain).foregroundStyle(Theme.foreground).disabled(working != nil)
                        }
                    }
                }
                .padding(20).frame(maxWidth: 720).frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private struct Reply: Decodable, Sendable { var concepts: [APIClient.Concept]? }

    private func suggest() async {
        working = "ideas"
        defer { working = nil }
        do {
            let name = kind == .similar ? "ai.similar" : "ai.sides"
            let first: JSONValue = kind == .similar ? .string(recipe.id) : .array([.string(recipe.id)])
            ideas = try await app.api.action(name, [first, note.isEmpty ? .null : .string(note)], as: Reply.self).concepts ?? []
        } catch { app.toast = WebAction.explain(error) }
    }

    private func write(_ concept: APIClient.Concept) async {
        working = concept.title
        defer { working = nil }
        do {
            let made = try await app.api.createRecipe(from: concept, memberIds: nil, mealType: nil, heartHealthy: nil)
            await app.syncNow()
            app.toast = "Saved \(made.title)."
            dismiss()
            opened(made.recipeId)
        } catch { app.toast = WebAction.explain(error) }
    }
}

/// Share a recipe: a link anyone can open, or an email from the household's mail settings.
struct ShareRecipeSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    @State private var tokens: [ShareToken] = []
    @State private var email = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let link = tokens.first(where: \.active), let url = URL(string: link.url) {
                        ShareLink(item: url, subject: Text(recipe.title)) { Label("Share link", systemImage: "square.and.arrow.up") }
                        Button("Turn off this link", role: .destructive) {
                            Task { if await WebAction.run("share.revoke", [.string(link.id)]) { await load() } }
                        }
                    } else {
                        Button { Task { busy = true; defer { busy = false }; if await WebAction.run("share.create", [.string(recipe.id)]) { await load() } } } label: {
                            Label(busy ? "Making a link…" : "Make a share link", systemImage: "link")
                        }
                    }
                } footer: { Text("Anyone with the link can read the recipe, without signing in.") }
                Section {
                    TextField("Their email address", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    Button("Email the recipe") {
                        Task { if await WebAction.run("share.email", [.string(recipe.id), .string(email)], done: "Sent to \(email).") { dismiss() } }
                    }
                    .disabled(!email.contains("@"))
                } header: { Text("Email") } footer: { Text("Uses the household’s mail settings (on the website).") }
            }
            .navigationTitle("Share \(recipe.title)").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        tokens = (try? await app.api.action("share.recipeTokens", [.string(recipe.id)], as: [ShareToken].self)) ?? []
    }
}

extension RecipeDetailView {
    /// The tools section of the ⋯ menu.
    @ViewBuilder
    func toolsMenu(_ recipe: Recipe, open: @escaping (RecipeTool) -> Void) -> some View {
        Menu("AI tools", systemImage: "sparkles") {
            Button("Improve…", systemImage: "wand.and.stars") { open(.improve) }
            Button("Make it heart-healthy", systemImage: "heart") { open(.heartHealthy) }
            Button("Similar recipes…", systemImage: "square.on.square") { open(.similar) }
            Button("Suggest a side…", systemImage: "fork.knife") { open(.sides) }
            Button(recipe.imageUrl == nil ? "Generate a photo" : "Generate a new photo", systemImage: "photo") { open(.photo) }
            Button("Estimate nutrition", systemImage: "flame") { open(.nutrition) }
        }
        Button("Share…", systemImage: "square.and.arrow.up") { open(.share) }
        Button("Add a note", systemImage: "note.text.badge.plus") { open(.note) }
    }
}

enum RecipeTool: String, Identifiable {
    case improve, heartHealthy, similar, sides, photo, nutrition, share, note
    var id: String { rawValue }
}
