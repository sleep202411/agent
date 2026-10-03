package expo.modules.fizztimelineexport

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MimeTypes
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import java.util.concurrent.CancellationException

/** Transformer and job ownership stay on the main looper; media preparation has one worker. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class FizzTimelineExportModule : Module() {
  private data class Job(val id: String, val ids: List<String>, val output: File,
    val preparation: TimelineExportPreparation, val promise: Promise,
    var transformer: Transformer? = null, var cancelled: Boolean = false)
  private var job: Job? = null
  private var destroyed = false
  private val outputs = mutableMapOf<String, File>()
  private val handler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("FizzTimelineExport")
    Events("progress")
    AsyncFunction("render") { id: String, shots: List<Map<String, Any>>, promise: Promise ->
      if (job != null || destroyed) {
        promise.reject("EXPORT_BUSY", "A timeline export is running or the encoder is closed.", null)
        return@AsyncFunction
      }
      try {
        UUID.fromString(id)
        require(shots.isNotEmpty()) { "No clips to export." }
        val captured = shots.map { it.toMap() }
        val ids = captured.map { it["id"] as String }
        require(ids.all { it.isNotBlank() } && ids.toSet().size == ids.size) { "Invalid clip identities." }
        val context = requireNotNull(appContext.reactContext) { "Application context unavailable." }
        val directory = File(context.cacheDir, "fizz-timeline-export")
        require(directory.isDirectory || directory.mkdirs()) { "Cannot create export directory." }
        val owned = Job(id, ids, File(directory, "${UUID.randomUUID()}.mp4"),
          TimelineExportPreparation(File(directory, "sources-${UUID.randomUUID()}")), promise)
        job = owned
        Thread({
          try {
            val items = owned.preparation.prepare(captured)
            handler.post {
              if (owned.cancelled || destroyed) fail(owned, CancellationException("Timeline export cancelled."))
              else if (job === owned) start(context, owned, items)
              else owned.preparation.directory.deleteRecursively()
            }
          } catch (error: Exception) {
            handler.post { fail(owned, if (owned.cancelled) CancellationException("Timeline export cancelled.") else error) }
          }
        }, "FizzTimelinePreparation").start()
      } catch (error: Exception) {
        val owned = job?.takeIf { it.id == id }
        if (owned != null) fail(owned, error)
        else promise.reject("EXPORT_FAILED", error.message ?: "Timeline encoding failed.", error)
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancel") { id: String -> cancel(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("release") { uri: String -> outputs.remove(uri)?.delete(); Unit }.runOnQueue(Queues.MAIN)
    OnDestroy {
      handler.post {
        destroyed = true
        job?.let { cancel(it.id) }
        outputs.values.forEach { it.delete() }
        outputs.clear()
      }
    }
  }

  private fun start(context: Context, owned: Job, items: List<EditedMediaItem>) {
    try {
      val composition = Composition.Builder(EditedMediaItemSequence.withAudioAndVideoFrom(items)).build()
      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, result: ExportResult) {
            if (job !== owned) return
            if (!owned.output.isFile || owned.output.length() <= 0) {
              fail(owned, IllegalStateException("The encoder returned an empty file."))
              return
            }
            job = null
            owned.preparation.directory.deleteRecursively()
            val uri = Uri.fromFile(owned.output).toString()
            outputs[uri] = owned.output
            owned.promise.resolve(mapOf("artifact" to mapOf("uri" to uri, "contentType" to "video/mp4", "size" to owned.output.length()), "completedClipIds" to owned.ids))
          }
          override fun onError(composition: Composition, result: ExportResult, exception: ExportException) {
            fail(owned, exception)
          }
        }).build()
      owned.transformer = transformer
      transformer.start(composition, owned.output.absolutePath)
      reportProgress(owned)
    } catch (error: Exception) { fail(owned, error) }
  }

  private fun fail(owned: Job, error: Exception) {
    if (job !== owned) return
    job = null
    owned.transformer?.cancel()
    owned.preparation.directory.deleteRecursively()
    owned.output.delete()
    val code = when {
      error is CancellationException -> "EXPORT_CANCELLED"
      error is TimelineExportPreparation.SourceFailure -> "EXPORT_SOURCE_FAILED"
      error is ExportException && isSourceFailure(error) -> "EXPORT_SOURCE_FAILED"
      else -> "EXPORT_FAILED"
    }
    owned.promise.reject(code, error.message ?: "Timeline encoding failed.", error)
  }

  // Keep device encoder, muxer, permission and unspecified failures fatal.
  private fun isSourceFailure(error: ExportException): Boolean = when (error.errorCode) {
    ExportException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    ExportException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
    ExportException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE,
    ExportException.ERROR_CODE_IO_BAD_HTTP_STATUS,
    ExportException.ERROR_CODE_IO_FILE_NOT_FOUND,
    ExportException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE,
    ExportException.ERROR_CODE_DECODING_FAILED,
    ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> true
    else -> false
  }

  private fun cancel(id: String) {
    val owned = job?.takeIf { it.id == id } ?: return
    owned.cancelled = true
    owned.preparation.cancel()
    // During preparation, keep the job until its worker stops touching the files.
    if (owned.transformer != null) fail(owned, CancellationException("Timeline export cancelled."))
  }

  private fun reportProgress(owned: Job) {
    if (job !== owned) return
    val transformer = owned.transformer ?: return
    val holder = ProgressHolder()
    if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
      sendEvent("progress", mapOf("id" to owned.id, "ratio" to holder.progress / 100.0))
    }
    handler.postDelayed({ reportProgress(owned) }, 250)
  }
}
