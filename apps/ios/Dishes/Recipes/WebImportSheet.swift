// New Recipe → From a website, as the web's Import from web
// (recipes/_components/web-import-modal.tsx): paste a recipe page's link and
// the server reads it — the page's schema.org recipe data, tidied by the
// household's AI when there's a key — copies its photo and saves it. The
// recipe opens once it has synced down, to be checked over in the editor.
//
//   .sheet { WebImportSheet { recipeId in path.append(recipeId) } }
//   .sheet { WebImportSheet(link: "https://…") { … } }   // straight to importing
//
// A link can also arrive as dishes://import?url=<page> (WebImportLink), so an
// iOS Shortcut on Safari's share sheet can send the page to the app.

import DishesCore
import SwiftUI

struct WebImportSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// A link to import at once (a dishes://import link).
    var link: String? = nil
    /// The new recipe, once it has synced down.
    var created: (String) -> Void

    enum Stage: Equatable {
        case asking
        case importing
        case failed(String)
    }

    @State private var stage = Stage.asking
    @State private var url = ""
    @FocusState private var focused: Bool

    private var trimmed: String { url.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    switch stage {
                    case .asking: form
                    case .importing: importing
                    case .failed(let message): failed(message)
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
        .interactiveDismissDisabled(stage == .importing)
        .task {
            if let link, stage == .asking {
                url = link
                await run()
            } else {
                focused = true
            }
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "globe")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .frame(width: 44, height: 44)
                .background(Theme.highlight, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Import from a website").font(Theme.serif(24))
                Text("Ingredients, method, timings and the photo, read from the page.")
                    .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("RECIPE PAGE LINK")
                .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            HStack(spacing: 10) {
                TextField("https://www.example.com/recipes/…", text: $url)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit { if !trimmed.isEmpty { Task { await run() } } }
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                // Reads the clipboard only when tapped, so there's no paste prompt.
                PasteButton(payloadType: String.self) { strings in
                    if let first = strings.first { url = first.trimmingCharacters(in: .whitespacesAndNewlines) }
                }
                .labelStyle(.iconOnly)
                .buttonBorderShape(.roundedRectangle(radius: 10))
                .tint(Theme.brand)
            }
            Button {
                Task { await run() }
            } label: {
                Label("Import recipe", systemImage: "arrow.down.circle")
            }
            .buttonStyle(.primary)
            .disabled(trimmed.isEmpty)
            Text("Most recipe sites work without AI. With an AI key set up, Dishes also tidies the ingredients, adds timers and can read pages that don’t publish recipe data. You can edit everything once it’s saved.")
                .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
        }
        .padding(16)
        .card()
    }

    private var importing: some View {
        VStack(spacing: 14) {
            ReadingLink(url: trimmed)
            Text("Reading the recipe…").font(.system(size: 17, weight: .semibold))
            Text("Usually a few seconds; up to a minute when the AI tidies it up.")
                .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground).multilineTextAlignment(.center)
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

    // MARK: Server

    private func run() async {
        guard !trimmed.isEmpty else { return }
        focused = false
        stage = .importing
        do {
            let made = try await app.api.recipeFromWeb(trimmed)
            await app.syncNow()
            app.toast = [made.title.isEmpty ? "Recipe imported" : "Imported \(made.title)", made.notice]
                .compactMap { $0 }.joined(separator: " — ")
            dismiss()
            created(made.recipeId)
        } catch {
            stage = .failed(Self.explain(error))
        }
    }

    static func explain(_ error: Error) -> String {
        if case APIError.http(_, _, let message) = error { return message }
        if (error as? URLError)?.code == .timedOut { return "That took too long. Try again in a moment." }
        return "Couldn’t reach Dishes. Check your connection and try again."
    }
}

/// dishes://import?url=<recipe page> — a page sent from a Shortcut.
struct WebImportLink: Identifiable, Hashable {
    let url: String
    var id: String { url }

    /// nil for any other URL (cook links and the sign-in callback share the scheme).
    init?(url: URL) {
        guard url.scheme == "dishes", url.host == "import",
              let page = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                  .queryItems?.first(where: { $0.name == "url" })?.value,
              !page.isEmpty else { return nil }
        self.url = page
    }

    init(page: String) { url = page }
}
