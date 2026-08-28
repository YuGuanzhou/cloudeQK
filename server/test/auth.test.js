import test from "node:test";
import assert from "node:assert/strict";
import { sessionCookie } from "../src/auth.js";

test("only marks HTTPS session cookies as secure", () => {
  assert.doesNotMatch(sessionCookie("token", false), /; Secure/);
  assert.match(sessionCookie("token", true), /; Secure/);
});
