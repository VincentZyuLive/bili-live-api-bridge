const elements = {
    modeBadge: document.querySelector("#modeBadge"),
    logoutButton: document.querySelector("#logoutButton"),
    loginPanel: document.querySelector("#loginPanel"),
    consolePanel: document.querySelector("#consolePanel"),
    loginButton: document.querySelector("#loginButton"),
    loginStatus: document.querySelector("#loginStatus"),
    qrFrame: document.querySelector("#qrFrame"),
    qrImage: document.querySelector("#qrImage"),
    roomId: document.querySelector("#roomId"),
    liveStatus: document.querySelector("#liveStatus"),
    currentTitle: document.querySelector("#currentTitle"),
    refreshButton: document.querySelector("#refreshButton"),
    titleInput: document.querySelector("#titleInput"),
    areaSelect: document.querySelector("#areaSelect"),
    tagsInput: document.querySelector("#tagsInput"),
    saveTitleButton: document.querySelector("#saveTitleButton"),
    saveAreaButton: document.querySelector("#saveAreaButton"),
    saveTagsButton: document.querySelector("#saveTagsButton"),
    startButton: document.querySelector("#startButton"),
    stopButton: document.querySelector("#stopButton"),
    streamPanel: document.querySelector("#streamPanel"),
    serverUrl: document.querySelector("#serverUrl"),
    streamKey: document.querySelector("#streamKey"),
    toggleKeyButton: document.querySelector("#toggleKeyButton"),
    actionStatus: document.querySelector("#actionStatus"),
    toast: document.querySelector("#toast"),
};

const state = {
    mode: "live",
    authenticated: false,
    room: null,
    partitionsLoaded: false,
    pollTimer: null,
    toastTimer: null,
};

function setStatus(element, message, kind = "") {
    element.textContent = message;
    element.className = `status-line${kind ? ` ${kind}` : ""}`;
}

