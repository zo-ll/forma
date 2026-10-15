package dev.forma.mobile

import com.google.ai.edge.litertlm.ActivationDataType
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import org.junit.Assert.*
import org.junit.Test

/** Actual pinned SDK objects, but no engine or JNI. This does not prove delegate execution. */
class LiteRtInferenceConfigTest {
  @Test fun embeddingExplicitlySelectsCpuFloat32AndMrl256Normalization() {
    val config = LiteRtInferenceConfig.embedding("private-model", "private-cache")
    assertEquals("private-model", config.modelPath)
    assertEquals("private-cache", config.cacheDir)
    assertTrue(config.backend is Backend.CPU)
    assertEquals(ActivationDataType.FLOAT32, config.activationDataType)
    assertEquals(2048, config.maxInputLength)
    assertNull(config.visionBackend); assertNull(config.audioBackend)
    val options = LiteRtInferenceConfig.embeddingOptions()
    assertEquals(256, options.outputSize)
    assertEquals(true, options.normalize)
    assertEquals(true, options.insertSpecialTokens)
  }
  @Test fun generatorExplicitlySelectsGpuFloat32AndA2048TokenContext() {
    val config = LiteRtInferenceConfig.generation("private-model", "private-cache")
    assertTrue(config.backend is Backend.GPU)
    assertEquals(ActivationDataType.FLOAT32, config.activationDataType)
    assertEquals(2048, config.maxNumTokens)
    assertNull(config.visionBackend); assertNull(config.audioBackend)
  }
  @Test fun freshConversationsDisableToolsHistoryThoughtAndSpeculation() {
    val config = LiteRtInferenceConfig.conversation("Synthetic instruction")
    assertEquals(256, config.maxOutputToken)
    assertEquals(false, config.automaticToolCalling)
    assertTrue(config.tools.isEmpty()); assertTrue(config.initialMessages.isEmpty())
    assertTrue(config.channels!!.isEmpty())
    assertEquals(false, config.thinkingConfig!!.enableThinking)
    assertEquals(false, config.enableSpeculativeDecoding)
    assertNull(config.chatTemplate)
    assertEquals("Synthetic instruction", (config.systemInstruction!!.contents.single() as Content.Text).text)
    assertEquals(1, config.samplerConfig!!.topK)
    assertEquals(0.0, config.samplerConfig!!.temperature, 0.0)
  }
}
