// "Create with AI", as the web's concierge (ai-concierge/concierge-client.tsx):
// say what you fancy, pick one of five ideas, and the recipe is written out
// and saved to the household's recipes. Or point the camera at a cookbook page
// and it's read in. Everything runs on the server with the household's own
// AI key, so this needs a connection.
//
//   .sheet { ConciergeSheet { recipeId in path.append(recipeId) } }
//   .sheet { ConciergeSheet(photo: image) { … } }   // straight to reading a photo

import DishesCore
import PhotosUI
import SwiftUI
import UIKit

struct ConciergeSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// A photo of a recipe to read in at once (New Recipe → From a photo).
    var photo: UIImage? = nil
    /// The new recipe, once it has synced down.
    var created: (String) -> Void

    enum Stage: Equatable {
        case asking
        case thinking
        case ideas([APIClient.Concept])
        case writing(String)
        case failed(String)
    }

    @State private var stage = Stage.asking
    @State private var prompt = ""
    @State private var mealType = "dinner"
    @State private var eating: Set<String> = []
    @State private var heartHealthy = false
    @State private var picked: PhotosPickerItem?
    @State private var usingCamera = false
    @State private var configured: Bool?

    private static let mealTypes = ["breakfast", "lunch", "dinner", "dessert", "snack"]
    private static let starters = ["Quick weeknight pasta", "Something with chicken thighs", "A cosy vegetarian curry",
                                   "Use up leftover roast veg", "Light summer salad", "A showstopper pudding"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    if configured == false {
                        notConfigured
                    } else {
                        switch stage {
                        case .asking: askForm
                        case .thinking: working("Thinking up five ideas…", detail: "Usually 10–20 seconds.")
                        case .ideas(let concepts): ideas(concepts)
                        case .writing(let what): working(what, detail: "Writing ingredients, steps and nutrition takes about a minute.")
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
        .interactiveDismissDisabled(isBusy)
        .fullScreenCover(isPresented: $usingCamera) {
            CameraPicker { image in Task { await readPhoto(image) } }.ignoresSafeArea()
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    await readPhoto(image)
                }
                picked = nil
            }
        }
        .task {
            configured = (try? await app.api.aiStatus())?.configured
            if configured != false, let photo, stage == .asking { await readPhoto(photo) }
        }
    }

    private var isBusy: Bool {
        switch stage {
        case .thinking, .writing: true
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
            field("What would you like to cook?") {
                TextField("e.g. a spicy noodle soup that’s ready in 30 minutes", text: $prompt, axis: .vertical)
                    .lineLimit(3...6)
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
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
                                if eating.contains(member.id) { eating.remove(member.id) } else { eating.insert(member.id) }
                            }
                        }
                    }
                }
            }

            Toggle("Heart-healthy (lower saturated fat)", isOn: $heartHealthy)
                .font(.system(size: 15))
                .tint(Theme.brand)

            Button { Task { await askForIdeas() } } label: {
                Label("Get 5 ideas", systemImage: "sparkles")
            }
            .buttonStyle(.gradient(.violetOrange))
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

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
                Text("A cookbook page, a handwritten card or a screenshot. It’s read and saved as a recipe.")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            .padding(.top, 6)
        }
    }

    private func ideas(_ concepts: [APIClient.Concept]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pick one and it’s written out in full")
                .font(.system(size: 15, weight: .semibold))
            ForEach(concepts) { concept in
                Button { Task { await write(concept) } } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(concept.title).font(.system(size: 17, weight: .bold)).multilineTextAlignment(.leading)
                        Text(concept.description)
                            .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 6) {
                            BadgeView(text: concept.cuisine)
                            BadgeView(text: concept.difficulty.capitalized, style: .outline)
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.foreground)
            }
            HStack(spacing: 10) {
                Button { Task { await askForIdeas() } } label: { Label("Five more", systemImage: "arrow.clockwise") }
                    .buttonStyle(.outline)
                Button { stage = .asking } label: { Label("Change the ask", systemImage: "pencil") }
                    .buttonStyle(.outline)
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

    private func readPhoto(_ image: UIImage) async {
        guard let jpeg = CookReviewSheet.jpeg(image) else { return }
        stage = .writing("Reading the recipe from your photo…")
        do {
            await open(try await app.api.recipeFromPhoto(jpeg))
        } catch {
            stage = .failed(Self.explain(error))
        }
    }

    /// Waits for the saved recipe to sync down, then shows it.
    private func open(_ made: APIClient.CreatedRecipe) async {
        await app.syncNow()
        app.toast = made.collectionName.map { "Saved \(made.title) to \($0)" } ?? "Saved \(made.title)"
        dismiss()
        created(made.recipeId)
    }

    static func explain(_ error: Error) -> String {
        if case APIError.http(_, _, let message) = error { return message }
        if (error as? URLError)?.code == .timedOut { return "The AI took too long to answer. Try again in a moment." }
        return "Couldn’t reach Dishes. Check your connection and try again."
    }
}
