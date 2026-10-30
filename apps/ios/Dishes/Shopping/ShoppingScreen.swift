// The shopping list, as the web's /shopping: one add field, checked items
// tucked behind "Show N checked", and the rest grouped by aisle in the web's
// category order, each group a bordered card of rows with a checkbox,
// "6 Carrots", the recipe it came from, and the Sainsbury's trolley.
//
// Ticking settles: the box fills and the name is struck through, and only
// after a moment (time to tap again and change your mind) does the row fold
// away, with an Undo. Swipe a row right to tick it, left to delete it; tap
// its name to edit it. A deletion waits for its Undo to go before it's sent.
// Store changes animate here, so items moved by sync — or sorted into aisles
// — slide rather than jump.
//
// Wide screens use the width: the categories flow into two columns, and the
// cart button on an item opens Sainsbury's in a side panel beside the list
// (SupermarketPanel) instead of on top of it — or in the Sainsbury's app, if
// that's what Settings → Shopping says.
//
// The screen used in a supermarket with no signal, so every change is an
// outbox mutation applied to the local copy first (`shopping_item.add /
// update / toggle / delete`, `shopping_list.clear_checked` — lib/services/sync.ts).

import DishesCore
import SwiftUI
import UIKit

struct ShoppingScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.scenePhase) private var scenePhase
    @State private var data = Observed(ShoppingData())
    @State private var showChecked = false
    @State private var editing: ShoppingItem?
    @State private var ticks = 0
    /// The shopping trip is on the Lock Screen (ShoppingTripActivity).
    @State private var onTrip = false
    @State private var pageWidth: CGFloat = 0
    /// Sainsbury's, beside the list (wide) …
    @State private var shop: URL?
    /// … or over it (iPhone).
    @State private var shopSheet: WebDestination?
    /// Ticked a moment ago: shown ticked in its aisle until it settles, or is tapped again.
    @State private var settling: Set<String> = []
    @State private var settleTasks: [String: Task<Void, Never>] = [:]
    /// Swiped away: gone from the list now, deleted once its Undo has gone.
    @State private var pendingDeletes: Set<String> = []
    /// Deleted, and kept out of the list until the store catches up.
    @State private var removed: Set<String> = []
    @State private var undo: UndoNote?
    @State private var sorting = false

    private var wide: Bool { pageWidth >= 900 }

    var body: some View {
        NavigationStack {
            HStack(spacing: 0) {
                list
                    .overlay(alignment: .bottom) { undoBar }
                if wide, let shop {
                    Rectangle().fill(Theme.border).frame(width: 1)
                    SupermarketPanel(url: shop) { withAnimation { self.shop = nil } }
                        .frame(width: max(400, pageWidth * 0.46))
                        .transition(.move(edge: .trailing))
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .sensoryFeedback(.selection, trigger: ticks)
            .sheet(item: $editing) { item in EditItemSheet(item: item) { delete(item) } }
            .sheet(item: $shopSheet) { destination in
                SupermarketPanel(url: destination.url) { shopSheet = nil }
            }
        }
        .task { await data.follow(app.store, animation: .snappy, ShoppingData.load) }
        // Settled ticks have reached the store: they're the checked list's now.
        .onChange(of: data.value.checked.map(\.id)) { _, ids in settling.subtract(ids) }
        .onChange(of: scenePhase) { _, phase in if phase != .active { sendDeletes() } }
        .onDisappear { sendDeletes() }
    }

    /// Opens Sainsbury's for an item: in its app, or in the side panel when there's room.
    private func openShop(_ item: ShoppingItem) {
        guard let url = Supermarket.searchURL(for: item.name) else { return }
        if Supermarket.opening == .app { Supermarket.openOutside(url); return }
        if wide { withAnimation(.snappy) { shop = url } } else { shopSheet = WebDestination(url: url) }
    }

    /// Two columns of categories when the list has the width to itself.
    private var twoColumns: Bool { wide && shop == nil }

    private var list: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    let hidden = removed.union(pendingDeletes)
                    let open = data.value.all.filter { !$0.isChecked && !hidden.contains($0.id) }.count
                    let checked = data.value.checked.count
                    PageHeader(title: "Shopping List") {
                        if onTrip {
                            Button { toggleTrip() } label: { Label("End trip", systemImage: "lock.slash") }
                                .buttonStyle(.secondary)
                        } else if open > 0 {
                            // Going shopping: what's left on the Lock Screen, kept current as the family adds things.
                            Button { toggleTrip() } label: { Label("Shopping trip", systemImage: "lock.iphone") }
                                .buttonStyle(.wide(.primary))
                                .fixedSize()
                        }
                    }
                    AddItemCard()

                    if checked > 0 {
                        HStack {
                            Button { withAnimation { showChecked.toggle() } } label: {
                                Label(showChecked ? "Hide \(checked) checked" : "Show \(checked) checked",
                                      systemImage: showChecked ? "eye.slash" : "eye")
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.mutedForeground)
                                    .contentTransition(.numericText())
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            if let list = data.value.list {
                                // The web's "Add to pantry": ticked items into the pantry's stock.
                                Button("Add to pantry") {
                                    Task { await WebAction.run("pantry.addCheckedFromList", [.string(list.id)], done: "Ticked items added to the pantry.") }
                                }
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Theme.success)
                                Button("Clear checked") { clearChecked(list) }
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(Theme.destructive)
                            }
                        }
                        .padding(.horizontal, 4)
                    }

                    if data.loaded && open == 0 && (checked == 0 || !showChecked) {
                        EmptyBox(emoji: "🛒", message: checked > 0 ? "Everything’s in the basket" : "Nothing on the list")
                    }

                    let groups = data.value.groups
                        .map { ($0.name, $0.items.filter { !hidden.contains($0.id) }) }
                        .filter { !$0.1.isEmpty }
                        + (showChecked && checked > 0 ? [(Self.checkedAisle, data.value.checked)] : [])
                    Group {
                        if twoColumns {
                            let (left, right) = balanced(groups)
                            HStack(alignment: .top, spacing: 20) {
                                VStack(spacing: 16) { ForEach(left, id: \.0) { groupCard($0.0, $0.1) } }
                                VStack(spacing: 16) { ForEach(right, id: \.0) { groupCard($0.0, $0.1) } }
                            }
                        } else {
                            ForEach(groups, id: \.0) { groupCard($0.0, $0.1) }
                        }
                    }
                    // iOS 27: drag an item within its aisle, or onto another to change its category (D6).
                    .modifier(ReorderAisles { sources, aisle, before in reorder(sources, to: aisle, before: before) })
                }
                .padding(.horizontal, width == .regular ? 32 : 16)
                .padding(.top, 20)
                .padding(.bottom, undo == nil ? 20 : 90)
                .frame(maxWidth: twoColumns ? 1300 : 760)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await app.syncNow() }
            .onAppear { onTrip = ShoppingTripActivity.shared.isShowing }
            // It ends itself when the last item's ticked.
            .onChange(of: data.value.groups.reduce(0) { $0 + $1.items.count }) { onTrip = ShoppingTripActivity.shared.isShowing }
    }

    private func toggleTrip() {
        if onTrip {
            ShoppingTripActivity.shared.end()
            onTrip = false
            return
        }
        Task {
            if let problem = await ShoppingTripActivity.shared.start() {
                app.toast = problem
            } else {
                onTrip = true
                app.toast = "On the Lock Screen until everything’s ticked."
            }
        }
    }

    /// Splits the categories into two columns of about equal length, keeping order.
    private func balanced(_ groups: [(String, [ShoppingItem])]) -> ([(String, [ShoppingItem])], [(String, [ShoppingItem])]) {
        let total = groups.reduce(0) { $0 + $1.1.count + 1 }
        var left: [(String, [ShoppingItem])] = [], running = 0
        for group in groups where running < total / 2 {
            left.append(group)
            running += group.1.count + 1
        }
        return (left, Array(groups.dropFirst(left.count)))
    }

    private func groupCard(_ name: String, _ items: [ShoppingItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(name.uppercased())
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(.leading, 2)
                Spacer()
                if name == ShoppingData.uncategorised {
                    sortButton(items)
                }
            }
            VStack(spacing: 0) {
                // Ticked items stay where they are; the aisles can be reordered.
                if #available(iOS 27, *), name != Self.checkedAisle {
                    ForEach(items) { divided($0, first: $0.id == items.first?.id) }
                        .reorderable(collectionID: name)
                } else {
                    ForEach(items) { divided($0, first: $0.id == items.first?.id) }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .card()
        }
        .transition(.opacity)
    }

    static let checkedAisle = "Checked"

    private func divided(_ item: ShoppingItem, first: Bool) -> some View {
        ShoppingRow(item: item,
                    from: item.recipeId.flatMap { data.value.recipeTitles[$0] },
                    ticked: item.isChecked || settling.contains(item.id),
                    swipes: !item.isChecked,
                    shopping: shop == Supermarket.searchURL(for: item.name),
                    tick: { toggle(item) },
                    delete: { delete(item) },
                    edit: { editing = item },
                    shop: { openShop(item) })
            .overlay(alignment: .top) {
                if !first { Rectangle().fill(Theme.border).frame(height: 1) }
            }
            .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.97, anchor: .top)),
                                    removal: .opacity))
    }

    /// The Uncategorised aisle's way out: every item in it filed at once (ShoppingAisles).
    private func sortButton(_ items: [ShoppingItem]) -> some View {
        Button { sortIntoAisles(items) } label: {
            HStack(spacing: 5) {
                if sorting { ProgressView().controlSize(.mini).tint(Theme.inkForeground) } else { Image(systemName: "sparkles") }
                Text(sorting ? "Sorting…" : "Sort into aisles")
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.inkForeground)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Theme.ink, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(sorting)
    }

    /// The Undo bar: the last tick or deletion, for a few seconds.
    @ViewBuilder private var undoBar: some View {
        if let note = undo {
            HStack(spacing: 10) {
                Text(note.text)
                    .font(.system(size: 15))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button("Undo") {
                    withAnimation(.snappy) { undo = nil }
                    note.undo()
                }
                .font(.system(size: 15, weight: .semibold))
                .padding(.horizontal, 16)
                .frame(height: 40)
                .background(Theme.inkForeground.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .buttonStyle(.plain)
            }
            .foregroundStyle(Theme.inkForeground)
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(Theme.ink, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: .black.opacity(0.2), radius: 12, y: 6)
            .frame(maxWidth: 520)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(note.id)
            .task(id: note.id) {
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled, undo?.id == note.id else { return }
                sendDeletes()
                withAnimation(.snappy) { undo = nil }
            }
        }
    }

    private func showUndo(_ text: String, undo action: @escaping () -> Void) {
        // Only the latest can be undone: anything waiting on the last one goes now.
        sendDeletes()
        withAnimation(.snappy) { undo = UndoNote(text: text, undo: action) }
    }

    // MARK: Changes

    /// A tap on the box (or a swipe right). An open item settles first; a
    /// second tap while it's settling changes your mind.
    private func toggle(_ item: ShoppingItem) {
        ticks += 1
        if item.isChecked {
            Task { await app.setShoppingItem(item.id, checked: false) }
            return
        }
        if settling.contains(item.id) {
            settleTasks.removeValue(forKey: item.id)?.cancel()
            withAnimation(.snappy) { _ = settling.remove(item.id) }
            return
        }
        withAnimation(.snappy) { _ = settling.insert(item.id) }
        settleTasks[item.id] = Task {
            try? await Task.sleep(for: .milliseconds(650))
            guard !Task.isCancelled else { return }
            settleTasks[item.id] = nil
            await app.setShoppingItem(item.id, checked: true)
            showUndo("\(item.name) ticked") {
                Task { await app.setShoppingItem(item.id, checked: false) }
            }
        }
    }

    /// Gone from the list at once; sent when its Undo goes (or the screen does).
    private func delete(_ item: ShoppingItem) {
        settleTasks.removeValue(forKey: item.id)?.cancel()
        settling.remove(item.id)
        showUndo("\(item.name) removed") {
            withAnimation(.snappy) { _ = pendingDeletes.remove(item.id) }
        }
        withAnimation(.snappy) { _ = pendingDeletes.insert(item.id) }
    }

    private func sendDeletes() {
        guard !pendingDeletes.isEmpty else { return }
        let ids = pendingDeletes
        removed.formUnion(ids)
        pendingDeletes = []
        Task {
            for id in ids {
                await app.mutate("shopping_item.delete", payload: .object(["itemId": .string(id)]),
                                 optimistic: [.remove(.shoppingItems, id: id)])
            }
        }
    }

    /// Files each item: where the household had it before, else the rules, else the
    /// on-device model. Anything none of them knows stays where it is.
    private func sortIntoAisles(_ items: [ShoppingItem]) {
        sorting = true
        Task {
            let history = (try? await app.store.read(ShoppingSuggestionIndex.load)) ?? ShoppingSuggestionIndex()
            var left = 0
            for item in items {
                let found: String?
                if let known = history.category(for: item.name) {
                    found = known
                } else {
                    found = await ShoppingAisles.file(item.name)?.value ?? nil
                }
                guard let aisle = found else { left += 1; continue }
                await setCategory(item.id, aisle)
            }
            sorting = false
            if left > 0 {
                app.toast = left == 1 ? "One item needs its aisle choosing — tap its name."
                    : "\(left) items need their aisle choosing — tap a name."
            }
        }
    }

    private func setCategory(_ id: String, _ category: String) async {
        guard let current = try? await app.store.read({ try $0.record(.shoppingItems, id: id) }) else { return }
        let fields: [String: JSONValue] = ["category": .string(category)]
        await app.mutate("shopping_item.update", payload: .object(fields.merging(["itemId": .string(id)]) { a, _ in a }),
                         optimistic: [.put(.shoppingItems, current.merging(.object(fields)))])
    }

    /// A drop: each item whose place or aisle changed, updated offline-first
    /// (ShoppingReorder works out which).
    private func reorder(_ sources: [String], to aisle: String, before: String?) {
        guard aisle != Self.checkedAisle else { return }
        let aisles = data.value.groups.map { (name: $0.name, items: $0.items) }
        let byId = Dictionary(data.value.all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let changes = ShoppingReorder.changes(aisles, moving: sources, to: aisle, before: before)
        Task {
            for change in changes {
                guard let current = try? await app.store.read({ try $0.record(.shoppingItems, id: change.itemId) }),
                      byId[change.itemId] != nil else { continue }
                var fields: [String: JSONValue] = ["position": .number(Double(change.position))]
                if let category = change.category { fields["category"] = category.map(JSONValue.string) ?? .null }
                await app.mutate("shopping_item.update", payload: .object(fields.merging(["itemId": .string(change.itemId)]) { a, _ in a }),
                                 optimistic: [.put(.shoppingItems, current.merging(.object(fields)))])
            }
        }
    }

    private func clearChecked(_ list: ShoppingList) {
        let removals = data.value.checked.map { OptimisticChange.remove(.shoppingItems, id: $0.id) }
        Task {
            await app.mutate("shopping_list.clear_checked", payload: .object(["listId": .string(list.id)]),
                             optimistic: removals)
        }
    }
}

/// What the Undo bar would put back.
private struct UndoNote: Identifiable {
    let id = UUID()
    var text: String
    var undo: () -> Void
}

// MARK: Row

/// One item: the box, the name (tap to edit), the trolley. Swipe right to
/// tick, left to delete; past the line, the colour underneath fills and it
/// taps your finger.
private struct ShoppingRow: View {
    let item: ShoppingItem
    let from: String?
    let ticked: Bool
    let swipes: Bool
    let shopping: Bool
    var tick: () -> Void
    var delete: () -> Void
    var edit: () -> Void
    var shop: () -> Void

    @State private var offset: CGFloat = 0
    @State private var rowWidth: CGFloat = 400
    private static let arm: CGFloat = 80
    private var armed: Bool { abs(offset) >= Self.arm }

    var body: some View {
        ZStack {
            if offset != 0 { underneath }
            face
                .background(Theme.card)
                .offset(x: offset)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rowWidth = $0 }
        .gesture(HorizontalPan(enabled: swipes, changed: drag, ended: release))
        .sensoryFeedback(.impact(weight: .medium), trigger: armed) { _, now in now }
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Delete", delete)
        .accessibilityAction(named: "Search Sainsbury’s", shop)
    }

    private var face: some View {
        HStack(spacing: 2) {
            Button(action: tick) {
                Image(systemName: ticked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22))
                    .foregroundStyle(ticked ? Theme.brand : Theme.mutedForeground.opacity(0.6))
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: ticked)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ticked ? "Untick \(item.name)" : "Tick \(item.name)")

            Button(action: edit) {
                VStack(alignment: .leading, spacing: 2) {
                    let quantity = Format.quantity(item.amount, item.unit)
                    Text(quantity.isEmpty ? item.name : "\(quantity) \(item.name)")
                        .font(.system(size: 16))
                        .foregroundStyle(ticked ? Theme.mutedForeground : Theme.foreground)
                        .lineLimit(2)
                        // A line drawn across, left to right, rather than strikethrough's blink.
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .frame(height: 1.5)
                                .scaleEffect(x: ticked ? 1 : 0, anchor: .leading)
                                .animation(.easeOut(duration: 0.26), value: ticked)
                        }
                    if let from {
                        Text("from \(from)").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground.opacity(0.8))
                    } else if let notes = item.notes, !notes.isEmpty {
                        Text(notes).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Edit")

            Button(action: shop) {
                Image(systemName: "cart").frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .foregroundStyle(shopping ? Theme.brand : Theme.mutedForeground)
            .accessibilityLabel("Search for \(item.name) on Sainsbury’s")
        }
        .padding(.leading, 4)
        .padding(.trailing, 8)
        .padding(.vertical, 4)
    }

    /// Green "Got it" to the left, red "Delete" to the right.
    private var underneath: some View {
        let right = offset > 0
        return HStack(spacing: 8) {
            if right {
                Image(systemName: "checkmark").font(.system(size: 17, weight: .bold))
                    .scaleEffect(armed ? 1.25 : 1)
                Text("Got it")
                Spacer()
            } else {
                Spacer()
                Text("Delete")
                Image(systemName: "trash").font(.system(size: 17, weight: .semibold))
                    .scaleEffect(armed ? 1.25 : 1)
            }
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(right ? Theme.success : Theme.destructive)
        .opacity(armed ? 1 : 0.75)
        .animation(.snappy(duration: 0.18), value: armed)
        .accessibilityHidden(true)
    }

    private func drag(_ x: CGFloat) {
        // Free to the line, then a little resistance.
        let limit: CGFloat = 130
        let d = abs(x)
        offset = (d <= limit ? d : limit + (d - limit) * 0.3) * (x < 0 ? -1 : 1)
    }

    private func release(_ x: CGFloat, _ velocity: CGFloat) {
        // A quick flick counts, even short of the line.
        let flung = abs(velocity) > 900 && abs(x) > 30 && (velocity > 0) == (x > 0)
        if x >= Self.arm || (flung && x > 0) {
            withAnimation(.snappy) { offset = 0 }
            if !ticked { tick() }
        } else if x <= -Self.arm || (flung && x < 0) {
            withAnimation(.easeIn(duration: 0.18)) { offset = -rowWidth }
            Task {
                try? await Task.sleep(for: .milliseconds(180))
                delete()
            }
        } else {
            withAnimation(.snappy) { offset = 0 }
        }
    }
}

/// A sideways drag that leaves up-and-down to the scroll view: it only begins
/// when the finger sets off more across than down. (A SwiftUI DragGesture on
/// a row in a ScrollView fights the scroll.)
private struct HorizontalPan: UIGestureRecognizerRepresentable {
    var enabled: Bool
    var changed: (CGFloat) -> Void
    var ended: (CGFloat, CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        pan.isEnabled = enabled
        return pan
    }

    func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) {
        pan.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        let x = pan.translation(in: nil).x
        switch pan.state {
        case .began, .changed: changed(x)
        case .ended: ended(x, pan.velocity(in: nil).x)
        case .cancelled, .failed: ended(0, 0)
        default: break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return true }
            let v = pan.velocity(in: nil)
            return abs(v.x) > abs(v.y) * 1.2
        }
    }
}

// MARK: Add

/// The add card: one field and a +. Type it as you'd say it — "500g beef
/// mince" — and the amount and unit come out of the name (IngredientLineReader),
/// and it goes in its aisle (ShoppingAisles: where the household had it last,
/// the rules, then the on-device model). While typing, suggestions from past
/// lists and the household's recipes show below. The Control Center control
/// opens here with the field focused.
struct AddItemCard: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @State private var name = ""
    @FocusState private var focused: Bool
    /// Past items and recipe ingredients, read from the local store only once the
    /// field has been focused — a visit that adds nothing doesn't pay for it.
    @State private var index = Observed(ShoppingSuggestionIndex())
    @State private var suggesting = false

    private var suggestions: [ShoppingSuggestion] {
        focused ? index.value.suggestions(for: name) : []
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                field("Add an item, like “500g mince”", text: $name)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { add() }
                Button { add() } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.brandForeground)
                        .frame(width: 44, height: 44)
                        .background(Theme.brand, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add item")
            }
            let shown = suggestions
            if !shown.isEmpty {
                VStack(spacing: 6) {
                    ForEach(shown, id: \.self) { suggestionRow($0) }
                }
                .padding(6)
                .panel()
            }
        }
        .padding(10)
        .card()
        .onChange(of: focused) { _, now in if now { suggesting = true } }
        .task(id: suggesting) {
            guard suggesting else { return }
            await index.follow(app.store, ShoppingSuggestionIndex.load)
        }
        .onChange(of: nav.focusShoppingAdd, initial: true) { _, wanted in
            guard wanted else { return }
            nav.focusShoppingAdd = false
            // Straight after a tab switch the field isn't ready to take focus.
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                focused = true
            }
        }
    }

    private func field(_ prompt: String, text: Binding<String>) -> some View {
        TextField(prompt, text: text)
            .font(.system(size: 15))
            .padding(.horizontal, 12)
            .frame(height: 44)
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
    }

    private func suggestionRow(_ s: ShoppingSuggestion) -> some View {
        let history = s.source == .history
        let detail = history
            ? [s.category, s.count > 1 ? "×\(s.count)" : nil].compactMap { $0 }.joined(separator: " · ")
            : s.count > 1 ? "\(s.count) recipes" : "in a recipe"
        return Button { add(s.name, remembered: s.category) } label: {
            HStack(spacing: 10) {
                Image(systemName: history ? "clock.arrow.circlepath" : "fork.knife")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(history ? Theme.brand : Theme.heart)
                    .frame(width: 28, height: 28)
                    .background((history ? Theme.brand : Theme.heart).opacity(0.14), in: Circle())
                Text(highlighted(s.name))
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Theme.brand)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add \(s.name)")
        .accessibilityHint(detail)
    }

    /// The name with what's been typed in bold.
    private func highlighted(_ text: String) -> AttributedString {
        var out = AttributedString(text)
        let query = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !query.isEmpty, let range = out.range(of: query, options: .caseInsensitive) {
            out[range].font = .system(size: 15, weight: .semibold)
        }
        return out
    }

    /// Typed (`picked` nil) or a suggestion: the same add either way, with the
    /// suggestion bringing its old aisle.
    private func add(_ picked: String? = nil, remembered: String? = nil) {
        let trimmed = (picked ?? name).trimmingCharacters(in: .whitespacesAndNewlines)
        // Done on an empty field means "finished adding".
        guard !trimmed.isEmpty else { focused = false; return }
        name = ""
        // Stay in the field: items usually come in a run.
        focused = true
        let history = index.value
        Task {
            var item = trimmed, qty = "", unit = ""
            // "500g beef mince": the amount and unit go in their own fields, as the
            // recipe editor reads a line (rules, then the on-device model).
            if picked == nil, let read = await IngredientLineReader.read(trimmed)?.value, !read.amount.isEmpty {
                (item, qty, unit) = (read.ingredientName, read.amount, read.unit)
            }
            var aisle = remembered ?? history.category(for: item)
            if aisle == nil { aisle = await ShoppingAisles.file(item)?.value ?? nil }
            await app.addShoppingItem(item, amount: qty.isEmpty ? nil : qty, unit: unit.isEmpty ? nil : unit,
                                      category: aisle)
        }
    }
}

