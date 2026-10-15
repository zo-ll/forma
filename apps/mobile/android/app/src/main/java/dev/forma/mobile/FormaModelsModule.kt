package dev.forma.mobile

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import org.json.JSONArray
import org.json.JSONObject

/** File acquisition only. No SDK, network access, database, or model load occurs here. */
class FormaModelsModule(context: ReactApplicationContext) : NativeFormaModelsSpec(context), ActivityEventListener {
  override fun getName() = NAME
  private data class Request(val artifact: ModelArtifact, val id: String, val promise: Promise,
    val token: ModelImportToken = ModelImportToken(), var reading: Boolean = false)
  private val lock = Any()
  private val io = Executors.newSingleThreadExecutor()
  private var pending: Request? = null
  private var invalidated = false
  // The worker alone constructs the store. Initialization and stale-file cleanup stay off the UI thread.
  private val store by lazy { ModelArtifactStore(File(context.noBackupFilesDir, "forma-models-v1")) }
  init { context.addActivityEventListener(this) }

  override fun modelStatus(promise: Promise) {
    synchronized(lock) {
      if (invalidated) { promise.reject("FORMA_MODEL_CLOSED", "The model file module is closed."); return }
      try {
        io.execute {
          try {
            val result = JSONArray()
            for (artifact in ApprovedModels.all) {
              val status = store.status(artifact)
              result.put(JSONObject().put("artifactId", status.artifactId).put("state", status.state).put("byteLength", status.byteLength))
            }
            promise.resolve(result.toString())
          } catch (_: Exception) { promise.reject("FORMA_MODEL_STORAGE", "The model files cannot be checked.") }
        }
      } catch (_: RejectedExecutionException) { promise.reject("FORMA_MODEL_CLOSED", "The model file module is closed.") }
    }
  }

  override fun importModel(artifactId: String, requestId: String, promise: Promise) {
    val artifact = try { ApprovedModels.find(artifactId) } catch (_: ModelFileFailure) {
      promise.reject("FORMA_MODEL_ARTIFACT", "The model artifact is not approved."); return
    }
    if (!requestId.matches(Regex("[A-Za-z0-9-]{1,128}"))) {
      promise.reject("FORMA_MODEL_REQUEST", "The model import request is invalid."); return
    }
    val request = Request(artifact, requestId, promise)
    synchronized(lock) {
      if (invalidated) { promise.reject("FORMA_MODEL_CLOSED", "The model file module is closed."); return }
      if (pending != null) { promise.reject("FORMA_MODEL_BUSY", "Another model import is active."); return }
      pending = request
    }
    reactApplicationContext.runOnUiQueueThread {
      synchronized(lock) {
        if (pending !== request || invalidated) return@runOnUiQueueThread
        try {
          request.token.check()
          val activity = reactApplicationContext.currentActivity ?: throw ModelFileFailure("FORMA_MODEL_NO_ACTIVITY")
          val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
          activity.startActivityForResult(intent, MODEL_REQUEST)
        } catch (error: ModelFileFailure) { finish(request, error.code) }
        catch (_: Exception) { finish(request, "FORMA_MODEL_NO_PICKER") }
      }
    }
  }

  override fun cancelModelImport(requestId: String, promise: Promise) {
    synchronized(lock) {
      val request = pending
      promise.resolve(request != null && request.id == requestId && request.token.cancel())
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != MODEL_REQUEST) return
    val request = synchronized(lock) {
      val current = pending ?: return
      if (current.reading || invalidated) return
      current.reading = true
      current
    }
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) { finish(request, "FORMA_MODEL_CANCELLED"); return }
    if (uri.scheme != "content") { finish(request, "FORMA_MODEL_UNREADABLE"); return }
    try {
      io.execute {
        try {
          request.token.check()
          val storage = store
          val input = reactApplicationContext.contentResolver.openInputStream(uri) ?: throw ModelFileFailure("FORMA_MODEL_UNREADABLE")
          storage.import(request.artifact, input, request.token)
          finish(request, null)
        } catch (error: ModelFileFailure) { finish(request, error.code) }
        catch (_: Exception) { finish(request, "FORMA_MODEL_STORAGE") }
      }
    } catch (_: RejectedExecutionException) { finish(request, "FORMA_MODEL_CLOSED") }
  }

  /** A request settles once. Cancellation after the store commit cannot change success into cancellation. */
  private fun finish(request: Request, code: String?) = synchronized(lock) {
    if (pending !== request) return@synchronized
    pending = null
    if (code == null || code == "FORMA_MODEL_CANCELLED") {
      request.promise.resolve(JSONObject().put("status", if (code == null) "imported" else "cancelled")
        .put("artifactId", request.artifact.id).put("byteLength", if (code == null) request.artifact.bytes else 0L).toString())
    } else request.promise.reject(code, "The model file operation failed.")
  }

  override fun onNewIntent(intent: Intent) {}
  override fun invalidate() {
    synchronized(lock) {
      invalidated = true
      pending?.let { request ->
        request.token.cancel()
        request.promise.reject("FORMA_MODEL_CLOSED", "The model file module is closed.")
      }
      pending = null
      reactApplicationContext.removeActivityEventListener(this)
      io.shutdown()
    }
    super.invalidate()
  }
  companion object {
    const val NAME = "FormaModels"
    private const val MODEL_REQUEST = 41203
  }
}
