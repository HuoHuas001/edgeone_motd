# MC MOTD API — EdgeOne Node 云函数版

由原 `mcmotdapi` 移植；保留 Vue 前端和原 API 路径，不需要原来的常驻 Node 服务器。

## 架构与功能

- EdgeOne 托管前端；`cloud-functions/api/[[default]].js` 导出 Express 实例，不监听端口。
- Java MOTD 使用真实 TCP Minecraft Server List Ping；基岩版使用真实 UDP RakNet Ping；支持 `stype=je/be/auto`、`srv=true`、原 `host` / `ip` / `port` 参数。
- 保留 `/api/status`、`/api/status_img`、`/api/app_img`、`/api/sync_app_img`、`/api/screenshot`、`/api/config`、`/api/login`、`/api/admin/stats`。
- 首页、文档、iframe、登录及管理页面保留；SPA 路由已配置 fallback，不拦截 API 或静态资源。
- 缓存、统计日志、临时截图统一保存到 EdgeOne Pages Blob，不需要外部数据库或另建对象存储桶。业务层只依赖平台无关的存储接口。
- 绘图使用 `@napi-rs/canvas`，无需编译 Cairo；附带 Noto CJK 字体，避免云端没有中文系统字体时出现方框。

**必须使用 Node 云函数，不能把后端放到 V8 边缘函数 `functions/` 下。**

## 多平台存储封装

`backend/storage/index.js` 定义统一接口：`getJSON`、`setJSON`、`getBytes`、`setBytes`、`delete`、`list({prefix,cursor})`。不存在的键返回 `null`；读写失败抛错；分页游标必须遍历到结束。业务层不引用平台 SDK，也不依赖 SQL、原子计数器、条件写或原生 TTL。

`backend/storage/edgeoneBlob.js` 是当前唯一适配器，负责强一致读取、分页以及错误转换。平台入口可通过 `configureStorage(adapter)` 或延迟创建的 `configureStorageFactory(factory)` 注入其他适配器。EdgeOne 云函数入口静态导入 Blob SDK，仅传命名空间，并把 SDK 构造器传给 CommonJS 适配器；SDK 必须参与函数打包，不能作为 external 依赖直接复制，否则会绕过部署凭据注入。缓存、统计和截图服务无需改写，未实现的平台名称会明确报错。

**存储封装不等于运行时已经跨平台。** 当前 HTTP 入口仍为 EdgeOne Node 云函数；Cloudflare/ESA 的 Node 兼容、TCP/UDP 出站能力及入口格式还需分别移植和实测，尤其不能假定支持基岩版 UDP。

## 部署到 EdgeOne

1. 将本目录作为独立仓库上传到 GitHub / GitLab / Gitee。
2. 在 EdgeOne Pages / Makers 控制台导入仓库，项目根目录选本目录，不要选 `front` 或 `dist`；框架选择其他 / 自定义。
3. 仓库的 `edgeone.json` 已配置：安装 `npm ci`，构建 `npm run build`，输出目录 `dist`，构建 Node `22.11.0`，云函数最大时长 60 秒。
4. 创建名为 `mcmotd` 的 Pages Blob Store（或通过 `STORAGE_NAMESPACE` 指定其他名称），按需配置管理员凭据，重新部署。云端由 SDK 使用部署凭据，无需手动填存储令牌。
5. 部署后打开首页，并分别用已知在线的 Java 和基岩服务器测试。函数地域应尽量靠近 Minecraft 服务器及存储服务。

`includeFiles` 保留后端模块、配置、字体与图片的目录结构；`externalNodeModules` 保留运行依赖及原生绘图库。配置使用当前 CLI 的 `cloudFunctions` 顶层字段。云函数入口必须显式创建并默认导出 Express 实例，不能仅通过动态 `require` 导出已有实例，否则构建器可能误判为普通函数。当前项目为 GitHub 部署类型，应提交到已关联分支触发云端 Linux 构建；CLI 不支持向该项目直接上传本机目录。

### 环境变量

所有变量参考 `.env.example`，密钥只放控制台环境变量或本地 `.env`，不要提交仓库。

