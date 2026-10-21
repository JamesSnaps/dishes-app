// The shopping list, as the web's /shopping: the add card (item, quantity,
// unit, category), checked items tucked behind "Show N checked", and the rest
// grouped by aisle in the web's category order, each group a bordered card of
// rows with a square checkbox, "6 Carrots", the recipe it came from, and edit
// and delete.
//
// Wide screens use the width: the categories flow into two columns, and the
// cart button on an item opens Sainsbury's in a side panel beside the list
// (SupermarketPanel) instead of on top of it.
//
// The screen used in a supermarket with no signal, so every change is an
// outbox mutation applied to the local copy first (`shopping_item.add /
// update / toggle / delete`, `shopping_list.clear_checked` — lib/services/sync.ts).

import DishesCore
import SwiftUI

struct ShoppingScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
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

    private var wide: Bool { pageWidth >= 900 }

    var body: some View {
        NavigationStack {
            HStack(spacing: 0) {
                list
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
            .sheet(item: $editing) { EditItemSheet(item: $0) }
            .sheet(item: $shopSheet) { destination in
                SupermarketPanel(url: destination.url) { shopSheet = nil }
            }
        }
        .task { await data.follow(app.store, ShoppingData.load) }
    }

    /// Opens Sainsbury's for an item: in the side panel when there's room.
    private func openShop(_ item: ShoppingItem) {
        guard let url = Supermarket.searchURL(for: item.name) else { return }
        if wide { withAnimation(.snappy) { shop = url } } else { shopSheet = WebDestination(url: url) }
    }

    /// Two columns of categories when the list has the width to itself.
    private var twoColumns: Bool { wide && shop == nil }

    private var list: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    let open = data.value.all.filter { !$0.isChecked }.count
                    let checked = data.value.checked.count
                    PageHeader(title: "Shopping List",
                               subtitle: "\(data.value.list?.name ?? "No list yet") · \(open + checked) items, \(checked) checked") {
                        if onTrip {
                            Button { toggleTrip() } label: { Label("End trip", systemImage: "lock.slash") }
                                .buttonStyle(.outline)
                        } else if open > 0 {
                            // Going shopping: what's left on the Lock Screen, kept current as the family adds things.
                            Button { toggleTrip() } label: { Label("Shopping trip", systemImage: "lock.iphone") }
                                .buttonStyle(.gradient(.orangeRose))
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
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            if let list = data.value.list {
                                // The web's "Add to pantry": ticked items into the pantry's stock.
                                Button("Add to pantry") {
                                    Task { await WebAction.run("pantry.addCheckedFromList", [.string(list.id)], done: "Ticked items added to the pantry.") }
                                }
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color(hex: 0x047857))
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

                    let groups = data.value.groups.map { ($0.name, $0.items) }
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
                .padding(.vertical, 20)
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
            Text(name.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
                .padding(.leading, 2)
            VStack(spacing: 0) {
                // Ticked items stay where they are; the aisles can be reordered.
                if #available(iOS 27, *), name != Self.checkedAisle {
                    ForEach(items) { divided($0, first: $0.id == items.first?.id) }
                        .reorderable(collectionID: name)
                } else {
                    ForEach(items) { divided($0, first: $0.id == items.first?.id) }
                }
            }
            .card()
        }
    }

    static let checkedAisle = "Checked"

    private func divided(_ item: ShoppingItem, first: Bool) -> some View {
        row(item).overlay(alignment: .top) {
            if !first { Rectangle().fill(Theme.border).frame(height: 1) }
        }
    }

    private func row(_ item: ShoppingItem) -> some View {
        HStack(spacing: 12) {
            Button { toggle(item) } label: {
                HStack(spacing: 14) {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(item.isChecked ? Theme.brand : Theme.mutedForeground.opacity(0.6), lineWidth: 1.5)
                        .background(item.isChecked ? Theme.brand : .clear, in: RoundedRectangle(cornerRadius: 4))
                        .overlay {
                            if item.isChecked {
                                Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            }
                        }
                        .frame(width: 20, height: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        let quantity = Format.quantity(item.amount, item.unit)
                        Text(quantity.isEmpty ? item.name : "\(quantity) \(item.name)")
                            .font(.system(size: 16))
                            .strikethrough(item.isChecked)
                            .foregroundStyle(item.isChecked ? Theme.mutedForeground : Theme.foreground)
                        if let title = item.recipeId.flatMap({ data.value.recipeTitles[$0] }) {
                            Text("from \(title)").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground.opacity(0.8))
                        } else if let notes = item.notes, !notes.isEmpty {
                            Text(notes).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button { openShop(item) } label: {
                Image(systemName: "cart").frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .foregroundStyle(shop == Supermarket.searchURL(for: item.name) ? Theme.brand : Theme.mutedForeground)
            .accessibilityLabel("Search for \(item.name) on Sainsbury’s")
            Button { editing = item } label: {
                Image(systemName: "pencil").frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.mutedForeground)
            .accessibilityLabel("Edit \(item.name)")
            Button { delete(item) } label: {
                Image(systemName: "trash").frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.mutedForeground)
            .accessibilityLabel("Delete \(item.name)")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: Changes

    private func toggle(_ item: ShoppingItem) {
        ticks += 1
        let checked = !item.isChecked
        Task { await app.setShoppingItem(item.id, checked: checked) }
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

    private func delete(_ item: ShoppingItem) {
        Task {
            await app.mutate("shopping_item.delete", payload: .object(["itemId": .string(item.id)]),
                             optimistic: [.remove(.shoppingItems, id: item.id)])
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


// MARK: Add

/// The add card: name and a + on the first row, quantity, unit and category on the second,
/// and while typing, suggestions from past lists and the household's recipes below them.
/// The Control Center control opens here with the item field focused.
struct AddItemCard: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @State private var name = ""
    @State private var amount = ""
    @State private var unit = ""
    @State private var category = ""
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
                field("Add item…", text: $name)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { add() }
                Button { add() } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(Theme.brand, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add item")
            }
            HStack(spacing: 10) {
                field("Qty", text: $amount).keyboardType(.decimalPad).frame(maxWidth: 90)
                field("Unit", text: $unit).textInputAutocapitalization(.never).frame(maxWidth: 110)
                Menu {
                    Picker("Category", selection: $category) {
                        Text("No category").tag("")
                        ForEach(shoppingCategories, id: \.self) { Text($0).tag($0) }
                    }
                } label: {
                    HStack {
                        Text(category.isEmpty ? "Category" : category)
                            .foregroundStyle(category.isEmpty ? Theme.mutedForeground : Theme.foreground)
                        Spacer()
                        Image(systemName: "chevron.down").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                    }
                    .font(.system(size: 15))
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
                }
            }
            // Below the controls rather than over them, so Qty and the category
            // stay reachable straight after typing.
            let shown = suggestions
            if !shown.isEmpty {
                VStack(spacing: 6) {
                    ForEach(shown, id: \.self) { suggestionRow($0) }
                }
                .padding(6)
                .callout(Theme.orange50, Theme.rose50, border: Theme.brand.opacity(0.25))
            }
        }
        .padding(14)
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
                    .foregroundStyle(history ? Theme.brandDeep : Theme.heart)
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
    /// suggestion bringing its old aisle when no category has been chosen.
    private func add(_ picked: String? = nil, remembered: String? = nil) {
        let trimmed = (picked ?? name).trimmingCharacters(in: .whitespacesAndNewlines)
        // Done on an empty field means "finished adding".
        guard !trimmed.isEmpty else { focused = false; return }
        var qty = amount.trimmingCharacters(in: .whitespaces)
        var u = unit.trimmingCharacters(in: .whitespaces)
        name = ""; amount = ""; unit = ""
        // Stay in the field: items usually come in a run.
        focused = true
        Task {
            var item = trimmed
            // "500g beef mince" typed into the name: the amount and unit go in their own
            // fields, as the recipe editor reads a line (rules, then the on-device model).
            if picked == nil, qty.isEmpty, u.isEmpty, let read = await IngredientLineReader.read(trimmed)?.value,
               !read.amount.isEmpty {
                (item, qty, u) = (read.ingredientName, read.amount, read.unit)
            }
            await app.addShoppingItem(item, amount: qty.isEmpty ? nil : qty, unit: u.isEmpty ? nil : u,
                                      category: category.isEmpty ? remembered : category)
        }
    }
}

// MARK: Edit

struct EditItemSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let item: ShoppingItem
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
