const { createApp, computed, ref } = Vue;
createApp({
  setup() {
    const theme = ref(
      localStorage.getItem("theme") ||
        (matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"),
    );
    document.documentElement.dataset.theme = theme.value;

    function toggleTheme() {
      theme.value = theme.value === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme.value;
      localStorage.setItem("theme", theme.value);
    }
    const socket = io({
      auth: {
        role: "dashboard",
      },
    });
    const currentUser = ref({}),
      adminUsers = ref([]),
      adminDevices = ref([]),
      newUser = ref({
        username: "",
        password: "",
        role: "user",
        maxDevices: 5,
      });
    const modal = ref({
      open: false,
      title: "",
      message: "",
      input: false,
      value: "",
      danger: false,
      error: "",
    });
    const bulkText = ref("user001,Password123,5\nuser002,Password123,5"),
      bulkRole = ref("user"),
      bulkResult = ref(null);
    const enrollments = ref([]),
      enrollmentName = ref(""),
      newDeviceToken = ref("");
    let resolveModal;
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.value.open) closeModal();
    });
    const devices = ref([]),
      groups = ref([]),
      connected = ref(false),
      connectionError = ref(""),
      view = ref("wall"),
      target = ref(""),
      scope = ref("all"),
      selectedGroupId = ref(""),
      selectedIds = ref([]),
      newGroupName = ref(""),
      query = ref(""),
      wallColumns = ref(5),
      frames = ref({}),
      logs = ref([]),
      errorToast = ref(null),
      remoteText = ref("");
    const form = ref({
        type: "openApp",
        packageName: "",
        x: 100,
        y: 100,
        text: "Hello",
        action: "BACK",
      }),
      appQuery = ref(""),
      appPickerOpen = ref(false);
    const script = ref(
        "# 每行一条指令\nOPEN com.android.settings\nWAIT 1000\nTAP 100 200\nBACK",
      ),
      presetName = ref(""),
      presets = ref(
        JSON.parse(localStorage.getItem("automation-presets") || "[]"),
      ),
      activeRun = ref("");
    const serverPresets = ref([]),
      selectedServerPreset = ref(""),
      presetParameters = ref({}),
      nurtureStrategy = ref("random"),
      ocrKeywords = ref(""),
      interactionMode = ref("standard");
    const interactionModes = [
      ["browse", "仅浏览"],
      ["light", "轻度互动"],
      ["standard", "标准测试"],
      ["custom", "自定义"],
    ];
    const quickParameterKeys = new Set(["count", "staySeconds", "comments"]);
    const visiblePresetParameters = computed(() =>
      Object.entries(
        serverPresets.value.find(
          (item) => item.id === selectedServerPreset.value,
        )?.parameters || {},
      ).filter(
        ([key]) => nurtureStrategy.value === "keyword"
          ? ["count", "staySeconds"].includes(key)
          : interactionMode.value === "custom" || quickParameterKeys.has(key),
      ),
    );
    const automationMode = ref("visual"),
      newBlockType = ref("openApp"),
      blocks = ref([
        {
          id: crypto.randomUUID(),
          type: "openApp",
          packageName: "com.android.settings",
        },
        {
          id: crypto.randomUUID(),
          type: "wait",
          duration: 1000,
        },
        {
          id: crypto.randomUUID(),
          type: "tap",
          x: 100,
          y: 200,
        },
        {
          id: crypto.randomUUID(),
          type: "action",
          action: "BACK",
        },
      ]);
    const blockCatalog = [
      ["openApp", "打开应用"],
      ["wait", "等待"],
      ["tap", "点击坐标"],
      ["swipe", "滑动"],
      ["text", "输入文本"],
      ["action", "系统动作"],
    ];
    const filteredDevices = computed(() => {
      const q = query.value.toLowerCase();
      return devices.value.filter((d) =>
        `${d.model} ${d.deviceId} ${d.androidVersion}`
          .toLowerCase()
          .includes(q),
      );
    });
    const onlineDevices = computed(() =>
      filteredDevices.value.filter((d) => d.online),
    );
    const targetApps = computed(
      () =>
        devices.value.find((device) => device.deviceId === target.value)
          ?.apps || [],
    );
    const matchingApps = computed(() => {
      const q = appQuery.value.trim().toLowerCase();
      return targetApps.value.filter(
        (app) =>
          !q || `${app.name} ${app.packageName}`.toLowerCase().includes(q),
      );
    });
    const selectedGroup = computed(() =>
      groups.value.find((group) => group.id === selectedGroupId.value),
    );
    const recipientLabel = computed(() =>
      scope.value === "single"
        ? `单台：${devices.value.find((device) => device.deviceId === target.value)?.model || "未选择"}`
        : scope.value === "selected"
          ? `${selectedIds.value.length} 台已选设备`
          : scope.value === "group"
            ? `分组：${selectedGroup.value?.name || "未选择"}`
            : "全部在线设备",
    );
    const upsert = (d) => {
      const i = devices.value.findIndex((x) => x.deviceId === d.deviceId);
      i < 0
        ? devices.value.push(d)
        : devices.value.splice(i, 1, {
            ...devices.value[i],
            ...d,
          });
      if (d.online)
        socket.emit("screen:subscribe", {
          deviceId: d.deviceId,
        });
    };
    let errorToastTimer;
    const log = (text) => {
      logs.value.unshift({
        id: crypto.randomUUID(),
        text,
        time: Date.now(),
      });
      logs.value = logs.value.slice(0, 100);
      if (text.startsWith("✗")) {
        const phone = document.querySelector(".phone-shell")?.getBoundingClientRect();
        errorToast.value = {
          id: crypto.randomUUID(),
          text: text.replace(/^✗\s*/, ""),
          left: phone ? phone.left + phone.width / 2 : innerWidth / 2,
        };
        clearTimeout(errorToastTimer);
        errorToastTimer = setTimeout(() => (errorToast.value = null), 5000);
      }
    };
    const clearLogs = () => {
      logs.value = [];
    };
    const recipients = () =>
      scope.value === "single"
        ? target.value
          ? [target.value]
          : []
        : scope.value === "selected"
          ? selectedIds.value
          : scope.value === "group"
            ? selectedGroup.value?.deviceIds || []
            : ["*"];
    socket.on("connect", () => {
      connected.value = true;
      connectionError.value = "";
    });
    socket.on("disconnect", () => (connected.value = false));
    socket.on("connect_error", (e) => {
      connected.value = false;
      connectionError.value =
        e.message === "unauthorized" ? "登录已失效，请重新登录" : e.message;
    });
    socket.on("devices:snapshot", (list) => {
      devices.value = list;
      list
        .filter((d) => d.online)
        .forEach((d) =>
          socket.emit("screen:subscribe", {
            deviceId: d.deviceId,
          }),
        );
    });
    socket.on("groups:snapshot", (list) => (groups.value = list));
    socket.on("device:status", upsert);
    socket.on("device:apps", ({ deviceId, apps }) => {
      const device = devices.value.find((item) => item.deviceId === deviceId);
      if (device) device.apps = apps;
    });
    socket.on(
      "screen:frame",
      (f) =>
        (frames.value = {
          ...frames.value,
          [f.deviceId]: {
            url: `data:${f.mime};base64,${f.data}`,
            width: f.sourceWidth,
            height: f.sourceHeight,
            timestamp: f.timestamp,
          },
        }),
    );
    const pendingCommands = new Map();
    socket.on("command:result", (r) => {
      clearTimeout(pendingCommands.get(r.requestId));
      pendingCommands.delete(r.requestId);
      log(`${r.ok ? "✓" : "✗"} ${r.deviceId}: ${r.message}`);
    });
    socket.on("automation:progress", (r) => {
      if (r.runId === activeRun.value)
        log(`${r.matched === undefined ? "自动化进度" : r.matched ? "OCR 命中并点赞" : "OCR 未命中，已跳过"} ${r.step}/${r.total === -1 ? "持续" : r.total}`);
    });
    socket.on("automation:done", (r) => {
      if (r.runId === activeRun.value) {
        log(r.ok ? "自动化执行完成" : r.error);
        activeRun.value = "";
      }
    });
    async function api(url, options) {
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
        },
        ...options,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "请求失败");
      return body;
    }
    api("/api/me")
      .then(async (body) => {
        currentUser.value = body.user;
        loadEnrollments();
        const result = await api("/api/automation-presets");
        serverPresets.value = result.presets;
        selectServerPreset(result.presets[0]?.id);
      })
      .catch(() => (location.href = "/login.html"));
    async function loadEnrollments() {
      try {
        enrollments.value = (await api("/api/device-enrollments")).enrollments;
      } catch (error) {
        log(error.message);
      }
    }
    async function createEnrollment() {
      try {
        const body = await api("/api/device-enrollments", {
          method: "POST",
          body: JSON.stringify({
            name: enrollmentName.value,
          }),
        });
        newDeviceToken.value = body.enrollment.token;
        enrollmentName.value = "";
        await loadEnrollments();
      } catch (error) {
        log(error.message);
      }
    }
    async function removeEnrollment(item) {
      if (
        !(await showModal({
          title: "删除设备绑定",
          message: `确定删除 ${item.name}？该设备将立即断开并从用户设备列表移除。`,
          danger: true,
        }))
      )
        return;
      try {
        await api(`/api/device-enrollments/${item.id}`, {
          method: "DELETE",
        });
        await loadEnrollments();
        log("设备绑定已删除");
      } catch (error) {
        log(error.message);
      }
    }
    async function copyDeviceToken() {
      await navigator.clipboard.writeText(newDeviceToken.value);
      log("设备 Token 已复制");
    }
    async function loadAdmin() {
      try {
        const [users, deviceList] = await Promise.all([
          api("/api/admin/users"),
          api("/api/admin/devices"),
        ]);
        adminUsers.value = users.users;
        adminDevices.value = deviceList.devices;
      } catch (error) {
        log(error.message);
      }
    }

    function openAdmin() {
      view.value = "admin";
      loadAdmin();
    }
    async function createUser() {
      try {
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify(newUser.value),
        });
        newUser.value = {
          username: "",
          password: "",
          role: "user",
          maxDevices: 5,
        };
        await loadAdmin();
        log("用户已创建");
      } catch (error) {
        log(error.message);
      }
    }
    async function createBulkUsers() {
      const users = bulkText.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [username, password, maxDevices = "5"] = line
            .split(",")
            .map((value) => value.trim());
          return {
            username,
            password,
            maxDevices: Number(maxDevices),
          };
        });
      if (!users.length || users.length > 200)
        return (bulkResult.value = {
          error: "请输入 1-200 行用户数据",
        });
      try {
        bulkResult.value = await api("/api/admin/users/bulk", {
          method: "POST",
          body: JSON.stringify({
            role: bulkRole.value,
            users,
          }),
        });
        await loadAdmin();
        log(
          `批量创建完成：成功 ${bulkResult.value.created}，失败 ${bulkResult.value.failed}`,
        );
      } catch (error) {
        bulkResult.value = {
          error: error.message,
        };
      }
    }
    async function updateUser(user, changes) {
      try {
        await api(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify(changes),
        });
        await loadAdmin();
        log("用户已更新");
      } catch (error) {
        log(error.message);
        await loadAdmin();
      }
    }

    function showModal(options) {
      modal.value = {
        open: true,
        value: "",
        error: "",
        input: false,
        danger: false,
        ...options,
      };
      return new Promise((resolve) => (resolveModal = resolve));
    }

    function closeModal(value = null) {
      modal.value.open = false;
      resolveModal?.(value);
      resolveModal = null;
    }

    function submitModal() {
      if (modal.value.input && modal.value.value.length < 8) {
        modal.value.error = "密码至少需要 8 位";
        return;
      }
      closeModal(modal.value.input ? modal.value.value : true);
    }
    async function changePassword(user) {
      const password = await showModal({
        title: "修改用户密码",
        message: `为 ${user.username} 设置新密码`,
        input: true,
      });
      if (password)
        updateUser(user, {
          password,
        });
    }
    async function deleteUser(user) {
      if (user.id === currentUser.value.id)
        return log("当前登录的管理员不能删除自己");
      if (
        !(await showModal({
          title: "删除用户",
          message: `确定删除用户 ${user.username}？该用户的设备将变为未分配，此操作无法撤销。`,
          danger: true,
        }))
      )
        return;
      try {
        await api(`/api/admin/users/${user.id}`, {
          method: "DELETE",
        });
        await loadAdmin();
        log("用户已删除");
      } catch (error) {
        log(error.message);
      }
    }
    async function assignDevice(device, userId) {
      try {
        await api(`/api/admin/devices/${encodeURIComponent(device.deviceId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            userId: userId || null,
          }),
        });
        await loadAdmin();
        log("设备归属已更新");
      } catch (error) {
        log(error.message);
        await loadAdmin();
      }
    }
    async function logout() {
      await api("/api/logout", {
        method: "POST",
      });
      location.href = "/login.html";
    }
    const formatTime = (value) =>
      value ? new Date(value).toLocaleString("zh-CN") : "—";

    function select(id) {
      target.value = id;
      scope.value = "single";
      view.value = "control";
    }

    function resizeWall(amount) {
      wallColumns.value = Math.min(8, Math.max(2, wallColumns.value - amount));
    }

    function toggle(id) {
      selectedIds.value = selectedIds.value.includes(id)
        ? selectedIds.value.filter((x) => x !== id)
        : [...selectedIds.value, id];
      scope.value = "selected";
    }

    function selectOnline() {
      selectedIds.value = devices.value
        .filter((d) => d.online)
        .map((d) => d.deviceId);
      scope.value = "selected";
    }

    function createGroup() {
      socket.emit(
        "group:create",
        {
          name: newGroupName.value,
        },
        (result) => {
          if (result.ok) {
            selectedGroupId.value = result.group.id;
            newGroupName.value = "";
            scope.value = "group";
          } else log(result.error);
        },
      );
    }

    function assignGroup() {
      if (!selectedGroupId.value) return log("请先选择分组");
      socket.emit(
        "group:assign",
        {
          groupId: selectedGroupId.value,
          deviceIds: selectedIds.value,
        },
        (result) =>
          log(result.ok ? `分组已保存：${result.count} 台设备` : result.error),
      );
    }
    async function deleteGroup() {
      if (
        !selectedGroupId.value ||
        !(await showModal({
          title: "删除设备分组",
          message: `确定删除分组 ${selectedGroup.value?.name || ""}？分组内设备不会被删除。`,
          danger: true,
        }))
      )
        return;
      socket.emit(
        "group:delete",
        {
          groupId: selectedGroupId.value,
        },
        (result) => {
          if (result.ok) {
            selectedGroupId.value = "";
            scope.value = "all";
          } else log(result.error);
        },
      );
    }

    function commandFromForm() {
      const command = {
        type: form.value.type,
      };
      if (command.type === "openApp")
        command.packageName = form.value.packageName;
      if (command.type === "tap") {
        command.x = form.value.x;
        command.y = form.value.y;
      }
      if (command.type === "inputText") command.text = form.value.text;
      return command;
    }

    function chooseApp(app) {
      form.value.packageName = app.packageName;
      appQuery.value = app.name;
      appPickerOpen.value = false;
      emitCommand({
        type: "openApp",
        packageName: app.packageName,
      });
    }

    function newBlock(type) {
      const defaults = {
        openApp: {
          packageName: "com.android.settings",
        },
        wait: {
          duration: 1000,
        },
        tap: {
          x: 100,
          y: 100,
        },
        swipe: {
          x1: 100,
          y1: 600,
          x2: 100,
          y2: 200,
          duration: 300,
        },
        text: {
          text: "",
        },
        action: {
          action: "BACK",
        },
      };
      return {
        id: crypto.randomUUID(),
        type,
        ...defaults[type],
      };
    }

    function addBlock() {
      blocks.value.push(newBlock(newBlockType.value));
      syncScript();
    }

    function removeBlock(index) {
      blocks.value.splice(index, 1);
      syncScript();
    }

    function moveBlock(index, direction) {
      const target = index + direction;
      if (target < 0 || target >= blocks.value.length) return;
      [blocks.value[index], blocks.value[target]] = [
        blocks.value[target],
        blocks.value[index],
      ];
      syncScript();
    }

    function blockLine(block) {
      if (block.type === "openApp") return `OPEN ${block.packageName}`;
      if (block.type === "wait") return `WAIT ${Number(block.duration)}`;
      if (block.type === "tap")
        return `TAP ${Number(block.x)} ${Number(block.y)}`;
      if (block.type === "swipe")
        return ["SWIPE", block.x1, block.y1, block.x2, block.y2, block.duration]
          .map(String)
          .join(" ");
      if (block.type === "text") return `TEXT ${block.text || ""}`;
      return block.action;
    }

    function syncScript() {
      script.value = blocks.value.map(blockLine).join("\n");
    }

    function importScript() {
      try {
        const parsed = [];
        for (const raw of script.value.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line || line.startsWith("#")) continue;
          const [op, ...args] = line.split(/\s+/);
          const name = op.toUpperCase();
          let block;
          if (name === "OPEN" && args.length === 1)
            block = {
              type: "openApp",
              packageName: args[0],
            };
          else if (name === "WAIT" && args.length === 1)
            block = {
              type: "wait",
              duration: Number(args[0]),
            };
          else if (name === "TAP" && args.length === 2)
            block = {
              type: "tap",
              x: Number(args[0]),
              y: Number(args[1]),
            };
          else if (name === "SWIPE" && [4, 5].includes(args.length))
            block = {
              type: "swipe",
              x1: Number(args[0]),
              y1: Number(args[1]),
              x2: Number(args[2]),
              y2: Number(args[3]),
              duration: Number(args[4] || 300),
            };
          else if (name === "TEXT")
            block = {
              type: "text",
              text: line.slice(op.length).trim(),
            };
          else if (
            ["BACK", "HOME", "RECENTS", "NOTIFICATIONS"].includes(name) &&
            !args.length
          )
            block = {
              type: "action",
              action: name,
            };
          else throw new Error(`无法识别：${line}`);
          parsed.push({
            id: crypto.randomUUID(),
            ...block,
          });
        }
        if (!parsed.length) throw new Error("流程不能为空");
        blocks.value = parsed;
        automationMode.value = "visual";
        log(`已转换为 ${parsed.length} 个流程模块`);
      } catch (error) {
        log(error.message);
      }
    }

    function emitCommand(command) {
      if (!recipients().length) return log("✗ 当前操作范围没有设备");
      const requestId = crypto.randomUUID();
      pendingCommands.set(
        requestId,
        setTimeout(() => {
          pendingCommands.delete(requestId);
          log("✗ 设备未返回执行结果，请检查客户端连接状态");
        }, 1500),
      );
      socket.timeout(5000).emit(
        "command:send",
        {
          requestId,
          deviceIds: recipients(),
          command,
        },
        (error, result) => {
          if (error || !result?.ok || !result.delivered) {
            clearTimeout(pendingCommands.get(requestId));
            pendingCommands.delete(requestId);
            return log(
              `✗ ${error ? "服务器响应超时" : result?.error || "没有在线设备可接收指令"}`,
            );
          }
          log(`已投递 ${result.delivered} 台设备`);
        },
      );
    }

    function sendRemoteText() {
      if (!remoteText.value || !recipients().length) return;
      emitCommand({ type: "inputText", text: remoteText.value });
      remoteText.value = "";
    }

    function relativePoint(event, device) {
      const image = event.currentTarget,
        frame = frames.value[device.deviceId];
      if (!frame?.width || !frame?.height) return null;
      const rect = image.getBoundingClientRect();
      const scale = Math.min(
        rect.width / frame.width,
        rect.height / frame.height,
      );
      const width = frame.width * scale,
        height = frame.height * scale,
        left = rect.left + (rect.width - width) / 2,
        top = rect.top + (rect.height - height) / 2;
      const x = event.clientX - left,
        y = event.clientY - top;
      return x < 0 || y < 0 || x > width || y > height
        ? null
        : {
            x: x / width,
            y: y / height,
          };
    }

    let screenGesture = null;

    function screenTouchStart(event, device) {
      const point = device && relativePoint(event, device);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      screenGesture = {
        point,
        clientX: event.clientX,
        clientY: event.clientY,
        startedAt: performance.now(),
      };
    }

    function screenTouchEnd(event, device) {
      if (!screenGesture || !device) return;
      const start = screenGesture,
        end = relativePoint(event, device);
      screenGesture = null;
      if (!end) return;
      const moved = Math.hypot(
        event.clientX - start.clientX,
        event.clientY - start.clientY,
      );
      emitCommand(
        moved < 8
          ? { type: "tapRelative", ...end }
          : {
              type: "swipeRelative",
              x1: start.point.x,
              y1: start.point.y,
              x2: end.x,
              y2: end.y,
              duration: Math.round(
                Math.min(5000, Math.max(100, performance.now() - start.startedAt)),
              ),
            },
      );
    }

    function screenTouchCancel() {
      screenGesture = null;
    }

    function runScript() {
      if (!recipients().length) return log("当前操作范围没有设备");
      if (automationMode.value === "visual") syncScript();
      const runId = crypto.randomUUID();
      socket.timeout(5000).emit(
        "automation:run",
        {
          runId,
          deviceIds: recipients(),
          source: script.value,
        },
        (error, result) => {
          if (error) return log("启动自动化超时");
          if (!result.ok) return log(result.error);
          activeRun.value = runId;
          log(`自动化已启动：${result.steps} 步 / ${result.targets} 台设备`);
        },
      );
    }

    function cancelScript() {
      if (activeRun.value)
        socket.emit("automation:cancel", {
          runId: activeRun.value,
        });
    }

    function selectServerPreset(id) {
      selectedServerPreset.value = id;
      const preset = serverPresets.value.find((item) => item.id === id);
      presetParameters.value = Object.fromEntries(
        Object.entries(preset?.parameters || {}).map(([key, rule]) => [
          key,
          rule.default,
        ]),
      );
      applyInteractionMode("standard");
    }

    function applyInteractionMode(mode) {
      interactionMode.value = mode;
      const profiles = {
        browse: {
          count: 10,
          staySeconds: 8,
          likeEvery: 0,
          followEvery: 0,
          commentEvery: 0,
          maxLikes: 0,
          maxFollows: 0,
          maxComments: 0,
        },
        light: {
          count: 8,
          staySeconds: 8,
          likeEvery: 3,
          followEvery: 0,
          commentEvery: 6,
          maxLikes: 2,
          maxFollows: 0,
          maxComments: 1,
        },
        standard: {
          count: 10,
          staySeconds: 6,
          likeEvery: 2,
          followEvery: 5,
          commentEvery: 4,
          maxLikes: 5,
          maxFollows: 2,
          maxComments: 2,
        },
      };
      if (profiles[mode]) Object.assign(presetParameters.value, profiles[mode]);
    }

    function runServerPreset() {
      if (!recipients().length) return log("当前操作范围没有设备");
      const runId = crypto.randomUUID();
      socket.timeout(5000).emit(
        "automation:run",
        {
          runId,
          deviceIds: recipients(),
          presetId: selectedServerPreset.value,
          strategy: nurtureStrategy.value,
          parameters: { ...presetParameters.value, keywords: ocrKeywords.value },
        },
        (error, result) => {
          if (error) return log("启动自动化超时");
          if (!result.ok) return log(result.error);
          activeRun.value = runId;
          log(
            `预设自动化已启动：${result.steps} 步 / ${result.targets} 台设备`,
          );
        },
      );
    }

    function savePreset() {
      if (automationMode.value === "visual") syncScript();
      const name = presetName.value.trim();
      if (!name) return;
      presets.value = [
        ...presets.value.filter((p) => p.name !== name),
        {
          name,
          source: script.value,
        },
      ];
      localStorage.setItem("automation-presets", JSON.stringify(presets.value));
      presetName.value = "";
    }

    function removePreset(name) {
      presets.value = presets.value.filter((p) => p.name !== name);
      localStorage.setItem("automation-presets", JSON.stringify(presets.value));
    }

    function loadPreset(preset) {
      script.value = preset.source;
      importScript();
    }
    return {
      devices,
      groups,
      filteredDevices,
      onlineDevices,
      targetApps,
      matchingApps,
      connected,
      connectionError,
      view,
      target,
      scope,
      selectedGroupId,
      selectedIds,
      newGroupName,
      recipientLabel,
      query,
      wallColumns,
      frames,
      logs,
      errorToast,
      remoteText,
      form,
      appQuery,
      appPickerOpen,
      script,
      presetName,
      presets,
      serverPresets,
      selectedServerPreset,
      presetParameters,
      interactionMode,
      interactionModes,
      nurtureStrategy,
      ocrKeywords,
      visiblePresetParameters,
      activeRun,
      currentUser,
      adminUsers,
      adminDevices,
      newUser,
      modal,
      bulkText,
      bulkRole,
      bulkResult,
      enrollments,
      enrollmentName,
      newDeviceToken,
      automationMode,
      newBlockType,
      blocks,
      blockCatalog,
      theme,
      toggleTheme,
      select,
      resizeWall,
      toggle,
      selectOnline,
      createGroup,
      assignGroup,
      deleteGroup,
      emitCommand,
      sendRemoteText,
      commandFromForm,
      chooseApp,
      screenTouchStart,
      screenTouchEnd,
      screenTouchCancel,
      runScript,
      runServerPreset,
      cancelScript,
      selectServerPreset,
      applyInteractionMode,
      savePreset,
      removePreset,
      loadPreset,
      openAdmin,
      createUser,
      createBulkUsers,
      updateUser,
      changePassword,
      deleteUser,
      assignDevice,
      logout,
      formatTime,
      clearLogs,
      closeModal,
      submitModal,
      addBlock,
      removeBlock,
      moveBlock,
      syncScript,
      importScript,
      loadEnrollments,
      createEnrollment,
      removeEnrollment,
      copyDeviceToken,
    };
  },
}).mount("#app");
