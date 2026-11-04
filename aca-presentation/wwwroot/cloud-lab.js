(() => {
  "use strict";

  const load = document.getElementById("sim-load");
  const warm = document.getElementById("sim-warm");
  const play = document.getElementById("sim-play");
  const split = document.getElementById("sim-split");
  const section = document.getElementById("cloudlab");
  let state;

  function reset() {
    state = { time: 0, replicas: 1, queue: 0, completed: 0, cooldown: 0, startup: 0, playing: false, history: [] };
    load.value = "6";
    warm.checked = true;
    render();
  }

  function target() {
    const minimum = warm.checked || state.queue > 0 ? 1 : 0;
    return Math.max(minimum, Math.min(4, Math.ceil(Number(load.value) / 6)));
  }

  function render(message) {
    document.getElementById("sim-load-value").value = load.value;
    document.getElementById("sim-clock").textContent = `t + ${state.time} s`;
    document.getElementById("sim-replicas").textContent = `${state.replicas} / ${target()}`;
    document.getElementById("sim-queue").textContent = state.queue;
    document.getElementById("sim-completed").textContent = state.completed;
    play.textContent = state.playing ? "暂停模拟" : "开始模拟";
    document.querySelectorAll("[data-replica]").forEach((tile) => {
      const number = Number(tile.dataset.replica);
      const starting = state.startup > 0 && number === 1;
      tile.dataset.state = number <= state.replicas ? "running" : starting ? "starting" : "stopped";
      tile.querySelector("strong").textContent = number <= state.replicas ? "Running" : starting ? "Starting" : "Stopped";
    });
    const timeline = document.getElementById("sim-timeline");
    timeline.replaceChildren(...state.history.map((replicas) => {
      const bar = document.createElement("span");
      bar.dataset.count = String(replicas);
      return bar;
    }));
    document.getElementById("sim-state").textContent = message || (
      !state.playing ? "模拟已暂停。拖动滑杆，再观察系统怎样响应。"
        : state.startup > 0 ? `冷启动中，还需 ${state.startup} 个模拟秒。请求正在排队。`
          : state.replicas === 0 ? "已缩到零：没有运行副本，也没有即时响应能力。"
            : state.replicas < target() ? "目标容量增加，正在逐步启动新副本。"
              : state.replicas > target() ? "低负载冷却中，避免因为瞬时波动反复扩缩容。"
                : state.queue > 0 ? "容量已经跟上；还要处理刚才积压的请求。"
                  : "实际容量已跟上声明的目标。"
    );
  }

  function tick() {
    if (!state.playing || section.hidden || document.hidden) return;
    state.time++;
    const desired = target();
    if (state.replicas === 0 && desired > 0 && state.startup === 0) state.startup = 4;
    if (state.startup > 0) {
      if (desired === 0) state.startup = 0;
      else if (--state.startup === 0) state.replicas = 1;
    } else if (state.replicas < desired && state.time % 2 === 0) {
      state.replicas++;
      state.cooldown = 0;
    }
    if (state.replicas > desired) {
      if (++state.cooldown >= 6) {
        state.replicas--;
        state.cooldown = 0;
      }
    } else {
      state.cooldown = 0;
    }
    state.queue += Number(load.value);
    const served = Math.min(state.queue, state.replicas * 6);
    state.queue -= served;
    state.completed += served;
    state.history.push(state.replicas);
    if (state.history.length > 32) state.history.shift();
    render();
  }

  load.addEventListener("input", () => render());
  warm.addEventListener("change", () => render());
  play.addEventListener("click", () => { state.playing = !state.playing; render(); });
  document.getElementById("sim-burst").addEventListener("click", () => {
    load.value = "24"; state.playing = true; render();
  });
  document.getElementById("sim-idle").addEventListener("click", () => {
    load.value = "0"; state.playing = true; render();
  });
  document.getElementById("sim-reset").addEventListener("click", reset);

  function renderSplit() {
    const weight = Number(split.value);
    document.getElementById("split-label").textContent = `${weight}%`;
    document.getElementById("split-v1").value = `${100 - weight}%`;
    document.getElementById("split-v2").value = `${weight}%`;
    const samples = Array.from({ length: 20 }, (_, index) => {
      const cell = document.createElement("span");
      const newer = Math.floor((index + 1) * weight / 100) > Math.floor(index * weight / 100);
      cell.className = newer ? "sample-v2" : "sample-v1";
      cell.textContent = newer ? "2" : "1";
      return cell;
    });
    document.getElementById("traffic-samples").replaceChildren(...samples);
    document.getElementById("release-verdict").textContent = weight === 0
      ? "示意：所有流量回到 v1。流量切回，不代表数据库或外部副作用也已回滚。"
      : weight === 100 ? "示意：全部流量进入 v2；旧 revision 是否保留，是另一个决定。"
        : `示意：${weight}% 给 v2，${100 - weight}% 留在 v1。观察结果，再决定下一步。`;
  }

  split.addEventListener("input", renderSplit);
  for (const [id, weight] of [["split-canary", 10], ["split-promote", 100], ["split-rollback", 0]]) {
    document.getElementById(id).addEventListener("click", () => { split.value = String(weight); renderSplit(); });
  }
  reset();
  renderSplit();
  setInterval(tick, 500);
})();
