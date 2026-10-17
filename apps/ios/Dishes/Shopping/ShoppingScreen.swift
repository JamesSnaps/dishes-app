// The shopping list: the screen used in a supermarket with no signal, so
// every action is an outbox mutation applied to the local copy first
// (`shopping_item.add / toggle / delete`, `shopping_list.clear_checked` —
// lib/services/sync.ts). Grouped by aisle category as on the web, with ticked
// items gathered at the bottom.
//
// On iPad the list is capped to a readable width; it's mostly a phone screen,
// but it must work in Split View beside a recipe.

import DishesCore
import SwiftUI

struct ShoppingScreen: View {
    @Environment(AppModel.self) private var app
    @State private var data = Observed(ShoppingData())
    @State private var newItem = ""
    @State private var ticks = 0
    @FocusState private var adding: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    addRow
                }
                ForEach(data.value.groups, id: \.name) { group in
                    Section(group.name) {
                        ForEach(group.items) { row($0) }
                    }
                }
                if !data.value.checked.isEmpty {
                    Section("In the basket") {
                        ForEach(data.value.checked) { row($0) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollDismissesKeyboard(.interactively)
            .scrollContentBackground(.hidden)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
            .background(Theme.background.ignoresSafeArea())
            .overlay {
                if data.loaded && data.value.groups.isEmpty && data.value.checked.isEmpty {
                    ContentUnavailableView("Nothing on the list", systemImage: "cart",
                                           description: Text("Add something above, or add a week's meals from the plan."))
                        .allowsHitTesting(false)
                }
            }
            .navigationTitle(data.value.list?.name ?? "Shopping")
            .toolbar {
                if !data.value.checked.isEmpty, let list = data.value.list {
                    Button("Clear ticked", systemImage: "checkmark.circle.badge.xmark") { clearChecked(list) }
                }
            }
            .refreshable { await app.syncNow() }
            .sensoryFeedback(.selection, trigger: ticks)
        }
        .task { await data.follow(app.store, ShoppingData.load) }
    }

    private var addRow: some View {
        HStack {
            Image(systemName: "plus.circle.fill")
                .font(.title2)
                .foregroundStyle(Theme.brand)
            TextField("Add an item", text: $newItem)
                .focused($adding)
                .submitLabel(.done)
                .onSubmit(add)
        }
    }

    private func row(_ item: ShoppingItem) -> some View {
        Button {
            toggle(item)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: item.isChecked ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(item.isChecked ? Color.green : Theme.brand)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .strikethrough(item.isChecked)
                        .foregroundStyle(item.isChecked ? .secondary : .primary)
                    if let notes = item.notes, !notes.isEmpty {
                        Text(notes).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                let quantity = Format.quantity(item.amount, item.unit)
                if !quantity.isEmpty {
                    Text(quantity)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions {
            Button("Delete", systemImage: "trash", role: .destructive) { delete(item) }
        }
    }

    // MARK: Changes

    private func add() {
        let name = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
        // Done on an empty field means "finished adding".
        guard !name.isEmpty else { adding = false; return }
        newItem = ""
        // Stay in the field: items usually come in a run.
        adding = true
        // The server keeps a client-made id (AddItemInput.id), so the row
        // written here is the row the server will have.
        let id = UUID().uuidString.lowercased()
        let list = data.value.list
        let position = (data.value.all.map(\.position).max() ?? 0) + 1
        let record = JSONValue.object([
            "id": .string(id), "listId": .string(list?.id ?? "pending"), "ingredientName": .string(name),
            "isChecked": .bool(false), "position": .number(Double(position)),
        ])
        Task {
            await app.mutate("shopping_item.add",
                             payload: .fields(["id": .string(id), "ingredientName": .string(name),
                                               "listId": list.map { .string($0.id) }]),
                             // With no list yet the server makes one, so the row's listId is a guess: temporary.
                             optimistic: [.put(.shoppingItems, record, temporary: list == nil)])
        }
    }

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

/// The active list and its items, grouped for display.
struct ShoppingData: Sendable {
    struct Group: Sendable { var name: String; var items: [ShoppingItem] }

    var list: ShoppingList?
    var all: [ShoppingItem] = []
    var groups: [Group] = []
    var checked: [ShoppingItem] = []

    @Sendable static func load(_ r: StoreReader) throws -> ShoppingData {
        let lists = try r.records(.shoppingLists).compactMap(ShoppingList.init)
        let list = lists.first { $0.status == "active" }
        let items = try r.records(.shoppingItems).compactMap(ShoppingItem.init)
            // Items on the active list, plus any added before a list existed.
            .filter { $0.listId == list?.id || $0.listId == "pending" }
            .sorted { ($0.position, $0.name) < ($1.position, $1.name) }

        var data = ShoppingData(list: list, all: items)
        let open = items.filter { !$0.isChecked }
        let byCategory = Dictionary(grouping: open) { $0.category?.isEmpty == false ? $0.category! : "Other" }
        data.groups = byCategory.keys
            .sorted { ($0 == "Other" ? 1 : 0, $0) < ($1 == "Other" ? 1 : 0, $1) }
            .map { Group(name: $0, items: byCategory[$0]!) }
        data.checked = items.filter(\.isChecked)
        return data
    }
}
