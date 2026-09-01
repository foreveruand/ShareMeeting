const {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID,
} = require("node:crypto");

const { ApiError } = require("./errors");

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, expectedDigest] = passwordHash.split(":");
  if (!salt || !expectedDigest) return false;

  const actualDigest = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(actualDigest, "hex"), Buffer.from(expectedDigest, "hex"));
}

function createSession(database, principalType, principalId, sessionTtlSeconds) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + sessionTtlSeconds * 1000;

  database
    .prepare("DELETE FROM sessions WHERE principal_type = ? AND principal_id = ?")
    .run(principalType, principalId);
  database
    .prepare(
      `INSERT INTO sessions (token_hash, principal_type, principal_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), principalType, principalId, expiresAt, now);

  return token;
}

function getBearerToken(request) {
  const authorization = request.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError("请先登录", 1401);
  return match[1];
}

function getSessionPrincipal(database, request, principalType) {
  const token = getBearerToken(request);
  const session = database
    .prepare(
      `SELECT principal_id
       FROM sessions
       WHERE token_hash = ? AND principal_type = ? AND expires_at > ?`,
    )
    .get(hashToken(token), principalType, Date.now());

  if (!session) throw new ApiError("登录状态已过期，请重新登录", principalType === "administrator" ? 2401 : 1401);
  return session.principal_id;
}

function bootstrapAdministrator(database, username, password) {
  const administratorCount = database.prepare("SELECT COUNT(*) AS count FROM administrators").get().count;
  if (administratorCount > 0 || !username || !password) return;

  if (username.length < 5 || username.length > 30 || password.length < 12) {
    throw new Error("Initial administrator credentials do not meet the minimum requirements.");
  }

  const now = Date.now();
  database
    .prepare(
      `INSERT INTO administrators
       (id, username, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'super_admin', ?, ?)`,
    )
    .run(randomUUID(), username, username, hashPassword(password), now, now);
}

module.exports = {
  bootstrapAdministrator,
  createSession,
  getSessionPrincipal,
  hashPassword,
  verifyPassword,
};
