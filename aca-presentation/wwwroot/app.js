(() => {
  "use strict";

  const slides = Array.from(document.querySelectorAll(".slide"));
  const dots = Array.from(document.querySelectorAll(".slide-dots a"));
  const requestButtons = Array.from(document.querySelectorAll("[data-request]"));
  const status = document.getElementById("runtime-status");
  const errorBox = document.getElementById("request-error");
  const snapshot = document.getElementById("snapshot-label");
  const offline = !["http:", "https:"].includes(window.location.protocol);
  let current = 0;
  let lastResponse = null;
  let toastTimer;

  function showSlide(index) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, position) => { slide.hidden = position !== current; });
    dots.forEach((dot, position) => {
      if (position === current) dot.setAttribute("aria-current", "step");
      else dot.removeAttribute("aria-current");
    });
    document.getElementById("previous").disabled = current === 0;
    document.getElementById("next").disabled = current === slides.length - 1;
    document.getElementById("page-counter").textContent =
      `${String(current + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
    document.getElementById("deck-progress").value = current + 1;
    window.scrollTo(0, 0);
  }

  function followHash() {
    const index = slides.findIndex((slide) => `#${slide.id}` === window.location.hash);
    showSlide(index < 0 ? 0 : index);
  }

  function navigate(index) {
    window.location.hash = slides[Math.max(0, Math.min(slides.length - 1, index))].id;
  }

  function toast(message) {
    const element = document.getElementById("toast");
    clearTimeout(toastTimer);
    element.textContent = message;
    element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
  }

  document.getElementById("previous").addEventListener("click", () => navigate(current - 1));
  document.getElementById("next").addEventListener("click", () => navigate(current + 1));
  window.addEventListener("hashchange", followHash);
  document.addEventListener("keydown", async (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest("input, textarea, select, button, a, summary, [contenteditable]")) return;
    const destinations = {
      ArrowLeft: current - 1, PageUp: current - 1,
      ArrowRight: current + 1, PageDown: current + 1,
      Home: 0, End: slides.length - 1,
    };
    if (Object.hasOwn(destinations, event.key)) {
      event.preventDefault();
      navigate(destinations[event.key]);
    }
    if (event.key.toLowerCase() === "f") {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        toast("浏览器未允许全屏，请使用浏览器的全屏菜单。");
      }
    }
  });

  const shareUrl = offline ? null : `${window.location.origin}${window.location.pathname}`;
  document.getElementById("current-address").textContent = shareUrl || "file:// · 离线讲义";
  document.getElementById("address-note").textContent = offline
    ? "讲义可以离线阅读；真实 API 需要启动 .NET 服务。"
    : ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
      ? "当前是本地地址，还不是公网部署。"
      : "这是当前页面地址；后端运行位置请以真实 API 为准。";
  document.getElementById("copy-link").addEventListener("click", async () => {
    if (offline) {
      toast("当前是离线文件，没有可分享的服务网址。");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("讲义链接已复制。localhost 地址仍只能在本机使用。");
    } catch {
      toast("无法读取剪贴板权限，请直接复制浏览器地址栏。");
    }
  });

  function validateResponse(data) {
    const required = ["version", "environment", "hostname", "serverTime", "requestId"];
    if (!data || typeof data !== "object" ||
        required.some((name) => typeof data[name] !== "string" || data[name].length === 0) ||
        !["local", "azure-container-apps"].includes(data.environment) ||
        !Number.isFinite(Date.parse(data.serverTime)) ||
        !Number.isFinite(data.uptimeSeconds) || data.uptimeSeconds < 0 ||
        ["appName", "revision", "replica"].some((name) => data[name] !== null && typeof data[name] !== "string")) {
      throw new Error("API 返回了不符合运行卡片格式的数据。");
    }
  }

  function renderResponse(data, elapsed) {
    for (const element of document.querySelectorAll("[data-field]")) {
      const name = element.dataset.field;
      let value = data[name];
      if (name === "environment") value = value === "azure-container-apps" ? "Azure Container Apps" : "Local";
      else if (name === "uptimeSeconds") value = `${value} s`;
      else if (value === null) value = data.environment === "local" ? "不适用 · 本地运行" : "未提供";
      element.textContent = value;
    }
    document.getElementById("latency").textContent = `${elapsed.toFixed(0)} ms`;
    document.getElementById("raw-response").textContent = JSON.stringify(data, null, 2);
    const row = document.createElement("tr");
    for (const value of [new Date(data.serverTime).toLocaleTimeString(), data.version, `${elapsed.toFixed(0)} ms`, data.requestId]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const history = document.querySelector("#request-history tbody");
    history.prepend(row);
    while (history.children.length > 6) history.lastElementChild.remove();

    const banner = document.getElementById("version-change");
    const changed = lastResponse && lastResponse.version !== data.version;
    banner.hidden = !changed;
    if (changed) banner.textContent = `检测到真实版本变化：${lastResponse.version} → ${data.version}`;
    document.getElementById("version-observation").textContent = changed
      ? banner.textContent
      : `最近一次真实响应：${data.version} · ${data.revision || "本地，无 ACA revision"} · ${data.serverTime}`;
    snapshot.textContent = `最近成功请求 · ${new Date(data.serverTime).toLocaleTimeString()}`;
  }

  async function requestRuntime() {
    requestButtons.forEach((button) => { button.disabled = true; });
    status.textContent = "请求中";
    status.dataset.state = "loading";
    errorBox.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const started = performance.now();
    try {
      const response = await fetch("./api/info", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      validateResponse(data);
      renderResponse(data, performance.now() - started);
      lastResponse = data;
      status.textContent = "请求成功";
      status.dataset.state = "success";
    } catch (error) {
      const reason = controller.signal.aborted ? "超过 10 秒，请求已超时" : error.message;
      status.textContent = "请求失败";
      status.dataset.state = "error";
      errorBox.textContent = `没有获取到新的运行信息：${reason}。请确认服务可用后重试。`;
      errorBox.hidden = false;
      snapshot.textContent = lastResponse ? "上次成功请求 · 当前数据不是新的响应" : "尚无成功响应";
      document.getElementById("version-change").hidden = true;
      document.getElementById("version-observation").textContent =
        `本次请求失败：${reason}。${lastResponse ? `上次成功版本：${lastResponse.version}。` : "尚无成功响应。"}`;
    } finally {
      clearTimeout(timeout);
      requestButtons.forEach((button) => { button.disabled = offline; });
    }
  }

  if (offline) {
    status.textContent = "离线讲义";
    snapshot.textContent = "启动 .NET 服务后才能查询真实运行信息";
    requestButtons.forEach((button) => { button.disabled = true; });
  } else {
    requestButtons.forEach((button) => button.addEventListener("click", requestRuntime));
  }
  followHash();
})();
