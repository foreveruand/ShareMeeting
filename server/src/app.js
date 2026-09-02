const express = require("express");
const { randomUUID } = require("node:crypto");

const { createSession, getSessionPrincipal, verifyPassword } = require("./auth");
const { ApiError } = require("./errors");

const USER_STATUS = {
  PENDING: 0,
  ACTIVE: 1,
  REJECTED: 8,
  DISABLED: 9,
};

const RESERVATION_STATUS = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 99,
};

const USER_SESSION_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const DEFAULT_ROOM_CATEGORY_ID = "default";
const DEFAULT_ROOM_CATEGORY_NAME = "";

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toUserResponse(user) {
  if (!user.is_registered) return null;

  return {
    USER_ID: user.id,
    USER_NAME: user.name,
    USER_FORMS: parseJson(user.forms_json, []),
    USER_OBJ: formsToObject(parseJson(user.forms_json, [])),
    USER_STATUS: user.status,
    USER_CHECK_REASON: user.check_reason,
  };
}

function toUserToken(user, accessToken) {
  return {
    id: user.id,
    name: user.name,
    status: user.is_registered ? user.status : -1,
    accessToken,
  };
}

function toRoom(room) {
  return {
    _id: room.id,
    ENROLL_TITLE: room.title,
    ENROLL_STATUS: room.status,
    ENROLL_CATE_ID: room.category_id,
    ENROLL_CATE_NAME: room.category_name,
    ENROLL_CANCEL_SET: room.cancel_setting,
    ENROLL_EDIT_SET: room.edit_setting,
    ENROLL_CHECK_SET: room.approval_required,
    ENROLL_ORDER: room.sort_order,
    ENROLL_VOUCH: room.is_featured,
    ENROLL_FORMS: parseJson(room.forms_json, []),
    ENROLL_OBJ: parseJson(room.room_data_json, {}),
    ENROLL_JOIN_FORMS: normalizeReservationFields(parseJson(room.reservation_forms_json, [])),
    ENROLL_QR: room.qr_url,
    ENROLL_VIEW_CNT: room.view_count,
  };
}

function toReservation(reservation, roomTitle = "") {
  return {
    _id: reservation.id,
    ENROLL_JOIN_ENROLL_ID: reservation.room_id,
    ENROLL_JOIN_DAY: reservation.day,
    ENROLL_JOIN_START: reservation.start_time,
    ENROLL_JOIN_END: reservation.end_time,
    ENROLL_JOIN_END_POINT: reservation.end_point,
    ENROLL_JOIN_STATUS: reservation.status,
    ENROLL_JOIN_REASON: reservation.reason,
    ENROLL_JOIN_FORMS: parseJson(reservation.forms_json, []),
    ENROLL_JOIN_OBJ: parseJson(reservation.reservation_data_json, {}),
    ENROLL_JOIN_LAST_TIME: reservation.last_updated_at,
    ENROLL_JOIN_ADD_TIME: reservation.created_at,
    enroll: roomTitle ? { ENROLL_TITLE: roomTitle } : undefined,
  };
}

function formsToObject(forms) {
  return forms.reduce((result, form) => {
    if (form && typeof form.mark === "string") result[form.mark] = form.val;
    return result;
  }, {});
}

function reservationTitle(formsJson) {
  const forms = parseJson(formsJson, []);
  const form = Array.isArray(forms) ? forms.find((item) => item && item.mark === "name") : null;
  if (!form || form.val === undefined || form.val === null) return "已预约";
  const title = String(form.val).trim();
  return title || "已预约";
}

function asRequiredString(value, fieldName, maxLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new ApiError(`${fieldName}格式错误`);
  }
  return value.trim();
}

function asOptionalString(value, fieldName, maxLength = 200) {
  if (value === undefined || value === null || value === "") return "";
  return asRequiredString(value, fieldName, maxLength);
}

function asStatus(value, allowedStatuses) {
  const status = Number(value);
  if (!allowedStatuses.includes(status)) throw new ApiError("状态值无效");
  return status;
}

function asIntegerInRange(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ApiError(`${fieldName}格式错误`);
  }
  return number;
}

function asForms(value) {
  if (!Array.isArray(value) || value.length > 30) throw new ApiError("表单格式错误");
  return value;
}

