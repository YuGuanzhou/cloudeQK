import crypto from "node:crypto";
import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "Yu789321",
  database: process.env.DB_NAME || "cloudeqk",
  waitForConnections: true,
  connectionLimit: 10
});

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}

export async function initDb() {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "Yu789321" });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || "cloudeqk"}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end();
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password_hash VARCHAR(200) NOT NULL,
    role ENUM('admin','user') NOT NULL DEFAULT 'user', banned BOOLEAN NOT NULL DEFAULT FALSE,
    max_devices INT UNSIGNED NOT NULL DEFAULT 5, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL, last_login_ip VARCHAR(45) NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX (user_id), INDEX (expires_at)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS devices (
    device_id VARCHAR(128) PRIMARY KEY, user_id CHAR(36) NULL, model VARCHAR(100), android_version VARCHAR(30),
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX (user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS device_enrollments (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, name VARCHAR(80) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE, bound_device_id VARCHAR(128) NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_connected_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, INDEX (user_id)
  )`);
  const username = process.env.ADMIN_USERNAME || "admin";
  const [rows] = await pool.query("SELECT id FROM users WHERE username=?", [username]);
  if (!rows.length) await pool.query("INSERT INTO users (id,username,password_hash,role,max_devices) VALUES (?,?,?,?,?)", [crypto.randomUUID(), username, hashPassword(process.env.ADMIN_PASSWORD || "Admin123456"), "admin", 100]);
}

export const publicUser = user => ({ id: user.id, username: user.username, role: user.role, banned: Boolean(user.banned), maxDevices: user.max_devices, deviceCount: Number(user.device_count || 0), createdAt: user.created_at, updatedAt: user.updated_at, lastLoginAt: user.last_login_at, lastLoginIp: user.last_login_ip });
