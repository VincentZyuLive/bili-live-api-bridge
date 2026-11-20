import { describe, expect, it } from "vitest";
import { localWebUiUrl } from "../src/browser";

describe("browser helpers", () => {
    it("uses the local loopback URL for wildcard bindings", () => {
        expect(localWebUiUrl("127.0.0.1", 61611)).toBe("http://127.0.0.1:61611");
        expect(localWebUiUrl("0.0.0.0", 61611)).toBe("http://127.0.0.1:61611");
        expect(localWebUiUrl("::", 61611)).toBe("http://[::1]:61611");
    });

    it("brackets explicit IPv6 hosts", () => {
        expect(localWebUiUrl("::1", 62000)).toBe("http://[::1]:62000");
    });
});
