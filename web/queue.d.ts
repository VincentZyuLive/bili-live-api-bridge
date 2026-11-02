export interface DanmakuSettings {
    autoRetryPrefix: boolean;
    limit: number;
    roomId: string;
}

export const DANMAKU_SETTINGS_KEY: string;
export const DEFAULT_DANMAKU_SETTINGS: Readonly<DanmakuSettings>;

export function normalizeRoomId(value: unknown): string;
export function unicodeLength(value: string): number;
export function truncateToLimit(value: string, limit: number): string;
export function normalizeDanmakuSettings(value: Partial<DanmakuSettings> | null | undefined): DanmakuSettings;
export function loadDanmakuSettings(storage?: Storage): DanmakuSettings;
export function saveDanmakuSettings(settings: Partial<DanmakuSettings>, storage?: Storage): DanmakuSettings;
export function shouldRetryPrefix(
    errorCode: unknown,
    originalText: string,
    limit: number,
    autoRetryPrefix: boolean,
): boolean;
