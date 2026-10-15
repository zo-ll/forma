package dev.forma.mobile

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

class ModelArtifactStoreTest {
  private val bytes = "synthetic approved model".toByteArray()
  private fun artifact(data: ByteArray = bytes) = ModelArtifact("synthetic", data.size.toLong(),
    MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it.toInt() and 255) })
  private fun withStore(run: (File, ModelArtifactStore, ModelArtifact) -> Unit) {
    val directory = Files.createTempDirectory("forma-model-store-").toFile()
    try { run(directory, ModelArtifactStore(directory), artifact()) } finally { directory.deleteRecursively() }
  }
  private fun fails(code: String, run: () -> Unit) {
    try { run(); fail("Expected $code") } catch (error: ModelFileFailure) { assertEquals(code, error.code) }
  }
  private fun noTemporary(directory: File) { assertFalse(directory.listFiles()!!.any { it.name.startsWith(".import-") }) }

  @Test fun exactBytesSurviveReopenAndStatusRehashesTheFile() = withStore { dir, store, a ->
    assertEquals("missing", store.status(a).state)
    store.import(a, ByteArrayInputStream(bytes), ModelImportToken())
    assertEquals("verified", ModelArtifactStore(dir).status(a).state)
    val saved = dir.listFiles()!!.single()
    saved.writeBytes(ByteArray(bytes.size) { 1 })
    assertEquals("failed", store.status(a).state)
    noTemporary(dir)
  }
  @Test fun invalidArtifactsAndPartialReadsPreserveExistingBytes() = withStore { dir, store, a ->
    store.import(a, ByteArrayInputStream(bytes), ModelImportToken())
    for (bad in listOf(bytes.copyOf(bytes.size - 1), bytes + byteArrayOf(1), ByteArray(bytes.size) { 1 })) {
      fails("FORMA_MODEL_INTEGRITY") { store.import(a, ByteArrayInputStream(bad), ModelImportToken()) }
      assertEquals("verified", store.status(a).state)
      assertArrayEquals(bytes, dir.listFiles()!!.single().readBytes())
      noTemporary(dir)
    }
  }
  @Test fun providerFailureClosesTheStreamAndRemovesPartialFile() = withStore { dir, store, a ->
    var closed = false
    val stream = object : InputStream() {
      override fun read(): Int = throw java.io.IOException("private provider detail")
      override fun close() { closed = true }
    }
    try { store.import(a, stream, ModelImportToken()); fail("Expected provider failure") } catch (_: java.io.IOException) {}
    assertTrue(closed); noTemporary(dir); assertEquals("missing", store.status(a).state)
  }
  @Test fun cancelledCopyDoesNotPublishAndKeepsExistingModel() = withStore { dir, store, a ->
    store.import(a, ByteArrayInputStream(bytes), ModelImportToken())
    val token = ModelImportToken()
    val stream = object : ByteArrayInputStream(bytes) {
      override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        val count = super.read(buffer, offset, length)
        token.cancel()
        return count
      }
    }
    fails("FORMA_MODEL_CANCELLED") { store.import(a, stream, token) }
    assertEquals("verified", store.status(a).state); noTemporary(dir)
  }
  @Test fun lateCancelCannotRelabelCommittedImport() = withStore { dir, store, a ->
    val token = ModelImportToken()
    store.import(a, ByteArrayInputStream(bytes), token)
    assertFalse(token.cancel()); assertEquals("verified", store.status(a).state); noTemporary(dir)
  }
  @Test fun failedRenameKeepsThePriorFileAndCleansTemporaryBytes() = withStore { dir, store, a ->
    store.import(a, ByteArrayInputStream(bytes), ModelImportToken())
    val failing = ModelArtifactStore(dir) { _, _ -> false }
    fails("FORMA_MODEL_STORAGE") { failing.import(a, ByteArrayInputStream(bytes), ModelImportToken()) }
    assertEquals("verified", store.status(a).state); noTemporary(dir)
  }
  @Test fun reopenRemovesInterruptedTemporaryFilesButKeepsVerifiedModels() = withStore { dir, store, a ->
    store.import(a, ByteArrayInputStream(bytes), ModelImportToken())
    File(dir, ".import-interrupted.tmp").writeText("partial bytes")
    val reopened = ModelArtifactStore(dir)
    assertEquals("verified", reopened.status(a).state); noTemporary(dir)
  }
  @Test fun theCopyRejectsAnExtraByteWithoutAnUnboundedBuffer() = withStore { dir, store, _ ->
    val data = ByteArray(ModelArtifactStore.CHUNK_BYTES * 3 + 7) { (it % 251).toByte() }
    val a = artifact(data)
    val reads = mutableListOf<Int>()
    val stream = object : ByteArrayInputStream(data + byteArrayOf(1)) {
      override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        reads.add(length); return super.read(buffer, offset, length)
      }
    }
    fails("FORMA_MODEL_INTEGRITY") { store.import(a, stream, ModelImportToken()) }
    assertTrue(reads.all { it <= 65536 }); assertEquals("missing", store.status(a).state); noTemporary(dir)
  }
  @Test fun cancelAndCommitHaveOneDeterministicBoundary() {
    val token = ModelImportToken(); assertTrue(token.cancel())
    var published = false
    fails("FORMA_MODEL_CANCELLED") { token.commit { published = true } }
    assertFalse(published)
  }
  @Test fun cancelledBeforeCopyStillClosesTheProvider() = withStore { dir, store, a ->
    val token = ModelImportToken(); token.cancel(); var closed = false
    val stream = object : ByteArrayInputStream(bytes) { override fun close() { closed = true; super.close() } }
    fails("FORMA_MODEL_CANCELLED") { store.import(a, stream, token) }
    assertTrue(closed); noTemporary(dir); assertEquals("missing", store.status(a).state)
  }
  @Test fun cleanupFailureCannotClaimTheStoreIsReady() = withStore { dir, _, _ ->
    val blocked = File(dir, ".import-blocked.tmp"); assertTrue(blocked.mkdir())
    File(blocked, "child").writeText("blocked cleanup")
    fails("FORMA_MODEL_CLEANUP") { ModelArtifactStore(dir) }
  }
  @Test fun catalogRejectsUnapprovedIdentity() {
    fails("FORMA_MODEL_ARTIFACT") { ApprovedModels.find("../../private-records") }
    assertEquals(2, ApprovedModels.all.size)
  }
}
