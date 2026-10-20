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
        case thinking
        case ideas([APIClient.Concept])
        case writing(String)
        /// A photo being read on the device.
        case reading
        /// Several ideas being written one after another.
        case batch([BatchItem])
        case failed(String)
    }

    struct BatchItem: Equatable, Identifiable {
        enum Status: Equatable { case waiting, writing, done(APIClient.CreatedRecipe), failed(String) }
        let concept: APIClient.Concept
        var status: Status = .waiting
        var id: String { concept.title }
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
                        case .thinking: working("Thinking up five ideas…", detail: "Usually 10–20 seconds.")
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
        case .thinking, .writing, .reading: true
        case .batch(let items): items.contains { $0.status == .waiting || $0.status == .writing }
        default: false
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Theme.Gradient.violetOrange.linear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
                if mode == .inspire {
                FlowLayout(spacing: 8) {
                    ForEach(Self.starters, id: \.self) { idea in
                        Button(idea) { prompt = idea }
                            .font(.system(size: 13))
                            .padding(.horizontal, 10)
                            .frame(height: 30)
                            .foregroundStyle(Theme.foreground)
                            .background(Theme.violet50, in: Capsule())
                            .buttonStyle(.plain)
                    }
                }
                }
            }

            field("Meal") {
                FlowLayout(spacing: 8) {
                    ForEach(Self.mealTypes, id: \.self) { type in
                        pill(type.capitalized, on: mealType == type) { mealType = type }
                    }
                }
            }

            if !app.members.isEmpty {
                field("Who’s eating? (their diets and dislikes are respected)") {
                    FlowLayout(spacing: 8) {
                        ForEach(app.members) { member in
                            pill(member.displayName, on: eating.contains(member.id)) {
                                if eating.contains(member.id) { eating.remove(member.id) } else {
                                    eating.insert(member.id)
                                    // Someone on a cholesterol-lowering diet switches it on, as on the web.
                                    if member.cholesterolDiet == true { heartHealthy = true }
                                }
                            }
                        }
                    }
                }
            }

            Toggle("Heart-healthy (lower saturated fat)", isOn: $heartHealthy)
                .font(.system(size: 15))
                .tint(Theme.brand)

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
            .buttonStyle(.gradient(.violetOrange))
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            photoSection
        }
    }

    private var photoSection: some View {
            VStack(alignment: .leading, spacing: 10) {
                Text("OR FROM A PHOTO")
                    .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                    .foregroundStyle(Theme.mutedForeground)
                HStack(spacing: 10) {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { usingCamera = true } label: { Label("Photograph a recipe", systemImage: "camera") }
                            .buttonStyle(.outline)
                    }
                    PhotosPicker(selection: $picked, matching: .images) {
                        Label("Choose a photo", systemImage: "photo")
                    }
                    .buttonStyle(.outline)
                }
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
            .buttonStyle(.gradient(.violetOrange))
            .disabled(picks.isEmpty)
            HStack(spacing: 10) {
                Button { Task { await askForIdeas() } } label: { Label("Five more", systemImage: "arrow.clockwise") }
                    .buttonStyle(.outline)
                Button { stage = .asking } label: { Label("Change the ask", systemImage: "pencil") }
                    .buttonStyle(.outline)
            }
        }
    }

    /// Several recipes being written, one at a time, each saved as it's done.
    private func batch(_ items: [BatchItem]) -> some View {
        let finished = !items.contains { $0.status == .waiting || $0.status == .writing }
        return VStack(alignment: .leading, spacing: 12) {
            Text(finished ? "Done" : "Writing \(items.count) recipes — about a minute each")
                .font(.system(size: 15, weight: .semibold))
            ForEach(items) { item in
                HStack(spacing: 12) {
                    switch item.status {
                    case .waiting: Image(systemName: "clock").foregroundStyle(Theme.mutedForeground)
                    case .writing: ProgressView().tint(Theme.brand)
                    case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(hex: 0x059669))
                    case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.destructive)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.concept.title).font(.system(size: 15, weight: .semibold))
                        if case .failed(let why) = item.status {
                            Text(why).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        } else if case .done(let made) = item.status, let collection = made.collectionName {
                            Text("Saved to \(collection)").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    Spacer()
                    if case .done(let made) = item.status {
                        Button("Open") { finish(opening: made) }.buttonStyle(.outline).fixedSize()
                    }
                }
                .padding(14)
                .card()
            }
            if finished {
                Button("Create more") { chosen = []; stage = .asking }.buttonStyle(.outline)
            }
        }
    }

    private func working(_ title: String, detail: String) -> some View {
        VStack(spacing: 14) {
            ProgressView().controlSize(.large).tint(Theme.brand)
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
            Button("Try again") { stage = .asking }.buttonStyle(.outline)
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

    private func pill(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 12)
                .frame(height: 34)
                .foregroundStyle(on ? .white : Theme.foreground)
                .background(on ? Theme.brand : Theme.background, in: Capsule())
                .overlay(Capsule().strokeBorder(on ? .clear : Theme.border))
        }
        .buttonStyle(.plain)
    }

    // MARK: Server

    private var members: [String]? { eating.isEmpty ? nil : Array(eating) }

    private func askForIdeas() async {
        stage = .thinking
        chosen = []
        do {
            let concepts = try await app.api.recipeConcepts(.init(
                prompt: prompt, memberIds: members, mealType: mealType, heartHealthy: heartHealthy ? true : nil))
            stage = concepts.isEmpty ? .failed("No ideas came back. Try describing it differently.") : .ideas(concepts)
        } catch {
            stage = .failed(Self.explain(error))
        }
    }

    private func write(_ concept: APIClient.Concept) async {
        stage = .writing("Writing \(concept.title)…")
        do {
            let made = try await app.api.createRecipe(from: concept, memberIds: members, mealType: mealType,
                                                      heartHealthy: heartHealthy ? true : nil)
            await open(made)
        } catch {
            stage = .failed(Self.explain(error))
        }
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
            items[i].status = .writing
            stage = .batch(items)
            do {
                items[i].status = .done(try await app.api.createRecipe(from: items[i].concept, memberIds: members,
                                                                        mealType: mealType, heartHealthy: heartHealthy ? true : nil))
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
    /// checks — by the server, which saves it (the pages joined into one image).
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
