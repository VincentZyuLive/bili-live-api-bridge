import { once } from "events";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, diffTags, normalizeTags } from "../src/app";
import { BiliApiError, MockBiliClient, parseProxyConfig } from "../src/client";
import { parseRuntimeConfig } from "../src/config";

const servers: Server[] = [];

async function startServer(client = new MockBiliClient()) {
    const app = createApp({ client, mode: "mock" });
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
}

async function readJson(response: Response) {
    return response.json() as Promise<any>;
}

async function loginWithSetCookie(baseUrl: string): Promise<{ cookie: string; setCookie: string }> {
    const challengeResponse = await fetch(`${baseUrl}/api/login/qrcode`);
    const challenge = await readJson(challengeResponse);
    const pollResponse = await fetch(
        `${baseUrl}/api/login/poll?token=${encodeURIComponent(challenge.token)}`,
    );
    expect(pollResponse.status).toBe(200);
    const setCookie = pollResponse.headers.get("set-cookie");
    expect(setCookie).toContain("bili_bridge_session=");
    return { cookie: setCookie!.split(";")[0], setCookie: setCookie! };
}

async function login(baseUrl: string): Promise<string> {
    return (await loginWithSetCookie(baseUrl)).cookie;
}

function cookieMaxAge(setCookie: string): number {
    const match = /Max-Age=(\d+)/i.exec(setCookie);
    return Number(match?.[1] || 0);
}

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise<void>((resolve) => {
                    server.close(() => resolve());
                }),
        ),
    );
});

describe("config", () => {
    it("defaults to live mode on port 61611", () => {
        expect(parseRuntimeConfig([], {})).toEqual({
            mode: "live",
            host: "127.0.0.1",
            port: 61611,
        });
    });

    it("supports mock mode and overrides", () => {
        expect(parseRuntimeConfig(["--mock", "--port", "62000", "--host=0.0.0.0"], {})).toEqual({
            mode: "mock",
            host: "0.0.0.0",
            port: 62000,
        });
    });

    it("parses the optional Bilibili proxy URL", () => {
        expect(parseProxyConfig("http://127.0.0.1:7890")).toEqual({
            protocol: "http",
            host: "127.0.0.1",
            port: 7890,
        });
        expect(parseProxyConfig("")).toBeUndefined();
    });
});

describe("tag helpers", () => {
    it("normalizes comma-separated tags", () => {
        expect(normalizeTags([" 测试, WebUI ", "测试", ""])).toEqual(["测试", "WebUI"]);
    });

    it("computes additions and removals", () => {
        expect(diffTags(["测试", "WebUI"], ["WebUI", "直播"])).toEqual({
            addTag: "直播",
            delTag: "测试",
        });
    });
});

