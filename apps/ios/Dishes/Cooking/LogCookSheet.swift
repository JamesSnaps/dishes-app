// The cook review, as the web's (components/cook-review): one form for every
// place a cook is written — Log a cook on the recipe page, the "All done!"
// debrief at the end of cooking mode, and editing a cook from the history.
//
//   How long it took (−/+ 5 min; after cooking, the real time, and the
//   recipe's cook time is updated when it's 5+ minutes out), your rating, who
//   ate it and what each of them thought, the occasion, notes, and a photo.
//   After cooking there's also "Mark ingredients as used from pantry" and
//   "Review later" (logs the cook, rates it another time — edit it from the
//   history). A new photo gets the AI's take on how it looks, shown before
//   closing, as the web does.

import DishesCore
import PhotosUI
import SwiftUI
import UIKit

struct CookReviewSheet: View {
    enum Mode {
        /// "Log a cook" on the recipe page.
        case log
        /// The end of cooking mode: the time it took and the servings cooked.
        case afterCooking(minutes: Int, servings: Double?)
        /// Changing a cook already logged.
        case edit(CookEntry)
    }

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    var mode: Mode = .log
    var onDone: (() -> Void)?

    @State private var duration: Int?
    @State private var rating: Double?
    @State private var ate: Set<String> = []
    @State private var ratings: [String: Double] = [:]
    @State private var occasion = ""
    @State private var notes = ""
    @State private var photo: UIImage?
    @State private var removePhoto = false
    @State private var picked: PhotosPickerItem?
    @State private var usingCamera = false
    @State private var saving = false
    @State private var usedPantry = false
    @State private var usingPantry = false
    /// After saving with a new photo: the AI's feedback, shown before closing.
    @State private var feedback: String?
    @State private var reviewed = false
    @State private var loaded = false

    static let occasions = ["Weeknight dinner", "Date night", "Family dinner", "Birthday", "Anniversary", "Dinner party", "Meal prep"]

    private var myName: String? { app.me?.user.displayName }

    private var existing: CookEntry? {
        if case .edit(let entry) = mode { return entry }
        return nil
    }

    private var afterCooking: Bool {
        if case .afterCooking = mode { return true }
        return false
    }

