package dev.forma.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class InferenceJsonTest {
  private val query = """{"kind":"embedding","task":"query","text":"task: search query | text: Synthetic"}"""
  private fun invalid(run: () -> Unit) {
    try { run(); fail("Expected a native input error") } catch (error: InferenceFailure) { assertEquals("FORMA_INFERENCE_INPUT", error.code) }
  }
  @Test fun requestsHaveExactKeysAndNoModelPathOrBackendOverride() {
    assertEquals("query", InferenceJson.request(query).task)
    assertEquals("task: search query | text: Synthetic", InferenceJson.request(query).text)
    for (json in listOf("null", "[]", "{}", "invalid JSON", query + "{}", query.replace("Synthetic", ""),
      query.replace("query\",", "unknown\","), query.replace("\"text\":\"task: search query | text: Synthetic\"", "\"text\":123"),
      query.dropLast(1) + ",\"modelPath\":\"/private/model\"}", "x".repeat(110001))) invalid { InferenceJson.request(json) }
  }
  @Test fun generationRejectsUnboundedOrCoercedNumericLimits() {
    val base = JSONObject().put("kind", "generation").put("text", "Saved synthetic source")
      .put("instruction", "Summarize").put("maxOutputCharacters", 64)
    assertEquals(64, InferenceJson.request(base.toString()).maxOutputCharacters)
    for (limit in listOf<Any>(0, -1, 4097, 1.5, "64", true, 4294967360L)) {
      invalid { InferenceJson.request(JSONObject(base.toString()).put("maxOutputCharacters", limit).toString()) }
    }
  }
  @Test fun bridgeSequencesRequirePositiveSafeIntegers() {
    assertEquals(1L, InferenceJson.sequence(1.0))
    for (number in listOf(0.0, -1.0, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992.0)) {
      try { InferenceJson.sequence(number); fail("Expected sequence rejection") }
      catch (error: InferenceFailure) { assertEquals("FORMA_INFERENCE_SEQUENCE", error.code) }
    }
  }
  @Test fun float32ComponentsSurviveJsonAsExactDoubleValues() {
    val values = FloatArray(256); values[0] = 1f / 3f
    val json = JSONObject(InferenceJson.result(NativeInferenceResult(InferenceKind.EMBEDDING, task = "query", vector = values)))
    assertEquals(values[0].toDouble(), json.getJSONArray("vector").getDouble(0), 0.0)
    assertEquals("cpu", json.getString("backend"))
    assertEquals("float32", json.getString("runtimePrecision"))
    assertFalse(json.has("effectiveDelegate")); assertFalse(json.has("modelPath"))
    assertEquals(ApprovedModels.find("embeddinggemma-2-text-270m").sha256, json.getString("sha256"))
  }
}