describe("WebUI assets", () => {
    it("serves bundled LXGW WenKai assets and the pink TV favicon", async () => {
        const baseUrl = await startServer();

        const cssResponse = await fetch(`${baseUrl}/vendor/lxgw-wenkai/lxgw-wenkai.css`);
        const css = await cssResponse.text();
        expect(cssResponse.status).toBe(200);
        expect(css).toContain("font-family: 'LXGW WenKai'");

        const fontResponse = await fetch(
            `${baseUrl}/vendor/lxgw-wenkai/fonts/LXGWWenKai-300-000000.woff2`,
        );
        expect(fontResponse.status).toBe(200);
        expect((await fontResponse.arrayBuffer()).byteLength).toBeGreaterThan(1000);

        const faviconResponse = await fetch(`${baseUrl}/favicon.svg`);
        const favicon = await faviconResponse.text();
        expect(faviconResponse.status).toBe(200);
        expect(faviconResponse.headers.get("content-type")).toContain("image/svg+xml");
        expect(favicon).toContain("<svg");
        expect(favicon.toLowerCase()).toContain("#fb7299");

        const indexResponse = await fetch(`${baseUrl}/`);
        const index = await indexResponse.text();
        expect(index).toContain('id="qrFrame" class="qr-frame qr-hidden"');

        const stylesResponse = await fetch(`${baseUrl}/styles.css`);
        const styles = await stylesResponse.text();
        expect(styles).toContain(".qr-frame.qr-hidden");

        expect(index).toContain('id="danmakuForm"');
        expect(index).toContain('id="danmakuQueueList"');
        expect(index).toContain('id="danmakuAutoRetry"');
        expect(index).toContain('id="roomIdInput"');
        expect(index).toContain('id="areaSearchInput"');
        expect(index).toContain('id="areaTagWall"');
        expect(index).toContain('id="areaPinyinProToggle"');
        expect(index).toContain('id="areaFuseToggle"');
        expect(index).not.toContain('id="areaSelect"');
        expect(index).toContain('DANMU SEND');
        expect(index).toContain('class="github-repo-link"');
        expect(index).toContain('https://github.com/VincentZyuLive/bili-live-api-bridge');
        expect(index).toContain('aria-label="打开 GitHub 仓库"');
        expect(index).toContain('id="faceAuthPanel"');
        expect(index).toContain('id="faceAuthQrFrame"');
        expect(index).toContain('id="retryFaceAuthButton"');
        expect(index).not.toContain('id="faceAuthLink"');
        expect(index).not.toContain('打开 B 站官方认证页面');
        expect(index).toContain('id="sendDanmakuButton"');

        const appResponse = await fetch(`${baseUrl}/app.js`);
        const app = await appResponse.text();
        expect(app).toContain("function showQrFrame()");
        expect(app).toContain("function hideQrFrame()");
        expect(app).toContain("function enqueueDanmaku(event)");
        expect(app).toContain("function processDanmakuQueue()");
        expect(app).toContain("shouldRetryPrefix(");
        expect(app).toContain("buildPartitionSearchDocuments(");
        expect(app).toContain("createFuseIndex(");

        const fuseResponse = await fetch(`${baseUrl}/vendor/fuse/fuse.min.mjs`);
        expect(fuseResponse.status).toBe(200);
        expect(fuseResponse.headers.get("content-type")).toContain("javascript");
    });
});