    /// The real time is 5+ minutes off the recipe's: saving updates the recipe.
    private var cookTimeDiffers: Bool {
        guard afterCooking, let duration else { return false }
        guard let stored = recipe.cookTimeMinutes, stored > 0 else { return true }
        return abs(stored - duration) >= 5
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if reviewed { reviewedView } else { form }
            }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !reviewed {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(afterCooking ? "Review later" : "Cancel") {
                            if afterCooking { Task { await reviewLater() } } else { close() }
                        }
                        .disabled(saving)
                    }
                }
            }
        }
        .interactiveDismissDisabled(saving || afterCooking)
        .fullScreenCover(isPresented: $usingCamera) {
            CameraPicker { photo = $0; removePhoto = false }.ignoresSafeArea()
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    photo = image
                    removePhoto = false
                }
            }
        }
        .onAppear(perform: load)
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 22) {
            header

            field("How long did it take?") {
                HStack(spacing: 12) {
                    stepButton("minus") { duration = max(1, (duration ?? 30) - 5) }
                    Text(duration.map { Format.minutes($0) ?? "\($0) min" } ?? "—")
                        .font(.system(size: 18, weight: .semibold).monospacedDigit())
                        .frame(minWidth: 80)
                    stepButton("plus") { duration = (duration ?? 25) + 5 }
                    if cookTimeDiffers, let stored = recipe.cookTimeMinutes {
                        Text("Recipe says \(stored) min — we’ll update it")
                            .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                    } else if afterCooking && recipe.cookTimeMinutes == nil {
                        Text("We’ll save this as the cook time")
                            .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                    } else if duration != nil {
                        Button("Clear") { duration = nil }
                            .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                    }
                }
            }

            field(myName.map { "\($0), what did you think?" } ?? "Your rating") {
                HStack(spacing: 14) {
                    StarRating(value: $rating, size: 34)
                    if let rating {
                        Text("\(Format.amount(String(rating / 2)) ?? "")/5")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
            }

            if !app.members.isEmpty {
                field("Who ate?") {
                    FlowLayout(spacing: 8) {
                        ForEach(app.members) { member in
                            chip(member.displayName, on: ate.contains(member.displayName), icon: true) {
                                if ate.contains(member.displayName) { ate.remove(member.displayName) } else { ate.insert(member.displayName) }
                            }
                        }
                    }
                }
                let others = app.members.map(\.displayName).filter { ate.contains($0) && $0 != myName }
                if !others.isEmpty {
                    field("What did they think?") {
                        VStack(spacing: 10) {
                            ForEach(others, id: \.self) { name in
                                HStack {
                                    Text(name).font(.system(size: 15))
                                    Spacer()
                                    StarRating(value: Binding(get: { ratings[name] }, set: { ratings[name] = $0 }), size: 24)
                                }
                            }
                        }
                        .padding(14)
                        .card()
                    }
                }
            }

            field("What was the occasion?") {
                FlowLayout(spacing: 8) {
                    ForEach(Self.occasions, id: \.self) { o in
                        chip(o, on: occasion == o) { occasion = occasion == o ? "" : o }
                    }
                }
                TextField("Or write your own…", text: $occasion)
                    .padding(12)
                    .background(Theme.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            field("Any notes?") {
                TextField("What worked well, what you’d change, substitutions you made…", text: $notes, axis: .vertical)
                    .lineLimit(3...8)
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
            }

            field("How did it look?") { photoField }

            if afterCooking { pantryButton }

            Button { Task { await save() } } label: {
                Label(saving ? "Saving…" : afterCooking ? "Save & finish" : existing == nil ? "Save" : "Save changes",
                      systemImage: "checkmark")
            }
            .buttonStyle(.brand)
            .disabled(saving)
        }
        .padding(20)
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
    }

    private var header: some View {
        Group {
            if afterCooking {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(Color(hex: 0x22C55E))
                    Text("All done!").font(.system(size: 26, weight: .bold))
                    Text(recipe.title).font(.system(size: 15)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            } else {
                HStack(spacing: 14) {
                    RecipeImage(recipe: recipe)
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(existing == nil ? "Log a cook" : "Edit this cook")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.brand)
                        Text(recipe.title).font(.system(size: 19, weight: .bold)).lineLimit(2)
                        if let existing {
                            Text(existing.cookedAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var photoField: some View {
        let current = photo.map { Image(uiImage: $0) }
        let stored = removePhoto ? nil : app.imageURL(existing?.photoUrl)
        HStack(alignment: .top, spacing: 12) {
            if current != nil || stored != nil {
                Group {
                    if let current {
                        current.resizable().scaledToFill()
                    } else if let stored {
                        AsyncImage(url: stored) { phase in
                            if let image = phase.image { image.resizable().scaledToFill() } else { Theme.muted }
                        }
                    }
                }
                .frame(width: 110, height: 110)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    Button {
                        photo = nil
                        picked = nil
                        if existing?.photoUrl != nil { removePhoto = true }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white, .black.opacity(0.55))
                    }
                    .padding(4)
                    .accessibilityLabel("Remove photo")
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { usingCamera = true } label: { Label("Take a photo", systemImage: "camera") }
                        .buttonStyle(.outline)
                }
                PhotosPicker(selection: $picked, matching: .images) {
                    Label(current == nil && stored == nil ? "Choose a photo" : "Choose another", systemImage: "photo")
                }
                .buttonStyle(.outline)
                if current == nil && stored == nil {
                    Text("Add one and the AI will tell you how it looks.")
                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                }
            }
        }
    }

    @ViewBuilder private var pantryButton: some View {
        if usedPantry {
            Label("Pantry stock updated", systemImage: "checkmark")
                .font(.system(size: 14))
                .foregroundStyle(Theme.mutedForeground)
                .frame(maxWidth: .infinity)
        } else {
            Button {
                Task {
                    usingPantry = true
                    defer { usingPantry = false }
                    var servings = recipe.servings ?? 1
                    if case .afterCooking(_, let cooked?) = mode { servings = cooked }
                    do {
                        try await app.api.usePantry(recipeId: recipe.id, servings: servings)
                        usedPantry = true
                    } catch {
                        app.toast = "Couldn’t update the pantry."
                    }
                }
            } label: {
                Label(usingPantry ? "Updating pantry…" : "Mark ingredients as used from pantry", systemImage: "shippingbox")
            }
            .buttonStyle(.outline)
            .disabled(usingPantry)
        }
    }

    // MARK: After saving

    private var reviewedView: some View {
        VStack(spacing: 20) {
            if let photo {
                Image(uiImage: photo)
                    .resizable().scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: 320)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            if let feedback {
                VStack(alignment: .leading, spacing: 8) {
                    Label("AI feedback", systemImage: "sparkles")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color(hex: 0x6D28D9))
                    Text(feedback).font(.system(size: 15)).foregroundStyle(Theme.foreground.opacity(0.85))
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.violet50, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color(hex: 0xDDD6FE)))
            }
            Text("Your cook has been saved.").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            Button("Done") { close() }.buttonStyle(.brand)
        }
        .padding(20)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }

    // MARK: Pieces

    private func field(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            content()
        }
    }

    private func chip(_ title: String, on: Bool, icon: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if icon {
                    Label(title, systemImage: on ? "checkmark.circle.fill" : "circle").labelStyle(TightLabel())
                } else {
                    Text(title)
                }
            }
            .font(.system(size: 14, weight: .medium))
            .padding(.horizontal, 12)
            .frame(height: 34)
            .foregroundStyle(on ? .white : Theme.foreground)
            .background(on ? Theme.brand : Theme.background, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? .clear : Theme.border))
        }
        .buttonStyle(.plain)
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .frame(width: 38, height: 38)
                .background(Theme.muted, in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.foreground)
    }

    // MARK: Saving

    private func load() {
        guard !loaded else { return }
        loaded = true
        switch mode {
        case .log:
            // You ate it, most likely.
            if let me = myName, app.members.contains(where: { $0.displayName == me }) { ate.insert(me) }
        case .afterCooking(let minutes, _):
            duration = max(1, minutes)
            if let me = myName, app.members.contains(where: { $0.displayName == me }) { ate.insert(me) }
        case .edit(let entry):
            duration = entry.actualDuration
            ate = Set(entry.cookedFor)
            occasion = entry.occasion ?? ""
            notes = entry.notes ?? ""
            // Your own voice is stored under your name among everyone's.
            let mine = entry.memberRatings.first { $0.name.caseInsensitiveCompare(myName ?? "") == .orderedSame }
            rating = mine?.rating ?? entry.rating
            for r in entry.memberRatings where r.name.caseInsensitiveCompare(myName ?? "") != .orderedSame {
                ratings[r.name] = r.rating
            }
        }
    }

    private var memberRatings: [APIClient.LogCook.MemberRating] {
        ratings.filter { ate.contains($0.key) && $0.key != myName }
            .map { .init(name: $0.key, rating: $0.value) }
            .sorted { $0.name < $1.name }
    }

    private var trimmedNotes: String? {
        let t = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private var trimmedOccasion: String? {
        let t = occasion.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let cookId: String
        do {
            if let existing {
                try await app.api.updateCook(id: existing.id, .init(
                    rating: rating, notes: trimmedNotes, cookedFor: ate.isEmpty ? nil : ate.sorted(),
                    memberRatings: memberRatings.isEmpty ? nil : memberRatings,
                    actualDuration: duration, occasion: trimmedOccasion, removePhoto: removePhoto && photo == nil))
                cookId = existing.id
            } else {
                cookId = try await app.api.logCook(.init(
                    recipeId: recipe.id, rating: rating, notes: trimmedNotes, cookedFor: ate.isEmpty ? nil : ate.sorted(),
                    memberRatings: memberRatings.isEmpty ? nil : memberRatings,
                    actualDuration: duration, occasion: trimmedOccasion))
            }
        } catch {
            app.toast = app.online ? "Couldn’t save that cook." : "You’re offline — saving a cook needs a connection for now."
            return
        }
        if cookTimeDiffers, let duration {
            try? await app.api.setCookTime(recipeId: recipe.id, minutes: duration)
        }

        if let photo, let jpeg = Self.jpeg(photo) {
            do {
                _ = try await app.api.uploadCookPhoto(cookId: cookId, image: jpeg)
                feedback = try? await app.api.cookPhotoFeedback(cookId: cookId)
            } catch {
                app.toast = "Cook saved, but the photo didn’t upload."
            }
        }
        await app.syncNow()
        if feedback != nil {
            withAnimation { reviewed = true }
        } else {
            app.toast = existing == nil ? "Cook logged." : "Cook updated."
            close()
        }
    }

    /// Logs the cook — when, how long, who ate — and leaves the rating for later.
    private func reviewLater() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await app.api.logCook(.init(
                recipeId: recipe.id, rating: nil, notes: nil, cookedFor: ate.isEmpty ? nil : ate.sorted(),
                memberRatings: nil, actualDuration: duration, occasion: trimmedOccasion))
            if cookTimeDiffers, let duration { try? await app.api.setCookTime(recipeId: recipe.id, minutes: duration) }
            app.toast = "Cook logged — rate it from the recipe’s history."
            await app.syncNow()
        } catch {
            app.toast = "Couldn’t log the cook."
        }
        close()
    }

    /// At most 2048px on the long side — the server resizes anyway, so there's
    /// no point sending a 12MP original over a kitchen's Wi-Fi.
    static func jpeg(_ image: UIImage) -> Data? {
        let longest = max(image.size.width, image.size.height)
        let scale = min(1, 2048 / max(longest, 1))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: 0.82)
    }

    private func close() {
        dismiss()
        onDone?()
    }
}

/// The camera, for a photo of the dish.
struct CameraPicker: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
