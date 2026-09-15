(function () {
  chartDefaults();

  const els = {
    departement: document.getElementById("f-departement"),
    type: document.getElementById("f-type"),
    motif: document.getElementById("f-motif"),
    poste: document.getElementById("f-poste"),
    du: document.getElementById("f-du"),
    au: document.getElementById("f-au"),
    reset: document.getElementById("reset-filters"),
  };

  const monthsSet = [...new Set(RH_DATA.map((r) => r.date.slice(0, 7)))].sort();
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
  fillSelect(els.departement, RH_META.departements);
  fillSelect(els.type, RH_META.types);
  fillSelect(els.motif, RH_META.motifs);
  fillSelect(els.du, monthsSet, monthLabel);
  fillSelect(els.au, monthsSet, monthLabel);
  els.du.value = monthsSet[0];
  els.au.value = monthsSet[monthsSet.length - 1];

  let sortKey = "date";
  let sortDir = -1;
  let page = 1;
  const PAGE_SIZE = 12;

  function getFiltered() {
    const departement = els.departement.value;
    const type = els.type.value;
    const motif = els.motif.value;
    const search = els.poste.value.trim().toLowerCase();
    const du = els.du.value;
    const au = els.au.value;
    return RH_DATA.filter((r) => {
      const m = r.date.slice(0, 7);
      if (departement && r.departement !== departement) return false;
      if (type && r.type !== type) return false;
      if (motif && r.motif !== motif) return false;
      if (search && !r.poste.toLowerCase().includes(search)) return false;
      if (m < du || m > au) return false;
      return true;
    });
  }

  const typeClass = { "Embauche": "ok", "Départ": "late" };

  const GLOBAL_DEPARTS = RH_DATA.filter((r) => r.type === "Départ" && r.anciennete != null).map((r) => r.anciennete);
  const GLOBAL_AVG_ANCIENNETE = GLOBAL_DEPARTS.reduce((a, b) => a + b, 0) / GLOBAL_DEPARTS.length;

  function renderInsights(ctx) {
    const el = document.getElementById("insight-list");
    if (!el) return;
    const items = [];

    if (ctx.nb === 0) {
      items.push("Aucun mouvement ne correspond aux filtres actifs — élargissez la période ou réinitialisez les filtres.");
    } else {
      if (ctx.topDept.length) {
        const [nom, nbDeparts] = ctx.topDept[0];
        items.push(`<b>${nom}</b> concentre le plus de départs sur la sélection : <b>${fmtNum(nbDeparts)}</b> départ(s).`);
      }
      if (ctx.departs > 0) {
        items.push(`<b>${ctx.departs}</b> départ(s) sur la période (taux de turnover ≈ <b>${fmtNum(ctx.tauxTurnover, 1)}%</b> de l'effectif de référence), pour <b>${ctx.embauches}</b> embauche(s).`);
      } else {
        items.push("Aucun départ sur la sélection actuelle : la situation est saine sur ce périmètre.");
      }
      if (ctx.motifKeys.length) {
        const topMotif = ctx.motifKeys[0];
        const pct = (ctx.byMotif[topMotif] / ctx.departs) * 100;
        items.push(`Le motif <b>${topMotif}</b> représente <b>${fmtNum(pct, 1)}%</b> des départs filtrés (${ctx.byMotif[topMotif]} occurrence(s)).`);
      }
      if (ctx.avgAnciennete > 0) {
        const diff = ctx.avgAnciennete - GLOBAL_AVG_ANCIENNETE;
        const compare = Math.abs(diff) < 0.3 ? "proche de la moyenne globale" : diff > 0 ? `<b>${fmtNum(diff, 1)} an(s) au-dessus</b> de la moyenne globale (${fmtNum(GLOBAL_AVG_ANCIENNETE, 1)} ans)` : `<b>${fmtNum(Math.abs(diff), 1)} an(s) en-dessous</b> de la moyenne globale (${fmtNum(GLOBAL_AVG_ANCIENNETE, 1)} ans)`;
        items.push(`L'ancienneté moyenne au départ observée (${fmtNum(ctx.avgAnciennete, 1)} ans) est ${compare}.`);
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

    const embauches = rows.filter((r) => r.type === "Embauche").length;
    const departs = rows.filter((r) => r.type === "Départ").length;
    const nb = rows.length;
    const tauxTurnover = (departs / RH_META.effectifReference) * 100;
    const anciennetes = rows.filter((r) => r.type === "Départ" && r.anciennete != null).map((r) => r.anciennete);
    const avgAnciennete = anciennetes.length ? anciennetes.reduce((a, b) => a + b, 0) / anciennetes.length : 0;

    document.getElementById("kpi-variation").textContent = (embauches - departs >= 0 ? "+" : "") + fmtNum(embauches - departs);
    document.getElementById("kpi-nb").textContent = fmtNum(nb);
    document.getElementById("kpi-turnover").textContent = fmtNum(tauxTurnover, 1) + " %";
    document.getElementById("kpi-anciennete").textContent = fmtNum(avgAnciennete, 1) + " ans";

    // Chart 1 : évolution mensuelle embauches vs départs
    const byMonthEmb = {}, byMonthDep = {};
    rows.forEach((r) => {
      const m = r.date.slice(0, 7);
      if (r.type === "Embauche") byMonthEmb[m] = (byMonthEmb[m] || 0) + 1;
      else byMonthDep[m] = (byMonthDep[m] || 0) + 1;
    });
    const monthKeys = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
    upsertChart("evolution", document.getElementById("chart-evolution"), {
      type: "line",
      data: {
        labels: monthKeys.map(monthLabel),
        datasets: [
          { label: "Embauches", data: monthKeys.map((m) => byMonthEmb[m] || 0), borderColor: CHART_COLORS.good, backgroundColor: "rgba(52,211,153,.12)", fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
          { label: "Départs", data: monthKeys.map((m) => byMonthDep[m] || 0), borderColor: CHART_COLORS.bad, backgroundColor: "rgba(248,113,113,.10)", fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: { plugins: { legend: { display: true, position: "top", labels: { boxWidth: 10, font: { size: 11 } } } }, maintainAspectRatio: false,
        scales: { x: { grid: { color: CHART_COLORS.grid }, ticks: { font: { size: 10.5 } } }, y: { grid: { color: CHART_COLORS.grid }, ticks: { font: { size: 10.5 } } } } },
    });

    // Chart 2 : répartition des départs par motif (doughnut)
    const byMotif = {};
    rows.filter((r) => r.type === "Départ").forEach((r) => { byMotif[r.motif] = (byMotif[r.motif] || 0) + 1; });
    const motifKeys = Object.keys(byMotif).sort((a, b) => byMotif[b] - byMotif[a]);
    upsertChart("motif", document.getElementById("chart-motif"), {
      type: "doughnut",
      data: { labels: motifKeys, datasets: [{ data: motifKeys.map((k) => byMotif[k]), backgroundColor: palette(motifKeys.length), borderWidth: 0 }] },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } } },
    });

    // Chart 3 : top départements par départs
    const byDeptDep = {};
    RH_META.departements.forEach((d) => (byDeptDep[d] = 0));
    rows.filter((r) => r.type === "Départ").forEach((r) => { byDeptDep[r.departement]++; });
    const topDept = Object.entries(byDeptDep).sort((a, b) => b[1] - a[1]);
    upsertChart("departements", document.getElementById("chart-departements"), {
      type: "bar",
      data: { labels: topDept.map((d) => d[0]), datasets: [{ data: topDept.map((d) => d[1]), backgroundColor: CHART_COLORS.bad, borderRadius: 4 }] },
      options: baseOpts({}, true),
    });

    // Chart 4 : ancienneté moyenne au départ par département
    const ancByDept = {};
    RH_META.departements.forEach((d) => (ancByDept[d] = []));
    rows.filter((r) => r.type === "Départ" && r.anciennete != null).forEach((r) => { ancByDept[r.departement].push(r.anciennete); });
    const ancKeys = RH_META.departements.filter((d) => ancByDept[d].length).sort((a, b) =>
      (ancByDept[b].reduce((s, v) => s + v, 0) / ancByDept[b].length) - (ancByDept[a].reduce((s, v) => s + v, 0) / ancByDept[a].length));
    upsertChart("anciennete", document.getElementById("chart-anciennete"), {
      type: "bar",
      data: { labels: ancKeys, datasets: [{ data: ancKeys.map((d) => ancByDept[d].reduce((s, v) => s + v, 0) / ancByDept[d].length), backgroundColor: CHART_COLORS.accent, borderRadius: 4 }] },
      options: baseOpts({}, true),
    });

    // Chart 5 : répartition embauches / départs
    upsertChart("type", document.getElementById("chart-type"), {
      type: "doughnut",
      data: { labels: ["Embauches", "Départs"], datasets: [{ data: [embauches, departs], backgroundColor: [CHART_COLORS.good, CHART_COLORS.bad], borderWidth: 0 }] },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } } },
    });

    renderInsights({ rows, nb, embauches, departs, tauxTurnover, avgAnciennete, byMotif, motifKeys, topDept: Object.entries(byDeptDep).sort((a, b) => b[1] - a[1]).filter((d) => d[1] > 0) });

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
        <td>${r.departement}</td>
        <td>${r.poste}</td>
        <td><span class="status-pill ${typeClass[r.type]}">${r.type}</span></td>
        <td>${r.motif}</td>
        <td>${r.anciennete != null ? fmtNum(r.anciennete, 1) : "—"}</td>
      </tr>`).join("");

    document.getElementById("pager-info").textContent = `${sorted.length} mouvement(s) — page ${page} / ${totalPages}`;
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

  [els.departement, els.type, els.motif, els.du, els.au].forEach((el) => el.addEventListener("change", () => { page = 1; render(); }));
  els.poste.addEventListener("input", () => { page = 1; render(); });
  els.reset.addEventListener("click", () => {
    els.departement.value = ""; els.type.value = ""; els.motif.value = ""; els.poste.value = "";
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
