import axios, { AxiosInstance, AxiosProxyConfig, AxiosRequestConfig } from "axios";
import crypto from "crypto";
import qrcode from "qrcode";
import { URLSearchParams } from "url";
import { enrichPartitions, type PartitionGroup, type PartitionOptions } from "./partitions";

export type { PartitionArea, PartitionGroup, PartitionOptions, PartitionSearchIndex } from "./partitions";

export interface BiliAuthCredentials {
    SESSDATA: string;
    bili_jct: string;
    DedeUserID: string;
    buvid3: string;
}

export interface LoginChallenge {
    qrcode: string;
    state: unknown;
}

export interface LoginPollResult {
    code: number;
    message: string;
    credentials?: BiliAuthCredentials;
}

export interface BiliResult<T = undefined> {
    code: number;
    message: string;
    data?: T;
}

export interface RoomInfo {
    roomId: string;
    uid: string;
    title: string;
    areaId: number;
    parentAreaId: number;
    areaName: string;
    parentAreaName: string;
    tags: string[];
    liveStatus: number;
}

export interface RoomUpdate {
    title?: string;
    areaId?: number;
    addTag?: string;
    delTag?: string;
}

export interface StartStreamData {
    serverUrl: string;
    streamKey: string;
}

export interface LiveClient {
    beginLogin(): Promise<LoginChallenge>;
    pollLogin(challenge: LoginChallenge): Promise<LoginPollResult>;
    getPartitions(credentials: BiliAuthCredentials, options?: PartitionOptions): Promise<PartitionGroup[]>;
    getRoomInfo(credentials: BiliAuthCredentials, roomId?: string): Promise<RoomInfo>;
    updateRoom(credentials: BiliAuthCredentials, roomId: string, update: RoomUpdate): Promise<void>;
    startStream(
        credentials: BiliAuthCredentials,
        roomId: string,
        areaId: number,
    ): Promise<StartStreamData>;
    stopStream(credentials: BiliAuthCredentials, roomId: string): Promise<void>;
    sendDanmaku(credentials: BiliAuthCredentials, roomId: string, message: string): Promise<void>;
}

export interface BiliApiErrorOptions {
    officialAuthUrl?: string;
    faceAuthQr?: string;
    stage?: string;
}

export class BiliApiError extends Error {
    readonly officialAuthUrl?: string;
    readonly faceAuthQr?: string;
    readonly stage?: string;

    constructor(
        public readonly code: number | string,
        message: string,
        options: BiliApiErrorOptions = {},
    ) {
        super(message);
        this.name = "BiliApiError";
        this.officialAuthUrl = options.officialAuthUrl;
        this.faceAuthQr = options.faceAuthQr;
        this.stage = options.stage;
    }
}

const APP_KEY = "aae92bc66f3edfab";
const APP_SECRET = "af125a0d5279fd576c1b4418a3e8276d"; // gitleaks:allow - public Bilibili web-client signing secret, not a user credential
const AUTH_ERROR_CODES = new Set([60024, 60043]);
const FACE_AUTH_URL = "https://live.bilibili.com/p/html/bilili-page-face-auth/index.html";
const REQUEST_TIMEOUT_MS = 10_000;

const URLS = {
    GET_BUVID: "https://api.bilibili.com/x/web-frontend/getbuvid",
    SERVER_TIME: "https://api.bilibili.com/x/report/click/now",
    QR_GENERATE: "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
    QR_POLL: "https://passport.bilibili.com/x/passport-login/web/qrcode/poll",
    ROOM_ID_BY_UID: "https://api.live.bilibili.com/room/v2/Room/room_id_by_uid",
    ROOM_INFO: "https://api.live.bilibili.com/room/v1/Room/get_info",
    GET_PARTITIONS: "https://api.live.bilibili.com/room/v1/Area/getList",
    UPDATE_ROOM: "https://api.live.bilibili.com/room/v1/Room/update",
    START_LIVE: "https://api.live.bilibili.com/room/v1/Room/startLive",
    STOP_LIVE: "https://api.live.bilibili.com/room/v1/Room/stopLive",
    SEND_DANMAKU: "https://api.live.bilibili.com/msg/send",
};

const BILI_API_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Origin: "https://link.bilibili.com",
    Referer: "https://link.bilibili.com/p/center/index",
};

