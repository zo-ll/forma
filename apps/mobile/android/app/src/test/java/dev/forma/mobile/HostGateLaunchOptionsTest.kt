package dev.forma.mobile

import org.junit.Assert.*
import org.junit.Test

class HostGateLaunchOptionsTest {
  @Test fun eachReadOnlyInferenceModeRequiresTheExactAsciiRunIdLimit() {
    for (mode in listOf("inference-embedding", "inference-generation", "inference-sequential")) {
      assertTrue(HostGateLaunchOptions.accepts(mode, "a"))
      assertTrue(HostGateLaunchOptions.accepts(mode, "Az09-"))
      assertTrue(HostGateLaunchOptions.accepts(mode, "a".repeat(80)))
      for (id in listOf(null, "", "a".repeat(81), "has_space", "has space", "nonascii-é", "line\n")) {
        assertFalse("$mode must reject $id", HostGateLaunchOptions.accepts(mode, id))
      }
    }
  }

  @Test fun legacyGateModesRetainTheirPreviousRunIdLimit() {
    for (mode in listOf("fixtures", "seed", "verify")) {
      assertTrue(HostGateLaunchOptions.accepts(mode, "legacy-1"))
      assertTrue(HostGateLaunchOptions.accepts(mode, "a".repeat(128)))
      assertFalse(HostGateLaunchOptions.accepts(mode, "a".repeat(129)))
      assertFalse(HostGateLaunchOptions.accepts(mode, null))
      assertFalse(HostGateLaunchOptions.accepts(mode, "not valid"))
    }
  }

  @Test fun absentNormalAndUnknownModesNeverForwardLaunchOptions() {
    for (mode in listOf(null, "", "normal", "inference", "inference-embedding-extra", "INFERENCE-EMBEDDING")) {
      assertFalse(HostGateLaunchOptions.accepts(mode, "valid-id"))
    }
  }
}
