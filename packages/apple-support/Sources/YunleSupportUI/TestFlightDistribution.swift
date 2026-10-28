import Foundation
import StoreKit

/// Identify TestFlight without treating debug, simulator or locally signed builds as beta installs.
public enum TestFlightDistribution {
    public static func shouldShowGuide(environment: AppStore.Environment?, receiptName: String?,
                                       hasEmbeddedProfile: Bool = false, isDebug: Bool = false,
                                       isSimulator: Bool = false) -> Bool {
        guard !isDebug, !isSimulator, !hasEmbeddedProfile else { return false }
        if let environment { return environment == .sandbox }
        return receiptName == "sandboxReceipt"
    }

    public static func current(bundle: Bundle = .main) async -> Bool {
        #if DEBUG || targetEnvironment(simulator)
        return false
        #else
        let hasEmbeddedProfile = bundle.url(forResource: "embedded", withExtension: "mobileprovision") != nil
        guard !hasEmbeddedProfile else { return false }
        let environment: AppStore.Environment?
        do {
            let result = try await AppTransaction.shared
            guard case .verified(let transaction) = result else { return false }
            environment = transaction.environment
        } catch {
            // Existing installs may still have a receipt when StoreKit cannot fetch the app transaction.
            environment = nil
        }
        return shouldShowGuide(environment: environment, receiptName: bundle.appStoreReceiptURL?.lastPathComponent,
                               hasEmbeddedProfile: hasEmbeddedProfile)
        #endif
    }
}
