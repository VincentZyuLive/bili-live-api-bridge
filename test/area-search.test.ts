import Fuse from "fuse.js";
import { describe, expect, it } from "vitest";
import { enrichPartitions } from "../src/partitions";
import {
    buildPartitionSearchDocuments,
    createFuseIndex,
    loadAreaSearchSettings,
    matchDocumentIds,
    saveAreaSearchSettings,
} from "../web/area-search.js";

const groups = enrichPartitions(
    [
        {
            id: 3,
            name: "知识",
            list: [
                { id: 1019, name: "自习室", pinyin: "zixishi" },
                { id: 1017, name: "科学科普", pinyin: "kexuekepu" },
            ],
        },
        {
            id: 9,
            name: "虚拟主播",
            list: [{ id: 371, name: "虚拟日常", pinyin: "xunirichang" }],
        },
    ],
    { pinyinPro: true },
);

describe("partition area search", () => {
    it("matches full pinyin, initials and fuzzy subsequences", () => {
        const { areaDocuments } = buildPartitionSearchDocuments(groups, true);
        const fuseIndex = createFuseIndex(areaDocuments, Fuse);

        expect([...matchDocumentIds(areaDocuments, "zixishi")]).toContain(1019);
        expect([...matchDocumentIds(areaDocuments, "zxs", { fuse: true, fuseIndex })]).toContain(1019);
        expect([...matchDocumentIds(areaDocuments, "zishi", { fuse: true, fuseIndex })]).toContain(1019);
    });

    it("matches a parent group and exposes all child IDs", () => {
        const { groupDocuments } = buildPartitionSearchDocuments(groups, true);
        expect([...matchDocumentIds(groupDocuments, "知识")]).toEqual([3]);
        expect([...matchDocumentIds(groupDocuments, "zs", { fuse: true, fuseIndex: createFuseIndex(groupDocuments, Fuse) })]).toEqual([3]);
    });

    it("does not use pinyin-pro-only initials when enhancement is disabled", () => {
        const { areaDocuments, groupDocuments } = buildPartitionSearchDocuments(groups, false);
        expect([...matchDocumentIds(areaDocuments, "zixishi")]).toContain(1019);
        expect([...matchDocumentIds(areaDocuments, "zxs")]).not.toContain(1019);
        expect([...matchDocumentIds(groupDocuments, "zs")]).toEqual([]);
    });

    it("persists boolean search settings", () => {
        const storage = new Map<string, string>();
        const adapter = {
            getItem(key: string) {
                return storage.get(key) ?? null;
            },
            setItem(key: string, value: string) {
                storage.set(key, value);
            },
        } as Storage;

        expect(loadAreaSearchSettings(adapter)).toEqual({ pinyinPro: true, fuse: true });
        saveAreaSearchSettings({ pinyinPro: false, fuse: false }, adapter);
        expect(loadAreaSearchSettings(adapter)).toEqual({ pinyinPro: false, fuse: false });
    });
});
