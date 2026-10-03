package expo.modules.fizztimelineexport

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.transformer.EditedMediaItem
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean

/** One worker owns source downloads and held frames until Transformer finishes. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class TimelineExportPreparation(val directory: File) {
  class SourceFailure(message: String, cause: Throwable? = null) : Exception(message, cause)
  private val cancelled = AtomicBoolean(false)
  @Volatile private var connection: HttpURLConnection? = null

  fun cancel() {
    cancelled.set(true)
    connection?.disconnect()
  }

  fun check() {
    if (cancelled.get()) throw CancellationException("Timeline export cancelled.")
  }

  fun prepare(shots: List<Map<String, Any>>): List<EditedMediaItem> {
    check()
    require(directory.isDirectory || directory.mkdirs()) { "Cannot create export source directory." }
    return shots.flatMap { shot ->
      check()
      val uri = Uri.parse(shot["url"] as String)
      val milliseconds = (shot["durationMs"] as Number).toDouble()
      require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null) { "Invalid media URL." }
      require(milliseconds.isFinite() && milliseconds > 0 && milliseconds <= 9_007_199_254_740_991.0 && milliseconds % 1.0 == 0.0) { "Invalid clip duration." }
      when (shot["kind"]) {
        "image" -> listOf(image(uri, milliseconds.toLong()))
        "video" -> video(download(uri), milliseconds.toLong())
        else -> throw IllegalArgumentException("Invalid media kind.")
      }
    }
  }

  private fun image(uri: Uri, durationMs: Long): EditedMediaItem =
    EditedMediaItem.Builder(MediaItem.Builder().setUri(uri).setImageDurationMs(durationMs).build())
      .setFrameRate(30).build()

  private fun video(file: File, requestedMs: Long): List<EditedMediaItem> {
    check()
    val retriever = MediaMetadataRetriever()
    try {
      try { retriever.setDataSource(file.absolutePath) }
      catch (error: IllegalArgumentException) { throw SourceFailure("Cannot read timeline video.", error) }
      check()
      val sourceMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        ?: throw SourceFailure("Timeline video has no readable duration.")
      if (sourceMs <= 0 || sourceMs > Long.MAX_VALUE / 1000) throw SourceFailure("Invalid source duration.")
      val media = MediaItem.Builder().setUri(Uri.fromFile(file))
        .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setEndPositionMs(minOf(requestedMs, sourceMs)).build())
        .build()
      val source = EditedMediaItem.Builder(media).build()
      if (requestedMs <= sourceMs) return listOf(source)
      // OPTION_CLOSEST decodes a real frame, rather than choosing an earlier sync/key frame.
      val frame = retriever.getFrameAtTime(sourceMs * 1000 - 1, MediaMetadataRetriever.OPTION_CLOSEST)
        ?: throw SourceFailure("Cannot decode the final timeline frame.")
      val held = File(directory, "${UUID.randomUUID()}.png")
      try {
        check()
        held.outputStream().use { output ->
          kotlin.check(frame.compress(Bitmap.CompressFormat.PNG, 100, output)) { "Cannot save the held frame." }
        }
        check()
      } finally { frame.recycle() }
      // The image item has no audio; the audio/video sequence supplies silence for this interval.
      return listOf(source, image(Uri.fromFile(held), requestedMs - sourceMs))
    } finally { retriever.release() }
  }

  private fun download(uri: Uri): File {
    check()
    val request = URL(uri.toString()).openConnection() as HttpURLConnection
    request.connectTimeout = 15_000
    request.readTimeout = 15_000
    connection = request
    try {
      check()
      val status = try { request.responseCode } catch (error: IOException) {
        check(); throw SourceFailure("Cannot download timeline video.", error)
      }
      if (status !in 200..299) throw SourceFailure("Cannot download timeline video (HTTP $status).")
      val source = File(directory, "${UUID.randomUUID()}.media")
      val input = try { request.inputStream } catch (error: IOException) {
        check(); throw SourceFailure("Cannot read timeline video response.", error)
      }
      input.use { stream ->
        source.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            check()
            val size = try { stream.read(buffer) } catch (error: IOException) {
              check(); throw SourceFailure("Timeline video download was interrupted.", error)
            }
            if (size < 0) break
            // Disk/write failures remain fatal and must never be treated as skippable media.
            output.write(buffer, 0, size)
          }
        }
      }
      check()
      return source
    } finally {
      connection = null
      request.disconnect()
    }
  }
}
