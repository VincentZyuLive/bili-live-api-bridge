import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import { BiliApiError, BiliClient, type BiliAuthCredentials } from "../src/client";

const credentials: BiliAuthCredentials = {
    SESSDATA: "sessdata",
    bili_jct: "jct",
    DedeUserID: "10001",
    buvid3: "buvid3",
};

function clientWithResponse(data: Record<string, unknown>): BiliClient {
    const post = vi.fn().mockResolvedValue({ data });
    return new BiliClient({ post } as unknown as AxiosInstance);
}

describe("BiliClient.sendDanmaku", () => {
    it.each([
        { code: 0, msg: "ok" },
        { code: 0, msg: "" },
        { code: 0, msg: "success" },
        { code: 0, msg: "发送成功" },
    ])("treats a successful Bilibili response as success: $msg", async (response) => {
        await expect(
            clientWithResponse(response).sendDanmaku(credentials, "5861873", "1"),
        ).resolves.toBeUndefined();
    });

    it("keeps code 0 with msg f as a moderation rejection", async () => {
        await expect(
            clientWithResponse({ code: 0, msg: "f" }).sendDanmaku(
                credentials,
                "5861873",
                "github",
            ),
        ).rejects.toMatchObject<Partial<BiliApiError>>({
            code: 0,
            message: "f",
        });
    });

    it("keeps non-zero Bilibili errors as failures", async () => {
        await expect(
            clientWithResponse({ code: 10031, msg: "发送频率过快" }).sendDanmaku(
                credentials,
                "5861873",
                "1",
            ),
        ).rejects.toMatchObject<Partial<BiliApiError>>({
            code: 10031,
            message: "发送频率过快",
        });
    });
});

describe("BiliClient.startStream face authentication", () => {
    it("returns a QR data URL for 60024", async () => {
        const error = await clientWithResponse({
            code: 60024,
            message: "本次开播需要身份验证",
            data: { qr: "https://example.com/face-auth" },
        }).startStream(credentials, "5861873", 372).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BiliApiError);
        const apiError = error as BiliApiError;
        expect(apiError.code).toBe(60024);
        expect(apiError.stage).toBe("face_auth");
        expect(apiError.officialAuthUrl).toContain("face-auth");
        expect(apiError.faceAuthQr).toMatch(/^data:image\/png;base64,/);
    });

    it("builds the official 60043 URL with the logged-in UID", async () => {
        const error = await clientWithResponse({
            code: 60043,
            message: "本次开播需要身份验证",
            data: {},
        }).startStream(credentials, "5861873", 372).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BiliApiError);
        const apiError = error as BiliApiError;
        expect(apiError.code).toBe(60043);
        expect(apiError.stage).toBe("face_auth");
        expect(apiError.officialAuthUrl).toContain("face-auth-middle.html");
        expect(apiError.officialAuthUrl).toContain("mid=10001");
    });
});
