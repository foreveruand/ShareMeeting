# 本地服务器部署指南

本文档部署当前 `dev` 分支中的 Node.js API 和微信小程序。以 `meeting-api.example.com` 为示例，Node.js 服务仅监听 `127.0.0.1:4000`，由 OpenResty 通过公网 `443` 端口提供 HTTPS。

如果现有 OpenResty 使用 SNI 将公网 `443` 转发到本机 `8443`，本项目站点配置应监听 `127.0.0.1:8443`，不要再创建直接监听 `443 ssl` 的站点。若部署环境不同，请按现有 OpenResty 架构调整监听地址。

## 前置条件

- Linux 服务器，Node.js 20 或更高版本。
- 已解析到服务器的域名，以及有效 TLS 证书。
- OpenResty、Git 和 SQLite 命令行工具。
- 微信小程序的 AppID 与 AppSecret。

服务端使用 SQLite，不需要额外安装 MySQL 或 Redis。`better-sqlite3` 在没有预编译二进制时会编译本地模块，因此服务器还应具备编译工具链，例如 Debian/Ubuntu 的 `build-essential` 和 `python3`。

## 部署服务端

以 `/opt/share-meeting` 为代码目录、`sharemeet` 为运行账号为例：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin sharemeet
git clone <仓库地址> /opt/share-meeting
cd /opt/share-meeting
git switch dev
npm ci --omit=dev

sudo install -d -o sharemeet -g sharemeet /var/lib/share-meeting
sudo chown -R sharemeet:sharemeet /opt/share-meeting
```

在 `/opt/share-meeting/.env` 创建配置。该文件已被 Git 忽略，权限应限制为管理员可读：

```dotenv
PUBLIC_BASE_URL=https://your-api.example.com
HOST=127.0.0.1
PORT=4000
WECHAT_APP_ID=replace-with-wechat-app-id
WECHAT_APP_SECRET=replace-with-the-real-app-secret
INITIAL_ADMIN_USERNAME=meeting-admin
INITIAL_ADMIN_PASSWORD=replace-with-a-password-of-at-least-12-characters
DATABASE_PATH=/var/lib/share-meeting/share-meeting.sqlite
```

```bash
sudo chown root:root /opt/share-meeting/.env
sudo chmod 600 /opt/share-meeting/.env
```

`INITIAL_ADMIN_USERNAME` 和 `INITIAL_ADMIN_PASSWORD` 仅在数据库中尚无管理员时生效。不要提交 `.env`，也不要把 AppSecret 写入小程序代码。

服务端仅读取进程环境变量，不会自动读取 `.env`。仓库中的 `deploy/systemd/share-meeting.service` 使用 systemd 的 `EnvironmentFile` 注入这些配置：

```bash
sudo install -Dm644 deploy/systemd/share-meeting.service /etc/systemd/system/share-meeting.service
sudo systemd-analyze verify /etc/systemd/system/share-meeting.service
sudo systemctl daemon-reload
sudo systemctl enable --now share-meeting
sudo systemctl status share-meeting
sudo journalctl -u share-meeting -f
```

如果运行账号、Node.js 的安装目录或代码目录不同，先修改该 unit 的 `User`、`Group`、`ExecStart`、`WorkingDirectory` 和 `EnvironmentFile`。

## 配置 HTTPS 和反向代理

Node.js 服务监听 `127.0.0.1:4000`，不会直接暴露到公网。OpenResty 配置复用现有的 `ssl.conf` 和证书，并使用 `meeting-api.*` 匹配目标域名。

安装仓库中的站点配置：

```bash
sudo install -Dm644 deploy/openresty/share-meeting.conf \
  /etc/openresty/sites-enabled/share-meeting.conf
sudo openresty -t
sudo systemctl reload openresty
```

证书路径和 OpenResty 配置目录因安装方式而异，应确保 TLS 证书覆盖目标域名。确认服务器防火墙对外开放 80 和 443，且不对外开放 4000。

DNS 应将 `meeting-api.example.com` 解析到服务器公网地址。首次申请证书时可暂时只启用 80 端口的重定向站点，证书部署完成后再启用 8443 的 HTTPS 站点。

## 配置微信小程序

1. 在微信公众平台的“小程序后台 - 开发管理 - 开发设置”取得 AppID 和 AppSecret。
2. 将 AppID、AppSecret 写入服务器 `.env` 的 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，然后执行 `sudo systemctl restart share-meeting`。
3. 在小程序后台的“开发管理 - 开发设置 - 服务器域名”中，将服务的 HTTPS 地址添加为 `request 合法域名`。发布版不能使用 IP 地址、HTTP 地址或非标准端口。
4. 配置仅保存在本地的微信小程序设置：

```bash
cp miniprogram/setting/setting.local.example.js miniprogram/setting/setting.local.js
```

编辑 `miniprogram/setting/setting.local.js`，填入服务的真实 HTTPS 地址并保持 `USE_SELF_HOSTED: true`。该文件已被 Git 忽略。如启用图片内容校验，还需填写 `CONTENT_CHECK_SERVICE_ID`；未配置时图片校验会拒绝上传。

5. 在微信开发者工具中填写 AppID。工具会将其保存到根目录的 `project.private.config.json`，该文件已被 Git 忽略。确认它与服务器 `.env` 中的 `WECHAT_APP_ID` 属于同一个小程序。
6. 确认 `setting.local.js` 的 `API_BASE_URL` 与此服务的公网 HTTPS 域名完全一致。不要将小程序指向旧实例或旧容器。
7. 在部署目录执行 `npm test`，随后执行 `sudo systemctl restart share-meeting` 和 `sudo systemctl status share-meeting`。重启后从小程序依次验证个人资料、会议日历、我的预订、会议室详情、创建预约和修改预约；任一“当前自有服务器尚未迁移此功能”提示都表示线上进程未包含当前路由，须修复部署而非在前端忽略该错误。
8. 使用微信开发者工具导入仓库根目录，完成微信登录、注册审核、管理员登录、会议室管理和预约测试后上传代码，并在小程序后台提交审核发布。

开发者工具可临时关闭“校验合法域名”进行本地调试，但发布前必须恢复校验并配置正式 HTTPS 域名。

## 备份与升级

数据库文件位于 `DATABASE_PATH`。使用 SQLite 的在线备份命令，不要只复制 WAL 模式下正在写入的主数据库文件：

```bash
sudo install -d -o sharemeet -g sharemeet /var/backups/share-meeting
sudo -u sharemeet sqlite3 /var/lib/share-meeting/share-meeting.sqlite \
  ".backup '/var/backups/share-meeting/share-meeting-$(date +%F).sqlite'"
```

升级应用时：

```bash
cd /opt/share-meeting
git fetch origin
git switch dev
git pull --ff-only origin dev
npm ci --omit=dev
sudo systemctl restart share-meeting
sudo systemctl status share-meeting
```

升级前先执行数据库备份；升级后查看 `journalctl -u share-meeting`，并在小程序中验证微信登录与会议室预约流程。
