// ==UserScript==
// @name         網頁簡轉繁 (OpenCC) - s2twp only (NPM字典源)
// @namespace    https://github.com/seyhn/opencc-web-extension
// @version      1.0-s2twp
// @description  基於 OpenCC 實現的網頁繁簡轉換（僅保留 s2twp）；自動處理動態載入內容，並對 s2t 做向下相容處理。
// @author       AI-Enhanced & Community
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
        // 字典檔案的 CDN 來源，指向 JSDelivr 上的 OpenCC data dictionary
        dictBaseUrls: [
            'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
            'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/'
        ],
        // 僅保留 s2twp 的轉換鏈（順序會影響覆蓋）
        conversionChains: {
            's2twp': { name: '簡體到臺灣正體(含地區詞)', dicts: ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName'] }
        },
        // 預設轉換模式（保留向下相容）
        defaultConversion: 's2twp',
        // 腳本是否預設啟用
        defaultEnabled: true,
        // 儲存設定的鍵值
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

    // --- OpenCC 核心（只處理字典載入、解析、合併，並保留 s2twp 相容性） ---
    const OpenCC = {
        // 建立轉換器：接收 chain 物件（name, dicts）
        async createConverter(request) {
            // Normalize request: 支援字串、{from,to} 或 chain 物件
            const { chainKey, baseUrl } = normalizeRequest(request);
            const chain = CONFIG.conversionChains[chainKey];
            if (!chain) {
                throw new Error(`Conversion chain not found: ${chainKey}. Available chains: ${Object.keys(CONFIG.conversionChains).join(', ')}`);
            }
            console.log(`[OpenCC] 開始建立轉換器: ${chainKey} (${chain.name})`);
            const dictTexts = await this.loadDictionaries(chain.dicts, baseUrl);
            const conversionMap = this.buildConversionMap(dictTexts);
            console.log(`[OpenCC] 轉換器建立完成，載入 ${conversionMap.size} 個詞條`);
            return (text) => this.convert(text, conversionMap);
        },

        // 逐個載入字典（支援快取）
        async loadDictionaries(dictNames, customBaseUrl = null) {
            const promises = dictNames.map(n => this.fetchDictionaryWithCache(n, customBaseUrl));
            return Promise.all(promises);
        },

        // 先從 GM_getValue 讀取快取，否則使用 GM_xmlhttpRequest 嘗試多個來源
        async fetchDictionaryWithCache(name, customBaseUrl = null) {
            const cacheKey = CONFIG.storageKeys.dictCache + name;
            try {
                const cached = await GM_getValue(cacheKey);
                if (cached) {
                    // 已為純文字（原始 .txt 內容）
                    return cached;
                }
            } catch (e) {
                // ignore GM_getValue 錯誤，改為網路載入
            }

            const sources = customBaseUrl ? [customBaseUrl] : CONFIG.dictBaseUrls;
            let lastError = null;
            for (const baseUrl of sources) {
                const url = baseUrl + name + '.txt';
                try {
                    const resp = await httpRequest(url);
                    if (resp && resp.status === 200 && resp.responseText) {
                        const textData = resp.responseText;
                        try { await GM_setValue(cacheKey, textData); } catch (e) { /* ignore set error */ }
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

        // 建立一個合併映射：後載入字典覆蓋前載入字典
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

        // 最長匹配轉換（類似你原本的實作）
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
        // 如果直接傳入 chain 物件 (如 CONFIG.conversionChains['s2twp'])
        if (typeof request === 'object' && request !== null && request.name && request.dicts) {
            // 此情況直接找出與該 dicts 相匹配的 chainKey（若找不到則強制用 s2twp）
            const matchKey = Object.keys(CONFIG.conversionChains).find(k => {
                const arr1 = CONFIG.conversionChains[k].dicts;
                const arr2 = request.dicts || [];
                if (arr1.length !== arr2.length) return false;
                return arr1.every((v, i) => v === arr2[i]);
            });
            return { chainKey: matchKey || 's2twp', baseUrl: null };
        }

        // 如果傳入字串（如 's2t' 或 's2twp'）
        if (typeof request === 'string') {
            const key = request.trim().toLowerCase();
            if (key === 's2t' || key === 's2tw' || key === 's2twp') return { chainKey: 's2twp', baseUrl: null };
            // 若是其他字串，嘗試直接使用（但目前只有 s2twp 可用）
            return { chainKey: key, baseUrl: null };
        }

        // 如果傳入 {from:'s', to:'t'} 或 {from:'s', to:'twp', dictPath: '...'}
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
            return { chainKey: composed, baseUrl };
        }

        // 預設回退到 s2twp
        return { chainKey: 's2twp', baseUrl: null };
    }

    // --- DOM 處理（保持原腳本行為） ---
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
                    // individual node conversion error shouldn't stop others
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

    // --- 初始化與控制 ---
    async function init() {
        if (!state.userConfig.enabled) {
            console.log('[OpenCC] 腳本已停用');
            return;
        }
        try {
            // Resolve chain object from user setting (with compatibility)
            const userChoice = state.userConfig.conversion || CONFIG.defaultConversion;
            // Pass either string or chain object; createConverter 會 normalize
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
            state.userConfig = {
                enabled: saved.enabled ?? CONFIG.defaultEnabled,
                conversion: saved.conversion ?? CONFIG.defaultConversion
            };
        } catch (e) {
            state.userConfig = {
                enabled: CONFIG.defaultEnabled,
                conversion: CONFIG.defaultConversion
            };
        }
    }

    async function saveConfig() {
        try {
            await GM_setValue(CONFIG.storageKeys.config, state.userConfig);
        } catch (e) {
            // ignore
        }
    }

    function registerMenu() {
        const enabledText = () => state.userConfig.enabled ? '✅ 停用自動轉換' : '☑️ 啟用自動轉換';
        const currentModeText = () => `🔄 切換模式 (當前: ${CONFIG.conversionChains[state.userConfig.conversion || CONFIG.defaultConversion].name})`;

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
            // 只有 s2twp 可選，仍保留切換流程以免 UI 崩潰
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
