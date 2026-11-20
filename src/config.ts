export type RuntimeMode = "mock" | "live";

export interface RuntimeConfig {
    mode: RuntimeMode;
    host: string;
    port: number;
    openBrowser: boolean;
}

function readOption(argv: string[], index: number, name: string): [string, number] {
    const current = argv[index];
    if (current.startsWith(`${name}=`)) {
        return [current.slice(name.length + 1), index];
    }
    const next = argv[index + 1];
    if (!next) {
        throw new Error(`${name} requires a value`);
    }
    return [next, index + 1];
}

export function parseRuntimeConfig(
    argv: string[] = process.argv.slice(2),
    env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
    let mode: RuntimeMode = env.BILI_BRIDGE_MODE === "mock" ? "mock" : "live";
    let host = env.HOST || "127.0.0.1";
    let port = Number(env.PORT || 61611);
    let openBrowser = env.BILI_BRIDGE_NO_OPEN !== "1";

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--mock") {
            mode = "mock";
        } else if (arg === "--live") {
            mode = "live";
        } else if (arg === "--no-open") {
            openBrowser = false;
        } else if (arg === "--port" || arg.startsWith("--port=")) {
            const [value, nextIndex] = readOption(argv, index, "--port");
            port = Number(value);
            index = nextIndex;
        } else if (arg === "--host" || arg.startsWith("--host=")) {
            const [value, nextIndex] = readOption(argv, index, "--host");
            host = value;
            index = nextIndex;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${String(port)}`);
    }
    if (!host.trim()) {
        throw new Error("Host must not be empty");
    }

    return { mode, host, port, openBrowser };
}
