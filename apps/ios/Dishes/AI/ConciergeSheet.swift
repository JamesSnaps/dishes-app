// "Create with AI", as the web's concierge (ai-concierge/concierge-client.tsx):
// say what you fancy and tick any of five ideas — each is written out and
// saved to the household's recipes — or, under "I know what I want", name the
// dish and it's written straight away. Or point the camera at a cookbook page
// and it's read in: on the device when it can (DishesCore/AI/RecipeReader,
// offline, no key needed), and then shown in the recipe editor to check
// before it's saved; otherwise on the server, which saves it straight away.
// The ideas and the writing run on the server with the household's own AI
// key, so they need a connection.
//
//   .sheet { ConciergeSheet { recipeId in path.append(recipeId) } }
//   .sheet { ConciergeSheet(photos: pages) { … } }  // straight to reading a photo (or a scan's pages)
//   ConciergeSheet(inTab: true) { … }                 // the AI tab: no Close, starts over after saving

import DishesCore
import PhotosUI
import SwiftUI
import UIKit

struct ConciergeSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// A photo of a recipe, or a scan's pages, to read in at once (New Recipe → From a photo, Scan pages).
    var photos: [UIImage] = []
    /// Shown as the AI tab rather than a sheet: nothing to close, and once a
    /// recipe is saved the form is cleared for the next one.
    var inTab = false
    /// The new recipe, once it has synced down.
    var created: (String) -> Void

    enum Stage: Equatable {
        case asking
        /// Five ideas on their way; the ones written so far (when the server streams them).
        case thinking([APIClient.Concept])
        case ideas([APIClient.Concept])
        /// An idea being written out, and how far it's got (the server streams it).
        case composing(APIClient.Concept, RecipeProgress?)
        case writing(String)
        /// A photo being read on the device.
        case reading
        /// Several ideas being written one after another.
        case batch([BatchItem])
        case failed(String)
    }

    struct BatchItem: Equatable, Identifiable {
        enum Status: Equatable { case waiting, writing(RecipeProgress?), done(APIClient.CreatedRecipe), failed(String) }
        let concept: APIClient.Concept
        var status: Status = .waiting
        var id: String { concept.title }
        var inProgress: Bool {
            switch status { case .waiting, .writing: true; case .done, .failed: false }
        }
    }

    enum Mode: String { case inspire, direct }

    @State private var stage = Stage.asking
    @State private var prompt = ""
    @State private var mealType = "dinner"
    @State private var eating: Set<String> = []
    @State private var heartHealthy = false
    @State private var mode = Mode.inspire
    @State private var chosen: Set<String> = []
    @State private var picked: PhotosPickerItem?
    @State private var usingCamera = false
    @State private var configured: Bool?
    /// A recipe read on the device, open in the editor to check before saving.
    @State private var review: ReviewDraft?
    /// The photos passed in have been sent to be read (once, however often the view reappears).
    @State private var readingStarted = false

    private static let mealTypes = ["breakfast", "lunch", "dinner", "dessert", "snack"]
    private static let starters = ["Quick weeknight pasta", "Something with chicken thighs", "A cosy vegetarian curry",
                                   "Use up leftover roast veg", "Light summer salad", "A showstopper pudding"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    if configured == false && stage == .asking {
                        notConfigured
                        // Reading a photo on the device needs no key.
                        if DeviceAI.isAvailable { photoSection }
                    } else {
                        switch stage {
                        case .asking: askForm
                        case .thinking(let sofar):
                            IdeaPlaces(ideas: sofar, title: "Thinking up five ideas…", asked: askedChips,
                                       note: "Usually 10–20 seconds.")
                        case .composing(let concept, let progress):
                            RecipeWriting(title: concept.title, description: concept.description == concept.title ? nil : concept.description,
                                          progress: progress)
                        case .ideas(let concepts): ideas(concepts)
                        case .writing(let what): working(what, detail: "Writing ingredients, steps and nutrition takes about a minute.")
                        case .reading: working("Reading the recipe on this device…", detail: "Usually under half a minute. You check it before it’s saved.")
                        case .batch(let items): batch(items)
                        case .failed(let message): failed(message)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .scrollDismissesKeyboard(.interactively)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(inTab ? .hidden : .automatic, for: .navigationBar)
            .toolbar {
                if !inTab {
                    ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                }
            }
        }
        .interactiveDismissDisabled(isBusy)
        .sheet(item: $review) { draft in
            RecipeEditor(recipeId: nil, draft: draft) { reviewed($0) }
        }
        .fullScreenCover(isPresented: $usingCamera) {
            CameraPicker { image in Task { await readPhotos([image]) } }.ignoresSafeArea()
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    await readPhotos([image])
                }
                picked = nil
            }
        }
        .task {
            // Not awaited here: presenting this sheet as the photo picker closes can restart the
            // view, which cancels `.task` — and a read cancelled half way stops Vision.
            if !photos.isEmpty, !readingStarted {
                readingStarted = true
                Task { await readPhotos(photos) }
            }
            configured = (try? await app.api.aiStatus())?.configured
        }
        // As a tab it stays alive, so look again once a key may have been added.
        .onAppear {
            guard inTab, configured == false else { return }
            Task { configured = (try? await app.api.aiStatus())?.configured }
        }
    }

    private var isBusy: Bool {
        switch stage {
        case .thinking, .composing, .writing, .reading: true
        case .batch(let items): items.contains(where: \.inProgress)
        default: false
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.inkForeground)
                .frame(width: 44, height: 44)
                .background(Theme.ink, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("Create with AI").font(.system(size: 22, weight: .bold))
                Text("Describe a dish, or snap a recipe from a book.")
                    .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    private var notConfigured: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("AI isn’t set up for this household", systemImage: "key")
                .font(.system(size: 15, weight: .semibold))
            Text("An admin can add an OpenAI key under Settings → AI settings.")
                .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var askForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            Picker("Mode", selection: $mode) {
                Label("Inspire me", systemImage: "sparkles").tag(Mode.inspire)
                Label("I know what I want", systemImage: "scope").tag(Mode.direct)
            }
            .pickerStyle(.segmented)

            field(mode == .inspire ? "What would you like to cook?" : "What do you want to make?") {
                TextField(mode == .inspire ? "e.g. a spicy noodle soup that’s ready in 30 minutes"
                                           : "e.g. chicken tikka masala, beef bourguignon, pad thai…",
                          text: $prompt, axis: .vertical)
                    .lineLimit(3...6)
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                // A few starters, tucked into one menu rather than a wall of chips.
                if mode == .inspire {
                    Menu {
                        ForEach(Self.starters, id: \.self) { idea in
                            Button(idea) { prompt = idea }
                        }
                    } label: {
                        Label("Need an idea?", systemImage: "lightbulb")
                    }
                    .buttonStyle(PillButtonStyle(kind: .secondary, height: 34))
                }
            }

            options


            Button {
                Task {
                    if mode == .inspire { await askForIdeas() } else {
                        let title = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
                        await write(APIClient.Concept(title: title, description: title))
                    }
                }
            } label: {
                Label(mode == .inspire ? "Get 5 ideas" : "Write the recipe", systemImage: mode == .inspire ? "sparkles" : "wand.and.stars")
            }
            .buttonStyle(.wide(.ink))
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            photoSection
        }
    }

    /// Meal, who's eating and heart-healthy as three rows in one panel, each a
    /// menu or a switch, so none of them spills onto a second line.
    private var options: some View {
        VStack(spacing: 0) {
            optionRow("Meal") {
                Menu {
                    Picker("Meal", selection: $mealType) {
                        ForEach(Self.mealTypes, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                } label: {
                    menuValue(mealType.capitalized)
                }
            }
            if !app.members.isEmpty {
                Divider()
                optionRow("Who’s eating", detail: "Their diets and dislikes are respected") {
                    Menu {
                        // Always first, so the rows never move under a finger as people are ticked.
                        Button("Anyone", systemImage: eating.isEmpty ? "checkmark" : "") { eating = [] }
                        Divider()
                        ForEach(app.members) { member in
                            Button(member.displayName, systemImage: eating.contains(member.id) ? "checkmark" : "") {
                                if eating.contains(member.id) { eating.remove(member.id) } else {
                                    eating.insert(member.id)
                                    // Someone on a cholesterol-lowering diet switches it on, as on the web.
                                    if member.cholesterolDiet == true { heartHealthy = true }
                                }
                            }
                        }
                    } label: {
                        menuValue(eatingSummary)
                    }
                    // Stays open while several people are ticked.
                    .menuActionDismissBehavior(.disabled)
                }
            }
            Divider()
            Toggle(isOn: $heartHealthy) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Heart-healthy").font(.system(size: 15, weight: .medium))
                    Text("Lower saturated fat").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                }
            }
            .tint(Theme.brand)
            .padding(.vertical, 10)
        }
        .padding(.horizontal, 16)
        .panel()
    }

    /// "Anyone", "Louis", "Alice & Louis", "Alice +2".
    private var eatingSummary: String {
        let names = app.members.filter { eating.contains($0.id) }.map(\.displayName)
        switch names.count {
        case 0: return "Anyone"
        case 1: return names[0]
        case 2: return names.map { $0.split(separator: " ").first.map(String.init) ?? $0 }.joined(separator: " & ")
        default: return "\(names[0].split(separator: " ").first.map(String.init) ?? names[0]) +\(names.count - 1)"
        }
    }

    private func optionRow(_ title: String, detail: String? = nil, @ViewBuilder _ control: () -> some View) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .medium))
                if let detail {
                    Text(detail).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                }
            }
            Spacer(minLength: 8)
            control()
        }
        .padding(.vertical, 10)
    }

    /// A menu's current value, as a card-coloured pill with the up-down chevron.
    private func menuValue(_ text: String) -> some View {
        HStack(spacing: 6) {
            Text(text).lineLimit(1)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold))
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(Theme.foreground)
        .padding(.horizontal, 14)
        .frame(height: 36)
        .background(Theme.card, in: Capsule())
    }

    private var photoSection: some View {
            VStack(alignment: .leading, spacing: 10) {
                Text("OR FROM A PHOTO")
                    .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                    .foregroundStyle(Theme.mutedForeground)
                HStack(spacing: 10) {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { usingCamera = true } label: { Label("Take a photo", systemImage: "camera") }
                            .buttonStyle(.wide(.secondary))
                    }
                    PhotosPicker(selection: $picked, matching: .images) {
                        Label("Choose a photo", systemImage: "photo")
                    }
                    .buttonStyle(.wide(.secondary))
                }
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                Text(DeviceAI.isAvailable
                     ? "A cookbook page, a handwritten card or a screenshot. It’s read on this device and you check it before it’s saved."
                     : "A cookbook page, a handwritten card or a screenshot. It’s read and saved as a recipe.")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            .padding(.top, 6)
    }

    private func ideas(_ concepts: [APIClient.Concept]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Tick the ones you’d like written out in full")
                .font(.system(size: 15, weight: .semibold))
            ForEach(concepts) { concept in
                let on = chosen.contains(concept.id)
                Button {
                    if on { chosen.remove(concept.id) } else { chosen.insert(concept.id) }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: on ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22))
                            .foregroundStyle(on ? Theme.brand : Theme.mutedForeground)
                        VStack(alignment: .leading, spacing: 8) {
                            Text(concept.title).font(.system(size: 17, weight: .bold)).multilineTextAlignment(.leading)
                            Text(concept.description)
                                .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                                .multilineTextAlignment(.leading)
                            HStack(spacing: 6) {
                                BadgeView(text: concept.cuisine)
                                BadgeView(text: concept.difficulty.capitalized, style: .outline)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(on ? Theme.brand : .clear, lineWidth: 2))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.foreground)
            }
            let picks = concepts.filter { chosen.contains($0.id) }
            Button { Task { await writeAll(picks) } } label: {
                Label(picks.count > 1 ? "Write \(picks.count) recipes" : "Write it out", systemImage: "wand.and.stars")
            }
            .buttonStyle(.wide(.ink))
            .disabled(picks.isEmpty)
            HStack(spacing: 10) {
                Button { Task { await askForIdeas() } } label: { Label("Five more", systemImage: "arrow.clockwise") }
                    .buttonStyle(.secondary)
                Button { stage = .asking } label: { Label("Change the ask", systemImage: "pencil") }
                    .buttonStyle(.secondary)
            }
        }
    }

    /// Several recipes being written, one at a time, each saved as it's done.
    private func batch(_ items: [BatchItem]) -> some View {
        let finished = !items.contains(where: \.inProgress)
        return VStack(alignment: .leading, spacing: 12) {
            Text(finished ? "Done" : "Writing \(items.count) recipes — about a minute each")
                .font(.system(size: 15, weight: .semibold))
            ForEach(items) { item in
                HStack(spacing: 12) {
                    Group {
                        switch item.status {
                        case .waiting: EmptyPlate(size: 48)
                        case .writing(let progress): WritingRing(progress: progress, size: 48)
                        case .done:
                            Circle().fill(Theme.plate).frame(width: 44, height: 44).overlay(alignment: .bottomTrailing) {
                                Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.card)
                                    .frame(width: 20, height: 20).background(Theme.success, in: Circle())
                            }
                        case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.destructive)
                        }
                    }
                    .frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.concept.title).font(Theme.serif(15))
                        if case .writing(let progress) = item.status {
                            Text(progress?.label ?? "Starting on the ingredients").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        } else if item.status == .waiting {
                            Text("Next").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        }
                        if case .failed(let why) = item.status {
                            Text(why).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        } else if case .done(let made) = item.status, let collection = made.collectionName {
                            Text("Saved to \(collection)").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    Spacer()
                    if case .done(let made) = item.status {
                        Button("Open") { finish(opening: made) }.buttonStyle(.secondary).fixedSize()
                    }
                }
                .padding(14)
                .card()
            }
            if finished {
                Button("Create more") { chosen = []; stage = .asking }.buttonStyle(.secondary)
            }
        }
    }

    private func working(_ title: String, detail: String) -> some View {
        VStack(spacing: 14) {
            SteamPlate(size: 72)
            Text(title).font(.system(size: 17, weight: .semibold)).multilineTextAlignment(.center)
            Text(detail).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 50)
    }

    private func failed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("That didn’t work", systemImage: "exclamationmark.triangle")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.destructive)
            Text(message).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            Button("Try again") { stage = .asking }.buttonStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func field(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            content()
        }
    }

    // MARK: Server

    private var members: [String]? { eating.isEmpty ? nil : Array(eating) }

    private func askForIdeas() async {
        withAnimation { stage = .thinking([]) }
        chosen = []
        let (api, prompt, members, mealType, heartHealthy) = (app.api, prompt, members, mealType, heartHealthy)
        let context = AIContext.cached
        do {
            // On the device first (ConceptWriter), from the cached context; the
            // chosen ones are still written out by the server.
            let concepts = try await AIRouter.run(
                .recipeIdeas,
                onDevice: {
                    guard #available(iOS 27, *) else { throw CancellationError() }
                    return try await ConceptWriter.ideas(.init(prompt: prompt, memberIds: members ?? [], mealType: mealType,
                                                               heartHealthy: heartHealthy), context: context)
                },
                check: { ideas in
                    ConceptChecks.problems(ideas, eating: (context?.members ?? []).filter { (members ?? []).contains($0.id) })
                },
                fallback: {
                    // Streamed: each idea takes its place as it's written.
                    var sofar: [APIClient.Concept] = []
                    let events = api.recipeConceptsStream(.init(prompt: prompt, memberIds: members, mealType: mealType,
                                                                heartHealthy: heartHealthy ? true : nil))
                    for try await event in events {
                        switch event {
                        case .concept(let idea):
                            sofar.append(idea)
                            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { stage = .thinking(sofar) }
                        case .done(let all): return all
                        case .error(let message): throw APIError.http(status: 422, code: "ai_error", message: message)
                        case .unknown: break
                        }
                    }
                    throw APIError.http(status: 502, code: "bad_response", message: "The ideas stopped part way. Please try again.")
                }).value
            stage = concepts.isEmpty ? .failed("No ideas came back. Try describing it differently.") : .ideas(concepts)
        } catch {
            stage = .failed(Self.explain(error))
        }
    }

    private func write(_ concept: APIClient.Concept) async {
        stage = .composing(concept, nil)
        do {
            let made = try await writeOut(concept) { progress in stage = .composing(concept, progress) }
            await open(made)
        } catch {
            stage = .failed(Self.explain(error))
        }
    }

    /// Writes one idea out and saves it, hearing how far it's got as the server streams it.
    private func writeOut(_ concept: APIClient.Concept, progress: (RecipeProgress) -> Void) async throws -> APIClient.CreatedRecipe {
        let events = app.api.createRecipeStream(from: concept, memberIds: members, mealType: mealType,
                                                heartHealthy: heartHealthy ? true : nil)
        for try await event in events {
            switch event {
            case .progress(let p): withAnimation(.easeOut(duration: 0.3)) { progress(p) }
            case .done(let made): return made
            case .error(let message): throw APIError.http(status: 422, code: "ai_error", message: message)
            case .unknown: break
            }
        }
        throw APIError.http(status: 502, code: "bad_response", message: "The recipe stopped part way. Please try again.")
    }

    /// What was asked for, shown back while the ideas are written.
    private var askedChips: [String] {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        return [text.isEmpty ? nil : "“\(text.count > 60 ? text.prefix(57) + "…" : Substring(text))”",
                mealType.capitalized, heartHealthy ? "Heart-healthy" : nil].compactMap { $0 }
    }

    /// One idea goes straight to its recipe; several are written in turn,
    /// each saved as it finishes, with the list showing how far it's got.
    private func writeAll(_ concepts: [APIClient.Concept]) async {
        guard concepts.count > 1 else {
            if let one = concepts.first { await write(one) }
            return
        }
        var items = concepts.map { BatchItem(concept: $0) }
        stage = .batch(items)
        for i in items.indices {
            items[i].status = .writing(nil)
            stage = .batch(items)
            do {
                let made = try await writeOut(items[i].concept) { progress in
                    items[i].status = .writing(progress)
                    stage = .batch(items)
                }
                items[i].status = .done(made)
            } catch {
                items[i].status = .failed(Self.explain(error))
            }
            stage = .batch(items)
        }
        await app.syncNow()
        let saved = items.filter { if case .done = $0.status { true } else { false } }.count
        app.toast = "Saved \(saved) of \(items.count) recipes"
    }

    /// From the batch list: show one of the saved recipes.
    private func finish(opening made: APIClient.CreatedRecipe) {
        if inTab { chosen = []; stage = .asking; prompt = "" } else { dismiss() }
        created(made.recipeId)
    }

    /// The router's two outcomes: a draft to check (the device), or a recipe already saved (the server).
    private enum Read: Sendable {
        case draft(RecipeReader.Reading)
        case saved(APIClient.CreatedRecipe)
    }

    /// One photo or a scan's pages: read on the device into a draft for the
    /// editor, or — with no on-device model, or an answer that fails its
    /// checks — by the household's AI: the same reader on DishesServerModel
    /// (iOS 27), or on iOS 26 /ai/photo-recipe, which saves it.
    private func readPhotos(_ images: [UIImage]) async {
        let pages = images.compactMap { $0.uprightCGImage(maxDimension: 2400) }
        guard !pages.isEmpty else { return }
        stage = DeviceAI.isAvailable ? .reading : .writing("Reading the recipe from your photo…")
        let context = AIContext.cached
        let metric = (context?.measurementSystem ?? "metric") == "metric"
        do {
            let run = try await AIRouter.run(
                .scanRecipe,
                onDevice: {
                    guard #available(iOS 27, *) else { throw CancellationError() }
                    return Read.draft(try await RecipeReader.read(pages, context: context))
                },
                check: {
                    guard case .draft(let reading) = $0 else { return [] }
                    return RecipeChecks.problems(reading.recipe, metric: metric, pageText: reading.pageText)
                },
                fallback: {
                    if stage == .reading { stage = .writing("Reading the recipe from your photo…") }
                    // iOS 27: the same reader on the household's AI (DishesServerModel, D5),
                    // every page attached, back as a draft to check.
                    if #available(iOS 27, *) {
                        return Read.draft(try await RecipeReader.read(pages, context: context, model: DishesServerModel(api: app.api),
                                                                      alwaysAttach: true))
                    }
                    guard let jpeg = CookReviewSheet.jpeg(UIImage.stacked(images)) else { throw CancellationError() }
                    return Read.saved(try await app.api.recipeFromPhoto(jpeg))
                })
            switch run.value {
            case .draft(let reading):
                stage = .asking
                review = ReviewDraft(recipe: reading.recipe, engine: run.engine)
            case .saved(let made):
                await open(made)
            }
        } catch {
            stage = .failed(Self.explain(error))
        }
    }

    /// The reviewed draft was saved from the editor (which synced it down).
    private func reviewed(_ recipeId: String) {
        if inTab { stage = .asking; prompt = "" } else { dismiss() }
        created(recipeId)
    }

    /// Waits for the saved recipe to sync down, then shows it.
    private func open(_ made: APIClient.CreatedRecipe) async {
        await app.syncNow()
        app.toast = made.collectionName.map { "Saved \(made.title) to \($0)" } ?? "Saved \(made.title)"
        if inTab {
            stage = .asking
            prompt = ""
        } else {
            dismiss()
        }
        created(made.recipeId)
    }

    static func explain(_ error: Error) -> String {
        if case APIError.http(_, _, let message) = error { return message }
        if (error as? URLError)?.code == .timedOut { return "The AI took too long to answer. Try again in a moment." }
        return "Couldn’t reach Dishes. Check your connection and try again."
    }
}
