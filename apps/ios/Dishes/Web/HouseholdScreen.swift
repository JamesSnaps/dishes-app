// Household settings, as the web's /settings: the household's name, its
// members (roles, diets, dislikes and preferences that steer AI suggestions),
// adding and removing members, and the household's AI configuration. Changing
// anything but your own preferences is for admins, as on the web.

import DishesCore
import SwiftUI

struct HouseholdData: Decodable, Sendable {
    struct Household: Decodable, Sendable { var id: String; var name: String }
    struct Member: Decodable, Sendable, Identifiable, Hashable {
        var id: String
        var autheliaUser: String
        var displayName: String
        var role: String
        var birthYear: Int?
        var dietaryFlags: [String]?
        var dislikes: [String]?
        var preferences: [String]?
        var customNotes: String?
    }
    struct Me: Decodable, Sendable { var memberId: String; var role: String }
    var household: Household
    var members: [Member]
    var me: Me
    var isAdmin: Bool { me.role == "admin" }
}

struct HouseholdScreen: View {
    @State private var data = Remote<HouseholdData>("household.get")
    @State private var editing: HouseholdData.Member?
    @State private var adding = false
    @State private var renaming = false

    var body: some View {
        WebPage(title: "Household", data: data) { h in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("NAME").font(.system(size: 12, weight: .semibold)).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                    Text(h.household.name).font(.system(size: 19, weight: .bold))
                }
                Spacer()
                if h.isAdmin { Button("Rename") { renaming = true }.buttonStyle(.outline).fixedSize() }
            }
            .padding(16).card()

            WebSection(title: "Members · \(h.members.count)", action: h.isAdmin ? ("Add", "person.badge.plus", { adding = true }) : nil) {
                CardList(items: h.members) { m in
                    Button { if h.isAdmin || m.id == h.me.memberId { editing = m } } label: {
                        HStack(spacing: 12) {
                            Avatar(name: m.displayName, size: 40)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(m.displayName).font(.system(size: 15, weight: .semibold))
                                    if m.id == h.me.memberId { BadgeView(text: "You", style: .outline) }
                                }
                                let diet = (m.dietaryFlags ?? []) + (m.dislikes ?? []).map { "no \($0)" }
                                Text(([m.role.capitalized, "@\(m.autheliaUser)"] + diet.prefix(3)).joined(separator: " · "))
                                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                            }
                            Spacer()
                            if h.isAdmin || m.id == h.me.memberId {
                                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.foreground)
                }
            }
            Text("Diets and dislikes are respected by the AI when it suggests recipes and plans for whoever’s eating.")
                .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
        }
        .sheet(item: $editing) { m in
            MemberSheet(member: m, isAdmin: data.value?.isAdmin == true, isMe: m.id == data.value?.me.memberId) { await data.load() }
        }
        .sheet(isPresented: $adding) { AddMemberSheet { await data.load() } }
        .sheet(isPresented: $renaming) {
            TextPromptSheet(title: "Household name", text: data.value?.household.name ?? "") { name in
                let ok = await WebAction.run("household.rename", [.string(name)])
                if ok { await data.load() }
                return ok
            }
        }
    }
}

/// One member: role (admins), birth year, diet, dislikes, preferences, notes.
private struct MemberSheet: View {
    @Environment(\.dismiss) private var dismiss
    let member: HouseholdData.Member
    let isAdmin: Bool
    let isMe: Bool
    var saved: () async -> Void
    @State private var role = "adult"
    @State private var birthYear = ""
    @State private var flags: Set<String> = []
    @State private var dislikes = ""
    @State private var preferences = ""
    @State private var notes = ""
    @State private var confirmRemove = false

