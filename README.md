# bili-live-api-bridge

一个非官方的 B 站直播 API 桥接工具，提供本地 WebUI 和 HTTP 接口，用于在 Linux、macOS、Windows 等环境中完成扫码登录、查看直播间信息、修改直播设置、开播和关播。

项目主要面向以下场景：

- 官方直播姬没有提供 Linux 版本，但用户希望在 Linux 上直播。
- 使用 OBS Studio 等通用推流软件，只通过本项目管理 B 站直播间状态。
- 研究扫码登录、直播信息修改和开播接口的互操作性。

> **重要说明**
>
> 本项目不是 B 站官方项目，也不是完整的直播姬替代品。B 站接口、风控和参数可能随时变化。
>
> 本项目不提供绕过实名认证、人脸认证、风控验证或其他身份校验的能力。扫脸必须由账号本人通过 B 站官方流程完成。

## 功能

WebUI 当前支持：

- 使用随 npm 本地托管的 LXGW WenKai 字体，不依赖外部字体 CDN。
- 粉色小电视风格的 SVG favicon。
- 扫码登录 B 站。
- 查看直播间号、标题、分区、标签和直播状态。
- 修改直播标题。
- 修改直播分区。
- 修改直播标签。
- 开播并获取 RTMP 服务器和推流密钥。
- 停止直播。
- 显示 `60024` / `60043` 人脸认证错误对应的官方认证入口。

首版 WebUI 不包含视频预览、OBS 场景、素材、弹幕、礼物或录制功能。

## 快速开始

需要 Node.js 20 或更高版本：

```bash
npm ci
```

模拟模式不会访问 B 站，适合预览 UI 和本地测试：

```bash
npm start -- --mock
```

真实模式通过扫码登录并操作真实直播间：

```bash
npm start -- --live
```

如果本机访问 B 站需要代理，只让服务端请求走代理即可：

```bash
BILI_PROXY_URL=http://127.0.0.1:7890 npm start -- --live
```

不传模式参数时默认使用 `--live`。默认访问地址：

```text
http://127.0.0.1:61611
```

WebUI 和 API 默认只监听本机。浏览器无法连接本地服务与本地服务无法连接 B 站会显示不同的错误提示。可通过环境变量或参数修改监听地址：

```bash
PORT=62000 HOST=0.0.0.0 npm start -- --live
npm start -- --live --port 62000 --host 0.0.0.0
```

> 不建议将服务暴露到公网。若必须跨机器访问，应放在受信任的内网中，并通过防火墙限制来源地址。

## 使用流程

1. 启动服务并打开 WebUI。
2. 点击“获取登录二维码”，使用哔哩哔哩手机客户端扫码。
3. 登录成功后，页面会自动读取当前直播间信息。
4. 分别修改标题、分区或标签，也可以直接点击“开始直播”。
5. 开播成功后将 RTMP 服务器和推流密钥填入 OBS。
6. 结束直播时在 WebUI 点击“停止直播”。

扫码登录成功后，服务端会：

- 创建仅保存在内存中的登录会话。
- 通过 `HttpOnly`、`SameSite=Strict` Cookie 关联浏览器。
- 将登录凭据保存到 `cookie/<DedeUserID>.json`，供兼容旧流程使用。

WebUI 不会把 `SESSDATA`、`bili_jct` 写入 `localStorage`、URL 或页面日志。

## HTTP API

兼容旧版 API 的请求体凭据：

```json
{
  "SESSDATA": "<SESSDATA>",
  "bili_jct": "<BILI_JCT>",
  "DedeUserID": "<DEDE_USER_ID>",
  "buvid3": "<BUVID3>"
}
```

