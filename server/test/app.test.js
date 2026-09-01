const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const { createSession } = require("../src/auth");
const { createApp, USER_SESSION_SECONDS } = require("../src/app");
const { createDatabase } = require("../src/database");

function createTestContext() {
  const database = createDatabase(":memory:");
  const now = Date.now();
  const administratorId = randomUUID();
  const userId = randomUUID();
  database
    .prepare(
      `INSERT INTO administrators
       (id, username, display_name, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(administratorId, "admin", "Administrator", "unused", "super_admin", 1, now, now);
  database
    .prepare(
      `INSERT INTO users
       (id, wechat_openid, name, is_registered, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, "openid", "Alice", 1, 1, now, now);

  return {
    administratorToken: createSession(database, "administrator", administratorId, 3600),
    app: createApp({ database, wechatClient: { exchangeCode: async () => ({ openid: "unused" }) } }),
    database,
    userId,
  };
}

async function callRoute(app, route, params, token) {
  const response = await fetch(`http://127.0.0.1:${app.address().port}/api/routes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ route, params }),
  });
  return response.json();
}

test("admin meeting-room routes create rooms and list reservations", async (testContext) => {
  const context = createTestContext();
  const server = context.app.listen(0);
  testContext.after(() => {
    server.close();
    context.database.close();
  });

  const created = await callRoute(
    server,
    "admin/enroll_insert",
    {
      title: "A-101",
      cateId: "1",
      cateName: "A区",
      order: 0,
      checkSet: 0,
      cancelSet: 1,
      editSet: 1,
      forms: [{ mark: "capacity", val: "12" }],
      joinForms: [{ mark: "subject", val: "" }],
    },
    context.administratorToken,
  );
  assert.equal(created.code, 200);
  assert.ok(created.data.id);

  const roomId = created.data.id;
  const now = Date.now();
  context.database
    .prepare(
      `INSERT INTO reservations
       (id, room_id, user_id, day, start_time, end_time, end_point, status, forms_json,
        reservation_data_json, last_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      roomId,
      context.userId,
      "2026-09-01",
      "09:00",
      "10:00",
      "10:00",
      1,
      "[]",
      "{}",
      now,
      now,
      now,
    );

  const rooms = await callRoute(server, "admin/enroll_list", {}, context.administratorToken);
  assert.equal(rooms.code, 200);
  assert.equal(rooms.data.list[0].ENROLL_TITLE, "A-101");
  assert.equal(rooms.data.list[0].ENROLL_ORDER, 0);
  assert.equal(rooms.data.list[0].ENROLL_JOIN_CNT, 1);

  const reservations = await callRoute(
    server,
    "admin/enroll_join_list",
    { enrollId: roomId },
    context.administratorToken,
  );
  assert.equal(reservations.code, 200);
  assert.equal(reservations.data.total, 1);
  assert.equal(reservations.data.list[0].user.USER_NAME, "Alice");
});

test("registration refreshes the user access token", async (testContext) => {
  const context = createTestContext();
  const server = context.app.listen(0);
  testContext.after(() => {
    server.close();
    context.database.close();
  });
  const userToken = createSession(context.database, "user", context.userId, USER_SESSION_SECONDS);

  const result = await callRoute(
    server,
    "passport/register",
    { name: "Alice", forms: [] },
    userToken,
  );
  assert.equal(result.code, 200);
  assert.equal(result.data.token.status, 0);
  assert.ok(result.data.token.accessToken);
  assert.notEqual(result.data.token.accessToken, userToken);
});

test("wechat login creates a session and protects admin routes", async (testContext) => {
  const database = createDatabase(":memory:");
  const app = createApp({
    database,
    wechatClient: { exchangeCode: async (code) => ({ openid: `openid-${code}` }) },
  });
  const server = app.listen(0);
  testContext.after(() => {
    server.close();
    database.close();
  });

  const loginResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/wechat-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "test-code" }),
  });
  const login = await loginResponse.json();
  assert.equal(login.code, 200);
  assert.ok(login.data.token.accessToken);

  const unauthorized = await callRoute(server, "admin/enroll_list", {}, login.data.token.accessToken);
  assert.equal(unauthorized.code, 2401);
});
