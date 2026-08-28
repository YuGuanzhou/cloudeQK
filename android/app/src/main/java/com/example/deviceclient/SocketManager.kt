package com.example.deviceclient

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.provider.Settings
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONObject
import org.json.JSONArray
import java.util.Timer
import kotlin.concurrent.fixedRateTimer

object SocketManager {
    lateinit var deviceId: String; private set
    private var socket: Socket? = null
    private var heartbeat: Timer? = null
    @Volatile var streamingEnabled = false; private set
    @Volatile var ocrEnabled = false; private set

    @Synchronized fun connect(context: Context, serverUrl: String, token: String, status: (Boolean, String) -> Unit = { _, _ -> }) {
        disconnect()
        deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val options = IO.Options().apply {
            reconnection = true
            transports = arrayOf(WebSocket.NAME)
            auth = mapOf("role" to "device", "token" to token, "deviceId" to deviceId)
        }
        val next = try { IO.socket(serverUrl, options) } catch (error: Exception) { status(false, error.message ?: "服务器地址无效"); return }
        socket = next
        next.on(Socket.EVENT_CONNECT) {
            next.emit("device:register", JSONObject().put("deviceId", deviceId).put("model", "${Build.MANUFACTURER} ${Build.MODEL}").put("androidVersion", Build.VERSION.RELEASE))
            next.emit("device:apps", installedApps(context))
            heartbeat?.cancel(); heartbeat = fixedRateTimer("heartbeat", daemon = true, initialDelay = 0, period = 10_000) { emit("device:heartbeat", JSONObject().put("deviceId", deviceId).put("timestamp", System.currentTimeMillis())) }
            status(true, "服务器已连接")
        }
        next.on(Socket.EVENT_DISCONNECT) { heartbeat?.cancel(); streamingEnabled = false; ocrEnabled = false; status(false, "连接已断开，正在重试") }
        next.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val error = args.firstOrNull()
            val detail = when (error) {
                is Throwable -> generateSequence(error) { it.cause }.mapNotNull { it.message }.distinct().joinToString(" → ")
                is JSONObject -> error.optString("message", error.toString())
                else -> error?.toString() ?: "网络错误"
            }
            status(false, if (detail.contains("unauthorized", true)) "设备 Token 不正确" else "无法连接 $serverUrl（$detail）")
        }
        next.on("screen:control") { args ->
            val control = args.firstOrNull() as? JSONObject
            streamingEnabled = control?.optBoolean("enabled") == true
            ocrEnabled = control?.optBoolean("ocr") == true
        }
        next.on("command:execute") { args ->
            val payload = args.firstOrNull() as? JSONObject ?: return@on
            val result = RemoteAccessibilityService.execute(context, payload.optJSONObject("command"))
            emit("command:result", JSONObject().put("requestId", payload.optString("requestId")).put("deviceId", deviceId).put("ok", result.first).put("message", result.second))
        }
        status(false, "正在连接服务器")
        next.connect()
    }

    @Synchronized fun disconnect() {
        heartbeat?.cancel(); heartbeat = null; streamingEnabled = false; ocrEnabled = false
        socket?.off(); socket?.disconnect(); socket?.close(); socket = null
    }

    fun emit(event: String, data: JSONObject) { socket?.takeIf { it.connected() }?.emit(event, data) }

    @Suppress("DEPRECATION")
    private fun installedApps(context: Context): JSONArray {
        val manager = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities = if (Build.VERSION.SDK_INT >= 33) manager.queryIntentActivities(launcher, android.content.pm.PackageManager.ResolveInfoFlags.of(0)) else manager.queryIntentActivities(launcher, 0)
        return JSONArray(activities.asSequence().map { it.activityInfo.applicationInfo }.filter {
            it.enabled && it.flags and ApplicationInfo.FLAG_SYSTEM == 0
        }.distinctBy { it.packageName }.map {
            JSONObject().put("packageName", it.packageName).put("name", manager.getApplicationLabel(it).toString())
        }.sortedBy { it.optString("name").lowercase() }.take(1000).toList())
    }
}
