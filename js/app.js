(function () {
  const stages = window.UPSTREAM_STAGES;
  const homeView = document.getElementById("view-home");
  const detailView = document.getElementById("view-detail");
  const flowEl = document.getElementById("flow");
  const totalTechsEl = document.getElementById("total-techs");
  const totalStepsEl = document.getElementById("total-steps");
  const detailTitle = document.getElementById("detail-title");
  const detailLead = document.getElementById("detail-lead");
  const tableBody = document.getElementById("table-body");
  const statusChipsEl = document.getElementById("status-chips");
  const kpiChipsEl = document.getElementById("kpi-chips");
  const filterCountEl = document.getElementById("filter-count");
  const resetBtn = document.getElementById("reset-filters");
  const globalSearch = document.getElementById("tech-search");
  const searchResults = document.getElementById("search-results");
  const stepSearch = document.getElementById("step-search");

  const STATUS = {
    green: { label: "Успешно применяется на месторождениях ПАО «Газпром нефть»", short: "Успешно применяется", cls: "green" },
    yellow: { label: "Не применяется на месторождениях ПАО «Газпром нефть», рекомендована к внедрению", short: "Рекомендована к внедрению", cls: "yellow" },
    red: { label: "Не подлежит применению на месторождениях ПАО «Газпром нефть»", short: "Не подлежит применению", cls: "red" }
  };

  const KPI_OPTIONS = ["КИН", "CAPEX", "OPEX", "REVEX", "объём добычи", "NPV"];

  const filters = {
    statuses: new Set(),
    kpis: new Set(),
    query: ""
  };

  let currentStageId = null;
  let currentTechs = [];
  let highlightName = null;
  let flashTimer = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ё/g, "е");
  }

  function techHaystack(tech, stage) {
    return normalize([
      tech.name,
      tech.desc,
      stage.title,
      stage.short,
      ...(tech.keywords || [])
    ].join(" "));
  }

  const catalog = stages.flatMap((stage) =>
    stage.technologies.map((tech) => ({
      stageId: stage.id,
      stageTitle: stage.title,
      tech,
      haystack: techHaystack(tech, stage)
    }))
  );

  const total = catalog.length;
  totalTechsEl.textContent = String(total);
  totalStepsEl.textContent = String(stages.length);

  flowEl.innerHTML = stages.map((stage, index) => `
    <button class="step" type="button" data-stage="${stage.id}">
      ${index ? '<span class="chevron" aria-hidden="true"></span>' : ""}
      <div class="step-index">${index + 1}</div>
      <h3>${escapeHtml(stage.short)}</h3>
      <div class="count">
        <strong>${stage.technologies.length}</strong>
        <span>технологий<br>на шаге</span>
      </div>
    </button>
  `).join("");

  flowEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stage]");
    if (!button) return;
    openStage(button.getAttribute("data-stage"));
  });

  document.getElementById("back-btn").addEventListener("click", () => {
    highlightName = null;
    detailView.classList.remove("active");
    homeView.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  statusChipsEl.innerHTML = Object.entries(STATUS).map(([key, item]) => `
    <button type="button" class="chip status-${item.cls}" data-status="${key}">
      <span class="dot ${item.cls}"></span>${escapeHtml(item.short)}
    </button>
  `).join("");

  kpiChipsEl.innerHTML = KPI_OPTIONS.map((kpi) => `
    <button type="button" class="chip" data-kpi="${escapeHtml(kpi)}">${escapeHtml(kpi)}</button>
  `).join("");

  statusChipsEl.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-status]");
    if (!chip) return;
    toggleSet(filters.statuses, chip.getAttribute("data-status"));
    syncChips();
    renderTable();
  });

  kpiChipsEl.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-kpi]");
    if (!chip) return;
    toggleSet(filters.kpis, chip.getAttribute("data-kpi"));
    syncChips();
    renderTable();
  });

  stepSearch.addEventListener("input", () => {
    filters.query = stepSearch.value.trim();
    syncChips();
    renderTable();
  });

  resetBtn.addEventListener("click", () => {
    clearLocalFilters();
    renderTable();
  });

  globalSearch.addEventListener("input", () => {
    renderGlobalResults(globalSearch.value);
  });

  globalSearch.addEventListener("focus", () => {
    if (globalSearch.value.trim()) renderGlobalResults(globalSearch.value);
  });

  globalSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideGlobalResults();
    if (event.key === "Enter") {
      const first = searchResults.querySelector("[data-stage]");
      if (first) {
        event.preventDefault();
        first.click();
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#search-wrap")) hideGlobalResults();
  });

  function toggleSet(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
  }

  function clearLocalFilters() {
    filters.statuses.clear();
    filters.kpis.clear();
    filters.query = "";
    stepSearch.value = "";
    syncChips();
  }

  function hasLocalFilters() {
    return filters.statuses.size + filters.kpis.size > 0 || Boolean(filters.query);
  }

  function syncChips() {
    statusChipsEl.querySelectorAll("[data-status]").forEach((chip) => {
      chip.classList.toggle("active", filters.statuses.has(chip.getAttribute("data-status")));
    });
    kpiChipsEl.querySelectorAll("[data-kpi]").forEach((chip) => {
      chip.classList.toggle("active", filters.kpis.has(chip.getAttribute("data-kpi")));
    });
    resetBtn.disabled = !hasLocalFilters();
  }

  function tokens(query) {
    return normalize(query).split(/\s+/).filter(Boolean);
  }

  function matchesQuery(haystack, query) {
    const parts = tokens(query);
    return parts.length > 0 && parts.every((part) => haystack.includes(part));
  }

  function filteredTechs() {
    const stage = stages.find((item) => item.id === currentStageId);
    return currentTechs.filter((tech) => {
      const statusOk = filters.statuses.size === 0 || filters.statuses.has(tech.status || "yellow");
      const kpiOk = filters.kpis.size === 0 || tech.kpis.some((kpi) => filters.kpis.has(kpi));
      const textOk = !filters.query || matchesQuery(techHaystack(tech, stage), filters.query);
      return statusOk && kpiOk && textOk;
    });
  }

  function renderTable() {
    const visible = filteredTechs();
    const totalCount = currentTechs.length;
    filterCountEl.textContent = hasLocalFilters()
      ? `Показано ${visible.length} из ${totalCount}`
      : `${totalCount} технологий на шаге`;

    if (!visible.length) {
      tableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="4">Нет технологий, удовлетворяющих выбранным фильтрам. Сбросьте фильтры или ослабьте условия.</td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = visible.map((tech) => {
      const statusKey = tech.status || "yellow";
      const status = STATUS[statusKey];
      const kpis = tech.kpis.map((kpi) => {
        const on = filters.kpis.has(kpi) ? " kpi-match" : "";
        return `<span class="kpi${on}">${escapeHtml(kpi)}</span>`;
      }).join("");
      return `
        <tr data-tech-name="${escapeHtml(tech.name)}">
          <td data-label="Технология"><div class="tech-name">${escapeHtml(tech.name)}</div></td>
          <td class="desc" data-label="Описание">${escapeHtml(tech.desc)}</td>
          <td class="status-cell" data-label="Применение на месторождениях ПАО «Газпром нефть»">
            <span class="status">
              <span class="dot ${status.cls}"></span>
              <span class="status-full">${escapeHtml(status.label)}</span>
              <span class="status-short">${escapeHtml(status.short)}</span>
            </span>
          </td>
          <td data-label="Влияние на ключевые показатели"><div class="kpis">${kpis}</div></td>
        </tr>
      `;
    }).join("");

    if (highlightName) {
      requestAnimationFrame(() => flashRow(highlightName));
    }
  }

  function flashRow(name) {
    if (flashTimer) clearTimeout(flashTimer);
    const row = Array.from(tableBody.querySelectorAll("tr[data-tech-name]"))
      .find((item) => item.getAttribute("data-tech-name") === name);
    if (!row) return;
    row.classList.add("flash-row");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    flashTimer = setTimeout(() => {
      row.classList.remove("flash-row");
      highlightName = null;
    }, 3400);
  }

  function hideGlobalResults() {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
  }

  function renderGlobalResults(query) {
    const q = query.trim();
    if (!q) {
      hideGlobalResults();
      return;
    }
    const hits = catalog.filter((item) => matchesQuery(item.haystack, q)).slice(0, 12);
    searchResults.hidden = false;
    if (!hits.length) {
      searchResults.innerHTML = `<div class="search-empty">Ничего не найдено по запросу «${escapeHtml(q)}»</div>`;
      return;
    }
    searchResults.innerHTML = hits.map((item) => `
      <button type="button" class="search-hit" data-stage="${item.stageId}" data-tech-name="${escapeHtml(item.tech.name)}">
        <b>${escapeHtml(item.tech.name)}</b>
        <span>${escapeHtml(item.stageTitle)}</span>
      </button>
    `).join("");
  }

  searchResults.addEventListener("click", (event) => {
    const hit = event.target.closest("[data-stage]");
    if (!hit) return;
    const stageId = hit.getAttribute("data-stage");
    const name = hit.getAttribute("data-tech-name");
    globalSearch.value = name;
    hideGlobalResults();
    openStage(stageId, name);
  });

  function openStage(id, techName) {
    const stage = stages.find((item) => item.id === id);
    if (!stage) return;

    currentStageId = id;
    currentTechs = stage.technologies;
    highlightName = techName || null;
    clearLocalFilters();
    detailTitle.textContent = `Детализация технологий по шагу «${stage.title}»`;
    detailLead.textContent = stage.lead;
    homeView.classList.remove("active");
    detailView.classList.add("active");
    renderTable();
    if (!techName) window.scrollTo({ top: 0, behavior: "smooth" });
  }
})();