function normalizeReservationFields(fields) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  return normalizedFields.map((field) => {
    if (!field || typeof field !== "object" || field.mark !== "tel") return field;
    return { ...field, must: false };
  });
}

function validateReservationForms(forms) {
  return asForms(forms).map((form) => {
    if (!form || typeof form !== "object") throw new ApiError("表单格式错误");
    if (form.mark !== "tel") return form;

    const value = form.val === undefined || form.val === null ? "" : String(form.val).trim();
    if (value && !/^1\d{10}$/.test(value)) throw new ApiError("联系电话格式错误");
    return { ...form, val: value };
  });
}

function asDay(value) {
  const day = asRequiredString(value, "预约日期", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00`))) {
    throw new ApiError("预约日期格式错误");
  }
  return day;
}

function asTime(value, fieldName) {
  const time = asRequiredString(value, fieldName, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError(`${fieldName}格式错误`);
  return time;
}

function paginate(items, params) {
  const page = Math.max(1, Number(params.page) || 1);
  const size = Math.min(100, Math.max(1, Number(params.size) || 20));
  const total = items.length;
  const start = (page - 1) * size;

  return {
    page,
    size,
    total,
    count: Math.ceil(total / size),
    list: items.slice(start, start + size),
  };
}

function dateTimeToMillis(day, time) {
  return Date.parse(`${day}T${time}:00`);
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function weekName(day) {
  return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${day}T00:00:00`).getDay()];
}

