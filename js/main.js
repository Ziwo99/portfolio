// ---------------------------------------------------------------
// Comportement global : nav, menu mobile, reveal au scroll, compteurs
// ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");

  window.addEventListener("scroll", () => {
    nav && nav.classList.toggle("scrolled", window.scrollY > 12);
  }, { passive: true });

  if (toggle && links) {
    const toggleLabel = toggle.querySelector("span");
    const setOpen = (isOpen) => {
      links.classList.toggle("open", isOpen);
      toggle.classList.toggle("open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      if (toggleLabel) toggleLabel.textContent = isOpen ? (window.portfolioLanguage === "en" ? "Close" : "Fermer") : "Menu";
    };
    document.addEventListener("languagechange", () => setOpen(links.classList.contains("open")));
    document.addEventListener("keydown", e => { if (e.key === "Escape") { setOpen(false); toggle.focus(); } });
    toggle.addEventListener("click", () => setOpen(!links.classList.contains("open")));
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => setOpen(false))
    );
  }

  // Scroll-spy : met en surbrillance le lien de menu de la section visible.
  // No-op silencieux sur les pages qui n'ont pas ces sections (ex. pages projet).
  if (links) {
    const navLinks = [...links.querySelectorAll('a[href*="#"]')];
    const setActive = (id) => {
      navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href").endsWith("#" + id)));
    };
    // sections doit suivre l'ordre du DOM (= ordre des liens du menu) pour l'algorithme ci-dessous.
    const sections = navLinks
      .map((a) => document.getElementById(a.getAttribute("href").split("#")[1]))
      .filter(Boolean);

    if (sections.length) {
      const ANCHOR = 140; // px depuis le haut — doit rester sous la nav sticky
      let ticking = false;
      let suppressSpy = false; // le temps d'un scroll fluide déclenché par un clic menu
      const updateActive = () => {
        ticking = false;
        if (suppressSpy) return;
        // Tout en bas de page : la dernière section (Contact) est forcément la section
        // visible, même si son <top> ne franchit jamais l'ANCHOR (section courte / footer).
        const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        if (atBottom) { setActive(sections[sections.length - 1].id); return; }
        let current = null;
        for (const s of sections) {
          if (s.getBoundingClientRect().top - ANCHOR <= 0) current = s; else break;
        }
        if (current) setActive(current.id);
        else navLinks.forEach((a) => a.classList.remove("active"));
      };
      window.addEventListener("scroll", () => {
        if (!ticking) { ticking = true; requestAnimationFrame(updateActive); }
      }, { passive: true });
      // Attend la fin réelle du scroll fluide (position stable sur plusieurs frames)
      // avant de laisser le scroll-spy reprendre la main.
      const waitScrollEnd = () => {
        let lastY = window.scrollY;
        let stableFrames = 0;
        const check = () => {
          const y = window.scrollY;
          if (Math.abs(y - lastY) < 0.5) {
            stableFrames++;
            if (stableFrames > 4) { suppressSpy = false; updateActive(); return; }
          } else {
            stableFrames = 0;
          }
          lastY = y;
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      };
      navLinks.forEach((a) => a.addEventListener("click", () => {
        const id = a.getAttribute("href").split("#")[1];
        if (document.getElementById(id)) {
          suppressSpy = true;
          setActive(id);
          waitScrollEnd();
        }
      }));
      updateActive();
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el, i) => {
    el.style.setProperty("--i", i % 8);
    io.observe(el);
  });

  document.querySelectorAll(".code-panel").forEach((panel) => {
    const tabs = panel.querySelectorAll(".code-tabs button");
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabs.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        panel.querySelectorAll(".code-block-group").forEach((g) => {
          g.classList.toggle("active", g.dataset.group === btn.dataset.tab);
        });
      });
    });
  });
  if (window.hljs) document.querySelectorAll("pre code").forEach((el) => hljs.highlightElement(el));

  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = parseFloat(el.getAttribute("data-count"));
    const decimals = el.getAttribute("data-decimals") ? parseInt(el.getAttribute("data-decimals")) : 0;
    const suffix = el.getAttribute("data-suffix") || "";
    const counterIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        counterIO.unobserve(entry.target);
        const duration = 2500;
        const start = performance.now();
        function tick(now) {
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = (target * eased).toFixed(decimals) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 });
    counterIO.observe(el);
  });

  // Aligne la hauteur de la hero-card sur celle du bloc de texte à gauche
  // (au-delà de 980px, où les deux colonnes sont côte à côte).
  const heroCopy = document.querySelector(".hero-copy");
  const heroCard = document.querySelector(".hero-card");
  if (heroCopy && heroCard) {
    const twoCols = window.matchMedia("(min-width: 981px)");
    const syncHeroHeight = () => {
      if (twoCols.matches) heroCard.style.height = heroCopy.offsetHeight + "px";
      else heroCard.style.height = "";
    };
    new ResizeObserver(syncHeroHeight).observe(heroCopy);
    twoCols.addEventListener("change", syncHeroHeight);
    syncHeroHeight();
    // Le bloc de texte change de hauteur quand les polices web arrivent : on resynchronise
    // dès qu'elles sont prêtes (et au load) pour fixer la mise en page avant toute interaction.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeroHeight);
    window.addEventListener("load", syncHeroHeight);
  }

  // Resize charts when their optional analysis panel becomes visible.
  document.querySelectorAll("details.dashboard-detail").forEach(detail => {
    detail.addEventListener("toggle", () => {
      if (detail.open && window.Chart) requestAnimationFrame(() => {
        Object.values(Chart.instances).forEach(chart => {
          if (detail.contains(chart.canvas)) chart.resize();
        });
      });
    });
  });

  // Onglets de navigation interne des pages projet (Analyse / Modèle de données / Exemple de code).
  // Pas de scroll : un clic bascule quel panneau est affiché, la barre reste fixée pendant le scroll.
  document.querySelectorAll(".proj-tabs").forEach((nav) => {
    const tabs = [...nav.querySelectorAll("a")];
    const activate = (id) => {
      tabs.forEach((a) => {
        const isTarget = a.getAttribute("href") === "#" + id;
        a.classList.toggle("active", isTarget);
        const panel = document.getElementById(a.getAttribute("href").slice(1));
        if (panel) panel.hidden = !isTarget;
      });
    };
    tabs.forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      activate(a.getAttribute("href").slice(1));
    }));
    activate(tabs[0].getAttribute("href").slice(1));
  });
});

