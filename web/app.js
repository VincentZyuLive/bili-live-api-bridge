import Fuse from "/vendor/fuse/fuse.min.mjs";
import {
    buildPartitionSearchDocuments,
    createFuseIndex,
    loadAreaSearchSettings,
    matchDocumentIds,
    saveAreaSearchSettings,
} from "./search.js";
import {
    loadDanmakuSettings,
    normalizeDanmakuSettings,
    normalizeRoomId,
    saveDanmakuSettings,
    shouldRetryPrefix,
    truncateToLimit,
    unicodeLength,
} from "./queue.js";

const elements = {
    modeBadge: document.querySelector("#modeBadge"),
    versionBadge: document.querySelector("#versionBadge"),
    logoutButton: document.querySelector("#logoutButton"),
    loginPanel: document.querySelector("#loginPanel"),
    consolePanel: document.querySelector("#consolePanel"),
    loginButton: document.querySelector("#loginButton"),
    loginStatus: document.querySelector("#loginStatus"),
    qrFrame: document.querySelector("#qrFrame"),
    qrImage: document.querySelector("#qrImage"),
    roomIdInput: document.querySelector("#roomIdInput"),
    liveStatus: document.querySelector("#liveStatus"),
    currentTitle: document.querySelector("#currentTitle"),
    refreshButton: document.querySelector("#refreshButton"),
    titleInput: document.querySelector("#titleInput"),
    areaSearchInput: document.querySelector("#areaSearchInput"),
    areaSearchCount: document.querySelector("#areaSearchCount"),
    areaPinyinProToggle: document.querySelector("#areaPinyinProToggle"),
    areaFuseToggle: document.querySelector("#areaFuseToggle"),
    openAreaDialogButton: document.querySelector("#openAreaDialogButton"),
    areaDialog: document.querySelector("#areaDialog"),
    closeAreaDialogButton: document.querySelector("#closeAreaDialogButton"),
    cancelAreaDialogButton: document.querySelector("#cancelAreaDialogButton"),
    confirmAreaDialogButton: document.querySelector("#confirmAreaDialogButton"),
    areaDialogSelection: document.querySelector("#areaDialogSelection"),
    areaTagWall: document.querySelector("#areaTagWall"),
    areaEmpty: document.querySelector("#areaEmpty"),
    selectedAreaSummary: document.querySelector("#selectedAreaSummary"),
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
    faceAuthPanel: document.querySelector("#faceAuthPanel"),
    faceAuthCloseButton: document.querySelector("#faceAuthCloseButton"),
    faceAuthMessage: document.querySelector("#faceAuthMessage"),
    faceAuthQrFrame: document.querySelector("#faceAuthQrFrame"),
    faceAuthQrImage: document.querySelector("#faceAuthQrImage"),
    retryFaceAuthButton: document.querySelector("#retryFaceAuthButton"),
    danmakuForm: document.querySelector("#danmakuForm"),
    danmakuInput: document.querySelector("#danmakuInput"),
    danmakuCount: document.querySelector("#danmakuCount"),
    sendDanmakuButton: document.querySelector("#sendDanmakuButton"),
    danmakuStatus: document.querySelector("#danmakuStatus"),
    danmakuAutoRetry: document.querySelector("#danmakuAutoRetry"),
    danmakuLimit: document.querySelector("#danmakuLimit"),
    danmakuQueueCount: document.querySelector("#danmakuQueueCount"),
    danmakuQueueList: document.querySelector("#danmakuQueueList"),
    danmakuRecentCount: document.querySelector("#danmakuRecentCount"),
    danmakuRecentList: document.querySelector("#danmakuRecentList"),
    toast: document.querySelector("#toast"),
};

