export const DANMAKU_SETTINGS_KEY = "bili-bridge-danmaku-settings";
export const DEFAULT_DANMAKU_SETTINGS = Object.freeze({
    autoRetryPrefix: true,
    limit: 25,
    roomId: "",
});

export function normalizeRoomId(value) {
    const roomId = String(value ?? "").trim();
    return /^\d+$/.test(roomId) ? roomId : "";
}

export function unicodeLength(value) {
    return Array.from(value).length;
}

export function truncateToLimit(value, limit) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_DANMAKU_SETTINGS.limit;
    return Array.from(value).slice(0, safeLimit).join("");
}

export function normalizeDanmakuSettings(value) {
    const rawLimit = Number(value?.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 1000
        ? rawLimit
        : DEFAULT_DANMAKU_SETTINGS.limit;
    return {
        autoRetryPrefix: typeof value?.autoRetryPrefix === "boolean"
            ? value.autoRetryPrefix
            : DEFAULT_DANMAKU_SETTINGS.autoRetryPrefix,
        limit,
        roomId: normalizeRoomId(value?.roomId),
    };
}

export function loadDanmakuSettings(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(DANMAKU_SETTINGS_KEY);
        return normalizeDanmakuSettings(raw ? JSON.parse(raw) : null);
    } catch {
        return { ...DEFAULT_DANMAKU_SETTINGS };
    }
}

export function saveDanmakuSettings(settings, storage = globalThis.localStorage) {
    const normalized = normalizeDanmakuSettings(settings);
    try {
        storage?.setItem(DANMAKU_SETTINGS_KEY, JSON.stringify(normalized));
    } catch {
        // Settings persistence is best-effort; sending still works without storage.
    }
    return normalized;
}

export function shouldRetryPrefix(errorCode, originalText, limit, autoRetryPrefix) {
    return Boolean(
        autoRetryPrefix
        && Number(errorCode) === 1003212
        && unicodeLength(originalText) > limit
        && limit > 0,
    );
}
