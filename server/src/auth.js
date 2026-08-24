import crypto from "node:crypto";
import { pool, publicUser } from "./db.js";

const COOKIE = "cloudeqk_session";
const digest = token => crypto.createHash("sha256").update(token).digest("hex");

function cookieToken(req) {
  const match = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export async function currentUser(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const [rows] = await pool.query(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.banned=0`, [digest(token)]);
  return rows[0] || null;
}

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 7 DAY))", [digest(token), userId]);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}

export async function destroySession(req, res) {
  const token = cookieToken(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash=?", [digest(token)]);
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

export async function requireUser(req, res, next) {
  try { const user = await currentUser(req); if (!user) return res.status(401).json({ error: "请先登录" }); req.user = user; next(); }
  catch (error) { next(error); }
}

export function requireAdmin(req, res, next) { return req.user?.role === "admin" ? next() : res.status(403).json({ error: "需要管理员权限" }); }
export const me = user => publicUser(user);

export function friendlyDeviceToken() {
  const consonants = "bcdfghjkmnprstvwxyz", vowels = "aeiou";
  const word = () => [consonants, vowels, consonants, vowels, consonants, vowels, consonants].map(chars => chars[crypto.randomInt(chars.length)]).join("");
  return `${word()}-${word()}-${word()}`;
}
