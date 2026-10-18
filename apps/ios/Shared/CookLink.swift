// Where a tap on a Live Activity takes you: the app's own URL scheme, so
// DishesWidgets can set it as the activity's widgetURL and the app can read
// it back in onOpenURL (CookLinkHandler).
//
//   dishes://cook?dish=<id>&dish=<id>&group=<id>&recipe=<id>&step=4&cue=<id>
//
//   dish     the cook's recipes; with group, the planned meal it is — a cook
//            is matched the way CookSession.isCooking matches one
//   recipe   the dish on screen, and step its step (1-based, as shown)
//   cue      where a scheduled meal's sequence is up to
//
// The meal-schedule activity sends only group=<id>: that meal's cook, if one's going.

import Foundation

struct CookLink: Hashable {
    var groupId: String?
    var recipeIds: [String] = []
    /// The dish the activity shows, and its step (0-based here).
    var recipeId: String?
    var stepIndex: Int?
    /// The place in a scheduled meal's sequence, when walking it as one.
    var cue: String?

    var url: URL {
        var c = URLComponents()
        c.scheme = "dishes"
        c.host = "cook"
        var items = recipeIds.map { URLQueryItem(name: "dish", value: $0) }
        if let groupId { items.append(.init(name: "group", value: groupId)) }
        if let recipeId { items.append(.init(name: "recipe", value: recipeId)) }
        if let stepIndex { items.append(.init(name: "step", value: String(stepIndex + 1))) }
        if let cue { items.append(.init(name: "cue", value: cue)) }
        c.queryItems = items
        return c.url!
    }

    init(groupId: String? = nil, recipeIds: [String] = [], recipeId: String? = nil, stepIndex: Int? = nil, cue: String? = nil) {
        self.groupId = groupId
        self.recipeIds = recipeIds
        self.recipeId = recipeId
        self.stepIndex = stepIndex
        self.cue = cue
    }

    /// nil for any other URL (the sign-in callback uses the same scheme).
    init?(url: URL) {
        guard url.scheme == "dishes", url.host == "cook",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 } }
        recipeIds = items.filter { $0.name == "dish" }.compactMap(\.value).filter { !$0.isEmpty }
        groupId = value("group")
        recipeId = value("recipe")
        stepIndex = value("step").flatMap(Int.init).map { max($0 - 1, 0) }
        cue = value("cue")
        guard groupId != nil || recipeId != nil || !recipeIds.isEmpty else { return nil }
    }
}
