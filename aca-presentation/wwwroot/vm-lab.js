(() => {
  "use strict";

  // Azure Retail Prices API snapshot, 2026-11-05 UTC: East US, USD/hour,
  // standard Linux Consumption meters; excludes Windows, Spot and Cloud Services.
  const skus = [
    {
      name: "B2ats_v2", kind: "很轻的突发实验", cpu: 2, memory: 1, rate: 0.0094,
      profile: "AMD x64 · 2 vCPU / 1 GiB · Burstable",
      fit: "适合非常轻的脚本、学习用网络实验或小服务。先确认操作系统和后台进程之外，还剩多少内存。",
      caution: "1 GiB 很容易成为瓶颈；低价格不等于能持续跑满 2 vCPU，也不意味着适合整套开发工具。"
    },
    {
      name: "B2als_v2", kind: "低平均负载", cpu: 2, memory: 4, rate: 0.0376,
      profile: "AMD x64 · 2 vCPU / 4 GiB · Burstable",
      fit: "适合多数时候空闲、偶尔有突发的个人实验。和最小档相比，4 GiB 留出了更实际的内存空间。",
      caution: "CPU credit 用完会回到基线性能。持续编译、压测、加密或转发负载要观察 credit，而不只看型号上的“2核”。"
    },
    {
      name: "D2as_v5", kind: "建议作为基线", cpu: 2, memory: 8, rate: 0.086,
      profile: "AMD x64 · 2 vCPU / 8 GiB · 通用型",
      fit: "先用它跑开发环境、容器或小 API，观察 CPU、内存、磁盘和网络。小规格 D 是一个省心的起点，不是所有负载的最终答案。",
      caution: "不使用 B 系列的 CPU credit 模型，但也不代表每种负载都有性能保证。没有本地临时盘，持久磁盘仍需单独计费。"
    },
    {
      name: "D2als_v6", kind: "更低内存比例", cpu: 2, memory: 4, rate: 0.0804,
      profile: "AMD x64 · 2 vCPU / 4 GiB · 通用型",
      fit: "内存需求明确很小、又不想受 B 系列 CPU credit 约束时，可以把它加入比较。",
      caution: "不要只看它便宜一点：这个快照下，730 小时仅比 D2as_v5 少约 $4.09，但内存从 8 GiB 降到了 4 GiB。"
    },
    {
      name: "D2ps_v6", kind: "Arm 兼容后再选", cpu: 2, memory: 8, rate: 0.0702,
      profile: "Arm64 · Cobalt 100 · 2 vCPU / 8 GiB",
      fit: "依赖和镜像都支持 Arm64 时值得比较。按这个报价，计算费低于 D2as_v5，但不是一次性能基准测试。",
      caution: "先确认操作系统、容器镜像和原生依赖的架构。本仓库的当前 CI 默认构建 amd64 镜像，不能不改构建就当成 arm64 使用。"
    }
  ];
  const hours = document.getElementById("vm-hours");
  const body = document.getElementById("vm-skus");
  const error = document.getElementById("vm-error");
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  let selected = skus.find((sku) => sku.name === "D2as_v5");

  const rows = skus.map((sku) => {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vm-sku-button";
    button.textContent = sku.name;
    button.setAttribute("aria-label", `选择 ${sku.name}`);
    const label = document.createElement("small");
    label.textContent = sku.kind;
    identity.append(button, label);
    const shape = document.createElement("td");
    shape.textContent = `${sku.cpu} / ${sku.memory} GiB`;
    const rate = document.createElement("td");
    rate.textContent = `$${sku.rate.toFixed(4)}`;
    const total = document.createElement("td");
    row.append(identity, shape, rate, total);
    body.append(row);
    button.addEventListener("click", () => { selected = sku; render(); });
    return { sku, row, button, total };
  });

  function render() {
    const duration = Number(hours.value);
    if (!Number.isFinite(duration) || duration < 0 || duration > 730) {
      error.textContent = "运行时长必须在 0 到 730 小时之间。";
      error.hidden = false;
      return;
    }
    error.hidden = true;
    document.getElementById("vm-hours-value").value = String(duration);
    document.getElementById("vm-hours-heading").textContent = `月计算费 · ${duration} h`;
    for (const { sku, row, button, total } of rows) {
      const active = sku === selected;
      row.classList.toggle("vm-active", active);
      button.setAttribute("aria-pressed", String(active));
      total.textContent = currency.format(sku.rate * duration);
    }
    const cost = selected.rate * duration;
    document.getElementById("vm-selected").textContent = selected.name;
    document.getElementById("vm-profile").textContent = selected.profile;
    document.getElementById("vm-cost").textContent = currency.format(cost);
    document.getElementById("vm-budget").value = cost;
    document.getElementById("vm-budget-text").textContent =
      `仅计算费约占 $150 参考预算的 ${(cost / 150 * 100).toFixed(1)}%。这不是实际订阅余额，也不是完整账单。`;
    document.getElementById("vm-fit").textContent = selected.fit;
    document.getElementById("vm-caution").textContent = selected.caution;
  }

  hours.addEventListener("input", render);
  document.querySelectorAll("[data-vm-hours]").forEach((button) => {
    button.addEventListener("click", () => { hours.value = button.dataset.vmHours; render(); });
  });
  render();
})();
