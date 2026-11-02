import { describe, expect, it } from "vitest";
import {
    DEFAULT_DANMAKU_SETTINGS,
    loadDanmakuSettings,
    normalizeDanmakuSettings,
    normalizeRoomId,
    saveDanmakuSettings,
    shouldRetryPrefix,
    truncateToLimit,
    unicodeLength,
} from "../web/queue.js";

function memoryStorage(initial?: string) {
    let value = initial ?? null;
    return {
        getItem: () => value,
        setItem: (_key: string, next: string) => {
            value = next;
        },
    } as unknown as Storage;
}

describe("danmaku queue helpers", () => {
    it("uses 25 characters and prefix retry by default", () => {
        expect(DEFAULT_DANMAKU_SETTINGS).toEqual({
            autoRetryPrefix: true,
            limit: 25,
            roomId: "",
        });
    });

    it("counts and truncates Unicode code points without breaking emoji", () => {
        const text = "😀喵".repeat(15);
        expect(unicodeLength(text)).toBe(30);
        expect(truncateToLimit(text, 25)).toBe("😀喵".repeat(12) + "😀");
    });

    it("normalizes invalid persisted settings", () => {
        expect(normalizeDanmakuSettings({ limit: 0, autoRetryPrefix: false })).toEqual({
            autoRetryPrefix: false,
            limit: 25,
            roomId: "",
        });
        expect(normalizeDanmakuSettings({ limit: 80, roomId: "5861873" })).toEqual({
            autoRetryPrefix: true,
            limit: 80,
            roomId: "5861873",
        });
    });

    it("loads and saves settings through storage", () => {
        const storage = memoryStorage();
        expect(loadDanmakuSettings(storage)).toEqual(DEFAULT_DANMAKU_SETTINGS);
        expect(saveDanmakuSettings({ limit: 40, autoRetryPrefix: false, roomId: "5861873" }, storage)).toEqual({
            autoRetryPrefix: false,
            limit: 40,
            roomId: "5861873",
        });
        expect(loadDanmakuSettings(storage)).toEqual({
            autoRetryPrefix: false,
            limit: 40,
            roomId: "5861873",
        });
    });

    it("normalizes manual room IDs", () => {
        expect(normalizeRoomId("5861873")).toBe("5861873");
        expect(normalizeRoomId(" 5861873 ")).toBe("5861873");
        expect(normalizeRoomId("abc")).toBe("");
        expect(normalizeRoomId("")).toBe("");
    });

    it("retries the prefix only once on code 1003212", () => {
        expect(shouldRetryPrefix(1003212, "喵".repeat(30), 25, true)).toBe(true);
        expect(shouldRetryPrefix(1003212, "喵".repeat(30), 25, false)).toBe(false);
        expect(shouldRetryPrefix(10031, "喵".repeat(30), 25, true)).toBe(false);
        expect(shouldRetryPrefix(1003212, "喵".repeat(20), 25, true)).toBe(false);
    });
});