const state = {
    mode: "live",
    authenticated: false,
    room: null,
    partitionsLoaded: false,
    partitions: [],
    selectedAreaId: null,
    pendingAreaId: null,
    areaDialogOpen: false,
    areaSearchSettings: loadAreaSearchSettings(),
    areaDocuments: [],
    groupDocuments: [],
    areaFuseIndex: null,
    groupFuseIndex: null,
    areaButtons: new Map(),
    areaGroups: new Map(),
    pollTimer: null,
    toastTimer: null,
    danmakuComposing: false,
    danmakuWorkerRunning: false,
    danmakuQueue: [],
    danmakuRecent: [],
    danmakuSequence: 0,
    danmakuSettings: loadDanmakuSettings(),
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

    let response;
    try {
        response = await fetch(url, config);
    } catch {
        const error = new Error("无法连接本地服务，请确认已运行 npm start -- --live");
        error.stage = "local_service";
        throw error;
    }
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
        error.code = data.code ?? response.status;
        error.stage = data.stage;
        error.officialAuthUrl = data.officialAuthUrl;
        error.faceAuthQr = data.faceAuthQr;
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
    closeAreaDialog({ restoreFocus: false });
    state.authenticated = false;
    state.room = null;
    state.partitionsLoaded = false;
    state.partitions = [];
    state.selectedAreaId = null;
    state.areaDocuments = [];
    state.groupDocuments = [];
    state.areaFuseIndex = null;
    state.groupFuseIndex = null;
    state.areaButtons.clear();
    state.areaGroups.clear();
    elements.areaSearchInput.value = "";
    elements.areaTagWall.replaceChildren();
    elements.areaEmpty.classList.add("hidden");
    elements.areaSearchCount.textContent = "0 个分区";
    elements.selectedAreaSummary.textContent = "尚未加载";
    elements.areaDialogSelection.textContent = "当前选择：尚未选择";
    elements.confirmAreaDialogButton.disabled = true;
    elements.openAreaDialogButton.disabled = true;
    elements.saveAreaButton.disabled = true;
    elements.streamPanel.classList.add("hidden");
    elements.loginPanel.classList.remove("hidden");
    elements.consolePanel.classList.add("hidden");
    elements.logoutButton.classList.add("hidden");
    state.danmakuQueue = [];
    state.danmakuRecent = [];
    elements.danmakuInput.value = "";
    elements.danmakuStatus.textContent = "";
    hideFaceAuth();
    updateDanmakuControls();
    renderDanmakuRecords();
    hideQrFrame();
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

function showQrFrame() {
    elements.qrFrame.classList.remove("qr-hidden");
}

function hideQrFrame() {
    elements.qrFrame.classList.add("qr-hidden");
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login() {
    elements.loginButton.disabled = true;
    hideQrFrame();
    setStatus(elements.loginStatus, "正在获取二维码...");
    try {
        const challenge = await request("/api/login/qrcode");
        setMode(challenge.mode || state.mode);
        await new Promise((resolve) => {
            elements.qrImage.onload = resolve;
            elements.qrImage.onerror = resolve;
            elements.qrImage.src = challenge.qrcode;
        });
        showQrFrame();
        setStatus(elements.loginStatus, "请使用哔哩哔哩手机客户端扫码");
        pollLogin(challenge.token);
    } catch (error) {
        const message = error.stage === "bilibili_network"
            ? "本地服务已启动，但连接 B 站失败。请检查网络或 BILI_PROXY_URL。"
            : error.message;
        hideQrFrame();
        setStatus(elements.loginStatus, message, "error");
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
            hideQrFrame();
            await delay(240);
            showConsole();
            await enterConsole();
            return;
        }
    } catch (error) {
        if (error.code === 86101) {
            setStatus(elements.loginStatus, "等待扫码...");
        } else if (error.code === 86090) {
            setStatus(elements.loginStatus, "已扫码，等待手机端确认...");
        } else {
            setStatus(elements.loginStatus, error.message, "error");
            if (error.code === 404 || error.code === 410 || error.code === 86038) {
                hideQrFrame();
                return;
            }
        }
    }
    state.pollTimer = setTimeout(() => pollLogin(token), 1200);
}

function liveStatusText(status) {
    if (status === 1) return "直播中";
    if (status === 2) return "轮播中";
    return "未开播";
}

function currentRoomId() {
    return normalizeRoomId(elements.roomIdInput.value) || state.room?.roomId || "";
}

function updateRoomActionButtons() {
    const liveStatus = state.room?.liveStatus;
    elements.startButton.disabled = liveStatus == null || liveStatus === 1;
    elements.stopButton.disabled = liveStatus == null || liveStatus !== 1;
}

function renderRoom(room) {
    state.room = room;
    const roomId = normalizeRoomId(room.roomId);
    elements.roomIdInput.value = roomId;
    if (state.danmakuSettings.roomId !== roomId) {
        state.danmakuSettings = saveDanmakuSettings({
            ...state.danmakuSettings,
            roomId,
        });
    }
    elements.currentTitle.textContent = room.title || "--";
    elements.titleInput.value = room.title || "";
    elements.tagsInput.value = (room.tags || []).join(",");
    elements.liveStatus.textContent = liveStatusText(room.liveStatus);
    elements.liveStatus.className = `badge ${room.liveStatus === 1 ? "badge-live" : "badge-muted"}`;
    elements.saveTitleButton.disabled = false;
    elements.saveTagsButton.disabled = false;
    updateRoomActionButtons();
    if (roomsPartitionsAvailable() && resolveArea(room.areaId)) {
        selectArea(room.areaId);
    } else {
        state.selectedAreaId = room.areaId;
        elements.selectedAreaSummary.textContent = `${room.parentAreaName || "分区"} / ${room.areaName || room.areaId}`;
        elements.saveAreaButton.disabled = true;
    }
    elements.openAreaDialogButton.disabled = !roomsPartitionsAvailable();
}

function applyDanmakuSettings() {
    elements.danmakuAutoRetry.checked = state.danmakuSettings.autoRetryPrefix;
    elements.danmakuLimit.value = String(state.danmakuSettings.limit);
    elements.roomIdInput.value = state.danmakuSettings.roomId;
}

function syncDanmakuSettings() {
    const rawLimit = Number(elements.danmakuLimit.value);
    state.danmakuSettings = saveDanmakuSettings(normalizeDanmakuSettings({
        autoRetryPrefix: elements.danmakuAutoRetry.checked,
        limit: rawLimit,
        roomId: elements.roomIdInput.value,
    }));
    applyDanmakuSettings();
    updateDanmakuControls();
}

function updateDanmakuControls() {
    const message = elements.danmakuInput.value.trim();
    const length = unicodeLength(message);
    const limit = state.danmakuSettings.limit;
    elements.danmakuCount.textContent = `${length} / ${limit}`;
    elements.danmakuCount.classList.toggle("error", length > limit);
    elements.sendDanmakuButton.disabled = !state.authenticated || length === 0;
    if (length > limit) {
        const hint = state.danmakuSettings.autoRetryPrefix
            ? `超过 ${limit} 字；若 B 站拒绝，将自动重发开头 ${limit} 字`
            : `超过 ${limit} 字；未开启超限重发`;
        setStatus(elements.danmakuStatus, hint);
    } else if (elements.danmakuStatus.textContent.includes("超过 ")) {
        setStatus(elements.danmakuStatus, "");
    }
}

function danmakuStatusLabel(item) {
    if (item.status === "sent" && item.retriedPrefix) return "重发成功";
    if (item.status === "failed" && item.retriedPrefix) return "重发失败";
    return {
        queued: "排队中",
        sending: "发送中",
        retrying_prefix: "重发开头",
        sent: "成功",
        failed: "失败",
    }[item.status] || item.status;
}

function formatRequestError(error) {
    const code = Number(error?.code);
    const message = error?.message || "请求失败";
    return Number.isFinite(code) && code !== 0 ? `${message}（code ${code}）` : message;
}

function formatDanmakuError(error) {
    const code = Number(error?.code);
    if (String(error?.message || "").toLowerCase() === "f") return "疑似包含屏蔽词";
    if (code === 10031) return "发送频率过快";
    if (code === 1003212) return "超出 B 站长度限制";
    if (error?.stage === "local_service") return "本地服务不可用";
    return formatRequestError(error);
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function createDanmakuItem(text) {
    state.danmakuSequence += 1;
    return {
        id: `${Date.now()}-${state.danmakuSequence}`,
        originalText: text,
        currentText: text,
        status: "queued",
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        retriedPrefix: false,
        error: null,
        autoRetryPrefix: state.danmakuSettings.autoRetryPrefix,
        limit: state.danmakuSettings.limit,
        roomId: currentRoomId(),
    };
}

function createDanmakuRow(item) {
    const row = document.createElement("article");
    row.className = `danmaku-item${item.status === "failed" ? " is-failed" : ""}`;
    row.dataset.id = item.id;

    const text = document.createElement("div");
    text.className = "danmaku-item-text";
    text.textContent = item.currentText;

    const meta = document.createElement("div");
    meta.className = "danmaku-item-meta";
    const stateBadge = document.createElement("span");
    stateBadge.className = "danmaku-state";
    stateBadge.dataset.state = item.status;
    stateBadge.textContent = danmakuStatusLabel(item);
    const time = document.createElement("span");
    time.textContent = formatTime(item.finishedAt || item.startedAt || item.createdAt);
    meta.append(stateBadge, time);

    row.append(text, meta);
    if (item.retriedPrefix) {
        const retry = document.createElement("div");
        retry.className = "danmaku-item-meta";
        retry.textContent = `原消息超限，尝试开头 ${item.limit} 字`;
        row.append(retry);
    }
    if (item.error) {
        const error = document.createElement("div");
        error.className = "danmaku-item-error";
        error.textContent = formatDanmakuError(item.error);
        row.append(error);
    }
    return row;
}

function renderDanmakuList(container, items, emptyText) {
    container.replaceChildren();
    if (items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "danmaku-empty";
        empty.textContent = emptyText;
        container.append(empty);
        return;
    }
    container.append(...items.map(createDanmakuRow));
}

function renderDanmakuRecords() {
    elements.danmakuQueueCount.textContent = String(state.danmakuQueue.length);
    elements.danmakuRecentCount.textContent = String(state.danmakuRecent.length);
    renderDanmakuList(elements.danmakuQueueList, state.danmakuQueue, "暂无待发送弹幕");
    renderDanmakuList(elements.danmakuRecentList, state.danmakuRecent, "还没有发送记录");
}

function finishDanmakuItem(item) {
    item.finishedAt = Date.now();
    state.danmakuQueue = state.danmakuQueue.filter((candidate) => candidate.id !== item.id);
    state.danmakuRecent = [item, ...state.danmakuRecent].slice(0, 8);
    renderDanmakuRecords();
}

async function sendQueuedDanmaku(item) {
    item.status = "sending";
    item.startedAt = Date.now();
    renderDanmakuRecords();

    try {
        await request("/api/danmaku/send", {
            method: "POST",
            body: { roomId: item.roomId || undefined, message: item.currentText },
        });
        item.status = "sent";
    } catch (error) {
        if (shouldRetryPrefix(error.code, item.originalText, item.limit, item.autoRetryPrefix)) {
            item.status = "retrying_prefix";
            item.error = error;
            item.currentText = truncateToLimit(item.originalText, item.limit);
            item.retriedPrefix = true;
            renderDanmakuRecords();
            try {
                await request("/api/danmaku/send", {
                    method: "POST",
                    body: { roomId: item.roomId || undefined, message: item.currentText },
                });
                item.status = "sent";
                item.error = null;
            } catch (retryError) {
                item.status = "failed";
                item.error = retryError;
            }
        } else {
            item.status = "failed";
            item.error = error;
        }
    }

    finishDanmakuItem(item);
    if (item.status === "sent") {
        setStatus(
            elements.danmakuStatus,
            item.retriedPrefix
                ? `原消息超限，已发送开头 ${item.limit} 字`
                : "弹幕发送成功",
            "success",
        );
    } else {
        setStatus(elements.danmakuStatus, formatDanmakuError(item.error), "error");
    }
}

async function processDanmakuQueue() {
    if (state.danmakuWorkerRunning) return;
    state.danmakuWorkerRunning = true;
    try {
        while (state.authenticated) {
            const item = state.danmakuQueue.find((candidate) => candidate.status === "queued");
            if (!item) break;
            await sendQueuedDanmaku(item);
            await delay(350);
        }
    } finally {
        state.danmakuWorkerRunning = false;
        if (state.authenticated && state.danmakuQueue.some((item) => item.status === "queued")) {
            window.setTimeout(() => void processDanmakuQueue(), 0);
        }
    }
}

function enqueueDanmaku(event) {
    event.preventDefault();
    if (state.danmakuComposing || !state.authenticated) return;

    const message = elements.danmakuInput.value.trim();
    if (!message) return;

    syncDanmakuSettings();
    const item = createDanmakuItem(message);
    state.danmakuQueue.push(item);
    elements.danmakuInput.value = "";
    updateDanmakuControls();
    renderDanmakuRecords();
    const waiting = state.danmakuQueue.filter((candidate) => candidate.status === "queued").length;
    setStatus(elements.danmakuStatus, `已加入队列，前方 ${Math.max(0, waiting - 1)} 条`, "success");

    // Start network work after the browser can paint the queued item.
    window.requestAnimationFrame(() => void processDanmakuQueue());
}

function applyAreaSearchSettings() {
    elements.areaPinyinProToggle.checked = state.areaSearchSettings.pinyinPro;
    elements.areaFuseToggle.checked = state.areaSearchSettings.fuse;
}

function rebuildPartitionSearchIndex() {
    const { groupDocuments, areaDocuments } = buildPartitionSearchDocuments(
        state.partitions,
        state.areaSearchSettings.pinyinPro,
    );
    state.groupDocuments = groupDocuments;
    state.areaDocuments = areaDocuments;
    state.groupFuseIndex = state.areaSearchSettings.fuse ? createFuseIndex(groupDocuments, Fuse) : null;
    state.areaFuseIndex = state.areaSearchSettings.fuse ? createFuseIndex(areaDocuments, Fuse) : null;
}

function updateAreaSaveButton() {
    elements.saveAreaButton.disabled = !state.room
        || !state.selectedAreaId
        || Number(state.selectedAreaId) === Number(state.room.areaId);
}

function resolveArea(areaId) {
    const selectedId = Number(areaId);
    if (!Number.isInteger(selectedId) || selectedId <= 0) return null;

    for (const group of state.partitions) {
        const area = (group.list || []).find((item) => Number(item.id) === selectedId);
        if (area) {
            return { areaId: selectedId, area, group };
        }
    }
    return null;
}

function updateAreaButtonSelection(areaId) {
    const selectedId = Number(areaId) || null;
    for (const [id, button] of state.areaButtons) {
        const selected = id === selectedId;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    }
}

function updateAreaDialogSelection() {
    const resolved = state.pendingAreaId ? resolveArea(state.pendingAreaId) : null;
    elements.areaDialogSelection.textContent = resolved
        ? `当前选择：${resolved.group.name} / ${resolved.area.name}`
        : "当前选择：尚未选择";
    elements.confirmAreaDialogButton.disabled = !resolved;
    return resolved;
}

function selectArea(areaId, options = {}) {
    const resolved = resolveArea(areaId);
    if (!resolved) return false;

    state.selectedAreaId = resolved.areaId;
    updateAreaButtonSelection(resolved.areaId);
    elements.selectedAreaSummary.textContent = `${resolved.group.name} / ${resolved.area.name}`;
    updateAreaSaveButton();

    if (options.scrollIntoView) {
        window.setTimeout(() => {
            state.areaButtons.get(resolved.areaId)?.scrollIntoView({ block: "nearest" });
        }, 60);
    }
    return true;
}

function setPendingArea(areaId, options = {}) {
    const resolved = resolveArea(areaId);
    if (!resolved) {
        state.pendingAreaId = null;
        updateAreaButtonSelection(null);
        updateAreaDialogSelection();
        return false;
    }

    state.pendingAreaId = resolved.areaId;
    updateAreaButtonSelection(resolved.areaId);
    updateAreaDialogSelection();
    if (options.scrollIntoView) {
        window.setTimeout(() => {
            state.areaButtons.get(resolved.areaId)?.scrollIntoView({ block: "nearest" });
        }, 60);
    }
    return true;
}

function openAreaDialog() {
    if (!roomsPartitionsAvailable()) return;

    state.areaDialogOpen = true;
    state.pendingAreaId = null;
    elements.areaSearchInput.value = "";
    filterAreaTags();
    if (state.selectedAreaId) setPendingArea(state.selectedAreaId);
    else {
        updateAreaButtonSelection(null);
        updateAreaDialogSelection();
    }

    if (!elements.areaDialog.open) elements.areaDialog.showModal();
    document.body.classList.add("dialog-open");
    window.requestAnimationFrame(() => {
        elements.areaSearchInput.focus();
        elements.areaSearchInput.select();
        state.areaButtons.get(state.pendingAreaId)?.scrollIntoView({ block: "nearest" });
    });
}

function closeAreaDialog(options = {}) {
    if (elements.areaDialog.open) elements.areaDialog.close();
    state.areaDialogOpen = false;
    state.pendingAreaId = null;
    updateAreaButtonSelection(null);
    updateAreaDialogSelection();
    document.body.classList.remove("dialog-open");
    if (options.restoreFocus !== false) {
        window.requestAnimationFrame(() => elements.openAreaDialogButton.focus());
    }
}

function filterAreaTags() {
    const query = elements.areaSearchInput.value.trim();
    const hasQuery = Boolean(query);
    const total = state.areaDocuments.length;
    let visibleCount = 0;

    const areaMatches = hasQuery
        ? matchDocumentIds(state.areaDocuments, query, {
              fuse: state.areaSearchSettings.fuse,
              fuseIndex: state.areaFuseIndex,
          })
        : new Set();
    let groupMatches = hasQuery
        ? matchDocumentIds(state.groupDocuments, query)
        : new Set();
    if (
        hasQuery
        && state.areaSearchSettings.fuse
        && areaMatches.size === 0
        && state.groupFuseIndex
    ) {
        groupMatches = matchDocumentIds(state.groupDocuments, query, {
            fuse: true,
            fuseIndex: state.groupFuseIndex,
        });
    }

    for (const group of state.partitions) {
        const groupSection = state.areaGroups.get(Number(group.id));
        let groupVisibleCount = 0;
        const groupMatched = hasQuery && groupMatches.has(Number(group.id));
        for (const area of group.list || []) {
            const button = state.areaButtons.get(Number(area.id));
            if (!button) continue;
            const visible = !hasQuery || groupMatched || areaMatches.has(Number(area.id));
            button.hidden = !visible;
            if (visible) {
                groupVisibleCount += 1;
                visibleCount += 1;
            }
        }
        if (groupSection) groupSection.hidden = groupVisibleCount === 0;
    }

    elements.areaSearchCount.textContent = hasQuery
        ? `${visibleCount} / ${total} 个分区`
        : `${total} 个分区`;
    elements.areaTagWall.classList.toggle("hidden", visibleCount === 0);
    elements.areaEmpty.textContent = hasQuery ? "没有匹配的直播分区" : "分区列表尚未加载";
    elements.areaEmpty.classList.toggle("hidden", visibleCount > 0);
}

function renderPartitionTags() {
    elements.areaTagWall.replaceChildren();
    state.areaButtons.clear();
    state.areaGroups.clear();

    for (const group of state.partitions) {
        const section = document.createElement("section");
        section.className = "area-group";
        section.dataset.groupId = String(group.id);

        const heading = document.createElement("div");
        heading.className = "area-group-heading";
        const title = document.createElement("h4");
        title.textContent = group.name;
        const count = document.createElement("span");
        count.textContent = String((group.list || []).length);
        heading.append(title, count);

        const tags = document.createElement("div");
        tags.className = "area-tag-list";
        for (const area of group.list || []) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "area-tag";
            button.dataset.areaId = String(area.id);
            button.textContent = area.name;
            button.title = `${group.name} / ${area.name}`;
            button.setAttribute("aria-pressed", "false");
            button.addEventListener("click", () => setPendingArea(area.id, { scrollIntoView: true }));
            state.areaButtons.set(Number(area.id), button);
            tags.append(button);
        }

        section.append(heading, tags);
        state.areaGroups.set(Number(group.id), section);
        elements.areaTagWall.append(section);
    }

    rebuildPartitionSearchIndex();
    filterAreaTags();
}

function roomsPartitionsAvailable() {
    return state.partitions.length > 0;
}

async function loadPartitions(force = false) {
    if (state.partitionsLoaded && !force) return;
    const result = await request("/api/partitions", {
        method: "POST",
        body: { pinyinPro: state.areaSearchSettings.pinyinPro },
    });
    state.partitions = Array.isArray(result.data) ? result.data : [];
    state.partitionsLoaded = true;
    renderPartitionTags();
    elements.openAreaDialogButton.disabled = !roomsPartitionsAvailable() || !state.room;
    const committedAreaId = state.selectedAreaId || state.room?.areaId;
    if (committedAreaId) selectArea(committedAreaId);
    if (state.areaDialogOpen) {
        setPendingArea(state.pendingAreaId || state.selectedAreaId);
        filterAreaTags();
    }
}

async function loadRoom() {
    const roomId = currentRoomId();
    const result = await request("/api/room/info", {
        method: "POST",
        body: roomId ? { roomId } : {},
    });
    renderRoom(result.data);
}

async function enterConsole() {
    try {
        await loadPartitions();
        await loadRoom();
        setStatus(elements.actionStatus, "房间信息已加载", "success");
    } catch (error) {
        setStatus(elements.actionStatus, formatRequestError(error), "error");
        if (error.officialAuthUrl) showToast("需要完成 B 站官方人脸认证", "error");
    }
}

async function saveField(field) {
    const body = { roomId: currentRoomId() || undefined };
    if (field === "title") body.title = elements.titleInput.value;
    if (field === "area") {
        if (!state.selectedAreaId) {
            setStatus(elements.actionStatus, "请先选择一个直播分区", "error");
            return;
        }
        body.partitionId = state.selectedAreaId;
    }
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
        setStatus(elements.actionStatus, formatRequestError(error), "error");
        showToast(formatRequestError(error), "error");
    }
}

