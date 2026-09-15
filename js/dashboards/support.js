(function () {
  chartDefaults();

  const els = {
    categorie: document.getElementById("f-categorie"),
    priorite: document.getElementById("f-priorite"),
    statut: document.getElementById("f-statut"),
    canal: document.getElementById("f-canal"),
    du: document.getElementById("f-du"),
    au: document.getElementById("f-au"),
    reset: document.getElementById("reset-filters"),
  };

  const monthsSet = [...new Set(SUPPORT_DATA.map((r) => r.date.slice(0, 7)))].sort();
  const monthLabel = (m) => {
    const [y, mo] = m.split("-");
    return new Date(y, mo - 1, 1).toLocaleDateString(window.portfolioLocale(), { month: "short", year: "numeric" });
  };

  function fillSelect(el, values, labelFn) {
    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = labelFn ? labelFn(v) : v;
      el.appendChild(opt);
    });
  }
  fillSelect(els.categorie, SUPPORT_META.categories);
  fillSelect(els.priorite, SUPPORT_META.priorites);
  fillSelect(els.statut, SUPPORT_META.statuts);
  fillSelect(els.canal, SUPPORT_META.canaux);
  fillSelect(els.du, monthsSet, monthLabel);
  fillSelect(els.au, monthsSet, monthLabel);
  els.du.value = monthsSet[0];
  els.au.value = monthsSet[monthsSet.length - 1];

  let sortKey = "date";
  let sortDir = -1;
  let page = 1;
  const PAGE_SIZE = 12;

  function getFiltered() {
    const categorie = els.categorie.value;
    const priorite = els.priorite.value;
    const statut = els.statut.value;
    const canal = els.canal.value;
    const du = els.du.value;
    const au = els.au.value;
    return SUPPORT_DATA.filter((r) => {
      const m = r.date.slice(0, 7);
      if (categorie && r.categorie !== categorie) return false;
      if (priorite && r.priorite !== priorite) return false;
      if (statut && r.statut !== statut) return false;
      if (canal && r.canal !== canal) return false;
      if (m < du || m > au) return false;
      return true;
    });
  }

  const statutClass = { "Résolu": "ok", "En cours": "wait", "En retard": "late" };

  const GLOBAL_TEMPS = SUPPORT_DATA.filter((r) => r.tempsResolutionH != null).map((r) => r.tempsResolutionH);
  const GLOBAL_AVG_TEMPS = GLOBAL_TEMPS.reduce((a, b) => a + b, 0) / GLOBAL_TEMPS.length;

  function renderInsights(ctx) {
    const el = document.getElementById("insight-list");
    if (!el) return;
    const items = [];

    if (ctx.nb === 0) {
      items.push("Aucun ticket ne correspond aux filtres actifs — élargissez la période ou réinitialisez les filtres.");
    } else {
      if (ctx.topCanal.length) {
        const [nom, nbTickets] = ctx.topCanal[0];
        const pct = (nbTickets / ctx.nb) * 100;
        items.push(`Le canal <b>${nom}</b> concentre le plus de tickets sur la sélection : <b>${nbTickets}</b>, soit <b>${fmtNum(pct, 1)}%</b> du volume filtré.`);
      }
      if (ctx.late > 0) {
        const topCat = ctx.catKeys.find((c) => ctx.retardCat[c] > 0);
        items.push(`<b>${ctx.late}</b> ticket(s) en retard sur le SLA (${fmtNum(ctx.rate, 1)}%)${topCat ? ` — la catégorie la plus touchée est <b>${topCat}</b> (${ctx.retardCat[topCat]} ticket(s))` : ""}.`);
      } else {
        items.push("Aucun ticket en retard sur la sélection actuelle : le SLA est respecté sur ce périmètre.");
      }
      if (ctx.catAllKeys.length) {
        const topCat = ctx.catAllKeys[0];
        const pct = (ctx.byCat[topCat] / ctx.nb) * 100;
        items.push(`La catégorie <b>${topCat}</b> concentre <b>${fmtNum(pct, 1)}%</b> des tickets filtrés (${ctx.byCat[topCat]}).`);
      }
      if (ctx.avgTemps > 0) {
        const diff = ctx.avgTemps - GLOBAL_AVG_TEMPS;
        const compare = Math.abs(diff) < 1 ? "proche de la moyenne globale" : diff > 0 ? `<b>${fmtNum(diff, 0)}h au-dessus</b> de la moyenne globale (${fmtNum(GLOBAL_AVG_TEMPS, 0)}h)` : `<b>${fmtNum(Math.abs(diff), 0)}h en-dessous</b> de la moyenne globale (${fmtNum(GLOBAL_AVG_TEMPS, 0)}h)`;
        items.push(`Le temps de résolution moyen observé (${fmtNum(ctx.avgTemps, 0)}h) est ${compare}.`);
      }
    }

    el.innerHTML = items.map((txt) => `<div class="insight-item"><span class="bullet">→</span><span>${txt}</span></div>`).join("");
  }

  let charts = {};
  function upsertChart(key, ctx, config) {
    if (charts[key]) { charts[key].destroy(); }
    charts[key] = new Chart(ctx, config);
  }

  function render() {
    const rows = getFiltered();

    const nb = rows.length;
    const late = rows.filter((r) => r.statut === "En retard").length;
    const rate = nb ? (late / nb) * 100 : 0;
    const temps = rows.filter((r) => r.tempsResolutionH != null).map((r) => r.tempsResolutionH);
    const avgTemps = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
    const satisfactions = rows.filter((r) => r.satisfaction != null).map((r) => r.satisfaction);
    const avgSatisfaction = satisfactions.length ? satisfactions.reduce((a, b) => a + b, 0) / satisfactions.length : 0;

    document.getElementById("kpi-nb").textContent = fmtNum(nb);
    document.getElementById("kpi-temps").textContent = fmtNum(avgTemps, 0) + " h";
    document.getElementById("kpi-sla").textContent = fmtNum(100 - rate, 1) + " %";
    document.getElementById("kpi-satisfaction").textContent = fmtNum(avgSatisfaction, 0) + " %";

    // Chart 1 : évolution mensuelle du volume de tickets
    const byMonth = {};
    rows.forEach((r) => { const m = r.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; });
    const monthKeys = Object.keys(byMonth).sort();
    upsertChart("evolution", document.getElementById("chart-evolution"), {
      type: "line",
      data: {
        labels: monthKeys.map(monthLabel),
        datasets: [{ label: "Tickets", data: monthKeys.map((m) => byMonth[m]), borderColor: CHART_COLORS.accent2, backgroundColor: "rgba(34,211,238,.12)", fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }],
      },
      options: baseOpts({}),
    });

    // Chart 2 : répartition par catégorie
    const byCat = {};
    rows.forEach((r) => { byCat[r.categorie] = (byCat[r.categorie] || 0) + 1; });
    const catAllKeys = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    upsertChart("categorie", document.getElementById("chart-categorie"), {
      type: "doughnut",
      data: { labels: catAllKeys, datasets: [{ data: catAllKeys.map((k) => byCat[k]), backgroundColor: palette(catAllKeys.length), borderWidth: 0 }] },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } } },
    });

    // Chart 3 : volume par canal
    const byCanal = {};
    SUPPORT_META.canaux.forEach((c) => (byCanal[c] = 0));
    rows.forEach((r) => { byCanal[r.canal]++; });
    const canalKeys = Object.keys(byCanal).sort((a, b) => byCanal[b] - byCanal[a]);
    upsertChart("canal", document.getElementById("chart-canal"), {
      type: "bar",
      data: { labels: canalKeys, datasets: [{ data: canalKeys.map((c) => byCanal[c]), backgroundColor: CHART_COLORS.accent, borderRadius: 4 }] },
      options: baseOpts({}, true),
    });

    // Chart 4 : tickets en retard par catégorie
    const retardCat = {};
    SUPPORT_META.categories.forEach((c) => (retardCat[c] = 0));
    rows.filter((r) => r.statut === "En retard").forEach((r) => { retardCat[r.categorie]++; });
    const catKeys = Object.keys(retardCat).sort((a, b) => retardCat[b] - retardCat[a]);
    upsertChart("retardCat", document.getElementById("chart-retard-cat"), {
      type: "bar",
      data: { labels: catKeys, datasets: [{ data: catKeys.map((c) => retardCat[c]), backgroundColor: CHART_COLORS.bad, borderRadius: 4 }] },
      options: baseOpts({}, true),
    });

    // Chart 5 : statut
    const byStatut = {};
    SUPPORT_META.statuts.forEach((s) => (byStatut[s] = 0));
    rows.forEach((r) => { byStatut[r.statut]++; });
    upsertChart("statut", document.getElementById("chart-statut"), {
      type: "doughnut",
      data: { labels: Object.keys(byStatut), datasets: [{ data: Object.values(byStatut), backgroundColor: [CHART_COLORS.good, CHART_COLORS.warn, CHART_COLORS.bad], borderWidth: 0 }] },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } } },
    });

    renderInsights({ rows, nb, late, rate, avgTemps, catAllKeys, byCat, topCanal: Object.entries(byCanal).sort((a, b) => b[1] - a[1]).filter((c) => c[1] > 0), retardCat, catKeys });

    // Table
    const sorted = [...rows].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (typeof av === "string") return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    page = Math.min(page, totalPages);
    const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    document.getElementById("table-body").innerHTML = pageRows.map((r) => `
      <tr>
        <td>${r.id}</td>
        <td>${fmtDate(r.date)}</td>
        <td>${r.categorie}</td>
        <td>${r.priorite}</td>
        <td>${r.canal}</td>
        <td><span class="status-pill ${statutClass[r.statut]}">${r.statut}</span></td>
        <td>${r.tempsResolutionH != null ? fmtNum(r.tempsResolutionH, 1) : "—"}</td>
        <td>${r.satisfaction != null ? fmtNum(r.satisfaction, 0) + " %" : "—"}</td>
      </tr>`).join("");

    document.getElementById("pager-info").textContent = `${sorted.length} ticket(s) — page ${page} / ${totalPages}`;
    document.getElementById("pager-prev").disabled = page <= 1;
    document.getElementById("pager-next").disabled = page >= totalPages;

    document.querySelectorAll("#table th").forEach((th) => {
      th.querySelector(".arrow")?.remove();
      if (th.dataset.key === sortKey) {
        const arrow = document.createElement("span");
        arrow.className = "arrow";
        arrow.textContent = sortDir === 1 ? "↑" : "↓";
        th.appendChild(arrow);
      }
    });
  }

  function baseOpts(overrides, horizontal) {
    return {
      indexAxis: horizontal ? "y" : "x",
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { font: { size: 10.5 } } },
        y: { grid: { color: CHART_COLORS.grid }, ticks: { font: { size: 10.5 } }, ...(overrides.y || {}) },
      },
      maintainAspectRatio: false,
    };
  }
  function palette(n) {
    const base = [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent3, CHART_COLORS.good, CHART_COLORS.warn, CHART_COLORS.bad, "#f472b6", "#818cf8"];
    return Array.from({ length: n }, (_, i) => base[i % base.length]);
  }

  [els.categorie, els.priorite, els.statut, els.canal, els.du, els.au].forEach((el) => el.addEventListener("change", () => { page = 1; render(); }));
  els.reset.addEventListener("click", () => {
    els.categorie.value = ""; els.priorite.value = ""; els.statut.value = ""; els.canal.value = "";
    els.du.value = monthsSet[0]; els.au.value = monthsSet[monthsSet.length - 1];
    page = 1; render();
  });
  document.getElementById("pager-prev").addEventListener("click", () => { page--; render(); });
  document.getElementById("pager-next").addEventListener("click", () => { page++; render(); });
  document.querySelectorAll("#table th").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
    render();
  }));

  document.addEventListener("languagechange", render);
  document.addEventListener("DOMContentLoaded", render);
  if (document.readyState !== "loading") render();
})();
