package dev.forma.mobile

internal class InferenceFailure(val code: String) : Exception(code)
internal enum class InferenceKind(val artifactId: String, val backend: String) {
  EMBEDDING("embeddinggemma-2-text-270m", "cpu"), GENERATION("gemma-4-e2b-it-gpu", "gpu")
}
internal fun validInferenceText(text: String, maximum: Int): Boolean {
  if (text.isBlank() || text.length > maximum || text.contains('\u0000')) return false
  var i = 0
  while (i < text.length) {
    val c = text[i++]
    if (c.isHighSurrogate()) {
      if (i == text.length || !text[i++].isLowSurrogate()) return false
    } else if (c.isLowSurrogate()) return false
  }
  return true
}
internal data class InferenceRequest(
  val kind: InferenceKind, val text: String, val task: String? = null,
  val instruction: String? = null, val maxOutputCharacters: Int? = null,
) {
  init {
    if (!validInferenceText(text, 16384)) throw InferenceFailure("FORMA_INFERENCE_INPUT")
    if (kind == InferenceKind.EMBEDDING) {
      val prefix = when (task) {
        "query" -> QUERY_PREFIX
        "document" -> DOCUMENT_PREFIX
        else -> throw InferenceFailure("FORMA_INFERENCE_INPUT")
      }
      if (!text.startsWith(prefix) || text.substring(prefix.length).isBlank() || instruction != null || maxOutputCharacters != null)
        throw InferenceFailure("FORMA_INFERENCE_INPUT")
    } else if (task != null || instruction == null || !validInferenceText(instruction, 1024)
      || maxOutputCharacters == null || maxOutputCharacters !in 1..4096) throw InferenceFailure("FORMA_INFERENCE_INPUT")
  }
  companion object {
    const val QUERY_PREFIX = "task: search query | text: "
    const val DOCUMENT_PREFIX = "task: search result | text: "
  }
}
internal data class NativeInferenceResult(val kind: InferenceKind, val task: String? = null,
  val vector: FloatArray? = null, val text: String? = null)

internal interface LoadedInferenceModel : AutoCloseable {
  fun initialize()
  fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult
}
internal interface NativeInferenceBackend : AutoCloseable {
  fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult
}
/** The worker alone accesses this owner. It never retains two model handles. */
internal class SerialModelRuntime(private val load: (InferenceKind) -> LoadedInferenceModel) : NativeInferenceBackend {
  private var loaded: LoadedInferenceModel? = null
  private var kind: InferenceKind? = null
  private var poisoned = false
  override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
    if (poisoned) throw InferenceFailure("FORMA_INFERENCE_RESOURCE")
    job.check()
    if (kind != request.kind) {
      close()
      job.check()
      val model = load(request.kind)
      loaded = model
      kind = request.kind
      try { job.check(); model.initialize() } catch (error: Throwable) { close(); throw error }
    }
    job.check()
    return loaded!!.run(request, job)
  }
  override fun close() {
    if (poisoned) throw InferenceFailure("FORMA_INFERENCE_RESOURCE")
    try { loaded?.close() } catch (_: Throwable) {
      // Do not lose a handle or reuse an uncertain native engine after a failed release.
      poisoned = true
      throw InferenceFailure("FORMA_INFERENCE_RESOURCE")
    }
    loaded = null
    kind = null
  }
}
