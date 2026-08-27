import { validCommand } from "./protocol.js";
import crypto from "node:crypto";

const ACTIONS = new Set(["BACK", "HOME", "RECENTS", "NOTIFICATIONS"]);

export const automationPresets = [
  {
    id: "douyin-test",
    name: "抖音测试互动",
    app: "抖音测试版",
    parameters: testParameters("douyin"),
  },
  {
    id: "xiaohongshu-test",
    name: "小红书测试互动",
    app: "小红书测试版",
    parameters: testParameters("xiaohongshu"),
  },
];

const PRESET_PACKAGES = {
  "douyin-test": "com.ss.android.ugc.aweme",
  "xiaohongshu-test": "com.xingin.xhs",
};

function testParameters(app) {
  const points =
    app === "douyin"
      ? {
          like: "0.90,0.55",
          follow: "0.90,0.38",
          comment: "0.50,0.93",
          send: "0.92,0.93",
        }
      : {
          like: "0.88,0.88",
          follow: "0.50,0.12",
          comment: "0.45,0.95",
          send: "0.92,0.95",
        };
  return {
    count: {
      label: "测试内容数",
      min: 1,
      max: 20,
      default: 5,
    },
    startDelaySeconds: {
      label: "启动等待（秒）",
      min: 1,
      max: 30,
      default: 3,
    },
    staySeconds: {
      label: "每条停留（秒）",
      min: 2,
      max: 60,
      default: 5,
    },
    actionDelayMs: {
      label: "动作间隔（毫秒）",
      min: 300,
      max: 5000,
      default: 700,
    },
    swipeDuration: {
      label: "滑动时长（毫秒）",
      min: 200,
      max: 1500,
      default: 450,
    },
    likeEvery: {
      label: "每几条点赞（0关闭）",
      min: 0,
      max: 20,
      default: 2,
    },
    followEvery: {
      label: "每几条关注（0关闭）",
      min: 0,
      max: 20,
      default: 0,
    },
    commentEvery: {
      label: "每几条评论（0关闭）",
      min: 0,
      max: 20,
      default: 3,
    },
    maxLikes: {
      label: "点赞上限",
      min: 0,
      max: 20,
      default: 3,
    },
    maxFollows: {
      label: "关注上限",
      min: 0,
      max: 20,
      default: 1,
    },
    maxComments: {
      label: "评论上限",
      min: 0,
      max: 20,
      default: 2,
    },
    likePoint: {
      type: "text",
      label: "点赞坐标 X,Y",
      default: points.like,
    },
    followPoint: {
      type: "text",
      label: "关注坐标 X,Y",
      default: points.follow,
    },
    commentPoint: {
      type: "text",
      label: "评论框坐标 X,Y",
      default: points.comment,
    },
    sendPoint: {
      type: "text",
      label: "发送按钮坐标 X,Y",
      default: points.send,
    },
    swipeStart: {
      type: "text",
      label: "滑动起点 X,Y",
      default: "0.50,0.78",
    },
    swipeEnd: {
      type: "text",
      label: "滑动终点 X,Y",
      default: "0.50,0.25",
    },
    returnHome: {
      type: "boolean",
      label: "结束后返回桌面",
      default: true,
    },
    comments: {
      type: "textarea",
      label: "评论预设库（每行一条，单次运行不重复）",
      default: "测试评论一\n测试评论二\n测试评论三",
    },
  };
}

function point(value, label) {
  const values = String(value).split(",").map(Number);
  if (
    values.length !== 2 ||
    values.some((item) => !Number.isFinite(item) || item < 0 || item > 1)
  )
    throw new Error(`${label}应为 0-1 范围的 X,Y`);
  return {
    x: values[0],
    y: values[1],
  };
}

