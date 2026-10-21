// Several cooks at once — dinner and dessert, say — as the web's mini bar and
// CookSwitcher do it (James, 18 Oct 2026):
//
//   one cook      the resume bar: the cook, its step, its next timer; tap to go back
//   two or more   the bar leads with the cook in front, the others stacked behind
//                 it like cards; tapping fans the stack out to pick one (CookStackFan)
//   cooking mode  a switcher in the toolbar jumps between cooks (CookSwitcher)
//
// The bar is the iPhone's tab-bar accessory and floats at the bottom on iPad;
// the fan is drawn over the whole app (RootView). AppNav keeps the cooks.

import DishesCore
import SwiftUI

extension CookSession {
    /// Its timers: CookTimers is one pool, each timer tagged with its dish's title.
    var timers: [CookTimer] {
        let dishes = Set(request.dishes.map(\.recipe.title))
        return CookTimers.shared.timers.filter { $0.dish.map(dishes.contains) == true }
    }

    /// The running timer that goes off soonest.
    var nextTimer: CookTimer? {
        timers.filter { $0.state == .running }.min { ($0.endsAt ?? .distantFuture) < ($1.endsAt ?? .distantFuture) }
    }

    /// "Step 3 of 6", "Lamb · Step 2 of 5", or "4 of 15 in the meal".
    var progress: String {
        if inSequence { return "\(seqIndex + 1) of \(cues.count) in the meal" }
        let count = max(dish.recipe.steps.count, 1)
        let step = "Step \(min(stepIndex + 1, count)) of \(count)"
        return dish.recipe.title == title ? step : "\(dish.recipe.title) · \(step)"
    }

    /// When the meal's current step is due, walking a scheduled meal.
    var dueAt: Date? { inSequence ? cue.map { Date(timeIntervalSince1970: $0.at / 1000) } : nil }

    /// The Live Activity shows this cook.
    func showActivity() {
        let dish = self.dish
        let total = max(dish.recipe.steps.count, 1)
        let step = dish.recipe.steps.indices.contains(stepIndex) ? dish.recipe.steps[stepIndex] : nil
        CookingActivity.shared.show(title: title, dish: dish.recipe.title,
                                    step: min(stepIndex + 1, total), of: total, instruction: step?.instruction ?? "",
                                    link: link.url)
    }

    /// Back to this cook where it is now, for the Live Activity's tap.
    var link: CookLink {
        CookLink(groupId: request.groupId, recipeIds: request.dishes.map(\.recipe.id),
                 recipeId: dish.recipe.id, stepIndex: stepIndex, cue: inSequence ? cue?.id : nil)
    }

    /// Whether a CookLink is for this cook: the same meal, else the same dishes.
    func matches(_ link: CookLink) -> Bool {
        if let group = link.groupId, group == request.groupId { return true }
        return !link.recipeIds.isEmpty && Set(link.recipeIds) == Set(request.dishes.map(\.recipe.id))
    }

    /// Where a CookLink says: its place in the meal's sequence, else that dish at that step.
    func go(to link: CookLink) {
        if let id = link.cue, let index = cues.firstIndex(where: { $0.id == id }) {
            goTo(index)
            return
        }
        guard let id = link.recipeId, let dish = request.dishes.firstIndex(where: { $0.recipe.id == id }) else { return }
        if let step = link.stepIndex, request.dishes[dish].recipe.steps.indices.contains(step) { steps[id] = step }
        if let cue = link.cue {
            // The schedule isn't back yet (just relaunched): it lands there once it is.
            position = cue
            dishView = false
            dishIndex = dish
        } else if cues.isEmpty {
            dishIndex = dish
        } else {
            showDish(dish)
        }
    }
}

/// Cooking mode's contents: the cook in front, rebuilt when the switcher
/// brings another forward. The screen stays on for as long as it's open.
struct CookingCover: View {
    @Environment(AppNav.self) private var nav

