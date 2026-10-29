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
    /// Where the change shown was made, for the line under its summary.
    @State private var engine: AIEngine?

    private static let starters = ["Make it vegetarian", "Make it quicker", "Less spicy", "Dairy-free", "Use the air fryer", "Feed 6 instead"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        Image(systemName: kind == .improve ? "wand.and.stars" : "heart.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(kind == .improve ? Theme.inkForeground : Theme.success)
                            .frame(width: 44, height: 44)
                            .background(kind == .improve ? Theme.ink : Theme.successTint, in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(kind == .improve ? "Improve with AI" : "Make it heart-healthy").font(Theme.serif(22))
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
                                            .background(Theme.secondary, in: Capsule()).buttonStyle(.plain)
                                            .foregroundStyle(Theme.foreground)
                                    }
                                }
                            }
                            Button { Task { await ask() } } label: {
                                Label(working ? "Thinking…" : draft == nil ? "Suggest changes" : "Refine", systemImage: "sparkles")
                            }
                            .buttonStyle(.ink)
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
                VStack(alignment: .leading, spacing: 6) {
                    Label(summary, systemImage: "sparkles").font(.system(size: 14)).foregroundStyle(Theme.foreground)
                    if engine == .device {
                        Label("Changed on this \(UIDevice.current.model)", systemImage: "apple.intelligence")
                            .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .panel(radius: 12)
            }
            Text(d.title).font(Theme.serif(22))
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
                    .buttonStyle(.primary)
                Button { Task { await apply(copy: true) } } label: { Label("Save as a copy", systemImage: "plus.square.on.square") }
                    .buttonStyle(.secondary)
            }
            .disabled(working)
        }
    }

    private func ask() async {
        working = true
        defer { working = false }
        do {
            let reply: TweakReply
            if kind == .improve || draft != nil {
                reply = try await improve()
            } else {
                reply = try await app.api.action("ai.heartHealthy", [.string(recipe.id)], as: TweakReply.self)
                engine = .server
            }
            draft = reply.recipe
            summary = reply.summary ?? (kind == .heartHealthy ? (reply.heartHealthy == true ? "Rewritten to the heart-healthy targets." : "Lighter, but it may still miss a target.") : nil)
            instruction = ""
        } catch {
            app.toast = WebAction.explain(error)
        }
    }

    /// Improve or refine: the edits from the on-device model (RecipeTweaker)
    /// when it can and they pass their checks, the household's AI otherwise.
    private func improve() async throws -> TweakReply {
        struct Proposed: Sendable { var reply: TweakReply; var problems: [String] }
        let (api, recipeId, instruction, current) = (app.api, recipe.id, instruction, draft)
        let context = AIContext.cached
        let run = try await AIRouter.run(
            .improveRecipe,
            onDevice: {
                guard #available(iOS 27, *) else { throw CancellationError() }
                var base = current
                if base == nil { base = try await api.action("recipes.generated", [.string(recipeId)], as: DraftRecipe.self) }
                guard let base else { throw CancellationError() }
                let original = try JSONDecoder().decode(GeneratedRecipe.self, from: JSONEncoder().encode(base))
                let tweak = try await RecipeTweaker.improve(original, instruction: instruction, context: context)
                var tweaked = try JSONDecoder().decode(DraftRecipe.self, from: JSONEncoder().encode(tweak.recipe))
                tweaked.nutrition = tweak.nutritionStale ? nil : base.nutrition
                tweaked.mealRole = base.mealRole
                let metric = (context?.measurementSystem ?? "metric") == "metric"
                return Proposed(reply: TweakReply(recipe: tweaked, summary: tweak.summary),
                                problems: TweakChecks.problems(tweak, original: original, metric: metric))
            },
            check: { $0.problems },
            fallback: {
                if let current {
                    return Proposed(reply: try await api.action("ai.refine", [arg(current), .string(instruction)], as: TweakReply.self), problems: [])
                }
                return Proposed(reply: try await api.action("ai.improve", [.string(recipeId), .string(instruction)], as: TweakReply.self),
                                problems: [])
            })
        engine = run.engine
        return run.value.reply
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
                    Text(kind == .similar ? "More like \(recipe.title)" : "Sides for \(recipe.title)").font(Theme.serif(22))
                    TextField(kind == .similar ? "Any twist? (optional — e.g. but vegetarian)" : "Anything in particular? (optional)", text: $note)
                        .padding(12).overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                    Button { Task { await suggest() } } label: {
                        Label(working == "ideas" ? "Thinking…" : ideas == nil ? "Get ideas" : "Five more", systemImage: "sparkles")
                    }
                    .buttonStyle(.ink).disabled(working != nil)
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

// MARK: AI photo

/// "Generate a photo", as the web's Generate image button: a style (the
/// household's default first) and optional instructions for the shot. It's
/// made in the background on the server — about 30 seconds — and the photo
/// arrives with the next sync; the sheet can be closed straight away.
struct RecipePhotoSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    @State private var style = "studio"
    @State private var instructions = ""
    @State private var starting = false

    static let styles: [(value: String, label: String, about: String)] = [
        ("studio", "Studio", "Clean background, natural lighting"),
        ("moody", "Moody", "Dark, dramatic, cinematic"),
        ("rustic", "Rustic", "Wooden surfaces, farmhouse feel"),
        ("bright", "Bright & Fresh", "Light, airy, vibrant on white"),
        ("overhead", "Flat-lay", "Shot directly overhead"),
        ("cellphone", "Cellphone", "Casual, Instagram-style"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Style", selection: $style) {
                        ForEach(Self.styles, id: \.value) { Text($0.label).tag($0.value) }
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.brandDeep)
                } footer: { Text(Self.styles.first { $0.value == style }?.about ?? "") }
                Section {
                    TextField("e.g. a single slice on a plate with a fork, not the whole cake", text: $instructions, axis: .vertical)
                        .lineLimit(2...5)
                } header: { Text("Custom instructions (optional)") } footer: {
                    Text("Added to the style. The photo takes about 30 seconds; you can close this and carry on.")
                }
            }
            .navigationTitle(recipe.imageUrl == nil ? "Generate a photo" : "New photo").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(starting ? "Starting…" : "Generate") { Task { await start() } }.bold().disabled(starting)
                }
            }
            .task {
                struct Config: Decodable { var imageStyle: String? }
                if let c = try? await app.api.action("ai.config", as: Config?.self), let s = c.imageStyle,
                   Self.styles.contains(where: { $0.value == s }) {
                    style = s
                }
            }
        }
    }

    private func start() async {
        starting = true
        defer { starting = false }
        let trimmed = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        let ok = await WebAction.run("ai.recipeImageJob",
                                     [.string(recipe.id), .string(style), trimmed.isEmpty ? .null : .string(String(trimmed.prefix(500)))],
                                     done: "Generating a photo — it’ll appear in about 30 seconds.")
        guard ok else { return }
        dismiss()
        // The job finishes on the server; pull the new photo down when it's likely done.
        Task {
            for delay in [30, 20, 30] {
                try? await Task.sleep(for: .seconds(delay))
                await app.syncNow()
            }
        }
    }
}
