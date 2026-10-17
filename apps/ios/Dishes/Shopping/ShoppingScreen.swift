// The shopping list, as the web's /shopping: the add card (item, quantity,
// unit, category), checked items tucked behind "Show N checked", and the rest
// grouped by aisle in the web's category order, each group a bordered card of
// rows with a square checkbox, "6 Carrots", the recipe it came from, and edit
// and delete.
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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    let open = data.value.all.filter { !$0.isChecked }.count
                    let checked = data.value.checked.count
                    PageHeader(title: "Shopping List",
                               subtitle: "\(data.value.list?.name ?? "No list yet") · \(open + checked) items, \(checked) checked")
                    AddItemCard(list: data.value.list, nextPosition: (data.value.all.map(\.position).max() ?? 0) + 1)

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

                    ForEach(data.value.groups, id: \.name) { group in
                        groupCard(group.name, group.items)
                    }
                    if showChecked && checked > 0 {
                        groupCard("Checked", data.value.checked)
                    }
                }
                .padding(.horizontal, width == .regular ? 28 : 16)
                .padding(.vertical, 20)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .refreshable { await app.syncNow() }
            .toolbar(.hidden, for: .navigationBar)
            .sensoryFeedback(.selection, trigger: ticks)
            .sheet(item: $editing) { EditItemSheet(item: $0) }
        }
        .task { await data.follow(app.store, ShoppingData.load) }
    }

    private func groupCard(_ name: String, _ items: [ShoppingItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(name.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
                .padding(.leading, 2)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                    row(item)
                }
            }
            .card()
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
        Task {
            let current = try? await app.store.read { try $0.record(.shoppingItems, id: item.id) }
            await app.mutate("shopping_item.toggle",
                             payload: .object(["itemId": .string(item.id), "checked": .bool(checked)]),
                             optimistic: current.map { [.put(.shoppingItems, $0.merging(.object(["isChecked": .bool(checked)])))] } ?? [])
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

/// The web's CATEGORY_ORDER (shopping-list-client.tsx); anything else after, then uncategorised.
let shoppingCategories = ["Produce", "Dairy", "Meat", "Fish", "Bakery", "Pantry", "Frozen", "Drinks", "Cleaning", "Other"]

// MARK: Add

/// The add card: name and a + on the first row, quantity, unit and category on the second.
struct AddItemCard: View {
    @Environment(AppModel.self) private var app
    let list: ShoppingList?
    let nextPosition: Int
    @State private var name = ""
    @State private var amount = ""
    @State private var unit = ""
    @State private var category = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                field("Add item…", text: $name)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(add)
                Button(action: add) {
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
        }
        .padding(14)
        .card()
    }

    private func field(_ prompt: String, text: Binding<String>) -> some View {
        TextField(prompt, text: text)
            .font(.system(size: 15))
            .padding(.horizontal, 12)
            .frame(height: 44)
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
    }

    private func add() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        // Done on an empty field means "finished adding".
        guard !trimmed.isEmpty else { focused = false; return }
        let qty = amount.trimmingCharacters(in: .whitespaces)
        let u = unit.trimmingCharacters(in: .whitespaces)
        name = ""; amount = ""; unit = ""
        // Stay in the field: items usually come in a run.
        focused = true
        // The server keeps a client-made id (AddItemInput.id), so the row
        // written here is the row the server will have.
        let id = UUID().uuidString.lowercased()
        let record = JSONValue.fields([
            "id": .string(id), "listId": .string(list?.id ?? "pending"), "ingredientName": .string(trimmed),
            "isChecked": .bool(false), "position": .number(Double(nextPosition)),
            "amount": qty.isEmpty ? nil : .string(qty), "unit": u.isEmpty ? nil : .string(u),
            "category": category.isEmpty ? nil : .string(category),
        ])
        Task {
            await app.mutate("shopping_item.add",
                             payload: .fields(["id": .string(id), "ingredientName": .string(trimmed),
                                               "listId": list.map { .string($0.id) },
                                               "amount": qty.isEmpty ? nil : .string(qty),
                                               "unit": u.isEmpty ? nil : .string(u),
                                               "category": category.isEmpty ? nil : .string(category)]),
                             // With no list yet the server makes one, so the row's listId is a guess: temporary.
                             optimistic: [.put(.shoppingItems, record, temporary: list == nil)])
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

// MARK: Data

/// The active list and its items, grouped for display.
struct ShoppingData: Sendable {
    struct Group: Sendable { var name: String; var items: [ShoppingItem] }

    var list: ShoppingList?
    var all: [ShoppingItem] = []
    var groups: [Group] = []
    var checked: [ShoppingItem] = []
    var recipeTitles: [String: String] = [:]

    @Sendable static func load(_ r: StoreReader) throws -> ShoppingData {
        let lists = try r.records(.shoppingLists).compactMap(ShoppingList.init)
        let list = lists.first { $0.status == "active" }
        let items = try r.records(.shoppingItems).compactMap(ShoppingItem.init)
            // Items on the active list, plus any added before a list existed.
            .filter { $0.listId == list?.id || $0.listId == "pending" }
            .sorted { ($0.position, $0.name) < ($1.position, $1.name) }

        var data = ShoppingData(list: list, all: items)
        let open = items.filter { !$0.isChecked }
        let byCategory = Dictionary(grouping: open) { $0.category?.isEmpty == false ? $0.category! : "" }
        func rank(_ name: String) -> (Int, String) {
            if name.isEmpty { return (2, "") }
            if let i = shoppingCategories.firstIndex(of: name) { return (0, String(format: "%02d", i)) }
            return (1, name)
        }
        data.groups = byCategory.keys.sorted { rank($0) < rank($1) }
            .map { Group(name: $0.isEmpty ? "Uncategorised" : $0, items: byCategory[$0]!) }
        data.checked = items.filter(\.isChecked)
        let ids = Set(items.compactMap(\.recipeId))
        if !ids.isEmpty {
            data.recipeTitles = Dictionary(try r.records(.recipes).compactMap(Recipe.init)
                .filter { ids.contains($0.id) }.map { ($0.id, $0.title) }, uniquingKeysWith: { a, _ in a })
        }
        return data
    }
}
