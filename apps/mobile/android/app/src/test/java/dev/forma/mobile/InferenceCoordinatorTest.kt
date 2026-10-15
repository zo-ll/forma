package dev.forma.mobile

import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class InferenceCoordinatorTest {
  private val query = InferenceRequest(InferenceKind.EMBEDDING, InferenceRequest.QUERY_PREFIX + "Synthetic query", task = "query")
  private fun <T> await(f: CompletableFuture<T>): T = f.get(5, TimeUnit.SECONDS)
  private fun latch(latch: CountDownLatch) { assertTrue("Worker did not reach the expected state", latch.await(5, TimeUnit.SECONDS)) }
  private fun fails(code: String, run: () -> Unit) {
    try { run(); fail("Expected " + code) } catch (error: Exception) {
      val failure = if (error is ExecutionException) error.cause else error
      assertTrue(failure is InferenceFailure)
      assertEquals(code, (failure as InferenceFailure).code)
    }
  }
  private open class FakeBackend : NativeInferenceBackend {
    var closed = 0
    var runs = 0
    override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
      runs++
      return NativeInferenceResult(request.kind, task = request.task, vector = FloatArray(256) { if (it == 0) 1f else 0f })
    }
    override fun close() { closed++ }
  }
  @Test fun openIsLazyAndLeaseExcludesOtherReactInstances() {
    val lease = InferenceProcessLease()
    val backend = FakeBackend()
    var created = 0
    val first = InferenceCoordinator({ created++; backend }, lease)
    val second = InferenceCoordinator({ FakeBackend() }, lease)
    try {
      first.open("owner-1"); first.open("owner-1")
      assertEquals(0, created)
      fails("FORMA_INFERENCE_BUSY") { second.open("owner-2") }
      await(first.run("owner-1", 1, query))
      assertEquals(1, created)
      await(first.close("owner-1"))
      assertEquals(1, backend.closed)
      second.open("owner-2")
      await(second.close("owner-2"))
    } finally { first.invalidate(); second.invalidate() }
  }
  @Test fun ownerAndSequenceChecksRejectReplaysWithoutDispatch() {
    val backend = FakeBackend()
    val owner = InferenceCoordinator({ backend }, InferenceProcessLease())
    try {
      owner.open("owner")
      fails("FORMA_INFERENCE_OWNER") { owner.run("other", 1, query) }
      fails("FORMA_INFERENCE_SEQUENCE") { owner.run("owner", 2, query) }
      await(owner.run("owner", 1, query))
      fails("FORMA_INFERENCE_SEQUENCE") { owner.run("owner", 1, query) }
      assertFalse(owner.cancel("owner", 1))
      assertEquals(1, backend.runs)
      await(owner.close("owner"))
    } finally { owner.invalidate() }
  }
  @Test fun earlyCancellationIsBoundedAndCannotCancelLaterWork() {
    val backend = FakeBackend()
    val owner = InferenceCoordinator({ backend }, InferenceProcessLease())
    try {
      owner.open("owner")
      assertFalse(owner.cancel("owner", 1000))
      assertTrue(owner.cancel("owner", 1))
      fails("FORMA_INFERENCE_CANCELLED") { await(owner.run("owner", 1, query)) }
      assertEquals(0, backend.runs)
      await(owner.run("owner", 2, query))
      assertFalse(owner.cancel("owner", 1))
      await(owner.close("owner"))
    } finally { owner.invalidate() }
  }
  @Test fun cancellationAndCloseRetainTheSlotUntilNativeActuallyStops() {
    val entered = CountDownLatch(1); val finish = CountDownLatch(1)
    val backend = object : FakeBackend() {
      override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
        entered.countDown(); latch(finish)
        return super.run(request, job)
      }
    }
    val owner = InferenceCoordinator({ backend }, InferenceProcessLease())
    try {
      owner.open("owner")
      val work = owner.run("owner", 1, query); latch(entered)
      assertTrue(owner.cancel("owner", 1))
      assertFalse(work.isDone)
      fails("FORMA_INFERENCE_BUSY") { owner.run("owner", 2, query) }
      val close = owner.close("owner")
      assertSame(close, owner.close("owner"))
      assertFalse(close.isDone)
      assertEquals(0, backend.closed)
      finish.countDown()
      fails("FORMA_INFERENCE_CANCELLED") { await(work) }
      await(close)
      assertEquals(1, backend.closed)
    } finally { finish.countDown(); owner.invalidate() }
  }
  @Test fun cancellationDuringLoadDoesNotStartModelExecution() {
    val entered = CountDownLatch(1); val finish = CountDownLatch(1)
    var runs = 0; var closed = 0
    val model = object : LoadedInferenceModel {
      override fun initialize() { entered.countDown(); latch(finish) }
      override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
        runs++; return NativeInferenceResult(request.kind)
      }
      override fun close() { closed++ }
    }
    val owner = InferenceCoordinator({ SerialModelRuntime { model } }, InferenceProcessLease())
    try {
      owner.open("owner")
      val work = owner.run("owner", 1, query); latch(entered)
      owner.cancel("owner", 1)
      val close = owner.close("owner")
      finish.countDown()
      fails("FORMA_INFERENCE_CANCELLED") { await(work) }
      await(close)
      assertEquals(0, runs); assertEquals(1, closed)
    } finally { finish.countDown(); owner.invalidate() }
  }
  @Test fun memoryPressureCancelsWorkAndUnloadsWithoutAutomaticReload() {
    val entered = CountDownLatch(1); val finish = CountDownLatch(1)
    val backend = object : FakeBackend() {
      override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
        entered.countDown(); latch(finish); return super.run(request, job)
      }
    }
    val owner = InferenceCoordinator({ backend }, InferenceProcessLease())
    try {
      owner.open("owner")
      val work = owner.run("owner", 1, query); latch(entered)
      owner.pressure()
      fails("FORMA_INFERENCE_MEMORY") { owner.run("owner", 2, query) }
      assertFalse(work.isDone)
      finish.countDown()
      fails("FORMA_INFERENCE_CANCELLED") { await(work) }
      await(owner.close("owner"))
      assertEquals(1, backend.closed)
      fails("FORMA_INFERENCE_CLOSED") { owner.open("new-owner") }
    } finally { finish.countDown(); owner.invalidate() }
  }
  @Test fun failedResourceReleaseQuarantinesTheProcessLease() {
    val lease = InferenceProcessLease()
    val backend = object : FakeBackend() { override fun close() { throw AssertionError("private SDK close failure") } }
    val first = InferenceCoordinator({ backend }, lease)
    val second = InferenceCoordinator({ FakeBackend() }, lease)
    try {
      first.open("owner-1"); await(first.run("owner-1", 1, query))
      fails("FORMA_INFERENCE_RESOURCE") { await(first.close("owner-1")) }
      fails("FORMA_INFERENCE_BUSY") { second.open("owner-2") }
      fails("FORMA_INFERENCE_CLOSED") { first.run("owner-1", 2, query) }
    } finally { first.invalidate(); second.invalidate() }
  }
  @Test fun invalidationDrainsAnActiveJobBeforeLeaseRelease() {
    val entered = CountDownLatch(1); val finish = CountDownLatch(1)
    val lease = InferenceProcessLease()
    val backend = object : FakeBackend() {
      override fun run(request: InferenceRequest, job: InferenceJob): NativeInferenceResult {
        entered.countDown(); latch(finish); return super.run(request, job)
      }
    }
    val first = InferenceCoordinator({ backend }, lease)
    val second = InferenceCoordinator({ FakeBackend() }, lease)
    try {
      first.open("owner-1")
      val work = first.run("owner-1", 1, query); latch(entered)
      first.invalidate()
      fails("FORMA_INFERENCE_BUSY") { second.open("owner-2") }
      fails("FORMA_INFERENCE_CLOSED") { first.open("owner-3") }
      finish.countDown()
      fails("FORMA_INFERENCE_CANCELLED") { await(work) }
      await(first.close("owner-1"))
      second.open("owner-2"); await(second.close("owner-2"))
      assertEquals(1, backend.closed)
    } finally { finish.countDown(); first.invalidate(); second.invalidate() }
  }
  @Test fun linkErrorsAreSanitizedAndDoNotBreakTheWorkerClose() {
    val owner = InferenceCoordinator({ throw UnsatisfiedLinkError("private path") }, InferenceProcessLease())
    try {
      owner.open("owner")
      fails("FORMA_INFERENCE_FAILURE") { await(owner.run("owner", 1, query)) }
      await(owner.close("owner"))
    } finally { owner.invalidate() }
  }
  @Test fun aSuccessfulCloseAllowsANewLeaseWithSequenceOne() {
    val backend = FakeBackend()
    val owner = InferenceCoordinator({ backend }, InferenceProcessLease())
    try {
      owner.open("owner-1"); await(owner.run("owner-1", 1, query)); await(owner.close("owner-1"))
      owner.open("owner-2"); await(owner.run("owner-2", 1, query))
      fails("FORMA_INFERENCE_OWNER") { owner.cancel("owner-1", 1) }
      await(owner.close("owner-2"))
      assertEquals(2, backend.runs)
    } finally { owner.invalidate() }
  }
  @Test fun detachedCancellationCannotTouchAClosedConversation() {
    val job = InferenceJob(1)
    var calls = 0
    job.attach { calls++ }
    job.cancel(); assertEquals(1, calls)
    job.detach(); job.cancel(); assertEquals(1, calls)
  }
}
