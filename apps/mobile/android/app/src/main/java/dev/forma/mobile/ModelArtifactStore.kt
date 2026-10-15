package dev.forma.mobile

import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest

internal data class ModelArtifact(val id: String, val bytes: Long, val sha256: String)
internal object ApprovedModels {
  val all = listOf(
    ModelArtifact("embeddinggemma-2-text-270m", 164626432L, "2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb"),
    ModelArtifact("gemma-4-e2b-it-gpu", 2008432640L, "a53a59001894c58e6bdb5b9b227709f91a2e3e556baa7d85acf9c55402ba5cf5"),
  )
  fun find(id: String) = all.find { it.id == id } ?: throw ModelFileFailure("FORMA_MODEL_ARTIFACT")
}
internal class ModelFileFailure(val code: String) : Exception(code)
internal data class ModelFileState(val artifactId: String, val state: String, val byteLength: Long)

/** Cancellation and the final rename share one linearization lock. */
internal class ModelImportToken {
  private var cancelled = false
  private var committed = false
  @Synchronized fun cancel(): Boolean {
    if (committed) return false
    cancelled = true
    return true
  }
  @Synchronized fun check() { if (cancelled) throw ModelFileFailure("FORMA_MODEL_CANCELLED") }
  @Synchronized fun commit(publish: () -> Unit) {
    check()
    publish()
    committed = true
  }
}

/** Only the native module supplies the private no-backup directory and approved artifact. */
internal class ModelArtifactStore(
  private val directory: File,
  private val rename: (File, File) -> Boolean = { source, target -> source.renameTo(target) },
) {
  init {
    if ((!directory.exists() && !directory.mkdirs()) || !directory.isDirectory) throw ModelFileFailure("FORMA_MODEL_STORAGE")
    val files = directory.listFiles() ?: throw ModelFileFailure("FORMA_MODEL_STORAGE")
    for (file in files) {
      if (file.name.startsWith(".import-") && !file.delete()) throw ModelFileFailure("FORMA_MODEL_CLEANUP")
    }
  }
  private fun destination(a: ModelArtifact): File {
    if (!a.sha256.matches(Regex("[a-f0-9]{64}")) || a.bytes < 1) throw ModelFileFailure("FORMA_MODEL_ARTIFACT")
    return File(directory, a.sha256 + ".litertlm")
  }
  private fun digest() = MessageDigest.getInstance("SHA-256")
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }

  fun status(a: ModelArtifact): ModelFileState {
    val file = destination(a)
    if (!file.exists()) return ModelFileState(a.id, "missing", 0)
    val length = file.length()
    if (!file.isFile || length != a.bytes) return ModelFileState(a.id, "failed", length)
    return try {
      val hash = digest()
      file.inputStream().use { input ->
        val buffer = ByteArray(CHUNK_BYTES)
        var total = 0L
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          if (count == 0 || count > a.bytes - total) throw ModelFileFailure("FORMA_MODEL_INTEGRITY")
          total += count
          hash.update(buffer, 0, count)
        }
        if (total != a.bytes || hex(hash.digest()) != a.sha256) throw ModelFileFailure("FORMA_MODEL_INTEGRITY")
      }
      ModelFileState(a.id, "verified", length)
    } catch (_: Exception) { ModelFileState(a.id, "failed", length) }
  }

  fun import(a: ModelArtifact, input: InputStream, token: ModelImportToken) {
    // use closes the provider even when destination validation or temporary-file creation fails.
    input.use { source ->
      val target = destination(a)
      token.check()
      val temporary = File.createTempFile(".import-", ".tmp", directory)
      try {
        val hash = digest()
        var total = 0L
        FileOutputStream(temporary).use { output ->
          val buffer = ByteArray(CHUNK_BYTES)
          while (true) {
            token.check()
            val count = source.read(buffer)
            if (count < 0) break
            token.check()
            if (count == 0 || count > a.bytes - total) throw ModelFileFailure("FORMA_MODEL_INTEGRITY")
            output.write(buffer, 0, count)
            hash.update(buffer, 0, count)
            total += count
          }
          if (total != a.bytes || hex(hash.digest()) != a.sha256) throw ModelFileFailure("FORMA_MODEL_INTEGRITY")
          token.check()
          output.flush()
          output.fd.sync()
        }
        token.commit {
          if (!rename(temporary, target)) throw ModelFileFailure("FORMA_MODEL_STORAGE")
        }
      } finally {
        if (temporary.exists() && !temporary.delete()) throw ModelFileFailure("FORMA_MODEL_CLEANUP")
      }
    }
  }
  companion object { const val CHUNK_BYTES = 65536 }
}
