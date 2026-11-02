import axios from "axios";
import crypto from "crypto";
import express, { NextFunction, Request, Response } from "express";
import path from "path";
import {
    BiliApiError,
    BiliAuthCredentials,
    LiveClient,
    RoomInfo,
    RoomUpdate,
} from "./bili-client";
import type { RuntimeMode } from "./config";
import { SESSION_COOKIE, SessionStore } from "./session-store";

interface CreateAppOptions {
    client: LiveClient;
    mode: RuntimeMode;
    sessions?: SessionStore;
    webDir?: string;
}

interface LoginRecord {
    challenge: Awaited<ReturnType<LiveClient["beginLogin"]>>;
    expiresAt: number;
}

export interface TagDiff {
    addTag?: string;
    delTag?: string;
}

export function normalizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new HttpError(400, "tags must be an array of strings");
    }
    const result: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string") {
            throw new HttpError(400, "tags must contain only strings");
        }
        for (const part of item.split(",")) {
            const tag = part.trim();
            if (tag && !seen.has(tag)) {
                seen.add(tag);
                result.push(tag);
            }
        }
    }
    return result;
}

export function diffTags(current: string[], next: string[]): TagDiff {
    const currentSet = new Set(current);
    const nextSet = new Set(next);
    const added = next.filter((tag) => !currentSet.has(tag));
    const removed = current.filter((tag) => !nextSet.has(tag));
    return {
        addTag: added.length > 0 ? added.join(",") : undefined,
        delTag: removed.length > 0 ? removed.join(",") : undefined,
    };
}

class HttpError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "HttpError";
    }
}

function cookieValue(req: Request, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const pair of header.split(";")) {
        const separator = pair.indexOf("=");
        if (separator < 0) continue;
        if (pair.slice(0, separator).trim() === name) {
            return decodeURIComponent(pair.slice(separator + 1).trim());
        }
    }
    return undefined;
}

function bodyCredentials(body: unknown): BiliAuthCredentials | undefined {
    if (!body || typeof body !== "object") return undefined;
    const value = body as Record<string, unknown>;
    const names = ["SESSDATA", "bili_jct", "DedeUserID", "buvid3"] as const;
    if (!names.every((name) => typeof value[name] === "string" && value[name])) {
        return undefined;
    }
    return {
        SESSDATA: value.SESSDATA as string,
        bili_jct: value.bili_jct as string,
        DedeUserID: value.DedeUserID as string,
        buvid3: value.buvid3 as string,
    };
}

function resolveCredentials(req: Request, sessions: SessionStore): BiliAuthCredentials | undefined {
    return bodyCredentials(req.body) || sessions.get(cookieValue(req, SESSION_COOKIE));
}

function requireCredentials(req: Request, sessions: SessionStore): BiliAuthCredentials {
    const credentials = resolveCredentials(req, sessions);
    if (!credentials) throw new HttpError(401, "Not authenticated");
    return credentials;
}

function optionalRoomId(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
        throw new HttpError(400, "roomId must be a numeric string");
    }
    return String(value);
}

function optionalTitle(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new HttpError(400, "title must be a string");
    const title = value.trim();
    if (!title) throw new HttpError(400, "title must not be empty");
    if (title.length > 80) throw new HttpError(400, "title must be at most 80 characters");
    return title;
}

function optionalAreaId(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const areaId = Number(value);
    if (!Number.isInteger(areaId) || areaId <= 0) {
        throw new HttpError(400, "partitionId must be a positive integer");
    }
    return areaId;
}

function normalizeDanmakuMessage(value: unknown): string {
    if (typeof value !== "string") throw new HttpError(400, "message must be a string");
    const message = value.trim();
    if (!message) throw new HttpError(400, "message must not be empty");
    if (/[\r\n\t\u0000-\u001f\u007f]/.test(message)) {
        throw new HttpError(400, "message must be a single line without control characters");
    }
    if (Array.from(message).length > 1000) {
        throw new HttpError(400, "message must be at most 1000 characters");
    }
    return message;
}

async function resolveRoomId(
    client: LiveClient,
    credentials: BiliAuthCredentials,
    requestedRoomId: unknown,
): Promise<{ roomId: string; room: RoomInfo }> {
    const room = await client.getRoomInfo(credentials, optionalRoomId(requestedRoomId));
    return { roomId: room.roomId, room };
}