function hideFaceAuth() {
    elements.faceAuthPanel.classList.add("hidden");
    elements.faceAuthQrFrame.classList.add("hidden");
    elements.faceAuthQrImage.removeAttribute("src");
}

function showFaceAuth(error) {
    elements.faceAuthMessage.textContent = error.message || "本次开播需要完成 B 站官方人脸认证";
    const qr = typeof error.faceAuthQr === "string" ? error.faceAuthQr : "";
    if (qr.startsWith("data:image/")) {
        elements.faceAuthQrImage.src = qr;
        elements.faceAuthQrFrame.classList.remove("hidden");
    } else {
        elements.faceAuthQrImage.removeAttribute("src");
        elements.faceAuthQrFrame.classList.add("hidden");
    }

    elements.faceAuthPanel.classList.remove("hidden");
    elements.faceAuthPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function startStream() {
    const body = {
        roomId: currentRoomId() || undefined,
        partitionId: state.selectedAreaId,
        title: elements.titleInput.value,
        tags: elements.tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    };
    elements.startButton.disabled = true;
    setStatus(elements.actionStatus, "正在同步开播信息并申请推流...");
    try {
        const result = await request("/api/start-stream", { method: "POST", body });
        hideFaceAuth();
        elements.serverUrl.value = result.serverUrl || "";
        elements.streamKey.value = result.streamKey || "";
        elements.streamPanel.classList.remove("hidden");
        setStatus(elements.actionStatus, "开播请求成功，请将推流信息填入 OBS", "success");
        showToast("开播成功", "success");
        await loadRoom();
    } catch (error) {
        setStatus(elements.actionStatus, formatRequestError(error), "error");
        if (Number(error.code) === 60002) {
            const link = document.createElement("a");
            link.href = "https://link.bilibili.com/#/my-room/violation-records";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "查看直播间违规记录 ↗";
            link.className = "status-link";
            elements.actionStatus.append(document.createElement("br"), link);
        }
        showToast(formatRequestError(error), "error");
        if (error.stage === "face_auth" || [60024, 60043].includes(Number(error.code))) {
            showFaceAuth(error);
        } else {
            hideFaceAuth();
        }
    } finally {
        updateRoomActionButtons();
    }
}

async function waitForRoomOffline() {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        await loadRoom();
        if (state.room?.liveStatus !== 1) return true;
        if (attempt < 3) await delay(1000);
    }
    return false;
}

