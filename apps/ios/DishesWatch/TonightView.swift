// Tonight's meal: its dishes, when it's served, and the cooking schedule as
// clock times ("18:05 Potatoes: in the oven"), the next one picked out and the
// ones already passed dimmed.

import SwiftUI

struct TonightView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        List {
            if let meal = model.snapshot.tonight {
                VStack(alignment: .leading, spacing: 4) {
                    Text(meal.title).font(.headline)
                    if meal.dishes.count > 1 {
                        Text(meal.dishes.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                    }
                    if let serve = meal.serveAt {
                        Label {
                            Text("Serve at \(serve, format: .dateTime.hour().minute())")
                        } icon: {
                            Image(systemName: "bell.fill")
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(WatchTheme.amber)
                    }
                }
                .padding(.vertical, 6)
                .listRowBackground(WatchTheme.platter(WatchTheme.amber))

                if !meal.cues.isEmpty {
                    Section("Schedule") {
                        ForEach(Array(meal.cues.enumerated()), id: \.offset) { index, cue in
                            // Each row works out "next" and "past" itself, so the list moves on by the minute.
                            TimelineView(.everyMinute) { context in
                                CueRow(cue: cue, isNext: index == meal.cues.firstIndex { $0.at > context.date },
                                       isPast: cue.at <= context.date)
                            }
                        }
                    }
                } else if meal.serveAt == nil {
                    Text("Give it a serve-at time on the phone to see when to start each step.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
            } else {
                Notice(icon: "calendar.badge.plus", text: "Nothing planned for tonight.")
            }
        }
        .navigationTitle("Tonight")
    }
}

private struct CueRow: View {
    let cue: WatchCue
    let isNext: Bool
    let isPast: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(cue.at, format: .dateTime.hour().minute())
                .font(.footnote.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(isNext ? WatchTheme.brand : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                if let dish = cue.dish {
                    Text(dish).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                }
                Text(cue.text).font(.footnote).lineLimit(4)
            }
        }
        .opacity(isPast ? 0.5 : 1)
        .listRowBackground(isNext ? AnyView(WatchTheme.platter(WatchTheme.brand)) : AnyView(Color.clear))
    }
}
