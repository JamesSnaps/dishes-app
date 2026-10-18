// The widget extension: the Live Activities below, and the "Add to Shopping"
// control for Control Center and the Lock Screen (AddToShoppingControl).
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
import AppIntents
import SwiftUI
import WidgetKit

@main
struct DishesWidgets: WidgetBundle {
    var body: some Widget {
        CookingLiveActivity()
        CookTimerAlarmActivity()
        MealScheduleLiveActivity()
        AddToShoppingControl()
    }
}

/// Control Center, the Lock Screen and the Action button: opens the shopping
/// list with the add field focused (OpenShoppingAddIntent, in Shared/).
struct AddToShoppingControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "uk.collco.dishes.add-to-shopping") {
            ControlWidgetButton(action: OpenShoppingAddIntent()) {
                Label("Add to Shopping", systemImage: "cart.badge.plus")
            }
        }
        .displayName("Add to Shopping")
        .description("Opens the shopping list, ready to add an item.")
    }
}

private enum Palette {
    static let brand = Color(red: 0.976, green: 0.451, blue: 0.086) // #F97316
    static let muted = Color(red: 0.580, green: 0.639, blue: 0.722) // slate-400, readable on the dark island
}

/// The Lock Screen card's colours. Everything is set explicitly on an opaque
/// background: the first version used a 90%-white tint with system text
/// colours, which the Lock Screen turned into see-through glass with white text
/// — unreadable on a light photo (James's iPad, 17 Oct 2026).
private struct CardColors {
    let scheme: ColorScheme
    /// The web's card: white / slate-900.
    var background: Color { scheme == .dark ? Color(red: 0.059, green: 0.090, blue: 0.165) : .white }
    /// --foreground: slate-950 / slate-50.
    var text: Color { scheme == .dark ? Color(red: 0.973, green: 0.980, blue: 0.988) : Color(red: 0.008, green: 0.031, blue: 0.090) }
    /// --muted-foreground: slate-500 / slate-400.
    var secondary: Color { scheme == .dark ? Palette.muted : Color(red: 0.392, green: 0.455, blue: 0.545) }
}

/// Applies the opaque card background for the current Lock Screen appearance.
private struct LockScreenCard<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder let content: (CardColors) -> Content

    var body: some View {
        let colors = CardColors(scheme: scheme)
        content(colors)
            .activityBackgroundTint(colors.background)
            .activitySystemActionForegroundColor(Palette.brand)
    }
}

// MARK: Cooking

struct CookingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CookingActivityAttributes.self) { context in
            LockScreenCard { CookingLockScreen(context: context, colors: $0) }
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
    let colors: CardColors

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "frying.pan.fill").foregroundStyle(Palette.brand)
                    Text(context.state.title ?? context.attributes.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        .foregroundStyle(colors.text)
                }
                Text("Step \(context.state.step) of \(context.state.totalSteps)\(context.state.dish == (context.state.title ?? context.attributes.title) ? "" : " · \(context.state.dish)")")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.brand)
                Text(context.state.instruction)
                    .font(.subheadline)
                    .foregroundStyle(colors.text)
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
                        Text(label).font(.caption).foregroundStyle(colors.secondary)
                            .lineLimit(2).multilineTextAlignment(.trailing)
                    }
                    if context.state.runningTimers > 1 {
                        Text("+\(context.state.runningTimers - 1) more").font(.caption2).foregroundStyle(colors.secondary)
                    }
                }
            }
        }
        .padding(16)
    }
}

// MARK: Meal schedule

struct MealScheduleLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MealScheduleAttributes.self) { context in
            LockScreenCard { MealScheduleLockScreen(context: context, colors: $0) }
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Serve \(context.state.serveDate.formatted(date: .omitted, time: .shortened))", systemImage: "fork.knife")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.brand)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    MealCountdown(to: context.state.nextDate)
                        .font(.title3.weight(.bold).monospacedDigit())
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(Palette.brand)
                        .frame(maxWidth: 90)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(context.state.nextDate.formatted(date: .omitted, time: .shortened)) · \(context.state.nextText)")
                            .font(.subheadline).lineLimit(2)
                        if let after = context.state.afterText {
                            Text("Then: \(after)").font(.caption).foregroundStyle(Palette.muted).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: "fork.knife").foregroundStyle(Palette.brand)
            } compactTrailing: {
                MealCountdown(to: context.state.nextDate)
                    .monospacedDigit()
                    .foregroundStyle(Palette.brand)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "fork.knife").foregroundStyle(Palette.brand)
            }
            .keylineTint(Palette.brand)
        }
    }
}

/// Counts down to the next step; past it (until the server's update arrives)
/// it says "Now" rather than showing a frozen 0:00.
private struct MealCountdown: View {
    let to: Date

    var body: some View {
        if to > .now {
            Text(timerInterval: Date.now...to, countsDown: true)
        } else {
            Text("Now")
        }
    }
}

private struct MealScheduleLockScreen: View {
    let context: ActivityViewContext<MealScheduleAttributes>
    let colors: CardColors

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "fork.knife").foregroundStyle(Palette.brand)
                    Text(context.attributes.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        .foregroundStyle(colors.text)
                    Text("· serve \(context.state.serveDate.formatted(date: .omitted, time: .shortened))")
                        .font(.subheadline).foregroundStyle(colors.secondary)
                }
                Text("\(context.state.nextDate.formatted(date: .omitted, time: .shortened)) · Next")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.brand)
                Text(context.state.nextText)
                    .font(.subheadline)
                    .foregroundStyle(colors.text)
                    .lineLimit(3)
                if let after = context.state.afterText {
                    Text("Then: \(after)").font(.caption).foregroundStyle(colors.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                MealCountdown(to: context.state.nextDate)
                    .font(.title.weight(.bold).monospacedDigit())
                    .multilineTextAlignment(.trailing)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(Palette.brand)
                    .frame(width: 124, alignment: .trailing)
                Text(context.state.stepsLeft == 1 ? "1 step left" : "\(context.state.stepsLeft) steps left")
                    .font(.caption).foregroundStyle(colors.secondary)
            }
        }
        .padding(16)
    }
}

// MARK: AlarmKit timers

struct CookTimerAlarmActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<CookTimerMetadata>.self) { context in
            LockScreenCard { AlarmLockScreen(context: context, colors: $0) }
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
    let colors: CardColors

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "timer")
                .font(.title2)
                .foregroundStyle(Palette.brand)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.presentation.countdown?.title ?? context.attributes.presentation.alert.title)
                    .font(.headline)
                    .foregroundStyle(colors.text)
                    .lineLimit(1)
                if let dish = context.attributes.metadata?.dish {
                    Text(dish).font(.caption).foregroundStyle(colors.secondary).lineLimit(2)
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
