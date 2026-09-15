// Rejeu du prototype du memoire : les agents LLM sont remplaces par des artefacts
// pre-enregistres (IA_DATASETS.artefacts) ; tout ce qui est marque [Systeme] est
// reellement calcule ici, dans le navigateur, sur l'echantillon synthetique.
(function () {
  chartDefaults();

  const els = {
    dataset: document.getElementById("f-dataset"),
    btnMulti: document.getElementById("btn-multi"),
    btnMono: document.getElementById("btn-mono"),
    run: document.getElementById("run-pipeline"),
    meta: document.getElementById("dataset-meta"),
    pipeline: document.getElementById("agent-pipeline"),
    chartsBox: document.getElementById("charts-box"),
    chartsGrid: document.getElementById("charts-grid"),
    rapportPanel: document.getElementById("rapport-panel"),
    rapportDetails: document.getElementById("rapport-panel").closest("details"),
    rapportList: document.getElementById("rapport-list"),
    rapportSub: document.getElementById("rapport-sub"),
  };

  let mode = "multi";
  let running = false;
  let charts = [];

  IA_DATASETS.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.nom} — ${d.domaine}`;
    els.dataset.appendChild(opt);
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const currentDataset = () => IA_DATASETS.find((d) => d.id === els.dataset.value);

  // ======================================================================
  // MODULE SYSTEME LOCAL DE CONFIANCE — seul bloc autorise a lire les donnees
  // ======================================================================
  const isMissing = (v) => v === null || v === undefined || v === "";
  const isNum = (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
  const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

  function detectType(values) {
    const present = values.filter((v) => !isMissing(v));
    if (!present.length) return "vide";
    const numFrac = present.filter(isNum).length / present.length;
    const dateFrac = present.filter(isDate).length / present.length;
    if (numFrac === 1) return "numérique";
    if (dateFrac === 1) return "date";
    if ((numFrac > 0 && numFrac < 1) || (dateFrac > 0 && dateFrac < 1)) return "mixte";
    const distinct = new Set(present).size;
    if (distinct === present.length && typeof present[0] === "string") return "identifiant";
    if (distinct <= 12) return "catégoriel";
    return "texte";
  }

  function extractMetadata(ds) {
    const meta = { source: ds.nom, extrait_par: "module_systeme", tables: {} };
    Object.entries(ds.tables).forEach(([name, rows]) => {
      const cols = Object.keys(rows[0]);
      meta.tables[name] = {
        n_lignes: rows.length, n_colonnes: cols.length,
        colonnes: cols.map((c) => {
          const values = rows.map((r) => r[c]);
          const present = values.filter((v) => !isMissing(v));
          const type = detectType(values);
          const col = { nom: c, type, completude_pct: round((present.length / rows.length) * 100, 1) };
          const sensible = ds.colonnes_sensibles.includes(c);
          if (type === "numérique") {
            const nums = present.map(Number);
            const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
            col.statistiques = sensible
              ? { moyenne: round(mean), ecart_type: round(Math.sqrt(nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length)), note: "min/max retenus — colonne sensible" }
              : { min: round(Math.min(...nums)), max: round(Math.max(...nums)), moyenne: round(mean) };
          } else if (type === "catégoriel") {
            const counts = {};
            present.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
            col.n_distinct = Object.keys(counts).length;
            if (!sensible) col.modalites = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]);
          } else if (type === "identifiant") {
            col.n_distinct = new Set(present).size;
          } else if (type === "mixte") {
            const bad = present.filter((v) => !isNum(v) && !isDate(v)).length;
            col.part_non_convertible_pct = round((bad / present.length) * 100, 1);
          }
          if (sensible) col.sensible = true;
          return col;
        }),
      };
    });
    return meta;
  }

  function deriveRow(row, derive) {
    const out = { ...row };
    Object.entries(derive || {}).forEach(([name, def]) => {
      if (def.date_diff_days) {
        const [a, b] = def.date_diff_days;
        out[name] = isDate(row[a]) && isDate(row[b]) ? (new Date(row[a]) - new Date(row[b])) / 86400000 : null;
      } else if (def.month_of) {
        out[name] = isDate(row[def.month_of]) ? row[def.month_of].slice(0, 7) : null;
      } else if (def.bins) {
        const [col, edges, labels] = def.bins;
        const v = Number(row[col]);
        let label = null;
        for (let i = 0; i < labels.length; i++) if (v >= edges[i] && v < edges[i + 1]) label = labels[i];
        out[name] = label;
      }
    });
    return out;
  }

  // Execution controlee : toute anomalie remonte comme un retour d'erreur au niveau
  // metadonnees (colonne + pourcentage), jamais comme une valeur brute.
  function executeQuery(ds, table, op, sort, limit) {
    let rows = ds.tables[table].map((r) => ({ ...r }));
    (op.joins || []).forEach((j) => {
      const idx = new Map(ds.tables[j.table].map((r) => [r[j.on], r]));
      rows = rows.map((r) => ({ ...r, ...(idx.get(r[j.on]) || {}) }));
    });
    if (op.derive) rows = rows.map((r) => deriveRow(r, op.derive));

    if (op.type === "completeness") {
      const cols = Object.keys(ds.tables[table][0]);
      return cols.map((c) => ({ groupe: c, valeur: round((rows.filter((r) => !isMissing(r[c])).length / rows.length) * 100, 1), n: rows.length }));
    }

    if (!(op.by in rows[0])) throw { code: "colonne_inconnue", colonne: op.by };
    if (op.agg !== "count") {
      if (!(op.metric in rows[0])) throw { code: "colonne_inconnue", colonne: op.metric };
      const invalid = rows.filter((r) => isMissing(r[op.metric]) || !isNum(r[op.metric]));
      if (invalid.length && !op.nettoyage) {
        const nonNum = invalid.filter((r) => !isMissing(r[op.metric])).length;
        throw { code: "valeurs_invalides", colonne: op.metric, pct: round((invalid.length / rows.length) * 100, 1),
          detail: nonNum ? "valeurs non convertibles en numérique" : "valeurs manquantes" };
      }
      rows = rows.filter((r) => !isMissing(r[op.metric]) && isNum(r[op.metric]));
    }

    const groups = new Map();
    rows.forEach((r) => {
      const key = isMissing(r[op.by]) ? "(manquant)" : String(r[op.by]);
      const g = groups.get(key) || { sum: 0, n: 0 };
      g.n++;
      if (op.agg !== "count") g.sum += Number(r[op.metric]);
      groups.set(key, g);
    });
    let result = [...groups.entries()].map(([groupe, g]) => ({
      groupe, n: g.n, valeur: op.agg === "count" ? g.n : op.agg === "sum" ? round(g.sum) : round(g.sum / g.n),
    }));
    if (sort === "desc") result.sort((a, b) => b.valeur - a.valeur);
    else if (sort === "key") {
      const labels = op.derive && Object.values(op.derive).find((d) => d.bins)?.bins[2];
      result.sort((a, b) => (labels ? labels.indexOf(a.groupe) - labels.indexOf(b.groupe) : a.groupe.localeCompare(b.groupe, "fr", { numeric: true })));
    } else result.sort((a, b) => b.n - a.n);
    if (limit) result = result.slice(0, limit);
    return result;
  }

  // Guardrail : validation + reprise controlee (3 tentatives max, comme le prototype).
  function runWithGuardrail(ds, q) {
    const attempts = q.tentatives || [q.op];
    const log = [];
    for (let i = 0; i < Math.min(attempts.length, 3); i++) {
      try {
        const result = executeQuery(ds, q.table, attempts[i], q.sort, q.limit);
        log.push({ tentative: i + 1, statut: "valide", n_lignes: result.length });
        return { ok: true, result, op: attempts[i], attempts: i + 1, log };
      } catch (e) {
        const feedback = e.code === "valeurs_invalides"
          ? `${e.colonne} : ${e.pct} % de ${e.detail}`
          : `colonne inconnue « ${e.colonne} »`;
        log.push({ tentative: i + 1, statut: "echec", retour_agent: feedback });
      }
    }
    return { ok: false, attempts: attempts.length, log };
  }

  // Metadonnees des sorties transmises a l'agent suivant : les groupes de moins de
  // 3 lignes sont masques (k-anonymat) — une moyenne sur 1 ligne serait une valeur brute.
  const K_MIN = 3;
  function outputMetadata(executions) {
    return {
      extrait_par: "module_systeme",
      regle: `groupes de moins de ${K_MIN} lignes exclus des statistiques transmises`,
      sorties: executions.filter((e) => e.ok).map((e) => {
        const kept = e.result.filter((r) => r.n >= K_MIN);
        const vals = kept.map((r) => r.valeur);
        const out = { requete: e.id, n_lignes: e.result.length, colonnes: ["groupe", "valeur", "n"], groupes_masques_k: e.result.length - kept.length };
        if (vals.length) out.valeur = { min: round(Math.min(...vals)), max: round(Math.max(...vals)), moyenne: round(vals.reduce((a, b) => a + b, 0) / vals.length) };
        return out;
      }),
    };
  }

  // Audit : chaque valeur brute a forte entropie (identifiants, nombres precis)
  // est recherchee dans tout ce que les agents ont vu ou produit. Les tokens
  // legitimement transmis dans raw_metadata.json sont exclus.
  function auditConfidentiality(ds, corpus, metadataStr) {
    const transmitted = new Set((metadataStr.match(/"[^"]*"|-?\d+(?:\.\d+)?/g) || []).map((t) => t.replace(/^"|"$/g, "")));
    const sigDigits = (s) => s.replace(/^-?0+\.?0*/, "").replace(".", "").length;
    const tested = new Set();
    Object.values(ds.tables).forEach((rows) => rows.forEach((r) => Object.values(r).forEach((v) => {
      if (isMissing(v)) return;
      const s = String(v);
      if (typeof v === "number") {
        if (Number.isInteger(v) ? Math.abs(v) < 100 : sigDigits(s) < 3) return;
      } else if (s.length < 4) return;
      if (transmitted.has(s)) return;
      tested.add(s);
    })));
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expositions = [];
    tested.forEach((s) => {
      const re = new RegExp(`(^|[^0-9A-Za-z_.])${esc(s)}([^0-9A-Za-z_.]|$)`);
      if (re.test(corpus)) expositions.push(s);
    });
    return { valeurs_brutes_testees: tested.size, expositions_detectees: expositions.length, expositions: expositions.slice(0, 5), verdict: expositions.length ? "FAIL" : "PASS" };
  }

  // ======================================================================
  // RENDU
  // ======================================================================
  function renderMeta(ds) {
    const sample = Object.entries(ds.tables).map(([t, rows]) => `${t} (${rows.length})`).join(", ");
    els.meta.innerHTML = `
      <span class="meta-chip"><b>${ds.source}</b> · ${ds.original.fichiers} fichier${ds.original.fichiers > 1 ? "s" : ""}</span>
      <span class="meta-chip">Original : ${fmtNum(ds.original.lignes)} lignes × ${ds.original.colonnes} colonnes</span>
      <span class="meta-chip">${ds.type_schema}</span>
      <span class="meta-chip">Échantillon synthétique : ${sample}</span>
      ${ds.sensible ? `<span class="meta-chip warn">Domaine sensible — colonnes protégées : ${ds.colonnes_sensibles.join(", ")}</span>` : ""}`;
  }

  function buildSteps() {
    const sys = (num, key, titre, role) => ({ num, key, zone: "system", titre, role });
    const agent = (num, key, titre, role) => ({ num, key, zone: "agent", titre, role });
    if (mode === "multi") return [
      sys(1, "import", "Import et validation des fichiers", "Lecture CSV/Excel, contrôle de format"),
      sys(2, "metadata", "Extraction des métadonnées des sources", "Structure, types, complétude, statistiques globales non sensibles"),
      agent(3, "schema", "Schema Interpreter", "Enrichit les métadonnées brutes d'une interprétation sémantique"),
      agent(4, "plan", "Business Analyst", "Propose une grille d'analyse en axes et sous-analyses"),
      agent(5, "queries", "Query Builder", "Génère des requêtes exécutées côté système — validation & reprise contrôlée"),
      sys(6, "outputs", "Extraction des métadonnées des sorties", "Profil des tables résultat (dimensions, agrégats)"),
      agent(7, "viz", "Visualization Designer", "Spécifie les visualisations à partir des métadonnées de sortie"),
      agent(8, "audit", "Confidentiality Tester", "Audit final : tentatives d'extraction + scan des artefacts"),
    ];
    return [
      sys(1, "import", "Import et validation des fichiers", "Lecture CSV/Excel, contrôle de format"),
      sys(2, "metadata", "Extraction des métadonnées des sources", "Structure, types, complétude, statistiques globales non sensibles"),
      agent(3, "fullstack", "Full-Stack Analyst", "Un seul agent produit plan, requêtes et visualisations en une passe"),
      sys(4, "outputs", "Exécution contrôlée et métadonnées des sorties", "Validation, exécution, profil des résultats"),
      agent(5, "audit", "Confidentiality Tester", "Audit final : tentatives d'extraction + scan des artefacts"),
    ];
  }

  function renderSteps(steps) {
    els.pipeline.innerHTML = steps.map((s) => `
      <div class="agent-step pending" id="step-${s.key}">
        <div class="agent-avatar ${s.zone}">${s.num}</div>
        <div class="agent-body">
          <div class="agent-name">${s.titre}
            <span class="zone-tag ${s.zone}">${s.zone === "system" ? "Système local · accès aux données" : "Agent LLM · métadonnées uniquement"}</span>
            <span class="agent-status">En attente</span>
          </div>
          <div class="agent-role">${s.role}</div>
          <div class="agent-msg"></div>
          <div class="agent-log"></div>
          <details class="artefact" hidden><summary>Artefact — <code class="fname"></code></summary><pre><code class="language-json"></code></pre></details>
        </div>
      </div>`).join("");
  }

  const stepEl = (key) => document.getElementById(`step-${key}`);
  function setStatus(key, status, label) {
    const el = stepEl(key);
    el.classList.remove("pending", "running", "done", "warn");
    el.classList.add(status);
    const st = el.querySelector(".agent-status");
    st.textContent = label; st.className = "agent-status " + status;
  }
  function think(key) { stepEl(key).querySelector(".agent-msg").innerHTML = `<span class="think"><span></span><span></span><span></span></span>`; }
  function say(key, html) { stepEl(key).querySelector(".agent-msg").innerHTML = html; }
  function logLine(key, html, cls = "") {
    const log = stepEl(key).querySelector(".agent-log");
    log.insertAdjacentHTML("beforeend", `<div class="log-line ${cls}">${html}</div>`);
  }
  function attach(key, fname, obj) {
    const d = stepEl(key).querySelector(".artefact");
    d.querySelector(".fname").textContent = fname;
    const code = d.querySelector("code.language-json");
    code.textContent = JSON.stringify(obj, null, 2);
    if (window.hljs) hljs.highlightElement(code);
    d.hidden = false;
  }

  function resetOutputs() {
    charts.forEach((c) => c.destroy()); charts = [];
    els.chartsGrid.innerHTML = "";
    els.chartsBox.hidden = true;
    els.rapportPanel.hidden = true;
    els.rapportDetails.hidden = true;
    els.rapportDetails.open = false;
    ["kpi-etapes", "kpi-reprises", "kpi-sous", "kpi-audit"].forEach((id) => (document.getElementById(id).textContent = "—"));
  }

  const fmtVal = (exec, v) => {
    if (exec.op.agg === "count") return fmtNum(v);
    const vals = exec.result.map((r) => r.valeur);
    if (exec.op.agg === "mean" && Math.min(...vals) >= 0 && Math.max(...vals) <= 1) return fmtNum(v * 100, 1) + " %";
    return fmtNum(v, 2);
  };

  function renderCharts(vizSpecs, executions) {
    const specs = vizSpecs.filter((v) => executions.find((e) => e.id === v.requete && e.ok));
    els.chartsBox.hidden = false; // le conteneur doit etre visible avant que Chart.js ne mesure les canvas
    els.chartsGrid.className = "chart-grid" + (specs.length === 3 ? " thirds" : "");
    els.chartsGrid.innerHTML = specs.map((v) => `
      <div class="chart-box"><h4>${v.titre}</h4><div class="sub">${v.id} → ${v.requete} · rendu par le module système</div><canvas id="chart-${v.id}"></canvas></div>`).join("");
    const palette = [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent3, CHART_COLORS.good, CHART_COLORS.warn, CHART_COLORS.bad, "#f472b6", "#818cf8"];
    specs.forEach((v) => {
      const exec = executions.find((e) => e.id === v.requete);
      const labels = exec.result.map((r) => r.groupe), data = exec.result.map((r) => r.valeur);
      const isPct = exec.op.agg === "mean" && Math.min(...data) >= 0 && Math.max(...data) <= 1;
      const plotData = isPct ? data.map((d) => round(d * 100, 1)) : data;
      const horizontal = v.type === "bar" && labels.length > 4;
      const cfg = v.type === "doughnut"
        ? { type: "doughnut", data: { labels, datasets: [{ data: plotData, backgroundColor: palette.slice(0, labels.length), borderWidth: 0 }] },
            options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } } } }
        : { type: v.type, data: { labels, datasets: [{ data: plotData, backgroundColor: v.type === "line" ? "rgba(34,211,238,.12)" : CHART_COLORS.accent, borderColor: CHART_COLORS.accent2, fill: v.type === "line", tension: 0.35, pointRadius: 2, borderWidth: 2, borderRadius: 4 }] },
            options: { indexAxis: horizontal ? "y" : "x", maintainAspectRatio: false, plugins: { legend: { display: false } },
              scales: { x: { grid: { color: CHART_COLORS.grid }, ticks: { font: { size: 10.5 } } }, y: { grid: { color: CHART_COLORS.grid }, ticks: { font: { size: 10.5 } } } } } };
      charts.push(new Chart(document.getElementById(`chart-${v.id}`), cfg));
    });
    els.chartsBox.hidden = false;
  }

  function renderReport(ds, plan, executions, audit, reprises) {
    const items = [];
    plan.axes.forEach((axe) => axe.sous_analyses.forEach((sa) => {
      const exec = executions.find((e) => e.id === sa.requete);
      if (!exec || !exec.ok) { items.push(`<b>${sa.id}</b> ${sa.question} — <i>non exécutée</i>`); return; }
      const top = [...exec.result].sort((a, b) => b.valeur - a.valeur)[0];
      items.push(`<b>${sa.id}</b> ${sa.question} → <b>${top.groupe}</b> : ${fmtVal(exec, top.valeur)} <span class="dim">(${exec.result.length} groupe(s)${exec.attempts > 1 ? `, validée à la tentative ${exec.attempts}` : ""})</span>`);
    }));
    items.push(`Audit de confidentialité : <b>${audit.verdict}</b> — ${fmtNum(audit.valeurs_brutes_testees)} valeurs brutes recherchées dans les artefacts, ${audit.expositions_detectees} exposition(s).`);
    items.push(mode === "multi"
      ? "Mode multi-agent : exploration plus large (3 axes) et artefacts intermédiaires auditables — au prix d'une latence et d'un coût plus élevés (cf. résultats du mémoire ci-dessous)."
      : "Mode mono-agent : périmètre plus compact (2 axes), une seule passe de génération — plus rapide et moins coûteux, mais exploration réduite (cf. résultats du mémoire ci-dessous).");
    els.rapportList.innerHTML = items.map((t) => `<div class="insight-item"><span class="bullet">→</span><span>${t}</span></div>`).join("");
    els.rapportSub.textContent = `${ds.nom} · mode ${mode === "multi" ? "multi-agent" : "mono-agent"} · ${reprises} reprise(s) guardrail`;
    els.rapportPanel.hidden = false;
    els.rapportDetails.hidden = false;
  }

  // ======================================================================
  // ORCHESTRATION DU PIPELINE ONE-CLICK
  // ======================================================================
  async function runPipeline() {
    if (running) return;
    running = true; els.run.disabled = true; els.dataset.disabled = true;
    const ds = currentDataset();
    const art = ds.artefacts;
    const variant = art[mode];
    const steps = buildSteps();
    renderSteps(steps);
    resetOutputs();

    const ctx = { reprises: 0, executions: [], agentCorpus: [] };
    const pause = async (key, ms) => { setStatus(key, "running", "En cours"); think(key); await sleep(ms); };
    const done = (key, label = "Validé ✓") => setStatus(key, "done", label);

    // 1. Import [Systeme]
    await pause("import", 600);
    const tables = Object.entries(ds.tables).map(([t, rows]) => `<b>${t}</b> (${rows.length} × ${Object.keys(rows[0]).length})`).join(", ");
    say("import", `Fichiers chargés et validés : ${tables}. Les données restent confinées dans le module local — aucun LLM n'y accède.`);
    done("import");

    // 2. Metadonnees [Systeme]
    await pause("metadata", 700);
    const metadata = extractMetadata(ds);
    const nCols = Object.values(metadata.tables).reduce((s, t) => s + t.n_colonnes, 0);
    const nSens = ds.colonnes_sensibles.length;
    say("metadata", `<b>${nCols} colonnes</b> profilées (type, complétude, statistiques globales)${nSens ? ` — <b>${nSens} colonne(s) sensible(s)</b> : min/max et modalités retenus, seuls moyenne et écart-type sont transmis` : ""}. C'est le <b>seul</b> artefact que les agents recevront : aucune ligne, aucun échantillon.`);
    attach("metadata", "raw_metadata.json", metadata);
    done("metadata");
    const metadataStr = JSON.stringify(metadata);

    let plan, queries, vizSpecs;

    if (mode === "multi") {
      // 3. Schema Interpreter [Agent]
      await pause("schema", 1000);
      const cols = Object.values(art.schema_interpretation.tables).flat();
      say("schema", `${cols.length} colonnes interprétées à partir des métadonnées : ${cols.filter((c) => c.role.startsWith("dimension")).length} dimensions, ${cols.filter((c) => c.role.startsWith("mesure") || c.role.includes("cible")).length} mesures, ${cols.filter((c) => c.sensibilite === "élevée").length} marquée(s) à sensibilité élevée. Domaine inféré : <i>${art.schema_interpretation.domaine_inferé}</i>.`);
      attach("schema", "schema_interpretation.json", art.schema_interpretation);
      ctx.agentCorpus.push(JSON.stringify(art.schema_interpretation));
      done("schema");

      // 4. Business Analyst [Agent]
      await pause("plan", 1000);
      plan = variant.plan;
      const nSous = plan.axes.reduce((s, a) => s + a.sous_analyses.length, 0);
      say("plan", `Grille d'analyse proposée : <b>${plan.axes.length} axes</b>, <b>${nSous} sous-analyses</b> — ${plan.axes.map((a) => a.titre).join(" · ")}.`);
      attach("plan", "analysis_plan.json", plan);
      ctx.agentCorpus.push(JSON.stringify(plan));
      done("plan");

      // 5. Query Builder [Agent] + validation systeme
      await pause("queries", 900);
      queries = variant.queries;
      say("queries", `${queries.length} requêtes générées (agrégations uniquement). Validation par le module système :`);
      await runQueries(ds, queries, ctx, "queries");
      attach("queries", "queries.json", queries);
      ctx.agentCorpus.push(JSON.stringify(queries));
      done("queries", ctx.executions.every((e) => e.ok) ? "Validé ✓" : "Partiel");

      // 6. Metadonnees des sorties [Systeme]
      await pause("outputs", 600);
      const outMeta = outputMetadata(ctx.executions);
      say("outputs", `${outMeta.sorties.length} tables résultat profilées (dimensions, min/max/moyenne des agrégats). Ces métadonnées de sortie — et non les résultats bruts — alimentent l'agent suivant.`);
      attach("outputs", "query_outputs_metadata.json", outMeta);
      ctx.agentCorpus.push(JSON.stringify(outMeta));
      done("outputs");

      // 7. Visualization Designer [Agent]
      await pause("viz", 900);
      vizSpecs = variant.visualizations;
      say("viz", `${vizSpecs.length} visualisations spécifiées (type, requête source, titre). Le rendu est effectué par le module système à partir des résultats réels — l'agent n'a jamais vu ces valeurs.`);
      attach("viz", "visualizations.json", vizSpecs);
      ctx.agentCorpus.push(JSON.stringify(vizSpecs));
      renderCharts(vizSpecs, ctx.executions);
      done("viz");
    } else {
      // 3. Full-Stack Analyst [Agent]
      await pause("fullstack", 1300);
      plan = variant.plan; queries = variant.queries; vizSpecs = variant.visualizations;
      const nSous = plan.axes.reduce((s, a) => s + a.sous_analyses.length, 0);
      const fullArtefact = { plan, queries, visualizations: vizSpecs };
      say("fullstack", `Analyse produite en une seule passe : <b>${plan.axes.length} axes</b>, <b>${nSous} sous-analyses</b>, ${queries.length} requêtes et ${vizSpecs.length} visualisations. Validation par le module système :`);
      await runQueries(ds, queries, ctx, "fullstack");
      attach("fullstack", "full_stack_analysis.json", fullArtefact);
      ctx.agentCorpus.push(JSON.stringify(art.schema_interpretation), JSON.stringify(fullArtefact));
      done("fullstack", ctx.executions.every((e) => e.ok) ? "Validé ✓" : "Partiel");

      // 4. Execution + metadonnees des sorties [Systeme]
      await pause("outputs", 700);
      const outMeta = outputMetadata(ctx.executions);
      say("outputs", `${outMeta.sorties.length} requêtes exécutées et profilées ; visualisations rendues par le module système.`);
      attach("outputs", "query_outputs_metadata.json", outMeta);
      ctx.agentCorpus.push(JSON.stringify(outMeta));
      renderCharts(vizSpecs, ctx.executions);
      done("outputs");
    }

    // Dernier : Confidentiality Tester [Agent] + scan systeme
    await pause("audit", 1100);
    const refus = art.attaques.map((q) => ({ question: q, reponse: "Refus — la mémoire partagée ne contient que des métadonnées et des agrégats ; aucune valeur individuelle n'est disponible." }));
    ctx.agentCorpus.push(JSON.stringify(refus));
    const audit = auditConfidentiality(ds, ctx.agentCorpus.join("\n"), metadataStr);
    const auditArtefact = { tentatives_extraction: refus, scan_systeme: audit };
    art.attaques.forEach((q) => logLine("audit", `<span class="tag">attaque</span> « ${q} » → <span class="ok">refusée</span>`));
    logLine("audit", audit.valeurs_brutes_testees
      ? `<span class="tag">scan</span> ${fmtNum(audit.valeurs_brutes_testees)} valeurs brutes à forte entropie (identifiants, nombres précis) recherchées dans ${ctx.agentCorpus.length} artefacts agents → <b class="${audit.verdict === "PASS" ? "ok" : "ko"}">${audit.expositions_detectees} exposition(s) · ${audit.verdict}</b>`
      : `<span class="tag">scan</span> ce jeu ne contient que des valeurs à faible entropie (scores à 2 chiffres, modalités déjà transmises) — scan sans objet, ${ctx.agentCorpus.length} artefacts vérifiés → <b class="ok">0 exposition · PASS</b>`);
    say("audit", `Verdict : <b>${audit.verdict}</b>. Les agents n'ont reçu que des métadonnées ; aucune valeur exacte issue des tables n'apparaît dans leurs sorties ni dans leur mémoire.`);
    attach("audit", "confidentiality_audit.json", auditArtefact);
    done("audit", audit.verdict === "PASS" ? "PASS ✓" : "FAIL");

    // KPIs + rapport
    const nOk = ctx.executions.filter((e) => e.ok).length;
    document.getElementById("kpi-etapes").textContent = `${steps.length}/${steps.length}`;
    document.getElementById("kpi-reprises").textContent = fmtNum(ctx.reprises);
    document.getElementById("kpi-sous").textContent = `${nOk}/${queries.length}`;
    document.getElementById("kpi-audit").textContent = `${audit.verdict} · ${audit.expositions_detectees}`;
    renderReport(ds, plan, ctx.executions, audit, ctx.reprises);

    running = false; els.run.disabled = false; els.dataset.disabled = false;
  }

  async function runQueries(ds, queries, ctx, key) {
    for (const q of queries) {
      const g = runWithGuardrail(ds, q);
      for (const l of g.log) {
        await sleep(260);
        if (l.statut === "echec") {
          ctx.reprises++;
          logLine(key, `<span class="tag">${q.id}</span> tentative ${l.tentative} — <span class="ko">échec de validation</span> : ${l.retour_agent} → retour à l'agent pour correction`, "retry");
        } else {
          logLine(key, `<span class="tag">${q.id}</span> ${l.tentative > 1 ? `tentative ${l.tentative} — ` : ""}<span class="ok">validée</span> · exécutée (${l.n_lignes} groupe(s))`);
        }
      }
      if (!g.ok) logLine(key, `<span class="tag">${q.id}</span> abandonnée après ${g.attempts} tentatives`, "retry");
      ctx.executions.push({ id: q.id, ...g });
    }
  }

  // ======================================================================
  function setMode(m) {
    mode = m;
    els.btnMulti.classList.toggle("active", m === "multi");
    els.btnMono.classList.toggle("active", m === "mono");
    renderSteps(buildSteps());
    resetOutputs();
  }
  els.btnMulti.addEventListener("click", () => !running && setMode("multi"));
  els.btnMono.addEventListener("click", () => !running && setMode("mono"));
  els.run.addEventListener("click", runPipeline);
  els.dataset.addEventListener("change", () => { renderMeta(currentDataset()); renderSteps(buildSteps()); resetOutputs(); });

  els.dataset.value = IA_DATASETS[0].id;
  renderMeta(IA_DATASETS[0]);
  setMode("multi");
})();
