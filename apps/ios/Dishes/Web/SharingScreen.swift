// Sharing, as the web's /settings/shares and /settings/library-shares:
// links to single recipes (anyone with the link can read it), and shared
// libraries — letting another Dishes household browse and copy from yours,
// or browsing and copying from one shared with you.

import DishesCore
import SwiftUI

struct ShareToken: Decodable, Sendable, Identifiable, Hashable {
    var id: String
    var recipeId: String
    var recipeTitle: String?
    var createdAt: String
    var active: Bool
    var url: String
}

struct LibraryData: Decodable, Sendable {
    struct Outgoing: Decodable, Sendable, Identifiable, Hashable {
        var id: String
        var label: String?
        var inviteCode: String
        var redeemedAt: String?
        var granteeHouseholdName: String?
        var baseScope: String
        var includeCollectionIds: [String]
        var includeTags: [String]
        var excludeTags: [String]
        var revokedAt: String?
        var recipeCount: Int
        var copiedCount: Int
    }
    struct Incoming: Decodable, Sendable, Identifiable, Hashable {
        var id: String
        var ownerHouseholdName: String
        var label: String?
        var recipeCount: Int
    }
    struct Collection: Decodable, Sendable, Identifiable, Hashable { var id: String; var name: String; var icon: String? }
    var outgoing: [Outgoing]
    var incoming: [Incoming]
    var collections: [Collection]
    var tags: [String]
    var isAdmin: Bool
}

struct SharingScreen: View {
    @State private var tokens = Remote<[ShareToken]>("share.tokens")
    @State private var library = Remote<LibraryData>("library.list")
    @State private var creating = false
    @State private var editingScope: LibraryData.Outgoing?
    @State private var redeeming = false

