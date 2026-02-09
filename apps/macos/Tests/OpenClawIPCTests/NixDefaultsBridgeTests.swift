import Foundation
import Testing
@testable import OpenClaw

@Suite(.serialized)
struct NixDefaultsBridgeTests {
    @Test func nixModeResolvesFromStableSuiteForAppBundles() {
        let suite = UserDefaults(suiteName: nixDefaultsSuiteName)!
        let key = "openclaw.nixMode"
        let prev = suite.object(forKey: key)
        defer {
            if let prev { suite.set(prev, forKey: key) } else { suite.removeObject(forKey: key) }
        }

        suite.set(true, forKey: key)

        let standard = UserDefaults(suiteName: "NixDefaultsBridgeTests.\(UUID().uuidString)")!
        #expect(!standard.bool(forKey: key))

        let resolved = ProcessInfo.resolveNixMode(
            environment: [:],
            standard: standard,
            nixSuite: suite,
            isAppBundle: true)
        #expect(resolved)
    }

    @Test func nixModeIgnoresStableSuiteOutsideAppBundles() {
        let suite = UserDefaults(suiteName: nixDefaultsSuiteName)!
        let key = "openclaw.nixMode"
        let prev = suite.object(forKey: key)
        defer {
            if let prev { suite.set(prev, forKey: key) } else { suite.removeObject(forKey: key) }
        }

        suite.set(true, forKey: key)
        let standard = UserDefaults(suiteName: "NixDefaultsBridgeTests.\(UUID().uuidString)")!

        let resolved = ProcessInfo.resolveNixMode(
            environment: [:],
            standard: standard,
            nixSuite: suite,
            isAppBundle: false)
        #expect(!resolved)
    }
}
