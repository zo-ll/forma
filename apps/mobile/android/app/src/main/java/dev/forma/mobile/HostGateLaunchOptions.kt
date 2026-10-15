package dev.forma.mobile

/** Explicit diagnostics only. Ordinary launch intents do not enable inference. */
internal object HostGateLaunchOptions {
  private val legacyModes = setOf("fixtures", "seed", "verify")
  private val inferenceModes = setOf("inference-embedding", "inference-generation", "inference-sequential")
  private val legacyRunId = Regex("[A-Za-z0-9-]{1,128}")
  private val inferenceRunId = Regex("[A-Za-z0-9-]{1,80}")

  fun accepts(mode: String?, runId: String?): Boolean {
    if (runId == null) return false
    return when (mode) {
      in legacyModes -> legacyRunId.matches(runId)
      in inferenceModes -> inferenceRunId.matches(runId)
      else -> false
    }
  }
}