    var body: some View {
        WebPage(title: "Sharing", subtitle: "Recipe links, and libraries shared between households.", data: library) { lib in
            WebSection(title: "Shared with us", action: lib.isAdmin ? ("Use an invite", "envelope.open", { redeeming = true }) : nil) {
                let incoming = lib.incoming
                if incoming.isEmpty {
                    Text("When another household shares their library with you, it appears here.")
                        .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                } else {
                    CardList(items: incoming) { share in
                        NavigationLink { SharedLibraryScreen(share: share) } label: {
                            HStack {
                                Image(systemName: "books.vertical.fill").foregroundStyle(Theme.brand)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(share.label ?? share.ownerHouseholdName).font(.system(size: 15, weight: .semibold))
                                    Text("\(share.ownerHouseholdName) · \(share.recipeCount) recipes")
                                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 11)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Stop seeing this library", systemImage: "xmark.circle", role: .destructive) {
                                Task { if await WebAction.run("library.leave", [.string(share.id)]) { await library.load() } }
                            }
                        }
                    }
                }
            }

            WebSection(title: "Our library, shared", action: lib.isAdmin ? ("Share", "plus", { creating = true }) : nil) {
                let active = lib.outgoing.filter { $0.revokedAt == nil }
                if active.isEmpty {
                    Text("Let another household browse and copy your recipes — all of them, some collections, or by tag.")
                        .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                } else {
                    CardList(items: active) { share in outgoingRow(share, isAdmin: lib.isAdmin) }
                }
            }

            WebSection(title: "Recipe links") {
                let links = (tokens.value ?? []).filter(\.active)
                if links.isEmpty {
                    Text("Share a recipe from its page (⋯ → Share link). Anyone with the link can read it.")
                        .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                } else {
                    CardList(items: links) { token in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(token.recipeTitle ?? "Recipe").font(.system(size: 15, weight: .medium)).lineLimit(1)
                                if let date = token.createdAt.isoDate {
                                    Text("Shared \(date.formatted(date: .abbreviated, time: .omitted))")
                                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                                }
                            }
                            Spacer()
                            if let url = URL(string: token.url) {
                                ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                            }
                            Button(role: .destructive) {
                                Task { if await WebAction.run("share.revoke", [.string(token.id)], done: "Link turned off.") { await tokens.load() } }
                            } label: { Image(systemName: "link.badge.plus").symbolVariant(.slash) }
                            .accessibilityLabel("Turn off this link")
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                }
            }
        }
        .task { await tokens.load() }
        .sheet(isPresented: $creating) {
            if let lib = library.value { LibraryScopeSheet(share: nil, collections: lib.collections, tags: lib.tags) { await library.load() } }
        }
        .sheet(item: $editingScope) { share in
            if let lib = library.value { LibraryScopeSheet(share: share, collections: lib.collections, tags: lib.tags) { await library.load() } }
        }
        .sheet(isPresented: $redeeming) {
            TextPromptSheet(title: "Use an invite", placeholder: "Invite link or code", text: "") { text in
                let code = text.split(separator: "/").last.map(String.init) ?? text
                do {
                    struct Reply: Decodable, Sendable { var result: Status?; struct Status: Decodable, Sendable { var status: String; var ownerHouseholdName: String? } }
                    let r = try await AppModel.shared.api.action("library.redeem", [.string(code)], as: Reply.self)
                    switch r.result?.status {
                    case "redeemed": AppModel.shared.toast = "Connected to \(r.result?.ownerHouseholdName ?? "their library")."
                    case "already-connected": AppModel.shared.toast = "You’re already connected."
                    case "self": AppModel.shared.toast = "That’s your own invite."
                    default: AppModel.shared.toast = "That invite isn’t valid any more."
                    }
                    await library.load()
                    return true
                } catch {
                    AppModel.shared.toast = WebAction.explain(error)
                    return false
                }
            }
        }
    }

    private func outgoingRow(_ share: LibraryData.Outgoing, isAdmin: Bool) -> some View {
        let url = URL(string: "\(AppModel.serverURL.absoluteString)/library-invite/\(share.inviteCode)")
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(share.label ?? (share.granteeHouseholdName ?? "Invite")).font(.system(size: 15, weight: .semibold))
                Text([share.granteeHouseholdName.map { "With \($0)" } ?? "Not used yet",
                      Self.scopeText(share), "\(share.recipeCount) recipes", share.copiedCount > 0 ? "\(share.copiedCount) copied" : nil]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
            }
            Spacer()
            if share.redeemedAt == nil, let url { ShareLink(item: url) { Image(systemName: "square.and.arrow.up") } }
            if isAdmin {
                Menu {
                    Button("Change what’s shared", systemImage: "slider.horizontal.3") { editingScope = share }
                    if share.redeemedAt == nil {
                        Button("New invite link", systemImage: "arrow.clockwise") {
                            Task { if await WebAction.run("library.rotate", [.string(share.id)], done: "New link made.") { await library.load() } }
                        }
                    }
                    Button("Stop sharing", systemImage: "xmark.circle", role: .destructive) {
                        Task { if await WebAction.run("library.revoke", [.string(share.id)]) { await library.load() } }
                    }
                } label: { Image(systemName: "ellipsis").frame(width: 34, height: 34) }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    static func scopeText(_ s: LibraryData.Outgoing) -> String {
        switch s.baseScope {
        case "collections": "\(s.includeCollectionIds.count) collection\(s.includeCollectionIds.count == 1 ? "" : "s")"
        case "tags": "Tagged \(s.includeTags.joined(separator: ", "))"
        default: "Everything"
        }
    }
}

/// What a library share includes: everything, some collections, or some tags,
/// minus excluded tags.
private struct LibraryScopeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let share: LibraryData.Outgoing?
    let collections: [LibraryData.Collection]
    let tags: [String]
    var saved: () async -> Void
    @State private var label = ""
    @State private var base = "all"
    @State private var chosen: Set<String> = []
    @State private var included: Set<String> = []
    @State private var excluded: Set<String> = []
    @State private var link: URL?

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    Section {
                        Text("Send this link to the other household. They need their own Dishes.").font(.footnote)
                        ShareLink(item: link) { Label("Share invite link", systemImage: "square.and.arrow.up") }
                    }
                } else {
                    TextField("Label (e.g. For Mum)", text: $label)
                    Picker("Share", selection: $base) {
                        Text("All our recipes").tag("all"); Text("Some collections").tag("collections"); Text("Recipes with tags").tag("tags")
                    }
                    if base == "collections" {
                        Section("Collections") {
                            ForEach(collections) { c in
                                toggle("\(c.icon ?? "") \(c.name)", chosen.contains(c.id)) { on in if on { chosen.insert(c.id) } else { chosen.remove(c.id) } }
                            }
                        }
                    }
                    if base == "tags" {
                        Section("Include tags") {
                            ForEach(tags, id: \.self) { t in toggle(t, included.contains(t)) { on in if on { included.insert(t) } else { included.remove(t) } } }
                        }
                    }
                    Section("Never share recipes tagged") {
                        ForEach(tags, id: \.self) { t in toggle(t, excluded.contains(t)) { on in if on { excluded.insert(t) } else { excluded.remove(t) } } }
                    }
                }
            }
            .navigationTitle(share == nil ? "Share our library" : "What’s shared").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(link == nil ? "Cancel" : "Done") { dismiss() } }
                if link == nil {
                    ToolbarItem(placement: .confirmationAction) { Button(share == nil ? "Create" : "Save") { Task { await save() } }.bold() }
                }
            }
        }
        .onAppear {
            guard let share else { return }
            label = share.label ?? ""
            base = share.baseScope
            chosen = Set(share.includeCollectionIds)
            included = Set(share.includeTags)
            excluded = Set(share.excludeTags)
        }
    }

    private func toggle(_ title: String, _ on: Bool, set: @escaping (Bool) -> Void) -> some View {
        Toggle(title, isOn: Binding(get: { on }, set: set)).tint(Theme.brand)
    }

    private func save() async {
        let values: JSONValue = .object([
            "baseScope": .string(base),
            "collectionIds": .array(chosen.sorted().map { .string($0) }),
            "includeTags": .array(included.sorted().map { .string($0) }),
            "excludeTags": .array(excluded.sorted().map { .string($0) }),
            "label": .string(label),
        ])
        if let share {
            if await WebAction.run("library.updateScope", [.string(share.id), values], done: "Saved.") { await saved(); dismiss() }
            return
        }
        struct Reply: Decodable, Sendable { var url: String? }
        do {
            let r = try await AppModel.shared.api.action("library.create", [values], as: Reply.self)
            await saved()
            link = r.url.flatMap(URL.init(string:))
            if link == nil { dismiss() }
        } catch {
            AppModel.shared.toast = WebAction.explain(error)
        }
    }
}