function cookieFor(credentials: BiliAuthCredentials): string {
    return [
        `SESSDATA=${credentials.SESSDATA}`,
        `bili_jct=${credentials.bili_jct}`,
        `DedeUserID=${credentials.DedeUserID}`,
        `buvid3=${credentials.buvid3}`,
    ].join("; ");
}

function parseCookies(setCookieHeader: string[] | undefined): Partial<BiliAuthCredentials> {
    const credentials: Partial<BiliAuthCredentials> = {};
    for (const cookieString of setCookieHeader || []) {
        const cookiePair = cookieString.split(";")[0];
        const separator = cookiePair.indexOf("=");
        if (separator <= 0) continue;
        const key = cookiePair.slice(0, separator).trim();
        const value = cookiePair.slice(separator + 1).trim();
        if (key === "SESSDATA" || key === "bili_jct" || key === "DedeUserID" || key === "buvid3") {
            credentials[key] = value;
        }
    }
    return credentials;
}

function appSign(params: Record<string, string>): Record<string, string> {
    const signed: Record<string, string> = { ...params, appkey: APP_KEY };
    const query = Object.keys(signed)
        .sort()
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(signed[key])}`)
        .join("&");
    signed.sign = crypto.createHash("md5").update(`${query}${APP_SECRET}`).digest("hex");
    return signed;
}

export function parseProxyConfig(proxyUrl = process.env.BILI_PROXY_URL): AxiosProxyConfig | undefined {
    if (!proxyUrl) return undefined;
    const parsed = new URL(proxyUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("BILI_PROXY_URL must use http:// or https://");
    }
    const defaultPort = parsed.protocol === "https:" ? 443 : 80;
    const config: AxiosProxyConfig = {
        protocol: parsed.protocol.slice(0, -1),
        host: parsed.hostname,
        port: Number(parsed.port || defaultPort),
    };
    if (parsed.username) {
        config.auth = {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
        };
    }
    return config;
}

function operationError(
    code: number | string,
    message: string,
    options: BiliApiErrorOptions = {},
): BiliApiError {
    const numericCode = typeof code === "number" ? code : Number(code);
    return new BiliApiError(code, message || "Bilibili request failed", {
        ...options,
        ...(AUTH_ERROR_CODES.has(numericCode) && !options.officialAuthUrl
            ? { officialAuthUrl: FACE_AUTH_URL }
            : {}),
        ...(AUTH_ERROR_CODES.has(numericCode) && !options.stage
            ? { stage: "face_auth" }
            : {}),
    });
}

export class BiliClient implements LiveClient {
    private readonly proxy?: AxiosProxyConfig;

    constructor(
        private readonly http: AxiosInstance = axios,
        proxy: AxiosProxyConfig | undefined = parseProxyConfig(),
    ) {
        this.proxy = proxy;
    }

    private requestOptions(config: AxiosRequestConfig = {}): AxiosRequestConfig {
        return {
            ...config,
            timeout: config.timeout ?? REQUEST_TIMEOUT_MS,
            ...(this.proxy ? { proxy: this.proxy } : {}),
        };
    }

    private get<T = any>(url: string, config: AxiosRequestConfig = {}) {
        return this.http.get<T>(url, this.requestOptions(config));
    }

    private post<T = any>(url: string, data?: unknown, config: AxiosRequestConfig = {}) {
        return this.http.post<T>(url, data, this.requestOptions(config));
    }

    async beginLogin(): Promise<LoginChallenge> {
        const buvidResponse = await this.get(URLS.GET_BUVID, { headers: BILI_API_HEADERS });
        const buvid3 = buvidResponse.data?.data?.buvid;
        if (!buvid3) throw new Error("Failed to pre-fetch buvid3");

        const response = await this.get(URLS.QR_GENERATE, {
            headers: { ...BILI_API_HEADERS, Cookie: `buvid3=${buvid3}` },
        });
        const { url, qrcode_key: qrKey } = response.data?.data || {};
        if (!url || !qrKey) throw new Error("Failed to generate login QR code");

        return {
            qrcode: await qrcode.toDataURL(url),
            state: { qrKey, buvid3 },
        };
    }

    async pollLogin(challenge: LoginChallenge): Promise<LoginPollResult> {
        const state = challenge.state as { qrKey?: string; buvid3?: string };
        if (!state?.qrKey || !state?.buvid3) throw new Error("Invalid login challenge");

        const response = await this.get(URLS.QR_POLL, {
            params: { qrcode_key: state.qrKey },
            headers: { ...BILI_API_HEADERS, Cookie: `buvid3=${state.buvid3}` },
            timeout: 5000,
        });
        const pollData = response.data?.data || {};
        if (pollData.code !== 0) {
            return {
                code: Number(pollData.code),
                message: pollData.message || "Unknown polling status",
            };
        }

        const parsed = parseCookies(response.headers["set-cookie"]);
        const credentials: BiliAuthCredentials = {
            SESSDATA: parsed.SESSDATA || "",
            bili_jct: parsed.bili_jct || "",
            DedeUserID: parsed.DedeUserID || "",
            buvid3: parsed.buvid3 || state.buvid3,
        };
        if (!credentials.SESSDATA || !credentials.bili_jct || !credentials.DedeUserID) {
            throw new Error("Login succeeded but required credentials are missing");
        }
        return { code: 0, message: "Login successful", credentials };
    }

    async getPartitions(
        credentials: BiliAuthCredentials,
        options: PartitionOptions = {},
    ): Promise<PartitionGroup[]> {
        const response = await this.get(URLS.GET_PARTITIONS, {
            headers: { ...BILI_API_HEADERS, Cookie: cookieFor(credentials) },
            params: { show_pinyin: 1 },
        });
        if (response.data?.code !== 0) {
            throw operationError(response.data?.code, response.data?.message);
        }
        return enrichPartitions(response.data?.data || [], options);
    }

    async getRoomInfo(credentials: BiliAuthCredentials, roomId?: string): Promise<RoomInfo> {
        let resolvedRoomId = roomId;
        if (!resolvedRoomId) {
            const idResponse = await this.get(URLS.ROOM_ID_BY_UID, {
                headers: { ...BILI_API_HEADERS, Cookie: cookieFor(credentials) },
                params: { uid: credentials.DedeUserID },
            });
            if (idResponse.data?.code !== 0 || !idResponse.data?.data?.room_id) {
                throw operationError(
                    idResponse.data?.code,
                    idResponse.data?.message || "Unable to resolve room ID",
                );
            }
            resolvedRoomId = String(idResponse.data.data.room_id);
        }

        const response = await this.get(URLS.ROOM_INFO, {
            headers: { ...BILI_API_HEADERS, Cookie: cookieFor(credentials) },
            params: { room_id: resolvedRoomId },
        });
        const data = response.data?.data;
        if (response.data?.code !== 0 || !data) {
            throw operationError(response.data?.code, response.data?.message);
        }

        const tags = typeof data.tags === "string"
            ? data.tags.split(",").map((tag: string) => tag.trim()).filter(Boolean)
            : [];

        return {
            roomId: String(data.room_id || resolvedRoomId),
            uid: String(data.uid || credentials.DedeUserID),
            title: String(data.title || ""),
            areaId: Number(data.area_id || 0),
            parentAreaId: Number(data.parent_area_id || 0),
            areaName: String(data.area_name || ""),
            parentAreaName: String(data.parent_area_name || ""),
            tags,
            liveStatus: Number(data.live_status || 0),
        };
    }

    async updateRoom(
        credentials: BiliAuthCredentials,
        roomId: string,
        update: RoomUpdate,
    ): Promise<void> {
        const body = new URLSearchParams({
            room_id: roomId,
            platform: "pc_link",
            csrf: credentials.bili_jct,
            csrf_token: credentials.bili_jct,
        });
        if (update.title !== undefined) body.set("title", update.title);
        if (update.areaId !== undefined) body.set("area_id", String(update.areaId));
        if (update.addTag !== undefined) body.set("add_tag", update.addTag);
        if (update.delTag !== undefined) body.set("del_tag", update.delTag);

        const response = await this.post(URLS.UPDATE_ROOM, body.toString(), {
            headers: { ...BILI_API_HEADERS, Cookie: cookieFor(credentials) },
        });
        if (response.data?.code !== 0) {
            throw operationError(response.data?.code, response.data?.message);
        }
    }

    async startStream(
        credentials: BiliAuthCredentials,
        roomId: string,
        areaId: number,
    ): Promise<StartStreamData> {
        let timestamp = Math.floor(Date.now() / 1000);
        try {
            const timeResponse = await this.get(URLS.SERVER_TIME, {
                headers: BILI_API_HEADERS,
                timeout: 5000,
            });
            timestamp = Number(timeResponse.data?.data?.now || timestamp);
        } catch {
            // Local time is an acceptable fallback when the clock endpoint is unavailable.
        }

        const params = appSign({
            room_id: roomId,
            platform: "pc_link",
            area_v2: String(areaId),
            backup_stream: "0",
            type: "2",
            csrf: credentials.bili_jct,
            csrf_token: credentials.bili_jct,
            build: "10269",
            version: "7.47.0.10269",
            ts: String(timestamp),
        });
        const response = await this.post(
            `${URLS.START_LIVE}?${new URLSearchParams(params).toString()}`,
            undefined,
            { headers: { ...BILI_API_HEADERS, Cookie: cookieFor(credentials) } },
        );
        const code = Number(response.data?.code);
        if (code !== 0) {
            const message = String(
                response.data?.message || response.data?.msg || "Failed to start live stream",
            );
            if (code === 60024 || code === 60043) {
                const rawQr = response.data?.data?.qr;
                let faceAuthQr: string | undefined;
                if (typeof rawQr === "string" && rawQr.trim()) {
                    try {
                        faceAuthQr = await qrcode.toDataURL(rawQr);
                    } catch {
                        faceAuthQr = undefined;
                    }
                }
                const officialAuthUrl = code === 60043
                    ? `https://www.bilibili.com/blackboard/live/face-auth-middle.html?source_event=400&mid=${encodeURIComponent(credentials.DedeUserID)}`
                    : FACE_AUTH_URL;
                throw operationError(code, message, {
                    stage: "face_auth",
                    officialAuthUrl,
                    faceAuthQr,
                });
            }
            throw operationError(code, message);
        }
        const rtmp = response.data?.data?.rtmp;
        if (!rtmp?.addr || !rtmp?.code) {
            throw new Error("Bilibili returned success without RTMP credentials");
        }
        return { serverUrl: String(rtmp.addr), streamKey: String(rtmp.code) };
    }

    async stopStream(credentials: BiliAuthCredentials, roomId: string): Promise<void> {
        const body = new URLSearchParams({
            room_id: roomId,
            platform: "pc_link",
            csrf: credentials.bili_jct,
            csrf_token: credentials.bili_jct,
        });
        const response = await this.post(URLS.STOP_LIVE, body.toString(), {
            headers: { ...BILI_API_HEADERS, Cookie: cookieFor(credentials) },
        });
        if (response.data?.code !== 0) {
            throw operationError(response.data?.code, response.data?.message);
        }
    }

    async sendDanmaku(
        credentials: BiliAuthCredentials,
        roomId: string,
        message: string,
    ): Promise<void> {
        const body = new URLSearchParams({
            roomid: roomId,
            msg: message,
            rnd: String(Math.floor(Date.now() / 1000)),
            fontsize: "25",
            color: "16777215",
            mode: "1",
            bubble: "0",
            room_type: "0",
            jumpfrom: "0",
            reply_mid: "0",
            reply_attr: "0",
            reply_uname: "",
            replay_dmid: "",
            dm_type: "0",
            statistics: JSON.stringify({ appId: 100, platform: 5 }),
            csrf: credentials.bili_jct,
            csrf_token: credentials.bili_jct,
        });
        const response = await this.post(URLS.SEND_DANMAKU, body.toString(), {
            headers: {
                ...BILI_API_HEADERS,
                Cookie: cookieFor(credentials),
                Referer: `https://live.bilibili.com/${roomId}`,
            },
        });
        const code = Number(response.data?.code);
        const rawMessage = String(response.data?.msg || "").trim();
        const responseMessage = String(response.data?.message || "").trim();
        const normalizedMessage = rawMessage.toLowerCase();
        const successfulMessages = new Set(["", "ok", "0", "success", "发送成功"]);
        if (code !== 0) {
            throw operationError(
                Number.isFinite(code) ? code : -1,
                rawMessage || responseMessage || "Failed to send danmaku",
            );
        }
        if (!successfulMessages.has(normalizedMessage)) {
            throw operationError(0, rawMessage || responseMessage || "Danmaku was rejected");
        }
    }
}

