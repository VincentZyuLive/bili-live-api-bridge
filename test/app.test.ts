import { once } from "events";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, diffTags, normalizeTags } from "../src/app";
import { BiliApiError, MockBiliClient } from "../src/bili-client";
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

async function login(baseUrl: string): Promise<string> {
    const challengeResponse = await fetch(`${baseUrl}/api/login/qrcode`);
    const challenge = await readJson(challengeResponse);
    const pollResponse = await fetch(
        `${baseUrl}/api/login/poll?token=${encodeURIComponent(challenge.token)}`,
    );
    expect(pollResponse.status).toBe(200);
    const cookie = pollResponse.headers.get("set-cookie");
    expect(cookie).toContain("bili_bridge_session=");
    return cookie!.split(";")[0];
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

    it("returns official auth URL for face verification errors", async () => {
        class FaceAuthClient extends MockBiliClient {
            override async startStream(): Promise<never> {
                throw new BiliApiError(
                    60043,
                    "本次开播需要身份验证",
                    "https://live.bilibili.com/p/html/bilili-page-face-auth/index.html",
                );
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
        expect(body.code).toBe(60043);
        expect(body.officialAuthUrl).toContain("face-auth");
    });
});
