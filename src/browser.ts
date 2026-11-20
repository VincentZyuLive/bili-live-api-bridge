import { spawn } from "child_process";

export function localWebUiUrl(host: string, port: number): string {
    const normalizedHost = host.trim().toLowerCase();
    let browserHost = host.trim();
    if (normalizedHost === "0.0.0.0") browserHost = "127.0.0.1";
    if (normalizedHost === "::" || normalizedHost === "[::]") browserHost = "::1";
    if (browserHost.includes(":") && !browserHost.startsWith("[")) {
        browserHost = `[${browserHost}]`;
    }
    return `http://${browserHost}:${port}`;
}

export function openWebUi(url: string): void {
    try {
        let command: string;
        let args: string[];
        if (process.platform === "win32") {
            command = "cmd.exe";
            args = ["/d", "/s", "/c", "start", "", url];
        } else if (process.platform === "darwin") {
            command = "open";
            args = [url];
        } else {
            command = "xdg-open";
            args = [url];
        }

        const child = spawn(command, args, {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
        });
        child.once("error", (error) => {
            console.warn(`⚠️ 无法自动打开浏览器：${error.message}`);
            console.warn(`👉 请手动打开：${url}`);
        });
        child.unref();
    } catch (error) {
        console.warn(`⚠️ 无法自动打开浏览器：${error instanceof Error ? error.message : String(error)}`);
        console.warn(`👉 请手动打开：${url}`);
    }
}
