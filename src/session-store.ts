import crypto from "crypto";
import type { BiliAuthCredentials } from "./bili-client";

export const SESSION_COOKIE = "bili_bridge_session";

interface SessionRecord {
    credentials: BiliAuthCredentials;
    expiresAt: number;
}

export class SessionStore {
    private readonly sessions = new Map<string, SessionRecord>();

    constructor(private readonly ttlMs = 12 * 60 * 60 * 1000) {}

    create(credentials: BiliAuthCredentials): string {
        const id = crypto.randomBytes(24).toString("hex");
        this.sessions.set(id, {
            credentials: { ...credentials },
            expiresAt: Date.now() + this.ttlMs,
        });
        return id;
    }

    get(id: string | undefined): BiliAuthCredentials | undefined {
        if (!id) return undefined;
        const record = this.sessions.get(id);
        if (!record) return undefined;
        if (record.expiresAt <= Date.now()) {
            this.sessions.delete(id);
            return undefined;
        }
        return { ...record.credentials };
    }

    delete(id: string | undefined): void {
        if (id) this.sessions.delete(id);
    }
}
