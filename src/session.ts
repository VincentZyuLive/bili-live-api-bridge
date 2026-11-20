import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { BiliAuthCredentials } from "./client";

export const SESSION_COOKIE = "bili_bridge_session";
const SESSION_FILE_VERSION = 2;
const LEGACY_SESSION_FILE_VERSION = 1;
const SESSION_PERSIST_INTERVAL_MS = 60 * 1000;
const DEFAULT_SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionRecord {
    credentials: BiliAuthCredentials;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
}

interface SessionStoreOptions {
    idleTtlMs?: number;
    absoluteTtlMs?: number;
    ttlMs?: number;
    persistPath?: string;
}

interface PersistedSessionFile {
    version: number;
    sessions: Record<string, Partial<SessionRecord>>;
}

export interface SessionView {
    credentials: BiliAuthCredentials;
    expiresAt: number;
    absoluteExpiresAt: number;
}

function isCredentials(value: unknown): value is BiliAuthCredentials {
    if (!value || typeof value !== "object") return false;
    const credentials = value as Record<string, unknown>;
    return ["SESSDATA", "bili_jct", "DedeUserID", "buvid3"].every(
        (key) => typeof credentials[key] === "string" && credentials[key].length > 0,
    );
}

export class SessionStore {
    private readonly sessions = new Map<string, SessionRecord>();
    private readonly idleTtlMs: number;
    private readonly absoluteTtlMs: number;
    private readonly persistPath?: string;
    private lastPersistAt = 0;

    constructor(options: SessionStoreOptions = {}) {
        this.idleTtlMs = options.idleTtlMs ?? options.ttlMs ?? DEFAULT_SESSION_IDLE_TTL_MS;
        const configuredAbsoluteTtl = options.absoluteTtlMs
            ?? options.ttlMs
            ?? Math.max(DEFAULT_SESSION_ABSOLUTE_TTL_MS, this.idleTtlMs);
        this.absoluteTtlMs = Math.max(configuredAbsoluteTtl, this.idleTtlMs);
        this.persistPath = options.persistPath;
        this.load();
    }

    create(credentials: BiliAuthCredentials): string {
        const now = Date.now();
        const id = crypto.randomBytes(24).toString("hex");
        this.sessions.set(id, {
            credentials: { ...credentials },
            createdAt: now,
            lastSeenAt: now,
            expiresAt: Math.min(now + this.idleTtlMs, now + this.absoluteTtlMs),
        });
        this.persist(true);
        return id;
    }

    get(id: string | undefined): BiliAuthCredentials | undefined {
        const record = this.liveRecord(id);
        return record ? { ...record.credentials } : undefined;
    }

    renew(id: string | undefined, options: { forcePersist?: boolean } = {}): SessionView | undefined {
        const now = Date.now();
        const record = this.liveRecord(id, now);
        if (!record) return undefined;

        const absoluteExpiresAt = record.createdAt + this.absoluteTtlMs;
        const nextExpiresAt = Math.min(now + this.idleTtlMs, absoluteExpiresAt);
        if (nextExpiresAt > record.expiresAt) record.expiresAt = nextExpiresAt;
        record.lastSeenAt = now;
        this.persist(options.forcePersist ?? false);

        return {
            credentials: { ...record.credentials },
            expiresAt: record.expiresAt,
            absoluteExpiresAt,
        };
    }

    getAbsoluteRemaining(id: string | undefined): number | undefined {
        const record = this.liveRecord(id);
        if (!record) return undefined;
        return Math.max(0, record.createdAt + this.absoluteTtlMs - Date.now());
    }

    delete(id: string | undefined): void {
        if (id && this.sessions.delete(id)) this.persist(true);
    }

    pruneExpired(): void {
        const now = Date.now();
        let changed = false;
        for (const [id, record] of this.sessions.entries()) {
            if (record.expiresAt <= now || record.createdAt + this.absoluteTtlMs <= now) {
                this.sessions.delete(id);
                changed = true;
            }
        }
        if (changed) this.persist(true);
    }

    private liveRecord(id: string | undefined, now = Date.now()): SessionRecord | undefined {
        if (!id) return undefined;
        const record = this.sessions.get(id);
        if (!record) return undefined;
        if (record.expiresAt <= now || record.createdAt + this.absoluteTtlMs <= now) {
            this.sessions.delete(id);
            this.persist(true);
            return undefined;
        }
        return record;
    }

    private load(): void {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

        try {
            const raw = JSON.parse(fs.readFileSync(this.persistPath, "utf8")) as Partial<PersistedSessionFile>;
            if (
                (raw.version !== SESSION_FILE_VERSION && raw.version !== LEGACY_SESSION_FILE_VERSION)
                || !raw.sessions
                || typeof raw.sessions !== "object"
            ) {
                throw new Error("unsupported session file format");
            }
            const now = Date.now();
            let changed = raw.version !== SESSION_FILE_VERSION;
            for (const [id, record] of Object.entries(raw.sessions)) {
                if (
                    typeof record.expiresAt !== "number"
                    || !isCredentials(record.credentials)
                ) {
                    changed = true;
                    continue;
                }
                const createdAt = typeof record.createdAt === "number" ? record.createdAt : now;
                const lastSeenAt = typeof record.lastSeenAt === "number" ? record.lastSeenAt : now;
                const absoluteExpiresAt = createdAt + this.absoluteTtlMs;
                if (record.expiresAt <= now || absoluteExpiresAt <= now) {
                    changed = true;
                    continue;
                }
                const expiresAt = Math.min(record.expiresAt, absoluteExpiresAt);
                if (
                    createdAt !== record.createdAt
                    || lastSeenAt !== record.lastSeenAt
                    || expiresAt !== record.expiresAt
                ) {
                    changed = true;
                }
                this.sessions.set(id, {
                    credentials: { ...record.credentials },
                    createdAt,
                    lastSeenAt,
                    expiresAt,
                });
            }
            fs.chmodSync(this.persistPath, 0o600);
            if (changed || Object.keys(raw.sessions).length !== this.sessions.size) {
                this.persist(true);
            }
        } catch (error) {
            console.warn(
                "⚠️ Unable to load persisted login sessions:",
                error instanceof Error ? error.message : error,
            );
        }
    }

    private persist(force = false): void {
        if (!this.persistPath) return;
        const now = Date.now();
        if (!force && now - this.lastPersistAt < SESSION_PERSIST_INTERVAL_MS) return;
        try {
            fs.mkdirSync(path.dirname(this.persistPath), { recursive: true, mode: 0o700 });
            const payload: PersistedSessionFile = {
                version: SESSION_FILE_VERSION,
                sessions: Object.fromEntries(
                    [...this.sessions.entries()].map(([id, record]) => [
                        id,
                        {
                            credentials: record.credentials,
                            createdAt: record.createdAt,
                            lastSeenAt: record.lastSeenAt,
                            expiresAt: record.expiresAt,
                        },
                    ]),
                ),
            };
            fs.writeFileSync(this.persistPath, `${JSON.stringify(payload, null, 2)}\n`, {
                encoding: "utf8",
                mode: 0o600,
            });
            fs.chmodSync(this.persistPath, 0o600);
            this.lastPersistAt = now;
        } catch (error) {
            console.warn(
                "⚠️ Unable to persist login sessions:",
                error instanceof Error ? error.message : error,
            );
        }
    }
}
