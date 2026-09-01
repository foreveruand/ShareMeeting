# 自有服务器部署指南

本文档部署当前 `dev` 分支中的 Node.js API 和微信小程序。生产环境需要一个已备案、可访问的 HTTPS 域名，例如 `meeting-api.example.com`。

## 前置条件

- Linux 服务器，Node.js 20 或更高版本。
- 已解析到服务器的域名，以及有效 TLS 证书。
- Nginx、Git 和 SQLite 命令行工具。
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
PORT=3000
WECHAT_APP_ID=wx0000000000000000
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

服务端仅读取进程环境变量，不会自动读取 `.env`。使用 systemd 的 `EnvironmentFile` 注入这些配置。创建 `/etc/systemd/system/share-meeting.service`：

```ini
[Unit]
Description=ShareMeeting API
After=network.target

[Service]
Type=simple
User=sharemeet
Group=sharemeet
WorkingDirectory=/opt/share-meeting
EnvironmentFile=/opt/share-meeting/.env
ExecStart=/usr/bin/node server/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

使用 `which node` 确认 Node.js 路径，并按需修改 `ExecStart`。随后启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now share-meeting
sudo systemctl status share-meeting
sudo journalctl -u share-meeting -f
```

## 配置 HTTPS 和反向代理

Node.js 服务默认监听端口 3000。请限制该端口仅允许本机访问，公网流量通过 Nginx 的 HTTPS 入口转发。

在 `/etc/nginx/sites-available/share-meeting` 创建站点配置，并将域名替换为实际值：

```nginx
server {
    listen 80;
    server_name meeting-api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name meeting-api.example.com;

    ssl_certificate /etc/letsencrypt/live/meeting-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meeting-api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用站点并申请证书：

```bash
sudo ln -s /etc/nginx/sites-available/share-meeting /etc/nginx/sites-enabled/share-meeting
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d meeting-api.example.com
```

首次申请证书前，保留仅监听 80 端口的配置，或由 Certbot 自动补充 TLS 配置。确认服务器防火墙对外开放 80 和 443，且不对外开放 3000。

## 配置微信小程序

1. 在微信公众平台的“小程序后台 - 开发管理 - 开发设置”取得 AppID 和 AppSecret。
2. 将 AppID、AppSecret 写入服务器 `.env` 的 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，然后执行 `sudo systemctl restart share-meeting`。
3. 在小程序后台的“开发管理 - 开发设置 - 服务器域名”中，将 `https://meeting-api.example.com` 添加为 `request 合法域名`。发布版不能使用 IP 地址、HTTP 地址或非标准端口。
4. 修改 `miniprogram/setting/setting.js`：

```js
USE_SELF_HOSTED: true,
API_BASE_URL: "https://meeting-api.example.com",
```

5. 确认 `project.config.json` 中的 `appid` 与服务器配置的 `WECHAT_APP_ID` 属于同一个小程序。
6. 使用微信开发者工具导入仓库根目录，完成微信登录、注册审核、管理员登录、会议室管理和预约测试后上传代码，并在小程序后台提交审核发布。

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
