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
| ⏯️ 播放进度记忆 | 按账号保存每个视频的播放进度，再次播放自动续播；播放完成自动清除 |
| 🈂️ 字幕支持 | 自动识别同名 `.srt/.vtt/.ass/.ssa/.smi` 字幕文件；也支持手动上传本地字幕 |
| 🐳 Docker | 一键 `docker compose up -d` 部署，自动重启 |

---

## 🚀 快速开始（Docker Compose）

### 1. 下载项目

```bash
git clone https://github.com/micevol/strm-web-player.git
cd strm-web-player
```

### 2. 配置

编辑 `docker-compose.yml`,把 strm 目录路径改成你的实际路径:

所有可配置项统一放在 **`.env`**(从 `.env.example` 复制而来):

```bash
cp .env.example .env
vim .env      # 或 nano .env
```

其中三项必改:

```env
STRM_HOST_PATH=/media/我的网盘影视/strm   # 你的 strm 文件所在目录(宿主机路径)
JWT_SECRET=一串足够长的随机字符串           # 生产环境必改(生成: openssl rand -base64 48)
SEED_ADMIN=admin:admin123                # 首次启动的管理员账号,务必换掉
```

> `STRM_HOST_PATH` 以只读方式挂载进容器;若你的网盘工具会改写这些文件,可在
> `docker-compose.yml` 中把该 volume 的 `:ro` 去掉。

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
| `PROGRESS_DB_PATH` | `/data/progress.json` | 播放进度数据存储位置 |

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

## 🈂️ 字幕

在 strm 文件**同目录**放置同名的字幕文件,播放时播放器右上角「字幕」菜单会自动列出并加载:

| 文件 | 与 strm 的对应关系 |
| ---- | ---- |
| `movie.srt` / `movie.vtt` / `movie.ass` … | 与 `movie.strm` 同名 |
| `movie.zh.srt` / `movie.zh_CN.vtt` … | 带语言后缀,同样会被识别 |
| `movie.mp4.srt` | strm 保留了媒体后缀(movie.mp4.strm)时也可匹配 |

支持的扩展:`srt`、`vtt`、`ass`、`ssa`、`smi`。`.srt` 会自动转为 WebVTT 供浏览器 `<track>` 使用。

也支持在播放器里**手动上传本地字幕文件**(仅当次播放有效)。

---

## ⏯️ 播放进度记忆

- 播放过程中每 5 秒自动保存一次当前位置(按账号、按视频独立记录)
- 再次打开同一视频时自动从上次位置**续播**
- 视频**播放完成**后自动清除该条进度

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
│       ├── files.js   # 目录树索引 + 字幕索引
│       ├── watcher.js # 更新检测(chokidar)
│       ├── strm.js    # strm 解析 + 流式播放代理
│       ├── progress.js# 播放进度存储
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