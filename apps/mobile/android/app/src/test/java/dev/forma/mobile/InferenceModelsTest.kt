package dev.forma.mobile

import org.junit.Assert.*
import org.junit.Test

class InferenceModelsTest {
  private val query = InferenceRequest(InferenceKind.EMBEDDING, InferenceRequest.QUERY_PREFIX + "Query", task = "query")
  private val generation = InferenceRequest(InferenceKind.GENERATION, "Saved source", instruction = "Summarize", maxOutputCharacters = 64)
  private fun fails(code: String, run: () -> Unit) {
    try { run(); fail("Expected " + code) } catch (error: InferenceFailure) { assertEquals(code, error.code) }
  }
  @Test fun onlyOneModelCanRemainResidentAndSwitchClosesBeforeLoad() {
    val events = mutableListOf<String>()
    val runtime = SerialModelRuntime { kind ->
      events.add("create:$kind")
      object : LoadedInferenceModel {
        override fun initialize() { events.add("load:$kind") }
        override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
          events.add("run:$kind"); return NativeInferenceResult(kind)
        }
        override fun close() { events.add("close:$kind") }
      }
    }
    runtime.run(query, InferenceJob(1)); runtime.run(query, InferenceJob(2))
    runtime.run(generation, InferenceJob(3)); runtime.close(); runtime.close()
    assertEquals(listOf("create:EMBEDDING", "load:EMBEDDING", "run:EMBEDDING", "run:EMBEDDING", "close:EMBEDDING",
      "create:GENERATION", "load:GENERATION", "run:GENERATION", "close:GENERATION"), events)
  }
  @Test fun failedLoadReleasesThePartlyInitializedOwnerWithoutFallback() {
    var created = 0; var closed = 0
    val runtime = SerialModelRuntime {
      created++
      object : LoadedInferenceModel {
        override fun initialize() { throw InferenceFailure("FORMA_INFERENCE_FAILURE") }
        override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult = error("Unexpected call")
        override fun close() { closed++ }
      }
    }
    fails("FORMA_INFERENCE_FAILURE") { runtime.run(query, InferenceJob(1)) }
    runtime.close()
    assertEquals(1, created); assertEquals(1, closed)
  }
  @Test fun aFailedCloseRetainsTheHandleAndPreventsAnotherLoad() {
    var created = 0; var closes = 0
    val runtime = SerialModelRuntime { kind ->
      created++
      object : LoadedInferenceModel {
        override fun initialize() {}
        override fun run(request: InferenceRequest, job: InferenceJob) = NativeInferenceResult(kind)
        override fun close() { closes++; throw AssertionError("Unknown native release state") }
      }
    }
    runtime.run(query, InferenceJob(1))
    fails("FORMA_INFERENCE_RESOURCE") { runtime.run(generation, InferenceJob(2)) }
    fails("FORMA_INFERENCE_RESOURCE") { runtime.close() }
    assertEquals(1, created); assertEquals(1, closes)
  }
  @Test fun cancellationDuringVerificationDoesNotStartInitialization() {
    val job = InferenceJob(1)
    var initialized = false; var closed = false
    val runtime = SerialModelRuntime { kind ->
      job.cancel()
      object : LoadedInferenceModel {
        override fun initialize() { initialized = true }
        override fun run(request: InferenceRequest, job: InferenceJob) = NativeInferenceResult(kind)
        override fun close() { closed = true }
      }
    }
    fails("FORMA_INFERENCE_CANCELLED") { runtime.run(query, job) }
    assertFalse(initialized); assertTrue(closed)
  }
  @Test fun nativeValidationRequiresOneTaskPrefixAndValidBoundedUnicode() {
    assertEquals(query.text, InferenceRequest(InferenceKind.EMBEDDING, query.text, task = "query").text)
    for (text in listOf("unprefixed", InferenceRequest.QUERY_PREFIX, InferenceRequest.QUERY_PREFIX + "\u0000",
      InferenceRequest.QUERY_PREFIX + "\ud800", InferenceRequest.QUERY_PREFIX + "x".repeat(16384))) {
      fails("FORMA_INFERENCE_INPUT") { InferenceRequest(InferenceKind.EMBEDDING, text, task = "query") }
    }
    fails("FORMA_INFERENCE_INPUT") { InferenceRequest(InferenceKind.EMBEDDING, query.text, task = "document") }
    assertTrue(validInferenceText("café 💤", 8))
    assertFalse(validInferenceText("\udc00", 8))
    assertFalse(validInferenceText("\ud800x", 8))
    for (limit in listOf(0, 4097)) fails("FORMA_INFERENCE_INPUT") { generation.copy(maxOutputCharacters = limit) }
    fails("FORMA_INFERENCE_INPUT") { generation.copy(instruction = " ") }
    fails("FORMA_INFERENCE_INPUT") { generation.copy(task = "query") }
  }
}
