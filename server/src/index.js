import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { publicDevice, validCommand } from "./protocol.js";
import {
  automationPresets,
  buildAutomationPreset,
  buildKeywordPreset,
  parseAutomation,
  runAutomation,
} from "./automation.js";
import {
  initDb,
  pool,
  hashPassword,
  verifyPassword,
  publicUser,
} from "./db.js";
import {
  createSession,
  currentUser,
  destroySession,
  friendlyDeviceToken,
  me,
  requireAdmin,
  requireUser,
} from "./auth.js";

const PORT = Number(process.env.PORT || 6001);
const webDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web",
);
const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data",
);
const groupsFile = path.join(dataDir, "groups.json");
const app = express();
app.set("trust proxy", 1);
app.use(
  express.json({
    limit: "64kb",
  }),
);
app.post("/api/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const [rows] = await pool.query("SELECT * FROM users WHERE username=?", [
    username,
  ]);
  const user = rows[0];
  if (!user || user.banned || !verifyPassword(password, user.password_hash))
    return res.status(401).json({
      error: "用户名或密码错误，或账户已被封禁",
    });
  await createSession(req, res, user.id);
  await pool.query(
    "UPDATE users SET last_login_at=NOW(),last_login_ip=? WHERE id=?",
    [req.ip, user.id],
  );
  res.json({
    user: me(user),
  });
});
app.post("/api/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({
    ok: true,
  });
});
app.get("/api/me", requireUser, (req, res) =>
  res.json({
    user: me(req.user),
  }),
);
app.get("/api/automation-presets", requireUser, (_req, res) =>
  res.json({
    presets: automationPresets,
  }),
);
app.get("/api/device-enrollments", requireUser, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id,name,bound_device_id,created_at,last_connected_at
     FROM device_enrollments WHERE user_id=? ORDER BY created_at DESC`,
    [req.user.id],
  );
  res.json({
    enrollments: rows.map((row) => ({
      id: row.id,
      name: row.name,
      deviceId: row.bound_device_id,
      createdAt: row.created_at,
      lastConnectedAt: row.last_connected_at,
    })),
  });
});
app.post("/api/device-enrollments", requireUser, async (req, res) => {
  const name = String(req.body?.name || "")
    .trim()
    .slice(0, 80);
  if (!name)
    return res.status(400).json({
      error: "设备名称不能为空",
    });
  const [[usage]] = await pool.query(
    `SELECT u.max_devices,COUNT(e.id) used FROM users u
     LEFT JOIN device_enrollments e ON e.user_id=u.id
     WHERE u.id=? GROUP BY u.id`,
    [req.user.id],
  );
  if (Number(usage.used) >= Number(usage.max_devices))
    return res.status(400).json({
      error: "已达到最大设备数",
    });
  const id = crypto.randomUUID(),
    token = friendlyDeviceToken(),
    tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await pool.query(
    "INSERT INTO device_enrollments (id,user_id,name,token_hash) VALUES (?,?,?,?)",
    [id, req.user.id, name, tokenHash],
  );
  res.status(201).json({
    enrollment: {
      id,
      name,
      token,
    },
  });
});
app.delete("/api/device-enrollments/:id", requireUser, async (req, res) => {
  const [[row]] = await pool.query(
    "SELECT bound_device_id FROM device_enrollments WHERE id=? AND user_id=?",
    [req.params.id, req.user.id],
  );
  if (!row)
    return res.status(404).json({
      error: "设备不存在",
    });
  if (row.bound_device_id) {
    const device = devices.get(row.bound_device_id);
    if (device?.socketId)
      io.sockets.sockets.get(device.socketId)?.disconnect(true);
    await pool.query("UPDATE devices SET user_id=NULL WHERE device_id=?", [
      row.bound_device_id,
    ]);
    devices.delete(row.bound_device_id);
  }
  await pool.query("DELETE FROM device_enrollments WHERE id=?", [
    req.params.id,
  ]);
  res.json({
    ok: true,
  });
});
app.get("/api/admin/users", requireUser, requireAdmin, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*,COUNT(d.device_id) device_count FROM users u
     LEFT JOIN devices d ON d.user_id=u.id
     GROUP BY u.id ORDER BY u.created_at DESC`,
  );
  res.json({
    users: rows.map(publicUser),
  });
});
app.post("/api/admin/users", requireUser, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "admin" ? "admin" : "user";
  const maxDevices = Number(req.body?.maxDevices ?? 5);
  if (
    !/^[A-Za-z0-9_.-]{3,50}$/.test(username) ||
    password.length < 8 ||
    !Number.isInteger(maxDevices) ||
    maxDevices < 0 ||
    maxDevices > 10000
  )
    return res.status(400).json({
      error: "用户名需为 3-50 位，密码至少 8 位，设备数需为 0-10000",
    });
  try {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users (id,username,password_hash,role,max_devices) VALUES (?,?,?,?,?)",
      [id, username, hashPassword(password), role, maxDevices],
    );
    res.status(201).json({
      ok: true,
      id,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({
        error: "用户名已存在",
      });
    throw error;
  }
});
app.post(
  "/api/admin/users/bulk",
  requireUser,
  requireAdmin,
  async (req, res) => {
    const role = req.body?.role === "admin" ? "admin" : "user";
    const rows = Array.isArray(req.body?.users)
      ? req.body.users.slice(0, 200)
      : [];
    if (!rows.length)
      return res.status(400).json({
        error: "请提供用户列表",
      });
    const results = [];
    for (const [index, item] of rows.entries()) {
      const username = String(item?.username || "").trim(),
        password = String(item?.password || ""),
        maxDevices = Number(item?.maxDevices ?? 5);
      if (
        !/^[A-Za-z0-9_.-]{3,50}$/.test(username) ||
        password.length < 8 ||
        !Number.isInteger(maxDevices) ||
        maxDevices < 0 ||
        maxDevices > 10000
      ) {
        results.push({
          line: index + 1,
          username,
          ok: false,
          error: "格式无效",
        });
        continue;
      }
      try {
        await pool.query(
          "INSERT INTO users (id,username,password_hash,role,max_devices) VALUES (?,?,?,?,?)",
          [
            crypto.randomUUID(),
            username,
            hashPassword(password),
            role,
            maxDevices,
          ],
        );
        results.push({
          line: index + 1,
          username,
          ok: true,
        });
      } catch (error) {
        results.push({
          line: index + 1,
          username,
          ok: false,
          error: error.code === "ER_DUP_ENTRY" ? "用户名已存在" : "创建失败",
        });
      }
    }
    res.json({
      results,
      created: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
    });
  },
);
app.patch(
  "/api/admin/users/:id",
  requireUser,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;
    const fields = [];
    const values = [];
    if ("banned" in req.body) {
      if (id === req.user.id && req.body.banned)
        return res.status(400).json({
          error: "不能封禁自己",
        });
      fields.push("banned=?");
      values.push(Boolean(req.body.banned));
    }
    if ("maxDevices" in req.body) {
      const value = Number(req.body.maxDevices);
      if (!Number.isInteger(value) || value < 0 || value > 10000)
        return res.status(400).json({
          error: "设备数需为 0-10000",
        });
      fields.push("max_devices=?");
      values.push(value);
    }
    if ("password" in req.body) {
      const value = String(req.body.password);
      if (value.length < 8)
        return res.status(400).json({
          error: "密码至少 8 位",
        });
      fields.push("password_hash=?");
      values.push(hashPassword(value));
    }
    if (!fields.length)
      return res.status(400).json({
        error: "没有可修改内容",
      });
    values.push(id);
    const [result] = await pool.query(
      `UPDATE users SET ${fields.join(",")} WHERE id=?`,
      values,
    );
    if (!result.affectedRows)
      return res.status(404).json({
        error: "用户不存在",
      });
    if (req.body.banned || req.body.password) {
      await pool.query("DELETE FROM sessions WHERE user_id=?", [id]);
      for (const socket of await io.in(`dashboard:${id}`).fetchSockets())
        socket.disconnect(true);
    }
    res.json({
      ok: true,
    });
  },
);
app.delete(
  "/api/admin/users/:id",
  requireUser,
  requireAdmin,
  async (req, res) => {
    if (req.params.id === req.user.id)
      return res.status(400).json({
        error: "不能删除自己",
      });
    const [[target]] = await pool.query("SELECT role FROM users WHERE id=?", [
      req.params.id,
    ]);
    if (!target)
      return res.status(404).json({
        error: "用户不存在",
      });
    if (target.role === "admin") {
      const [[count]] = await pool.query(
        "SELECT COUNT(*) total FROM users WHERE role='admin'",
      );
      if (Number(count.total) <= 1)
        return res.status(400).json({
          error: "不能删除最后一个管理员",
        });
    }
    for (const socket of await io
      .in(`dashboard:${req.params.id}`)
      .fetchSockets())
      socket.disconnect(true);
    const [result] = await pool.query("DELETE FROM users WHERE id=?", [
      req.params.id,
    ]);
    res.json({
      ok: Boolean(result.affectedRows),
    });
  },
);
app.get("/api/admin/devices", requireUser, requireAdmin, async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT d.*,u.username FROM devices d LEFT JOIN users u ON u.id=d.user_id ORDER BY d.last_seen_at DESC",
  );
  res.json({
    devices: rows.map((d) => ({
      deviceId: d.device_id,
      userId: d.user_id,
      username: d.username,
      model: d.model,
      androidVersion: d.android_version,
      firstSeenAt: d.first_seen_at,
      lastSeenAt: d.last_seen_at,
    })),
  });
});
app.patch(
  "/api/admin/devices/:id",
  requireUser,
  requireAdmin,
  async (req, res) => {
    const userId = req.body?.userId || null;
    if (userId) {
      const [[user]] = await pool.query(
        "SELECT max_devices,(SELECT COUNT(*) FROM devices WHERE user_id=?) device_count FROM users WHERE id=?",
        [userId, userId],
      );
      if (!user)
        return res.status(404).json({
          error: "用户不存在",
        });
      const [[device]] = await pool.query(
        "SELECT user_id FROM devices WHERE device_id=?",
        [req.params.id],
      );
      if (
        device?.user_id !== userId &&
        Number(user.device_count) >= user.max_devices
      )
        return res.status(400).json({
          error: "该用户已达到最大设备数",
        });
    }
    const [result] = await pool.query(
      "UPDATE devices SET user_id=? WHERE device_id=?",
      [userId, req.params.id],
    );
    if (!result.affectedRows)
      return res.status(404).json({
        error: "设备不存在",
      });
    const device = devices.get(req.params.id);
    if (device) device.userId = userId;
    res.json({
      ok: true,
    });
  },
);
app.get("/", async (req, res, next) => {
  try {
    if (!(await currentUser(req))) return res.redirect("/login.html");
    next();
  } catch (error) {
    next(error);
  }
});
app.use(
  express.static(webDir, {
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  }),
);
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
  }),
);

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 2e6,
  cors: {
    origin: false,
  },
});
const devices = new Map();
const automations = new Map();
const ocrResults = new Map();
const ocrUsers = new Map();
fs.mkdirSync(dataDir, {
  recursive: true,
});
const groups = new Map(
  Object.entries(
    JSON.parse(
      fs.existsSync(groupsFile) ? fs.readFileSync(groupsFile, "utf8") : "{}",
    ),
  ),
);

