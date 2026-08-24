# 多设备远程指令与投屏管理系统（MVP）

这是一个端到端示例：Node.js 维护设备状态并路由消息，Vue 网页控制设备，Android 通过 MediaProjection 发送 JPEG 帧，并通过 AccessibilityService 执行白名单动作。

> 仅用于管理你拥有或已获明确授权的设备。Android 的录屏和无障碍能力都必须由设备用户显式开启；本项目不绕过系统授权，也不执行任意远程脚本。

## 目录

```text
.
├─ server/
│  ├─ package.json
│  ├─ src/index.js              # Socket.io 服务、状态与路由
│  └─ test/protocol.test.js     # 最小协议校验
├─ web/
│  ├─ index.html                # Vue 控制台
│  ├─ app.js
│  └─ style.css
└─ android/
   ├─ settings.gradle.kts
   ├─ build.gradle.kts
   └─ app/
      ├─ build.gradle.kts
      └─ src/main/
         ├─ AndroidManifest.xml
         ├─ java/com/example/deviceclient/
         │  ├─ MainActivity.kt
         │  ├─ SocketManager.kt
         │  ├─ ScreenCaptureService.kt
         │  └─ RemoteAccessibilityService.kt
         └─ res/
            ├─ layout/activity_main.xml
            ├─ values/strings.xml
            └─ xml/accessibility_service_config.xml
```

## Socket.io 协议

所有消息均为 JSON。设备连接使用 `auth: { role: "device", token, deviceId }`；网页使用登录后签发的 HttpOnly 会话 Cookie。服务端环境变量 `DEVICE_TOKEN` 必须与设备客户端一致。

| 方向 | 事件 | 载荷 | 作用 |
|---|---|---|---|
| App → Server | `device:register` | `{deviceId, model, androidVersion}` | 注册/刷新设备资料 |
| App → Server | `device:heartbeat` | `{deviceId, timestamp}` | 心跳（10 秒） |
| Server → Web | `devices:snapshot` | `Device[]` | 初始设备列表 |
| Server → Web | `device:status` | `Device` | 单设备在线状态变化 |
| Web → Server | `command:send` | `{requestId, deviceIds: string[]\|["*"], command}` | 下发白名单指令 |
| Server → App | `command:execute` | `{requestId, command}` | 执行指令 |
| App → Server | `command:result` | `{requestId, deviceId, ok, message}` | 回传结果 |
| Server → Web | `command:result` | 同上 | 展示结果 |
| Web → Server | `screen:subscribe` | `{deviceId}` | 订阅一个设备画面 |
| Web → Server | `screen:unsubscribe` | `{deviceId}` | 取消订阅 |
| App → Server | `screen:frame` | `{deviceId, mime, data, timestamp}` | Base64 JPEG 帧 |
| Server → Web | `screen:frame` | 同上 | 仅转发给订阅者 |
| Server → App | `screen:control` | `{enabled}` | 有网页观看时才编码和发送画面 |
| Web → Server | `automation:run` | `{runId, deviceIds, source}` | 校验并运行受限 DSL |
| Web → Server | `automation:cancel` | `{runId}` | 取消当前网页启动的脚本 |
| Server → Web | `automation:progress` | `{runId, step, total}` | 脚本进度 |
| Server → Web | `automation:done` | `{runId, ok, error?}` | 脚本结束状态 |

`command` 白名单：

```json
{"type":"openApp","packageName":"com.example.app"}
{"type":"tap","x":300,"y":500}
{"type":"tapRelative","x":0.5,"y":0.5}
{"type":"inputText","text":"hello"}
{"type":"globalAction","action":"BACK"}
```

## 运行

```powershell
cd server
npm install
$env:DEVICE_TOKEN='change-device-token'
$env:DB_PASSWORD='Yu789321'
$env:ADMIN_PASSWORD='请设置一个强密码'
npm start
```

打开 `http://localhost:3000/`，使用管理员账号登录。默认账号为 `admin`、默认密码为 `Admin123456`；首次登录后应立即在后台管理中修改。数据库默认连接本机 `127.0.0.1:3306` 的 `root` 用户，并自动创建 `cloudeqk` 数据库。Android Studio 打开 `android/` 并安装到真机或模拟器；在 App 首页填写服务器地址和与 `DEVICE_TOKEN` 一致的设备 Token，保存后会立即重连。真机使用电脑局域网 IP，模拟器可使用默认的 `10.0.2.2`，连接后依次开启无障碍服务和录屏。

控制台支持设备搜索、多选批量下发；未选择设备时默认发给全部在线设备。点击设备名称进入投屏，勾选框只控制指令接收范围。没有网页订阅时 Android 会保持系统录屏授权，但暂停 JPEG 编码和网络发送。

## 自动化 DSL

脚本由服务端逐行解析，不使用 `eval`，不能访问 Shell、网络或文件。最多 100 步，单次 `WAIT` 最长 60 秒；网页可把常用脚本保存为浏览器本地预设。

```text
# 打开设置后返回桌面
OPEN com.android.settings
WAIT 1000
TAP 100 200
TEXT hello world
BACK
HOME
```

屏幕墙会订阅全部在线设备。点击“控制”进入单机画面，直接点击画面即可按设备原始分辨率映射坐标；如果勾选了多台设备，同一坐标会群发到勾选设备。

开发环境默认值只便于首次联调，公网部署前必须设置强随机 token、启用 HTTPS/WSS，并在反向代理限制请求体和连接速率。