WebUI 使用登录 Cookie 调用接口，因此页面请求不需要重复携带以上字段。旧客户端仍可在请求体中传入凭据。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 获取运行模式和状态 |
| `GET` | `/api/login/qrcode` | 获取登录二维码和临时会话 Token |
| `GET` | `/api/login/poll?token=...` | 轮询扫码状态并建立登录会话 |
| `GET` | `/api/auth/session` | 查询当前 WebUI 登录状态，不返回凭据 |
| `POST` | `/api/auth/logout` | 退出当前 WebUI 会话 |
| `POST` | `/api/partitions` | 获取直播分区列表 |
| `POST` | `/api/room/info` | 获取当前直播间信息 |
| `POST` | `/api/room/update` | 更新标题、分区或标签 |
| `POST` | `/api/start-stream` | 同步开播信息并申请推流 |
| `POST` | `/api/stop-stream` | 关闭直播 |

### 更新直播间信息

`POST /api/room/update` 支持按需提交以下字段：

```json
{
  "roomId": "123456",
  "title": "新的直播标题",
  "partitionId": 236,
  "tags": ["音乐", "聊天"]
}
```

- `roomId` 可省略，服务端会通过当前登录用户的 UID 获取直播间号。
- 标签会与当前标签比较，自动转换为 B 站接口需要的 `add_tag` 和 `del_tag`。
- 分区 ID 必须存在于当前直播分区列表。
- 只提交需要修改的字段。

### 开播

`POST /api/start-stream` 支持提交当前表单中的标题、分区和标签。服务端会先更新有变化的直播信息，再申请开播：

```json
{
  "partitionId": 236,
  "title": "直播标题",
  "tags": ["音乐", "聊天"]
}
```

成功响应包含：

```json
{
  "code": 0,
  "message": "Live stream started successfully",
  "serverUrl": "rtmp://...",
  "streamKey": "..."
}
```

### 关播

```json
POST /api/stop-stream
{}
```

## 人脸认证与错误码

直播姬日志和实际开播流程中可能遇到：

```text
code: 60043
message: 本次开播需要身份验证，请在关播时点击开播唤起人脸认证
```

也可能是 `60024`。此时应：

1. 由账号本人通过 B 站官方页面或官方客户端完成认证。
2. 不要把 `SESSDATA`、`v_voucher` 或认证链接交给第三方。
3. 不要尝试伪造摄像头、替代认证主体或绕过风控。
4. 认证完成后重新登录或重新发起开播请求。

## 网络与代理

- 浏览器显示 `NetworkError` 且无法访问 61611 时，通常是本地服务没有启动。
- 本地服务正常但访问 B 站失败时，`/api/login/qrcode` 会返回 HTTP `502` 和 `stage: "bilibili_network"`。
- 可通过 `BILI_PROXY_URL` 为服务端 B 站请求配置 HTTP/HTTPS 代理。
- `/api/health` 的 `upstreamProxy` 字段会显示当前是 `direct` 还是 `configured`。

## 本地验证

```bash
npm run typecheck
npm test
npm start -- --mock
```

自动化测试覆盖：

- 默认端口与 mock/live 参数。
- 扫码会话和 HttpOnly Cookie。
- 旧版请求体凭据兼容。
- 标题、分区、标签修改。
- 分区 ID 校验。
- 开播、下播和推流信息。
- 人脸认证错误透传。

真实开播测试会实际改变直播间状态。测试前应保存原房间标题、分区和标签，测试结束后恢复；若触发人脸认证，应立即停止测试并通过官方流程处理。

## 安全建议

- 默认只监听 `127.0.0.1`。
- 不要把 `cookie/`、`.env`、请求体截图或完整日志上传到 GitHub。
- 不要把 WebUI 直接暴露到公网。
- 怀疑凭据泄露时，立即退出 B 站相关设备的登录并重新扫码。

## 已知限制

- 接口参数、请求头和风控规则可能过期。
- 开播成功不代表推流服务器已经接收画面，仍需检查 OBS 日志和直播间状态。
- 登录会话只保存在当前服务进程内，服务重启后需要重新扫码。
- Cookie 文件以明文 JSON 保存，仅适合个人受控环境。

## 免责声明

本项目仅用于学习、研究和个人直播工作流互操作性测试。使用本项目造成的账号风险、风控限制、直播中断或数据泄露，由使用者自行承担。请遵守 B 站用户协议和相关法律法规。