    static let dietary = ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Nut allergy", "Shellfish allergy",
                          "Halal", "Kosher", "Low-FODMAP", "Egg-free", "Cholesterol-lowering"]

    var body: some View {
        NavigationStack {
            Form {
                if isAdmin {
                    Picker("Role", selection: $role) {
                        Text("Admin").tag("admin"); Text("Adult").tag("adult"); Text("Child").tag("child")
                    }
                }
                TextField("Birth year (optional)", text: $birthYear).keyboardType(.numberPad)
                Section("Dietary needs") {
                    FlowLayout(spacing: 8) {
                        ForEach(Self.dietary, id: \.self) { flag in
                            let on = flags.contains(flag)
                            Button(flag) { if on { flags.remove(flag) } else { flags.insert(flag) } }
                                .font(.system(size: 14, weight: .medium))
                                .padding(.horizontal, 12).frame(height: 32)
                                .foregroundStyle(on ? .white : Theme.foreground)
                                .background(on ? Theme.brand : Theme.muted, in: Capsule())
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    TextField("Mushrooms, coriander…", text: $dislikes, axis: .vertical)
                } header: { Text("Dislikes (comma separated)") }
                Section {
                    TextField("Spicy food, fish…", text: $preferences, axis: .vertical)
                } header: { Text("Loves (comma separated)") }
                Section("Anything else") {
                    TextField("Notes for the AI", text: $notes, axis: .vertical).lineLimit(2...6)
                }
                if isAdmin && !isMe {
                    Button("Remove from household", role: .destructive) { confirmRemove = true }
                }
            }
            .navigationTitle(member.displayName).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.bold() }
            }
            .confirmationDialog("Remove \(member.displayName)?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    Task { if await WebAction.run("household.removeMember", [.string(member.id)]) { await saved(); dismiss() } }
                }
            }
        }
        .onAppear {
            role = member.role
            birthYear = member.birthYear.map(String.init) ?? ""
            flags = Set(member.dietaryFlags ?? [])
            dislikes = (member.dislikes ?? []).joined(separator: ", ")
            preferences = (member.preferences ?? []).joined(separator: ", ")
            notes = member.customNotes ?? ""
        }
    }

    private func list(_ text: String) -> JSONValue {
        .array(text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { .string($0) })
    }

    private func save() async {
        let ok = await WebAction.run("household.setPreferences", [.string(member.id), .object([
            "role": .string(role),
            "birthYear": Int(birthYear).map { .number(Double($0)) } ?? .null,
            "dietaryFlags": .array(flags.sorted().map { .string($0) }),
            "dislikes": list(dislikes),
            "preferences": list(preferences),
            "customNotes": .string(notes),
        ])], done: "Saved.")
        if ok { await saved(); dismiss() }
    }
}

/// A new member: their Authelia username (what they sign in with) and name.
private struct AddMemberSheet: View {
    @Environment(\.dismiss) private var dismiss
    var saved: () async -> Void
    @State private var username = ""
    @State private var name = ""
    @State private var role = "adult"
    @State private var birthYear = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Sign-in username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Display name", text: $name)
                } footer: { Text("The username they sign in to Authelia with.") }
                Picker("Role", selection: $role) {
                    Text("Admin").tag("admin"); Text("Adult").tag("adult"); Text("Child").tag("child")
                }
                TextField("Birth year (optional)", text: $birthYear).keyboardType(.numberPad)
            }
            .navigationTitle("Add member").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            let ok = await WebAction.run("household.addMember", [.object([
                                "autheliaUser": .string(username), "displayName": .string(name),
                                "role": .string(role), "birthYear": .string(birthYear)])], done: "\(name) added.")
                            if ok { await saved(); dismiss() }
                        }
                    }
                    .bold()
                    .disabled(username.isEmpty || name.isEmpty)
                }
            }
        }
    }
}

// MARK: AI settings

struct AIConfigData: Decodable, Sendable {
    var model: String
    var imageModel: String?
    var monthlyLimitUsd: LooseText?
    var defaultPrompt: String?
    var kitchenEquipment: String?
    var measurementSystem: String?
    var imageStyle: String?
    var webGrounding: Bool?
    var keyHint: String?
}