async function applyRoomUpdate(
    client: LiveClient,
    credentials: BiliAuthCredentials,
    roomId: string,
    input: { title?: unknown; partitionId?: unknown; tags?: unknown },
): Promise<RoomInfo> {
    const current = await client.getRoomInfo(credentials, roomId);
    const update: RoomUpdate = {};

    const title = optionalTitle(input.title);
    if (title !== undefined && title !== current.title) update.title = title;

    const areaId = optionalAreaId(input.partitionId);
    if (areaId !== undefined && areaId !== current.areaId) {
        const partitions = await client.getPartitions(credentials);
        const knownArea = partitions.some((group) =>
            group.list.some((area) => Number(area.id) === areaId),
        );
        if (!knownArea) throw new HttpError(400, "partitionId is not in the live partition list");
        update.areaId = areaId;
    }

    if (input.tags !== undefined) {
        const nextTags = normalizeTags(input.tags);
        const tagDiff = diffTags(current.tags, nextTags);
        if (tagDiff.addTag) update.addTag = tagDiff.addTag;
        if (tagDiff.delTag) update.delTag = tagDiff.delTag;
    }

    if (Object.keys(update).length === 0) return current;
    await client.updateRoom(credentials, roomId, update);
    return client.getRoomInfo(credentials, roomId);
}

function asyncRoute(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
    return (req: Request, res: Response, next: NextFunction) => {
        void handler(req, res, next).catch(next);
    };
}

