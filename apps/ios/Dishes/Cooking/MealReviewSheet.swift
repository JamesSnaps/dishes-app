// One review at the end of a planned meal, as the web's MealDebrief: the meal
// as a whole (stars, who ate and what they thought, occasion, notes, photo),
// then a quick star row for each dish, notes optional — anything skipped just
// isn't rated. Saved as one meal cook with a cook entry per dish
// (`mealCooks.log`, lib/services/meal-cooks.ts); the photo goes on the main
// dish's entry.

import DishesCore
import PhotosUI
import SwiftUI

struct MealReviewSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let groupId: String
    let title: String
    /// Main first.
    let dishes: [Recipe]
    let minutes: Int
    /// Saved: the cook ends.
    var onDone: () -> Void

    @State private var duration: Int?
    @State private var rating: Double?
    @State private var ate: Set<String> = []
    @State private var ratings: [String: Double] = [:]
    @State private var occasion = ""
    @State private var notes = ""
    @State private var dishRatings: [String: Double] = [:]
    @State private var dishNotes: [String: String] = [:]
    @State private var notesOpen: Set<String> = []
    @State private var photo: UIImage?
    @State private var picked: PhotosPickerItem?
    @State private var usingCamera = false
    @State private var saving = false

    private var myName: String? { app.me?.user.displayName }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(spacing: 6) {
                        Image(systemName: "fork.knife.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(Theme.brand)
                        Text("Meal finished").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.brand)
                        Text(title).font(.system(size: 26, weight: .bold))
                        Text("How did the whole meal go?").font(.system(size: 15)).foregroundStyle(Theme.mutedForeground)
                    }
                    .frame(maxWidth: .infinity)

                    field("How long did it take?") {
                        HStack(spacing: 12) {
                            stepButton("minus") { duration = max(1, (duration ?? 30) - 5) }
                            Text(duration.map { Format.minutes($0) ?? "\($0) min" } ?? "—")
                                .font(.system(size: 18, weight: .semibold).monospacedDigit())
                                .frame(minWidth: 80)
                            stepButton("plus") { duration = (duration ?? 25) + 5 }
                        }
                    }

                    field(myName.map { "\($0), what did you think of the meal?" } ?? "The meal") {
                        StarRating(value: $rating, size: 34)
                    }

                    if !app.members.isEmpty {
                        field("Who ate?") {
                            FlowLayout(spacing: 8) {
                                ForEach(app.members) { member in
                                    chip(member.displayName, on: ate.contains(member.displayName)) {
                                        if ate.contains(member.displayName) { ate.remove(member.displayName) } else { ate.insert(member.displayName) }
                                    }
                                }
                            }
                        }
                        let others = app.members.map(\.displayName).filter { ate.contains($0) && $0 != myName }
                        if !others.isEmpty {
                            field("What did they think of the meal?") {
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
                            ForEach(CookReviewSheet.occasions, id: \.self) { o in
                                chip(o, on: occasion == o) { occasion = occasion == o ? "" : o }
                            }
                        }
                        TextField("Or write your own…", text: $occasion)
                            .padding(12)
                            .background(Theme.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }

                    field("Any notes?") {
                        TextField("What worked, what you’d change next time…", text: $notes, axis: .vertical)
                            .lineLimit(3...8)
                            .padding(12)
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                    }

                    field("How did it look?") { photoField }

                    eachDish

                    Button { Task { await save(later: false) } } label: {
                        Label(saving ? "Saving…" : "Save the meal", systemImage: "checkmark")
                    }
                    .buttonStyle(.wide(.primary))
                    .disabled(saving)
                }
                .padding(20)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back to cooking") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Review later") { Task { await save(later: true) } }.disabled(saving)
                }
            }
        }
        .interactiveDismissDisabled(saving)
        .fullScreenCover(isPresented: $usingCamera) {
            CameraPicker { photo = $0 }.ignoresSafeArea()
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) { photo = image }
            }
        }
        .onAppear {
            duration = minutes
            if let myName { ate.insert(myName) }
        }
    }

    /// A quick star row per dish, notes behind a tap.
    private var eachDish: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Each dish").font(.system(size: 16, weight: .bold))
            Text("A quick rating for each part — skip any you like. These go on each recipe’s own history.")
                .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            ForEach(dishes) { dish in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        RecipeImage(recipe: dish)
                            .frame(width: 40, height: 40)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        Text(dish.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                        Spacer()
                        Button {
                            if notesOpen.contains(dish.id) { notesOpen.remove(dish.id) } else { notesOpen.insert(dish.id) }
                        } label: {
                            Image(systemName: "text.bubble").foregroundStyle(Theme.mutedForeground)
                        }
                        .accessibilityLabel("Notes on \(dish.title)")
                    }
                    StarRating(value: Binding(get: { dishRatings[dish.id] }, set: { dishRatings[dish.id] = $0 }), size: 26)
                    if notesOpen.contains(dish.id) {
                        TextField("Anything about the \(dish.title.lowercased())?",
                                  text: Binding(get: { dishNotes[dish.id] ?? "" }, set: { dishNotes[dish.id] = $0 }), axis: .vertical)
                            .lineLimit(2...5)
                            .padding(10)
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                    }
                }
                .padding(14)
                .card()
            }
        }
        .padding(16)
        .panel()
    }

    @ViewBuilder private var photoField: some View {
        HStack(alignment: .top, spacing: 12) {
            if let photo {
                Image(uiImage: photo).resizable().scaledToFill()
                    .frame(width: 110, height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(alignment: .topTrailing) {
                        Button { self.photo = nil; picked = nil } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 22)).foregroundStyle(.white, .black.opacity(0.55))
                        }
                        .padding(4)
                        .accessibilityLabel("Remove photo")
                    }
            }
            VStack(alignment: .leading, spacing: 8) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { usingCamera = true } label: { Label("Take a photo", systemImage: "camera") }.buttonStyle(.secondary)
                }
                PhotosPicker(selection: $picked, matching: .images) {
                    Label(photo == nil ? "Choose a photo" : "Choose another", systemImage: "photo")
                }
                .buttonStyle(.secondary)
            }
        }
    }

    private func save(later: Bool) async {
        saving = true
        defer { saving = false }
        let others = ate.filter { $0 != myName }.compactMap { name in ratings[name].map { (name, $0) } }
        let input: JSONValue = .object([
            "groupId": .string(groupId),
            "rating": later ? .null : rating.map { .number($0) } ?? .null,
            "memberRatings": later || others.isEmpty ? .null
                : .array(others.map { .object(["name": .string($0.0), "rating": .number($0.1)]) }),
            "cookedFor": ate.isEmpty ? .null : .array(ate.sorted().map { .string($0) }),
            "occasion": occasion.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(occasion),
            "notes": later || notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(notes),
            "actualDuration": duration.map { .number(Double($0)) } ?? .null,
            "dishes": .array(dishes.map { dish in
                let note = dishNotes[dish.id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return .object([
                    "recipeId": .string(dish.id),
                    "rating": later ? .null : dishRatings[dish.id].map { .number($0) } ?? .null,
                    "notes": later || note.isEmpty ? .null : .string(note),
                ])
            }),
        ])
        struct Logged: Decodable, Sendable { var id: String; var cookIds: [String: String] }
        do {
            let logged = try await app.api.action("mealCooks.log", [input], as: Logged.self)
            // One Health entry per dish eaten, so Health shows "Roast chicken"
            // and "Roast potatoes" rather than one total.
            for dish in dishes {
                if let cookId = logged.cookIds[dish.id] {
                    await HealthLog.shared.record(cookId: cookId, recipe: dish, cookedFor: ate.sorted(), at: .now, portion: 1)
                }
            }
            if !later, let photo, let main = dishes.first, let cookId = logged.cookIds[main.id],
               let jpeg = CookReviewSheet.jpeg(photo) {
                _ = try? await app.api.uploadCookPhoto(cookId: cookId, image: jpeg)
            }
            await app.syncNow()
            app.toast = later ? "Logged \(title) — rate it any time from each recipe." : "Saved \(title)."
            dismiss()
            onDone()
        } catch {
            app.toast = WebAction.explain(error)
        }
    }

    private func field(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 15, weight: .semibold))
            content()
        }
    }

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 12).frame(height: 34)
                .foregroundStyle(on ? .white : Theme.foreground)
                .background(on ? Theme.brand : Theme.background, in: Capsule())
                .overlay(Capsule().strokeBorder(on ? .clear : Theme.border))
        }
        .buttonStyle(.plain)
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold))
                .frame(width: 38, height: 38)
                .background(Theme.muted, in: Circle())
        }
        .buttonStyle(.plain)
    }
}
