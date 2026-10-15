package dev.forma.mobile

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.CompletableFuture

/** No record store access. Models are lazy, local, and private to one native owner. */
class FormaInferenceModule(context: ReactApplicationContext) : NativeFormaInferenceSpec(context), ComponentCallbacks2 {
  private val coordinator = InferenceCoordinator({ liteRtInferenceBackend(context.noBackupFilesDir) })
  init { context.registerComponentCallbacks(this) }
  override fun getName() = NAME
  override fun openInference(ownerId: String, promise: Promise) {
    try { coordinator.open(ownerId); promise.resolve(null) }
    catch (error: Throwable) { reject(promise, error) }
  }
  override fun runInference(ownerId: String, sequence: Double, request: String, promise: Promise) {
    try {
      settle(coordinator.run(ownerId, InferenceJson.sequence(sequence), InferenceJson.request(request)), promise) { InferenceJson.result(it) }
    } catch (error: Throwable) { reject(promise, error) }
  }
  override fun cancelInference(ownerId: String, sequence: Double, promise: Promise) {
    try { promise.resolve(coordinator.cancel(ownerId, InferenceJson.sequence(sequence))) }
    catch (error: Throwable) { reject(promise, error) }
  }
  override fun closeInference(ownerId: String, promise: Promise) {
    try { settle(coordinator.close(ownerId), promise) { null } }
    catch (error: Throwable) { reject(promise, error) }
  }
  private fun <T> settle(future: CompletableFuture<T>, promise: Promise, dto: (T) -> Any?) {
    future.whenComplete { value, error ->
      if (error != null) reject(promise, error)
      else try { promise.resolve(dto(value)) } catch (failure: Throwable) { reject(promise, failure) }
    }
  }
  private fun reject(promise: Promise, error: Throwable) {
    val code = (error as? InferenceFailure)?.code ?: "FORMA_INFERENCE_FAILURE"
    promise.reject(code, "The local inference operation failed.")
  }
  override fun onTrimMemory(level: Int) {
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW && level != ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) coordinator.pressure()
  }
  override fun onLowMemory() { coordinator.pressure() }
  override fun onConfigurationChanged(configuration: Configuration) {}
  override fun invalidate() {
    reactApplicationContext.unregisterComponentCallbacks(this)
    coordinator.invalidate()
    super.invalidate()
  }
  companion object { const val NAME = "FormaInference" }
}
