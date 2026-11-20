import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BiliAuthCredentials } from "../src/client";
import { SessionStore } from "../src/session";

const DAY = 24 * 60 * 60 * 1000;

const tempDirs: string[] = [];
const credentials: BiliAuthCredentials = {
    SESSDATA: "test-sessdata",
    bili_jct: "test-jct",
    DedeUserID: "10001",
    buvid3: "test-buvid3",
};

function tempSessionPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili-session-store-"));
    tempDirs.push(dir);
    return path.join(dir, "cache", "cookie", "sessions.json");
}

afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("SessionStore persistence", () => {
    it("restores an active session after a restart and uses private permissions", () => {
        const persistPath = tempSessionPath();
        const first = new SessionStore({ persistPath });
        const id = first.create(credentials);

        if (process.platform !== "win32") {
            const mode = fs.statSync(persistPath).mode & 0o777;
            expect(mode).toBe(0o600);
        }

        const restarted = new SessionStore({ persistPath });
        expect(restarted.get(id)).toEqual(credentials);

        restarted.delete(id);
        expect(new SessionStore({ persistPath }).get(id)).toBeUndefined();
    });

    it("drops expired sessions while loading", () => {
        const persistPath = tempSessionPath();
        const first = new SessionStore({ persistPath, ttlMs: -1 });
        const id = first.create(credentials);

        const restarted = new SessionStore({ persistPath });
        expect(restarted.get(id)).toBeUndefined();
        const saved = JSON.parse(fs.readFileSync(persistPath, "utf8"));
        expect(saved.sessions).toEqual({});
    });

    it("slides the idle lifetime and stops at the absolute lifetime", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const persistPath = tempSessionPath();
        const store = new SessionStore({
            persistPath,
            idleTtlMs: 7 * DAY,
            absoluteTtlMs: 30 * DAY,
        });
        const id = store.create(credentials);

        vi.advanceTimersByTime(6 * DAY);
        expect(store.renew(id, { forcePersist: true })?.expiresAt).toBe(
            Date.now() + 7 * DAY,
        );

        for (let index = 0; index < 3; index += 1) {
            vi.advanceTimersByTime(6 * DAY);
            store.renew(id, { forcePersist: true });
        }
        expect(store.renew(id, { forcePersist: true })?.expiresAt).toBe(
            new Date("2026-01-31T00:00:00Z").getTime(),
        );

        vi.advanceTimersByTime(6 * DAY);
        expect(store.get(id)).toBeUndefined();
    });

    it("expires an idle session after the idle lifetime", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const persistPath = tempSessionPath();
        const store = new SessionStore({
            persistPath,
            idleTtlMs: 7 * DAY,
            absoluteTtlMs: 30 * DAY,
        });
        const id = store.create(credentials);

        vi.advanceTimersByTime(8 * DAY);
        expect(store.get(id)).toBeUndefined();
        expect(JSON.parse(fs.readFileSync(persistPath, "utf8")).sessions).toEqual({});
    });

    it("migrates legacy session files to the current format", () => {
        const persistPath = tempSessionPath();
        fs.mkdirSync(path.dirname(persistPath), { recursive: true });
        const expiresAt = Date.now() + 60 * 60 * 1000;
        fs.writeFileSync(
            persistPath,
            JSON.stringify({
                version: 1,
                sessions: {
                    legacy: { credentials, expiresAt },
                },
            }),
            "utf8",
        );

        const store = new SessionStore({ persistPath });
        expect(store.get("legacy")).toEqual(credentials);
        const saved = JSON.parse(fs.readFileSync(persistPath, "utf8"));
        expect(saved.version).toBe(2);
        expect(saved.sessions.legacy.createdAt).toBeTypeOf("number");
        expect(saved.sessions.legacy.lastSeenAt).toBeTypeOf("number");
    });

    it("ignores a corrupt session file and can rewrite it", () => {
        const persistPath = tempSessionPath();
        fs.mkdirSync(path.dirname(persistPath), { recursive: true });
        fs.writeFileSync(persistPath, "not-json", "utf8");

        const store = new SessionStore({ persistPath });
        const id = store.create(credentials);
        expect(new SessionStore({ persistPath }).get(id)).toEqual(credentials);
    });
});
