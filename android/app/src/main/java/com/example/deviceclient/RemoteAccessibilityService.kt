package com.example.deviceclient

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.os.Bundle
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

class RemoteAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
    override fun onServiceConnected() { instance = this }
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }

    private fun tap(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 80)).build(), null, null)
    }

    private fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, duration: Long): Boolean {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build(), null, null)
    }

    private fun screenSize(): Pair<Int, Int> {
        val windowManager = getSystemService(WindowManager::class.java)
        return if (Build.VERSION.SDK_INT >= 30) windowManager.maximumWindowMetrics.bounds.let { it.width() to it.height() }
        else @Suppress("DEPRECATION") DisplayMetrics().also { windowManager.defaultDisplay.getRealMetrics(it) }.let { it.widthPixels to it.heightPixels }
    }

    private fun input(text: String): Boolean {
        val node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) })
    }

    companion object {
        @Volatile private var instance: RemoteAccessibilityService? = null
        fun execute(context: Context, command: JSONObject?): Pair<Boolean, String> = try {
            when (command?.optString("type")) {
                "openApp" -> {
                    val packageName = command.optString("packageName")
                    val launcherContext = instance ?: context
                    val launch = launcherContext.packageManager.getLaunchIntentForPackage(packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
                    if (launch == null) false to "App 未安装或不可启动" else { launcherContext.startActivity(launch); true to "已打开 $packageName" }
                }
                "tap" -> instance?.tap(command.optDouble("x").toFloat(), command.optDouble("y").toFloat())?.let { it to if (it) "点击已提交" else "点击提交失败" } ?: (false to "无障碍服务未开启")
                "tapRelative" -> instance?.let { service ->
                    val (width, height) = service.screenSize()
                    service.tap((command.optDouble("x") * width).toFloat(), (command.optDouble("y") * height).toFloat()).let { it to if (it) "相对点击已提交" else "点击提交失败" }
                } ?: (false to "无障碍服务未开启")
                "swipe" -> instance?.swipe(command.optDouble("x1").toFloat(), command.optDouble("y1").toFloat(), command.optDouble("x2").toFloat(), command.optDouble("y2").toFloat(), command.optLong("duration"))?.let { it to if (it) "滑动已提交" else "滑动提交失败" } ?: (false to "无障碍服务未开启")
                "swipeRelative" -> instance?.let { service ->
                    val (width, height) = service.screenSize()
                    service.swipe((command.optDouble("x1") * width).toFloat(), (command.optDouble("y1") * height).toFloat(), (command.optDouble("x2") * width).toFloat(), (command.optDouble("y2") * height).toFloat(), command.optLong("duration")).let { it to if (it) "相对滑动已提交" else "滑动提交失败" }
                } ?: (false to "无障碍服务未开启")
                "inputText" -> instance?.input(command.optString("text"))?.let { it to if (it) "文本已输入" else "没有可编辑焦点" } ?: (false to "无障碍服务未开启")
                "globalAction" -> {
                    val action = mapOf("BACK" to GLOBAL_ACTION_BACK, "HOME" to GLOBAL_ACTION_HOME, "RECENTS" to GLOBAL_ACTION_RECENTS, "NOTIFICATIONS" to GLOBAL_ACTION_NOTIFICATIONS)[command.optString("action")]
                    if (action == null || instance == null) false to "动作无效或无障碍服务未开启" else instance!!.performGlobalAction(action) to "系统动作已提交"
                }
                else -> false to "不支持的指令"
            }
        } catch (e: Exception) { false to (e.message ?: "执行异常") }
    }
}
