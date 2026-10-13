// Interface translations. Dictionaries in i18n/<lang>.json map the English
// text to its translation, so English is the single source and anything not
// yet translated falls back to English. Static page text is translated by
// walking the DOM once at load; text built in JavaScript goes through tr().

export const LANGUAGES = { en: 'English', hi: 'हिन्दी', es: 'Español' };
const STORE = 'heliofleet-lang';
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
let LANG = 'en';
let DICT = {};

// Language from the link, then the visitor's earlier choice, then the browser.
export function detectLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q in LANGUAGES) return q;
  try {
    const s = localStorage.getItem(STORE);
    if (s in LANGUAGES) return s;
  } catch { /* storage unavailable */ }
  const nav = (navigator.languages || [navigator.language || 'en']).map((l) => l.slice(0, 2));
  return nav.find((l) => l in LANGUAGES) || 'en';
}

export async function loadLang(lang) {
  LANG = lang in LANGUAGES ? lang : 'en';
  document.documentElement.lang = LANG;
  if (LANG === 'en') return;
  if (LANG === 'hi') {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }
  try {
    // Revalidate each load: translations change with releases, not monthly
    const r = await fetch(`i18n/${LANG}.json`, { cache: 'no-cache' });
    DICT = r.ok ? await r.json() : {};
  } catch {
    DICT = {};
  }
}

export const lang = () => LANG;

export function saveLang(l) {
  try { localStorage.setItem(STORE, l); } catch { /* storage unavailable */ }
}

// Translate an English string; {name} placeholders are filled from vars.
export function tr(s, vars) {
  let out = DICT[s] ?? s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}

// Translate the static page: text nodes and attributes that match a
// dictionary entry, and blocks marked data-i18n-html="key" (paragraphs that
// mix text and links, translated whole so the grammar survives).
export function translatePage(root = document.body) {
  if (LANG === 'en') return;
  document.title = tr(document.title);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script, style, code, pre, [data-i18n-html]')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (t && t in DICT) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), DICT[t]);
  }
  for (const el of root.querySelectorAll('*')) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && v in DICT) el.setAttribute(a, DICT[v]);
    }
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    const key = `html:${el.dataset.i18nHtml}`;
    if (key in DICT) el.innerHTML = DICT[key];
  }
}
