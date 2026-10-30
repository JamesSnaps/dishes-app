// "Help me choose", pushed from the log-a-meal-out sheet: the web's
// components/outside-meals/menu-chooser.tsx. Give it the menu (photos, a PDF,
// a link or the text), who's eating, the courses they want and the mood
// they're in, and the household's AI suggests dishes for each person and
// course from the diner brief — dietary requirements, tastes, this week's
// heart-health targets.
//
// The answer streams (`APIClient.menuPicksStream`): what the brief says it's
// weighing, each dish as the menu is read, then each pick as it's made, so
// the wait shows the work. The best option in each course is chosen as it
// arrives. "Something else" asks for different options for one course
// (sending back the menu already read, so it's quick); "See the whole menu"
// lets you choose any dish yourself. "Use these" hands the chosen dishes to
// the sheet (`MenuPicks.apply`), which fills in what was eaten.
//
// Vision reads menu photos on the device first: its lines show as the dishes
// being read straight away, and when it gets a good amount of text only the
// text goes up (smaller, quicker); when it doesn't (a stylised or dim menu),
// the photos do.

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
    /// The restaurant, the dishes chosen, and the first menu photo (to keep with the meal).
    let onUse: (MenuPicks.Restaurant?, [MenuPicks.Chosen], UIImage?) -> Void

    private enum Phase { case asking, working, done }
    private struct Slot: Hashable { var diner: String; var course: OutsideMeal.Course.Kind }

    // What to read, and what they're after.
    @State private var photos: [UIImage] = []
    @State private var picking: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var pdf: (name: String, data: Data)?
    @State private var importingPDF = false
    @State private var link = ""
    @State private var text = ""
    @State private var diners: Set<String> = []
    @State private var courses: Set<OutsideMeal.Course.Kind> = [.main]
    @State private var moods: Set<MenuPicks.Mood> = []
    @State private var note = ""

    // The answer, as it streams.
    @State private var phase = Phase.asking
    @State private var stage: String?
    @State private var facts: [String] = []
    @State private var dishes: [String] = []
    @State private var menu: MenuPicks.Menu?
    @State private var options: [Slot: [MenuPicks.Pick]] = [:]
    @State private var chosen: [Slot: Int] = [:]
    @State private var avoid: [MenuPicks.Avoid] = []
    @State private var answerNote: String?
    @State private var error: String?
    /// The app was left while the answer was coming in.
    @State private var leftMidway = false
    /// Cut off while away: start again on coming back.
    @State private var resumeOnReturn = false
    @Environment(\.scenePhase) private var scenePhase

    // Swaps and the whole menu.
    @State private var swapOpen: Slot?
    @State private var swapReasons: Set<String> = []
    @State private var swapText = ""
    @State private var swapping: Slot?
    @State private var showMenu = false
    @State private var activeDiner = ""

    private static let maxPhotos = 4
    /// Less recognised text than this and the photos go up instead (RecipeReader's own threshold).
    private static let enoughText = 300

    private var names: [String] { app.members.map(\.displayName) }
    private var askedFor: [String] { names.filter(diners.contains).isEmpty ? names : names.filter(diners.contains) }
    private var hasMenu: Bool {
        !photos.isEmpty || pdf != nil || !link.trimmingCharacters(in: .whitespaces).isEmpty
            || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    private var chosenPicks: [MenuPicks.Pick] {
        chosen.compactMap { slot, item in options[slot]?.first { $0.item == item } }
            .sorted { (names.firstIndex(of: $0.diner) ?? 0, $0.courseKind.order) < (names.firstIndex(of: $1.diner) ?? 0, $1.courseKind.order) }
    }

    var body: some View {
        ScrollView {
            Group {
                if phase == .asking { inputs } else { answer }
            }
            .padding(20)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
            .animation(.easeOut(duration: 0.25), value: dishes.count)
            .animation(.easeOut(duration: 0.25), value: facts.count)
            .animation(.easeOut(duration: 0.25), value: options.values.map(\.count).reduce(0, +))
        }
        .background(Theme.background)
        .navigationTitle("Help me choose")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: scenePhase) { _, now in
            if now != .active, phase == .working { leftMidway = true }
            if now == .active, resumeOnReturn {
                resumeOnReturn = false
                Task { await suggest(again: true) }
            }
        }
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

    // MARK: The ask

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
                            chip(name, on: diners.contains(name)) {
                                if diners.contains(name) { diners.remove(name) } else { diners.insert(name) }
                            }
                        }
                    }
                }
            }

            section("Courses") {
                FlowLayout(spacing: 8) {
                    ForEach(OutsideMeal.Course.Kind.allCases, id: \.self) { c in
                        chip(c.label, on: courses.contains(c)) {
                            if courses.contains(c) { courses.remove(c) } else { courses.insert(c) }
                        }
                    }
                }
            }

            section("In the mood for") {
                FlowLayout(spacing: 8) {
                    ForEach(MenuPicks.Mood.allCases, id: \.self) { m in
                        chip(m.label, on: moods.contains(m)) {
                            if moods.contains(m) { moods.remove(m) } else { moods.insert(m) }
                        }
                    }
                }
                field("Anything else? Sharing plates, no fish tonight…", $note)
            }

            if let error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.destructive)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }

            Button { Task { await suggest() } } label: {
                Label("Suggest dishes", systemImage: "sparkles")
            }
            .buttonStyle(.wide(.ink))
            .disabled(!hasMenu || diners.isEmpty || courses.isEmpty)
        }
    }

    // MARK: The answer

    private var answer: some View {
        let working = phase == .working
        return VStack(alignment: .leading, spacing: 20) {
            progress(working)

            if askedFor.count > 1 {
                FlowLayout(spacing: 8) {
                    ForEach(askedFor, id: \.self) { d in chip(d, on: activeDiner == d) { activeDiner = d } }
                }
            }

            if showMenu, let menu {
                wholeMenu(menu)
            } else {
                ForEach(courses(for: activeDiner), id: \.self) { course in
                    courseSection(Slot(diner: activeDiner, course: course), working: working)
                }
                let mine = avoid.filter { $0.diner == activeDiner }
                if !mine.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(mine, id: \.item) { a in
                            (Text("Maybe not \(a.dish)").fontWeight(.medium) + Text(" — \(a.why)"))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.mutedForeground)
                        }
                    }
                }
            }

            if let answerNote {
                Label(answerNote, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .panel(radius: 12, fill: Theme.warningTint)
            }
            if let error {
                Text(error).font(.system(size: 14)).foregroundStyle(Theme.destructive)
                    .frame(maxWidth: .infinity).multilineTextAlignment(.center)
            }

            Text("Calories are estimates unless the menu prints them.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.mutedForeground)

            HStack(spacing: 10) {
                Button { phase = .asking } label: { Text("Change").frame(maxWidth: .infinity) }
                    .buttonStyle(.secondary)
                    .disabled(working)
                Button {
                    onUse(menu?.restaurant, chosenPicks.map(MenuPicks.Chosen.init), photos.first)
                } label: {
                    Text(chosenPicks.count > 1 ? "Use these \(chosenPicks.count)" : "Use this")
                }
                .buttonStyle(.wide(.primary))
                .disabled(working || chosenPicks.isEmpty)
            }
        }
    }

    /// What it's doing: the brief, the dishes as they're read, the stage.
    private func progress(_ working: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if working {
                    PlateSpinner()
                    Text("\(stage ?? "Working")…")
                } else {
                    Image(systemName: "checkmark").foregroundStyle(Theme.success)
                    Text("Read \(menu?.items.count ?? dishes.count) dishes\(menu?.restaurant.name.map { " from \($0)" } ?? "")")
                }
            }
            .font(.system(size: 14, weight: .semibold))

            ForEach(facts, id: \.self) { f in
                Label(f, systemImage: "checkmark")
                    .labelStyle(TightLabel())
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.mutedForeground)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if working && !dishes.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(Array(dishes.suffix(14).enumerated()), id: \.offset) { _, d in
                        Text(d)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.mutedForeground)
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(Theme.card, in: Capsule())
                            .transition(.scale(scale: 0.8).combined(with: .opacity))
                    }
                    if dishes.count > 14 {
                        Text("+\(dishes.count - 14) more").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).frame(height: 26)
                    }
                }
            }
            if menu != nil && !working {
                Button { showMenu.toggle() } label: {
                    Label(showMenu ? "Back to the suggestions" : "See the whole menu", systemImage: "menucard")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func courses(for diner: String) -> [OutsideMeal.Course.Kind] {
        let picked = options.keys.filter { $0.diner == diner }.map(\.course)
        return Array(courses.union(picked)).sorted { $0.order < $1.order }
    }

    private func courseSection(_ slot: Slot, working: Bool) -> some View {
        let list = options[slot] ?? []
        let busy = swapping == slot
        return VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: slot.course.label)
            if list.isEmpty {
                Text(working || busy ? "Choosing…" : "Nothing on this menu suits — try another course, or see the whole menu.")
                    .font(.system(size: 13)).italic()
                    .foregroundStyle(Theme.mutedForeground)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.item) { i, p in
                        if i > 0 { Divider() }
                        pickRow(p, slot: slot)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .panel()
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .opacity(busy ? 0.6 : 1)
            }

            if !working, menu != nil {
                if swapOpen == slot {
                    swapPanel(slot)
                } else {
                    Button {
                        swapOpen = slot
                        swapReasons = []
                        swapText = ""
                    } label: {
                        Group {
                            if busy { AIBusyLabel("Finding another…") } else { Label("Something else", systemImage: "arrow.triangle.2.circlepath") }
                        }
                        .font(.system(size: 13, weight: .medium))
                    }
                    .buttonStyle(.secondary)
                    .disabled(swapping != nil)
                }
            }
        }
    }

    private func pickRow(_ p: MenuPicks.Pick, slot: Slot) -> some View {
        let on = chosen[slot] == p.item
        return Button {
            chosen[slot] = on ? nil : p.item
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(on ? Theme.brand : Theme.input)
                VStack(alignment: .leading, spacing: 4) {
                    Text(p.dish).font(.system(size: 15, weight: .semibold))
                    if p.why.isEmpty {
                        Text("Your pick from the menu").font(.system(size: 14)).italic().foregroundStyle(Theme.mutedForeground)
                    } else {
                        Text(p.why).font(.system(size: 14))
                    }
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? Theme.highlight : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.foreground)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func swapPanel(_ slot: Slot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 8) {
                ForEach(MenuPicks.swapReasons, id: \.self) { r in
                    chip(r, on: swapReasons.contains(r)) {
                        if swapReasons.contains(r) { swapReasons.remove(r) } else { swapReasons.insert(r) }
                    }
                }
            }
            field("Or say what you’d like instead", $swapText)
            HStack(spacing: 10) {
                Button { swapOpen = nil } label: { Text("Cancel").frame(maxWidth: .infinity) }
                    .buttonStyle(.secondary)
                Button { Task { await swap(slot) } } label: {
                    Label("Find another \(slot.course.label.lowercased())", systemImage: "sparkles")
                }
                .buttonStyle(.wide(.ink))
            }
        }
        .padding(12)
        .panel()
    }

    /// Every dish the AI read, by section; tapping one chooses it for its course.
    private func wholeMenu(_ menu: MenuPicks.Menu) -> some View {
        let sections = menu.items.reduce(into: [(title: String?, items: [MenuPicks.Item])]()) { acc, it in
            if let last = acc.last, last.title == it.section { acc[acc.count - 1].items.append(it) } else { acc.append((it.section, [it])) }
        }
        let mine = Set(chosenPicks.filter { $0.diner == activeDiner }.map(\.item))
        return VStack(alignment: .leading, spacing: 16) {
            Text("Tap a dish to choose it\(askedFor.count > 1 ? " for \(activeDiner)" : "") — it goes in as its course.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.mutedForeground)
            ForEach(Array(sections.enumerated()), id: \.offset) { _, s in
                VStack(alignment: .leading, spacing: 6) {
                    if let title = s.title { SectionLabel(text: title) }
                    VStack(spacing: 0) {
                        ForEach(Array(s.items.enumerated()), id: \.element.id) { i, it in
                            if i > 0 { Divider() }
                            Button { choose(it) } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(it.line).font(.system(size: 14)).multilineTextAlignment(.leading)
                                        if let kcal = it.kcal {
                                            Text("\(kcal) kcal on the menu").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: mine.contains(it.id) ? "checkmark" : "chevron.right")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(mine.contains(it.id) ? Theme.brand : Theme.mutedForeground)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(mine.contains(it.id) ? Theme.highlight : .clear)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.foreground)
                        }
                    }
                    .panel()
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
        }
    }

    // MARK: Asking

    private func reset() {
        stage = "Getting started"
        facts = []
        dishes = []
        menu = nil
        options = [:]
        chosen = [:]
        avoid = []
        answerNote = nil
        showMenu = false
        activeDiner = askedFor.first ?? ""
    }

    /// `again`: a second go after being cut off while the app was away — not retried twice.
    private func suggest(again: Bool = false) async {
        error = nil
        reset()
        phase = .working
        leftMidway = false
        if again { stage = "Picking up where it left off" }

        // Vision first: its lines show as the dishes being read, and enough
        // text means the photos needn't go up at all.
        var photoData: [Data] = []
        var menuText = text
        if !photos.isEmpty {
            stage = "Reading the menu"
            let pages = photos.compactMap { $0.uprightCGImage(maxDimension: 2400) }
            let read = (try? await RecipeReader.text(of: pages)) ?? ""
            withAnimation { dishes = Self.dishLines(read) }
            if read.count >= Self.enoughText {
                menuText = [read, text].filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .joined(separator: "\n\n")
            } else {
                photoData = photos.compactMap(CookReviewSheet.jpeg)
            }
        }

        // Everyone ticked is the same as nobody: the whole household.
        let members = diners.count >= names.count ? [] : names.filter(diners.contains)
        let request = APIClient.MenuPicksRequest(
            date: date, members: members, photos: photoData, pdf: pdf?.data, link: link, text: menuText,
            courses: courses.sorted { $0.order < $1.order }.map(\.rawValue), moods: moods.map(\.rawValue), note: note)
        var readByServer = false
        do {
            try await withBackgroundTime("menu-picks") {
                for try await event in app.api.menuPicksStream(request) {
                    switch event {
                    case .stage(let s): stage = s
                    case .fact(let f): withAnimation { facts.append(f) }
                    case .dish(let d):
                        // The server's reading replaces the device's rough one.
                        if !readByServer { readByServer = true; dishes = [] }
                        withAnimation { dishes.append(d) }
                    case .menu(let m): menu = m
                    case .pick(let p): withAnimation { add(p) }
                    case .avoid(let a): avoid.append(a)
                    case .done(let n): answerNote = n; phase = .done
                    case .error(let message): error = message; phase = .asking
                    case .unknown: break
                    }
                }
            }
            if phase == .working { phase = .done }
        } catch APIError.http(_, _, let message) {
            error = message
            phase = .asking
        } catch where leftMidway && !again {
            // iOS suspends the app soon after it's left, which drops the connection.
            // Rather than a failure to come back to, carry on once it's back.
            // Asked of the app, not `scenePhase`: this task holds the view as it was when it started.
            if UIApplication.shared.applicationState == .active {
                await suggest(again: true)
            } else {
                stage = "Paused while you’re away — it carries on when you’re back"
                resumeOnReturn = true
            }
        } catch {
            self.error = app.online ? "Couldn’t read the menu — please try again." : "You’re offline — choosing from a menu needs a connection."
            phase = .asking
        }
    }

    /// A pick arriving: added to its course; the first in a course is chosen.
    private func add(_ p: MenuPicks.Pick) {
        let slot = Slot(diner: p.diner, course: p.courseKind)
        options[slot, default: []].append(p)
        if chosen[slot] == nil { chosen[slot] = p.item }
    }

    private func swap(_ slot: Slot) async {
        guard let menu else { return }
        let hint = (swapReasons.sorted() + [swapText.trimmingCharacters(in: .whitespacesAndNewlines)]).filter { !$0.isEmpty }.joined(separator: "; ")
        let members = diners.count >= names.count ? [] : names.filter(diners.contains)
        let request = APIClient.MenuPicksRequest(
            date: date, members: members, menu: menu, swapDiner: slot.diner, swapCourse: slot.course.rawValue,
            exclude: (options[slot] ?? []).map(\.item), hint: hint)
        swapOpen = nil
        swapping = slot
        error = nil
        defer { swapping = nil }
        var fresh: [MenuPicks.Pick] = []
        do {
            try await withBackgroundTime("menu-swap") {
                for try await event in app.api.menuPicksStream(request) {
                    switch event {
                    case .pick(let p):
                        fresh.append(p)
                        // The new options replace the old as they arrive; the first is chosen.
                        withAnimation { options[slot] = fresh }
                        if fresh.count == 1 { chosen[slot] = p.item }
                    case .error(let message): error = message
                    default: break
                    }
                }
            }
            if fresh.isEmpty && error == nil { error = "Nothing else on the menu suits — the options above are the best fit." }
        } catch APIError.http(_, _, let message) {
            error = message
        } catch {
            self.error = "Couldn’t find another — please try again."
        }
    }

    /// A dish chosen from the whole menu, for the person whose tab is open.
    private func choose(_ item: MenuPicks.Item) {
        let pick = MenuPicks.Pick(chosen: item, for: activeDiner)
        let slot = Slot(diner: activeDiner, course: pick.courseKind)
        options[slot] = [pick] + (options[slot] ?? []).filter { $0.item != item.id }
        chosen[slot] = item.id
        showMenu = false
    }

    /// Lines Vision read that look like dish names, to show while the server reads it properly.
    static func dishLines(_ text: String) -> [String] {
        text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { line in
                line.count >= 4 && line.count <= 40 && line.rangeOfCharacter(from: .letters) != nil
                    && line.range(of: #"^[£$€]?\s*\d+([.,]\d+)?$"#, options: .regularExpression) == nil
            }
            .prefix(24)
            .map { $0 }
    }

    // MARK: Pieces

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: title)
            content()
        }
    }

    private func chip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 14)
                .frame(height: 36)
                .foregroundStyle(on ? Theme.brandForeground : Theme.brand)
                .background(on ? Theme.brand : Theme.highlight, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func field(_ prompt: String, _ value: Binding<String>) -> some View {
        TextField(prompt, text: value)
            .padding(12)
            .background(Theme.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private extension OutsideMeal.Course.Kind {
    /// Eating order.
    var order: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

/// Keeps the app running for the time iOS allows once it's left (about half a
/// minute), so a quick look at another app doesn't cut an answer off. Given
/// back as soon as `work` finishes, or when the time runs out.
@MainActor
private func withBackgroundTime<T>(_ name: String, _ work: () async throws -> T) async rethrows -> T {
    let time = BackgroundTime(name)
    defer { time.end() }
    return try await work()
}

@MainActor
private final class BackgroundTime {
    private var id = UIBackgroundTaskIdentifier.invalid

    init(_ name: String) {
        id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            // Out of time: give it back, or iOS ends the app.
            MainActor.assumeIsolated { self?.end() }
        }
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
