package dev.forma.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.ByteArrayOutputStream
import java.io.FileOutputStream
import java.io.FilterOutputStream
import java.io.IOException
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

class FormaDeviceModule(context: ReactApplicationContext) : NativeFormaDeviceSpec(context), ActivityEventListener {
  override fun getName() = NAME
  override fun newId(): String = UUID.randomUUID().toString()
  override fun deviceTimeZone(): String = TimeZone.getDefault().id
  override fun isHostGate(): Boolean = BuildConfig.HOST_GATE
  private val preferences = context.getSharedPreferences("forma.preferences.v1", 0)
  override fun readPreferences(): String? = preferences.getString("value", null)
  override fun writePreferences(value: String): Boolean {
    require(value.length <= 4096) { "Preferences exceed the supported size." }
    return preferences.edit().putString("value", value).commit()
  }
  override fun readGateSnapshot(): String? {
    check(BuildConfig.HOST_GATE) { "Test snapshots require the isolated hostgate build." }
    return preferences.getString("gateSnapshot", null)
  }
  override fun writeGateSnapshot(value: String): Boolean {
    check(BuildConfig.HOST_GATE) { "Test snapshots require the isolated hostgate build." }
    require(value.length <= 65536) { "Test snapshot exceeds the supported size." }
    return preferences.edit().putString("gateSnapshot", value).commit()
  }

  // Archive files. The document URI stays in this module; JavaScript receives only text and counts.
  private sealed class Request(val promise: Promise) {
    class Save(promise: Promise, val text: String) : Request(promise)
    class Open(promise: Promise, val maxBytes: Int) : Request(promise)
  }
  private class Coded(val code: String, message: String) : Exception(message)

  private val io = Executors.newSingleThreadExecutor()
  private var pending: Request? = null

  init { context.addActivityEventListener(this) }

  override fun saveArchive(text: String, suggestedName: String, promise: Promise) {
    val name = suggestedName.takeIf { it.matches(Regex("[A-Za-z0-9._-]{1,128}")) } ?: "forma-archive.json"
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, name)
    launch(Request.Save(promise, text), intent, SAVE_REQUEST)
  }

  override fun openArchive(maxBytes: Double, promise: Promise) {
    // The native limit is the upper bound. JavaScript cannot raise it.
    if (maxBytes.isNaN() || maxBytes < 1 || maxBytes > MAX_ARCHIVE_BYTES || maxBytes != Math.floor(maxBytes)) {
      promise.reject("FORMA_ARCHIVE_LIMIT", "The requested size limit is not supported.")
      return
    }
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
    launch(Request.Open(promise, maxBytes.toInt()), intent, OPEN_REQUEST)
  }

  private fun launch(request: Request, intent: Intent, code: Int) {
    if (pending != null) {
      request.promise.reject("FORMA_ARCHIVE_BUSY", "Another file request is open.")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      request.promise.reject("FORMA_ARCHIVE_NO_ACTIVITY", "The app has no visible activity for the file picker.")
      return
    }
    pending = request
    try {
      activity.startActivityForResult(intent, code)
    } catch (cause: Exception) {
      pending = null
      request.promise.reject("FORMA_ARCHIVE_NO_PICKER", "The system file picker is not available.", cause)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != SAVE_REQUEST && requestCode != OPEN_REQUEST) return
    val request = pending ?: return
    pending = null
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      // Cancel changes no record. A provider can still keep an empty document that it made.
      request.promise.resolve(when (request) {
        is Request.Save -> saveResult("cancelled", 0, false)
        is Request.Open -> openResult("cancelled", null, 0)
      })
      return
    }
    io.execute {
      when (request) {
        is Request.Save -> request.promise.resolve(write(uri, request.text))
        is Request.Open -> try {
          request.promise.resolve(read(uri, request.maxBytes))
        } catch (cause: Coded) {
          request.promise.reject(cause.code, cause.message, cause)
        } catch (cause: Exception) {
          request.promise.reject("FORMA_ARCHIVE_UNREADABLE", "The file cannot be read.", cause)
        }
      }
    }
  }

  override fun onNewIntent(intent: Intent) {}

  override fun invalidate() {
    pending?.promise?.reject("FORMA_ARCHIVE_CANCELLED", "The app closed the file request.")
    pending = null
    io.shutdown()
    super.invalidate()
  }

  private fun write(uri: Uri, text: String): Any {
    var written = 0L
    try {
      val raw = reactApplicationContext.contentResolver.openOutputStream(uri, "wt") ?: throw IOException("No output stream.")
      raw.use { stream ->
        val counting = object : FilterOutputStream(stream) {
          override fun write(value: Int) { out.write(value); written += 1 }
          override fun write(bytes: ByteArray, offset: Int, length: Int) { out.write(bytes, offset, length); written += length }
        }
        // Encode in a stream: no second full-size byte array. Malformed text fails, not U+FFFD.
        val encoder = StandardCharsets.UTF_8.newEncoder()
          .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val writer = OutputStreamWriter(counting as OutputStream, encoder)
        writer.write(text)
        writer.flush()
        (stream as? FileOutputStream)?.fd?.sync()
      }
      return saveResult("saved", written, false)
    } catch (cause: Exception) {
      // Best effort. The caller reports a possible partial file when this fails.
      val removed = try { DocumentsContract.deleteDocument(reactApplicationContext.contentResolver, uri) } catch (_: Exception) { false }
      return saveResult("failed", written, removed)
    }
  }

  /** Count bytes while reading. Provider size metadata can be absent, false, or stale. */
  private fun read(uri: Uri, maxBytes: Int): Any {
    val input = reactApplicationContext.contentResolver.openInputStream(uri)
      ?: throw Coded("FORMA_ARCHIVE_UNREADABLE", "The file cannot be opened.")
    val buffer = ByteArrayOutputStream(minOf(maxBytes + 1, CHUNK_BYTES))
    input.use { stream ->
      val chunk = ByteArray(CHUNK_BYTES)
      while (true) {
        val count = stream.read(chunk, 0, minOf(chunk.size, maxBytes + 1 - buffer.size()))
        if (count < 0) break
        buffer.write(chunk, 0, count)
        if (buffer.size() > maxBytes) throw Coded("FORMA_ARCHIVE_TOO_LARGE", "The file is larger than $maxBytes bytes.")
      }
    }
    val decoder = StandardCharsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    val text = try {
      decoder.decode(ByteBuffer.wrap(buffer.toByteArray(), 0, buffer.size())).toString()
    } catch (cause: CharacterCodingException) {
      throw Coded("FORMA_ARCHIVE_UNREADABLE", "The file is not valid UTF-8 text.")
    }
    return openResult("opened", text, buffer.size())
  }

  private fun saveResult(status: String, byteLength: Long, partialFileRemoved: Boolean) = Arguments.createMap().apply {
    putString("status", status)
    putDouble("byteLength", byteLength.toDouble())
    putBoolean("partialFileRemoved", partialFileRemoved)
  }

  private fun openResult(status: String, text: String?, byteLength: Int) = Arguments.createMap().apply {
    putString("status", status)
    if (text == null) putNull("text") else putString("text", text)
    putDouble("byteLength", byteLength.toDouble())
  }

  companion object {
    const val NAME = "FormaDevice"
    private const val SAVE_REQUEST = 41201
    private const val OPEN_REQUEST = 41202
    private const val CHUNK_BYTES = 65536
    /** Equal to ARCHIVE_LIMITS.maxArchiveBytes in the core. */
    const val MAX_ARCHIVE_BYTES = 16_777_216
  }
}