describe("WebUI API", () => {
    it("requires authentication", async () => {
        const baseUrl = await startServer();
        const response = await fetch(`${baseUrl}/api/room/info`, { method: "POST" });
        expect(response.status).toBe(401);
    });

    it("logs in and exposes session state without credentials", async () => {
        const baseUrl = await startServer();
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { Cookie: cookie },
        });
        const body = await readJson(response);
        expect(body).toEqual({
            authenticated: true,
            DedeUserID: "10001",
            mode: "mock",
        });
        expect(JSON.stringify(body)).not.toContain("mock-sessdata");
    });

    it("returns pinyin-enhanced partitions and supports disabling pinyin-pro", async () => {
        const baseUrl = await startServer();
        const cookie = await login(baseUrl);

        const enhancedResponse = await fetch(`${baseUrl}/api/partitions`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ pinyinPro: true }),
        });
        const enhanced = await readJson(enhancedResponse);
        expect(enhanced.pinyinPro).toBe(true);
        const knowledge = enhanced.data.find((group: any) => group.name === "知识");
        const study = knowledge.list.find((area: any) => area.name === "自习室");
        expect(knowledge.search.enhancedPinyin).toBe("zhishi");
        expect(knowledge.search.enhancedInitials).toBe("zs");
        expect(study.search.pinyin).toBe("zixishi");
        expect(study.search.initials).toBe("zxs");

        const basicResponse = await fetch(`${baseUrl}/api/partitions`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ pinyinPro: false }),
        });
        const basic = await readJson(basicResponse);
        expect(basic.pinyinPro).toBe(false);
        const basicStudy = basic.data
            .find((group: any) => group.name === "知识")
            .list.find((area: any) => area.name === "自习室");
        expect(basicStudy.search.pinyin).toBe("zixishi");
        expect(basicStudy.search.initials).toBe("");
        expect(basicStudy.search.enhancedPinyin).toBe("");
    });

    it("validates the pinyinPro switch type", async () => {
        const baseUrl = await startServer();
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/partitions`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ pinyinPro: "yes" }),
        });
        expect(response.status).toBe(400);
        expect((await readJson(response)).message).toContain("boolean");
    });

    it("issues a long-lived session cookie and refreshes it on session checks", async () => {
        const baseUrl = await startServer();
        const { cookie, setCookie } = await loginWithSetCookie(baseUrl);
        expect(cookieMaxAge(setCookie)).toBeGreaterThan(12 * 60 * 60);

        const response = await fetch(`${baseUrl}/api/auth/session`, {
            headers: { Cookie: cookie },
        });
        expect(response.status).toBe(200);
        const refreshed = response.headers.get("set-cookie");
        expect(refreshed).toContain("bili_bridge_session=");
        expect(cookieMaxAge(refreshed!)).toBeGreaterThan(12 * 60 * 60);
    });

    it("reads and updates title, area and tags", async () => {
        const baseUrl = await startServer();
        const cookie = await login(baseUrl);

        const infoResponse = await fetch(`${baseUrl}/api/room/info`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: "{}",
        });
        const info = await readJson(infoResponse);
        expect(info.data.roomId).toBe("10001");
        expect(info.data.tags).toEqual(["测试", "WebUI"]);

        const updateResponse = await fetch(`${baseUrl}/api/room/update`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "新的直播标题",
                partitionId: 236,
                tags: ["WebUI", "直播"],
            }),
        });
        const updated = await readJson(updateResponse);
        expect(updated.code).toBe(0);
        expect(updated.data.title).toBe("新的直播标题");
        expect(updated.data.areaId).toBe(236);
        expect(updated.data.areaName).toBe("音乐");
        expect(updated.data.tags).toEqual(["WebUI", "直播"]);
    });

    it("accepts legacy body credentials without a session cookie", async () => {
        const baseUrl = await startServer();
        const response = await fetch(`${baseUrl}/api/room/info`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                SESSDATA: "legacy-sessdata",
                bili_jct: "legacy-jct",
                DedeUserID: "10001",
                buvid3: "legacy-buvid3",
            }),
        });
        expect(response.status).toBe(200);
        expect((await readJson(response)).data.roomId).toBe("10001");
    });

    it("rejects partition IDs outside the live partition list", async () => {
        const baseUrl = await startServer();
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/room/update`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ partitionId: 999999 }),
        });
        const body = await readJson(response);
        expect(response.status).toBe(400);
        expect(body.message).toContain("partition list");
    });

    it("starts and stops a mock live stream", async () => {
        const baseUrl = await startServer();
        const cookie = await login(baseUrl);

        const startResponse = await fetch(`${baseUrl}/api/start-stream`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({
                partitionId: 236,
                title: "开播测试",
                tags: ["测试"],
            }),
        });
        const started = await readJson(startResponse);
        expect(started).toMatchObject({
            code: 0,
            serverUrl: "rtmp://mock.local/live",
            streamKey: "mock-stream-key",
        });

        const liveInfo = await fetch(`${baseUrl}/api/room/info`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: "{}",
        });
        expect((await readJson(liveInfo)).data.liveStatus).toBe(1);

        const stopResponse = await fetch(`${baseUrl}/api/stop-stream`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: "{}",
        });
        expect((await readJson(stopResponse)).code).toBe(0);

        const offlineInfo = await fetch(`${baseUrl}/api/room/info`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: "{}",
        });
        expect((await readJson(offlineInfo)).data.liveStatus).toBe(0);
    });

    it("sends a danmaku with the active session", async () => {
        const client = new MockBiliClient();
        const baseUrl = await startServer(client);
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/danmaku/send`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ message: "  测试弹幕  " }),
        });
        const body = await readJson(response);
        expect(response.status).toBe(200);
        expect(body).toEqual({ code: 0, message: "弹幕发送成功" });
        expect(client.sentDanmaku).toEqual(["测试弹幕"]);
    });

    it("rejects invalid danmaku before calling Bilibili", async () => {
        const baseUrl = await startServer();
        const cookie = await login(baseUrl);
        for (const message of ["", "   ", "喵".repeat(1001), "第一行\n第二行"]) {
            const response = await fetch(`${baseUrl}/api/danmaku/send`, {
                method: "POST",
                headers: { Cookie: cookie, "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            });
            expect(response.status).toBe(400);
        }
    });

    it("accepts a danmaku longer than the old 20-character limit", async () => {
        const client = new MockBiliClient();
        const baseUrl = await startServer(client);
        const cookie = await login(baseUrl);
        const message = "测".repeat(25);
        const response = await fetch(`${baseUrl}/api/danmaku/send`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
        });
        expect(response.status).toBe(200);
        expect(client.sentDanmaku).toEqual([message]);
    });

    it("passes Bilibili over-limit errors through to the UI", async () => {
        class OverLimitClient extends MockBiliClient {
            override async sendDanmaku(): Promise<never> {
                throw new BiliApiError(1003212, "超出限制长度");
            }
        }

        const baseUrl = await startServer(new OverLimitClient());
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/danmaku/send`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ message: "超长测试" }),
        });
        expect(response.status).toBe(400);
        expect(await readJson(response)).toEqual({ code: 1003212, message: "超出限制长度" });
    });

    it("marks Bilibili moderation rejection instead of success", async () => {
        class BannedWordClient extends MockBiliClient {
            override async sendDanmaku(): Promise<never> {
                throw new BiliApiError(0, "f");
            }
        }

        const baseUrl = await startServer(new BannedWordClient());
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/danmaku/send`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ message: "github" }),
        });
        expect(response.status).toBe(400);
        expect(await readJson(response)).toEqual({ code: 0, message: "f" });
    });

    it("requires authentication for sending danmaku", async () => {
        const baseUrl = await startServer();
        const response = await fetch(`${baseUrl}/api/danmaku/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "测试" }),
        });
        expect(response.status).toBe(401);
    });

    it("returns Bilibili rate-limit errors for danmaku", async () => {
        class RateLimitClient extends MockBiliClient {
            override async sendDanmaku(): Promise<never> {
                throw new BiliApiError(10031, "发送频率过快");
            }
        }

        const baseUrl = await startServer(new RateLimitClient());
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/danmaku/send`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ message: "测试" }),
        });
        const body = await readJson(response);
        expect(response.status).toBe(400);
        expect(body).toEqual({ code: 10031, message: "发送频率过快" });
    });

    it("returns a structured upstream network error", async () => {
        class NetworkFailClient extends MockBiliClient {
            override async beginLogin(): Promise<never> {
                const error = new Error("Network Error") as Error & {
                    isAxiosError: boolean;
                    code: string;
                };
                error.isAxiosError = true;
                error.code = "ERR_NETWORK";
                throw error;
            }
        }

        const baseUrl = await startServer(new NetworkFailClient());
        const response = await fetch(`${baseUrl}/api/login/qrcode`);
        const body = await readJson(response);
        expect(response.status).toBe(502);
        expect(body).toEqual({
            code: 502,
            stage: "bilibili_network",
            message: "连接 B 站失败，请检查网络或 BILI_PROXY_URL",
        });
    });

    it("returns official auth URL for face verification errors", async () => {
        class FaceAuthClient extends MockBiliClient {
            override async startStream(): Promise<never> {
                throw new BiliApiError(60024, "本次开播需要身份验证", {
                    stage: "face_auth",
                    officialAuthUrl: "https://live.bilibili.com/p/html/bilili-page-face-auth/index.html",
                    faceAuthQr: "data:image/png;base64,dGVzdA==",
                });
            }
        }

        const baseUrl = await startServer(new FaceAuthClient());
        const cookie = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/start-stream`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: "{}",
        });
        const body = await readJson(response);
        expect(response.status).toBe(400);
        expect(body.code).toBe(60024);
        expect(body.stage).toBe("face_auth");
        expect(body.officialAuthUrl).toContain("face-auth");
        expect(body.faceAuthQr).toBe("data:image/png;base64,dGVzdA==");
    });
});
