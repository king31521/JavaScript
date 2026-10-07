// ==UserScript==
// @name         原俠正楷900字重
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const FONT_CSS_URL = 'https://cdn.jsdelivr.net/gh/king31521/JavaScript@main/GuanKiapTsingKhai-W-base64.css';
  const FONT_FAMILY = 'GuanKiapTsingKhai-W';

  const STYLE_ID = 'adg-force-font-style';

  function ensureStyleTag() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }

  function buildOverrideCSS() {
    return `
html, body, input, textarea, button, select {
  font-family: "${FONT_FAMILY}", "Microsoft JhengHei", sans-serif !important;
  /* 啟用瀏覽器自帶的粗體合成演算法 */
  font-synthesis: weight !important;
  font-weight: bold !important;
}

body *:not(svg):not(path):not(use):not(i):not(.fa):not([class*="fa-"]):not(.material-icons):not([class*="material"]):not([class*="icon"]):not(code):not(pre) {
  font-family: "${FONT_FAMILY}", "Microsoft JhengHei", sans-serif !important;
  font-synthesis: weight !important;
  font-weight: bold !important;

  /* 核心加粗核心：文字描邊 0.4 像素，可根據需求微調（例如 0.3px 或 0.5px） */
  -webkit-text-stroke: 0.4px currentColor !important;
  
  /* 輔助加粗：利用微陰影讓字體更黑、更立體 */
  text-shadow: 0.1px 0.1px 0px currentColor, -0.1px -0.1px 0px currentColor !important;
}

body *::before, body *::after {
  font-family: inherit !important;
  font-weight: inherit !important;
  -webkit-text-stroke: inherit !important;
  text-shadow: inherit !important;
}
`.trim();
  }

  async function inject() {
    const style = ensureStyleTag();
    style.textContent = buildOverrideCSS();

    try {
      const res = await fetch(FONT_CSS_URL, { cache: 'force-cache', mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const fontCss = await res.text();
      style.textContent = `${fontCss}\n\n${buildOverrideCSS()}`;
    } catch (e) {
      try {
        const linkId = 'adg-force-font-link';
        if (!document.getElementById(linkId)) {
          const link = document.createElement('link');
          link.id = linkId;
          link.rel = 'stylesheet';
          link.href = FONT_CSS_URL;
          (document.head || document.documentElement).appendChild(link);
        }
      } catch (_) {}
    }
  }

  inject();

  const mo = new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID)) inject();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
