export interface AreaSearchSettings {
    pinyinPro: boolean;
    fuse: boolean;
}

export interface PartitionSearchDocument {
    id: number;
    groupId?: number;
    group: unknown;
    area?: unknown;
    keys: string[];
}

export const AREA_SEARCH_SETTINGS_KEY: string;
export const DEFAULT_AREA_SEARCH_SETTINGS: Readonly<AreaSearchSettings>;
export function normalizeAreaSearchText(value: unknown): string;
export function loadAreaSearchSettings(storage?: Storage): AreaSearchSettings;
export function saveAreaSearchSettings(settings: Partial<AreaSearchSettings>, storage?: Storage): AreaSearchSettings;
export function buildPartitionSearchDocuments(groups: unknown[], pinyinPro: boolean): {
    groupDocuments: PartitionSearchDocument[];
    areaDocuments: PartitionSearchDocument[];
};
export function createFuseIndex(documents: PartitionSearchDocument[], FuseCtor: new (...args: any[]) => any): any;
export function matchDocumentIds(
    documents: PartitionSearchDocument[],
    query: string,
    options?: { fuse?: boolean; fuseIndex?: any },
): Set<number>;