    var body: some View {
        Group {
            if let session = nav.session {
                CookingView(session: session).id(ObjectIdentifier(session))
            }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

/// The minimised cook in front, as the web's mini bar: the dish and step, the
/// next timer, tap to go back to it, × to end it. With other cooks behind it,
/// their cards peek out above (iPad) or stack behind its icon (iPhone), and a
/// tap fans them all out instead.
struct CookingBar: View {
    @Environment(AppNav.self) private var nav
    let session: CookSession

    /// Never below 0: the bar draws once more as the last cook ends, with no
    /// cooks left (that -1 crashed CookIcon's range, 21 Oct 2026).
    private var others: Int { max(nav.sessions.count - 1, 0) }

    var body: some View {
        HStack(spacing: 10) {
            Button {
                if others > 0 {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) { nav.cooksFanned = true }
                } else {
                    nav.open(session)
                }
            } label: {
                HStack(spacing: 10) {
                    CookIcon(stacked: others)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(session.title).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.foreground).lineLimit(1)
                        Text(others > 0 ? "\(session.progress) · +\(others) more" : session.progress)
                            .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    CookStatus(session: session)
                    Image(systemName: others > 0 ? "rectangle.stack" : "chevron.up")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(others > 0 ? "\(others + 1) cooks in progress — choose one" : "Back to cooking \(session.title)")
            if others == 0 {
                EndCookButton(session: session, size: 28)
            }
        }
        .padding(.horizontal, 12)
    }
}

/// The frying pan on brand orange; with other cooks, more pans stacked behind
/// it and their count on it.
private struct CookIcon: View {
    let stacked: Int
    var size: CGFloat = 28

    /// The pans drawn behind: up to two, never a negative range.
    private var behind: Int { min(max(stacked, 0), 2) }

    var body: some View {
        ZStack {
            ForEach(Array(0..<behind).reversed(), id: \.self) { i in
                Circle()
                    .fill(Theme.brand.opacity(i == 0 ? 0.45 : 0.25))
                    .frame(width: size, height: size)
                    .offset(x: CGFloat(i + 1) * 5)
            }
            Image(systemName: "frying.pan.fill")
                .font(.system(size: size * 0.46))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(Theme.brandGradient, in: Circle())
        }
        .frame(width: size + CGFloat(behind) * 5, alignment: .leading)
        .overlay(alignment: .topTrailing) {
            if stacked > 0 {
                Text("\(stacked + 1)")
                    .font(.system(size: 10, weight: .heavy).monospacedDigit())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4)
                    .frame(minWidth: 16, minHeight: 16)
                    .background(Theme.foreground, in: Capsule())
                    .offset(x: 4, y: -5)
            }
        }
    }
}

/// The cook's next timer counting down, else when its step is due.
private struct CookStatus: View {
    let session: CookSession

    var body: some View {
        if let end = session.nextTimer?.endsAt, end > .now {
            Label { Text(timerInterval: Date.now...end, countsDown: true).monospacedDigit() } icon: { Image(systemName: "timer") }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.brandDeep)
        } else if let due = session.dueAt {
            Label(MealStartSheet.hhmm(due), systemImage: "alarm")
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color(hex: 0x9A3412))
        }
    }
}

/// × with "Stop cooking …?": ends that cook only.
private struct EndCookButton: View {
    @Environment(AppNav.self) private var nav
    let session: CookSession
    var size: CGFloat
    @State private var confirm = false

    var body: some View {
        Button { confirm = true } label: {
            Image(systemName: "xmark").font(.system(size: size * 0.43, weight: .bold))
                .frame(width: size, height: size)
                .background(Theme.muted, in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.foreground)
        .accessibilityLabel("End cooking \(session.title)")
        .confirmationDialog("Stop cooking \(session.title)?", isPresented: $confirm, titleVisibility: .visible) {
            Button("End cooking and cancel timers", role: .destructive) { withAnimation { nav.end(session, cancelTimers: true) } }
            Button("End cooking, keep timers") { withAnimation { nav.end(session) } }
        }
    }
}

/// The other cooks' cards peeking out above the bar, a little smaller each:
/// the bar's background on iPad.
struct CookStackPeek: View {
    let count: Int