export function createApp(options: CreateAppOptions) {
    const { client, mode } = options;
    const sessions = options.sessions || new SessionStore();
    const loginSessions = new Map<string, LoginRecord>();
    const webDir = options.webDir || path.resolve(__dirname, "../web");
    const lxgwFontDir = path.resolve(__dirname, "../node_modules/@free-fonts/lxgw-wenkai");
    const app = express();

    app.disable("x-powered-by");
    app.use(express.json({ limit: "64kb" }));
    app.use(
        "/vendor/lxgw-wenkai",
        express.static(lxgwFontDir, { immutable: true, maxAge: "1y" }),
    );
    app.use(express.static(webDir, { extensions: ["html"] }));

    app.get("/api/health", (_req, res) => {
        res.json({
            ok: true,
            mode,
            port: Number(process.env.PORT || 61611),
            upstreamProxy: process.env.BILI_PROXY_URL ? "configured" : "direct",
        });
    });

    app.get(
        "/api/login/qrcode",
        asyncRoute(async (_req, res) => {
            const challenge = await client.beginLogin();
            const token = crypto.randomBytes(16).toString("hex");
            loginSessions.set(token, {
                challenge,
                expiresAt: Date.now() + 10 * 60 * 1000,
            });
            res.json({ token, qrcode: challenge.qrcode, mode });
        }),
    );

    app.get(
        "/api/login/poll",
        asyncRoute(async (req, res) => {
            const token = typeof req.query.token === "string" ? req.query.token : "";
            const login = loginSessions.get(token);
            if (!login || login.expiresAt <= Date.now()) {
                loginSessions.delete(token);
                res.status(404).json({ code: -1, message: "Invalid or expired token" });
                return;
            }

            const result = await client.pollLogin(login.challenge);
            if (result.code === 0 && result.credentials) {
                loginSessions.delete(token);
                const sessionId = sessions.create(result.credentials);
                res.cookie(SESSION_COOKIE, sessionId, {
                    httpOnly: true,
                    sameSite: "strict",
                    path: "/",
                    maxAge: 12 * 60 * 60 * 1000,
                });
                res.json({ ...result.credentials, authenticated: true, mode });
                return;
            }

            if (result.code === 86101 || result.code === 86090) {
                res.status(202).json(result);
                return;
            }
            if (result.code === 86038) {
                loginSessions.delete(token);
                res.status(410).json(result);
                return;
            }
            res.status(400).json(result);
        }),
    );

    app.get("/api/auth/session", (req, res) => {
        const credentials = sessions.get(cookieValue(req, SESSION_COOKIE));
        res.json({
            authenticated: Boolean(credentials),
            DedeUserID: credentials?.DedeUserID || null,
            mode,
        });
    });

    app.post("/api/auth/logout", (req, res) => {
        sessions.delete(cookieValue(req, SESSION_COOKIE));
        res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", path: "/" });
        res.json({ authenticated: false });
    });

    app.post(
        "/api/partitions",
        asyncRoute(async (req, res) => {
            const credentials = requireCredentials(req, sessions);
            const partitions = await client.getPartitions(credentials);
            res.json({ code: 0, message: "ok", data: partitions });
        }),
    );

    app.post(
        "/api/room/info",
        asyncRoute(async (req, res) => {
            const credentials = requireCredentials(req, sessions);
            const { room } = await resolveRoomId(client, credentials, req.body?.roomId);
            res.json({ code: 0, message: "ok", data: room });
        }),
    );

    app.post(
        "/api/room/update",
        asyncRoute(async (req, res) => {
            const credentials = requireCredentials(req, sessions);
            const { roomId } = await resolveRoomId(client, credentials, req.body?.roomId);
            const hasUpdate =
                req.body?.title !== undefined ||
                req.body?.partitionId !== undefined ||
                req.body?.tags !== undefined;
            if (!hasUpdate) throw new HttpError(400, "No room fields supplied");

            const room = await applyRoomUpdate(client, credentials, roomId, {
                title: req.body?.title,
                partitionId: req.body?.partitionId,
                tags: req.body?.tags,
            });
            res.json({ code: 0, message: "Room updated", data: room });
        }),
    );

    app.post(
        "/api/start-stream",
        asyncRoute(async (req, res) => {
            const credentials = requireCredentials(req, sessions);
            const { roomId, room: current } = await resolveRoomId(
                client,
                credentials,
                req.body?.roomId,
            );
            const hasMetadataUpdate =
                req.body?.title !== undefined ||
                req.body?.partitionId !== undefined ||
                req.body?.tags !== undefined;
            const room = hasMetadataUpdate
                ? await applyRoomUpdate(client, credentials, roomId, {
                      title: req.body?.title,
                      partitionId: req.body?.partitionId,
                      tags: req.body?.tags,
                  })
                : current;
            const stream = await client.startStream(credentials, roomId, room.areaId);
            res.json({
                code: 0,
                message: "Live stream started successfully",
                serverUrl: stream.serverUrl,
                streamKey: stream.streamKey,
            });
        }),
    );

    app.post(
        "/api/stop-stream",
        asyncRoute(async (req, res) => {
            const credentials = requireCredentials(req, sessions);
            const { roomId } = await resolveRoomId(client, credentials, req.body?.roomId);
            await client.stopStream(credentials, roomId);
            res.json({ code: 0, message: "Live stream stopped successfully" });
        }),
    );

    app.post(
        "/api/danmaku/send",
        asyncRoute(async (req, res) => {
            const credentials = requireCredentials(req, sessions);
            const message = normalizeDanmakuMessage(req.body?.message);
            const { roomId } = await resolveRoomId(client, credentials, req.body?.roomId);
            await client.sendDanmaku(credentials, roomId, message);
            res.json({ code: 0, message: "弹幕发送成功" });
        }),
    );

    app.use((req, _res, next) => {
        if (req.path.startsWith("/api/")) {
            next(new HttpError(404, "API endpoint not found"));
            return;
        }
        next(new HttpError(404, "Not found"));
    });

    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (error instanceof HttpError) {
            res.status(error.status).json({ code: error.status, message: error.message });
            return;
        }
        if (error instanceof BiliApiError) {
            res.status(400).json({
                code: error.code,
                message: error.message,
                ...(error.officialAuthUrl ? { officialAuthUrl: error.officialAuthUrl } : {}),
            });
            return;
        }
        if (axios.isAxiosError(error)) {
            console.error("Bilibili upstream request failed:", error.code || error.message);
            res.status(502).json({
                code: 502,
                stage: "bilibili_network",
                message: "连接 B 站失败，请检查网络或 BILI_PROXY_URL",
            });
            return;
        }
        console.error("Unhandled request error:", error instanceof Error ? error.message : error);
        res.status(500).json({ code: 500, message: "Internal server error" });
    });

    return app;
}
