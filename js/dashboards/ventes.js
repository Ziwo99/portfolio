(function () {
  chartDefaults();

  const els = {
    metric: document.getElementById("f-metric"),
    type: document.getElementById("f-type"),
    du: document.getElementById("f-du"),
    au: document.getElementById("f-au"),
    reset: document.getElementById("reset-filters"),
    toggles: document.getElementById("centre-toggles"),
  };

  const METRICS = {
    commandes: { label: "Commandes", agg: "sum", fmt: (v) => fmtNum(v), unit: "" },
    chiffreAffaires: { label: "Chiffre d'affaires", agg: "sum", fmt: (v) => fmtCHF(v), unit: "" },
    panierMoyen: { label: "Panier moyen", agg: "avg", fmt: (v) => fmtCHF(v), unit: "" },
    tauxRetour: { label: "Taux de retour", agg: "avg", fmt: (v) => fmtNum(v, 1) + " %", unit: " %" },
  };

  const monthLabel = (m) => {
    const [y, mo] = m.split("-");
    return new Date(y, mo - 1, 1).toLocaleDateString(window.portfolioLocale(), { month: "short", year: "numeric" });
  };
  function fillSelect(el, values, labelFn) {
    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = labelFn ? labelFn(v) : v;
      el.appendChild(opt);
    });
  }
  fillSelect(els.du, VENTES_META.mois, monthLabel);
  fillSelect(els.au, VENTES_META.mois, monthLabel);
  els.du.value = VENTES_META.mois[0];
  els.au.value = VENTES_META.mois[VENTES_META.mois.length - 1];

  let selected = new Set(VENTES_META.pointsVente);

  // ---- Sort / pagination state (table) ----
  let sortKey = "mois";
  let sortDir = -1;
  let page = 1;
  const PAGE_SIZE = 12;

  function renderToggles() {
    const type = els.type.value;
    const visible = VENTES_META.pointsVente.filter((c) => !type || (VENTES_META[type === "Boutique" ? "boutiques" : "enLigne"].includes(c)));
    els.toggles.innerHTML = visible.map((c) =>
      `<button data-centre="${c}" class="${selected.has(c) ? "active" : ""}">${c}</button>`
    ).join("");
    els.toggles.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = btn.dataset.centre;
        if (selected.has(c)) selected.delete(c); else selected.add(c);
        btn.classList.toggle("active");
        page = 1;
        render();
      });
    });
  }

  function currentPointsVente() {
    const type = els.type.value;
    const inType = (c) => !type || VENTES_META[type === "Boutique" ? "boutiques" : "enLigne"].includes(c);
    return [...selected].filter(inType);
  }

  let charts = {};
  function upsertChart(key, ctx, config) {
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart(ctx, config);
  }

  function aggregate(rows, key, mode) {
    if (!rows.length) return 0;
    const sum = rows.reduce((s, r) => s + r[key], 0);
    return mode === "sum" ? sum : sum / rows.length;
  }

  function render() {
    const pointsVente = currentPointsVente();
    const du = els.du.value, au = els.au.value;
    const rows = VENTES_DATA.filter((r) => pointsVente.includes(r.pointVente) && r.mois >= du && r.mois <= au);

    document.getElementById("kpi-commandes").textContent = fmtNum(aggregate(rows, "commandes", "sum"));
    document.getElementById("kpi-ca").textContent = fmtCHF(aggregate(rows, "chiffreAffaires", "sum"));
    document.getElementById("kpi-panier").textContent = fmtCHF(aggregate(rows, "panierMoyen", "avg"));
    document.getElementById("kpi-retour").textContent = fmtNum(aggregate(rows, "tauxRetour", "avg"), 1) + " %";

    const metricKey = els.metric.value;
    const metric = METRICS[metricKey];
    document.getElementById("chart-evolution-title").textContent = "Évolution mensuelle — " + metric.label;
    document.getElementById("chart-compare-title").textContent = "Comparaison par point de vente — " + metric.label;

    // Evolution chart (+ projection lineaire a 2 mois)
    const byMonth = {};
    rows.forEach((r) => { (byMonth[r.mois] = byMonth[r.mois] || []).push(r); });
    const monthKeys = Object.keys(byMonth).sort();
    const series = monthKeys.map((m) => aggregate(byMonth[m], metricKey, metric.agg));

    let forecast = null;
    if (monthKeys.length >= 4) {
      const n = series.length;
      const tMean = (n - 1) / 2;
      const yMean = series.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      series.forEach((y, t) => { num += (t - tMean) * (y - yMean); den += (t - tMean) ** 2; });
      const slope = den ? num / den : 0;
      const intercept = yMean - slope * tMean;
      const futureMonths = nextMonths(monthKeys[monthKeys.length - 1], 2);
      const futureValues = [n, n + 1].map((t) => Math.max(0, slope * t + intercept));
      forecast = { slope, futureMonths, futureValues };
    }

    const forecastLabels = forecast ? forecast.futureMonths.map(monthLabel) : [];
    const realData = [...series, ...forecastLabels.map(() => null)];
    const projData = forecast
      ? [...series.map(() => null).slice(0, -1), series[series.length - 1], ...forecast.futureValues]
      : [];

    upsertChart("evolution", document.getElementById("chart-evolution"), {
      type: "line",
      data: {
        labels: [...monthKeys.map(monthLabel), ...forecastLabels],
        datasets: [
          {
            label: "Réel", data: realData,
            borderColor: CHART_COLORS.accent2, backgroundColor: "rgba(34,211,238,.12)",
            fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
          },
          {
            label: "Projection", data: projData,
            borderColor: CHART_COLORS.accent3, borderDash: [6, 5], backgroundColor: "transparent",
            fill: false, tension: 0.2, pointRadius: 2, borderWidth: 2,
          },
        ],
      },
      options: { plugins: { legend: { display: !!forecast, position: "top", labels: { boxWidth: 10, font: { size: 11 } } } }, maintainAspectRatio: false,
        scales: { x: { grid: { color: CHART_COLORS.grid } }, y: { grid: { color: CHART_COLORS.grid } } } },
    });

    // Compare by point de vente
    const byPV = {};
    rows.forEach((r) => { (byPV[r.pointVente] = byPV[r.pointVente] || []).push(r); });
    const pvKeys = pointsVente.filter((c) => byPV[c]).sort((a, b) =>
      aggregate(byPV[b], metricKey, metric.agg) - aggregate(byPV[a], metricKey, metric.agg));
    upsertChart("compare", document.getElementById("chart-compare"), {
      type: "bar",
      data: {
        labels: pvKeys,
        datasets: [{ data: pvKeys.map((c) => aggregate(byPV[c], metricKey, metric.agg)), backgroundColor: CHART_COLORS.accent, borderRadius: 4 }],
      },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, maintainAspectRatio: false,
        scales: { x: { grid: { color: CHART_COLORS.grid } }, y: { grid: { color: CHART_COLORS.grid }, ticks: { font: { size: 10.5 } } } } },
    });

    renderInsights({ rows, pointsVente, pvKeys, byPV, metric, metricKey, forecast });
    renderHeatmap(pointsVente);

    // Table
    const sorted = [...rows].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string") return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    page = Math.min(page, totalPages);
    const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    document.getElementById("table-body").innerHTML = pageRows.map((r) => `
      <tr>
        <td>${r.pointVente}</td>
        <td>${monthLabel(r.mois)}</td>
        <td>${r.type}</td>
        <td>${fmtNum(r.commandes)}</td>
        <td>${fmtCHF(r.chiffreAffaires)}</td>
        <td>${fmtCHF(r.panierMoyen)}</td>
        <td>${fmtNum(r.tauxRetour, 1)} %</td>
      </tr>`).join("");

    document.getElementById("pager-info").textContent =
      `${sorted.length} ligne(s) — page ${page} / ${totalPages}`;
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

  function nextMonths(lastKey, n) {
    const [y, m] = lastKey.split("-").map(Number);
    const out = [];
    let year = y, month = m;
    for (let i = 0; i < n; i++) {
      month++;
      if (month > 12) { month = 1; year++; }
      out.push(`${year}-${String(month).padStart(2, "0")}`);
    }
    return out;
  }

  function renderInsights(ctx) {
    const el = document.getElementById("insight-list");
    if (!el) return;
    const items = [];

    if (!ctx.rows.length) {
      items.push("Aucune donnée pour cette combinaison de filtres.");
      el.innerHTML = items.map((t) => `<div class="insight-item"><span class="bullet">→</span><span>${t}</span></div>`).join("");
      return;
    }

    const bestPanier = [...ctx.pvKeys].sort((a, b) => aggregate(ctx.byPV[b], "panierMoyen", "avg") - aggregate(ctx.byPV[a], "panierMoyen", "avg"))[0];
    if (bestPanier) {
      items.push(`<b>${bestPanier}</b> affiche le panier moyen le plus élevé sur la période (<b>${fmtCHF(aggregate(ctx.byPV[bestPanier], "panierMoyen", "avg"))}</b>).`);
    }

    const worstRetour = [...ctx.pvKeys].sort((a, b) => aggregate(ctx.byPV[b], "tauxRetour", "avg") - aggregate(ctx.byPV[a], "tauxRetour", "avg"))[0];
    if (worstRetour) {
      items.push(`Le taux de retour le plus élevé est observé chez <b>${worstRetour}</b> (<b>${fmtNum(aggregate(ctx.byPV[worstRetour], "tauxRetour", "avg"), 1)}%</b>).`);
    }

    const byMonthAll = {};
    ctx.rows.forEach((r) => { (byMonthAll[r.mois] = byMonthAll[r.mois] || []).push(r); });
    const mk = Object.keys(byMonthAll).sort();
    if (mk.length >= 2) {
      const first = aggregate(byMonthAll[mk[0]], ctx.metricKey, ctx.metric.agg);
      const last = aggregate(byMonthAll[mk[mk.length - 1]], ctx.metricKey, ctx.metric.agg);
      const pct = first ? ((last - first) / first) * 100 : 0;
      const sens = pct >= 0 ? "augmenté" : "diminué";
      items.push(`« ${ctx.metric.label} » a <b>${sens} de ${fmtNum(Math.abs(pct), 1)}%</b> entre ${monthLabel(mk[0])} et ${monthLabel(mk[mk.length - 1])} sur les points de vente sélectionnés.`);
    }

    if (ctx.forecast) {
      const trend = ctx.forecast.slope >= 0 ? "hausse" : "baisse";
      items.push(`Projection (régression linéaire) : à tendance constante, « ${ctx.metric.label} » évoluerait en <b>${trend}</b> pour atteindre environ <b>${ctx.metric.fmt(ctx.forecast.futureValues[1])}</b> d'ici deux mois.`);
    }

    el.innerHTML = items.map((t) => `<div class="insight-item"><span class="bullet">→</span><span>${t}</span></div>`).join("");
  }

  function renderHeatmap(pointsVente) {
    const data = VENTES_HEATMAP.filter((h) => pointsVente.includes(h.pointVente));
    const grid = {};
    VENTES_META.jours.forEach((j) => { grid[j] = {}; VENTES_META.heures.forEach((h) => (grid[j][h] = [])); });
    data.forEach((d) => grid[d.jour][d.heure].push(d.activite));
    let max = 1;
    VENTES_META.jours.forEach((j) => VENTES_META.heures.forEach((h) => {
      const arr = grid[j][h];
      const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      grid[j][h] = avg;
      if (avg > max) max = avg;
    }));

    const el = document.getElementById("heatmap");
    let html = `<div></div>` + VENTES_META.heures.map((h) => `<div class="hhead">${h}h</div>`).join("");
    VENTES_META.jours.forEach((j) => {
      html += `<div class="hlabel">${j.slice(0, 3)}</div>`;
      VENTES_META.heures.forEach((h) => {
        const v = grid[j][h];
        const ratio = max ? v / max : 0;
        const bg = `rgba(124,140,255,${(0.08 + ratio * 0.82).toFixed(2)})`;
        html += `<div class="hcell" style="background:${bg}" title="${j} ${h}h — ${v.toFixed(1)}">${Math.round(v)}</div>`;
      });
    });
    el.innerHTML = html;
  }

  els.type.addEventListener("change", () => { page = 1; renderToggles(); render(); });
  [els.metric, els.du, els.au].forEach((e) => e.addEventListener("change", () => { page = 1; render(); }));
  els.reset.addEventListener("click", () => {
    els.metric.value = "commandes"; els.type.value = "";
    els.du.value = VENTES_META.mois[0]; els.au.value = VENTES_META.mois[VENTES_META.mois.length - 1];
    selected = new Set(VENTES_META.pointsVente);
    page = 1;
    renderToggles(); render();
  });
  document.getElementById("pager-prev").addEventListener("click", () => { page--; render(); });
  document.getElementById("pager-next").addEventListener("click", () => { page++; render(); });
  document.querySelectorAll("#table th").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
    render();
  }));

  renderToggles();
  document.addEventListener("languagechange", render);
  render();
})();
