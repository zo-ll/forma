package expo.modules.noteembeddings

import android.net.Uri
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.EmbeddingCapability
import com.google.ai.edge.litertlm.EmbeddingEngine
import com.google.ai.edge.litertlm.EmbeddingEngineConfig
import com.google.ai.edge.litertlm.EmbeddingOptions
import com.google.ai.edge.litertlm.InputData
import com.google.ai.edge.litertlm.ModelInfo
import com.google.ai.edge.litertlm.Modality
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Android adapter for the LiteRT-LM EmbeddingEngine.
 *
 * The module runs every engine call on one worker thread. One thread gives
 * serialized access and keeps the UI thread free.
 *
 * The app does not fall back to CPU. A GPU load failure returns an error. The
 * app records the configured backend. The SDK does not report the active
 * delegate, so the module never claims that a backend is effective.
 */
class NoteEmbeddingsModule : Module() {
  private val work: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "note-embeddings-worker")
  }

  @Volatile private var engine: EmbeddingEngine? = null

  override fun definition() = ModuleDefinition {
    Name("NoteEmbeddings")

    Function("isModelLoaded") {
      engine?.isInitialized() == true
    }

    AsyncFunction("importModel") { sourceUri: String, fileName: String, promise: Promise ->
      work.execute {
        try {
          promise.resolve(importModelFile(sourceUri, fileName))
        } catch (error: Throwable) {
          promise.reject("ERR_MODEL_IMPORT", error.message ?: "Model import failed", error)
        }
      }
    }

    AsyncFunction("loadModel") { modelPath: String, backendName: String, promise: Promise ->
      work.execute {
        val startedAt = System.currentTimeMillis()
        try {
          closeEngineQuietly()
          val facts = readModelFacts(modelPath)
          val config = EmbeddingEngineConfig(modelPath = modelPath, backend = backendFor(backendName))
          val newEngine = EmbeddingEngine(config)
          newEngine.initialize()
          engine = newEngine
          promise.resolve(
            mapOf<String, Any?>(
              "modelPath" to modelPath,
              "configuredBackend" to backendName,
              "effectiveBackend" to EFFECTIVE_BACKEND_NOTE,
              "modelType" to facts.modelType,
              "declaredDimension" to facts.declaredDimension,
              "supportedTextBackends" to facts.supportedTextBackends,
              "loadTimeMs" to (System.currentTimeMillis() - startedAt),
            )
          )
        } catch (error: Throwable) {
          closeEngineQuietly()
          promise.reject("ERR_MODEL_LOAD", error.message ?: "Model load failed", error)
        }
      }
    }

    AsyncFunction("computeEmbedding") { text: String, promise: Promise ->
      work.execute {
        val current = engine
        if (current == null) {
          promise.reject("ERR_MODEL_NOT_LOADED", "No model is loaded.", null)
          return@execute
        }
        try {
          val response = current.computeEmbedding(
            listOf(InputData.Text(text)),
            EmbeddingOptions(normalize = false),
          )
          promise.resolve(response.embedding.map { value -> value.toDouble() })
        } catch (error: Throwable) {
          promise.reject("ERR_INFERENCE", error.message ?: "Inference failed", error)
        }
      }
    }

    AsyncFunction("unloadModel") { promise: Promise ->
      work.execute {
        closeEngineQuietly()
        promise.resolve(null)
      }
    }
  }

  private fun closeEngineQuietly() {
    val current = engine
    engine = null
    if (current != null) {
      try {
        current.close()
      } catch (_: Throwable) {
        // The engine is already gone. Release is best effort.
      }
    }
  }

  private fun backendFor(name: String): Backend = when (name) {
    "CPU" -> Backend.CPU()
    "GPU" -> Backend.GPU()
    else -> throw IllegalArgumentException("Unsupported backend: $name")
  }

  private data class ModelFacts(
    val modelType: String,
    val declaredDimension: Int?,
    val supportedTextBackends: List<String>,
  )

  private fun readModelFacts(modelPath: String): ModelFacts {
    return try {
      ModelInfo.from(modelPath).use { info ->
        val capability = info as? EmbeddingCapability
        val backends = try {
          info.supportedBackends(Modality.TEXT).map { backend -> backend.name }
        } catch (_: Throwable) {
          emptyList()
        }
        ModelFacts(info.modelType.name, capability?.dimension(), backends)
      }
    } catch (_: Throwable) {
      ModelFacts("UNKNOWN", null, emptyList())
    }
  }

  private fun importModelFile(sourceUri: String, fileName: String): Map<String, Any?> {
    val context = appContext.reactContext
      ?: throw IllegalStateException("The Android context is not available.")
    val safeName = sanitizeFileName(fileName)
    require(safeName.endsWith(".litertlm")) {
      "The selected file must have the .litertlm extension."
    }
    val modelsDir = File(context.filesDir, "models").apply { mkdirs() }
    val target = File(modelsDir, safeName)
    val partial = File(modelsDir, "$safeName.part")
    val uri = Uri.parse(sourceUri)
    try {
      context.contentResolver.openInputStream(uri).use { input ->
        requireNotNull(input) { "The app cannot read the selected file." }
        partial.outputStream().use { output -> input.copyTo(output) }
      }
      if (target.exists() && !target.delete()) {
        throw IllegalStateException("The app cannot replace the existing model file.")
      }
      if (!partial.renameTo(target)) {
        partial.copyTo(target, overwrite = true)
      }
      return mapOf<String, Any?>(
        "path" to target.absolutePath,
        "fileName" to target.name,
        "sizeBytes" to target.length(),
      )
    } finally {
      // Remove an incomplete file after every failed import. File.delete() does
      // not throw, so the original error is not masked. A successful rename
      // removes the partial file, so this call does nothing.
      if (partial.exists()) {
        partial.delete()
      }
    }
  }

  private fun sanitizeFileName(fileName: String): String {
    val base = fileName.substringAfterLast('/').substringAfterLast('\\').trim()
    val cleaned = base.replace(Regex("[^A-Za-z0-9._-]"), "_")
    return cleaned.ifEmpty { "model.litertlm" }
  }

  companion object {
    private const val EFFECTIVE_BACKEND_NOTE =
      "Not reported by the SDK. The app records the configured backend only."
  }
}
