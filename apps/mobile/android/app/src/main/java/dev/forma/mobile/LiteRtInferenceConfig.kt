package dev.forma.mobile

import com.google.ai.edge.litertlm.ActivationDataType
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.EmbeddingEngineConfig
import com.google.ai.edge.litertlm.EmbeddingOptions
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ThinkingConfig

/** These real SDK configuration objects can be tested without a native engine load. */
internal object LiteRtInferenceConfig {
  fun embedding(path: String, cache: String) = EmbeddingEngineConfig(
    modelPath = path, backend = Backend.CPU(), cacheDir = cache, maxInputLength = 2048,
    activationDataType = ActivationDataType.FLOAT32,
  )
  fun embeddingOptions() = EmbeddingOptions(normalize = true, outputSize = 256, insertSpecialTokens = true)
  fun generation(path: String, cache: String) = EngineConfig(
    modelPath = path, backend = Backend.GPU(), cacheDir = cache, maxNumTokens = 2048,
    activationDataType = ActivationDataType.FLOAT32,
  )
  fun conversation(instruction: String) = ConversationConfig(
    systemInstruction = Contents.of(instruction), automaticToolCalling = false,
    channels = emptyList(), maxOutputToken = 256, thinkingConfig = ThinkingConfig(enableThinking = false),
    samplerConfig = SamplerConfig(topK = 1, topP = 1.0, temperature = 0.0), enableSpeculativeDecoding = false,
  )
}
