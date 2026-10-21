// Whether this device can run Dishes' AI itself: iOS 27 with Apple
// Intelligence on and its model downloaded. Settings → AI says so, and the
// router asks before every on-device job (AIRouter).

import Foundation
import FoundationModels

public enum DeviceAI {
    /// nil when the on-device model is ready; otherwise why not, for people.
    public static var unavailableReason: String? {
        guard #available(iOS 27, macOS 27, *) else { return "On-device AI needs iOS 27." }
        switch SystemLanguageModel.default.availability {
        case .available:
            guard SystemLanguageModel.default.supportsLocale() else { return "The on-device model doesn’t speak this device’s language." }
            return nil
        case .unavailable(.deviceNotEligible): return "This device can’t run Apple Intelligence."
        case .unavailable(.appleIntelligenceNotEnabled): return "Apple Intelligence is turned off in Settings."
        case .unavailable(.modelNotReady): return "Apple Intelligence is still downloading its model."
        case .unavailable: return "Apple Intelligence isn’t available right now."
        }
    }

    public static var isAvailable: Bool { unavailableReason == nil }

    /// The model's name and context window, for Settings → AI ("AFM 3 Core, 4,096 tokens").
    public static var modelDescription: String? {
        guard #available(iOS 27, macOS 27, *), isAvailable else { return nil }
        let model = SystemLanguageModel.default
        return "\(model.variant.displayName), \(model.contextSize.formatted()) tokens"
    }

    /// A model error in a sentence, for the log and the fallback's reason.
    public static func describe(_ error: any Error) -> String {
        guard #available(iOS 27, macOS 27, *), let error = error as? LanguageModelError else {
            return error.localizedDescription
        }
        switch error {
        case .contextSizeExceeded: return "Too long for the on-device model."
        case .guardrailViolation: return "The on-device model’s safety guardrails stopped it."
        case .refusal: return "The on-device model declined."
        case .timeout: return "The on-device model took too long."
        case .rateLimited: return "The on-device model is busy."
        case .unsupportedLanguageOrLocale: return "The on-device model doesn’t support this language."
        default: return "The on-device model couldn’t do it (\(error.localizedDescription))."
        }
    }
}
