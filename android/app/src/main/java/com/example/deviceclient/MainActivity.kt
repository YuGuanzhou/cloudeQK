package com.example.deviceclient

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjectionConfig
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {
    private val preferences by lazy { getSharedPreferences("connection", MODE_PRIVATE) }
    private lateinit var status: TextView
    private lateinit var accessibilityButton: Button
    private val capture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            ContextCompat.startForegroundService(this, Intent(this, ScreenCaptureService::class.java).putExtra("resultCode", result.resultCode).putExtra("resultData", result.data))
            findViewById<Button>(R.id.captureButton).text = "屏幕共享已启动"
            moveTaskToBack(true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom); insets
        }
        status = findViewById(R.id.status); accessibilityButton = findViewById(R.id.accessibilityButton)
        val serverUrl = findViewById<EditText>(R.id.serverUrl); val deviceToken = findViewById<EditText>(R.id.deviceToken)
        val configCard = findViewById<View>(R.id.configCard); val settingsButton = findViewById<Button>(R.id.settingsButton)
        val savedUrl = preferences.getString("serverUrl", "").orEmpty(); val savedToken = preferences.getString("deviceToken", "").orEmpty()
        serverUrl.setText(savedUrl); deviceToken.setText(savedToken)
        findViewById<TextView>(R.id.deviceId).text = "设备 ID：${Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)}"
        fun showSettings(show: Boolean) { configCard.visibility = if (show) View.VISIBLE else View.GONE; settingsButton.visibility = if (show) View.GONE else View.VISIBLE }
        showSettings(savedUrl.isBlank() || savedToken.isBlank())
        settingsButton.setOnClickListener { showSettings(true) }
        findViewById<Button>(R.id.saveButton).setOnClickListener {
            val url = serverUrl.text.toString().trim().trimEnd('/'); val token = deviceToken.text.toString().trim()
            if (!validServerUrl(url) || token.isEmpty()) return@setOnClickListener Toast.makeText(this, "请输入有效的 http(s) 地址和 Token", Toast.LENGTH_SHORT).show()
            preferences.edit().putString("serverUrl", url).putString("deviceToken", token).apply()
            showSettings(false); connect(url, token); Toast.makeText(this, "配置已保存", Toast.LENGTH_SHORT).show()
        }
        accessibilityButton.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        findViewById<Button>(R.id.captureButton).setOnClickListener {
            val manager = getSystemService(MediaProjectionManager::class.java)
            capture.launch(if (android.os.Build.VERSION.SDK_INT >= 34) manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay()) else manager.createScreenCaptureIntent())
        }
        if (savedUrl.isNotBlank() && savedToken.isNotBlank()) connect(savedUrl, savedToken)
        else { status.text = "请先配置服务器"; status.setTextColor(ContextCompat.getColor(this, R.color.status_waiting)) }
    }

    override fun onResume() { super.onResume(); accessibilityButton.text = if (accessibilityEnabled()) "无障碍服务已开启" else "开启无障碍服务" }
    override fun onDestroy() { if (isFinishing) SocketManager.disconnect(); super.onDestroy() }

    private fun connect(url: String, token: String) = SocketManager.connect(applicationContext, url, token) { online, message -> runOnUiThread {
        status.text = message; status.setTextColor(ContextCompat.getColor(this, if (online) R.color.status_online else R.color.status_offline))
    } }
    private fun validServerUrl(value: String) = runCatching { Uri.parse(value).let { (it.scheme == "http" || it.scheme == "https") && !it.host.isNullOrBlank() } }.getOrDefault(false)
    private fun accessibilityEnabled(): Boolean {
        val expected = ComponentName(this, RemoteAccessibilityService::class.java).flattenToString()
        return Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)?.split(':')?.any { it.equals(expected, true) } == true
    }

}
