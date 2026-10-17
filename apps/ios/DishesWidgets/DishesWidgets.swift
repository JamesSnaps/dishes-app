// The widget extension. For now it draws two Live Activities:
//
//   CookingLiveActivity   while cooking mode is open: the dish, "Step 3 of 8",
//                         the step's instruction and the soonest timer
//   CookTimerAlarmActivity  each AlarmKit timer's own countdown, paused state
//                         and "Time's up" — AlarmKit shows a timer on the Lock
//                         Screen only through an ActivityConfiguration for its
//                         AlarmAttributes, which has to live in an extension
//
// Home Screen widgets (tonight's meal, the shopping count) come later and will
// need the App Group so they can read the store (TODO_MOBILE.md, C4 tier 2).
//
// Colours are copied from the app's Theme (the extension can't see app code):
// orange-500 for the brand, the web's slate for muted text.

import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

@main
struct DishesWidgets: WidgetBundle {
    var body: some Widget {
        CookingLiveActivity()
        CookTimerAlarmActivity()
    }
}

private enum Palette {
    static let brand = Color(red: 0.976, green: 0.451, blue: 0.086) // #F97316
    static let muted = Color(red: 0.580, green: 0.639, blue: 0.722) // slate-400, readable on the dark island
}

// MARK: Cooking

struct CookingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CookingActivityAttributes.self) { context in
            CookingLockScreen(context: context)
                .activityBackgroundTint(Color(.systemBackground).opacity(0.9))
                .activitySystemActionForegroundColor(Palette.brand)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Step \(context.state.step)/\(context.state.totalSteps)", systemImage: "frying.pan.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.brand)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let end = context.state.timerEndsAt, end > .now {
                        Text(timerInterval: Date.now...end, countsDown: true)
                            .font(.title3.weight(.bold).monospacedDigit())
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(Palette.brand)
                            .frame(maxWidth: 90)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(context.state.dish).font(.caption).foregroundStyle(Palette.muted)
                        Text(context.state.instruction).font(.subheadline).lineLimit(2)
                        if let label = context.state.timerLabel {
                            Label(label, systemImage: "timer").font(.caption).foregroundStyle(Palette.brand)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: "frying.pan.fill").foregroundStyle(Palette.brand)
            } compactTrailing: {
                if let end = context.state.timerEndsAt, end > .now {
                    Text(timerInterval: Date.now...end, countsDown: true)
                        .monospacedDigit()
                        .foregroundStyle(Palette.brand)
                        .frame(maxWidth: 52)
                } else {
                    Text("\(context.state.step)/\(context.state.totalSteps)").foregroundStyle(Palette.brand)
                }
            } minimal: {
                Image(systemName: context.state.timerEndsAt == nil ? "frying.pan.fill" : "timer")
                    .foregroundStyle(Palette.brand)
            }
            .keylineTint(Palette.brand)
        }
    }
}

private struct CookingLockScreen: View {
    let context: ActivityViewContext<CookingActivityAttributes>

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "frying.pan.fill").foregroundStyle(Palette.brand)
                    Text(context.attributes.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                Text("Step \(context.state.step) of \(context.state.totalSteps)\(context.state.dish == context.attributes.title ? "" : " · \(context.state.dish)")")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.brand)
                Text(context.state.instruction)
                    .font(.subheadline)
                    .lineLimit(3)
                // The web's orange progress bar.
                ProgressView(value: Double(context.state.step), total: Double(max(context.state.totalSteps, 1)))
                    .tint(Palette.brand)
            }
            if let end = context.state.timerEndsAt, end > .now {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(timerInterval: Date.now...end, countsDown: true)
                        .font(.title.weight(.bold).monospacedDigit())
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(Palette.brand)
                        .frame(width: 104, alignment: .trailing)
                    if let label = context.state.timerLabel {
                        Text(label).font(.caption).lineLimit(2).multilineTextAlignment(.trailing)
                    }
                    if context.state.runningTimers > 1 {
                        Text("+\(context.state.runningTimers - 1) more").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(16)
    }
}

// MARK: AlarmKit timers

struct CookTimerAlarmActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<CookTimerMetadata>.self) { context in
            AlarmLockScreen(context: context)
                .activityBackgroundTint(Color(.systemBackground).opacity(0.9))
                .activitySystemActionForegroundColor(Palette.brand)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(title(context), systemImage: "timer")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.brand)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    AlarmCountdown(state: context.state).font(.title3.weight(.bold).monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let dish = context.attributes.metadata?.dish {
                        Text(dish).font(.caption).foregroundStyle(Palette.muted)
                    }
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(Palette.brand)
            } compactTrailing: {
                AlarmCountdown(state: context.state).frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(Palette.brand)
            }
            .keylineTint(Palette.brand)
        }
    }

    private func title(_ context: ActivityViewContext<AlarmAttributes<CookTimerMetadata>>) -> String {
        String(localized: context.attributes.presentation.countdown?.title ?? context.attributes.presentation.alert.title)
    }
}

private struct AlarmLockScreen: View {
    let context: ActivityViewContext<AlarmAttributes<CookTimerMetadata>>

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "timer")
                .font(.title2)
                .foregroundStyle(Palette.brand)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.presentation.countdown?.title ?? context.attributes.presentation.alert.title)
                    .font(.headline)
                    .lineLimit(1)
                if let dish = context.attributes.metadata?.dish {
                    Text(dish).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            AlarmCountdown(state: context.state).font(.title.weight(.bold).monospacedDigit())
        }
        .padding(16)
    }
}

/// Counting down, frozen while paused, or "Done" once it has gone off.
private struct AlarmCountdown: View {
    let state: AlarmPresentationState

    var body: some View {
        switch state.mode {
        case .countdown(let countdown):
            Text(timerInterval: Date.now...countdown.fireDate, countsDown: true)
                .multilineTextAlignment(.trailing)
                .foregroundStyle(Palette.brand)
        case .paused(let paused):
            Text(Duration.seconds(max(0, paused.totalCountdownDuration - paused.previouslyElapsedDuration)),
                 format: .time(pattern: .minuteSecond))
                .foregroundStyle(Palette.muted)
        default:
            Text("Done").foregroundStyle(Palette.brand)
        }
    }
}
