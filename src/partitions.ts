import { pinyin } from "pinyin-pro";

export interface PartitionSearchIndex {
    pinyin: string;
    initials: string;
    enhancedPinyin: string;
    enhancedInitials: string;
}

export interface PartitionArea {
    id: number;
    name: string;
    parentId: number;
    parentName: string;
    search: PartitionSearchIndex;
}

export interface PartitionGroup {
    id: number;
    name: string;
    search: PartitionSearchIndex;
    list: PartitionArea[];
}

export interface PartitionOptions {
    pinyinPro?: boolean;
}

interface RawPartitionArea {
    id?: unknown;
    name?: unknown;
    pinyin?: unknown;
}

interface RawPartitionGroup {
    id?: unknown;
    name?: unknown;
    list?: unknown;
}

export function normalizePartitionSearchText(value: string): string {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\-_/·:：,，.。()（）[\]【】]+/g, "");
}

function pinyinTokens(value: string, firstOnly: boolean): string[] {
    return pinyin(value, {
        toneType: "none",
        type: "array",
        nonZh: "consecutive",
        ...(firstOnly ? { pattern: "first" } : {}),
    });
}

function enhancedSearchIndex(value: string, enabled: boolean): PartitionSearchIndex {
    if (!enabled) {
        return { pinyin: "", initials: "", enhancedPinyin: "", enhancedInitials: "" };
    }
    const fullPinyin = normalizePartitionSearchText(pinyinTokens(value, false).join(""));
    const initials = normalizePartitionSearchText(pinyinTokens(value, true).join(""));
    return {
        pinyin: "",
        initials,
        enhancedPinyin: fullPinyin,
        enhancedInitials: initials,
    };
}

export function enrichPartitions(rawGroups: unknown, options: PartitionOptions = {}): PartitionGroup[] {
    if (!Array.isArray(rawGroups)) return [];
    const enhance = options.pinyinPro !== false;

    return rawGroups.flatMap((rawGroupValue) => {
        if (!rawGroupValue || typeof rawGroupValue !== "object") return [];
        const rawGroup = rawGroupValue as RawPartitionGroup;
        const groupId = Number(rawGroup.id);
        const groupName = String(rawGroup.name || "").trim();
        if (!Number.isInteger(groupId) || groupId <= 0 || !groupName) return [];

        const groupSearch = enhancedSearchIndex(groupName, enhance);
        const rawList = Array.isArray(rawGroup.list) ? rawGroup.list : [];
        const list = rawList.flatMap((rawAreaValue) => {
            if (!rawAreaValue || typeof rawAreaValue !== "object") return [];
            const rawArea = rawAreaValue as RawPartitionArea;
            const areaId = Number(rawArea.id);
            const areaName = String(rawArea.name || "").trim();
            if (!Number.isInteger(areaId) || areaId <= 0 || !areaName) return [];

            const providerPinyin = normalizePartitionSearchText(
                typeof rawArea.pinyin === "string" ? rawArea.pinyin : "",
            );
            return [{
                id: areaId,
                name: areaName,
                parentId: groupId,
                parentName: groupName,
                search: {
                    ...enhancedSearchIndex(areaName, enhance),
                    pinyin: providerPinyin,
                },
            }];
        });

        return [{ id: groupId, name: groupName, search: groupSearch, list }];
    });
}