function saveGroups() {
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(Object.fromEntries(groups), null, 2),
  );
}

function groupSnapshot() {
  return [...groups.values()];
}

function setStreaming(deviceId, enabled) {
  const device = devices.get(deviceId);
  if (device?.online)
    io.to(device.socketId).emit("screen:control", {
      enabled,
      ocr: (ocrUsers.get(deviceId) || 0) > 0,
    });
}

async function refreshStreaming(deviceId) {
  setStreaming(
    deviceId,
    (ocrUsers.get(deviceId) || 0) > 0 ||
      (await io.in(`screen:${deviceId}`).fetchSockets()).length > 0,
  );
}

function useOcr(deviceId, enabled) {
  const count = Math.max(0, (ocrUsers.get(deviceId) || 0) + (enabled ? 1 : -1));
  count ? ocrUsers.set(deviceId, count) : ocrUsers.delete(deviceId);
  refreshStreaming(deviceId);
}

async function nextOcr(deviceId, after, signal) {
  while (!signal.aborted && Date.now() - after < 10_000) {
    const result = ocrResults.get(deviceId);
    if (result?.timestamp > after) return result.text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (signal.aborted) throw new Error("脚本已取消");
  throw new Error("OCR 识别超时，请确认手机已开启屏幕共享");
}

io.use(async (socket, next) => {
  const { role, token, deviceId } = socket.handshake.auth || {};
  if (
    role === "device" &&
    typeof token === "string" &&
    typeof deviceId === "string" &&
    deviceId.length <= 128
  ) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const [[enrollment]] = await pool.query(
      "SELECT e.*,u.banned FROM device_enrollments e JOIN users u ON u.id=e.user_id WHERE e.token_hash=?",
      [tokenHash],
    );
    if (
      enrollment &&
      !enrollment.banned &&
      (!enrollment.bound_device_id || enrollment.bound_device_id === deviceId)
    ) {
      socket.data.enrollment = enrollment;
      return next();
    }
  }
  if (role === "dashboard") {
    const user = await currentUser(socket.request);
    if (user) {
      socket.data.user = user;
      return next();
    }
  }
  next(new Error("unauthorized"));
});