    var body: some View {
        ZStack(alignment: .top) {
            ForEach(Array(1...max(min(count, 2), 1)).reversed(), id: \.self) { i in
                CookCardEdge(depth: i)
                    .scaleEffect(x: 1 - 0.05 * CGFloat(i), y: 1, anchor: .top)
                    .offset(y: -8 * CGFloat(i))
            }
        }
        .opacity(count > 0 ? 1 : 0)
    }
}

/// One of the cards stacked behind the bar: the fan's card colours, a shade
/// deeper the further back it is.
private struct CookCardEdge: View {
    let depth: Int

    var body: some View {
        Capsule()
            .fill(Theme.card)
            .overlay(Capsule().fill(LinearGradient(colors: [Theme.orange50, Theme.rose50], startPoint: .leading, endPoint: .trailing)))
            .overlay(Capsule().fill(Theme.brand.opacity(0.07 * Double(depth))))
            .overlay(Capsule().strokeBorder(Theme.brand.opacity(0.4), lineWidth: 1))
            .shadow(color: .black.opacity(0.1), radius: 3, y: -1)
    }
}

/// The iPhone's version of CookStackPeek: the other cooks' top edges just
/// above the tab-bar accessory, drawn over the app since the accessory clips.
struct CookStackEdges: View {
    let count: Int
    /// The bar, in global coordinates.
    let bar: CGRect

    var body: some View {
        GeometryReader { geo in
            let origin = geo.frame(in: .global).origin
            let f = bar.offsetBy(dx: -origin.x, dy: -origin.y)
            ZStack {
                ForEach(Array(1...max(min(count, 2), 1)).reversed(), id: \.self) { i in
                    CookCardEdge(depth: i)
                        .frame(width: f.width * (1 - 0.06 * CGFloat(i)), height: f.height)
                        .position(x: f.midX, y: f.midY - 8 * CGFloat(i))
                }
            }
            // Only what shows above the bar.
            .mask(alignment: .top) { Rectangle().frame(height: max(f.minY, 0)) }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .opacity(bar == .zero ? 0 : 1)
        .transition(.opacity)
    }
}

/// Every cook in progress, fanned out of the resume bar's stack: tap a card to
/// open that cook, × to end it, anywhere else to put them back.
struct CookStackFan: View {
    @Environment(AppNav.self) private var nav
    /// The bar the stack fans out of, in global coordinates.
    let bar: CGRect
    @State private var open = false
    @State private var shownAt = Date.distantPast

    private let cardHeight: CGFloat = 74
    private let spacing: CGFloat = 10

