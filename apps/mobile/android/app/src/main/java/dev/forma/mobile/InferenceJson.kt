package dev.forma.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

internal object InferenceJson {
  fun sequence(value: Double): Long {
    if (!value.isFinite() || value < 1 || value > 9007199254740991.0 || value != value.toLong().toDouble())
      throw InferenceFailure("FORMA_INFERENCE_SEQUENCE")
    return value.toLong()
  }
  fun request(serialized: String): InferenceRequest {
    try {
      if (serialized.length > 110000) throw InferenceFailure("FORMA_INFERENCE_INPUT")
      val tokener = JSONTokener(serialized)
      val json = tokener.nextValue() as? JSONObject ?: throw InferenceFailure("FORMA_INFERENCE_INPUT")
      if (tokener.nextClean() != '\u0000') throw InferenceFailure("FORMA_INFERENCE_INPUT")
      fun string(key: String) = json.get(key) as? String ?: throw InferenceFailure("FORMA_INFERENCE_INPUT")
      val kind = when (string("kind")) {
        "embedding" -> InferenceKind.EMBEDDING
        "generation" -> InferenceKind.GENERATION
        else -> throw InferenceFailure("FORMA_INFERENCE_INPUT")
      }
      val keys = if (kind == InferenceKind.EMBEDDING) setOf("kind", "task", "text")
        else setOf("kind", "text", "instruction", "maxOutputCharacters")
      if (json.keys().asSequence().toSet() != keys) throw InferenceFailure("FORMA_INFERENCE_INPUT")
      return if (kind == InferenceKind.EMBEDDING) InferenceRequest(kind, string("text"), task = string("task")) else {
        val maximum = json.get("maxOutputCharacters") as? Number ?: throw InferenceFailure("FORMA_INFERENCE_INPUT")
        if (maximum.toDouble() != maximum.toInt().toDouble()) throw InferenceFailure("FORMA_INFERENCE_INPUT")
        InferenceRequest(kind, string("text"), instruction = string("instruction"), maxOutputCharacters = maximum.toInt())
      }
    } catch (error: InferenceFailure) { throw error }
    catch (_: Exception) { throw InferenceFailure("FORMA_INFERENCE_INPUT") }
  }
  fun result(result: NativeInferenceResult): String {
    val artifact = ApprovedModels.find(result.kind.artifactId)
    val json = JSONObject().put("kind", if (result.kind == InferenceKind.EMBEDDING) "embedding" else "generation")
      .put("artifactId", artifact.id).put("sha256", artifact.sha256).put("backend", result.kind.backend)
      .put("runtimeVersion", "0.18.0").put("runtimePrecision", "float32")
    if (result.kind == InferenceKind.EMBEDDING) {
      val vector = result.vector ?: throw InferenceFailure("FORMA_INFERENCE_OUTPUT")
      if (vector.size != 256 || vector.any { !it.isFinite() }) throw InferenceFailure("FORMA_INFERENCE_OUTPUT")
      val values = JSONArray()
      vector.forEach { values.put(it.toDouble()) }
      json.put("task", result.task).put("vector", values)
    } else json.put("text", result.text ?: throw InferenceFailure("FORMA_INFERENCE_OUTPUT"))
    return json.toString()
  }
}
