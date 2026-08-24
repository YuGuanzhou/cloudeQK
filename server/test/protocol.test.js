import test from "node:test";
import assert from "node:assert/strict";
import { validCommand } from "../src/protocol.js";
import { parseAutomation } from "../src/automation.js";

test("only accepts supported, bounded commands", () => {
  assert.equal(validCommand({ type: "tap", x: 1, y: 2 }), true);
  assert.equal(validCommand({ type: "openApp", packageName: "com.example.app" }), true);
  assert.equal(validCommand({ type: "tap", x: 100_001, y: 2 }), false);
  assert.equal(validCommand({ type: "tapRelative", x: 0.5, y: 0.25 }), true);
  assert.equal(validCommand({ type: "tapRelative", x: 1.1, y: 0.25 }), false);
  assert.equal(validCommand({ type: "swipeRelative", x1: 0.5, y1: 0.8, x2: 0.5, y2: 0.2, duration: 300 }), true);
  assert.equal(validCommand({ type: "globalAction", action: "WIPE" }), false);
  assert.equal(validCommand({ type: "script", code: "anything" }), false);
});

test("parses the bounded automation DSL", () => {
  assert.deepEqual(parseAutomation("# demo\nOPEN com.example.app\nWAIT 500\nTAP 10 20\nTEXT hello world\nBACK"), [
    { command: { type: "openApp", packageName: "com.example.app" } }, { wait: 500 },
    { command: { type: "tap", x: 10, y: 20 } }, { command: { type: "inputText", text: "hello world" } },
    { command: { type: "globalAction", action: "BACK" } }
  ]);
  assert.throws(() => parseAutomation("WAIT 999999"), /等待时间/);
  assert.throws(() => parseAutomation("SHELL rm"), /指令无效/);
  assert.deepEqual(parseAutomation("SWIPE 10 20 30 40 500"), [{ command: { type: "swipe", x1: 10, y1: 20, x2: 30, y2: 40, duration: 500 } }]);
});
