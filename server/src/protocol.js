const TYPES = new Set([
  "openApp",
  "tap",
  "tapRelative",
  "swipe",
  "swipeRelative",
  "inputText",
  "globalAction",
]);

export function validCommand(command) {
  if (!command || !TYPES.has(command.type)) return false;
  if (command.type === "openApp")
    return /^[a-zA-Z][\w]*(\.[\w]+)+$/.test(command.packageName || "");
  if (command.type === "tap")
    return (
      Number.isFinite(command.x) &&
      Number.isFinite(command.y) &&
      command.x >= 0 &&
      command.y >= 0 &&
      command.x <= 100_000 &&
      command.y <= 100_000
    );
  if (command.type === "tapRelative")
    return (
      Number.isFinite(command.x) &&
      Number.isFinite(command.y) &&
      command.x >= 0 &&
      command.y >= 0 &&
      command.x <= 1 &&
      command.y <= 1
    );
  if (command.type === "swipe")
    return (
      [command.x1, command.y1, command.x2, command.y2].every(Number.isFinite) &&
      [command.x1, command.y1, command.x2, command.y2].every(
        (value) => value >= 0 && value <= 100_000,
      ) &&
      Number.isInteger(command.duration) &&
      command.duration >= 100 &&
      command.duration <= 5_000
    );
  if (command.type === "swipeRelative")
    return (
      [command.x1, command.y1, command.x2, command.y2].every(Number.isFinite) &&
      [command.x1, command.y1, command.x2, command.y2].every(
        (value) => value >= 0 && value <= 1,
      ) &&
      Number.isInteger(command.duration) &&
      command.duration >= 100 &&
      command.duration <= 5_000
    );
  if (command.type === "inputText")
    return typeof command.text === "string" && command.text.length <= 2000;
  return ["BACK", "HOME", "RECENTS", "NOTIFICATIONS"].includes(command.action);
}

export function publicDevice(device) {
  const { socketId, ...safe } = device;
  return safe;
}
