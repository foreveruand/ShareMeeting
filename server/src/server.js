const path = require("node:path");

const { bootstrapAdministrator } = require("./auth");
const { createApp } = require("./app");
const { createDatabase } = require("./database");
const { createWechatClient } = require("./wechat");

function getRequiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

function startServer() {
  const databasePath = process.env.DATABASE_PATH || path.resolve("server/data/share-meeting.sqlite");
  const database = createDatabase(databasePath);
  bootstrapAdministrator(
    database,
    process.env.INITIAL_ADMIN_USERNAME,
    process.env.INITIAL_ADMIN_PASSWORD,
  );

  const app = createApp({
    database,
    wechatClient: createWechatClient({
      appId: getRequiredEnvironment("WECHAT_APP_ID"),
      appSecret: getRequiredEnvironment("WECHAT_APP_SECRET"),
    }),
  });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`ShareMeeting API is listening on port ${port}.`);
  });
}

if (require.main === module) startServer();

module.exports = { startServer };