const MOCK_PARTITIONS = [
    {
        id: 1,
        name: "娱乐",
        list: [
            { id: 145, name: "颜值", pinyin: "yanzhi" },
            { id: 146, name: "户外", pinyin: "huwai" },
        ],
    },
    {
        id: 2,
        name: "音乐",
        list: [
            { id: 236, name: "音乐", pinyin: "yinyue" },
            { id: 237, name: "唱见", pinyin: "changjian" },
        ],
    },
    {
        id: 3,
        name: "知识",
        list: [
            { id: 1017, name: "科学科普", pinyin: "kexuekepu" },
            { id: 1018, name: "社科人文", pinyin: "shekewenren" },
            { id: 1019, name: "自习室", pinyin: "zixishi" },
        ],
    },
];

export class MockBiliClient implements LiveClient {
    readonly sentDanmaku: string[] = [];

    private readonly room: RoomInfo = {
        roomId: "10001",
        uid: "10001",
        title: "WebUI 测试直播",
        areaId: 145,
        parentAreaId: 1,
        areaName: "颜值",
        parentAreaName: "娱乐",
        tags: ["测试", "WebUI"],
        liveStatus: 0,
    };

    async beginLogin(): Promise<LoginChallenge> {
        return {
            qrcode: await qrcode.toDataURL("https://mock.invalid/bili-login"),
            state: { mock: true },
        };
    }

