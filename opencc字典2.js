// ==UserScript==
// @name         網頁簡轉繁 (OpenCC) - s2twp only (robust fixed)
// @namespace    https://github.com/seyhn/opencc-web-extension
// @version      1.0-s2twp-robust
// @description  僅保留 s2twp；更寬容的字典載入與錯誤處理，避免 Conversion chain not found 與大量阻塞錯誤訊息。
// @match        http://*/*
// @match        https://*/*
// @exclude      /^https?:\/\/www.google\.com\/.*?/
// @exclude      /^https?:\/\/docs.google\.com\/.*?/
// @exclude      /^https?:\/\/drive.google\.com\/.*?/
// @exclude      /^https?:\/\/github\.com\/.*?/
// @exclude      /^https:\/\/vscode.dev/.*?/
// @exclude      /^https?:\/\/codepen\.io\/.*?/
// @connect      cdn.jsdelivr.net
// @connect      fastly.jsdelivr.net
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const CONFIG = {
        dictBaseUrls: [
            'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
            'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/'
        ],
        conversionChains: {
            's2twp': { name: '簡體到臺灣正體(含地區詞)', dicts: ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName'] }
        },
        defaultConversion: 's2twp',
        defaultEnabled: true,
        storageKeys: {
            config: 'opencc_config',
            dictCache: 'opencc_dict_cache_'
        },
        debounceTime: 300,
        // 每個字典載入重試次數與單次請求超時（ms）
        fetchRetries: 2,
        fetchTimeout: 8000
    };

    // --- 狀態 ---
    const state = {
        converter: null,
        isConverting: false,
        observer: null,
        processedNodes: new WeakSet(),
        convertTimeout: null,
        userConfig: {}
    };

    // --- OpenCC 核心（僅載入字典、建立映射、最長匹配轉換） ---
    const OpenCC = {
        async createConverter(request) {
            const { chainKey, baseUrl } = normalizeRequest(request);
            const chain = CONFIG.conversionChains[chainKey] || CONFIG.conversionChains[CONFIG.defaultConversion];
            safeLog('info', `[OpenCC] 建立轉換器: ${chainKey} (${chain.name})`);

            // 依序載入字典；若某些字典載入失敗，使用已載入的字典繼續建立映射
            const dictNames = chain.dicts.slice();
            const dictTexts = [];
            for (const name of dictNames) {
                try {
                    const txt = await fetchDictionaryWithRetry(name, baseUrl);
                    if (txt) dictTexts.push(txt);
                } catch (e) {
                    safeLog('warn', `[OpenCC] 無法載入字典 ${name}，將跳過此字典。原因: ${e && e.message ? e.message : e}`);
                }
            }

            if (dictTexts.length === 0) {
                throw new Error('無法載入任何字典，轉換器建立失敗');
            }

            const conversionMap = buildConversionMap(dictTexts);
            safeLog('info', `[OpenCC] 轉換器建立完成，載入詞條數: ${conversionMap.size}`);
            return text => convertText(text, conversionMap);
        }
    };

    // --- 字典載入：重試 + 超時 + GM_{get,set}Value 快取 ---
    async function fetchDictionaryWithRetry(name, customBaseUrl = null) {
        const cacheKey = CONFIG.storageKeys.dictCache + name;
        try {
            const cached = await GM_getValue(cacheKey);
            if (cached) return cached;
        } catch (e) {
            // 忽略快取讀取錯誤
        }

        const sources = customBaseUrl ? [customBaseUrl] : CONFIG.dictBaseUrls;
        let lastErr = null;

        for (const src of sources) {
            const url = `${src}${name}.txt`;
            for (let attempt = 0; attempt < CONFIG.fetchRetries; attempt++) {
                try {
                    const resp = await gmRequestWithTimeout(url, CONFIG.fetchTimeout);
                    if (resp && resp.status === 200 && resp.responseText) {
                        const textData = resp.responseText;
                        try { await GM_setValue(cacheKey, textData); } catch (e) {}
                        safeLog('info', `[OpenCC] 成功載入字典 ${name} 從 ${src}`);
                        return textData;
                    } else {
                        lastErr = new Error(`HTTP ${resp && resp.status}`);
                        break; // 若 response 不是 200，立即換下一個 base URL
                    }
                } catch (err) {
                    lastErr = err;
                    // 短暫等待後重試
                    await sleep(200 + attempt * 100);
                }
            }
        }
        throw lastErr || new Error('fetch failed');
    }

    // Wrapper for GM_xmlhttpRequest with timeout
    function gmRequestWithTimeout(url, timeout) {
        return new Promise((resolve, reject) => {
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                reject(new Error('request timeout'));
            }, timeout);

            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    onload: function(res) {
                        if (timedOut) return;
                        clearTimeout(timer);
                        resolve(res);
                    },
                    onerror: function(err) {
                        if (timedOut) return;
                        clearTimeout(timer);
                        reject(new Error('network error'));
                    },
                    ontimeout: function() {
                        if (timedOut) return;
                        clearTimeout(timer);
                        reject(new Error('request timeout'));
                    }
                });
            } catch (e) {
                if (!timedOut) {
                    clearTimeout(timer);
                    reject(e);
                }
            }
        });
    }

    // --- 建立轉換映射（後載入覆蓋先載入） ---
    function buildConversionMap(dictTexts) {
        const map = new Map();
        for (const text of dictTexts) {
            if (!text) continue;
            const lines = text.split('\n');
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line || line[0] === '#') continue;
                const tab = line.indexOf('\t');
                if (tab <= 0) continue;
                const key = line.substring(0, tab);
                const valuesPart = line.substring(tab + 1).trim();
                if (!valuesPart) continue;
                const value = valuesPart.split(' ')[0];
                if (value) map.set(key, value);
            }
        }
        return map;
    }

    // --- 最長匹配轉換 ---
    function convertText(text, conversionMap) {
        if (!text) return text;
        let out = '';
        const maxLen = 10;
        for (let i = 0; i < text.length; ++i) {
            let matched = false;
            for (let len = Math.min(maxLen, text.length - i); len > 0; --len) {
                const seg = text.substr(i, len);
                if (conversionMap.has(seg)) {
                    out += conversionMap.get(seg);
                    i += len - 1;
                    matched = true;
                    break;
                }
            }
            if (!matched) out += text[i];
        }
        return out;
    }

    // --- 輔助函式 ---
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Normalize createConverter request into chainKey + optional baseUrl (force to s2twp for legacy)
    function normalizeRequest(request) {
        // If passed chain object from config already (safe)
        if (typeof request === 'object' && request !== null && request.dicts) {
            // Try to detect matching chain; else fallback
            const match = Object.keys(CONFIG.conversionChains).find(k => {
                const a = CONFIG.conversionChains[k].dicts;
                const b = request.dicts || [];
                if (a.length !== b.length) return false;
                return a.every((v, i) => v === b[i]);
            });
            return { chainKey: match || CONFIG.defaultConversion, baseUrl: request.dictPath || null };
        }

        if (typeof request === 'string') {
            const key = request.trim().toLowerCase();
            if (key === 's2t' || key === 's2tw' || key === 's2twp') return { chainKey: 's2twp', baseUrl: null };
            return { chainKey: CONFIG.defaultConversion, baseUrl: null };
        }

        if (typeof request === 'object' && request !== null && request.from && request.to) {
            const from = String(request.from).trim().toLowerCase();
            const to = String(request.to).trim().toLowerCase();
            const baseUrl = request.dictPath || request.dictpath || null;
            if (from === 's' && (to === 't' || to === 'tw' || to === 'twp')) return { chainKey: 's2twp', baseUrl };
            return { chainKey: CONFIG.defaultConversion, baseUrl };
        }

        return { chainKey: CONFIG.defaultConversion, baseUrl: null };
    }

    // --- DOM 處理（保護性更強） ---
    function convertPage() {
        if (!state.converter || state.isConverting) return;
        state.isConverting = true;
        try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                acceptNode: node => {
                    if (state.processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
                    if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentNode;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    const tag = parent.tagName;
                    if (!tag) return NodeFilter.FILTER_REJECT;
                    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || parent.isContentEditable) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            const nodes = [];
            let n;
            while ((n = walker.nextNode())) nodes.push(n);

            if (nodes.length) {
                for (const node of nodes) {
                    try {
                        node.nodeValue = state.converter(node.nodeValue);
                        state.processedNodes.add(node);
                    } catch (e) {
                        safeLog('warn', '[OpenCC] 單一節點轉換失敗，已跳過');
                    }
                }
            }
        } finally {
            state.isConverting = false;
        }
    }

    function startObserver() {
        if (state.observer) state.observer.disconnect();
        state.observer = new MutationObserver(mutations => {
            clearTimeout(state.convertTimeout);
            state.convertTimeout = setTimeout(() => {
                const added = mutations.some(m => m.addedNodes && m.addedNodes.length > 0);
                if (added) convertPage();
            }, CONFIG.debounceTime);
        });
        try {
            state.observer.observe(document.body, { childList: true, subtree: true });
            safeLog('info', '[OpenCC] MutationObserver 已啟動');
        } catch (e) {
            safeLog('warn', '[OpenCC] 無法啟動 MutationObserver，頁面動態更新將不會自動轉換');
        }
    }

    // --- 設定儲存與選單（確保 conversion key 會被標準化） ---
    async function loadConfig() {
        try {
            const saved = await GM_getValue(CONFIG.storageKeys.config, {});
            let enabled = saved.enabled;
            if (enabled === undefined || enabled === null) enabled = CONFIG.defaultEnabled;
            let conversion = saved.conversion || CONFIG.defaultConversion;
            conversion = normalizeConversionKey(conversion);
            state.userConfig = { enabled, conversion };
        } catch (e) {
            state.userConfig = { enabled: CONFIG.defaultEnabled, conversion: CONFIG.defaultConversion };
        }
    }

    function normalizeConversionKey(k) {
        if (!k) return CONFIG.defaultConversion;
        const lower = String(k).trim().toLowerCase();
        if (lower === 's2t' || lower === 's2tw' || lower === 's2twp') return 's2twp';
        if (CONFIG.conversionChains[lower]) return lower;
        return CONFIG.defaultConversion;
    }

    async function saveConfig() {
        try {
            state.userConfig.conversion = normalizeConversionKey(state.userConfig.conversion);
            await GM_setValue(CONFIG.storageKeys.config, state.userConfig);
        } catch (e) {}
    }

    function registerMenu() {
        const getModeName = () => {
            const key = normalizeConversionKey(state.userConfig.conversion);
            return CONFIG.conversionChains[key].name;
        };

        const ids = [];
        function refresh() {
            ids.forEach(id => {
                if (typeof GM_unregisterMenuCommand === 'function') {
                    try { GM_unregisterMenuCommand(id); } catch (e) {}
                }
            });
            ids.length = 0;
            ids.push(GM_registerMenuCommand(state.userConfig.enabled ? '✅ 停用自動轉換' : '☑️ 啟用自動轉換', toggleEnable, 'E'));
            ids.push(GM_registerMenuCommand('手動執行一次轉換', () => { if (state.converter) convertPage(); }, 'M'));
            ids.push(GM_registerMenuCommand(`🔄 切換模式 (當前: ${getModeName()})`, switchMode, 'S'));
        }

        async function toggleEnable() {
            state.userConfig.enabled = !state.userConfig.enabled;
            await saveConfig();
            alert(`OpenCC 自動轉換已 ${state.userConfig.enabled ? '啟用' : '停用'}（重新整理生效）`);
            refresh();
        }

        async function switchMode() {
            // 目前只有 s2twp，固定切換為 s2twp
            state.userConfig.conversion = 's2twp';
            await saveConfig();
            alert(`轉換模式已切換為: ${CONFIG.conversionChains[state.userConfig.conversion].name}（重新整理生效）`);
            refresh();
        }

        refresh();
    }

    // --- 日誌：把大量 noisy 訊息降級或合併輸出 ---
    function safeLog(level, msg) {
        // level: 'info'|'warn'|'error'
        try {
            if (level === 'info') console.info(msg);
            else if (level === 'warn') console.warn(msg);
            else console.error(msg);
        } catch (e) {}
    }

    // --- 初始化 ---
    (async function main() {
        await loadConfig();
        registerMenu();
        if (!state.userConfig.enabled) {
            safeLog('info', '[OpenCC] 腳本已停用，未啟動轉換器');
            return;
        }
        try {
            state.converter = await OpenCC.createConverter(state.userConfig.conversion);
            convertPage();
            startObserver();
            safeLog('info', '[OpenCC] 初始化完成');
        } catch (e) {
            safeLog('error', `[OpenCC] 初始化失敗：${e && e.message ? e.message : e}`);
        }
    })();

})();
