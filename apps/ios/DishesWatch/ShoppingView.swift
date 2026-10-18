// The shopping list on the wrist: grouped by aisle as on the phone, tap to tick,
// and Add (dictation, Scribble or the keyboard). An item ticked here stays where
// it was until you leave the list, so rows don't jump under your finger; the
// rest of the ticked items wait at the bottom, in the basket.

import SwiftUI

struct ShoppingView: View {
    @Environment(WatchModel.self) private var model
    /// Ticked while this list has been open: kept in place.
    @State private var tickedHere: Set<String> = []

    var body: some View {
        let items = model.items
        let open = items.filter { !$0.checked || tickedHere.contains($0.id) }
        let basket = items.filter { $0.checked && !tickedHere.contains($0.id) }
        List {
            TextFieldLink(prompt: Text("Milk, 2 lemons…")) {
                Label("Add item", systemImage: "plus")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
            } onSubmit: { text in
                model.add(text)
            }
            .listRowBackground(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(WatchTheme.brandGradient))

            if open.isEmpty {
                Text(basket.isEmpty ? "Nothing on the list" : "Everything’s in the basket 🎉")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }

            ForEach(groups(open), id: \.name) { group in
                Section(group.name) {
                    ForEach(group.items) { item in row(item) }
                }
            }

            if !basket.isEmpty {
                Section("In the basket") {
                    ForEach(basket) { item in row(item) }
                }
            }
            StatusFooter()
        }
        .navigationTitle(model.snapshot.listName ?? "Shopping")
        .onAppear { model.refresh() }
    }

    private func row(_ item: WatchItem) -> some View {
        Button {
            if !item.checked { tickedHere.insert(item.id) }
            model.toggle(item)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(item.checked ? WatchTheme.emerald : .secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.name)
                        .strikethrough(item.checked)
                        .foregroundStyle(item.checked ? .secondary : .primary)
                    if !item.quantity.isEmpty {
                        Text(item.quantity).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .listRowBackground(WatchTheme.platter(item.checked ? .gray : WatchTheme.emerald))
        .accessibilityLabel(item.quantity.isEmpty ? item.name : "\(item.quantity) \(item.name)")
        .accessibilityValue(item.checked ? "Ticked" : "")
    }

    /// Groups in the order the phone sent them (its aisle order), items in order within each.
    private func groups(_ items: [WatchItem]) -> [(name: String, items: [WatchItem])] {
        var order: [String] = []
        var byName: [String: [WatchItem]] = [:]
        for item in items {
            if byName[item.category] == nil { order.append(item.category) }
            byName[item.category, default: []].append(item)
        }
        return order.map { ($0, byName[$0]!) }
    }
}
