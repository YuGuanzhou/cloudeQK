import { validCommand } from "./protocol.js";

const ACTIONS = new Set(["BACK", "HOME", "RECENTS", "NOTIFICATIONS"]);

export function parseAutomation(source) {
  if (typeof source !== "string" || source.length > 20_000) throw new Error("脚本过长");
  const steps = [];
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let step;
    const [name = "", ...rest] = line.split(/\s+/);
    const op = name.toUpperCase();
    if (op === "WAIT" && rest.length === 1) step = { wait: Number(rest[0]) };
    else if (op === "OPEN" && rest.length === 1) step = { command: { type: "openApp", packageName: rest[0] } };
    else if (op === "TAP" && rest.length === 2) step = { command: { type: "tap", x: Number(rest[0]), y: Number(rest[1]) } };
    else if (op === "SWIPE" && (rest.length === 4 || rest.length === 5)) step = { command: { type: "swipe", x1: Number(rest[0]), y1: Number(rest[1]), x2: Number(rest[2]), y2: Number(rest[3]), duration: Number(rest[4] || 300) } };
    else if (op === "TEXT") step = { command: { type: "inputText", text: line.slice(name.length).trim() } };
    else if (ACTIONS.has(op) && rest.length === 0) step = { command: { type: "globalAction", action: op } };
    else throw new Error(`第 ${index + 1} 行指令无效`);
    if (step.wait !== undefined && (!Number.isInteger(step.wait) || step.wait < 0 || step.wait > 60_000)) throw new Error(`第 ${index + 1} 行等待时间应为 0-60000 毫秒`);
    if (step.command && !validCommand(step.command)) throw new Error(`第 ${index + 1} 行参数无效`);
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
    if (step.wait !== undefined) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, step.wait);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("脚本已取消")); }, { once: true });
    });
    else await execute(step.command, i);
  }
}
