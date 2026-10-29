// The pantry, as the web's /pantry: staples (always in the cupboard, never
// added to the shopping list) and stock (what's in now, with amounts). Adding
// a recipe to the list skips what the pantry covers; "Mark ingredients as
// used" after a cook takes from the stock; ticked shopping items can be added.

import DishesCore
import SwiftUI

struct PantryList: Decodable, Sendable {
    struct Staple: Decodable, Sendable, Identifiable { var id: String; var ingredientName: String }
    struct Stock: Decodable, Sendable, Identifiable, Hashable {
        var id: String
        var ingredientName: String
        var amount: String?
        var unit: String?
        var addedAt: String
    }
    var staples: [Staple]
    var stock: [Stock]
}

struct PantryScreen: View {
    @State private var data = Remote<PantryList>("pantry.list")
    @State private var addingStaple = false
    @State private var addingStock = false
    @State private var editing: PantryList.Stock?
    @State private var search = ""

    var body: some View {
        WebPage(title: "Pantry", subtitle: "Staples are skipped when adding to the shopping list; stock is what’s in now.", data: data) { list in
            SearchField(prompt: "Search the pantry…", text: $search)
            let stock = list.stock.filter { matches($0.ingredientName) }
            WebSection(title: "In stock · \(list.stock.count)", action: ("Add", "plus", { addingStock = true })) {
                if stock.isEmpty {
                    EmptyBox(emoji: "🥫", message: search.isEmpty ? "Nothing in stock yet" : "Nothing matches")
                } else {
                    CardList(items: stock) { item in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.ingredientName.capitalizedFirst).font(.system(size: 15, weight: .medium))
                                if let added = item.addedAt.isoDate {
                                    Text("Added \(added.formatted(.relative(presentation: .named)))")
                                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                                }
                            }
                            Spacer()
                            let qty = Format.quantity(item.amount, item.unit)
                            if !qty.isEmpty {
                                Text(qty).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.brand)
                                    .padding(.horizontal, 10).padding(.vertical, 4)
                                    .background(Theme.highlight, in: Capsule())
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .contentShape(Rectangle())
                        .onTapGesture { editing = item }
                        .contextMenu {
                            Button("Edit", systemImage: "pencil") { editing = item }
                            Button("Used up", systemImage: "trash", role: .destructive) {
                                Task { if await WebAction.run("pantry.removeStock", [.array([.string(item.id)])]) { await data.load() } }
                            }
                        }
                    }
                }
            }
            let staples = list.staples.filter { matches($0.ingredientName) }
            WebSection(title: "Staples · \(list.staples.count)", action: ("Add", "plus", { addingStaple = true })) {
                if staples.isEmpty {
                    EmptyBox(emoji: "🧂", message: "Salt, oil, flour… things you always have")
                } else {
                    FlowLayout(spacing: 8) {
                        ForEach(staples) { staple in
                            HStack(spacing: 6) {
                                Text(staple.ingredientName).font(.system(size: 14, weight: .medium))
                                Button {
                                    Task { if await WebAction.run("pantry.removeStaples", [.array([.string(staple.id)])]) { await data.load() } }
                                } label: {
                                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                                }
                                .accessibilityLabel("Remove \(staple.ingredientName)")
                            }
                            .padding(.horizontal, 12).frame(height: 32)
                            .foregroundStyle(Theme.success)
                            .background(Theme.successTint, in: Capsule())
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $addingStaple) {
            TextPromptSheet(title: "Add a staple", placeholder: "e.g. Olive oil", text: "") { name in
                let ok = await WebAction.run("pantry.addStaple", [.string(name)])
                if ok { await data.load() }
                return ok
            }
        }
        .sheet(isPresented: $addingStock) {
            StockSheet(item: nil) { await data.load() }
        }
        .sheet(item: $editing) { item in
            StockSheet(item: item) { await data.load() }
        }
    }

    private func matches(_ name: String) -> Bool {
        search.isEmpty || name.localizedCaseInsensitiveContains(search)
    }
}

/// Add or edit one stock item: what, how much, in what unit.
private struct StockSheet: View {
    @Environment(\.dismiss) private var dismiss
    let item: PantryList.Stock?
    var saved: () async -> Void
    @State private var name = ""
    @State private var amount = ""
    @State private var unit = ""
    @State private var confirmRemove = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Ingredient", text: $name)
                HStack {
                    TextField("Amount", text: $amount).keyboardType(.decimalPad)
                    TextField("Unit (g, ml, tins…)", text: $unit)
                }
                if item != nil {
                    Button("Used up — remove", role: .destructive) { confirmRemove = true }
                }
            }
            .navigationTitle(item == nil ? "Add to stock" : "Edit stock")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.bold()
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Remove \(name)?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    Task {
                        if let item, await WebAction.run("pantry.removeStock", [.array([.string(item.id)])]) {
                            await saved(); dismiss()
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            name = item?.ingredientName ?? ""
            amount = item?.amount ?? ""
            unit = item?.unit ?? ""
        }
    }

    private func save() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        let a = amount.trimmingCharacters(in: .whitespaces)
        let u = unit.trimmingCharacters(in: .whitespaces)
        let ok: Bool
        if let item {
            ok = await WebAction.run("pantry.updateStock", [.string(item.id), .object([
                "ingredientName": .string(n), "amount": a.isEmpty ? .null : .string(a), "unit": u.isEmpty ? .null : .string(u)])])
        } else {
            ok = await WebAction.run("pantry.addStock", [.object([
                "ingredientName": .string(n), "amount": .string(a), "unit": .string(u)])])
        }
        if ok { await saved(); dismiss() }
    }
}
