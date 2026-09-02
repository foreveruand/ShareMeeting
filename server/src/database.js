const Database = require("better-sqlite3");
const { mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

function createDatabase(databasePath) {
	mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);

  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      wechat_openid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      forms_json TEXT NOT NULL DEFAULT '[]',
      status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 8, 9)),
      check_reason TEXT NOT NULL DEFAULT '',
      is_registered INTEGER NOT NULL DEFAULT 0 CHECK (is_registered IN (0, 1)),
      login_count INTEGER NOT NULL DEFAULT 0,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS administrators (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'administrator')),
      principal_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expiry_index ON sessions (expires_at);

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
      category_id TEXT NOT NULL DEFAULT 'default',
      category_name TEXT NOT NULL DEFAULT '',
      cancel_setting INTEGER NOT NULL DEFAULT 1,
      edit_setting INTEGER NOT NULL DEFAULT 1,
      approval_required INTEGER NOT NULL DEFAULT 0 CHECK (approval_required IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 9999,
      is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
      forms_json TEXT NOT NULL DEFAULT '[]',
      room_data_json TEXT NOT NULL DEFAULT '{}',
      reservation_forms_json TEXT NOT NULL DEFAULT '[]',
      qr_url TEXT NOT NULL DEFAULT '',
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      end_point TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1, 99)),
      reason TEXT NOT NULL DEFAULT '',
      forms_json TEXT NOT NULL DEFAULT '[]',
      reservation_data_json TEXT NOT NULL DEFAULT '{}',
      last_updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS reservations_room_day_index
      ON reservations (room_id, day, status, start_time, end_point);
    CREATE INDEX IF NOT EXISTS reservations_user_index ON reservations (user_id, created_at DESC);
  `);

  // Meeting-room reservations are confirmed immediately. User approval remains mandatory.
  database.prepare("UPDATE rooms SET approval_required = 0").run();
  database
    .prepare("UPDATE reservations SET status = 1, reason = '' WHERE status = 0")
    .run();

  return database;
}

module.exports = { createDatabase };
