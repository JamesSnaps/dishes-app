// A meal not cooked from the library — eaten out, a takeaway, at friends',
// skipped — logged or planned: the web's components/outside-meals/
// outside-meal-sheet.tsx. Opened from the plan day's "Ate out?" / "Not
// cooking?" chip, the orange + menu, and a meal out's card.
//
//   A future date is a plan: kind, meal, where, who — the slot is kept free
//   (no dinner reminder, the AI planner leaves it). Once eaten: what it was,
//   the dish's line from the menu (a photo of the menu is read on the device
//   by Vision, so the text can be trimmed to the dish), a photo of the plate,
//   how big it was, who ate, a rating. More than one course (starter, main,
//   dessert…) gets a card each — its words, printed kcal and photo — and is
//   estimated course by course.
//
// For today or later, "Help me choose" (MenuChooserView) reads the menu and
// suggests dishes for each person eating; the ones ticked fill in the form.
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
    @State private var courses: [CourseDraft] = []
    @State private var picking: PhotosPickerItem?
    @State private var pickingFor = Slot.plate
    @State private var camera: Slot?
    @State private var readingMenu = false
    @State private var saving: Stage?
    @State private var result: (meal: OutsideMeal, error: String?)?
    @State private var confirmRemove = false
    @State private var loaded = false
    @State private var choosing = false

    enum Slot: Identifiable, Hashable { case plate, menu, course(String); var id: Self { self } }
    enum Stage { case saving, estimating, removing }

    /// A course on the form; `stored` is its saved photo, unless removed.
    struct CourseDraft: Identifiable {
        var id: String
        var course: OutsideMeal.Course.Kind
        var text = ""
        var kcal = ""
        var photo: UIImage?
        var stored: String?
        var removePhoto = false
    }

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
            .navigationDestination(isPresented: $choosing) {
                MenuChooserView(date: dayKey, initialDiners: ate) { restaurant, chosen, photo in
                    apply(restaurant, chosen, menuPhoto: photo)
                }
            }
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
                        .foregroundStyle(Theme.brand)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.warningTint, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }

            if !skipped && dayKey >= localDateKey(Date()) {
                Button { choosing = true } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "wand.and.stars").font(.system(size: 20, weight: .semibold))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Help me choose").font(.system(size: 15, weight: .semibold))
                            Text("Snap the menu for suggestions that suit each of you")
                                .font(.system(size: 12))
                                .opacity(0.85)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(Theme.brandForeground)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Theme.brand, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                }
                .buttonStyle(.plain)
            }

            if !skipped {
                field(isPlan ? "Where, or what? (optional)" : courses.isEmpty ? "What did you have?" : "Where was it?") {
                    // With courses, what was eaten is on their cards: this is just where.
                    if courses.isEmpty {
                        input(kind == .takeaway ? "Chicken tikka masala, pilau rice" : "Ribeye steak & chips", $title)
                    }
                    input(kind == .atFriends ? "Whose house?" : "Where from?", $place)
                    if !courses.isEmpty {
                        input("Name it, if you like — else it’s named from the courses", $title)
                    }
                    if !isPlan {
                        input(courses.isEmpty ? "Anything else on the plate — sides, sauces, bread, dessert…"
                                              : "Anything else — bread for the table, sides to share, drinks…", $details, lines: 2)
                    }
                }
                if !isPlan {
                    coursesSection
                    menuSection
                    // With courses, each has its own photo; a table photo stays if there is one.
                    if courses.isEmpty || platePhoto != nil || (meal?.photoUrl != nil && !removePlate) {
                        field(courses.isEmpty ? "Photo of the plate" : "Photo of the table") { photoRow(.plate) }
                    }
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
            .buttonStyle(.wide(.primary))
            .disabled(saving != nil || readingMenu)

            if meal != nil {
                Button(role: .destructive) { Task { await remove() } } label: {
                    Label(confirmRemove ? "Tap again to remove it" : "Remove", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.secondary)
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
                    .foregroundStyle(on ? Theme.brand : Theme.mutedForeground)
                    .background(on ? AnyShapeStyle(Theme.highlight)
                                   : AnyShapeStyle(Theme.muted.opacity(0.6)),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(on ? Theme.brand : .clear, lineWidth: 2))
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
                .foregroundStyle(Theme.ink)
            Text(courses.isEmpty
                 ? "The menu’s description says what’s in the dish — the best guide to its nutrition. A photo of it is read on this \(UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"); trim the text to the dish you had."
                 : "Each course’s line can go on its card — or put the menu here and the AI matches them up.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.mutedForeground)
            input(courses.isEmpty ? "Type or paste the dish’s line from the menu" : "Type or paste the lines from the menu", $menuText, lines: 3)
            if readingMenu {
                Label("Reading the menu…", systemImage: "text.viewfinder")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            if courses.isEmpty {
                HStack(spacing: 8) {
                    kcalField($menuKcal, label: "Calories printed on the menu")
                    Text("kcal printed on the menu, if it shows them — used as given")
                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                }
            }
            photoRow(.menu)
        }
        .padding(14)
        .panel()
    }

    /// A card per course, and buttons to add one of each kind (the web's CoursesField).
    private var coursesSection: some View {
        field(courses.isEmpty ? "More than one course?" : "Courses") {
            if courses.isEmpty {
                Text("Add a starter, dessert or drinks and each is estimated on its own, with its own menu kcal and photo.")
                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
            }
            ForEach($courses) { $c in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(c.course.label).font(.system(size: 15, weight: .semibold))
                        Spacer()
                        Button { courses.removeAll { $0.id == c.id } } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 12, weight: .bold))
                                .frame(width: 28, height: 28)
                                .background(Theme.background.opacity(0.8), in: Circle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.mutedForeground)
                        .accessibilityLabel("Remove the \(c.course.label.lowercased())")
                    }
                    input(Self.coursePrompt(c.course), $c.text, lines: 2)
                    HStack(spacing: 8) {
                        kcalField($c.kcal, label: "Calories printed on the menu for the \(c.course.label.lowercased())")
                        Text("kcal on the menu, if shown").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                    }
                    photoRow(.course(c.id))
                }
                .padding(14)
                .panel()
            }
            if courses.count < 8 {
                FlowLayout(spacing: 8) {
                    ForEach(OutsideMeal.Course.Kind.allCases, id: \.self) { kind in
                        Button { addCourse(kind) } label: {
                            Label(kind.label, systemImage: "plus")
                                .font(.system(size: 13, weight: .semibold))
                                .padding(.horizontal, 12)
                                .frame(height: 32)
                                .foregroundStyle(Theme.brand)
                                .background(Theme.highlight, in: Capsule())
                                .overlay(Capsule().strokeBorder(Theme.brand))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func kcalField(_ text: Binding<String>, label: String) -> some View {
        TextField("kcal", text: text)
            .keyboardType(.numberPad)
            .padding(10)
            .frame(width: 90)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityLabel(label)
    }

    static func coursePrompt(_ kind: OutsideMeal.Course.Kind) -> String {
        switch kind {
        case .starter: "Salt & pepper squid, aioli"
        case .main: "8oz ribeye, triple-cooked chips, peppercorn sauce"
        case .side: "Onion rings"
        case .dessert: "Sticky toffee pudding, vanilla ice cream"
        case .drink: "Large glass of red"
        }
    }

    static func courseTint(_ kind: OutsideMeal.Course.Kind) -> (Color, Color) {
        switch kind {
        case .starter: (Theme.successTint, Theme.successTint)
        case .main: (Theme.highlight, Theme.highlight)
        case .side: (Theme.warningTint, Theme.warningTint)
        case .dessert: (Theme.highlight, Theme.muted)
        case .drink: (Theme.muted, Theme.muted)
        }
    }

    /// Kept in eating order, as they're shown everywhere else. The first one
    /// takes over the dish already described — it becomes the main, with its
    /// menu kcal — so it isn't typed twice; the AI names the sitting instead.
    private func addCourse(_ kind: OutsideMeal.Course.Kind) {
        if courses.isEmpty, !title.trimmingCharacters(in: .whitespaces).isEmpty || !menuKcal.isEmpty {
            courses = [CourseDraft(id: UUID().uuidString.lowercased(), course: .main, text: title, kcal: menuKcal)]
            title = ""
            menuKcal = ""
            if kind == .main { return }
        }
        let rank = { (k: OutsideMeal.Course.Kind) in OutsideMeal.Course.Kind.allCases.firstIndex(of: k) ?? 0 }
        let at = courses.firstIndex { rank($0.course) > rank(kind) } ?? courses.endIndex
        courses.insert(CourseDraft(id: UUID().uuidString.lowercased(), course: kind), at: at)
    }

    /// The photo picked just now, else the saved one (unless removed).
    private func photos(_ slot: Slot) -> (shown: UIImage?, stored: URL?) {
        switch slot {
        case .plate: (platePhoto, removePlate ? nil : app.imageURL(meal?.photoUrl))
        case .menu: (menuPhoto, removeMenu ? nil : app.imageURL(meal?.menuPhotoUrl))
        case .course(let id):
            courses.first { $0.id == id }.map { ($0.photo, app.imageURL($0.stored)) } ?? (nil, nil)
        }
    }

    @ViewBuilder private func photoRow(_ slot: Slot) -> some View {
        let (shown, stored) = photos(slot)
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
                    .accessibilityLabel(slot == .plate ? "Remove the plate photo" : slot == .menu ? "Remove the menu photo" : "Remove the course photo")
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { camera = slot } label: { Label("Take a photo", systemImage: "camera") }
                        .buttonStyle(.secondary)
                }
                PhotosPicker(selection: Binding(get: { picking }, set: { pickingFor = slot; picking = $0 }), matching: .images) {
                    Label(shown == nil && stored == nil ? "Choose a photo" : "Choose another", systemImage: "photo")
                }
                .buttonStyle(.secondary)
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
                        .foregroundStyle(Theme.ink)
                    if !meal.courses.isEmpty {
                        OutsideMealCourses(meal: meal)
                    } else if !meal.components.isEmpty {
                        Text(meal.components.joined(separator: " · "))
                            .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                    }
                    if let error {
                        Text("\(error) These are the figures from before.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.brand)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.warningTint, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    OutsideMealFigures(meal: meal)
                    Text("Restaurant food is hard to pin down — hidden butter and oil, unknown portions — so treat this as a rough guide.")
                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                }
                .padding(16)
                .panel()
            } else {
                Text("\(error ?? "No estimate this time.") The meal is saved; its protein still counts from what you described.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.brand)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.warningTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            Button("Done") { dismiss() }.buttonStyle(.wide(.primary))
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
        case .course(let id):
            guard let i = courses.firstIndex(where: { $0.id == id }) else { return }
            courses[i].photo = image
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
        case .course(let id):
            guard let i = courses.firstIndex(where: { $0.id == id }) else { return }
            courses[i].photo = nil
            if courses[i].stored != nil { courses[i].stored = nil; courses[i].removePhoto = true }
        }
    }

    /// What "Help me choose" picked becomes what was eaten (`MenuPicks.apply`,
    /// as the web sheet): one dish fills in the dish and its menu line, several
    /// become courses; a plan keeps only the names. The menu photo is kept for
    /// the estimate, unless the meal has one already.
    private func apply(_ restaurant: MenuPicks.Restaurant?, _ chosen: [MenuPicks.Chosen], menuPhoto photo: UIImage?) {
        let a = MenuPicks.apply(chosen, restaurant: restaurant, everyone: app.members.map(\.displayName), isPlan: isPlan,
                                placeIsEmpty: trimmed(place) == nil)
        if let p = a.place { place = p }
        ate = Set(a.eatenBy)
        if isPlan {
            title = a.title
        } else if a.courses.isEmpty {
            title = a.title
            menuText = a.menuText
            menuKcal = a.menuKcal
            courses = []
        } else {
            title = ""
            menuText = ""
            menuKcal = ""
            courses = a.courses.map { CourseDraft(id: UUID().uuidString.lowercased(), course: $0.kind, text: $0.text, kcal: $0.kcal) }
        }
        if let photo, !isPlan, menuPhoto == nil, meal?.menuPhotoUrl == nil || removeMenu {
            menuPhoto = photo
            removeMenu = false
        }
        choosing = false
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
        courses = meal.courses.map {
            CourseDraft(id: $0.id, course: $0.course, text: $0.text ?? "", kcal: $0.menuKcal.map(String.init) ?? "", stored: $0.photoUrl)
        }
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

    /// "850" → 850, "" → nil; false when it isn't a usable figure.
    private func kcal(_ text: String) -> (ok: Bool, value: Int?) {
        guard let t = trimmed(text) else { return (true, nil) }
        guard let n = Int(t), (1..<10000).contains(n) else { return (false, nil) }
        return (true, n)
    }

    private func save() async {
        let menu: (ok: Bool, value: Int?) = courses.isEmpty ? kcal(menuKcal) : (true, nil)
        if !menu.ok || courses.contains(where: { !kcal($0.kcal).ok }) {
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
            menuKcal: skipped || isPlan ? meal?.menuKcal : menu.value,
            portion: portion.rawValue, eatenBy: ate.isEmpty ? nil : ate.sorted(),
            rating: isPlan || skipped ? nil : rating, notes: trimmed(notes))
        write.removePhoto = removePlate && platePhoto == nil
        write.removeMenuPhoto = removeMenu && menuPhoto == nil
        // A plan or a skipped meal keeps its courses: they aren't on the form for it.
        if !skipped && !isPlan {
            write.courses = courses.map { c in
                APIClient.OutsideMealWrite.CourseWrite(id: c.id, course: c.course.rawValue, text: trimmed(c.text),
                                                       menuKcal: kcal(c.kcal).value, removePhoto: c.removePhoto && c.photo == nil)
            }
        }

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

        var photosChanged = write.removePhoto || write.removeMenuPhoto || (write.courses ?? []).contains { $0.removePhoto }
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
        // Course photos land in the course on the server; the estimate (or the
        // sync after it) brings the row back with them.
        if write.courses != nil {
            for course in courses {
                guard let image = course.photo, let jpeg = CookReviewSheet.jpeg(image) else { continue }
                do {
                    _ = try await app.api.uploadOutsideMealCoursePhoto(id: saved.id, courseId: course.id, image: jpeg)
                    photosChanged = true
                } catch {
                    app.toast = "Meal saved, but a photo didn’t upload."
                }
            }
        }

        // What it was changed (or it's new, or never estimated): estimate it.
        var changed = true
        if let m = meal {
            let differences: [Bool] = [m.kind != saved.kind, m.title != saved.title, m.place != saved.place,
                                       m.description != saved.description, m.menuText != saved.menuText,
                                       m.menuKcal != saved.menuKcal, m.portion != saved.portion,
                                       Self.courseKey(m) != Self.courseKey(saved)]
            changed = differences.contains(true)
        }
        let wants = !isPlan && !skipped && saved.nutritionSource != "manual"
            && (saved.isDescribed || platePhoto != nil || menuPhoto != nil || courses.contains { $0.photo != nil })
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

    /// What the estimate reads from each course: any change to it means a new estimate.
    private static func courseKey(_ m: OutsideMeal) -> [String] {
        m.courses.map { "\($0.id)|\($0.course.rawValue)|\($0.text ?? "")|\($0.menuKcal ?? 0)|\($0.photoUrl ?? "")" }
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
                    Text(meal.nutritionSource == "manual" ? "Entered" : meal.usesMenuKcal ? "kcal from the menu · rest estimated" : "Estimate")
                        .font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.muted, in: Capsule())
                        .foregroundStyle(Theme.ink)
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

/// Each course and its share of the calories (the web's OutsideMealCourses).
struct OutsideMealCourses: View {
    let meal: OutsideMeal

    var body: some View {
        VStack(spacing: 6) {
            ForEach(meal.courses) { c in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(c.course.label.uppercased())
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.mutedForeground)
                        .frame(width: 62, alignment: .leading)
                    Text(c.name ?? c.text ?? "—").font(.system(size: 14)).lineLimit(1)
                    Spacer(minLength: 4)
                    if let kcal = c.calories {
                        Text("\(c.menuKcal == nil ? "≈ " : "")\(Int(kcal.rounded()).formatted()) kcal")
                            .font(.system(size: 13).monospacedDigit())
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Theme.background.opacity(0.7), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
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

    private var detail: String {
        if meal.kind == .skipped { return "Not eaten" }
        let courses = meal.courses.count > 1 ? "\(meal.courses.count) courses · " : ""
        return courses + figures
    }

    private var figures: String {
        if let kcal = meal.calories {
            let sat = meal.saturatedFatG.map { " · \($0.formatted(.number.precision(.fractionLength(0...1)))) g sat fat" } ?? ""
            return "\(meal.nutritionSource == "manual" ? "" : "≈ ")\(Int(kcal.rounded()).formatted()) kcal\(sat)"
        }
        if isPast { return meal.isDescribed ? "No nutrition yet — tap to estimate" : "Tap to add what you had" }
        return "No reminder · the AI planner leaves this slot"
    }

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let url = app.imageURL(meal.coverPhotoUrl), !compact {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() } else { Theme.muted }
                    }
                } else {
                    // DESIGN.md → Planner: a fork-and-knife tile on the plate colour.
                    Theme.plate
                        .overlay(Image(systemName: OutsideMealSheet.icon(meal.kind))
                            .font(.system(size: compact ? 14 : 20, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.7)))
                }
            }
            .frame(width: compact ? 30 : 48, height: compact ? 30 : 48)
            .clipShape(RoundedRectangle(cornerRadius: compact ? 8 : 12, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text("\(meal.mealType.capitalized) · \(meal.kind.label)")
                    .font(.system(size: compact ? 10 : 12, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
                Text(meal.label)
                    .font(Theme.serif(compact ? 14 : 17, italic: true))
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
        .panel(fill: Theme.card)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens it to edit")
    }
}
