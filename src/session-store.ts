import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { BiliAuthCredentials } from "./bili-client";

export const SESSION_COOKIE = "bili_bridge_session";
const SESSION_FILE_VERSION = 1;

interface SessionRecord {
    credentials: BiliAuthCredentials;
    expiresAt: number;
}

interface SessionStoreOptions {
    ttlMs?: number;
    persistPath?: string;
}

interface PersistedSessionFile {
    version: number;
    sessions: Record<string, SessionRecord>;
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
    private readonly ttlMs: number;
    private readonly persistPath?: string;

    constructor(options: SessionStoreOptions = {}) {
        this.ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
        this.persistPath = options.persistPath;
        this.load();
    }

    create(credentials: BiliAuthCredentials): string {
        const id = crypto.randomBytes(24).toString("hex");
        this.sessions.set(id, {
            credentials: { ...credentials },
            expiresAt: Date.now() + this.ttlMs,
        });
        this.persist();
        return id;
    }

    get(id: string | undefined): BiliAuthCredentials | undefined {
        if (!id) return undefined;
        const record = this.sessions.get(id);
        if (!record) return undefined;
        if (record.expiresAt <= Date.now()) {
            this.sessions.delete(id);
            this.persist();
            return undefined;
        }
        return { ...record.credentials };
    }

    delete(id: string | undefined): void {
        if (id && this.sessions.delete(id)) this.persist();
    }

    private load(): void {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

        try {
            const raw = JSON.parse(fs.readFileSync(this.persistPath, "utf8")) as Partial<PersistedSessionFile>;
            if (raw.version !== SESSION_FILE_VERSION || !raw.sessions || typeof raw.sessions !== "object") {
                throw new Error("unsupported session file format");
            }
            const now = Date.now();
            for (const [id, record] of Object.entries(raw.sessions)) {
                if (
                    typeof record?.expiresAt === "number"
                    && record.expiresAt > now
                    && isCredentials(record.credentials)
                ) {
                    this.sessions.set(id, {
                        credentials: { ...record.credentials },
                        expiresAt: record.expiresAt,
                    });
                }
            }
            fs.chmodSync(this.persistPath, 0o600);
            if (Object.keys(raw.sessions).length !== this.sessions.size) this.persist();
        } catch (error) {
            console.warn(
                "Unable to load persisted login sessions:",
                error instanceof Error ? error.message : error,
            );
        }
    }

    private persist(): void {
        if (!this.persistPath) return;
        try {
            fs.mkdirSync(path.dirname(this.persistPath), { recursive: true, mode: 0o700 });
            const payload: PersistedSessionFile = {
                version: SESSION_FILE_VERSION,
                sessions: Object.fromEntries(
                    [...this.sessions.entries()].map(([id, record]) => [
                        id,
                        { credentials: record.credentials, expiresAt: record.expiresAt },
                    ]),
                ),
            };
            fs.writeFileSync(this.persistPath, `${JSON.stringify(payload, null, 2)}\n`, {
                encoding: "utf8",
                mode: 0o600,
            });
            fs.chmodSync(this.persistPath, 0o600);
        } catch (error) {
            console.warn(
                "Unable to persist login sessions:",
                error instanceof Error ? error.message : error,
            );
        }
    }
}
