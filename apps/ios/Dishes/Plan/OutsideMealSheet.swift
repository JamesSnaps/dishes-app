// A meal not cooked from the library — eaten out, a takeaway, at friends',
// skipped — logged or planned: the web's components/outside-meals/
// outside-meal-sheet.tsx. Opened from the plan day's "Ate out?" / "Not
// cooking?" chip, the orange + menu, and a meal out's card.
//
//   A future date is a plan: kind, meal, where, who — the slot is kept free
//   (no dinner reminder, the AI planner leaves it). Once eaten: what it was,
//   the dish's line from the menu (a photo of the menu is read on the device
//   by Vision, so the text can be trimmed to the dish), a photo of the plate,
//   how big it was, who ate, a rating.
//
// Saving needs a connection: the meal goes to /api/v1/outside-meals, then its
// photos, then one estimate the sheet waits for (API.md, `estimate=false`) —
// and shows, with what it counts towards, before closing. The server row goes
// straight into the store, so the planner has it before the next sync.

import DishesCore
import PhotosUI
import SwiftUI
import UIKit

struct OutsideMealSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    /// The meal being edited; nil to add one.
    var meal: OutsideMeal?
    /// Where a new one starts: "yyyy-MM-dd" and a meal type.
    var date: String
    var mealType = "dinner"
    /// Recipes still planned in the slot: they won't be cooked, so say so.
    var plannedHere: [String] = []

    @State private var kind = OutsideMeal.Kind.eatOut
    @State private var day = Date()
    @State private var type = "dinner"
    @State private var title = ""
    @State private var place = ""
    @State private var details = ""
    @State private var menuText = ""
    @State private var menuKcal = ""
    @State private var portion = OutsideMeal.Portion.typical
    @State private var ate: Set<String> = []
    @State private var rating: Double?
    @State private var notes = ""
    @State private var platePhoto: UIImage?
    @State private var menuPhoto: UIImage?
    @State private var removePlate = false
    @State private var removeMenu = false
    @State private var picking: PhotosPickerItem?
    @State private var pickingFor = Slot.plate
    @State private var camera: Slot?
    @State private var readingMenu = false
    @State private var saving: Stage?
    @State private var result: (meal: OutsideMeal, error: String?)?
    @State private var confirmRemove = false
    @State private var loaded = false

    enum Slot: Identifiable { case plate, menu; var id: Self { self } }
    enum Stage { case saving, estimating, removing }

    private var myName: String? { app.me?.user.displayName }
    private var dayKey: String { localDateKey(day) }
    private var isPlan: Bool { dayKey > localDateKey(Date()) }
    private var skipped: Bool { kind == .skipped }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let result { resultView(result.meal, error: result.error) } else { form }
            }
            .background(Theme.background)
            .navigationTitle(meal.map { $0.kind.label } ?? (isPlan ? "Not cooking" : "Log a meal out"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if result == nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }.disabled(saving != nil)
                    }
                }
            }
        }
        .interactiveDismissDisabled(saving != nil)
        .fullScreenCover(item: $camera) { slot in
            CameraPicker { set($0, for: slot) }.ignoresSafeArea()
        }
        .onChange(of: picking) { _, item in
            guard let item else { return }
            let slot = pickingFor
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    set(image, for: slot)
                }
                picking = nil
            }
        }
        .onAppear(perform: load)
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(isPlan ? "Keeps the slot free — no reminder, and the AI planner leaves it alone."
                        : "Counts towards the week’s nutrition, like a meal from the plan.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.mutedForeground)

            kindPicker

            field("When?") {
                DatePicker("Date", selection: $day, displayedComponents: .date)
                    .labelsHidden()
                FlowLayout(spacing: 8) {
                    ForEach(mealTypeOrder, id: \.self) { t in
                        chip(t.capitalized, on: type == t) { type = t }
                    }
                }
                if !plannedHere.isEmpty {
                    Text("\(plannedHere.joined(separator: ", ")) \(plannedHere.count == 1 ? "is" : "are") still planned here. It won’t count towards the week’s nutrition — move it to another day if you still want to make it.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: 0x92400E))
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.amber50, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }

            if !skipped {
                field(isPlan ? "Where, or what? (optional)" : "What did you have?") {
                    input(kind == .takeaway ? "Chicken tikka masala, pilau rice" : "Ribeye steak & chips", $title)
                    input(kind == .atFriends ? "Whose house?" : "Where from?", $place)
                    if !isPlan {
                        input("Anything else on the plate — sides, sauces, bread, dessert…", $details, lines: 2)
                    }
                }
                if !isPlan {
                    menuSection
                    field("Photo of the plate") { photoRow(.plate) }
                    field("How big was it?") {
                        HStack(spacing: 8) {
                            ForEach(OutsideMeal.Portion.allCases, id: \.self) { p in
                                chip(p.label, on: portion == p) { portion = p }
                            }
                        }
                    }
                }
            }

            if !app.members.isEmpty {
                field(isPlan ? "Who’s going?" : skipped ? "Who skipped it?" : "Who ate?") {
                    FlowLayout(spacing: 8) {
                        ForEach(app.members) { member in
                            chip(member.displayName, on: ate.contains(member.displayName), icon: true) {
                                if ate.contains(member.displayName) { ate.remove(member.displayName) } else { ate.insert(member.displayName) }
                            }
                        }
                    }
                    Text("Nobody picked means everyone.")
                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                }
            }

            if !isPlan && !skipped {
                field(myName.map { "\($0), how was it?" } ?? "How was it?") {
                    StarRating(value: $rating, size: 34)
                }
            }

            field("Notes") {
                input(isPlan ? "Booked for 7:30…" : "Worth going back? What would you order next time?", $notes, lines: 2)
            }

            if isPlan && !skipped {
                Text("Afterwards, open this again to add what you had — a menu photo or a description is enough for an estimate.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            Button { Task { await save() } } label: {
                switch saving {
                case .saving: Label("Saving…", systemImage: "hourglass")
                case .estimating: Label("Estimating nutrition…", systemImage: "sparkles")
                default: Label(meal != nil ? "Save" : isPlan ? "Keep this slot free" : "Log it", systemImage: "checkmark")
                }
            }
            .buttonStyle(.gradient(.orangeRose))
            .disabled(saving != nil || readingMenu)

            if meal != nil {
                Button(role: .destructive) { Task { await remove() } } label: {
                    Label(confirmRemove ? "Tap again to remove it" : "Remove", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.outline)
                .disabled(saving != nil)
            }
        }
        .padding(20)
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
    }

    private var kindPicker: some View {
        HStack(spacing: 8) {
            ForEach(OutsideMeal.Kind.allCases, id: \.self) { k in
                let on = kind == k
                Button { kind = k } label: {
                    VStack(spacing: 5) {
                        Image(systemName: Self.icon(k)).font(.system(size: 18, weight: .semibold))
                        Text(k.label).font(.system(size: 12, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, minHeight: 62)
                    .foregroundStyle(on ? Color(hex: 0x7C2D12) : Theme.mutedForeground)
                    .background(on ? AnyShapeStyle(LinearGradient(colors: [Color(hex: 0xFFEDD5), Color(hex: 0xFFE4E6)],
                                                                  startPoint: .topLeading, endPoint: .bottomTrailing))
                                   : AnyShapeStyle(Theme.muted.opacity(0.6)),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(on ? Color(hex: 0xFB923C) : .clear, lineWidth: 2))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    /// The menu: the best guide to what's in the dish.
    private var menuSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("From the menu", systemImage: "doc.text")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: 0x075985))
            Text("The menu’s description says what’s in the dish — the best guide to its nutrition. A photo of it is read on this \(UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"); trim the text to the dish you had.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.mutedForeground)
            input("Type or paste the dish’s line from the menu", $menuText, lines: 3)
            if readingMenu {
                Label("Reading the menu…", systemImage: "text.viewfinder")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            HStack(spacing: 8) {
                TextField("kcal", text: $menuKcal)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .frame(width: 90)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityLabel("Calories printed on the menu")
                Text("kcal printed on the menu, if it shows them — used as given")
                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
            }
            photoRow(.menu)
        }
        .padding(14)
        .callout(Color(hex: 0xF0F9FF), Theme.indigo50, border: Color(hex: 0xBAE6FD))
    }

    @ViewBuilder private func photoRow(_ slot: Slot) -> some View {
        let shown = slot == .plate ? platePhoto : menuPhoto
        let stored = slot == .plate ? (removePlate ? nil : app.imageURL(meal?.photoUrl))
                                    : (removeMenu ? nil : app.imageURL(meal?.menuPhotoUrl))
        HStack(alignment: .top, spacing: 12) {
            if shown != nil || stored != nil {
                Group {
                    if let shown {
                        Image(uiImage: shown).resizable().scaledToFill()
                    } else if let stored {
                        AsyncImage(url: stored) { phase in
                            if let image = phase.image { image.resizable().scaledToFill() } else { Theme.muted }
                        }
                    }
                }
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    Button { clear(slot) } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white, .black.opacity(0.55))
                    }
                    .padding(4)
                    .accessibilityLabel(slot == .plate ? "Remove the plate photo" : "Remove the menu photo")
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { camera = slot } label: { Label("Take a photo", systemImage: "camera") }
                        .buttonStyle(.outline)
                }
                PhotosPicker(selection: Binding(get: { picking }, set: { pickingFor = slot; picking = $0 }), matching: .images) {
                    Label(shown == nil && stored == nil ? "Choose a photo" : "Choose another", systemImage: "photo")
                }
                .buttonStyle(.outline)
            }
        }
    }

    // MARK: After saving

    private func resultView(_ meal: OutsideMeal, error: String?) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if meal.hasNutrition {
                VStack(alignment: .leading, spacing: 12) {
                    Label(meal.title ?? "Your meal", systemImage: "sparkles")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color(hex: 0x6D28D9))
                    if !meal.components.isEmpty {
                        Text(meal.components.joined(separator: " · "))
                            .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                    }
                    OutsideMealFigures(meal: meal)
                    Text("Restaurant food is hard to pin down — hidden butter and oil, unknown portions — so treat this as a rough guide.")
                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                }
                .padding(16)
                .callout(Theme.violet50, Theme.pink50, border: Color(hex: 0xDDD6FE))
            } else {
                Text("\(error ?? "No estimate this time.") The meal is saved; its protein still counts from what you described.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: 0x92400E))
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.amber50, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            Button("Done") { dismiss() }.buttonStyle(.brand)
        }
        .padding(20)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }

    // MARK: Pieces

    static func icon(_ kind: OutsideMeal.Kind) -> String {
        switch kind {
        case .eatOut: "fork.knife"
        case .takeaway: "takeoutbag.and.cup.and.straw"
        case .atFriends: "person.2"
        case .skipped: "nosign"
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

    private func input(_ prompt: String, _ text: Binding<String>, lines: Int = 1) -> some View {
        TextField(prompt, text: text, axis: lines > 1 ? .vertical : .horizontal)
            .lineLimit(lines > 1 ? lines...8 : 1...1)
            .padding(12)
            .background(Theme.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
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

    private func set(_ image: UIImage, for slot: Slot) {
        switch slot {
        case .plate:
            platePhoto = image
            removePlate = false
        case .menu:
            menuPhoto = image
            removeMenu = false
            Task { await readMenu(image) }
        }
    }

    private func clear(_ slot: Slot) {
        switch slot {
        case .plate:
            platePhoto = nil
            if meal?.photoUrl != nil { removePlate = true }
        case .menu:
            menuPhoto = nil
            if meal?.menuPhotoUrl != nil { removeMenu = true }
        }
    }

    /// Vision reads the menu on the device; the text lands in the field to be
    /// trimmed to the dish. Not over what's been typed already. The server's
    /// limit is 4,000 characters, and a whole menu page can be more.
    private func readMenu(_ image: UIImage) async {
        guard menuText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let page = image.uprightCGImage(maxDimension: 2400) else { return }
        readingMenu = true
        defer { readingMenu = false }
        guard let text = try? await RecipeReader.text(of: [page]), !text.isEmpty,
              menuText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        menuText = String(text.prefix(4000))
    }

    // MARK: Saving

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let meal else {
            day = Self.date(date) ?? Date()
            type = mealType
            if let me = myName, app.members.contains(where: { $0.displayName == me }) { ate.insert(me) }
            return
        }
        kind = meal.kind
        day = Self.date(meal.date) ?? Date()
        type = meal.mealType
        title = meal.title ?? ""
        place = meal.place ?? ""
        details = meal.description ?? ""
        menuText = meal.menuText ?? ""
        menuKcal = meal.menuKcal.map(String.init) ?? ""
        portion = meal.portion
        ate = Set(meal.eatenBy)
        notes = meal.notes ?? ""
        // Your own voice is stored under your name among everyone's.
        let mine = meal.memberRatings.first { $0.name.caseInsensitiveCompare(myName ?? "") == .orderedSame }
        rating = mine?.rating ?? (meal.memberRatings.isEmpty ? meal.rating : nil)
    }

    private static func date(_ key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    private func trimmed(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func save() async {
        let kcal = trimmed(menuKcal).flatMap { Int($0) }
        if trimmed(menuKcal) != nil, !(1..<10000).contains(kcal ?? 0) {
            app.toast = "Menu calories should be a whole number, like 850."
            return
        }
        // A plan or a skipped meal keeps whatever menu details it had: those
        // fields aren't on the form for it.
        var write = APIClient.OutsideMealWrite(
            date: dayKey, mealType: type, kind: kind.rawValue,
            title: trimmed(title), place: trimmed(place),
            description: skipped ? nil : isPlan ? meal?.description : trimmed(details),
            menuText: skipped || isPlan ? meal?.menuText : trimmed(menuText),
            menuKcal: skipped || isPlan ? meal?.menuKcal : kcal,
            portion: portion.rawValue, eatenBy: ate.isEmpty ? nil : ate.sorted(),
            rating: isPlan || skipped ? nil : rating, notes: trimmed(notes))
        write.removePhoto = removePlate && platePhoto == nil
        write.removeMenuPhoto = removeMenu && menuPhoto == nil

        saving = .saving
        defer { saving = nil }
        let row: JSONValue
        do {
            if let meal {
                row = try await app.api.updateOutsideMeal(id: meal.id, write)
            } else {
                row = try await app.api.createOutsideMeal(write)
            }
            try await app.store.write { [row] in try $0.put(.outsideMeals, row) }
        } catch {
            app.toast = app.online ? "Couldn’t save that meal." : "You’re offline — logging a meal out needs a connection."
            return
        }
        guard let saved = OutsideMeal(row) else { dismiss(); return }
        HealthLog.shared.loggedHere(saved.id)

        var photosChanged = write.removePhoto || write.removeMenuPhoto
        for (image, menu) in [(platePhoto, false), (menuPhoto, true)] {
            guard let image, let jpeg = CookReviewSheet.jpeg(image) else { continue }
            do {
                let url = try await app.api.uploadOutsideMealPhoto(id: saved.id, menu: menu, image: jpeg)
                try? await app.engine.patchLocal(.outsideMeals, id: saved.id, [(menu ? "menuPhotoUrl" : "photoUrl"): .string(url)])
                photosChanged = true
            } catch {
                app.toast = "Meal saved, but a photo didn’t upload."
            }
        }

        // What it was changed (or it's new, or never estimated): estimate it.
        var changed = true
        if let m = meal {
            let differences: [Bool] = [m.kind != saved.kind, m.title != saved.title, m.place != saved.place,
                                       m.description != saved.description, m.menuText != saved.menuText,
                                       m.menuKcal != saved.menuKcal, m.portion != saved.portion]
            changed = differences.contains(true)
        }
        let wants = !isPlan && !skipped && saved.nutritionSource != "manual"
            && (saved.isDescribed || platePhoto != nil || menuPhoto != nil)
            && (changed || photosChanged || saved.nutritionSource == "none")
        guard wants else {
            app.toast = meal == nil ? (isPlan ? "Slot kept free." : "Meal logged.") : "Meal updated."
            await app.syncNow()
            dismiss()
            return
        }

        saving = .estimating
        do {
            let estimated = try await app.api.estimateOutsideMeal(id: saved.id)
            try? await app.store.write { [estimated] in try $0.put(.outsideMeals, estimated) }
            let meal = OutsideMeal(estimated) ?? saved
            await HealthLog.shared.reconcileOutside([meal])
            result = (meal, nil)
        } catch APIError.http(_, _, let message) {
            result = (saved, message)
        } catch {
            result = (saved, app.online ? "The estimate didn’t come back — it’ll be tried again later." : "You’re offline, so there’s no estimate yet.")
        }
        await app.syncNow()
    }

    private func remove() async {
        guard let meal else { return }
        guard confirmRemove else { confirmRemove = true; return }
        saving = .removing
        defer { saving = nil }
        do {
            try await app.api.deleteOutsideMeal(id: meal.id)
            try? await app.store.write { try $0.remove(.outsideMeals, id: meal.id) }
            await HealthLog.shared.forgetOutside(meal.id)
            app.toast = "Removed."
            await app.syncNow()
            dismiss()
        } catch {
            app.toast = app.online ? "Couldn’t remove that meal." : "You’re offline — try again with a connection."
        }
    }
}

/// A meal out's figures, one portion as eaten (the web's OutsideMealNutrition).
struct OutsideMealFigures: View {
    let meal: OutsideMeal

    struct Row: Identifiable {
        var label: String
        var text: String
        var id: String { label }
    }

    static func rows(_ m: OutsideMeal) -> [Row] {
        func grams(_ v: Double?) -> String { v.map { $0.formatted(.number.precision(.fractionLength(0...1))) + "g" } ?? "—" }
        return [
            Row(label: "Protein", text: grams(m.proteinG)), Row(label: "Carbs", text: grams(m.carbsG)),
            Row(label: "Fat", text: grams(m.fatG)), Row(label: "Sat fat", text: grams(m.saturatedFatG)),
            Row(label: "Fibre", text: grams(m.fiberG)), Row(label: "Sugar", text: grams(m.sugarG)),
            Row(label: "Sodium", text: m.sodiumMg.map { "\(Int($0.rounded()))mg" } ?? "—"),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let kcal = meal.calories {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Int(kcal.rounded()).formatted()).font(.system(size: 30, weight: .bold).monospacedDigit())
                    Text("kcal").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                    Spacer()
                    Text(meal.nutritionSource == "manual" ? "Entered" : meal.menuKcal != nil ? "kcal from the menu · rest estimated" : "Estimate")
                        .font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.violet50, in: Capsule())
                        .foregroundStyle(Color(hex: 0x6D28D9))
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(Self.rows(meal)) { row in
                    VStack(spacing: 2) {
                        Text(row.label.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                        Text(row.text).font(.system(size: 14, weight: .semibold).monospacedDigit())
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(Theme.background.opacity(0.7), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
        }
    }
}

/// A meal out in the day's list (the web's outside-meal-card.tsx): what and
/// where, and the figures once estimated. Tapping it opens the sheet.
struct OutsideMealCard: View {
    @Environment(AppModel.self) private var app
    let meal: OutsideMeal
    /// A narrow week column: no detail line.
    var compact = false

    private var isPast: Bool { meal.date <= localDateKey(Date()) }

    private var tint: (from: Color, to: Color, border: Color, icon: [Color]) {
        switch meal.kind {
        case .eatOut: (Color(light: 0xFEF3C7, dark: 0x2A1C05), Color(light: 0xFFE4E6, dark: 0x2A0E14), Color(hex: 0xFCD34D), [Color(hex: 0xF59E0B), Color(hex: 0xF43F5E)])
        case .takeaway: (Color(light: 0xEDE9FE, dark: 0x1C1433), Color(light: 0xFCE7F3, dark: 0x2A0F1F), Color(hex: 0xC4B5FD), [Color(hex: 0x8B5CF6), Color(hex: 0xEC4899)])
        case .atFriends: (Color(light: 0xD1FAE5, dark: 0x052E1F), Color(light: 0xE0F2FE, dark: 0x0B2233), Color(hex: 0x6EE7B7), [Color(hex: 0x10B981), Color(hex: 0x0EA5E9)])
        case .skipped: (Theme.muted, Theme.muted.opacity(0.6), Theme.border, [Color(hex: 0x94A3B8), Color(hex: 0x71717A)])
        }
    }

    private var detail: String {
        if meal.kind == .skipped { return "Not eaten" }
        if let kcal = meal.calories {
            let sat = meal.saturatedFatG.map { " · \($0.formatted(.number.precision(.fractionLength(0...1)))) g sat fat" } ?? ""
            return "\(meal.nutritionSource == "manual" ? "" : "≈ ")\(Int(kcal.rounded()).formatted()) kcal\(sat)"
        }
        if isPast { return meal.isDescribed ? "No nutrition yet — tap to estimate" : "Tap to add what you had" }
        return "No reminder · the AI planner leaves this slot"
    }

    var body: some View {
        let colours = tint
        HStack(spacing: 12) {
            Group {
                if let url = app.imageURL(meal.photoUrl), !compact {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() } else { Theme.muted }
                    }
                } else {
                    LinearGradient(colors: colours.icon, startPoint: .topLeading, endPoint: .bottomTrailing)
                        .overlay(Image(systemName: OutsideMealSheet.icon(meal.kind))
                            .font(.system(size: compact ? 14 : 20, weight: .semibold))
                            .foregroundStyle(.white))
                }
            }
            .frame(width: compact ? 30 : 48, height: compact ? 30 : 48)
            .clipShape(RoundedRectangle(cornerRadius: compact ? 8 : 10, style: .continuous))
            .shadow(color: .black.opacity(0.12), radius: 2, y: 1)

            VStack(alignment: .leading, spacing: 2) {
                Text("\(meal.mealType.capitalized) · \(meal.kind.label)")
                    .font(.system(size: compact ? 10 : 12, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
                Text(meal.label)
                    .font(.system(size: compact ? 13 : 16, weight: .bold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(compact ? 2 : 1)
                if !compact {
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.mutedForeground)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if !compact {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
            }
        }
        .padding(compact ? 8 : 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .callout(colours.from, colours.to, border: colours.border.opacity(0.7))
        .shadow(color: .black.opacity(0.05), radius: 3, y: 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens it to edit")
    }
}
