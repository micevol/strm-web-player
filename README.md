# STRM Web Player

一个**自托管的 Web 播放平台**，用于直接在浏览器里播放 `.strm` 流媒体文件（常见于网盘影视库 / Alist / nfo 刮削工具生成）。

- 读取 `.strm` 文件内容指向的远程视频地址
- Web 界面目录浏览 + 在线播放（支持 MP4 直链与 HLS/m3u8）
- **自动检测 strm 库更新**并实时刷新列表与索引
- **账号密码登录**，支持网页自助注册账号
- 深色科技感 UI，简洁美观大方
- **Docker 一键部署**，默认宿主机端口 `14000`

---

## ✨ 功能特性

| 能力 | 说明 |
| ---- | ---- |
| 🎬 STRM 直读 | 解析 strm 中的远程 URL，无需下载到本地即可播放 |
| 🎞 两种格式 | 兼容**单行视频 URL**（MP4/WebM…）与 **HLS/m3u8** 播放列表 |
| ⚡ 智能代理 | 后端流式代理转发，支持 Range 拖动进度；HLS 分片自动通过认证代理 |
| 🕵️ 自动刷新 | chokidar 监听 strm 目录的增删改，SSE 实时推送到浏览器，新增影片/改动即时可见 |
| 🔐 账号认证 | 用户名 + 密码登录，bcrypt 加密密码，JWT 会话；开放自助注册（可关闭） |
| 📂 目录树 | 左侧影视库目录树 + 缩略图网格浏览 |
| 🐳 Docker | 一键 `docker compose up -d` 部署，自动重启 |

---

## 🚀 快速开始（Docker Compose）

### 1. 下载项目

```bash
git clone https://github.com/<你的账号>/strm-web-player.git
cd strm-web-player
```

### 2. 配置

编辑 `docker-compose.yml`,把 strm 目录路径改成你的实际路径:

```yaml
volumes:
  - /path/to/your/strm:/data/strm:ro
```

（`ro` 表示只读挂载;若你的网盘工具会改动这些文件,去掉 `:ro` 即可。）

同时修改一条环境变量(必改,安全起见):

```yaml
- JWT_SECRET=<一个足够长的随机字符串>
```

> 建议同时修改首次启动的默认管理员账号 `SEED_ADMIN=admin:admin123`,生产环境务必换掉。

### 3. 启动

```bash
docker compose up -d --build
```

### 4. 访问

浏览器打开 <http://你的服务器IP:14000>

- 首次启动会自动创建 `SEED_ADMIN` 指定的账号(默认 `admin / admin123`)
- 之后可在登录页直接**注册新账号**(如需关闭,把 `ALLOW_REGISTER` 设为 `false`)

---

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `PORT` | `3000` | 容器内监听端口(一般无需改) |
| `STRM_DIR` | `/data/strm` | strm 文件根目录(通过 volumes 挂载) |
| `JWT_SECRET` | 自动生成 | JWT 签名密钥,**生产环境必改**。(若自动生成,容器重建后会话会失效) |
| `SEED_ADMIN` | 空 | 首次启动自动创建的管理员,格式 `用户名:密码` |
| `ALLOW_REGISTER` | `true` | 是否允许网页自助注册 |
| `USER_DB_PATH` | `/data/users.json` | 账号数据文件位置 |
| `ALLOWED_HOSTS` | `*` | strm 内允许播放的远程域名白名单,如 `aliyundrive.com,example.com` |
| `POLL_INTERVAL` | `5000` | 文件监听回退轮询间隔(ms) |
| `UPSTREAM_TIMEOUT` | `30000` | 上游视频源请求超时(ms) |

---

## 📌 strm 文件格式说明

`.strm` 文件本质是一个文本文件,内容是一行远程视频地址:

```
# 单行视频直链(MP4 等)
https://xxx.drive.com/path/video.mp4

# HLS 播放列表
https://xxx.drive.com/path/stream.m3u8
```

项目会自动识别并播放任意 `.strm` 文件,目录结构即影视库的目录结构。

---

## 🔒 反向代理 + HTTPS(可选)

如果要对公网开放,强烈建议套一层 HTTPS 反向代理(如 Nginx / Caddy),并让 `JWT_SECRET` 使用强随机值。默认 Cookie 为 `httpOnly`;若你的部署全走 HTTPS,可将认证 Cookie 的 `secure` 开关打开(见 `server/src/auth.js`)。

---

## 📁 项目结构

```
strm-web-player/
├── Dockerfile
├── docker-compose.yml
├── public/            # Web 前端(登录页 + 播放器 UI)
│   ├── index.html
│   ├── login.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── js/auth.js
│   └── js/hls.min.js  # 本地 HLS 播放器,离线可用
├── server/            # Node.js 后端
│   └── src/
│       ├── index.js   # Express 入口
│       ├── auth.js    # 登录 / 注册 / JWT
│       ├── db.js      # 账号存储(bcrypt 加密)
│       ├── files.js   # 目录树索引
│       ├── watcher.js # 更新检测(chokidar)
│       ├── strm.js    # strm 解析 + 流式播放代理
│       └── config.js  # 环境变量配置
└── sample/            # 示例 strm 文件
```

---

## 🧪 技术栈

- **后端**: Node.js + Express + chokidar(文件监听) + bcryptjs(密码) + jsonwebtoken(会话)
- **前端**: 原生 HTML/CSS/JS + hls.js(本地化)
- **部署**: Docker + Docker Compose

---

## 📄 License

MIT