# bili-live-api-bridge

一个非官方的 B 站直播 API 实验项目，用于在 Linux、macOS、Windows 等环境中通过 HTTP 接口完成扫码登录、查询分区、开播、获取 RTMP 推流信息以及关播。

项目主要面向以下场景：

- 官方直播姬没有提供 Linux 版本，但用户希望在 Linux 上直播。
- 使用 OBS Studio 等通用推流软件推流，只通过 API 管理 B 站直播间状态。
- 研究扫码登录、开播接口和错误码处理的可行性。

> **重要说明**
>
> 本项目不是 B 站官方项目，也不是完整的直播姬替代品。B 站的接口、风控和参数可能随时变化。
>
> 本项目不提供绕过实名认证、人脸认证、风控验证或其他身份校验的能力。扫脸必须由账号本人通过 B 站官方流程完成。

## 功能

当前示例代码 `B站各种api.ts` 提供以下接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/login/qrcode` | 获取登录二维码和临时会话 Token |
| `GET` | `/api/login/poll?token=...` | 轮询扫码状态并获取登录 Cookie |
| `POST` | `/api/partitions` | 获取直播分区列表 |
| `POST` | `/api/start-stream` | 更新标题并申请开播，返回 RTMP 地址和推流密钥 |
| `POST` | `/api/stop-stream` | 关闭直播 |

扫码成功后会生成：

```text
cookie/<DedeUserID>.json
```

该文件包含登录凭据，已被 `.gitignore` 排除，不要上传、截图或发送给他人。

## Linux 上的推荐思路

直播姬本身是 Windows/macOS 客户端，不必强行用 Wine 或虚拟机模拟整套客户端。推荐拆成两件事：

1. 使用本项目或 B 站直播中心完成账号验证，并取得 RTMP 服务器地址和推流密钥。
2. 使用 Debian 仓库中的 OBS Studio 进行编码和推流。

Debian 13 可安装 OBS：

```bash
sudo apt update
sudo apt install obs-studio
```

在 OBS 中设置：

- 服务：`自定义`
- 服务器：接口返回的 `serverUrl`
- 推流密钥：接口返回的 `streamKey`

随后在 OBS 中点击“开始推流”。编码器可先使用 `x264`；也可以根据 Intel Iris Xe 核显测试 `QSV`，以降低 CPU 占用。

## 运行环境

- Node.js 20 或更高版本
- npm
- 可访问 B 站接口的网络环境

原始代码是单个 TypeScript 文件，仓库暂未附带 `package.json`。可以按下面的方式建立本地运行环境。

```bash
npm init -y
npm install express axios qrcode
npm install -D typescript tsx @types/node @types/express @types/qrcode
npx tsx "B站各种api.ts"
```

默认监听端口为 `12345`，可通过环境变量修改：

```bash
PORT=12345 npx tsx "B站各种api.ts"
```

> 示例服务没有额外的访问控制，不建议直接暴露到公网。若必须跨机器访问，应放在受信任的内网中，并通过防火墙限制来源地址。

## 使用流程

### 1. 获取登录二维码

```bash
curl http://127.0.0.1:12345/api/login/qrcode
```

响应中的 `qrcode` 是 Data URL，可在浏览器中打开并转换为图片，或者由前端直接渲染。保存响应中的 `token`。

### 2. 使用 B 站手机客户端扫码

轮询登录状态：

```bash
curl "http://127.0.0.1:12345/api/login/poll?token=<TOKEN>"
```

常见状态：

- `86101`：等待扫码
- `86090`：已扫码，等待手机端确认
- `86038`：二维码过期
- `200`：登录成功，返回凭据

登录成功后响应示例结构：

```json
{
  "SESSDATA": "...",
  "bili_jct": "...",
  "DedeUserID": "...",
  "buvid3": "..."
}
```

不要把上述值提交到 Git 或发送给他人。`SESSDATA` 等同于账号登录凭据。

### 3. 获取直播分区

将登录凭据放入请求体：

```bash
curl -X POST http://127.0.0.1:12345/api/partitions \
  -H "Content-Type: application/json" \
  -d '{
    "SESSDATA": "<SESSDATA>",
    "bili_jct": "<BILI_JCT>",
    "DedeUserID": "<DEDE_USER_ID>",
    "buvid3": "<BUVID3>"
  }'
```

从响应中选取分区 `id`，作为开播请求的 `partitionId`。

### 4. 开播并获取推流信息

```bash
curl -X POST http://127.0.0.1:12345/api/start-stream \
  -H "Content-Type: application/json" \
  -d '{
    "SESSDATA": "<SESSDATA>",
    "bili_jct": "<BILI_JCT>",
    "DedeUserID": "<DEDE_USER_ID>",
    "buvid3": "<BUVID3>",
    "roomId": "<ROOM_ID>",
    "partitionId": "<PARTITION_ID>",
    "title": "直播标题"
  }'
```

成功时返回：

```json
{
  "message": "Live stream started successfully!",
  "serverUrl": "rtmp://...",
  "streamKey": "..."
}
```

将这两个值填入 OBS 的自定义推流设置。

### 5. 关播

```bash
curl -X POST http://127.0.0.1:12345/api/stop-stream \
  -H "Content-Type: application/json" \
  -d '{
    "SESSDATA": "<SESSDATA>",
    "bili_jct": "<BILI_JCT>",
    "DedeUserID": "<DEDE_USER_ID>",
    "buvid3": "<BUVID3>",
    "roomId": "<ROOM_ID>"
  }'
```

## 人脸认证与错误码 60043

直播姬日志和实际开播流程中可能遇到：

```text
code: 60043
message: 本次开播需要身份验证，请在关播时点击开播唤起人脸认证
```

响应中可能同时带有 `risk_extra.v_voucher`。直播姬会打开 B 站官方页面：

```text
https://live.bilibili.com/p/html/bilili-page-face-auth/index.html
```

处理原则：

1. 由账号本人通过 B 站官方页面或官方客户端完成人脸认证。
2. 不要把 `SESSDATA`、`v_voucher` 或认证页面链接交给第三方。
3. 不要尝试伪造摄像头、替代认证主体或绕过风控。
4. 认证完成后重新登录或重新发起开播请求。
5. 如果官方页面只能在直播姬内打开，请临时在 Windows/macOS 或手机官方流程中完成一次认证，再回到 Linux 使用 OBS 推流。

`v_voucher` 通常是短时凭证，不应写入 README、日志或长期配置文件。

## 已知限制

- 接口参数、请求头和风控规则可能过期。
- 当前示例没有自动处理 `60043` 并跳转官方认证页面。
- `startLive` 成功并不保证推流服务器一定接受连接，仍需检查 OBS 日志和直播间状态。
- Cookie 文件以明文 JSON 保存，仅适合个人受控环境。
- 本项目不包含弹幕、礼物、录制、场景管理或视频处理功能。

## 安全建议

- 私有仓库只用于个人备份，不要将其改成公开仓库后继续提交凭据。
- 不要把 `cookie/`、`.env`、请求体截图或完整日志上传到 GitHub。
- 怀疑凭据泄露时，立即退出 B 站相关设备的登录并重新扫码。
- 服务仅监听本机或可信内网，不直接暴露公网端口。

## 免责声明

本项目仅用于学习、研究和个人直播工作流互操作性测试。使用本项目造成的账号风险、风控限制、直播中断或数据泄露，由使用者自行承担。请遵守 B 站用户协议和相关法律法规。