package dev.forma.mobile

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** The cancel hook can overlap inference, but cannot overlap handle disposal. */
internal class InferenceJob(val sequence: Long) {
  @Volatile var cancelled = false
    private set
  private var hook: (() -> Unit)? = null
  @Synchronized fun cancel() {
    cancelled = true
    try { hook?.invoke() } catch (_: Throwable) { /* The worker still drains the original operation. */ }
  }
  @Synchronized fun attach(cancel: () -> Unit) {
    hook = cancel
    if (cancelled) cancel()
  }
  @Synchronized fun detach() { hook = null }
  fun check() { if (cancelled) throw InferenceFailure("FORMA_INFERENCE_CANCELLED") }
}
/** A process lease also excludes another React instance. An uncertain release retains this lease. */
internal class InferenceProcessLease {
  private var owner: Any? = null
  @Synchronized fun claim(key: Any) {
    if (owner != null && owner !== key) throw InferenceFailure("FORMA_INFERENCE_BUSY")
    owner = key
  }
  @Synchronized fun release(key: Any) {
    if (owner !== key) throw InferenceFailure("FORMA_INFERENCE_OWNER")
    owner = null
  }
}
private val processInferenceLease = InferenceProcessLease()

/** SDK work has a dedicated serial worker, not the SQLite, import, bridge, or UI queue. */
internal class InferenceCoordinator(
  private val factory: () -> NativeInferenceBackend,
  private val processLease: InferenceProcessLease = processInferenceLease,
  private val worker: ExecutorService = Executors.newSingleThreadExecutor(),
) {
  private val lock = Any()
  private var owner: String? = null
  private var previousOwner: String? = null
  private var lastSequence = 0L
  private var earlyCancel: Long? = null
  private var active: InferenceJob? = null
  private var closing = false
  private var invalidated = false
  private var pressured = false
  private var closeFuture: CompletableFuture<Unit>? = null
  // Only the worker accesses the backend. Module construction and open do not load the SDK.
  private var backend: NativeInferenceBackend? = null
  private var resourceFailure = false

  fun open(id: String) = synchronized(lock) {
    if (!id.matches(Regex("[A-Za-z0-9-]{1,128}"))) throw InferenceFailure("FORMA_INFERENCE_OWNER")
    if (invalidated || pressured) throw InferenceFailure("FORMA_INFERENCE_CLOSED")
    if (owner == id && !closing) return@synchronized
    if (owner != null) throw InferenceFailure("FORMA_INFERENCE_BUSY")
    if (id == previousOwner) throw InferenceFailure("FORMA_INFERENCE_OWNER")
    processLease.claim(this)
    owner = id
    lastSequence = 0
    earlyCancel = null
    closing = false
    closeFuture = null
  }
  private fun owns(id: String) {
    if (owner != id) throw InferenceFailure("FORMA_INFERENCE_OWNER")
  }
  fun run(id: String, sequence: Long, request: InferenceRequest): CompletableFuture<NativeInferenceResult> = synchronized(lock) {
    owns(id)
    if (closing || invalidated) throw InferenceFailure("FORMA_INFERENCE_CLOSED")
    if (pressured) throw InferenceFailure("FORMA_INFERENCE_MEMORY")
    if (active != null) throw InferenceFailure("FORMA_INFERENCE_BUSY")
    if (sequence < 1 || sequence != lastSequence + 1) throw InferenceFailure("FORMA_INFERENCE_SEQUENCE")
    lastSequence = sequence
    val job = InferenceJob(sequence)
    if (earlyCancel == sequence) job.cancel()
    earlyCancel = null
    active = job
    val future = CompletableFuture<NativeInferenceResult>()
    try {
      worker.execute {
        var result: NativeInferenceResult? = null
        var failure: InferenceFailure? = null
        try {
          job.check()
          val runtime = backend ?: factory().also { backend = it }
          result = runtime.run(request, job)
          job.check()
        } catch (error: Throwable) {
          failure = if (job.cancelled) InferenceFailure("FORMA_INFERENCE_CANCELLED")
            else if (error is InferenceFailure) error else InferenceFailure("FORMA_INFERENCE_FAILURE")
        } finally {
          job.detach()
          synchronized(lock) { if (active === job) active = null }
        }
        if (failure != null) future.completeExceptionally(failure) else future.complete(result!!)
      }
    } catch (_: RejectedExecutionException) {
      active = null
      future.completeExceptionally(InferenceFailure("FORMA_INFERENCE_CLOSED"))
    }
    future
  }
  fun cancel(id: String, sequence: Long): Boolean = synchronized(lock) {
    owns(id)
    val job = active
    if (job?.sequence == sequence) { job.cancel(); return@synchronized true }
    if (!closing && !invalidated && sequence == lastSequence + 1) {
      earlyCancel = sequence
      return@synchronized true
    }
    false
  }
  /** Pressure rejects future work until process restart. It never reloads a model automatically. */
  fun pressure() = synchronized(lock) {
    if (owner == null || pressured || closing || invalidated) return@synchronized
    pressured = true
    active?.cancel()
    try { worker.execute {
      try { backend?.close(); backend = null }
      catch (_: Throwable) { resourceFailure = true }
    } }
    catch (_: RejectedExecutionException) { /* Invalidation already owns cleanup. */ }
  }
  fun close(id: String): CompletableFuture<Unit> = synchronized(lock) {
    if (owner == null && previousOwner == id) return@synchronized closeFuture ?: CompletableFuture.completedFuture(Unit)
    owns(id)
    closeFuture?.let { return@synchronized it }
    closing = true
    val future = CompletableFuture<Unit>()
    closeFuture = future
    active?.cancel()
    try {
      worker.execute {
        try {
          if (resourceFailure) throw InferenceFailure("FORMA_INFERENCE_RESOURCE")
          backend?.close()
          backend = null
          synchronized(lock) {
            processLease.release(this)
            previousOwner = owner
            owner = null
          }
          future.complete(Unit)
        } catch (_: Throwable) { future.completeExceptionally(InferenceFailure("FORMA_INFERENCE_RESOURCE")) }
      }
    } catch (_: RejectedExecutionException) { future.completeExceptionally(InferenceFailure("FORMA_INFERENCE_CLOSED")) }
    future
  }
  fun invalidate() {
    val drain = synchronized(lock) {
      if (invalidated) return
      invalidated = true
      owner?.let { close(it) }
    }
    if (drain == null) worker.shutdown() else drain.whenComplete { _, _ -> worker.shutdown() }
  }
}
