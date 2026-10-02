package expo.modules.fizztimelineexport

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
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

/** All Transformer calls and ownership changes run on the main looper. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class FizzTimelineExportModule : Module() {
  private data class Job(val id: String, val transformer: Transformer, val output: File, val promise: Promise)
  private var job: Job? = null
  private val outputs = mutableMapOf<String, File>()
  private val handler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("FizzTimelineExport")
    Events("progress")
    AsyncFunction("render") { id: String, shots: List<Map<String, Any>>, promise: Promise ->
      if (job != null) {
        promise.reject("EXPORT_BUSY", "A timeline export is already running.", null)
        return@AsyncFunction
      }
      var output: File? = null
      try {
        UUID.fromString(id)
        require(shots.isNotEmpty()) { "No clips to export." }
        val ids = shots.map { it["id"] as String }
        require(ids.all { it.isNotBlank() } && ids.toSet().size == ids.size) { "Invalid clip identities." }
        val items = shots.map { shot ->
          val uri = Uri.parse(shot["url"] as String)
          val milliseconds = (shot["durationMs"] as Number).toDouble()
          require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null) { "Invalid media URL." }
          require(milliseconds.isFinite() && milliseconds > 0 && milliseconds <= Long.MAX_VALUE.toDouble() && milliseconds % 1.0 == 0.0) { "Invalid clip duration." }
          val media = MediaItem.Builder().setUri(uri)
            .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setEndPositionMs(milliseconds.toLong()).build())
            .build()
          EditedMediaItem.Builder(media).build()
        }
        val context = requireNotNull(appContext.reactContext) { "Application context unavailable." }
        val directory = File(context.cacheDir, "fizz-timeline-export")
        require(directory.isDirectory || directory.mkdirs()) { "Cannot create export directory." }
        val destination = File(directory, "${UUID.randomUUID()}.mp4")
        output = destination
        val composition = Composition.Builder(EditedMediaItemSequence.withAudioAndVideoFrom(items)).build()
        val transformer = Transformer.Builder(context)
          .setVideoMimeType(MimeTypes.VIDEO_H264)
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .addListener(object : Transformer.Listener {
            override fun onCompleted(composition: Composition, result: ExportResult) {
              val owned = job?.takeIf { it.id == id } ?: return
              job = null
              if (!destination.isFile || destination.length() <= 0) {
                destination.delete()
                owned.promise.reject("EXPORT_EMPTY", "The encoder returned an empty file.", null)
                return
              }
              val uri = Uri.fromFile(destination).toString()
              outputs[uri] = destination
              owned.promise.resolve(mapOf("artifact" to mapOf("uri" to uri, "contentType" to "video/mp4", "size" to destination.length()), "completedClipIds" to ids))
            }
            override fun onError(composition: Composition, result: ExportResult, exception: ExportException) {
              val owned = job?.takeIf { it.id == id } ?: return
              job = null
              destination.delete()
              owned.promise.reject(if (isSourceFailure(exception)) "EXPORT_SOURCE_FAILED" else "EXPORT_FAILED", exception.message ?: "Timeline encoding failed.", exception)
            }
          }).build()
        job = Job(id, transformer, destination, promise)
        transformer.start(composition, destination.absolutePath)
        reportProgress(id)
      } catch (error: Exception) {
        job?.takeIf { it.id == id }?.transformer?.cancel()
        if (job?.id == id) job = null
        output?.delete()
        promise.reject("EXPORT_FAILED", error.message ?: "Timeline encoding failed.", error)
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancel") { id: String -> cancel(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("release") { uri: String -> outputs.remove(uri)?.delete(); Unit }.runOnQueue(Queues.MAIN)
    OnDestroy {
      handler.post {
        job?.let { cancel(it.id) }
        outputs.values.forEach { it.delete() }
        outputs.clear()
      }
    }
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
    job = null
    owned.transformer.cancel()
    owned.output.delete()
    owned.promise.reject("EXPORT_CANCELLED", "Timeline export cancelled.", null)
  }

  private fun reportProgress(id: String) {
    val owned = job?.takeIf { it.id == id } ?: return
    val holder = ProgressHolder()
    if (owned.transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
      sendEvent("progress", mapOf("id" to id, "ratio" to holder.progress / 100.0))
    }
    handler.postDelayed({ reportProgress(id) }, 250)
  }
}