    var body: some View {
        let cooks = nav.sessions
        GeometryReader { geo in
        let frame = geo.frame(in: .global)
        ZStack(alignment: .bottom) {
            Rectangle()
                .fill(.black.opacity(open ? 0.32 : 0))
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { close() }
                .accessibilityLabel("Close")
                .accessibilityAddTraits(.isButton)
            VStack(spacing: spacing) {
                Label("\(cooks.count) cooking now", systemImage: "rectangle.stack.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.55), in: Capsule())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(open ? 1 : 0)
                // The cook in front at the bottom, where the bar was; the rest above it.
                ForEach(Array(cooks.enumerated()).reversed(), id: \.element.id) { i, cook in
                    CookCard(session: cook, front: i == 0) { nav.open(cook) }
                        // Collapsed, every card sits on the front one, peeking 8pt above it.
                        .scaleEffect(open ? 1 : 1 - 0.05 * CGFloat(min(i, 2)), anchor: .top)
                        .offset(y: open ? 0 : CGFloat(i) * (cardHeight + spacing) - CGFloat(min(i, 2)) * 8)
                        .opacity(open || i <= 2 ? 1 : 0)
                        .zIndex(Double(cooks.count - i))
                }
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: 560)
            // The front card's bottom where the bar's is, so it rises out of it.
            .padding(.bottom, bar == .zero ? 100 : max(frame.maxY - bar.maxY, 16))
        }
        .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .onAppear {
            shownAt = .now
            withAnimation(.spring(response: 0.36, dampingFraction: 0.82)) { open = true }
        }
        .onChange(of: nav.cooksFanned) { _, fanned in if !fanned { open = false } }
    }

    private func close() {
        // A tap while the cards are still spreading was meant for one of them.
        guard Date.now.timeIntervalSince(shownAt) > 0.35 else { return }
        withAnimation(.spring(response: 0.32, dampingFraction: 0.9)) { open = false }
        Task {
            try? await Task.sleep(for: .milliseconds(260))
            nav.cooksFanned = false
        }
    }
}

/// One cook in the fan: its title, where it's up to, its next timer or due
/// time, and ×. With timers still running, × asks first, in the card (a
/// dialog can't be shown from over the tab bar).
private struct CookCard: View {
    @Environment(AppNav.self) private var nav
    let session: CookSession
    let front: Bool
    let open: () -> Void
    @State private var confirming = false

    /// The cook's timers that haven't gone off (every dish in a meal).
    private var live: Int { session.timers.filter { $0.state != .finished }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Button(action: open) {
                    HStack(spacing: 12) {
                        Image(systemName: "frying.pan.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background(Theme.brandGradient, in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.title)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                            Text(confirming ? (live == 1 ? "A timer is still running." : "\(live) timers are still running.") : session.progress)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.mutedForeground)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        if !confirming {
                            CookStatus(session: session)
                            Image(systemName: "chevron.up").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .allowsHitTesting(!confirming)
                .accessibilityLabel("Open \(session.title), \(session.progress)")
                Button {
                    if live == 0 { withAnimation { nav.end(session) } }
                    else { withAnimation(.snappy) { confirming.toggle() } }
                } label: {
                    Image(systemName: confirming ? "arrow.uturn.backward" : "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .frame(width: 30, height: 30)
                        .background(Theme.muted, in: Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.foreground)
                .accessibilityLabel(confirming ? "Keep cooking" : "End cooking \(session.title)")
            }
            if confirming {
                HStack(spacing: 8) {
                    Button("End, keep timers") { withAnimation { nav.end(session) } }
                        .buttonStyle(OutlineButtonStyle())
                    Button("End and cancel timers", role: .destructive) { withAnimation { nav.end(session, cancelTimers: true) } }
                        .buttonStyle(GradientButtonStyle(gradient: .orangeRose, height: 38))
                }
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, confirming ? 12 : 0)
        .frame(height: confirming ? nil : 74)
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Theme.card)
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(LinearGradient(colors: [Theme.orange50.opacity(front ? 0.9 : 0.55), Theme.rose50.opacity(front ? 0.7 : 0.35)],
                                             startPoint: .topLeading, endPoint: .bottomTrailing))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(Theme.brand.opacity(front ? 0.45 : 0.2), lineWidth: front ? 1.5 : 1)
                )
                .shadow(color: .black.opacity(0.16), radius: 14, y: 6)
        }
    }
}

/// Cooking mode's switcher on iPad, when more than one cook is going: jumps
/// straight to another cook, keeping this one and every timer running. On
/// iPhone the same list is in the title's menu (CookingView).
struct CookSwitcher: View {
    @Environment(AppNav.self) private var nav

    var body: some View {
        Menu { CookSwitcherItems() } label: {
            // Not a Label: the toolbar would drop its title.
            HStack(spacing: 5) {
                Image(systemName: "rectangle.stack.fill")
                Text("\(nav.sessions.count) cooks").monospacedDigit()
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Theme.brandDeep)
            .padding(.horizontal, 4)
        }
        .accessibilityLabel("Switch cook — \(nav.sessions.count) in progress")
    }
}

/// Every cook in progress, for a menu: tap one to bring it to the front.
struct CookSwitcherItems: View {
    @Environment(AppNav.self) private var nav

    var body: some View {
        Section("Cooking now") {
            ForEach(nav.sessions) { cook in
                Button {
                    withAnimation { nav.bringToFront(cook) }
                } label: {
                    Label(cook.title, systemImage: cook === nav.session ? "checkmark" : "frying.pan")
                    Text(cook.progress)
                }
            }
        }
    }
}

/// The cooks in progress, kept across a relaunch for 12 hours as the web keeps
/// them: iOS ends a backgrounded app when it likes, and a roast shouldn't lose
/// its place to that. Each cook is stored as its recipe ids and where it's up
/// to; the recipes are read back from the local store, and a meal's schedule
/// is fetched again (it's frozen on the server, so it comes back the same).
enum SavedCooks {
    private static let key = "cooks"
    private static let staleAfter: TimeInterval = 12 * 60 * 60

    private struct Saved: Codable {
        var savedAt: Date
        var cooks: [Cook]
    }

    private struct Cook: Codable {
        struct Dish: Codable { var id: String; var scale: Double }
        var title: String?
        var groupId: String?
        var dishes: [Dish]
        var dishIndex: Int
        var steps: [String: Int]
        var used: [String]
        var scales: [String: Double]
        var finished: [String]
        var startedAt: Date
        var askedStart: Bool
        var position: String?
        var dishView: Bool
        var shiftRecipeId: String?
        var shiftMinutes: Int?
    }

    @MainActor
    static func save(_ sessions: [CookSession]) {
        guard !sessions.isEmpty else { UserDefaults.standard.removeObject(forKey: key); return }
        let cooks = sessions.map { s in
            Cook(title: s.request.title, groupId: s.request.groupId,
                 dishes: s.request.dishes.map { .init(id: $0.recipe.id, scale: $0.scale) },
                 dishIndex: s.dishIndex, steps: s.steps, used: Array(s.used), scales: s.scales,
                 finished: Array(s.finished), startedAt: s.startedAt, askedStart: s.askedStart,
                 position: s.position, dishView: s.dishView,
                 shiftRecipeId: s.startShift?.recipeId, shiftMinutes: s.startShift?.minutes)
        }
        if let data = try? JSONEncoder().encode(Saved(savedAt: .now, cooks: cooks)) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    /// The saved cooks whose recipes are still on the device; nil when there
    /// are none, or they're over 12 hours old.
    @MainActor
    static func load(from store: LocalStore) async -> [CookSession]? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONDecoder().decode(Saved.self, from: data),
              Date.now.timeIntervalSince(saved.savedAt) < staleAfter else {
            UserDefaults.standard.removeObject(forKey: key)
            return nil
        }
        let ids = Set(saved.cooks.flatMap { $0.dishes.map(\.id) })
        guard let recipes = try? await store.read({ r in
            try ids.reduce(into: [String: Recipe]()) { found, id in
                found[id] = try r.record(.recipes, id: id).flatMap(Recipe.init)
            }
        }) else { return nil }
        return saved.cooks.compactMap { cook in
            let dishes = cook.dishes.compactMap { d in recipes[d.id].map { CookDish(recipe: $0, scale: d.scale) } }
            guard dishes.count == cook.dishes.count, !dishes.isEmpty else { return nil }
            let session = CookSession(request: CookRequest(title: cook.title, groupId: cook.groupId, dishes: dishes))
            session.dishIndex = min(cook.dishIndex, dishes.count - 1)
            session.steps = cook.steps
            session.used = Set(cook.used)
            session.scales = cook.scales
            session.finished = Set(cook.finished)
            session.startedAt = cook.startedAt
            session.askedStart = cook.askedStart
            session.position = cook.position
            session.dishView = cook.dishView
            if let id = cook.shiftRecipeId, let minutes = cook.shiftMinutes { session.startShift = (id, minutes) }
            return session
        }
    }
}
