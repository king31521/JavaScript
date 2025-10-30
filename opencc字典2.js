// ==UserScript==
// @name         網頁簡轉繁 (OpenCC) - s2twp only (NPM字典源) - fixed
// @namespace    https://github.com/seyhn/opencc-web-extension
// @version      1.1-s2twp-fixed
// @description  基於 OpenCC 實現的網頁繁簡轉換（僅保留 s2twp）；修正設定與模式映射以避免 Conversion chain not found 錯誤。
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

    // --- 配置區 ---
    const CONFIG = {
        dictBaseUrls: [
            'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
            'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/'
        ],
        // 僅保留 s2twp 的轉換鏈
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
    };

    // --- 內部狀態 ---
    let state = {
        converter: null,
        isConverting: false,
        observer: null,
        processedNodes: new WeakSet(),
        convertTimeout: null,
        userConfig: {},
    };

    // --- OpenCC 核心（僅載入字典、建立映射、做最長匹配轉換） ---
    const OpenCC = {
        async createConverter(request) {
            const { chainKey, baseUrl } = normalizeRequest(request);
            const chain = CONFIG.conversionChains[chainKey] || CONFIG.conversionChains[CONFIG.defaultConversion];
            console.log(`[OpenCC] 建立轉換器: ${chainKey} -> 使用 ${Object.keys(CONFIG.conversionChains).join(',')}`);
            const dictTexts = await this.loadDictionaries(chain.dicts, baseUrl);
            const conversionMap = this.buildConversionMap(dictTexts);
            console.log(`[OpenCC] 轉換器建立完成，載入 ${conversionMap.size} 個詞條`);
            return (text) => this.convert(text, conversionMap);
        },

        async loadDictionaries(dictNames, customBaseUrl = null) {
            const promises = dictNames.map(n => this.fetchDictionaryWithCache(n, customBaseUrl));
            return Promise.all(promises);
        },

        async fetchDictionaryWithCache(name, customBaseUrl = null) {
            const cacheKey = CONFIG.storageKeys.dictCache + name;
            try {
                const cached = await GM_getValue(cacheKey);
                if (cached) return cached;
            } catch (e) {
                // ignore
            }

            const sources = customBaseUrl ? [customBaseUrl] : CONFIG.dictBaseUrls;
            let lastError = null;
            for (const baseUrl of sources) {
                const url = baseUrl + name + '.txt';
                try {
                    const resp = await httpRequest(url);
                    if (resp && resp.status === 200 && resp.responseText) {
                        const textData = resp.responseText;
                        try { await GM_setValue(cacheKey, textData); } catch (e) {}
                        console.log(`[OpenCC] 成功載入字典 ${name} 從 ${baseUrl}`);
                        return textData;
                    }
                } catch (err) {
                    console.warn(`[OpenCC] 載入 ${name} 從 ${baseUrl} 失敗:`, err && err.message);
                    lastError = err;
                }
            }
            throw new Error(`無法獲取字典 ${name} 從所有來源。最後錯誤: ${lastError && lastError.message}`);
        },

        buildConversionMap(dictTexts) {
            const conversionMap = new Map();
            for (const text of dictTexts) {
                if (!text) continue;
                const lines = text.split('\n');
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line || line.startsWith('#')) continue;
                    const tabIndex = line.indexOf('\t');
                    if (tabIndex <= 0) continue;
                    const key = line.substring(0, tabIndex);
                    const valuesPart = line.substring(tabIndex + 1).trim();
                    if (!key || !valuesPart) continue;
                    const value = valuesPart.split(' ')[0];
                    if (value) conversionMap.set(key, value);
                }
            }
            return conversionMap;
        },

        convert(text, conversionMap) {
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
    };

    // Helper: 使用 GM_xmlhttpRequest 包裝為 Promise
    function httpRequest(url) {
        return new Promise((resolve, reject) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: resolve,
                    onerror: reject,
                    ontimeout: reject
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    // Normalize createConverter request into chainKey + optional baseUrl
    function normalizeRequest(request) {
        // If chain object provided: try to match by dicts array; else fallback to s2twp
        if (typeof request === 'object' && request !== null && request.dicts) {
            const matchKey = Object.keys(CONFIG.conversionChains).find(k => {
                const arr1 = CONFIG.conversionChains[k].dicts;
                const arr2 = request.dicts || [];
                if (arr1.length !== arr2.length) return false;
                return arr1.every((v, i) => v === arr2[i]);
            });
            return { chainKey: matchKey || 's2twp', baseUrl: request.dictPath || null };
        }

        // If string
        if (typeof request === 'string') {
            const key = request.trim().toLowerCase();
            if (key === 's2t' || key === 's2tw' || key === 's2twp') return { chainKey: 's2twp', baseUrl: null };
            // any unknown string -> fallback to s2twp
            return { chainKey: CONFIG.defaultConversion, baseUrl: null };
        }

        // If {from,to}
        if (typeof request === 'object' && request !== null && request.from && request.to) {
            const from = String(request.from).trim().toLowerCase();
            const to = String(request.to).trim().toLowerCase();
            const baseUrl = request.dictPath || request.dictpath || null;
            if (from === 's' && (to === 't' || to === 'tw' || to === 'twp')) {
                return { chainKey: 's2twp', baseUrl };
            }
            const composed = `${from}2${to}`;
            if (composed === 's2t' || composed === 's2tw' || composed === 's2twp') {
                return { chainKey: 's2twp', baseUrl };
            }
            return { chainKey: CONFIG.defaultConversion, baseUrl };
        }

        return { chainKey: CONFIG.defaultConversion, baseUrl: null };
    }

    // --- DOM 處理 ---
    function convertPage() {
        if (!state.converter || state.isConverting) return;
        state.isConverting = true;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (state.processedNodes.has(node) || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentNode;
                if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'TEXTAREA' || parent.isContentEditable)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const nodesToConvert = [];
        let n;
        while ((n = walker.nextNode())) nodesToConvert.push(n);

        if (nodesToConvert.length > 0) {
            nodesToConvert.forEach(node => {
                try {
                    node.nodeValue = state.converter(node.nodeValue);
                    state.processedNodes.add(node);
                } catch (e) {
                    console.error('[OpenCC] node convert error:', e);
                }
            });
        }
        state.isConverting = false;
    }

    function startObserver() {
        if (state.observer) state.observer.disconnect();
        state.observer = new MutationObserver(mutations => {
            clearTimeout(state.convertTimeout);
            state.convertTimeout = setTimeout(() => {
                const hasAdded = mutations.some(m => m.addedNodes && m.addedNodes.length > 0);
                if (hasAdded) convertPage();
            }, CONFIG.debounceTime);
        });
        state.observer.observe(document.body, { childList: true, subtree: true });
        console.log('[OpenCC] MutationObserver 已啟動');
    }

    // --- 初始化與控制（重要：在載入設定時標準化 conversion key） ---
    async function init() {
        if (!state.userConfig.enabled) {
            console.log('[OpenCC] 腳本已停用');
            return;
        }
        try {
            // userConfig.conversion 已在 loadConfig 時標準化為有效 key
            const userChoice = state.userConfig.conversion || CONFIG.defaultConversion;
            state.converter = await OpenCC.createConverter(userChoice);
            convertPage();
            startObserver();
            console.log('[OpenCC] 初始化完成');
        } catch (err) {
            console.error('[OpenCC] 建立轉換器失敗，腳本將停止運作。錯誤:', err);
        }
    }

    async function loadConfig() {
        try {
            const saved = await GM_getValue(CONFIG.storageKeys.config, {});
            const enabled = saved.enabled ?? CONFIG.defaultEnabled;
            let conversion = saved.conversion ?? CONFIG.defaultConversion;
            // Force-normalize conversion to supported key (coerce unknown keys -> s2twp)
            if (!conversion || !CONFIG.conversionChains[conversion]) {
                // Accept legacy values that should map to s2twp
                const convLower = String(conversion || '').trim().toLowerCase();
                if (convLower === 's2t' || convLower === 's2tw' || convLower === 's2twp') {
                    conversion = 's2twp';
                } else {
                    conversion = CONFIG.defaultConversion;
                }
            }
            state.userConfig = { enabled, conversion };
        } catch (e) {
            state.userConfig = { enabled: CONFIG.defaultEnabled, conversion: CONFIG.defaultConversion };
        }
    }

    async function saveConfig() {
        try {
            // Ensure saved conversion is a supported key
            if (!CONFIG.conversionChains[state.userConfig.conversion]) {
                state.userConfig.conversion = CONFIG.defaultConversion;
            }
            await GM_setValue(CONFIG.storageKeys.config, state.userConfig);
        } catch (e) {
            // ignore
        }
    }

    function registerMenu() {
        const getModeName = () => {
            const key = state.userConfig.conversion && CONFIG.conversionChains[state.userConfig.conversion] ? state.userConfig.conversion : CONFIG.defaultConversion;
            return CONFIG.conversionChains[key].name;
        };
        const enabledText = () => state.userConfig.enabled ? '✅ 停用自動轉換' : '☑️ 啟用自動轉換';
        const currentModeText = () => `🔄 切換模式 (當前: ${getModeName()})`;

        let menuIds = [];

        const updateMenu = () => {
            menuIds.forEach(id => {
                if (typeof GM_unregisterMenuCommand === 'function') {
                    try { GM_unregisterMenuCommand(id); } catch (e) {}
                }
            });
            menuIds = [];
            menuIds.push(GM_registerMenuCommand(enabledText(), toggleEnable, 'E'));
            menuIds.push(GM_registerMenuCommand('手动執行一次轉換', () => { if (state.converter) convertPage(); }, 'M'));
            menuIds.push(GM_registerMenuCommand(currentModeText(), switchConversion, 'S'));
        };

        const toggleEnable = async () => {
            state.userConfig.enabled = !state.userConfig.enabled;
            await saveConfig();
            alert(`OpenCC 自動轉換已 ${state.userConfig.enabled ? '啟用' : '停用'}，重新整理頁面生效。`);
            updateMenu();
        };

        const switchConversion = async () => {
            // 只有 s2twp 可選，將 userConfig.conversion 強制為 s2twp
            state.userConfig.conversion = 's2twp';
            await saveConfig();
            alert(`轉換模式已切換為: ${CONFIG.conversionChains[state.userConfig.conversion].name}，重新整理頁面生效。`);
            updateMenu();
        };

        updateMenu();
    }

    // --- 腳本主入口 ---
    (async function main() {
        await loadConfig();
        registerMenu();
        init();
    })();

})();