// ---------------------------------------------------------------
// Helpers partagés pour les dashboards
// ---------------------------------------------------------------
const fmtCHF = (n) =>
  new Intl.NumberFormat(window.portfolioLocale(), { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(n);
const fmtNum = (n, d = 0) => new Intl.NumberFormat(window.portfolioLocale(), { maximumFractionDigits: d }).format(n);
const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString(window.portfolioLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
};

const CHART_COLORS = {
  accent: "#315bd6",
  accent2: "#076b88",
  accent3: "#7346b8",
  good: "#167347",
  warn: "#936000",
  bad: "#c53636",
  grid: "#e1e6ee",
  text: "#4b5b71",
};

function chartDefaults() {
  if (typeof Chart === "undefined") return;
  if (!Chart.registry.plugins.get('portfolio-language')) Chart.register({
    id: 'portfolio-language',
    beforeUpdate(chart) {
      const tr = window.translatePortfolio;
      if (!tr) return;
      const records = chart.$languageRecords || (chart.$languageRecords = new Map());
      const translate = (key, value) => {
        let record = records.get(key);
        if (!record || record.rendered !== value) record = { source: value };
        record.rendered = tr(record.source); records.set(key, record);
        return record.rendered;
      };
      chart.data.labels = chart.data.labels?.map((label, i) => translate('label' + i, label));
      chart.data.datasets.forEach((dataset, i) => { if (dataset.label) dataset.label = translate('dataset' + i, dataset.label); });
      Object.entries(chart.options.scales || {}).forEach(([key, scale]) => {
        if (scale.title?.text) scale.title.text = translate('axis' + key, scale.title.text);
      });
    }
  });
  Chart.defaults.font.family = "Inter, sans-serif";
  Chart.defaults.color = CHART_COLORS.text;
  Chart.defaults.font.size = 12;
}