export function buildAutomationPreset(id, values = {}) {
  const preset = automationPresets.find((item) => item.id === id);
  if (!preset) throw new Error("自动化预设不存在");
  const params = Object.fromEntries(
    Object.entries(preset.parameters).map(([key, rule]) => {
      if (rule.type === "boolean")
        return [
          key,
          values[key] === undefined ? rule.default : values[key] === true,
        ];
      if (rule.type) return [key, String(values[key] ?? rule.default).trim()];
      const value = Number(values[key] ?? rule.default);
      if (!Number.isInteger(value) || value < rule.min || value > rule.max)
        throw new Error(`${rule.label}应为 ${rule.min}-${rule.max} 的整数`);
      return [key, value];
    }),
  );
  const points = Object.fromEntries(
    [
      "likePoint",
      "followPoint",
      "commentPoint",
      "sendPoint",
      "swipeStart",
      "swipeEnd",
    ].map((key) => [key, point(params[key], preset.parameters[key].label)]),
  );
  const comments = params.comments
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (comments.length > 50 || comments.some((item) => item.length > 100))
    throw new Error("评论库最多 50 条，每条最多 100 字");
  if (params.commentEvery && params.maxComments && !comments.length)
    throw new Error("启用评论时评论库不能为空");
  const commentPool = [...comments],
    counts = {
      likes: 0,
      follows: 0,
      comments: 0,
    };
  const steps = [
    {
      command: {
        type: "openApp",
        packageName: PRESET_PACKAGES[id],
      },
    },
    {
      wait: params.startDelaySeconds * 1000,
    },
  ];
  for (let index = 0; index < params.count; index++) {
    steps.push({
      wait: params.staySeconds * 1000,
    });
    const number = index + 1;
    if (
      params.likeEvery &&
      counts.likes < params.maxLikes &&
      number % params.likeEvery === 0
    ) {
      steps.push(
        {
          command: {
            type: "tapRelative",
            ...points.likePoint,
          },
        },
        {
          wait: params.actionDelayMs,
        },
      );
      counts.likes++;
    }
    if (
      params.followEvery &&
      counts.follows < params.maxFollows &&
      number % params.followEvery === 0
    ) {
      steps.push(
        {
          command: {
            type: "tapRelative",
            ...points.followPoint,
          },
        },
        {
          wait: params.actionDelayMs,
        },
      );
      counts.follows++;
    }
    if (
      params.commentEvery &&
      counts.comments < params.maxComments &&
      commentPool.length &&
      number % params.commentEvery === 0
    ) {
      const comment = commentPool.splice(
        crypto.randomInt(commentPool.length),
        1,
      )[0];
      steps.push(
        {
          command: {
            type: "tapRelative",
            ...points.commentPoint,
          },
        },
        {
          wait: params.actionDelayMs,
        },
        {
          command: {
            type: "inputText",
            text: comment,
          },
        },
        {
          wait: params.actionDelayMs,
        },
        {
          command: {
            type: "tapRelative",
            ...points.sendPoint,
          },
        },
        {
          wait: params.actionDelayMs,
        },
      );
      counts.comments++;
    }
    if (index < params.count - 1)
      steps.push({
        command: {
          type: "swipeRelative",
          x1: points.swipeStart.x,
          y1: points.swipeStart.y,
          x2: points.swipeEnd.x,
          y2: points.swipeEnd.y,
          duration: params.swipeDuration,
        },
      });
  }
  if (params.returnHome)
    steps.push({
      command: {
        type: "globalAction",
        action: "HOME",
      },
    });
  return steps;
}

export function parseAutomation(source) {
  if (typeof source !== "string" || source.length > 20_000)
    throw new Error("脚本过长");
  const steps = [];
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let step;
    const [name = "", ...rest] = line.split(/\s+/);
    const op = name.toUpperCase();
    if (op === "WAIT" && rest.length === 1)
      step = {
        wait: Number(rest[0]),
      };
    else if (op === "OPEN" && rest.length === 1)
      step = {
        command: {
          type: "openApp",
          packageName: rest[0],
        },
      };
    else if (op === "TAP" && rest.length === 2)
      step = {
        command: {
          type: "tap",
          x: Number(rest[0]),
          y: Number(rest[1]),
        },
      };
    else if (op === "SWIPE" && (rest.length === 4 || rest.length === 5))
      step = {
        command: {
          type: "swipe",
          x1: Number(rest[0]),
          y1: Number(rest[1]),
          x2: Number(rest[2]),
          y2: Number(rest[3]),
          duration: Number(rest[4] || 300),
        },
      };
    else if (op === "TEXT")
      step = {
        command: {
          type: "inputText",
          text: line.slice(name.length).trim(),
        },
      };
    else if (ACTIONS.has(op) && rest.length === 0)
      step = {
        command: {
          type: "globalAction",
          action: op,
        },
      };
    else throw new Error(`第 ${index + 1} 行指令无效`);
    if (
      step.wait !== undefined &&
      (!Number.isInteger(step.wait) || step.wait < 0 || step.wait > 60_000)
    )
      throw new Error(`第 ${index + 1} 行等待时间应为 0-60000 毫秒`);
    if (step.command && !validCommand(step.command))
      throw new Error(`第 ${index + 1} 行参数无效`);
    steps.push(step);
    if (steps.length > 100) throw new Error("脚本最多 100 步");
  }
  if (!steps.length) throw new Error("脚本为空");
  return steps;
}

export async function runAutomation(steps, execute, signal) {
  for (let i = 0; i < steps.length; i++) {
    if (signal.aborted) throw new Error("脚本已取消");
    const step = steps[i];
    if (step.wait !== undefined)
      await new Promise((resolve, reject) => {
        const finish = () => {
          signal.removeEventListener("abort", cancel);
          resolve();
        };
        const timer = setTimeout(finish, step.wait);
        const cancel = () => {
          clearTimeout(timer);
          reject(new Error("脚本已取消"));
        };
        signal.addEventListener("abort", cancel, {
          once: true,
        });
      });
    else await execute(step.command, i);
  }
}
