# Agent Instructions

## Repository Shape

- `server/` is the active self-hosted backend: `server/src/server.js` starts the Express API, and `server/src/app.js` dispatches the Mini Program route contract.
- `miniprogram/` is a WeChat Mini Program, not a Node-built frontend. Import the repository root into WeChat Developer Tools; `project.config.json` defines both `miniprogramRoot` and `cloudfunctionRoot`.
- `cloudfunctions/mcloud/` is the legacy Tencent Cloud Functions backend. The current Mini Program setting has `USE_SELF_HOSTED: true`, so normal local and deployment work targets `server/` instead.

## Commands

- Use Node 22 or newer for the root project: `package.json` declares `>=20`, but the lockfile pins `better-sqlite3@13.0.3`, which declares `>=22`.
- From the repository root, install with `npm ci`, run all automated tests with `npm test`, and start the API with `npm start`.
- Run focused tests with `node --test server/test/app.test.js` or `node --test server/test/mini-program.test.js`. There are no root lint, typecheck, build, or codegen scripts.
- `npm start` requires `WECHAT_APP_ID` and `WECHAT_APP_SECRET`; the server reads process environment variables and does not load `.env` itself. Use `.env.example` for the variable names and keep `.env` uncommitted.
- The nested `cloudfunctions/mcloud` `test` script is a placeholder that exits 1; it is not project verification.

## Integration Traps

- Self-hosted requests use `miniprogram/setting/setting.js` (`USE_SELF_HOSTED` and `API_BASE_URL`) and call `/api/auth/wechat-login` plus `/api/routes`. Keep `API_BASE_URL`, the WeChat request-domain whitelist, `project.config.json` `appid`, and server `WECHAT_APP_ID` aligned; never put the AppSecret in Mini Program code.
- Never hardcode a real business AppID or backend API URL in source or checked-in runtime configuration. Code that needs either value must load it from an environment-variable file; tracked files may contain placeholders only. For runtimes that cannot read files directly, inject the environment-file values through the documented tooling step.
- Use `server/route_contract.md` and the route tests when changing API behavior. An unexpected response code `1600` means the server and Mini Program versions are mismatched; do not suppress it in the frontend.
- Reservation payloads distinguish `start`, `end`, and `endPoint`; overlap checks use `start` and `endPoint`. Preserve this distinction when changing reservation or edit logic.
- `server/data/` contains ignored SQLite runtime data. The database uses WAL mode, so follow `deployment.md`'s SQLite online-backup procedure instead of copying only the live database file.
