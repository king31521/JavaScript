// ==UserScript==
// @name         原俠正楷W加字體優化
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const FONT_CSS_URL    = 'https://cdn.jsdelivr.net/gh/king31521/JavaScript@main/GuanKiapTsingKhai-W-base64.css';
  const FONT_FAMILY     = 'GuanKiapTsingKhai-W';
  const STYLE_ID        = 'adg-force-font-style';
  const OPT_STYLE_ID    = 'mactype-style';
  const LS_WHITELIST    = 'font_opt_white_list';

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * localStorage 輔助（取代 GM_getValue / GM_setValue）
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const store = {
    get(key, def = null) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? def : JSON.parse(v);
      } catch { return def; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    }
  };

  function isWhitelisted() {
    return store.get(LS_WHITELIST, []).includes(location.host);
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * CSS 產生器
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  /** 僅負責將全站字型替換為原俠正楷，不再做任何字重處理 */
  function buildFontFamilyCSS() {
    return `
html, body, input, textarea, button, select {
  font-family: "${FONT_FAMILY}", "Microsoft JhengHei", sans-serif !important;
}
body *:not(svg):not(path):not(use):not(i):not(.fa):not([class*="fa-"]):not(.material-icons):not([class*="material"]):not([class*="icon"]):not(code):not(pre) {
  font-family: "${FONT_FAMILY}", "Microsoft JhengHei", sans-serif !important;
}
body *::before,
body *::after {
  font-family: inherit !important;
}`.trim();
  }

  /**
   * 字體優化 CSS（取代原「改字重」功能）
   * 來源：自動字體優化.js，已移除 font-family 覆寫（由上方主字型 CSS 統一管理）
   * 及移除 CSS 內無效的 // 單行註解
   */
  function buildOptimizationCSS() {
    return `
*:not(pre) {
  -webkit-text-stroke: 1px !important;
  text-stroke: 1px !important;
}
::selection {
  color: #fff;
  background: #338fff;
}`.trim();
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * style 標籤操作
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  function ensureStyleTag(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 字體優化注入（含防移除 Observer）
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  let optObserver = null;

  function injectOptimizationStyle() {
    if (isWhitelisted()) return;
    if (document.getElementById(OPT_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = OPT_STYLE_ID;
    style.textContent = buildOptimizationCSS();
    (document.head || document.documentElement).appendChild(style);

    // 防止優化 style 被頁面動態移除
    if (!optObserver) {
      optObserver = new MutationObserver(() => {
        if (!document.getElementById(OPT_STYLE_ID)) {
          const s = document.createElement('style');
          s.id = OPT_STYLE_ID;
          s.textContent = buildOptimizationCSS();
          (document.head || document.documentElement).appendChild(s);
        }
      });
    }
    const target = document.head || document.documentElement;
    optObserver.observe(target, { childList: true, subtree: true });
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 等待原俠正楷字型完全套用後，才執行字體優化
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  async function waitForFontThenOptimize() {
    try {
      // 1. 等待目標字型檔案確實下載並解析完畢
      await document.fonts.load(`bold 16px "${FONT_FAMILY}"`);
      // 2. 再等所有字型（含剛載入者）全部就緒
      await document.fonts.ready;
    } catch {
      // fonts API 不支援時，退而等待 2 秒作為保險
      await new Promise(r => setTimeout(r, 2000));
    }
    injectOptimizationStyle();
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 主流程：注入字型 CSS → 等字型就緒 → 執行優化
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  async function inject() {
    // 先立即套用 font-family，避免 FOUT（無樣式文字閃爍）
    const style = ensureStyleTag(STYLE_ID);
    style.textContent = buildFontFamilyCSS();

    try {
      // 嘗試直接 fetch 字型 CSS（含 base64 字型資料）
      const res = await fetch(FONT_CSS_URL, { cache: 'force-cache', mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const fontCss = await res.text();
      // 字型定義 + font-family 覆寫一併寫入同一個 style tag
      style.textContent = `${fontCss}\n\n${buildFontFamilyCSS()}`;
    } catch {
      // fetch 失敗時改用 <link> 載入（CSP 較嚴時的備援）
      try {
        const linkId = 'adg-force-font-link';
        if (!document.getElementById(linkId)) {
          const link = document.createElement('link');
          link.id   = linkId;
          link.rel  = 'stylesheet';
          link.href = FONT_CSS_URL;
          (document.head || document.documentElement).appendChild(link);
        }
      } catch {}
    }

    // 字型注入完畢後，等待字型真正載入，再執行字體優化
    waitForFontThenOptimize();
  }

  inject();

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 防止主字型 style 被移除（與原邏輯相同）
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const fontMO = new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID)) inject();
  });
  fontMO.observe(document.documentElement, { childList: true, subtree: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 控制台白名單 API（取代 GM_registerMenuCommand）
   * 在油猴或瀏覽器控制台均可直接呼叫
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  window.__fontOpt = {
    /**
     * 將目前網站加入白名單（停用字體優化），重新整理後生效
     * @param {string} [host] 預設為目前網域
     */
    disable(host = location.host) {
      const list = store.get(LS_WHITELIST, []);
      if (!list.includes(host)) {
        list.push(host);
        store.set(LS_WHITELIST, list);
      }
      console.log(`❌ 字體優化已停用：${host}，重新整理後生效`);
    },
    /**
     * 將目前網站從白名單移除（重新啟用字體優化），重新整理後生效
     * @param {string} [host] 預設為目前網域
     */
    enable(host = location.host) {
      const list = store.get(LS_WHITELIST, []).filter(h => h !== host);
      store.set(LS_WHITELIST, list);
      console.log(`✅ 字體優化已啟用：${host}，重新整理後生效`);
    },
    /** 列出所有白名單網域 */
    list() {
      console.table(store.get(LS_WHITELIST, []));
    }
  };

  console.log(
    '%c💡 原俠正楷 + 字體優化 已載入\n' +
    '白名單管理（重新整理後生效）：\n' +
    '  window.__fontOpt.disable()  ← 停用本站優化\n' +
    '  window.__fontOpt.enable()   ← 啟用本站優化\n' +
    '  window.__fontOpt.list()     ← 查看白名單',
    'color:#338fff; font-weight:bold;'
  );

})();
