import test from "node:test";
import assert from "node:assert/strict";
import { validCommand } from "../src/protocol.js";
import {
  buildAutomationPreset,
  buildKeywordPreset,
  matchesKeywords,
  parseAutomation,
  runAutomation,
} from "../src/automation.js";
import { friendlyDeviceToken } from "../src/auth.js";

test("only accepts supported, bounded commands", () => {
  assert.equal(
    validCommand({
      type: "tap",
      x: 1,
      y: 2,
    }),
    true,
  );
  assert.equal(
    validCommand({
      type: "openApp",
      packageName: "com.example.app",
    }),
    true,
  );
  assert.equal(
    validCommand({
      type: "tap",
      x: 100_001,
      y: 2,
    }),
    false,
  );
  assert.equal(
    validCommand({
      type: "doubleTapRelative",
      x: 0.5,
      y: 0.5,
    }),
    true,
  );
  assert.equal(
    validCommand({
      type: "tapRelative",
      x: 0.5,
      y: 0.25,
    }),
    true,
  );
  assert.equal(
    validCommand({
      type: "tapRelative",
      x: 1.1,
      y: 0.25,
    }),
    false,
  );
  assert.equal(
    validCommand({
      type: "swipeRelative",
      x1: 0.5,
      y1: 0.8,
      x2: 0.5,
      y2: 0.2,
      duration: 300,
    }),
    true,
  );
  assert.equal(
    validCommand({
      type: "globalAction",
      action: "WIPE",
    }),
    false,
  );
  assert.equal(
    validCommand({
      type: "script",
      code: "anything",
    }),
    false,
  );
});

test("parses the bounded automation DSL", () => {
  assert.deepEqual(
    parseAutomation(
      "# demo\nOPEN com.example.app\nWAIT 500\nTAP 10 20\nTEXT hello world\nBACK",
    ),
    [
      {
        command: {
          type: "openApp",
          packageName: "com.example.app",
        },
      },
      {
        wait: 500,
      },
      {
        command: {
          type: "tap",
          x: 10,
          y: 20,
        },
      },
      {
        command: {
          type: "inputText",
          text: "hello world",
        },
      },
      {
        command: {
          type: "globalAction",
          action: "BACK",
        },
      },
    ],
  );
  assert.throws(() => parseAutomation("WAIT 999999"), /等待时间/);
  assert.throws(() => parseAutomation("SHELL rm"), /指令无效/);
  assert.deepEqual(parseAutomation("SWIPE 10 20 30 40 500"), [
    {
      command: {
        type: "swipe",
        x1: 10,
        y1: 20,
        x2: 30,
        y2: 40,
        duration: 500,
      },
    },
  ]);
});

test("generates short alphanumeric device tokens", () => {
  for (let index = 0; index < 100; index += 1)
    assert.match(friendlyDeviceToken(), /^[A-Za-z0-9]{3,5}$/);
});

test("builds bounded server presets", () => {
  const steps = buildAutomationPreset("douyin-test", {
    count: 2,
    staySeconds: 5,
    swipeDuration: 400,
    likeEvery: 1,
    followEvery: 0,
    commentEvery: 1,
    comments: "甲\n乙",
  });
  assert.equal(steps[0].command.packageName, "com.ss.android.ugc.aweme");
  assert.equal(
    steps.find((step) => step.command?.type === "swipeRelative").command.y2,
    0.32,
  );
  assert.equal(
    steps.some(
      (step) =>
        step.command?.type === "doubleTapRelative" &&
        step.command.x === 0.5 &&
        step.command.y === 0.5,
    ),
    true,
  );
  assert.equal(
    steps.some((step) => step.command?.type === "inputText"),
    true,
  );
  assert.equal(steps.at(-1).command.action, "HOME");
  assert.equal(
    new Set(
      steps
        .filter((step) => step.command?.type === "inputText")
        .map((step) => step.command.text),
    ).size,
    steps.filter((step) => step.command?.type === "inputText").length,
  );
  assert.throws(
    () =>
      buildAutomationPreset("xiaohongshu-test", {
        count: 1001,
      }),
    /测试内容数/,
  );
  assert.throws(
    () => buildAutomationPreset("xiaohongshu-test", { count: 0 }),
    /-1 或 1-1000/,
  );
  assert.throws(() => buildAutomationPreset("unknown"), /不存在/);
});

test("runs an infinite preset until cancelled", async () => {
  const steps = buildAutomationPreset("douyin-test", {
    count: -1,
    staySeconds: 2,
    likeEvery: 0,
    followEvery: 0,
    commentEvery: 0,
  });
  assert.equal(steps.at(-1).repeat.length, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runAutomation(steps, async () => {}, controller.signal),
    /脚本已取消/,
  );
});

test("validates keyword OCR presets", () => {
  const preset = buildKeywordPreset("douyin-test", { keywords: "露营，户外", count: 10 });
  assert.deepEqual(preset.keywords, ["露营", "户外"]);
  assert.equal("likePoint" in preset, false);
  assert.deepEqual(preset.swipeStart, { x: 0.5, y: 0.68 });
  assert.deepEqual(preset.swipeEnd, { x: 0.5, y: 0.32 });
  assert.throws(() => buildKeywordPreset("douyin-test", { keywords: "露营", swipeDuration: 50 }), /滑动时长/);
  assert.throws(() => buildKeywordPreset("douyin-test", { keywords: "" }), /关键词/);
  assert.equal(matchesKeywords("正在\n露 营", preset.keywords), true);
  assert.equal(matchesKeywords("城市夜景", preset.keywords), false);
});
