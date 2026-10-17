// Log a cook, as the web's review sheet (add-cook-review-sheet.tsx): your
// rating, who ate it, what each of them thought, and notes. Opened from the
// recipe page, and offered when you tap Finish in cooking mode.
//
// cooked_for and member_ratings key on display names (the web does the same),
// so the names come from the household's members.

import DishesCore
import PhotosUI
import SwiftUI
import UIKit

struct LogCookSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    /// After cooking mode: "Skip" rather than "Cancel".
    var afterCooking = false
    var onDone: (() -> Void)?

    @State private var rating: Double?
    @State private var ate: Set<String> = []
    @State private var ratings: [String: Double] = [:]
    @State private var notes = ""
    @State private var saving = false
    @State private var photo: UIImage?
    @State private var picked: PhotosPickerItem?
    @State private var usingCamera = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(spacing: 14) {
                        RecipeImage(recipe: recipe)
                            .frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(afterCooking ? "How did it go?" : "Log a cook")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.brand)
                            Text(recipe.title).font(.system(size: 19, weight: .bold)).lineLimit(2)
                        }
                    }

                    field("Your rating") {
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
                        field("Who ate it?") {
                            FlowLayout(spacing: 8) {
                                ForEach(app.members) { member in
                                    let on = ate.contains(member.displayName)
                                    Button {
                                        if on { ate.remove(member.displayName) } else { ate.insert(member.displayName) }
                                    } label: {
                                        Label(member.displayName, systemImage: on ? "checkmark.circle.fill" : "circle")
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
                        let others = app.members.map(\.displayName).filter { ate.contains($0) && $0 != app.me?.user.displayName }
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

                    field("Photo") {
                        HStack(spacing: 12) {
                            if let photo {
                                Image(uiImage: photo)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 96, height: 96)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(alignment: .topTrailing) {
                                        Button { self.photo = nil; picked = nil } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .font(.system(size: 20))
                                                .foregroundStyle(.white, .black.opacity(0.5))
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
                                let pickLabel = photo == nil ? "Choose a photo" : "Choose another"
                                PhotosPicker(selection: $picked, matching: .images) {
                                    Label(pickLabel, systemImage: "photo")
                                }
                                .buttonStyle(.outline)
                            }
                        }
                    }

                    field("Notes") {
                        TextField("What would you change next time?", text: $notes, axis: .vertical)
                            .lineLimit(3...8)
                            .padding(12)
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                    }

                    Button {
                        Task { await save() }
                    } label: {
                        Label(saving ? "Saving…" : "Save", systemImage: "checkmark")
                    }
                    .buttonStyle(.brand)
                    .disabled(saving)
                }
                .padding(20)
            }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(afterCooking ? "Skip" : "Cancel") { finish() }
                }
            }
        }
        .fullScreenCover(isPresented: $usingCamera) {
            CameraPicker { photo = $0 }.ignoresSafeArea()
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    photo = image
                }
            }
        }
        .onAppear {
            // You ate it, most likely.
            if let me = app.me?.user.displayName, app.members.contains(where: { $0.displayName == me }) { ate.insert(me) }
        }
    }

    private func field(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            content()
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let memberRatings = ratings.filter { ate.contains($0.key) }
            .map { APIClient.LogCook.MemberRating(name: $0.key, rating: $0.value) }
            .sorted { $0.name < $1.name }
        let cook = APIClient.LogCook(
            recipeId: recipe.id, rating: rating, notes: trimmed.isEmpty ? nil : trimmed,
            cookedFor: ate.isEmpty ? nil : ate.sorted(), memberRatings: memberRatings.isEmpty ? nil : memberRatings)
        if await app.logCook(cook, photo: photo.flatMap(Self.jpeg)) { finish() }
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

    private func finish() {
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

