// Crash, hang and memory reports from the device (TODO_MOBILE.md, D6): iOS 27's
// MetricKit delivers them, a day or so later, and each goes to the web's
// Settings → Crash reports (POST /api/v1/client-error) with source "ios: …".
// What the app was doing at the time is labelled with StateReporting —
// browsing, planning, shopping, cooking or AI — so a report says "a 3 s hang
// while cooking", not just a stack.
//
//   Diagnostics.start(api: api)        // once, at launch
//   Diagnostics.entered(.cooking)      // as the screen changes
//
// iOS 26 has neither API, so there it does nothing. MetricKit doesn't deliver
// in the simulator.

import DishesCore
import Foundation
import MetricKit
import StateReporting

enum AppActivity: String {
    case browsing, planning, shopping, cooking, ai
}

enum Diagnostics {
    static let domain = "uk.collco.dishes.activity"
    /// Kept for as long as the app runs: reports stop if the manager goes.
    nonisolated(unsafe) private static var manager: AnyObject?

    @MainActor
    static func start(api: APIClient) {
        guard #available(iOS 27, *), manager == nil else { return }
        let metrics = MetricManager(enabledStateReportingDomains: [StateReportingDomain(rawValue: domain)])
        manager = metrics
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        Task.detached(priority: .utility) {
            for await report in metrics.diagnosticReports {
                try? await api.reportClientError(clientError(report, version: version))
            }
        }
    }

    /// What the app is doing now, for the next report's states.
    static func entered(_ activity: AppActivity) {
        guard #available(iOS 27, *) else { return }
        StateReporter<Never, Never>.reporter(for: domain).reportTransition(to: activity.rawValue)
    }

    @available(iOS 27, *)
    static func clientError(_ report: DiagnosticReport, version: String?) -> APIClient.ClientError {
        let seconds = { (m: Measurement<UnitDuration>) in String(format: "%.1f s", m.converted(to: .seconds).value) }
        let (kind, detail, tree): (String, String, CallStackTree?) = switch report.result {
        case .crash(let c):
            ("crash", [c.exceptionReason?.composedMessage, c.terminationReason?.description,
                       c.signal.map { "signal \($0)" }, c.exceptionType.map { "exception \($0)" }]
                .compactMap { $0 }.joined(separator: " · "), c.callStackTree)
        case .hang(let h): ("hang", seconds(h.hangDuration), h.callStackTree)
        case .cpuException(let c): ("cpu", "\(seconds(c.totalCPUTime)) of CPU in \(seconds(c.totalSampledTime))", c.callStackTree)
        case .diskWriteException(let d): ("disk writes", d.totalBytesWritten.formatted(), d.callStackTree)
        case .appLaunch(let l): ("slow launch", seconds(l.launchDuration), l.callStackTree)
        case .memoryException(let m): ("memory", "over the limit", m.callStackTree)
        @unknown default: ("report", "", nil)
        }
        let states = report.environment.states.filter { $0.domain == domain }.map { $0.label }
        let message = "iOS \(kind)" + (detail.isEmpty ? "" : ": \(detail)")
            + (states.isEmpty ? "" : " — while \(Array(Set(states)).sorted().joined(separator: ", "))")
        return APIClient.ClientError(message: message, stack: tree.map(stack), source: "ios: \(kind)",
                                     appVersion: version ?? report.environment.applicationVersion,
                                     url: "\(report.environment.deviceType) · iOS \(report.environment.osVersion)")
    }

    /// The thread the report blames, top frame first: "Dishes + 0x1a2b".
    @available(iOS 27, *)
    static func stack(_ tree: CallStackTree) -> String {
        guard let thread = tree.callStackThreads.first(where: { $0.threadAttributed == true }) ?? tree.callStackThreads.first else { return "" }
        var lines: [String] = []
        var frame = thread.rootFrames.first
        while let f = frame, lines.count < 40 {
            let name = f.binaryName(from: tree) ?? "?"
            lines.append("\(name) + 0x\(String(f.offsetIntoBinaryTextSegment ?? f.address ?? 0, radix: 16))")
            frame = f.subFrames.first
        }
        return lines.joined(separator: "\n")
    }
}
