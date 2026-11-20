export const AREA_SEARCH_SETTINGS_KEY = "bili-bridge-area-search-settings";
export const DEFAULT_AREA_SEARCH_SETTINGS = Object.freeze({
    pinyinPro: true,
    fuse: true,
});

export function normalizeAreaSearchText(value) {
    return String(value || "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\-_/·:：,，.。()（）[\]【】]+/g, "");
}

export function loadAreaSearchSettings(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(AREA_SEARCH_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_AREA_SEARCH_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            pinyinPro: parsed?.pinyinPro !== false,
            fuse: parsed?.fuse !== false,
        };
    } catch {
        return { ...DEFAULT_AREA_SEARCH_SETTINGS };
    }
}

export function saveAreaSearchSettings(settings, storage = globalThis.localStorage) {
    const normalized = {
        pinyinPro: settings?.pinyinPro !== false,
        fuse: settings?.fuse !== false,
    };
    try {
        storage?.setItem(AREA_SEARCH_SETTINGS_KEY, JSON.stringify(normalized));
    } catch {
        // Browsing settings remain usable even when storage is unavailable.
    }
    return normalized;
}

function uniqueKeys(values) {
    return [...new Set(values.map(normalizeAreaSearchText).filter(Boolean))];
}

export function buildPartitionSearchDocuments(groups, pinyinPro) {
    const groupDocuments = [];
    const areaDocuments = [];

    for (const group of groups || []) {
        const groupKeys = uniqueKeys([
            group.name,
            ...(pinyinPro
                ? [group.search?.enhancedPinyin, group.search?.enhancedInitials, group.search?.initials]
                : []),
        ]);
        groupDocuments.push({ id: group.id, group, keys: groupKeys });

        for (const area of group.list || []) {
            areaDocuments.push({
                id: area.id,
                groupId: group.id,
                group,
                area,
                keys: uniqueKeys([
                    area.name,
                    area.search?.pinyin,
                    ...(pinyinPro
                        ? [
                              area.search?.enhancedPinyin,
                              area.search?.enhancedInitials,
                              area.search?.initials,
                          ]
                        : []),
                    group.name,
                ]),
            });
        }
    }

    return { groupDocuments, areaDocuments };
}

export function createFuseIndex(documents, FuseCtor) {
    return new FuseCtor(documents, {
        keys: ["keys"],
        threshold: 0.34,
        ignoreLocation: true,
        minMatchCharLength: 1,
        includeScore: true,
    });
}

export function matchDocumentIds(documents, query, options = {}) {
    const normalizedQuery = normalizeAreaSearchText(query);
    if (!normalizedQuery) return new Set(documents.map((document) => document.id));

    if (options.fuse && options.fuseIndex) {
        return new Set(
            options.fuseIndex
                .search(normalizedQuery)
                .map((result) => result.item.id),
        );
    }

    return new Set(
        documents
            .filter((document) => document.keys.some((key) => key.includes(normalizedQuery)))
            .map((document) => document.id),
    );
}
