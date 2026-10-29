// "Help me choose", pushed from the log-a-meal-out sheet: the web's
// components/outside-meals/menu-chooser.tsx. Give it the menu (photos, a PDF,
// a link or the text), say who's eating, and the household's AI suggests
// dishes for each of them from the diner brief — dietary requirements,
// tastes, this week's heart-health targets. Ticking the ones ordered hands
// them back to the sheet (`MenuPicks.apply`), which fills in what was eaten.
//
// Vision reads menu photos on the device first: when it gets a good amount of
// text, only the text goes up (smaller, quicker); when it doesn't (a stylised
// or dim menu), the photos do. The choosing itself needs the brief and the
// household key, so it's the server's (POST /api/v1/outside-meals/menu-picks).

import DishesCore
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct MenuChooserView: View {
    @Environment(AppModel.self) private var app

    /// "yyyy-MM-dd": the brief counts the week around it.
    let date: String
    /// The sheet's "Who ate?" so far; empty means everyone.
    let initialDiners: Set<String>
    /// The answer, the picks ticked, and the first menu photo (to keep with the meal).
    let onUse: (MenuPicks, [MenuPicks.Chosen], UIImage?) -> Void

    @State private var photos: [UIImage] = []
    @State private var picking: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var pdf: (name: String, data: Data)?
    @State private var importingPDF = false
    @State private var link = ""
    @State private var text = ""
    @State private var diners: Set<String> = []
    @State private var stage: String?
    @State private var error: String?
    @State private var result: MenuPicks?
    @State private var chosen: Set<String> = []

    private static let maxPhotos = 4
    /// Less recognised text than this and the photos go up instead (RecipeReader's own threshold).
    private static let enoughText = 300

    private var names: [String] { app.members.map(\.displayName) }
    private var hasMenu: Bool {
        !photos.isEmpty || pdf != nil || !link.trimmingCharacters(in: .whitespaces).isEmpty
            || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ScrollView {
            Group {
                if let result { results(result) } else { inputs }
            }
            .padding(20)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Help me choose")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { if photos.count < Self.maxPhotos { photos.append($0) } }.ignoresSafeArea()
        }
        .onChange(of: picking) { _, items in
            guard !items.isEmpty else { return }
            Task {
                for item in items where photos.count < Self.maxPhotos {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        photos.append(image)
                    }
                }
                picking = []
            }
        }
        .fileImporter(isPresented: $importingPDF, allowedContentTypes: [.pdf]) { picked in
            guard case .success(let url) = picked else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) { pdf = (url.lastPathComponent, data) }
        }
        .onAppear {
            if diners.isEmpty { diners = initialDiners.isEmpty ? Set(names) : initialDiners }
        }
    }

    // MARK: The menu

    private var inputs: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Add the menu and the AI suggests dishes for each of you, using what Dishes knows: dietary needs, tastes and this week’s meals.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.mutedForeground)

            section("The menu") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(photos.indices, id: \.self) { i in
                        Image(uiImage: photos[i])
                            .resizable()
                            .scaledToFill()
                            .frame(minWidth: 0, maxWidth: .infinity)
                            .aspectRatio(3 / 4, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(alignment: .topTrailing) {
                                Button { photos.remove(at: i) } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(.white)
                                        .frame(width: 24, height: 24)
                                        .background(.black.opacity(0.6), in: Circle())
                                }
                                .padding(4)
                                .accessibilityLabel("Remove menu photo \(i + 1)")
                            }
                    }
                }
                if photos.count < Self.maxPhotos {
                    HStack(spacing: 8) {
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button { camera = true } label: {
                                Label(photos.isEmpty ? "Camera" : "Another page", systemImage: "camera")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.secondary)
                        }
                        PhotosPicker(selection: $picking, maxSelectionCount: Self.maxPhotos - photos.count, matching: .images) {
                            Label("Library", systemImage: "photo.on.rectangle")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.secondary)
                    }
                }

                TextField("Or a link to the menu (web page or PDF)", text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Theme.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                if let pdf {
                    HStack {
                        Label(pdf.name, systemImage: "doc.richtext").lineLimit(1)
                        Spacer()
                        Button { self.pdf = nil } label: { Image(systemName: "xmark") }
                            .accessibilityLabel("Remove the PDF")
                    }
                    .font(.system(size: 14))
                    .padding(12)
                    .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                } else {
                    Button { importingPDF = true } label: {
                        Label("Or choose a PDF", systemImage: "doc.richtext")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundStyle(Theme.ink)
                }

                TextField("Or paste the menu", text: $text, axis: .vertical)
                    .lineLimit(3...8)
                    .padding(12)
                    .background(Theme.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            if names.count > 1 {
                section("Who’s eating?") {
                    FlowLayout(spacing: 8) {
                        ForEach(names, id: \.self) { name in
                            let on = diners.contains(name)
                            Button {
                                if on { diners.remove(name) } else { diners.insert(name) }
                            } label: {
                                Label(name, systemImage: on ? "checkmark.circle.fill" : "circle")
                                    .labelStyle(TightLabel())
                                    .font(.system(size: 14, weight: .medium))
                                    .padding(.horizontal, 12)
                                    .frame(height: 34)
                                    .foregroundStyle(on ? .white : Theme.foreground)
                                    .background(on ? Theme.brand : Theme.background, in: Capsule())
                                    .overlay(Capsule().strokeBorder(on ? .clear : Theme.border))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if let error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }

            Button { Task { await suggest() } } label: {
                Label(stage ?? "Suggest dishes", systemImage: stage == nil ? "sparkles" : "hourglass")
            }
            .buttonStyle(.wide(.primary))
            .disabled(!hasMenu || diners.isEmpty || stage != nil)
        }
    }

    // MARK: The picks

    private func results(_ r: MenuPicks) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            let header = [r.restaurant.name, r.restaurant.cuisine].compactMap { $0 }.joined(separator: " · ")
            if !header.isEmpty {
                Text(header).font(.system(size: 16, weight: .semibold))
            }
            if let note = r.note {
                Label(note, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.brand)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.warningTint, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            ForEach(r.diners) { d in
                VStack(alignment: .leading, spacing: 10) {
                    if r.diners.count > 1 { Text(d.name).font(.system(size: 15, weight: .semibold)) }
                    if d.picks.isEmpty {
                        Text("No suggestions.").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                    }
                    ForEach(d.picks.indices, id: \.self) { i in pickRow(d, i) }
                    ForEach(d.avoid, id: \.dish) { a in
                        (Text("Maybe not \(a.dish)").fontWeight(.medium) + Text(" — \(a.why)"))
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
                .padding(14)
                .panel()
            }

            Text("Calories are estimates unless the menu prints them. Tick what you ordered to fill in the log.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.mutedForeground)

            HStack(spacing: 10) {
                Button { result = nil } label: { Text("Change the menu").frame(maxWidth: .infinity) }
                    .buttonStyle(.secondary)
                Button {
                    let picks = r.diners.flatMap { d in
                        d.picks.indices.compactMap { i in chosen.contains(key(d, i)) ? MenuPicks.Chosen(diner: d.name, pick: d.picks[i]) : nil }
                    }
                    onUse(r, picks, photos.first)
                } label: {
                    Text(chosen.count > 1 ? "Use these \(chosen.count)" : "Use this")
                }
                .buttonStyle(.wide(.primary))
                .disabled(chosen.isEmpty)
            }
        }
    }

    private func key(_ d: MenuPicks.Diner, _ i: Int) -> String { "\(d.name)#\(i)" }

    private func pickRow(_ d: MenuPicks.Diner, _ i: Int) -> some View {
        let p = d.picks[i]
        let k = key(d, i)
        let on = chosen.contains(k)
        return Button {
            if on { chosen.remove(k) } else { chosen.insert(k) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(on ? Theme.success : Theme.input)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(p.dish).font(.system(size: 15, weight: .semibold))
                        if p.courseKind != .main {
                            Text(p.courseKind.label).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    Text(p.why).font(.system(size: 14))
                    if let tweak = p.lighterTweak {
                        Text("Ask for: \(tweak)").font(.system(size: 12)).foregroundStyle(Theme.success)
                    }
                    if let kcal = p.kcalText {
                        Text(kcal).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                    }
                }
                Spacer(minLength: 0)
            }
            .multilineTextAlignment(.leading)
            .padding(12)
            .background(Theme.background.opacity(0.9), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(on ? Theme.success : .clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.foreground)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: Asking

    private func suggest() async {
        error = nil
        stage = "Reading the menu…"
        defer { stage = nil }

        // Vision first: enough text and the photos needn't go up at all.
        var photoData: [Data] = []
        var menuText = text
        if !photos.isEmpty {
            let pages = photos.compactMap { $0.uprightCGImage(maxDimension: 2400) }
            let read = (try? await RecipeReader.text(of: pages)) ?? ""
            if read.count >= Self.enoughText {
                menuText = [read, text].filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .joined(separator: "\n\n")
            } else {
                photoData = photos.compactMap(CookReviewSheet.jpeg)
            }
        }

        stage = "Choosing dishes…"
        // Everyone ticked is the same as nobody: the whole household.
        let members = diners.count >= names.count ? [] : names.filter(diners.contains)
        do {
            result = try await app.api.menuPicks(.init(date: date, members: members, photos: photoData,
                                                       pdf: pdf?.data, link: link, text: menuText))
            chosen = []
        } catch APIError.http(_, _, let message) {
            error = message
        } catch {
            self.error = app.online ? "Couldn’t read the menu — please try again." : "You’re offline — choosing from a menu needs a connection."
        }
    }

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 15, weight: .semibold))
            content()
        }
    }
}