| 变量 | 用途 |
| --- | --- |
| `QUERY_TIMEOUT_MS` | 查询超时，默认 5000 毫秒 |
| `STORAGE_PROVIDER` | 当前为 `edgeone-blob`，默认值同此 |
| `STORAGE_NAMESPACE` | Blob Store 名，默认 `mcmotd` |
| `STORAGE_ENABLED` | 默认启用；显式设为 `false` 可只使用实时 MOTD 和即时图片 |
| `EDGEONE_BLOB_PROJECT_ID` / `EDGEONE_BLOB_API_TOKEN` | 仅外部、本地访问 Blob 时配置；云端自动认证 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_MD5` | 管理员用户名及密码 MD5，兼容原前端登录请求 |

### 数据存储与过期

- `cache/`：按查询键的 SHA-256 保存 JSON 和时间戳；业务层检查 TTL，过期返回未命中。后续写入覆盖同一键。不在读取时删除过期键，避免另一实例已刷新缓存却被删除。
- `logs/`：每次查询写一份时间戳加 UUID 的独立 JSON，不使用会被并发覆盖的计数器。统计完整遍历所有分页并汇总，保留原总量、成功率、24 小时次数、Top10、最近20条和7日趋势字段。
- `images/`：PNG 二进制和 JSON 元数据分别保存；TTL 默认 300 秒。过期图片读取返回 404 并删除对象；缺失图片不伪造成功响应。

日志不自动裁剪，保证总查询次数仍是全历史统计。统计读取成本随日志量增长，并受平台函数时长及 Blob 配额约束；不会为控制成本偷偷只统计前一页。SDK 没有原生对象 TTL；过期未读的截图需定期运行 `npm run storage:cleanup`，外部执行时配置上面的项目 ID 和 API Token。

关闭存储时不使用缓存、不写查询日志；统计和临时截图接口明确返回 503。存储已启用但认证或读写失败时也明确报错，不会假装持久化成功。


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
# 本地无存储凭据：将 .env.example 复制为 .env，把 STORAGE_ENABLED 设为 false
npm start
```

访问 `http://localhost:3123`。前端单独热更新可用 `npm run dev`，其 `/api` 代理到本地后端 3123。

平台调试需先登录，再执行 `npx edgeone pages dev`；平台部署也可使用控制台导入仓库。当前 EdgeOne CLI 需要登录或 API Token，不会自动获得你的腾讯云权限。

## 验证记录与边界

- `npm test`：13 个协议及统计边界测试通过，覆盖 Java 分片帧、非法 JSON 不悬挂、基岩 UDP/中文 Pong、统计时间边界、排序及全历史总量。
- `npm run build`：生产前端构建通过。
- 本地真实 TCP/UDP 协议服务：完整 HTTP API 的 Java、Bedrock、auto 查询均返回 online；两类 PNG 返回有效图片。
- 浏览器实际提交查询并显示服务器状态；中文 PNG 字体已人工检查。
- 通过统一接口注入真实临时磁盘适配器，验证了缓存 TTL、截图写入/读取/过期删除、分页清理、25 个并发独立日志和完整 HTTP 统计（共28条）。磁盘适配器仅存在于已删除的验证脚本，不是生产回退。实际 Pages Blob 认证缺失时返回明确配置错误；**尚无真实 Blob 凭据，未验证云端持久化。**
- 用户提供的公网服务器已通过完整 HTTP API 实测：`h1.getmc.cn:35070` 基岩版 online，版本 `1.21.124`、玩家 `0/50`、查询延迟 270 ms；`h1.getmc.cn:35071` Java 版 online，版本 `Purpur 26.1.2`、玩家 `0/91`、查询延迟 140 ms，纯文本 MOTD 为 `DFGD\nCreativeServer`。基岩服务器本次返回的 MOTD 为空。
- 其他公网目标 `mc.hypixel.net` 和 `play.lbsg.net` 在本次环境中超时，并不代表所有 TCP/UDP 出站不可用。EdgeOne CLI 调试因缺少登录凭据未能启动。**公网直连已在本机验证；尚未部署，未验证 EdgeOne 云端 TCP/UDP 出站。** 云端超时时应检查函数地域、平台出站及目标服务器防火墙；此实现不绕过网络限制，也不返回伪造 MOTD。

## 参考与许可

- [腾讯 EdgeOne 配置说明](https://cloud.tencent.com/document/product/1552/127389)
- [官方 Node 云函数与 Express 导出规范](https://github.com/TencentEdgeOne/edgeone-pages-plugin/blob/main/skills/node-functions/SKILL.md)
- [Pages Blob SDK 与认证说明](https://pages-blob.edgeone.dev/)
- [Noto CJK 字体来源](https://github.com/notofonts/noto-cjk)，字体许可证位于 `backend/fonts/LICENSE`。
- 原项目许可证保留在根目录 `LICENSE`。