function showToast(message, kind = "") {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast${kind ? ` ${kind}` : ""}`;
    state.toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 3600);
}

async function request(url, options = {}) {
    const config = {
        credentials: "same-origin",
        ...options,
        headers: { ...(options.headers || {}) },
    };
    if (options.body && typeof options.body !== "string") {
        config.headers["Content-Type"] = "application/json";
        config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }
    if (!response.ok) {
        const error = new Error(data.message || `HTTP ${response.status}`);
        error.code = data.code || response.status;
        error.officialAuthUrl = data.officialAuthUrl;
        if (response.status === 401) showLogin();
        throw error;
    }
    return data;
}

function setMode(mode) {
    state.mode = mode;
    elements.modeBadge.textContent = mode === "mock" ? "MOCK" : "LIVE";
    elements.modeBadge.className = `badge ${mode === "mock" ? "badge-muted" : "badge-live"}`;
}

function showLogin() {
    state.authenticated = false;
    elements.loginPanel.classList.remove("hidden");
    elements.consolePanel.classList.add("hidden");
    elements.logoutButton.classList.add("hidden");
    stopLoginPolling();
}

function showConsole() {
    state.authenticated = true;
    elements.loginPanel.classList.add("hidden");
    elements.consolePanel.classList.remove("hidden");
    elements.logoutButton.classList.remove("hidden");
}

function stopLoginPolling() {
    if (state.pollTimer) {
        clearTimeout(state.pollTimer);
        state.pollTimer = null;
    }
}

async function login() {
    elements.loginButton.disabled = true;
    setStatus(elements.loginStatus, "正在获取二维码...");
    try {
        const challenge = await request("/api/login/qrcode");
        setMode(challenge.mode || state.mode);
        elements.qrImage.src = challenge.qrcode;
        elements.qrFrame.classList.remove("hidden");
        setStatus(elements.loginStatus, "请使用哔哩哔哩手机客户端扫码");
        pollLogin(challenge.token);
    } catch (error) {
        setStatus(elements.loginStatus, error.message, "error");
    } finally {
        elements.loginButton.disabled = false;
    }
}

async function pollLogin(token) {
    stopLoginPolling();
    try {
        const result = await request(`/api/login/poll?token=${encodeURIComponent(token)}`);
        if (result.authenticated) {
            setStatus(elements.loginStatus, "登录成功", "success");
            showConsole();
            await enterConsole();
            return;
        }
    } catch (error) {
        if (error.code === 202) {
            setStatus(elements.loginStatus, "已扫码，等待手机端确认...");
        } else if (error.code === 86090) {
            setStatus(elements.loginStatus, "已扫码，等待手机端确认...");
        } else {
            setStatus(elements.loginStatus, error.message, "error");
            if (error.code === 404 || error.code === 410 || error.code === 86038) return;
        }
    }
    state.pollTimer = setTimeout(() => pollLogin(token), 1200);
}

function liveStatusText(status) {
    if (status === 1) return "直播中";
    if (status === 2) return "轮播中";
    return "未开播";
}

function renderRoom(room) {
    state.room = room;
    elements.roomId.textContent = room.roomId;
    elements.currentTitle.textContent = room.title || "--";
    elements.titleInput.value = room.title || "";
    elements.tagsInput.value = (room.tags || []).join(",");
    elements.liveStatus.textContent = liveStatusText(room.liveStatus);
    elements.liveStatus.className = `badge ${room.liveStatus === 1 ? "badge-live" : "badge-muted"}`;
    elements.startButton.disabled = room.liveStatus === 1;
    elements.stopButton.disabled = room.liveStatus !== 1;
    if (roomsPartitionsAvailable()) {
        elements.areaSelect.value = String(room.areaId);
    }
}

function roomsPartitionsAvailable() {
    return elements.areaSelect.options.length > 0;
}

async function loadPartitions() {
    if (state.partitionsLoaded) return;
    const result = await request("/api/partitions", { method: "POST", body: {} });
    elements.areaSelect.replaceChildren();
    for (const group of result.data || []) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = group.name;
        for (const area of group.list || []) {
            const option = document.createElement("option");
            option.value = String(area.id);
            option.textContent = area.name;
            optgroup.append(option);
        }
        elements.areaSelect.append(optgroup);
    }
    state.partitionsLoaded = true;
    if (state.room) elements.areaSelect.value = String(state.room.areaId);
}

async function loadRoom() {
    const result = await request("/api/room/info", { method: "POST", body: {} });
    renderRoom(result.data);
}

async function enterConsole() {
    try {
        await loadPartitions();
        await loadRoom();
        setStatus(elements.actionStatus, "房间信息已加载", "success");
    } catch (error) {
        setStatus(elements.actionStatus, error.message, "error");
        if (error.officialAuthUrl) showToast("需要完成 B 站官方人脸认证", "error");
    }
}

async function saveField(field) {
    const body = { roomId: state.room?.roomId };
    if (field === "title") body.title = elements.titleInput.value;
    if (field === "area") body.partitionId = Number(elements.areaSelect.value);
    if (field === "tags") {
        body.tags = elements.tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean);
    }

    setStatus(elements.actionStatus, "正在保存...");
    try {
        const result = await request("/api/room/update", { method: "POST", body });
        renderRoom(result.data);
        setStatus(elements.actionStatus, "保存成功", "success");
        showToast("直播间信息已更新", "success");
    } catch (error) {
        setStatus(elements.actionStatus, error.message, "error");
        showToast(error.message, "error");
    }
}

async function startStream() {
    const body = {
        roomId: state.room?.roomId,
        partitionId: Number(elements.areaSelect.value),
        title: elements.titleInput.value,
        tags: elements.tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    };
    elements.startButton.disabled = true;
    setStatus(elements.actionStatus, "正在同步开播信息并申请推流...");
    try {
        const result = await request("/api/start-stream", { method: "POST", body });
        elements.serverUrl.value = result.serverUrl || "";
        elements.streamKey.value = result.streamKey || "";
        elements.streamPanel.classList.remove("hidden");
        setStatus(elements.actionStatus, "开播请求成功，请将推流信息填入 OBS", "success");
        showToast("开播成功", "success");
        await loadRoom();
    } catch (error) {
        setStatus(elements.actionStatus, error.message, "error");
        showToast(error.message, "error");
        if (error.officialAuthUrl) {
            const link = document.createElement("a");
            link.href = error.officialAuthUrl;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = "打开 B 站官方认证页面";
            elements.actionStatus.append(" ", link);
        }
    } finally {
        elements.startButton.disabled = state.room?.liveStatus === 1;
    }
}

async function stopStream() {
    elements.stopButton.disabled = true;
    setStatus(elements.actionStatus, "正在停止直播...");
    try {
        await request("/api/stop-stream", {
            method: "POST",
            body: { roomId: state.room?.roomId },
        });
        setStatus(elements.actionStatus, "已下播", "success");
        showToast("直播已停止", "success");
        await loadRoom();
    } catch (error) {
        setStatus(elements.actionStatus, error.message, "error");
        showToast(error.message, "error");
    } finally {
        elements.stopButton.disabled = state.room?.liveStatus !== 1;
    }
}

async function copyValue(id) {
    const input = document.querySelector(`#${id}`);
    if (!input?.value) return;
    await navigator.clipboard.writeText(input.value);
    showToast("已复制", "success");
}

async function init() {
    try {
        const health = await request("/api/health");
        setMode(health.mode);
        const session = await request("/api/auth/session");
        if (session.authenticated) {
            showConsole();
            await enterConsole();
        } else {
            showLogin();
        }
    } catch (error) {
        setStatus(elements.loginStatus, `服务连接失败：${error.message}`, "error");
    }
}

elements.loginButton.addEventListener("click", login);
elements.refreshButton.addEventListener("click", () => enterConsole());
elements.saveTitleButton.addEventListener("click", () => saveField("title"));
elements.saveAreaButton.addEventListener("click", () => saveField("area"));
elements.saveTagsButton.addEventListener("click", () => saveField("tags"));
elements.startButton.addEventListener("click", startStream);
elements.stopButton.addEventListener("click", stopStream);
elements.toggleKeyButton.addEventListener("click", () => {
    const visible = elements.streamKey.type === "text";
    elements.streamKey.type = visible ? "password" : "text";
    elements.toggleKeyButton.textContent = visible ? "显示" : "隐藏";
});
elements.logoutButton.addEventListener("click", async () => {
    await request("/api/auth/logout", { method: "POST", body: {} });
    showLogin();
    setStatus(elements.loginStatus, "已退出登录");
});
for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", () => copyValue(button.dataset.copy));
}

init();
