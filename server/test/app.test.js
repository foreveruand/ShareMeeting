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
    userToken: createSession(database, "user", userId, USER_SESSION_SECONDS),
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

function insertRoom(database, overrides = {}) {
  const now = Date.now();
  const room = {
    id: randomUUID(),
    title: "A-101",
    categoryId: "default",
    categoryName: "",
    cancelSetting: 1,
    editSetting: 1,
    forms: [],
    reservationForms: [{ mark: "name", type: "text", must: true }, { mark: "tel", type: "mobile", must: false }],
    ...overrides,
  };
  database
    .prepare(
      `INSERT INTO rooms
       (id, title, category_id, category_name, cancel_setting, edit_setting, approval_required,
        sort_order, forms_json, room_data_json, reservation_forms_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 9999, ?, '{}', ?, ?, ?)`,
    )
    .run(
      room.id,
      room.title,
      room.categoryId,
      room.categoryName,
      room.cancelSetting,
      room.editSetting,
      JSON.stringify(room.forms),
      JSON.stringify(room.reservationForms),
      now,
      now,
    );
  return room;
}

function insertReservation(database, userId, roomId, overrides = {}) {
  const now = Date.now();
  const reservation = {
    id: randomUUID(),
    day: "2026-09-01",
    start: "09:00",
    end: "09:30",
    endPoint: "10:00",
    status: 1,
    forms: [{ mark: "name", val: "Planning" }],
    ...overrides,
  };
  database
    .prepare(
      `INSERT INTO reservations
       (id, room_id, user_id, day, start_time, end_time, end_point, status, forms_json,
        reservation_data_json, last_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reservation.id,
      roomId,
      userId,
      reservation.day,
      reservation.start,
      reservation.end,
      reservation.endPoint,
      reservation.status,
      JSON.stringify(reservation.forms),
      JSON.stringify({ name: reservation.forms.find((form) => form.mark === "name")?.val || "" }),
      now,
      now,
      now,
    );
  return reservation;
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
      order: 0,
      checkSet: 0,
      cancelSet: 1,
      editSet: 1,
      forms: [{ mark: "capacity", val: "12" }],
      joinForms: [
        { mark: "subject", val: "" },
        { mark: "tel", type: "mobile", must: true },
      ],
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
  assert.equal(rooms.data.list[0].ENROLL_CATE_ID, "default");
  assert.equal(rooms.data.list[0].ENROLL_ORDER, 0);
  assert.equal(rooms.data.list[0].ENROLL_JOIN_CNT, 1);

  const detail = await callRoute(
    server,
    "admin/enroll_detail",
    { id: roomId },
    context.administratorToken,
  );
  assert.equal(detail.code, 200);
  assert.equal(detail.data.ENROLL_JOIN_FORMS[1].must, false);

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
  const result = await callRoute(
    server,
    "passport/register",
    { name: "Alice", forms: [] },
    context.userToken,
  );
  assert.equal(result.code, 200);
  assert.equal(result.data.token.status, 0);
  assert.ok(result.data.token.accessToken);
  assert.notEqual(result.data.token.accessToken, context.userToken);
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

test("visible Mini Program routes satisfy the self-hosted contract", async (testContext) => {
  const context = createTestContext();
  const server = context.app.listen(0);
  testContext.after(() => {
    server.close();
    context.database.close();
  });

  const room = insertRoom(context.database, {
    title: "North Room",
    reservationForms: [{ mark: "name", type: "text", must: true }, { mark: "tel", type: "mobile", must: true }],
  });
  const reservation = insertReservation(context.database, context.userId, room.id, {
    forms: [{ mark: "name", val: "Quarterly Planning" }, { mark: "tel", val: "13800138000" }],
  });
  insertReservation(context.database, context.userId, room.id, {
    start: "13:00",
    end: "13:30",
    endPoint: "14:00",
    forms: [{ mark: "desc", val: "Confidential description" }, { mark: "tel", val: "13800138000" }],
  });

  const responses = await Promise.all([
    callRoute(server, "passport/my_detail", {}, context.userToken),
    callRoute(server, "enroll/list", {}, context.userToken),
    callRoute(server, "enroll/view", { id: room.id }, context.userToken),
    callRoute(server, "enroll/day", { enrollId: room.id, day: reservation.day }, context.userToken),
    callRoute(server, "enroll/all_has_day", { day: reservation.day }, context.userToken),
    callRoute(server, "enroll/all_day", { day: reservation.day }, context.userToken),
    callRoute(
      server,
      "enroll/detail_for_join",
      { enrollId: room.id, enrollJoinId: reservation.id },
      context.userToken,
    ),
    callRoute(server, "enroll/my_join_list", {}, context.userToken),
    callRoute(server, "enroll/my_join_detail", { enrollJoinId: reservation.id }, context.userToken),
    callRoute(
      server,
      "enroll/join",
      {
        enrollId: room.id,
        day: "2026-09-02",
        start: "11:00",
        end: "11:30",
        endPoint: "12:00",
        forms: [{ mark: "name", val: "Optional phone" }, { mark: "tel", val: "" }],
      },
      context.userToken,
    ),
  ]);

  for (const response of responses) assert.equal(response.code, 200);
  assert.deepEqual(
    responses[3].data.map((reservation) => reservation.title),
    ["Quarterly Planning", "已预约"],
  );
  assert.equal(responses[6].data.ENROLL_JOIN_FORMS[1].must, false);

  const invalidPhone = await callRoute(
    server,
    "enroll/join",
    {
      enrollId: room.id,
      day: "2026-09-02",
      start: "13:00",
      end: "13:30",
      endPoint: "14:00",
      forms: [{ mark: "name", val: "Invalid phone" }, { mark: "tel", val: "123" }],
    },
    context.userToken,
  );
  assert.equal(invalidPhone.code, 1600);
  assert.match(invalidPhone.msg, /联系电话/);
});

test("editing a reservation updates its time and form data atomically", async (testContext) => {
  const context = createTestContext();
  const server = context.app.listen(0);
  testContext.after(() => {
    server.close();
    context.database.close();
  });

  const room = insertRoom(context.database);
  const reservation = insertReservation(context.database, context.userId, room.id);
  const availableSlots = await callRoute(
    server,
    "enroll/day",
    { enrollId: room.id, enrollJoinId: reservation.id, day: reservation.day },
    context.userToken,
  );
  assert.equal(availableSlots.code, 200);
  assert.deepEqual(availableSlots.data, []);
  const result = await callRoute(
    server,
    "enroll/join_edit",
    {
      enrollId: room.id,
      enrollJoinId: reservation.id,
      day: "2026-09-01",
      start: "13:00",
      end: "13:30",
      endPoint: "14:00",
      forms: [{ mark: "name", val: "Updated Planning" }, { mark: "tel", val: "13800138000" }],
    },
    context.userToken,
  );
  assert.equal(result.code, 200);

  const updated = context.database.prepare("SELECT * FROM reservations WHERE id = ?").get(reservation.id);
  assert.equal(updated.day, "2026-09-01");
  assert.equal(updated.start_time, "13:00");
  assert.equal(updated.end_time, "13:30");
  assert.equal(updated.end_point, "14:00");
  assert.deepEqual(JSON.parse(updated.forms_json), [
    { mark: "name", val: "Updated Planning" },
    { mark: "tel", val: "13800138000" },
  ]);
});

test("editing a reservation supports moving it to another date", async (testContext) => {
  const context = createTestContext();
  const server = context.app.listen(0);
  testContext.after(() => {
    server.close();
    context.database.close();
  });

  const room = insertRoom(context.database);
  const reservation = insertReservation(context.database, context.userId, room.id);
  const result = await callRoute(
    server,
    "enroll/join_edit",
    {
      enrollId: room.id,
      enrollJoinId: reservation.id,
      day: "2026-09-03",
      start: "15:00",
      end: "15:30",
      endPoint: "16:00",
      forms: [{ mark: "name", val: "Moved meeting" }],
    },
    context.userToken,
  );
  assert.equal(result.code, 200);

  const updated = context.database.prepare("SELECT day, start_time FROM reservations WHERE id = ?").get(reservation.id);
  assert.deepEqual(updated, { day: "2026-09-03", start_time: "15:00" });
});

test("editing a reservation rejects a conflicting time without changing it", async (testContext) => {
  const context = createTestContext();
  const server = context.app.listen(0);
  testContext.after(() => {
    server.close();
    context.database.close();
  });

  const room = insertRoom(context.database);
  const reservation = insertReservation(context.database, context.userId, room.id);
  insertReservation(context.database, context.userId, room.id, {
    start: "11:00",
    end: "11:30",
    endPoint: "12:00",
  });
  const result = await callRoute(
    server,
    "enroll/join_edit",
    {
      enrollId: room.id,
      enrollJoinId: reservation.id,
      day: "2026-09-01",
      start: "11:30",
      end: "12:00",
      endPoint: "12:30",
      forms: [{ mark: "name", val: "Should not update" }],
    },
    context.userToken,
  );
  assert.equal(result.code, 1600);
  assert.match(result.msg, /已被预约/);

  const unchanged = context.database.prepare("SELECT start_time, forms_json FROM reservations WHERE id = ?").get(reservation.id);
  assert.equal(unchanged.start_time, "09:00");
  assert.deepEqual(JSON.parse(unchanged.forms_json), [{ mark: "name", val: "Planning" }]);
});

test("editing a reservation preserves existing permission rules", async (testContext) => {
  const context = createTestContext();
  const server = context.app.listen(0);
  testContext.after(() => {
    server.close();
    context.database.close();
  });

  const room = insertRoom(context.database, { editSetting: 0 });
  const reservation = insertReservation(context.database, context.userId, room.id);
  const result = await callRoute(
    server,
    "enroll/join_edit",
    {
      enrollId: room.id,
      enrollJoinId: reservation.id,
      day: "2026-09-02",
      start: "13:00",
      end: "13:30",
      endPoint: "14:00",
      forms: [{ mark: "name", val: "Blocked update" }],
    },
    context.userToken,
  );
  assert.equal(result.code, 1600);
  assert.match(result.msg, /不允许修改/);

  const unchanged = context.database.prepare("SELECT day, start_time FROM reservations WHERE id = ?").get(reservation.id);
  assert.deepEqual(unchanged, { day: "2026-09-01", start_time: "09:00" });
});
