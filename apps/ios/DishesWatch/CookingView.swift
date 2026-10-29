// The cook in progress, followed from the wrist: the dish, the step and its
// words, and every timer counting down. View-only — the device cooking owns the
// cook (CookingShare on the phone), so nothing here can change it.
//
// The timers count down from their end times on the Watch itself, so they're
// right between updates. While this is open it asks the phone for the latest
// every 15 seconds; a cook on another device also arrives by push. A timer that
// runs out with this on screen taps the wrist — the real alarm is on the
// device cooking.

import SwiftUI
import WatchKit

struct CookingView: View {
    @Environment(WatchModel.self) private var model
    let id: String

    private var cook: WatchCook? { model.snapshot.cooking.first { $0.id == id } }

    var body: some View {
        ScrollView {
            if let cook {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cook.dish).font(.headline)
                        Text("Step \(cook.step) of \(cook.totalSteps) · \(cook.device)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(WatchTheme.brand, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                    ForEach(cook.timers) { timer in TimerRow(timer: timer) }

                    Text(cook.instruction)
                        .font(.body)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if Date.now.timeIntervalSince(cook.updatedAt) > 10 * 60 {
                        Text("Last heard from the \(cook.device) at \(cook.updatedAt, format: .dateTime.hour().minute())")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(WatchTheme.emerald)
                    Text("That cook has finished.").font(.footnote)
                }
                .padding(.top, 20)
            }
        }
        .navigationTitle(cook?.title ?? "Cooking")
        .task {
            while !Task.isCancelled {
                model.refresh("cooking")
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .task(id: nextEnd) {
            // Tap the wrist when the soonest timer runs out while this is open.
            guard let end = nextEnd, end > .now else { return }
            try? await Task.sleep(for: .seconds(end.timeIntervalSinceNow))
            guard !Task.isCancelled else { return }
            WKInterfaceDevice.current().play(.notification)
        }
    }

    private var nextEnd: Date? {
        cook?.timers.filter { $0.state == .running }.compactMap(\.endsAt).filter { $0 > .now }.min()
    }
}

private struct TimerRow: View {
    let timer: WatchTimer

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(tint.gradient, in: Circle())
            VStack(alignment: .leading, spacing: 0) {
                countdown
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                Text(timer.label).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(WatchTheme.platter(tint))
    }

    @ViewBuilder private var countdown: some View {
        switch timer.state {
        case .running:
            if let ends = timer.endsAt, ends > .now {
                Text(timerInterval: Date.now...ends, countsDown: true)
            } else {
                Text("Done")
            }
        case .paused:
            Text(Duration.seconds(timer.remaining), format: .time(pattern: timer.remaining >= 3600 ? .hourMinuteSecond : .minuteSecond))
        case .finished:
            Text("Done")
        }
    }

    private var icon: String {
        switch timer.state {
        case .running: "timer"
        case .paused: "pause.fill"
        case .finished: "bell.fill"
        }
    }

    private var tint: Color {
        switch timer.state {
        case .running: WatchTheme.brand
        case .paused: WatchTheme.violet
        case .finished: WatchTheme.emerald
        }
    }
}
