(function () {
  chartDefaults();

  const els = {
    centre: document.getElementById("f-centre"),
    categorie: document.getElementById("f-categorie"),
    statut: document.getElementById("f-statut"),
    fournisseur: document.getElementById("f-fournisseur"),
    du: document.getElementById("f-du"),
    au: document.getElementById("f-au"),
    reset: document.getElementById("reset-filters"),
  };

  // ---- Populate filter options ----
  const monthsSet = [...new Set(ACHATS_DATA.map((r) => r.date.slice(0, 7)))].sort();
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
  fillSelect(els.centre, ACHATS_META.centres);
  fillSelect(els.categorie, ACHATS_META.categories);
  fillSelect(els.statut, ACHATS_META.statuts);
  fillSelect(els.du, monthsSet, monthLabel);
  fillSelect(els.au, monthsSet, monthLabel);
  els.du.value = monthsSet[0];
  els.au.value = monthsSet[monthsSet.length - 1];

  // ---- Sort / pagination state ----
  let sortKey = "date";
  let sortDir = -1;
  let page = 1;
  const PAGE_SIZE = 12;

  function getFiltered() {
    const centre = els.centre.value;
    const categorie = els.categorie.value;
    const statut = els.statut.value;
    const search = els.fournisseur.value.trim().toLowerCase();
    const du = els.du.value;
    const au = els.au.value;
    return ACHATS_DATA.filter((r) => {
      const m = r.date.slice(0, 7);
      if (centre && r.centre !== centre) return false;
      if (categorie && r.categorie !== categorie) return false;
      if (statut && r.statut !== statut) return false;
      if (search && !r.fournisseur.toLowerCase().includes(search)) return false;
      if (m < du || m > au) return false;
      return true;
    });
  }

  const statutClass = { Payee: "ok", "En attente": "wait", "En retard": "late" };
  const statutLabel = { Payee: "Payée", "En attente": "En attente", "En retard": "En retard" };

  const GLOBAL_DELAYS = ACHATS_DATA.filter((r) => r.delaiPaiement != null).map((r) => r.delaiPaiement);
  const GLOBAL_AVG_DELAY = GLOBAL_DELAYS.reduce((a, b) => a + b, 0) / GLOBAL_DELAYS.length;

  function renderInsights(ctx) {
    const el = document.getElementById("insight-list");
    if (!el) return;
    const items = [];

    if (ctx.nb === 0) {
      items.push("Aucune facture ne correspond aux filtres actifs — élargissez la période ou réinitialisez les filtres.");
    } else {
      if (ctx.topFourn.length) {
        const [nom, montant] = ctx.topFourn[0];
        const pct = (montant / ctx.total) * 100;
        items.push(`<b>${nom}</b> est le premier fournisseur en volume sur la sélection : <b>${fmtCHF(montant)}</b>, soit <b>${fmtNum(pct, 1)}%</b> du montant total filtré.`);
      }
      if (ctx.late > 0) {
        const topCentre = ctx.centreKeys.find((c) => ctx.retardCentre[c] > 0);
        const montantRetard = ctx.rows.filter((r) => r.statut === "En retard").reduce((s, r) => s + r.montant, 0);
        items.push(`<b>${ctx.late}</b> facture(s) en retard (${fmtNum(ctx.rate, 1)}%), représentant <b>${fmtCHF(montantRetard)}</b>${topCentre ? ` — le centre le plus touché est <b>${topCentre}</b> (${ctx.retardCentre[topCentre]} facture(s))` : ""}.`);
      } else {
        items.push("Aucune facture en retard sur la sélection actuelle : la situation est saine sur ce périmètre.");
      }
      if (ctx.catKeys.length) {
        const topCat = ctx.catKeys[0];
        const pct = (ctx.byCat[topCat] / ctx.total) * 100;
        items.push(`La catégorie <b>${topCat}</b> concentre <b>${fmtNum(pct, 1)}%</b> des dépenses filtrées (${fmtCHF(ctx.byCat[topCat])}).`);
      }
      if (ctx.avgDelay > 0) {
        const diff = ctx.avgDelay - GLOBAL_AVG_DELAY;
        const compare = Math.abs(diff) < 1 ? "proche de la moyenne globale" : diff > 0 ? `<b>${fmtNum(diff, 0)} jours au-dessus</b> de la moyenne globale (${fmtNum(GLOBAL_AVG_DELAY, 0)} j)` : `<b>${fmtNum(Math.abs(diff), 0)} jours en-dessous</b> de la moyenne globale (${fmtNum(GLOBAL_AVG_DELAY, 0)} j)`;
        items.push(`Le délai moyen de paiement observé (${fmtNum(ctx.avgDelay, 0)} j) est ${compare}.`);
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

    // KPIs
    const total = rows.reduce((s, r) => s + r.montant, 0);
    const nb = rows.length;
    const late = rows.filter((r) => r.statut === "En retard").length;
    const rate = nb ? (late / nb) * 100 : 0;
    const delays = rows.filter((r) => r.delaiPaiement != null).map((r) => r.delaiPaiement);
    const avgDelay = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;

    document.getElementById("kpi-montant").textContent = fmtCHF(total);
    document.getElementById("kpi-nb").textContent = fmtNum(nb);
    document.getElementById("kpi-retard").textContent = fmtNum(rate, 1) + " %";
    document.getElementById("kpi-delai").textContent = fmtNum(avgDelay, 0) + " j";

    // Chart 1 : évolution mensuelle
    const byMonth = {};
    rows.forEach((r) => {
      const m = r.date.slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + r.montant;
    });
    const monthKeys = Object.keys(byMonth).sort();
    upsertChart("evolution", document.getElementById("chart-evolution"), {
      type: "line",
      data: {
        labels: monthKeys.map(monthLabel),
        datasets: [{
          label: "Montant (CHF)",
          data: monthKeys.map((m) => byMonth[m]),
          borderColor: CHART_COLORS.accent2,
          backgroundColor: "rgba(34,211,238,.12)",
          fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
        }],
      },
      options: baseOpts({ y: { ticks: { callback: (v) => fmtNum(v / 1000) + "k" } } }),
    });

    // Chart 2 : catégories (doughnut)
    const byCat = {};
    rows.forEach((r) => { byCat[r.categorie] = (byCat[r.categorie] || 0) + r.montant; });
    const catKeys = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    upsertChart("categorie", document.getElementById("chart-categorie"), {
      type: "doughnut",
      data: {
        labels: catKeys,
        datasets: [{ data: catKeys.map((k) => byCat[k]), backgroundColor: palette(catKeys.length), borderWidth: 0 }],
      },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } } },
    });

    // Chart 3 : top fournisseurs
    const byFourn = {};
    rows.forEach((r) => { byFourn[r.fournisseur] = (byFourn[r.fournisseur] || 0) + r.montant; });
    const topFourn = Object.entries(byFourn).sort((a, b) => b[1] - a[1]).slice(0, 10);
    upsertChart("fournisseurs", document.getElementById("chart-fournisseurs"), {
      type: "bar",
      data: {
        labels: topFourn.map((f) => f[0]),
        datasets: [{ data: topFourn.map((f) => f[1]), backgroundColor: CHART_COLORS.accent, borderRadius: 4 }],
      },
      options: baseOpts({}, true),
    });

    // Chart 4 : retard par centre
    const retardCentre = {};
    ACHATS_META.centres.forEach((c) => (retardCentre[c] = 0));
    rows.filter((r) => r.statut === "En retard").forEach((r) => { retardCentre[r.centre]++; });
    const centreKeys = Object.keys(retardCentre).sort((a, b) => retardCentre[b] - retardCentre[a]);
    upsertChart("retardCentre", document.getElementById("chart-retard-centre"), {
      type: "bar",
      data: { labels: centreKeys, datasets: [{ data: centreKeys.map((c) => retardCentre[c]), backgroundColor: CHART_COLORS.bad, borderRadius: 4 }] },
      options: baseOpts({}, true),
    });

    // Chart 5 : statut
    const byStatut = {};
    ACHATS_META.statuts.forEach((s) => (byStatut[s] = 0));
    rows.forEach((r) => { byStatut[r.statut]++; });
    upsertChart("statut", document.getElementById("chart-statut"), {
      type: "doughnut",
      data: {
        labels: Object.keys(byStatut).map((s) => statutLabel[s]),
        datasets: [{ data: Object.values(byStatut), backgroundColor: [CHART_COLORS.good, CHART_COLORS.warn, CHART_COLORS.bad], borderWidth: 0 }],
      },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } } },
    });

    renderInsights({ rows, total, nb, late, rate, avgDelay, catKeys, byCat, topFourn, byFourn, retardCentre, centreKeys });

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
        <td>${r.centre}</td>
        <td>${r.categorie}</td>
        <td>${r.fournisseur}</td>
        <td>${fmtCHF(r.montant)}</td>
        <td><span class="status-pill ${statutClass[r.statut]}">${statutLabel[r.statut]}</span></td>
        <td>${r.delaiPaiement ?? "—"}</td>
      </tr>`).join("");

    document.getElementById("pager-info").textContent =
      `${sorted.length} facture(s) — page ${page} / ${totalPages}`;
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

  [els.centre, els.categorie, els.statut, els.du, els.au].forEach((el) => el.addEventListener("change", () => { page = 1; render(); }));
  els.fournisseur.addEventListener("input", () => { page = 1; render(); });
  els.reset.addEventListener("click", () => {
    els.centre.value = ""; els.categorie.value = ""; els.statut.value = ""; els.fournisseur.value = "";
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
