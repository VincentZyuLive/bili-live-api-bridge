import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { BiliAuthCredentials } from "../src/client";
import { SessionStore } from "../src/session";

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
    return path.join(dir, "cookie", "sessions.json");
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("SessionStore persistence", () => {
    it("restores an active session after a restart and uses private permissions", () => {
        const persistPath = tempSessionPath();
        const first = new SessionStore({ persistPath });
        const id = first.create(credentials);

        const mode = fs.statSync(persistPath).mode & 0o777;
        expect(mode).toBe(0o600);

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

    it("ignores a corrupt session file and can rewrite it", () => {
        const persistPath = tempSessionPath();
        fs.mkdirSync(path.dirname(persistPath), { recursive: true });
        fs.writeFileSync(persistPath, "not-json", "utf8");

        const store = new SessionStore({ persistPath });
        const id = store.create(credentials);
        expect(new SessionStore({ persistPath }).get(id)).toEqual(credentials);
    });
});
