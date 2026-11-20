import { describe, expect, it } from "vitest";
import { enrichPartitions } from "../src/partitions";

const fixture = [
    {
        id: "3",
        name: "知识",
        list: [
            {
                id: "1019",
                name: "自习室",
                pinyin: "zixishi",
                parent_id: "3",
                parent_name: "知识",
            },
        ],
    },
];

describe("partition search index", () => {
    it("builds full pinyin and initials with pinyin-pro enabled", () => {
        const [group] = enrichPartitions(fixture, { pinyinPro: true });
        expect(group.search.enhancedPinyin).toBe("zhishi");
        expect(group.search.enhancedInitials).toBe("zs");
        expect(group.list[0].search).toMatchObject({
            pinyin: "zixishi",
            enhancedPinyin: "zixishi",
            initials: "zxs",
            enhancedInitials: "zxs",
        });
    });

    it("keeps provider pinyin but removes enhanced fields when disabled", () => {
        const [group] = enrichPartitions(fixture, { pinyinPro: false });
        expect(group.search).toEqual({
            pinyin: "",
            initials: "",
            enhancedPinyin: "",
            enhancedInitials: "",
        });
        expect(group.list[0].search).toEqual({
            pinyin: "zixishi",
            initials: "",
            enhancedPinyin: "",
            enhancedInitials: "",
        });
    });

    it("ignores malformed groups and areas", () => {
        expect(enrichPartitions([null, { id: "bad", name: "坏分区", list: [] }])).toEqual([]);
        const [group] = enrichPartitions([
            { id: 1, name: "有效", list: [null, { id: "x", name: "" }, { id: 2, name: "有效分区" }] },
        ]);
        expect(group.list).toHaveLength(1);
        expect(group.list[0].id).toBe(2);
    });
});
