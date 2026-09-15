/* Translate presentation only: filter values, datasets and code artefacts stay intact. */
window.portfolioLanguage = (() => {
  const requested = new URLSearchParams(location.search).get('lang');
  try { return ['fr', 'en'].includes(requested) ? requested : localStorage.getItem('portfolio-language') === 'en' ? 'en' : 'fr'; }
  catch { return requested === 'en' ? 'en' : 'fr'; }
})();
window.portfolioLocale = () => window.portfolioLanguage === 'en' ? 'en-CH' : 'fr-CH';
document.documentElement.lang = window.portfolioLanguage;
const dictionary = window.portfolioTranslations || {};
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const translationPattern = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + Object.keys(dictionary).sort((a,b) => b.length-a.length).map(escapePattern).join('|') + ')(?![\\p{L}\\p{N}_])', 'gu');
window.translatePortfolio = value => {
  if (typeof value !== 'string' || window.portfolioLanguage !== 'en') return value;
  const trimmed = value.trim();
  if (dictionary[trimmed]) return value.replace(trimmed, dictionary[trimmed]);
  return value.replace(translationPattern, match => dictionary[match]);
};
document.addEventListener('DOMContentLoaded', () => {
  const records = new WeakMap();
  function translateValue(owner, key, value, english) {
    let values = records.get(owner);
    if (!values) { values = {}; records.set(owner, values); }
    let record = values[key];
    if (!record || record.rendered !== value) record = values[key] = { source: value };
    record.rendered = window.portfolioLanguage === 'en' && english !== undefined ? english : window.translatePortfolio(record.source);
    return record.rendered;
  }
  function translateTree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, pre, code, [data-en], [data-lang]')) continue;
      const translated = translateValue(node, 'text', node.nodeValue);
      if (translated !== node.nodeValue) node.nodeValue = translated;
    }
    root.querySelectorAll('[data-en]').forEach(el => {
      const translated = translateValue(el, 'text', el.textContent, el.dataset.en);
      if (el.textContent !== translated) el.textContent = translated;
    });
    root.querySelectorAll('[placeholder], [aria-label], [title], meta[name="description"]').forEach(el => {
      for (const name of ['placeholder', 'aria-label', 'title', 'content']) {
        if (el.hasAttribute(name)) {
          const value = el.getAttribute(name);
          const translated = translateValue(el, name, value);
          if (value !== translated) el.setAttribute(name, translated);
        }
      }
    });
  }
  const observer = new MutationObserver(() => {
    observer.disconnect();
    translateTree(document.documentElement);
    observe();
  });
  function observe() { observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); }
  function applyLanguage(lang) {
    observer.disconnect();
    window.portfolioLanguage = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll('select option').forEach(option => {
      if (/^\d{4}-\d{2}$/.test(option.value)) {
        option.textContent = new Date(option.value + '-01T12:00:00').toLocaleDateString(window.portfolioLocale(), { month: 'short', year: 'numeric' });
      }
    });
    document.querySelectorAll('[data-lang]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang)));
    try { localStorage.setItem('portfolio-language', lang); } catch {}
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || /^(?:[a-z]+:|\/\/)/i.test(href)) return;
      const url = new URL(href, location.href);
      if (url.origin === location.origin && url.pathname.endsWith('.html')) {
        url.searchParams.set('lang', lang);
        link.setAttribute('href', url.pathname + url.search + url.hash);
      }
    });
    document.dispatchEvent(new CustomEvent('languagechange'));
    translateTree(document.documentElement);
    if (window.Chart) Object.values(Chart.instances).forEach(chart => chart.update('none'));
    observe();
  }
  document.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => applyLanguage(btn.dataset.lang)));
  applyLanguage(window.portfolioLanguage);
});