struct AISettingsScreen: View {
    @Environment(\.horizontalSizeClass) private var width
    @State private var loaded = false
    @State private var config: AIConfigData?
    @State private var isAdmin = false
    @State private var apiKey = ""
    @State private var model = "gpt-4.1-nano"
    @State private var imageModel = "gpt-image-2"
    @State private var limit = "20.00"
    @State private var prompt = ""
    @State private var equipment = ""
    @State private var measurement = "metric"
    @State private var style = "studio"
    @State private var grounding = false
    @State private var saving = false

    private static let chat = [("gpt-4.1-nano", "GPT-4.1 Nano (recommended)"), ("gpt-4.1-mini", "GPT-4.1 Mini"), ("gpt-4.1", "GPT-4.1"),
                               ("gpt-4o-mini", "GPT-4o Mini"), ("gpt-4o", "GPT-4o"), ("gpt-6-luna", "GPT-6 Luna")]
    private static let images = [("gpt-image-2.5-flare", "GPT Image 2.5 Flare"), ("gpt-image-2", "GPT Image 2 (recommended)"),
                                 ("dall-e-3", "DALL·E 3"), ("dall-e-2", "DALL·E 2")]
    private static let styles = ["studio", "moody", "rustic", "bright", "overhead", "cellphone"]

    var body: some View {
        Form {
            Section {
                SecureField(config?.keyHint.map { "Current key \($0) — leave blank to keep" } ?? "sk-…", text: $apiKey)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            } header: { Text("OpenAI API key") } footer: {
                Text("Stored encrypted on your server; it never leaves it.")
            }
            Section("Models") {
                Picker("Chat", selection: $model) { ForEach(Self.chat, id: \.0) { Text($0.1).tag($0.0) } }
                Picker("Images", selection: $imageModel) { ForEach(Self.images, id: \.0) { Text($0.1).tag($0.0) } }
                Picker("Photo style", selection: $style) { ForEach(Self.styles, id: \.self) { Text($0.capitalized).tag($0) } }
                LabeledContent("Monthly limit (US$)") {
                    TextField("20.00", text: $limit).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
            }
            Section("Cooking") {
                Picker("Measurements", selection: $measurement) {
                    Text("Metric (g, ml)").tag("metric"); Text("Imperial (cups, oz)").tag("imperial")
                }
                TextField("Kitchen equipment (air fryer, slow cooker…)", text: $equipment, axis: .vertical)
                TextField("Always tell the AI… (e.g. we like it spicy)", text: $prompt, axis: .vertical).lineLimit(2...6)
                Toggle("Ground recipes on web search", isOn: $grounding).tint(Theme.brand)
            }
            if isAdmin {
                Button(saving ? "Saving…" : "Save AI settings") { Task { await save() } }
                    .disabled(saving || (config == nil && apiKey.isEmpty))
            } else {
                Text("Only admins can change these.").foregroundStyle(.secondary)
            }
        }
        .disabled(!isAdmin)
        .navigationTitle("AI settings")
        .task { await load() }
    }

    private func load() async {
        guard !loaded else { return }
        loaded = true
        isAdmin = (try? await AppModel.shared.api.action("household.get", as: HouseholdData.self))?.isAdmin ?? false
        guard let c = try? await AppModel.shared.api.action("ai.config", as: AIConfigData?.self) else { return }
        config = c
        model = c.model
        imageModel = c.imageModel ?? imageModel
        limit = c.monthlyLimitUsd?.text ?? limit
        prompt = c.defaultPrompt ?? ""
        equipment = c.kitchenEquipment ?? ""
        measurement = c.measurementSystem ?? "metric"
        style = c.imageStyle ?? "studio"
        grounding = c.webGrounding ?? false
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let ok = await WebAction.run("ai.saveConfig", [.object([
            "apiKey": .string(apiKey), "model": .string(model), "imageModel": .string(imageModel),
            "monthlyLimit": .string(limit), "defaultPrompt": .string(prompt), "kitchenEquipment": .string(equipment),
            "measurementSystem": .string(measurement), "imageStyle": .string(style), "webGrounding": .bool(grounding),
        ])], done: "AI settings saved.")
        if ok {
            apiKey = ""
            loaded = false
            await load()
        }
    }
}
