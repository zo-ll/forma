package dev.forma.mobile

import com.google.ai.edge.litertlm.ActivationDataType
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.EmbeddingEngine
import com.google.ai.edge.litertlm.EmbeddingEngineConfig
import com.google.ai.edge.litertlm.EmbeddingOptions
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.InputData
import com.google.ai.edge.litertlm.LogSeverity
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ThinkingConfig
import java.io.File

/** This factory runs only on the inference worker. No URI, model path, or SDK handle reaches JS. */
internal fun liteRtInferenceBackend(noBackupDirectory: File): NativeInferenceBackend = SerialModelRuntime { kind ->
  val artifact = ApprovedModels.find(kind.artifactId)
  val path = ModelArtifactStore(File(noBackupDirectory, "forma-models-v1"), recoverInterrupted = false)
    .verifiedFile(artifact).absolutePath
  val cache = File(noBackupDirectory, "forma-inference-cache-v1/" + artifact.sha256)
  if ((!cache.exists() && !cache.mkdirs()) || !cache.isDirectory) throw InferenceFailure("FORMA_INFERENCE_STORAGE")
  // Suppress native diagnostics that can contain input data or private paths.
  Engine.setNativeMinLogSeverity(LogSeverity.INFINITY)
  when (kind) {
    InferenceKind.EMBEDDING -> LiteRtEmbeddingModel(path, cache.absolutePath)
    InferenceKind.GENERATION -> LiteRtGenerationModel(path, cache.absolutePath)
  }
}
internal class LiteRtEmbeddingModel(path: String, cache: String) : LoadedInferenceModel {
  private val engine = EmbeddingEngine(EmbeddingEngineConfig(
    modelPath = path, backend = Backend.CPU(), cacheDir = cache, maxInputLength = 2048,
    activationDataType = ActivationDataType.FLOAT32,
  ))
  override fun initialize() { engine.initialize() }
  override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
    job.check()
    // The SDK performs MRL truncation and L2 normalization. The core validates the resulting norm.
    val vector = engine.computeEmbedding(listOf(InputData.Text(request.text)),
      EmbeddingOptions(normalize = true, outputSize = 256, insertSpecialTokens = true)).embedding
    job.check()
    if (vector.size != 256 || vector.any { !it.isFinite() }) throw InferenceFailure("FORMA_INFERENCE_OUTPUT")
    return NativeInferenceResult(InferenceKind.EMBEDDING, task = request.task, vector = vector.copyOf())
  }
  override fun close() { if (engine.isInitialized()) engine.close() }
}
internal class LiteRtGenerationModel(path: String, cache: String) : LoadedInferenceModel {
  private val engine = Engine(EngineConfig(
    modelPath = path, backend = Backend.GPU(), cacheDir = cache, maxNumTokens = 2048,
    activationDataType = ActivationDataType.FLOAT32,
  ))
  private var conversation: Conversation? = null
  private var poisoned = false
  override fun initialize() { engine.initialize() }
  override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
    if (poisoned || conversation != null) throw InferenceFailure("FORMA_INFERENCE_RESOURCE")
    job.check()
    // A new conversation owns each request. No history, tools, or automatic tool execution survives it.
    val current = engine.createConversation(ConversationConfig(
      systemInstruction = Contents.of(request.instruction!!), automaticToolCalling = false,
      channels = emptyList(), maxOutputToken = 256, thinkingConfig = ThinkingConfig(enableThinking = false),
      samplerConfig = SamplerConfig(topK = 1, topP = 1.0, temperature = 0.0), enableSpeculativeDecoding = false,
    ))
    conversation = current
    try {
      job.attach { current.cancelProcess() }
      job.check()
      val message = current.sendMessage(request.text)
      job.check()
      if (message.toolCalls.isNotEmpty() || message.contents.contents.any { it !is Content.Text })
        throw InferenceFailure("FORMA_INFERENCE_OUTPUT")
      val text = message.contents.contents.filterIsInstance<Content.Text>().joinToString("") { it.text }
      if (!validInferenceText(text, 65536)) throw InferenceFailure("FORMA_INFERENCE_OUTPUT")
      val max = request.maxOutputCharacters!!
      var end = minOf(text.length, max)
      if (end > 0 && text[end - 1].isHighSurrogate()) end--
      val bounded = text.substring(0, end)
      if (!validInferenceText(bounded, max)) throw InferenceFailure("FORMA_INFERENCE_OUTPUT")
      return NativeInferenceResult(InferenceKind.GENERATION, text = bounded)
    } finally {
      // A late cancel can no longer call the SDK after this point.
      job.detach()
      closeConversation()
    }
  }
  private fun closeConversation() {
    try { conversation?.close() } catch (_: Throwable) {
      poisoned = true
      throw InferenceFailure("FORMA_INFERENCE_RESOURCE")
    }
    conversation = null
  }
  override fun close() {
    if (poisoned) throw InferenceFailure("FORMA_INFERENCE_RESOURCE")
    closeConversation()
    if (engine.isInitialized()) engine.close()
  }
}