async function stopStream() {
    elements.stopButton.disabled = true;
    setStatus(elements.actionStatus, "正在停止直播...");
    try {
        await request("/api/stop-stream", {
            method: "POST",
            body: { roomId: currentRoomId() || undefined },
        });
        const stopped = await waitForRoomOffline();
        if (stopped) {
            setStatus(elements.actionStatus, "已下播", "success");
            showToast("直播已停止", "success");
        } else {
            const message = "下播请求成功，但 B 站仍显示直播中，请到直播中心确认";
            setStatus(elements.actionStatus, message, "error");
            showToast(message, "error");
        }
    } catch (error) {
        setStatus(elements.actionStatus, formatRequestError(error), "error");
        showToast(formatRequestError(error), "error");
    } finally {
        updateRoomActionButtons();
    }
}

async function copyValue(id) {
    const input = document.querySelector(`#${id}`);
    if (!input?.value) return;
    await navigator.clipboard.writeText(input.value);
    showToast("已复制", "success");
}

async function init() {
    applyAreaSearchSettings();
    applyDanmakuSettings();
    updateDanmakuControls();
    renderDanmakuRecords();
    try {
        const health = await request("/api/health");
        if (health.version) elements.versionBadge.textContent = `v${health.version}`;
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
elements.openAreaDialogButton.addEventListener("click", openAreaDialog);
elements.closeAreaDialogButton.addEventListener("click", () => closeAreaDialog());
elements.cancelAreaDialogButton.addEventListener("click", () => closeAreaDialog());
elements.confirmAreaDialogButton.addEventListener("click", () => {
    if (state.pendingAreaId) selectArea(state.pendingAreaId, { scrollIntoView: true });
    closeAreaDialog();
});
elements.areaDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAreaDialog();
});
elements.areaDialog.addEventListener("click", (event) => {
    if (event.target === elements.areaDialog) closeAreaDialog();
});
elements.areaDialog.addEventListener("close", () => {
    state.areaDialogOpen = false;
    state.pendingAreaId = null;
    updateAreaButtonSelection(null);
    updateAreaDialogSelection();
    document.body.classList.remove("dialog-open");
});
elements.areaSearchInput.addEventListener("input", filterAreaTags);
elements.areaFuseToggle.addEventListener("change", () => {
    state.areaSearchSettings = saveAreaSearchSettings({
        ...state.areaSearchSettings,
        fuse: elements.areaFuseToggle.checked,
    });
    rebuildPartitionSearchIndex();
    filterAreaTags();
});
elements.areaPinyinProToggle.addEventListener("change", async () => {
    state.areaSearchSettings = saveAreaSearchSettings({
        ...state.areaSearchSettings,
        pinyinPro: elements.areaPinyinProToggle.checked,
    });
    elements.areaPinyinProToggle.disabled = true;
    setStatus(elements.actionStatus, "正在重建分区拼音索引...");
    try {
        await loadPartitions(true);
        setStatus(elements.actionStatus, "分区拼音索引已更新", "success");
    } catch (error) {
        setStatus(elements.actionStatus, formatRequestError(error), "error");
    } finally {
        elements.areaPinyinProToggle.disabled = false;
    }
});
elements.saveTitleButton.addEventListener("click", () => saveField("title"));
elements.saveAreaButton.addEventListener("click", () => saveField("area"));
elements.saveTagsButton.addEventListener("click", () => saveField("tags"));
elements.startButton.addEventListener("click", startStream);
elements.stopButton.addEventListener("click", stopStream);
elements.faceAuthCloseButton.addEventListener("click", hideFaceAuth);
elements.retryFaceAuthButton.addEventListener("click", () => {
    hideFaceAuth();
    void startStream();
});
elements.danmakuForm.addEventListener("submit", enqueueDanmaku);
elements.danmakuInput.addEventListener("input", updateDanmakuControls);
elements.danmakuAutoRetry.addEventListener("change", syncDanmakuSettings);
elements.danmakuLimit.addEventListener("change", syncDanmakuSettings);
elements.roomIdInput.addEventListener("change", syncDanmakuSettings);
elements.danmakuInput.addEventListener("compositionstart", () => {
    state.danmakuComposing = true;
});
elements.danmakuInput.addEventListener("compositionend", () => {
    state.danmakuComposing = false;
});
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