io.on("connection", (socket) => {
  const { role, deviceId } = socket.handshake.auth;
  if (role === "device") socket.join(role);

  if (role === "dashboard") {
    const user = socket.data.user;
    socket.join("dashboard");
    socket.join(
      user.role === "admin" ? "dashboard:admin" : `dashboard:${user.id}`,
    );
    socket.emit(
      "devices:snapshot",
      [...devices.values()]
        .filter((d) => user.role === "admin" || d.userId === user.id)
        .map(publicDevice),
    );
    socket.emit("groups:snapshot", groupSnapshot());
    socket.on("group:create", ({ name } = {}, ack = () => {}) => {
      const clean = String(name || "")
        .trim()
        .slice(0, 40);
      if (!clean)
        return ack({
          ok: false,
          error: "分组名称不能为空",
        });
      const group = {
        id: crypto.randomUUID(),
        name: clean,
        deviceIds: [],
      };
      groups.set(group.id, group);
      saveGroups();
      io.to("dashboard").emit("groups:snapshot", groupSnapshot());
      ack({
        ok: true,
        group,
      });
    });
    socket.on("group:assign", ({ groupId, deviceIds } = {}, ack = () => {}) => {
      const group = groups.get(groupId);
      if (!group || !Array.isArray(deviceIds) || deviceIds.length > 500)
        return ack({
          ok: false,
          error: "分组参数无效",
        });
      group.deviceIds = [
        ...new Set(
          deviceIds.filter((id) => typeof id === "string" && id.length <= 128),
        ),
      ];
      saveGroups();
      io.to("dashboard").emit("groups:snapshot", groupSnapshot());
      ack({
        ok: true,
        count: group.deviceIds.length,
      });
    });
    socket.on("group:delete", ({ groupId } = {}, ack = () => {}) => {
      if (!groups.delete(groupId))
        return ack({
          ok: false,
          error: "分组不存在",
        });
      saveGroups();
      io.to("dashboard").emit("groups:snapshot", groupSnapshot());
      ack({
        ok: true,
      });
    });
    socket.on("screen:subscribe", async ({ deviceId: id } = {}) => {
      const device = devices.get(id);
      if (
        typeof id !== "string" ||
        !device ||
        (user.role !== "admin" && device.userId !== user.id)
      )
        return;
      await socket.join(`screen:${id}`);
      setStreaming(id, true);
    });
    socket.on("screen:unsubscribe", async ({ deviceId: id } = {}) => {
      if (typeof id !== "string") return;
      await socket.leave(`screen:${id}`);
      await refreshStreaming(id);
    });
    socket.on(
      "command:send",
      ({ requestId, deviceIds, command } = {}, ack = () => {}) => {
        if (
          typeof requestId !== "string" ||
          requestId.length > 128 ||
          !Array.isArray(deviceIds) ||
          deviceIds.length > 500 ||
          !validCommand(command)
        )
          return ack({
            ok: false,
            error: "invalid command",
          });
        const permitted = [...devices.values()]
          .filter((d) => user.role === "admin" || d.userId === user.id)
          .map((d) => d.deviceId);
        const targets = deviceIds.includes("*")
          ? permitted
          : [...new Set(deviceIds)].filter((id) => permitted.includes(id));
        let delivered = 0;
        for (const id of targets) {
          const device = devices.get(id);
          if (device?.online) {
            io.to(device.socketId).emit("command:execute", {
              requestId,
              command,
            });
            delivered++;
          }
        }
        ack({
          ok: true,
          delivered,
        });
      },
    );
    socket.on(
      "automation:run",
      (
        { runId, deviceIds, source, presetId, parameters, strategy } = {},
        ack = () => {},
      ) => {
        try {
          if (
            typeof runId !== "string" ||
            runId.length > 128 ||
            !Array.isArray(deviceIds) ||
            deviceIds.length > 500
          )
            throw new Error("运行参数无效");
          const keywordConfig = strategy === "keyword" ? buildKeywordPreset(presetId, parameters) : null;
          const steps = keywordConfig ? [] : presetId
            ? buildAutomationPreset(presetId, parameters)
            : parseAutomation(source);
          const permitted = [...devices.values()]
            .filter((d) => user.role === "admin" || d.userId === user.id)
            .map((d) => d.deviceId);
          const targets = deviceIds.includes("*")
            ? permitted
            : [...new Set(deviceIds)].filter((id) => permitted.includes(id));
          const controller = new AbortController();
          const automationKey = `${socket.id}:${runId}`;
          automations.get(automationKey)?.abort();
          automations.set(automationKey, controller);
          ack({
            ok: true,
            steps: keywordConfig ? keywordConfig.count : steps.length,
            targets: targets.length,
          });
          const execution = keywordConfig
            ? Promise.all(targets.map(async (id) => {
                useOcr(id, true);
                try {
                  const send = (command, step) => {
                    const device = devices.get(id);
                    if (device?.online) io.to(device.socketId).emit("command:execute", { requestId: `${runId}:${id}:${step}`, command });
                  };
                  send({ type: "openApp", packageName: keywordConfig.packageName }, "open");
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  for (let index = 0; keywordConfig.count === -1 || index < keywordConfig.count; index++) {
                    if (controller.signal.aborted) throw new Error("脚本已取消");
                    const started = Date.now();
                    await new Promise((resolve) => setTimeout(resolve, keywordConfig.staySeconds * 1000));
                    const text = (await nextOcr(id, started, controller.signal)).replace(/\s+/g, "").toLowerCase();
                    const matched = keywordConfig.keywords.some((word) => text.includes(word.replace(/\s+/g, "").toLowerCase()));
                    if (matched) send({ type: "tapRelative", ...keywordConfig.likePoint }, `like:${index}`);
                    send({ type: "swipeRelative", x1: keywordConfig.swipeStart.x, y1: keywordConfig.swipeStart.y, x2: keywordConfig.swipeEnd.x, y2: keywordConfig.swipeEnd.y, duration: keywordConfig.swipeDuration }, `swipe:${index}`);
                    io.to(socket.id).emit("automation:progress", { runId, step: index + 1, total: keywordConfig.count, deviceId: id, matched });
                  }
                } finally { useOcr(id, false); }
              }))
            : runAutomation(
            steps,
            async (command, step) => {
              for (const id of targets) {
                const device = devices.get(id);
                if (device?.online)
                  io.to(device.socketId).emit("command:execute", {
                    requestId: `${runId}:${step}`,
                    command,
                  });
              }
              io.to(socket.id).emit("automation:progress", {
                runId,
                step: step + 1,
                total: steps.length,
              });
            },
            controller.signal,
          );
          execution
            .then(() =>
              io.to(socket.id).emit("automation:done", {
                runId,
                ok: true,
              }),
            )
            .catch((error) =>
              io.to(socket.id).emit("automation:done", {
                runId,
                ok: false,
                error: error.message,
              }),
            )
            .finally(() => automations.delete(automationKey));
        } catch (error) {
          ack({
            ok: false,
            error: error.message,
          });
        }
      },
    );
    socket.on("automation:cancel", ({ runId } = {}) =>
      automations.get(`${socket.id}:${runId}`)?.abort(),
    );
    socket.on("disconnecting", () => {
      const ids = [...socket.rooms]
        .filter((room) => room.startsWith("screen:"))
        .map((room) => room.slice(7));
      setTimeout(() => ids.forEach(refreshStreaming), 0);
      for (const [key, controller] of automations)
        if (key.startsWith(`${socket.id}:`)) controller.abort();
    });
    return;
  }

  socket.on("device:register", async (info = {}) => {
    if (info.deviceId !== deviceId) return;
    const enrollment = socket.data.enrollment;
    const [binding] = await pool.query(
      `UPDATE device_enrollments SET bound_device_id=?,last_connected_at=NOW()
       WHERE id=? AND (bound_device_id IS NULL OR bound_device_id=?)`,
      [deviceId, enrollment.id, deviceId],
    );
    if (!binding.affectedRows) return socket.disconnect(true);
    const model = String(info.model || "Unknown").slice(0, 100),
      androidVersion = String(info.androidVersion || "?").slice(0, 30);
    await pool.query(
      `INSERT INTO devices (device_id,user_id,model,android_version)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),
       model=VALUES(model),android_version=VALUES(android_version),last_seen_at=NOW()`,
      [deviceId, enrollment.user_id, model, androidVersion],
    );
    const device = {
      deviceId,
      userId: enrollment.user_id,
      model,
      androidVersion,
      online: true,
      lastSeen: Date.now(),
      socketId: socket.id,
    };
    devices.set(deviceId, device);
    io.to("dashboard:admin")
      .to(device.userId ? `dashboard:${device.userId}` : "__none__")
      .emit("device:status", publicDevice(device));
    refreshStreaming(deviceId);
  });
  socket.on("device:heartbeat", () => {
    const device = devices.get(deviceId);
    if (device && device.socketId === socket.id) {
      device.lastSeen = Date.now();
      device.online = true;
    }
  });
  socket.on("device:apps", (list = []) => {
    if (!Array.isArray(list)) return;
    const apps = list
      .slice(0, 1000)
      .map((app) => ({
        name: String(app?.name || "").slice(0, 100),
        packageName: String(app?.packageName || "").slice(0, 200),
      }))
      .filter(
        (app) => app.name && /^[a-zA-Z][\w]*(\.[\w]+)+$/.test(app.packageName),
      );
    const device = devices.get(deviceId);
    if (!device || device.socketId !== socket.id) return;
    device.apps = apps;
    io.to("dashboard:admin")
      .to(device.userId ? `dashboard:${device.userId}` : "__none__")
      .emit("device:apps", {
        deviceId,
        apps,
      });
  });
  socket.on("command:result", (result = {}) => {
    if (result.deviceId === deviceId) {
      const device = devices.get(deviceId);
      io.to("dashboard:admin")
        .to(device?.userId ? `dashboard:${device.userId}` : "__none__")
        .emit("command:result", {
          requestId: String(result.requestId || ""),
          deviceId,
          ok: Boolean(result.ok),
          message: String(result.message || "").slice(0, 1000),
        });
    }
  });
  socket.on("screen:frame", (frame = {}) => {
    if (
      frame.deviceId === deviceId &&
      frame.mime === "image/jpeg" &&
      typeof frame.data === "string" &&
      frame.data.length < 1_800_000
    )
      io.to(`screen:${deviceId}`).emit("screen:frame", frame);
  });
  socket.on("screen:ocr", (result = {}) => {
    if (result.deviceId === deviceId && typeof result.text === "string" && result.text.length < 20_000)
      ocrResults.set(deviceId, { text: result.text, timestamp: Number(result.timestamp) || Date.now() });
  });
  socket.on("disconnect", () => {
    const device = devices.get(deviceId);
    if (device?.socketId === socket.id) {
      device.online = false;
      device.lastSeen = Date.now();
      io.to("dashboard:admin")
        .to(device.userId ? `dashboard:${device.userId}` : "__none__")
        .emit("device:status", publicDevice(device));
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const device of devices.values())
    if (device.online && now - device.lastSeen > 30_000) {
      device.online = false;
      io.to("dashboard:admin")
        .to(device.userId ? `dashboard:${device.userId}` : "__none__")
        .emit("device:status", publicDevice(device));
    }
}, 10_000).unref();

await initDb();
server.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
