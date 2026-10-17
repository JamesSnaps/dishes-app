// A timer of your own, not tied to a step: "Rest the meat", 12 minutes. It
// joins the cook's timers (CookTimers), so it alarms the same way — AlarmKit,
// or a notification where that isn't allowed.

import SwiftUI

struct CustomTimerSheet: View {
    @Environment(\.dismiss) private var dismiss
    /// The dish on screen, shown with the timer.
    let dish: String

    @State private var label = ""
    @State private var minutes = 10
    @State private var seconds = 0
    @FocusState private var naming: Bool

    private static let presets = [1, 3, 5, 10, 15, 20, 30, 45, 60]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What’s it for? (e.g. Rest the meat)", text: $label)
                        .focused($naming)
                        .submitLabel(.done)
                }
                Section("How long") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Self.presets, id: \.self) { preset in
                                let on = minutes == preset && seconds == 0
                                Button("\(preset) min") { minutes = preset; seconds = 0 }
                                    .font(.system(size: 14, weight: .semibold))
                                    .padding(.horizontal, 12)
                                    .frame(height: 34)
                                    .foregroundStyle(on ? .white : Theme.foreground)
                                    .background(on ? Theme.brand : Theme.muted, in: Capsule())
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    HStack(spacing: 0) {
                        Picker("Minutes", selection: $minutes) {
                            ForEach(0..<240) { Text("\($0) min").tag($0) }
                        }
                        Picker("Seconds", selection: $seconds) {
                            ForEach(Array(stride(from: 0, to: 60, by: 5)), id: \.self) { Text("\($0) s").tag($0) }
                        }
                    }
                    .pickerStyle(.wheel)
                    .frame(height: 130)
                }
            }
            .navigationTitle("Add a timer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { start() }
                        .bold()
                        .disabled(minutes == 0 && seconds == 0)
                }
            }
        }
    }

    private func start() {
        let name = label.trimmingCharacters(in: .whitespaces)
        let total = TimeInterval(minutes * 60 + seconds)
        Task { await CookTimers.shared.start(label: name.isEmpty ? "Timer" : name, dish: dish, seconds: total) }
        dismiss()
    }
}
