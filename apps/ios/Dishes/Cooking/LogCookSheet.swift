// Log a cook, as the web's review sheet (add-cook-review-sheet.tsx): your
// rating, who ate it, what each of them thought, and notes. Opened from the
// recipe page, and offered when you tap Finish in cooking mode.
//
// cooked_for and member_ratings key on display names (the web does the same),
// so the names come from the household's members.

import DishesCore
import SwiftUI

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
        if await app.logCook(cook) { finish() }
    }

    private func finish() {
        dismiss()
        onDone?()
    }
}
