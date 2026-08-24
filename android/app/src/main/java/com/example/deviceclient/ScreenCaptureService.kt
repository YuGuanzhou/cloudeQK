package com.example.deviceclient

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.view.WindowManager
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class ScreenCaptureService : Service() {
    private var projection: MediaProjection? = null
    private var reader: ImageReader? = null
    private var lastFrame = 0L

    override fun onCreate() { super.onCreate(); createChannel(); startForeground(7, notification()) }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { stopSelf(); return START_NOT_STICKY }
        val data = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra("resultData", Intent::class.java) else @Suppress("DEPRECATION") intent?.getParcelableExtra("resultData")
        val resultCode = intent?.getIntExtra("resultCode", Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        if (data == null || resultCode != Activity.RESULT_OK) { stopSelf(); return START_NOT_STICKY }
        startCapture(resultCode, data)
        return START_NOT_STICKY
    }

    private fun startCapture(code: Int, data: Intent) {
        projection?.stop()
        val wm = getSystemService(WindowManager::class.java)
        val bounds = if (Build.VERSION.SDK_INT >= 30) wm.currentWindowMetrics.bounds else @Suppress("DEPRECATION") android.graphics.Rect(0, 0, resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels)
        val scale = minOf(1f, 720f / bounds.width())
        val width = (bounds.width() * scale).toInt().coerceAtLeast(2); val height = (bounds.height() * scale).toInt().coerceAtLeast(2)
        projection = getSystemService(MediaProjectionManager::class.java).getMediaProjection(code, data).also { p ->
            p.registerCallback(object : MediaProjection.Callback() { override fun onStop() { stopSelf() } }, Handler(Looper.getMainLooper()))
            reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2).also { imageReader ->
                imageReader.setOnImageAvailableListener({ sendLatestFrame(it, width, height, bounds.width(), bounds.height()) }, null)
                p.createVirtualDisplay("RemoteScreen", width, height, resources.displayMetrics.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, imageReader.surface, null, null)
            }
        }
    }

    private fun sendLatestFrame(source: ImageReader, width: Int, height: Int, sourceWidth: Int, sourceHeight: Int) {
        val image = source.acquireLatestImage() ?: return
        try {
            if (!SocketManager.streamingEnabled) return
            if (System.currentTimeMillis() - lastFrame < 200) return
            lastFrame = System.currentTimeMillis()
            val plane = image.planes[0]; val rowPixels = plane.rowStride / plane.pixelStride
            val padded = Bitmap.createBitmap(rowPixels, height, Bitmap.Config.ARGB_8888)
            padded.copyPixelsFromBuffer(plane.buffer)
            val bitmap = Bitmap.createBitmap(padded, 0, 0, width, height); padded.recycle()
            val output = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 60, output); bitmap.recycle()
            SocketManager.emit("screen:frame", JSONObject().put("deviceId", SocketManager.deviceId).put("mime", "image/jpeg").put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)).put("sourceWidth", sourceWidth).put("sourceHeight", sourceHeight).put("timestamp", lastFrame))
        } finally { image.close() }
    }

    private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("capture", "屏幕共享", NotificationManager.IMPORTANCE_LOW)) }
    private fun notification(): Notification {
        val stop = PendingIntent.getService(this, 0, Intent(this, ScreenCaptureService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, "capture").setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("正在共享屏幕").setContentText("点按停止可立即结束共享").addAction(android.R.drawable.ic_delete, "停止", stop).build()
    }
    override fun onDestroy() { reader?.close(); projection?.stop(); super.onDestroy() }
}
