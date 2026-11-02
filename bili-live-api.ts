import { BiliClient, MockBiliClient } from "./src/bili-client";
import { createApp } from "./src/app";
import { parseRuntimeConfig } from "./src/config";

function main(): void {
    let config;
    try {
        config = parseRuntimeConfig();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        console.error("Usage: npm start -- [--mock|--live] [--host 127.0.0.1] [--port 61611]");
        process.exitCode = 1;
        return;
    }

    const client = config.mode === "mock" ? new MockBiliClient() : new BiliClient();
    const app = createApp({ client, mode: config.mode });
    const server = app.listen(config.port, config.host, () => {
        console.log(`Bilibili Live API Bridge (${config.mode})`);
        console.log(`WebUI: http://${config.host}:${config.port}`);
        console.log(
            config.mode === "mock"
                ? "Mock mode is active. No Bilibili requests will be made."
                : "Live mode is active. Log in with a Bilibili QR code from the WebUI.",
        );
    });

    const shutdown = () => {
        server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main();
