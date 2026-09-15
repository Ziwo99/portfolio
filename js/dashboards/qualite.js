(function () {
  chartDefaults();

  const els = {
    zBtn: document.getElementById("btn-zscore"),
    iqrBtn: document.getElementById("btn-iqr"),
    threshold: document.getElementById("f-threshold"),
    thresholdValue: document.getElementById("threshold-value"),
    reset: document.getElementById("reset-filters"),
  };

  const montants = QUALITE_DATA.map((r) => r.montant);
  const delais = QUALITE_DATA.map((r) => r.delai);

  function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
  function std(a, m) { return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); }
  function quartiles(a) {
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => {
      const idx = (s.length - 1) * p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return s[lo] + (s[hi] - s[lo]) * (idx - lo);
    };
    return { q1: q(0.25), q3: q(0.75) };
  }

  const statsX = { mean: mean(montants), std: std(montants, mean(montants)), ...quartiles(montants) };
  const statsY = { mean: mean(delais), std: std(delais, mean(delais)), ...quartiles(delais) };
  statsX.iqr = statsX.q3 - statsX.q1;
  statsY.iqr = statsY.q3 - statsY.q1;

  let method = "zscore";

  function classify(threshold) {
    return QUALITE_DATA.map((r) => {
      let score, anomaly;
      if (method === "zscore") {
        const zx = (r.montant - statsX.mean) / statsX.std;
        const zy = (r.delai - statsY.mean) / statsY.std;
        score = Math.sqrt(zx * zx + zy * zy);
        anomaly = score > threshold;
      } else {
        const lowX = statsX.q1 - threshold * statsX.iqr, highX = statsX.q3 + threshold * statsX.iqr;
        const lowY = statsY.q1 - threshold * statsY.iqr, highY = statsY.q3 + threshold * statsY.iqr;
        const devX = r.montant < lowX ? (lowX - r.montant) / statsX.iqr : r.montant > highX ? (r.montant - highX) / statsX.iqr : 0;
        const devY = r.delai < lowY ? (lowY - r.delai) / statsY.iqr : r.delai > highY ? (r.delai - highY) / statsY.iqr : 0;
        score = Math.max(devX, devY);
        anomaly = score > 0;
      }
      return { ...r, score, anomaly };
    });
  }

  let sortKey = "score", sortDir = -1, page = 1;
  const PAGE_SIZE = 12;
  let scatterChart = null;

  function renderInsights(ctx) {
    const el = document.getElementById("insight-list");
    if (!el) return;
    const items = [];
    const { rows, anomalies, threshold } = ctx;

    items.push(`<b>${anomalies.length}</b> anomalie(s) détectée(s) sur ${rows.length} transactions (<b>${fmtNum((anomalies.length / rows.length) * 100, 1)}%</b>) avec la méthode <b>${method === "zscore" ? "Score Z" : "IQR"}</b> (seuil = ${threshold.toFixed(1)}).`);

    if (anomalies.length) {
      const byFourn = {};
      anomalies.forEach((a) => { byFourn[a.fournisseur] = (byFourn[a.fournisseur] || 0) + 1; });
      const topFourn = Object.entries(byFourn).sort((a, b) => b[1] - a[1])[0];
      if (topFourn) items.push(`Le fournisseur le plus représenté parmi les anomalies est <b>${topFourn[0]}</b> (${topFourn[1]} occurrence(s)).`);

      const worst = [...anomalies].sort((a, b) => b.score - a.score)[0];
      items.push(`L'anomalie la plus marquée concerne la transaction <b>${worst.id}</b> (${fmtCHF(worst.montant)}, ${fmtNum(worst.delai, 1)} j, score ${worst.score.toFixed(2)}).`);
    }

    const lowerCount = classify(Math.max(els.threshold.min, threshold - 0.5)).filter((r) => r.anomaly).length;
    const higherCount = classify(threshold + 0.5).filter((r) => r.anomaly).length;
    items.push(`Analyse de sensibilité : abaisser le seuil de 0.5 ferait passer le nombre d'anomalies à <b>${lowerCount}</b>, l'augmenter de 0.5 le ferait passer à <b>${higherCount}</b> (actuellement ${anomalies.length}).`);

    el.innerHTML = items.map((t) => `<div class="insight-item"><span class="bullet">→</span><span>${t}</span></div>`).join("");
  }

  function render() {
    const threshold = parseFloat(els.threshold.value);
    els.thresholdValue.textContent = threshold.toFixed(1);
    const rows = classify(threshold);
    const anomalies = rows.filter((r) => r.anomaly);

    document.getElementById("kpi-total").textContent = fmtNum(rows.length);
    document.getElementById("kpi-anom").textContent = fmtNum(anomalies.length);
    document.getElementById("kpi-rate").textContent = fmtNum((anomalies.length / rows.length) * 100, 1) + " %";
    document.getElementById("kpi-method").textContent = method === "zscore" ? "Score Z" : "IQR";

    renderInsights({ rows, anomalies, threshold });

    const normalPts = rows.filter((r) => !r.anomaly).map((r) => ({ x: r.montant, y: r.delai }));
    const anomPts = anomalies.map((r) => ({ x: r.montant, y: r.delai }));

    if (scatterChart) scatterChart.destroy();
    scatterChart = new Chart(document.getElementById("chart-scatter"), {
      type: "scatter",
      data: {
        datasets: [
          { label: "Transactions normales", data: normalPts, backgroundColor: "rgba(124,140,255,.45)", pointRadius: 4 },
          { label: "Anomalies", data: anomPts, backgroundColor: CHART_COLORS.bad, pointRadius: 6, pointHoverRadius: 8 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { boxWidth: 10, font: { size: 11.5 } } },
          tooltip: { callbacks: { label: (ctx) => `Montant: ${fmtCHF(ctx.raw.x)} · Délai: ${fmtNum(ctx.raw.y, 1)} j` } },
        },
        scales: {
          x: { title: { display: true, text: "Montant (CHF)", color: CHART_COLORS.text, font: { size: 11.5 } }, grid: { color: CHART_COLORS.grid } },
          y: { title: { display: true, text: "Délai de traitement (jours)", color: CHART_COLORS.text, font: { size: 11.5 } }, grid: { color: CHART_COLORS.grid } },
        },
      },
    });

    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
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
        <td>${r.fournisseur}</td>
        <td>${fmtCHF(r.montant)}</td>
        <td>${fmtNum(r.delai, 1)}</td>
        <td>${r.anomaly ? `<span class="status-pill anom-pill">⚠ ${r.score.toFixed(2)}</span>` : r.score.toFixed(2)}</td>
      </tr>`).join("");

    document.getElementById("pager-info").textContent = `${sorted.length} transaction(s) — page ${page} / ${totalPages}`;
    document.getElementById("pager-prev").disabled = page <= 1;
    document.getElementById("pager-next").disabled = page >= totalPages;

    document.querySelectorAll("#table th").forEach((th) => {
      th.querySelector(".arrow")?.remove();
      if (th.dataset.key === sortKey) {
        const arrow = document.createElement("span");
        arrow.className = "arrow"; arrow.textContent = sortDir === 1 ? "↑" : "↓";
        th.appendChild(arrow);
      }
    });
  }

  function setMethod(m) {
    method = m;
    els.zBtn.classList.toggle("active", m === "zscore");
    els.iqrBtn.classList.toggle("active", m === "iqr");
    if (m === "zscore") { els.threshold.min = 1.2; els.threshold.max = 4; els.threshold.step = 0.1; els.threshold.value = 2.5; }
    else { els.threshold.min = 0.3; els.threshold.max = 3; els.threshold.step = 0.1; els.threshold.value = 1.5; }
    page = 1;
    render();
  }

  els.zBtn.addEventListener("click", () => setMethod("zscore"));
  els.iqrBtn.addEventListener("click", () => setMethod("iqr"));
  els.threshold.addEventListener("input", () => { page = 1; render(); });
  els.reset.addEventListener("click", () => setMethod("zscore"));
  document.getElementById("pager-prev").addEventListener("click", () => { page--; render(); });
  document.getElementById("pager-next").addEventListener("click", () => { page++; render(); });
  document.querySelectorAll("#table th").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
    render();
  }));

  document.addEventListener("languagechange", render);
  render();
})();