    async pollLogin(_challenge: LoginChallenge): Promise<LoginPollResult> {
        return {
            code: 0,
            message: "Mock login successful",
            credentials: {
                SESSDATA: "mock-sessdata",
                bili_jct: "mock-bili-jct",
                DedeUserID: "10001",
                buvid3: "mock-buvid3",
            },
        };
    }

    async getPartitions(
        _credentials: BiliAuthCredentials,
        options: PartitionOptions = {},
    ): Promise<PartitionGroup[]> {
        return enrichPartitions(structuredClone(MOCK_PARTITIONS), options);
    }

    async getRoomInfo(_credentials: BiliAuthCredentials, roomId?: string): Promise<RoomInfo> {
        if (roomId && roomId !== this.room.roomId) {
            throw new BiliApiError(-404, "Mock room not found");
        }
        return structuredClone(this.room);
    }

    async updateRoom(
        _credentials: BiliAuthCredentials,
        _roomId: string,
        update: RoomUpdate,
    ): Promise<void> {
        if (update.title !== undefined) this.room.title = update.title;
        if (update.areaId !== undefined) {
            const area = MOCK_PARTITIONS.flatMap((group) =>
                group.list.map((item) => ({ ...item, parentId: group.id, parentName: group.name })),
            ).find((item) => item.id === update.areaId);
            if (!area) throw new BiliApiError(-400, "Mock area not found");
            this.room.areaId = area.id;
            this.room.areaName = area.name;
            this.room.parentAreaId = area.parentId;
            this.room.parentAreaName = area.parentName;
        }
        if (update.addTag) {
            for (const tag of update.addTag.split(",")) {
                if (tag && !this.room.tags.includes(tag)) this.room.tags.push(tag);
            }
        }
        if (update.delTag) {
            const remove = new Set(update.delTag.split(",").filter(Boolean));
            this.room.tags = this.room.tags.filter((tag) => !remove.has(tag));
        }
    }

    async startStream(
        _credentials: BiliAuthCredentials,
        _roomId: string,
        _areaId: number,
    ): Promise<StartStreamData> {
        this.room.liveStatus = 1;
        return { serverUrl: "rtmp://mock.local/live", streamKey: "mock-stream-key" };
    }

    async stopStream(_credentials: BiliAuthCredentials, _roomId: string): Promise<void> {
        this.room.liveStatus = 0;
    }

    async sendDanmaku(
        _credentials: BiliAuthCredentials,
        _roomId: string,
        message: string,
    ): Promise<void> {
        this.sentDanmaku.push(message);
    }
}