function createApp({ database, wechatClient }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  const success = (response, data) => response.json({ code: 200, msg: "", data });

  function getUser(request) {
    const userId = getSessionPrincipal(database, request, "user");
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) throw new ApiError("用户不存在，请重新登录", 1401);
    return user;
  }

  function requireApprovedUser(request) {
    const user = getUser(request);
    if (!user.is_registered) throw new ApiError("请先提交注册申请", 1403);
    if (user.status === USER_STATUS.PENDING) throw new ApiError("注册申请正在审核中", 1403);
    if (user.status === USER_STATUS.REJECTED) throw new ApiError("注册申请未通过审核", 1403);
    if (user.status === USER_STATUS.DISABLED) throw new ApiError("账号已被禁用", 1403);
    if (user.status !== USER_STATUS.ACTIVE) throw new ApiError("账号状态异常", 1403);
    return user;
  }

  function requireAdministrator(request) {
    const administratorId = getSessionPrincipal(database, request, "administrator");
    const administrator = database.prepare("SELECT * FROM administrators WHERE id = ?").get(administratorId);
    if (!administrator || !administrator.is_active) throw new ApiError("管理员登录状态已失效", 2401);
    return administrator;
  }

  function requireRoom(roomId) {
    const room = database.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
    if (!room) throw new ApiError("会议室不存在");
    return room;
  }

  function assertReservationWindowIsAvailable(roomId, day, startTime, endPoint, ignoredReservationId = "") {
    const reservations = database
      .prepare(
        `SELECT id, start_time, end_point
         FROM reservations
         WHERE room_id = ? AND day = ? AND status IN (?, ?)
           AND id <> ?`,
      )
      .all(roomId, day, RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED, ignoredReservationId);

    const requestedStart = dateTimeToMillis(day, startTime);
    const requestedEnd = dateTimeToMillis(day, endPoint);
    const conflicts = reservations.some((reservation) => {
      const existingStart = dateTimeToMillis(day, reservation.start_time);
      const existingEnd = dateTimeToMillis(day, reservation.end_point);
      return requestedStart < existingEnd && existingStart < requestedEnd;
    });

    if (conflicts) throw new ApiError("该时段已被预约，请选择其他时段");
  }

  async function dispatchRoute(request, route, params) {
    switch (route) {
      case "passport/my_detail": {
        return toUserResponse(getUser(request));
      }
      case "passport/register": {
        const user = getUser(request);
        const now = Date.now();
        const name = asRequiredString(params.name, "昵称", 30);
        const forms = asForms(params.forms || []);

        database
          .prepare(
            `UPDATE users
             SET name = ?, forms_json = ?, status = ?, check_reason = '', is_registered = 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(name, JSON.stringify(forms), USER_STATUS.PENDING, now, user.id);

        const updatedUser = database.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
        const accessToken = createSession(database, "user", updatedUser.id, USER_SESSION_SECONDS);
        return { token: toUserToken(updatedUser, accessToken) };
      }
      case "passport/edit_base": {
        const user = getUser(request);
        if (!user.is_registered) throw new ApiError("请先提交注册申请", 1403);

        const name = asRequiredString(params.name, "昵称", 30);
        const forms = asForms(params.forms || []);
        const status = user.status === USER_STATUS.REJECTED ? USER_STATUS.PENDING : user.status;
        const reason = status === USER_STATUS.PENDING ? "" : user.check_reason;

        database
          .prepare(
            `UPDATE users SET name = ?, forms_json = ?, status = ?, check_reason = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(name, JSON.stringify(forms), status, reason, Date.now(), user.id);
        return null;
      }
      case "enroll/list": {
        requireApprovedUser(request);
        const search = typeof params.search === "string" ? params.search.trim() : "";
        let rooms = database
          .prepare("SELECT * FROM rooms WHERE status = 1 ORDER BY sort_order ASC, created_at DESC")
          .all();

        if (search) rooms = rooms.filter((room) => room.title.includes(search));
        return paginate(rooms.map(toRoom), params);
      }
      case "enroll/view": {
        const user = requireApprovedUser(request);
        const room = requireRoom(asRequiredString(params.id, "会议室", 100));
        if (!room.status) throw new ApiError("会议室已停用");

        database.prepare("UPDATE rooms SET view_count = view_count + 1 WHERE id = ?").run(room.id);
        const response = toRoom({ ...room, view_count: room.view_count + 1 });
        const reservation = database
          .prepare(
            `SELECT * FROM reservations
             WHERE room_id = ? AND user_id = ? AND status IN (?, ?)
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(room.id, user.id, RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED);
        response.myEnrollJoinId = reservation ? reservation.id : "";
        response.myEnrollJoinTag = reservation
          ? reservation.status === RESERVATION_STATUS.PENDING
            ? "待审核"
            : "已预约"
          : "";
        response.statusDesc = "进行中";
        return response;
      }
      case "enroll/day": {
        const user = requireApprovedUser(request);
        const roomId = asRequiredString(params.enrollId, "会议室", 100);
        const day = asDay(params.day);
        requireRoom(roomId);
        let ignoredReservationId = "";
        if (params.enrollJoinId) {
          ignoredReservationId = asRequiredString(params.enrollJoinId, "预约记录", 100);
          const reservation = database
            .prepare("SELECT id FROM reservations WHERE id = ? AND room_id = ? AND user_id = ?")
            .get(ignoredReservationId, roomId, user.id);
          if (!reservation) throw new ApiError("预约记录不存在或无权访问");
        }

        return database
          .prepare(
            `SELECT reservations.start_time, reservations.end_time, reservations.forms_json
             FROM reservations
             WHERE reservations.room_id = ? AND reservations.day = ?
               AND reservations.status IN (?, ?) AND reservations.id <> ?
             ORDER BY reservations.start_time ASC`,
          )
          .all(roomId, day, RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED, ignoredReservationId)
          .map((reservation) => ({
            start: reservation.start_time,
            end: reservation.end_time,
            title: reservationTitle(reservation.forms_json),
          }));
      }
      case "enroll/all_has_day": {
        requireApprovedUser(request);
        const day = asDay(params.day);
        return database
          .prepare(
            `SELECT DISTINCT day FROM reservations
             WHERE day >= ? AND status IN (?, ?) ORDER BY day ASC`,
          )
          .all(day, RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED)
          .map((reservation) => reservation.day);
      }
      case "enroll/all_day": {
        requireApprovedUser(request);
        const day = asDay(params.day);
        return database
          .prepare(
            `SELECT reservations.start_time, reservations.end_point, rooms.title AS room_title
             FROM reservations
             JOIN rooms ON rooms.id = reservations.room_id
             WHERE reservations.day = ? AND reservations.status = ?
             ORDER BY reservations.start_time ASC`,
          )
          .all(day, RESERVATION_STATUS.APPROVED)
          .map((reservation) => ({
            timeDesc: reservation.start_time,
            title: reservation.room_title,
          }));
      }
      case "enroll/detail_for_join": {
        const user = requireApprovedUser(request);
        const room = requireRoom(asRequiredString(params.enrollId, "会议室", 100));
        if (!room.status) throw new ApiError("会议室已停用");

        const response = {
          _id: room.id,
          ENROLL_TITLE: room.title,
          ENROLL_JOIN_FORMS: normalizeReservationFields(parseJson(room.reservation_forms_json, [])),
          myForms: [],
        };
        if (params.enrollJoinId) {
          const reservation = database
            .prepare("SELECT * FROM reservations WHERE id = ? AND user_id = ? AND room_id = ?")
            .get(asRequiredString(params.enrollJoinId, "预约记录", 100), user.id, room.id);
          if (!reservation) throw new ApiError("预约记录不存在或无权访问");
          response.join = {
            start: reservation.start_time,
            end: reservation.end_time,
            endPoint: reservation.end_point,
            day: reservation.day,
          };
          response.myForms = parseJson(reservation.forms_json, []);
        }
        return response;
      }
      case "enroll/join": {
        const user = requireApprovedUser(request);
        const room = requireRoom(asRequiredString(params.enrollId, "会议室", 100));
        if (!room.status) throw new ApiError("会议室已停用");

        const day = asDay(params.day);
        const startTime = asTime(params.start, "开始时间");
        const endTime = asTime(params.end, "结束时间");
        const endPoint = asTime(params.endPoint, "结束时间");
        if (dateTimeToMillis(day, startTime) >= dateTimeToMillis(day, endPoint)) {
          throw new ApiError("结束时间必须晚于开始时间");
        }
        const forms = validateReservationForms(params.forms);
        assertReservationWindowIsAvailable(room.id, day, startTime, endPoint);

        const now = Date.now();
        const reservationId = randomUUID();
        const status = RESERVATION_STATUS.APPROVED;
        database
          .prepare(
            `INSERT INTO reservations
             (id, room_id, user_id, day, start_time, end_time, end_point, status, forms_json,
              reservation_data_json, last_updated_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            reservationId,
            room.id,
            user.id,
            day,
            startTime,
            endTime,
            endPoint,
            status,
            JSON.stringify(forms),
            JSON.stringify(formsToObject(forms)),
            now,
            now,
            now,
          );
        return { enrollJoinId: reservationId, check: 0 };
      }
      case "enroll/my_join_list": {
        const user = requireApprovedUser(request);
        const search = typeof params.search === "string" ? params.search.trim() : "";
        const sortType = params.sortType || "";
        let rows = database
          .prepare(
            `SELECT reservations.*, rooms.title AS room_title, rooms.edit_setting, rooms.cancel_setting
             FROM reservations JOIN rooms ON rooms.id = reservations.room_id
             WHERE reservations.user_id = ? ORDER BY reservations.created_at DESC`,
          )
          .all(user.id);

        if (search) rows = rows.filter((row) => row.room_title.includes(search));
        if (sortType === "succ") rows = rows.filter((row) => row.status === RESERVATION_STATUS.APPROVED);
        if (sortType === "wait") rows = rows.filter((row) => row.status === RESERVATION_STATUS.PENDING);
        if (sortType === "cancel") rows = rows.filter((row) => row.status === RESERVATION_STATUS.REJECTED);
        if (sortType === "timeasc") rows.sort((left, right) => `${left.day}${left.start_time}`.localeCompare(`${right.day}${right.start_time}`));

        const items = rows.map((reservation) => {
          const item = toReservation(reservation, reservation.room_title);
          const [year, month, date] = reservation.day.split("-");
          item.ENROLL_JOIN_DAY_DESC = `${year}.${month}.${date}`;
          item.week = weekName(reservation.day);
          item.expire = dateTimeToMillis(reservation.day, reservation.end_point) < Date.now();
          item.ENROLL_JOIN_ADD_TIME = formatDateTime(reservation.created_at);
          item.ENROLL_JOIN_LAST_TIME = formatDateTime(reservation.last_updated_at);
          item.enroll.ENROLL_EDIT_SET = reservation.edit_setting;
          item.enroll.ENROLL_CANCEL_SET = reservation.cancel_setting;
          return item;
        });
        return paginate(items, params);
      }
      case "enroll/my_join_detail": {
        const user = requireApprovedUser(request);
        const reservation = database
          .prepare(
            `SELECT reservations.*, rooms.title AS room_title
             FROM reservations JOIN rooms ON rooms.id = reservations.room_id
             WHERE reservations.id = ? AND reservations.user_id = ?`,
          )
          .get(asRequiredString(params.enrollJoinId, "预约记录", 100), user.id);
        if (!reservation) throw new ApiError("预约记录不存在或无权访问");

        const response = toReservation(reservation, reservation.room_title);
        const [year, month, date] = reservation.day.split("-");
        response.ENROLL_JOIN_DAY_DESC = `${year}.${month}.${date}`;
        response.ENROLL_JOIN_ADD_TIME = formatDateTime(reservation.created_at);
        response.ENROLL_JOIN_LAST_TIME = formatDateTime(reservation.last_updated_at);
        return response;
      }
      case "enroll/join_edit": {
        const user = requireApprovedUser(request);
        const reservationId = asRequiredString(params.enrollJoinId, "预约记录", 100);
        const roomId = asRequiredString(params.enrollId, "会议室", 100);
        const reservation = database
          .prepare("SELECT * FROM reservations WHERE id = ? AND room_id = ? AND user_id = ?")
          .get(reservationId, roomId, user.id);
        if (!reservation || ![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED].includes(reservation.status)) {
          throw new ApiError("预约记录不存在或无法修改");
        }

        const room = requireRoom(roomId);
        if (!room.edit_setting || (room.edit_setting === 3 && reservation.status === RESERVATION_STATUS.APPROVED)) {
          throw new ApiError("该预约不允许修改");
        }
        const day = asDay(params.day);
        const startTime = asTime(params.start, "开始时间");
        const endTime = asTime(params.end, "结束时间");
        const endPoint = asTime(params.endPoint, "结束时间");
        if (dateTimeToMillis(day, startTime) >= dateTimeToMillis(day, endPoint)) {
          throw new ApiError("结束时间必须晚于开始时间");
        }
        const forms = validateReservationForms(params.forms);
        const updateReservation = database.transaction(() => {
          assertReservationWindowIsAvailable(room.id, day, startTime, endPoint, reservation.id);
          const now = Date.now();
          database
            .prepare(
              `UPDATE reservations
               SET day = ?, start_time = ?, end_time = ?, end_point = ?, forms_json = ?,
                   reservation_data_json = ?, last_updated_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              day,
              startTime,
              endTime,
              endPoint,
              JSON.stringify(forms),
              JSON.stringify(formsToObject(forms)),
              now,
              now,
              reservation.id,
            );
        });
        updateReservation();
        return null;
      }
      case "enroll/my_join_cancel": {
        const user = requireApprovedUser(request);
        const reservation = database
          .prepare(
            `SELECT reservations.*, rooms.cancel_setting, rooms.approval_required
             FROM reservations JOIN rooms ON rooms.id = reservations.room_id
             WHERE reservations.id = ? AND reservations.user_id = ?`,
          )
          .get(asRequiredString(params.enrollJoinId, "预约记录", 100), user.id);
        if (!reservation || ![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED].includes(reservation.status)) {
          throw new ApiError("未找到可取消的预约记录");
        }
        if (!reservation.cancel_setting || (reservation.cancel_setting === 3 && reservation.status === RESERVATION_STATUS.APPROVED)) {
          throw new ApiError("该预约不允许取消");
        }
        database.prepare("DELETE FROM reservations WHERE id = ?").run(reservation.id);
        return null;
      }
      case "admin/login": {
        const username = asRequiredString(params.name, "账号", 30);
        const password = asRequiredString(params.pwd, "密码", 100);
        const administrator = database
          .prepare("SELECT * FROM administrators WHERE username = ? AND is_active = 1")
          .get(username);
        if (!administrator || !verifyPassword(password, administrator.password_hash)) {
          throw new ApiError("账号或密码错误", 2401);
        }
        const token = createSession(database, "administrator", administrator.id, ADMIN_SESSION_SECONDS);
        return {
          id: administrator.id,
          name: administrator.display_name,
          type: administrator.role === "super_admin" ? 1 : 0,
          token,
        };
      }
      case "admin/user_list": {
        requireAdministrator(request);
        const search = typeof params.search === "string" ? params.search.trim() : "";
        const requestedStatus = params.sortType === "status" ? Number(params.sortVal) : null;
        let users = database
          .prepare("SELECT * FROM users WHERE is_registered = 1 ORDER BY created_at DESC")
          .all();
        if (search) users = users.filter((user) => user.name.includes(search));
        if (Number.isInteger(requestedStatus)) users = users.filter((user) => user.status === requestedStatus);

        const list = users.map((user) => ({
          USER_MINI_OPENID: user.id,
          USER_NAME: user.name,
          USER_STATUS: user.status,
          USER_STATUS_DESC: userStatusDescription(user.status),
          USER_CHECK_REASON: user.check_reason,
          USER_FORMS: parseJson(user.forms_json, []),
          USER_ADD_TIME: formatDateTime(user.created_at),
          USER_LOGIN_TIME: user.last_login_at ? formatDateTime(user.last_login_at) : "未登录",
        }));
        return paginate(list, params);
      }
      case "admin/user_detail": {
        requireAdministrator(request);
        const user = database
          .prepare("SELECT * FROM users WHERE id = ? AND is_registered = 1")
          .get(asRequiredString(params.id, "用户", 100));
        if (!user) throw new ApiError("用户不存在");
        return {
          ...toUserResponse(user),
          USER_MINI_OPENID: user.id,
          USER_ADD_TIME: formatDateTime(user.created_at),
          USER_LOGIN_TIME: user.last_login_at ? formatDateTime(user.last_login_at) : "未登录",
        };
      }
      case "admin/user_status": {
        requireAdministrator(request);
        const userId = asRequiredString(params.id, "用户", 100);
        const status = asStatus(params.status, [USER_STATUS.ACTIVE, USER_STATUS.REJECTED, USER_STATUS.DISABLED]);
        const reason = asOptionalString(params.reason, "审核理由", 100);
        const result = database
          .prepare("UPDATE users SET status = ?, check_reason = ?, updated_at = ? WHERE id = ? AND is_registered = 1")
          .run(status, status === USER_STATUS.REJECTED ? reason : "", Date.now(), userId);
        if (!result.changes) throw new ApiError("用户不存在");
        return null;
      }
      case "admin/user_del": {
        requireAdministrator(request);
        const result = database
          .prepare("DELETE FROM users WHERE id = ? AND is_registered = 1")
          .run(asRequiredString(params.id, "用户", 100));
        if (!result.changes) throw new ApiError("用户不存在");
        return null;
      }
      case "admin/enroll_list": {
        requireAdministrator(request);
        const search = typeof params.search === "string" ? params.search.trim() : "";
        const sortType = typeof params.sortType === "string" ? params.sortType : "";
        const sortValue = params.sortVal;
        let rooms = database.prepare("SELECT * FROM rooms ORDER BY sort_order ASC, created_at DESC").all();

        if (search) rooms = rooms.filter((room) => room.title.includes(search));
        if (sortType === "status" && [0, 1].includes(Number(sortValue))) {
          rooms = rooms.filter((room) => room.status === Number(sortValue));
        }
        if (sortType === "top") rooms = rooms.filter((room) => room.sort_order === 0);
        if (sortType === "sort" && sortValue === "new") {
          rooms.sort((left, right) => right.created_at - left.created_at);
        }

        const reservationCounts = database
          .prepare("SELECT room_id, COUNT(*) AS count FROM reservations GROUP BY room_id")
          .all()
          .reduce((counts, row) => ({ ...counts, [row.room_id]: row.count }), {});
        return paginate(
          rooms.map((room) => ({
            ...toRoom(room),
            ENROLL_JOIN_CNT: reservationCounts[room.id] || 0,
            ENROLL_ADD_TIME: formatDateTime(room.created_at),
            ENROLL_EDIT_TIME: formatDateTime(room.updated_at),
            statusDesc: room.status ? "进行中" : "已停用",
          })),
          params,
        );
      }
      case "admin/enroll_insert": {
        requireAdministrator(request);
        const input = getRoomInput(params);
        const roomId = randomUUID();
        const now = Date.now();
        database
          .prepare(
            `INSERT INTO rooms
             (id, title, category_id, category_name, cancel_setting, edit_setting, approval_required,
              sort_order, forms_json, room_data_json, reservation_forms_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            roomId,
            input.title,
            input.categoryId,
            input.categoryName,
            input.cancelSetting,
            input.editSetting,
            input.approvalRequired,
            input.sortOrder,
            JSON.stringify(input.forms),
            JSON.stringify(formsToObject(input.forms)),
            JSON.stringify(input.reservationForms),
            now,
            now,
          );
        return { id: roomId };
      }
      case "admin/enroll_detail": {
        requireAdministrator(request);
        return toRoom(requireRoom(asRequiredString(params.id, "会议室", 100)));
      }
      case "admin/enroll_edit": {
        requireAdministrator(request);
        const roomId = asRequiredString(params.id, "会议室", 100);
        requireRoom(roomId);
        const input = getRoomInput(params);
        database
          .prepare(
            `UPDATE rooms
             SET title = ?, category_id = ?, category_name = ?, cancel_setting = ?, edit_setting = ?,
                 approval_required = ?, sort_order = ?, forms_json = ?, room_data_json = ?,
                 reservation_forms_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.title,
            input.categoryId,
            input.categoryName,
            input.cancelSetting,
            input.editSetting,
            input.approvalRequired,
            input.sortOrder,
            JSON.stringify(input.forms),
            JSON.stringify(formsToObject(input.forms)),
            JSON.stringify(input.reservationForms),
            Date.now(),
            roomId,
          );
        return { statusDesc: "进行中" };
      }
      case "admin/enroll_clear": {
        requireAdministrator(request);
        requireRoom(asRequiredString(params.id, "会议室", 100));
        database
          .prepare("DELETE FROM reservations WHERE room_id = ?")
          .run(asRequiredString(params.id, "会议室", 100));
        return null;
      }
      case "admin/enroll_del": {
        requireAdministrator(request);
        const result = database
          .prepare("DELETE FROM rooms WHERE id = ?")
          .run(asRequiredString(params.id, "会议室", 100));
        if (!result.changes) throw new ApiError("会议室不存在");
        return null;
      }
      case "admin/enroll_sort": {
        requireAdministrator(request);
        const sortOrder = asIntegerInRange(params.sort, "排序号", 0, 9999);
        const result = database
          .prepare("UPDATE rooms SET sort_order = ?, updated_at = ? WHERE id = ?")
          .run(sortOrder, Date.now(), asRequiredString(params.id, "会议室", 100));
        if (!result.changes) throw new ApiError("会议室不存在");
        return null;
      }
      case "admin/enroll_vouch": {
        requireAdministrator(request);
        const featured = asStatus(params.vouch, [0, 1]);
        const result = database
          .prepare("UPDATE rooms SET is_featured = ?, updated_at = ? WHERE id = ?")
          .run(featured, Date.now(), asRequiredString(params.id, "会议室", 100));
        if (!result.changes) throw new ApiError("会议室不存在");
        return null;
      }
      case "admin/enroll_status": {
        requireAdministrator(request);
        const status = asStatus(params.status, [0, 1]);
        const result = database
          .prepare("UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?")
          .run(status, Date.now(), asRequiredString(params.id, "会议室", 100));
        if (!result.changes) throw new ApiError("会议室不存在");
        return { statusDesc: status ? "进行中" : "已停用" };
      }
      case "admin/enroll_join_list": {
        requireAdministrator(request);
        const room = requireRoom(asRequiredString(params.enrollId, "会议室", 100));
        const search = typeof params.search === "string" ? params.search.trim() : "";
        const requestedStatus = params.sortType === "status" ? Number(params.sortVal) : null;
        let reservations = database
          .prepare(
            `SELECT reservations.*, users.name AS user_name
             FROM reservations JOIN users ON users.id = reservations.user_id
             WHERE reservations.room_id = ? ORDER BY reservations.last_updated_at DESC`,
          )
          .all(room.id);
        if (search) {
          reservations = reservations.filter((reservation) => {
            return reservation.user_name.includes(search) || reservation.forms_json.includes(search);
          });
        }
        if ([RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED, RESERVATION_STATUS.REJECTED].includes(requestedStatus)) {
          reservations = reservations.filter((reservation) => reservation.status === requestedStatus);
        }
        return paginate(
          reservations.map((reservation) => ({
            ...toReservation(reservation),
            user: { USER_NAME: reservation.user_name, USER_MOBILE: "" },
            ENROLL_JOIN_ADD_TIME: formatDateTime(reservation.created_at),
          })),
          params,
        );
      }
      case "admin/enroll_join_status": {
        requireAdministrator(request);
        const status = asStatus(params.status, [RESERVATION_STATUS.APPROVED, RESERVATION_STATUS.REJECTED]);
        const result = database
          .prepare("UPDATE reservations SET status = ?, reason = ?, last_updated_at = ?, updated_at = ? WHERE id = ?")
          .run(status, asOptionalString(params.reason, "处理说明", 200), Date.now(), Date.now(), asRequiredString(params.enrollJoinId, "预约记录", 100));
        if (!result.changes) throw new ApiError("预约记录不存在");
        return null;
      }
      case "admin/enroll_cancel_join_all": {
        requireAdministrator(request);
        const roomId = asRequiredString(params.enrollId, "会议室", 100);
        requireRoom(roomId);
        const reason = asOptionalString(params.reason, "处理说明", 200);
        const now = Date.now();
        database
          .prepare(
            "UPDATE reservations SET status = ?, reason = ?, last_updated_at = ?, updated_at = ? WHERE room_id = ? AND status IN (?, ?)",
          )
          .run(
            RESERVATION_STATUS.REJECTED,
            reason,
            now,
            now,
            roomId,
            RESERVATION_STATUS.PENDING,
            RESERVATION_STATUS.APPROVED,
          );
        return null;
      }
      case "admin/enroll_join_del": {
        requireAdministrator(request);
        const result = database
          .prepare("DELETE FROM reservations WHERE id = ?")
          .run(asRequiredString(params.enrollJoinId, "预约记录", 100));
        if (!result.changes) throw new ApiError("预约记录不存在");
        return null;
      }
      default:
        throw new ApiError("当前自有服务器尚未迁移此功能", 1600);
    }
  }

  app.post("/api/auth/wechat-login", async (request, response, next) => {
    try {
      const code = asRequiredString(request.body.code, "微信登录凭证", 200);
      const { openid } = await wechatClient.exchangeCode(code);
      const now = Date.now();
      let user = database.prepare("SELECT * FROM users WHERE wechat_openid = ?").get(openid);
      if (!user) {
        const userId = randomUUID();
        database
          .prepare(
            `INSERT INTO users (id, wechat_openid, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          )
          .run(userId, openid, now, now);
        user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      }
      database
        .prepare("UPDATE users SET login_count = login_count + 1, last_login_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, user.id);
      user = database.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      const accessToken = createSession(database, "user", user.id, USER_SESSION_SECONDS);
      return success(response, { token: toUserToken(user, accessToken) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/routes", async (request, response, next) => {
    try {
      const route = asRequiredString(request.body.route, "路由", 100);
      if (route === "passport/login") throw new ApiError("请使用微信登录接口", 1600);
      const params = request.body.params && typeof request.body.params === "object" ? request.body.params : {};
      return success(response, await dispatchRoute(request, route, params));
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, request, response, next) => {
    const apiError = error instanceof ApiError ? error : new ApiError("服务器暂时不可用", 500);
    if (!(error instanceof ApiError)) console.error(error);
    response.status(apiError.code === 500 ? 500 : 200).json({
      code: apiError.code,
      msg: apiError.message,
      data: null,
    });
  });

  return app;
}

function userStatusDescription(status) {
  return {
    [USER_STATUS.PENDING]: "待审核",
    [USER_STATUS.ACTIVE]: "正常",
    [USER_STATUS.REJECTED]: "审核未通过",
    [USER_STATUS.DISABLED]: "禁用",
  }[status] || "未知";
}

function getRoomInput(params) {
  const forms = asForms(params.forms || []);
  const reservationForms = normalizeReservationFields(asForms(params.joinForms || []));
  return {
    title: asRequiredString(params.title, "会议室名称", 50),
    // Categories are no longer part of the UI, but this keeps the legacy non-null schema intact.
    categoryId: DEFAULT_ROOM_CATEGORY_ID,
    categoryName: DEFAULT_ROOM_CATEGORY_NAME,
    sortOrder: asIntegerInRange(params.order, "排序号", 0, 9999),
    approvalRequired: 0,
    cancelSetting: [0, 1, 2, 3].includes(Number(params.cancelSet)) ? Number(params.cancelSet) : 1,
    editSetting: [0, 1, 2, 3].includes(Number(params.editSet)) ? Number(params.editSet) : 1,
    forms,
    reservationForms,
  };
}

module.exports = {
  ADMIN_SESSION_SECONDS,
  RESERVATION_STATUS,
  USER_SESSION_SECONDS,
  USER_STATUS,
  createApp,
};