/// Another household's shared library: browse, pick, and copy into ours.
struct SharedLibraryScreen: View {
    struct Library: Decodable, Sendable {
        struct Recipe: Decodable, Sendable, Identifiable, Hashable {
            var id: String; var title: String; var description: String?; var cuisine: String?
            var prepTimeMinutes: Int?; var cookTimeMinutes: Int?; var imageUrl: String?; var thumbnailUrl: String?
        }
        var recipes: [Recipe]
        var cuisines: [String]
    }
    let share: LibraryData.Incoming
    @State private var data: Remote<Library>
    @State private var picked: Set<String> = []
    @State private var search = ""
    @State private var importing = false

    init(share: LibraryData.Incoming) {
        self.share = share
        _data = State(initialValue: Remote<Library>("library.browse", [.string(share.id)]))
    }

    var body: some View {
        WebPage(title: share.label ?? share.ownerHouseholdName, subtitle: "From \(share.ownerHouseholdName). Pick recipes to copy into yours.", data: data) { lib in
            SearchField(prompt: "Search their recipes…", text: $search)
            let shown = lib.recipes.filter { search.isEmpty || "\($0.title) \($0.cuisine ?? "")".localizedCaseInsensitiveContains(search) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 10)], spacing: 10) {
                ForEach(shown) { r in
                    let on = picked.contains(r.id)
                    Button { if on { picked.remove(r.id) } else { picked.insert(r.id) } } label: {
                        HStack(spacing: 12) {
                            AsyncImage(url: AppModel.shared.imageURL(r.thumbnailUrl ?? r.imageUrl)) { phase in
                                if let image = phase.image { image.resizable().scaledToFill() } else { Theme.muted }
                            }
                            .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.title).font(.system(size: 15, weight: .semibold)).lineLimit(2).multilineTextAlignment(.leading)
                                Text([r.cuisine, Format.minutes((r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0))].compactMap { $0 }.joined(separator: " · "))
                                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                            }
                            Spacer()
                            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22)).foregroundStyle(on ? Theme.brand : Theme.border)
                        }
                        .padding(10).card()
                    }
                    .buttonStyle(.plain).foregroundStyle(Theme.foreground)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !picked.isEmpty {
                Button {
                    Task {
                        importing = true; defer { importing = false }
                        struct Result: Decodable, Sendable { var imported: Int; var skipped: Int; var collectionName: String? }
                        do {
                            let r = try await AppModel.shared.api.action("library.import", [.string(share.id), .array(picked.map { .string($0) })], as: Result.self)
                            AppModel.shared.toast = "Copied \(r.imported) recipe\(r.imported == 1 ? "" : "s")" + (r.collectionName.map { " into \($0)" } ?? "")
                            picked = []
                            await AppModel.shared.syncNow()
                        } catch { AppModel.shared.toast = WebAction.explain(error) }
                    }
                } label: {
                    Label(importing ? "Copying…" : "Copy \(picked.count) into our recipes", systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.brand).disabled(importing)
                .padding(16).frame(maxWidth: 560)
            }
        }
    }
}