// MARK: Edit

struct EditItemSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let item: ShoppingItem
    /// The list's delete, so it gets the list's Undo.
    var delete: () -> Void
    @State private var name = ""
    @State private var amount = ""
    @State private var unit = ""
    @State private var notes = ""
    @State private var category = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Item", text: $name)
                HStack {
                    TextField("Quantity", text: $amount).keyboardType(.decimalPad)
                    TextField("Unit", text: $unit).textInputAutocapitalization(.never)
                }
                Picker("Category", selection: $category) {
                    Text("No category").tag("")
                    ForEach(shoppingCategories, id: \.self) { Text($0).tag($0) }
                    if !category.isEmpty && !shoppingCategories.contains(category) { Text(category).tag(category) }
                }
                TextField("Notes", text: $notes, axis: .vertical)
                Section {
                    Button("Delete item", role: .destructive) {
                        dismiss()
                        delete()
                    }
                }
            }
            .navigationTitle("Edit item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            name = item.name; amount = Format.amount(item.amount) ?? ""; unit = item.unit ?? ""
            notes = item.notes ?? ""; category = item.category ?? ""
        }
    }

    private func save() {
        let value = { (s: String) -> JSONValue in s.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(s) }
        let fields: [String: JSONValue] = [
            "ingredientName": .string(name.trimmingCharacters(in: .whitespaces)),
            "amount": value(amount), "unit": value(unit), "notes": value(notes), "category": value(category),
        ]
        Task {
            let current = try? await app.store.read { try $0.record(.shoppingItems, id: item.id) }
            await app.mutate("shopping_item.update",
                             payload: JSONValue.object(["itemId": .string(item.id)]).merging(.object(fields)),
                             optimistic: current.map { [.put(.shoppingItems, $0.merging(.object(fields)))] } ?? [])
            dismiss()
        }
    }
}

/// The iOS 27 reorder container around the aisles: hands a drop to `move` as
/// (the dragged items, the aisle, the item they went in front of — nil at the end).
private struct ReorderAisles: ViewModifier {
    let move: ([String], String, String?) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 27, *) {
            content.reorderContainer(for: ShoppingItem.self, in: String.self) { difference in
                let before: String? = switch difference.destination.position {
                case .before(let id): id
                case .end: nil
                }
                move(difference.sources, difference.destination.collectionID, before)
            }
        } else {
            content
        }
    }
}
