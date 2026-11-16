# MC MOTD API — EdgeOne Node 云函数版

由原 `mcmotdapi` 移植；保留 Vue 前端和原 API 路径，不需要原来的常驻 Node 服务器。

## 架构与功能

- EdgeOne 托管前端；`cloud-functions/api/[[default]].js` 导出 Express 实例，不监听端口。
- Java MOTD 使用真实 TCP Minecraft Server List Ping；基岩版使用真实 UDP RakNet Ping；支持 `stype=je/be/auto`、`srv=true`、原 `host` / `ip` / `port` 参数。
- 保留 `/api/status`、`/api/status_img`、`/api/app_img`、`/api/sync_app_img`、`/api/screenshot`、`/api/config`、`/api/login`、`/api/admin/stats`。
- 首页、文档、iframe、登录及管理页面保留；SPA 路由已配置 fallback，不拦截 API 或静态资源。
- SQLite 缓存与统计迁到远程 libSQL；临时截图迁到腾讯 COS，避免云函数实例重启或切换后丢失数据。
- 绘图使用 `@napi-rs/canvas`，无需编译 Cairo；附带 Noto CJK 字体，避免云端没有中文系统字体时出现方框。

**必须使用 Node 云函数，不能把后端放到 V8 边缘函数 `functions/` 下。**

## 部署到 EdgeOne

1. 将本目录作为独立仓库上传到 GitHub / GitLab / Gitee。
2. 在 EdgeOne Pages / Makers 控制台导入仓库，项目根目录选本目录，不要选 `front` 或 `dist`；框架选择其他 / 自定义。
3. 仓库的 `edgeone.json` 已配置：安装 `npm ci`，构建 `npm run build`，输出目录 `dist`，构建 Node `22.11.0`，云函数最大时长 60 秒。
4. 在环境变量中配置下面的数据库、COS 和管理员凭据；重新部署使配置生效。
5. 部署后打开首页，并分别用已知在线的 Java 和基岩服务器测试。函数地域应尽量靠近 Minecraft 服务器及存储服务。

`includeFiles` 保留后端模块、配置、字体与图片的目录结构；`externalNodeModules` 保留运行依赖及原生绘图库。请勿删除这两项，也不要把本机 Windows 的 `node_modules` 上传到部署产物。

### 环境变量

所有变量参考 `.env.example`，密钥只放控制台环境变量或本地 `.env`，不要提交仓库。

