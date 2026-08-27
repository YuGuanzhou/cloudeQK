import test from "node:test";
import assert from "node:assert/strict";
import { validCommand } from "../src/protocol.js";
import { buildAutomationPreset, parseAutomation } from "../src/automation.js";
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

test("generates readable, strong device tokens", () => {
  const tokens = new Set(
    Array.from(
      {
        length: 100,
      },
      friendlyDeviceToken,
    ),
  );
  assert.equal(tokens.size, 100);
  for (const token of tokens)
    assert.match(token, /^[a-z]{7}-[a-z]{7}-[a-z]{7}$/);
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
  assert.equal(steps[0].command.packageName, "com.ss.android.ugc.test");
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
  assert.equal(
    steps.some(
      (step) => step.command?.packageName === "com.ss.android.ugc.aweme",
    ),
    false,
  );
  assert.throws(
    () =>
      buildAutomationPreset("xiaohongshu-test", {
        count: 100,
      }),
    /测试内容数/,
  );
  assert.throws(
    () =>
      buildAutomationPreset("douyin-test", {
        likePoint: "2,0",
      }),
    /点赞坐标/,
  );
  assert.throws(() => buildAutomationPreset("unknown"), /不存在/);
});
