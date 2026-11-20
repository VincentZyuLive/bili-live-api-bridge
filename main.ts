import path from "path";
import { BiliClient, MockBiliClient } from "./src/client";
import { createApp } from "./src/app";
import { localWebUiUrl, openWebUi } from "./src/browser";
import { parseRuntimeConfig } from "./src/config";
import { SessionStore } from "./src/session";

function main(): void {
    let config;
    try {
        config = parseRuntimeConfig();
    } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
        console.error("💡 Usage: npm start -- [--mock|--live] [--host 127.0.0.1] [--port 61611] [--no-open]");
        process.exitCode = 1;
        return;
    }

    let client;
    try {
        client = config.mode === "mock" ? new MockBiliClient() : new BiliClient();
    } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        return;
    }

    const sessions = config.mode === "live"
        ? new SessionStore({ persistPath: path.resolve(__dirname, "cache", "cookie", "sessions.json") })
        : new SessionStore();
    const app = createApp({ client, mode: config.mode, sessions });
    const server = app.listen(config.port, config.host, () => {
        const webUiUrl = localWebUiUrl(config.host, config.port);
        console.log("🎥 Bilibili Live API Bridge");
        console.log(`🟢 Mode: ${config.mode === "mock" ? "🧪 Mock" : "🔴 Live"}`);
        console.log(`🌐 WebUI: ${webUiUrl}`);
        console.log(
            config.mode === "mock"
                ? "🧪 Mock mode is active. No Bilibili requests will be made."
                : "🔐 Live mode is active. Scan the QR code in the WebUI to log in.",
        );
        console.log("🛑 Press Ctrl+C to stop the bridge.");
        if (config.openBrowser) {
            console.log("🚀 Opening the WebUI in your default browser...");
            openWebUi(webUiUrl);
        } else {
            console.log("🙈 Browser auto-open is disabled.");
        }
    });

    const shutdown = () => {
        server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main();
