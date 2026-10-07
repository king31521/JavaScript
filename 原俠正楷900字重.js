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
  font-weight: 900 !important;
}

body *:not(svg):not(path):not(use)
      :not(i):not(.fa):not([class*="fa-"])
      :not(.material-icons):not([class*="material"])
      :not([class*="icon"])
      :not(code):not(pre) {
  font-family: "${FONT_FAMILY}", "Microsoft JhengHei", sans-serif !important;
  font-weight: 900 !important;
}

body *::before, body *::after {
  font-family: inherit !important;
  font-weight: inherit !important;
}
`.trim();
  }

  async function inject() {
    const style = ensureStyleTag();

    // 先寫入覆蓋規則（即使字型 CSS 還沒抓到，也先把規則卡位）
    // 字型 CSS 抓到後會放在最前面，確保 @font-face 位置正確。
    style.textContent = buildOverrideCSS();

    try {
      const res = await fetch(FONT_CSS_URL, { cache: 'force-cache', mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const fontCss = await res.text();

      // 確保 @font-face 在最上面
      style.textContent = `${fontCss}\n\n${buildOverrideCSS()}`;
    } catch (e) {
      // 失敗時：退而求其次用 <link> 載入字型 CSS（有些站點/環境可能更吃這種）
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

  // SPA / 動態頁：確保 style 沒被頁面移除
  const mo = new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID)) inject();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