| 变量 | 用途 |
| --- | --- |
| `QUERY_TIMEOUT_MS` | 查询超时，默认 5000 毫秒 |
| `LIBSQL_URL` | 远程 SQLite/libSQL 地址，例如 Turso 提供的 `libsql://…` |
| `LIBSQL_AUTH_TOKEN` | 数据库访问令牌，按数据库认证要求配置 |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 腾讯云 COS 凭据，建议使用最小权限子账号 |
| `COS_BUCKET` | 完整桶名，含 APPID 后缀 |
| `COS_REGION` | 桶所在地域，例如 `ap-guangzhou` |
| `COS_PREFIX` | 临时对象前缀，默认 `mcmotd/app-images/` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_MD5` | 管理员用户名及密码 MD5，兼容原前端登录请求 |

**完整功能需要远程数据库和 COS。** 未配置数据库时查询和即时图片仍可用，但不记录统计、不使用 API 数据库缓存，统计接口返回 503；未配置 COS 时即时图片仍可用，同步截图与截图读取接口返回 503，不会假装保存成功。

#### 数据库

可创建 Turso / 其他兼容 libSQL 的远程数据库，将连接 URL 与令牌填入环境变量。首次查询自动建表 `query_logs` 与 `server_cache`。原 SQLite 数据需要保留时，先导入远程数据库；表结构保持兼容，复制原 `.db` 文件到云函数目录不会产生持久化。

`file:` 数据库仅允许 `NODE_ENV=development/test` 的本地验证，生产必须使用远程地址。

#### COS

创建私有桶；对子账号授予指定前缀的 `GetObject`、`PutObject`、`DeleteObject` 权限。每张截图保存 PNG 和 JSON 元数据两份对象。接口按 `backend/config/config.json` 中 `appImage.ttlSeconds` 判断过期，默认 300 秒，读取过期图片会删除对象并返回 404。

请为该前缀配置 **1 天后删除对象的桶生命周期规则**，清理从未被读取的过期截图；若增大截图 TTL，相应延长生命周期。生命周期负责存储清理，不替代接口的秒级过期检查。

### 查询示例

```text
https://你的域名/api/status?host=你的Java服务器:25565&stype=je
https://你的域名/api/status?host=你的基岩服务器:19132&stype=be
https://你的域名/api/status?host=你的SRV域名&srv=true
https://你的域名/api/app_img?host=你的服务器&stype=auto&dark=true
https://你的域名/api/status_img?host=你的服务器&theme=simple
https://你的域名/api/sync_app_img?host=你的服务器&stype=je
```

同步接口返回 `serverData`、`screenshotUrl`、`expireAt`；截图地址保持原来的 `/api/screenshot?file=…` 格式。同步接口也支持原 POST 请求。

前端配置修改 `backend/config/front.json`，图片模板修改 `backend/config/pic.json`，然后重新部署。原项目的 `/api/update` 未实现，本移植未把它描述为可用的配置保存功能。管理员默认密码仍禁止登录；MD5 登录协议沿用原项目，不等同于新增的安全认证系统。

## 本地运行

推荐 Node 24；构建工具兼容 EdgeOne 的 Node 22 构建环境。

```bash
npm ci
npm run build
# 如需测试数据库或 COS，将 .env.example 复制为 .env 并填写凭据
npm start
```

访问 `http://localhost:3123`。前端单独热更新可用 `npm run dev`，其 `/api` 代理到本地后端 3123。

平台调试需先登录，再执行 `npx edgeone pages dev`；平台部署也可使用控制台导入仓库。当前 EdgeOne CLI 需要登录或 API Token，不会自动获得你的腾讯云权限。

## 验证记录与边界

- `npm test`：3 个协议边界测试通过，覆盖 Java 分片帧、完整非法 JSON 不悬挂、标准基岩 UDP Ping 与中文 Pong。
- `npm run build`：生产前端构建通过。
- 本地真实 TCP/UDP 协议服务：完整 HTTP API 的 Java、Bedrock、auto 查询均返回 online；两类 PNG 返回有效图片。
- 浏览器实际提交查询并显示服务器状态；中文 PNG 字体已人工检查。
- 本地 SQLite 验证了异步初始化、缓存过期及统计结果。**未使用真实 COS / 远程数据库凭据进行云端验证。**
- 用户提供的公网服务器已通过完整 HTTP API 实测：`h1.getmc.cn:35070` 基岩版 online，版本 `1.21.124`、玩家 `0/50`、查询延迟 270 ms；`h1.getmc.cn:35071` Java 版 online，版本 `Purpur 26.1.2`、玩家 `0/91`、查询延迟 140 ms，纯文本 MOTD 为 `DFGD\nCreativeServer`。基岩服务器本次返回的 MOTD 为空。
- 其他公网目标 `mc.hypixel.net` 和 `play.lbsg.net` 在本次环境中超时，并不代表所有 TCP/UDP 出站不可用。EdgeOne CLI 调试因缺少登录凭据未能启动。**公网直连已在本机验证；尚未部署，未验证 EdgeOne 云端 TCP/UDP 出站。** 云端超时时应检查函数地域、平台出站及目标服务器防火墙；此实现不绕过网络限制，也不返回伪造 MOTD。

## 参考与许可

- [腾讯 EdgeOne 配置说明](https://cloud.tencent.com/document/product/1552/127389)
- [官方 Node 云函数与 Express 导出规范](https://github.com/TencentEdgeOne/edgeone-pages-plugin/blob/main/skills/node-functions/SKILL.md)
- [Noto CJK 字体来源](https://github.com/notofonts/noto-cjk)，字体许可证位于 `backend/fonts/LICENSE`。
- 原项目许可证保留在根目录 `LICENSE`。
