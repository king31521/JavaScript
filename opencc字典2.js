// ==UserScript==
// @name         網頁簡轉繁 (OpenCC) - 最終合併版 v2.1 (NPM字典源)
// @namespace    https://github.com/seyhn/opencc-web-extension
// @version      2.1
// @description  基於 OpenCC 實現的網頁繁簡轉換，自動處理動態載入內容。已將字典來源切換至 JSDelivr NPM。
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
        // 字典檔案的 CDN 來源，指向 JSDelivr 上的 NPM 套件 'opencc'
        dictBaseUrls: [
            'https://www.jsdelivr.com/package/npm/opencc?tab=files&path=data%2Fdictionary/',
            'https://fastly.jsdelivr.net/npm/opencc?tab=files&path=data%2Fdictionary/', // JSDelivr 備援
        ],
        // 可用的轉換模式及其所需的字典
        conversionChains: {
            's2t':   { name: '簡體到繁體', dicts: ['STPhrases', 'STCharacters'] },
            't2s':   { name: '繁體到簡體', dicts: ['TSPhrases', 'TSCharacters'] },
            's2tw':  { name: '簡體到臺灣正體', dicts: ['STPhrases', 'STCharacters', 'TWVariants'] },
            'tw2s':  { name: '臺灣正體到簡體', dicts: ['TWVariantsRev', 'TSPhrases', 'TSCharacters'] },
            's2hk':  { name: '簡體到香港繁體', dicts: ['STPhrases', 'STCharacters', 'HKVariants'] },
            'hk2s':  { name: '香港繁體到簡體', dicts: ['HKVariantsRev', 'TSPhrases', 'TSCharacters'] },
            's2twp': { name: '簡體到臺灣正體(含地區詞)', dicts: ['STPhrases', 'STCharacters', 'TWPhrasesIT', 'TWPhrasesName', 'TWVariants'] },
            'tw2sp': { name: '臺灣正體(含地區詞)到簡體', dicts: ['TWVariantsRev', 'TWPhrasesITRev', 'TWPhrasesNameRev', 'TSPhrases', 'TSCharacters']}
        },
        // 預設轉換模式
        defaultConversion: 's2twp',
        // 腳本是否預設啟用
        defaultEnabled: true,
        // 儲存設定的鍵值
        storageKeys: {
            config: 'opencc_config',
            dictCache: 'opencc_dict_cache_'
        },
        // MutationObserver 的延遲執行時間 (毫秒)，防止頻繁觸發
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

    // --- OpenCC 核心引擎 ---
    const OpenCC = {
        async createConverter(chain) {
            console.log(`[OpenCC] 開始建立轉換器: ${chain.name}`);
            const dicts = await this.loadDictionaries(chain.dicts);
            const conversionMap = this.buildConversionMap(dicts);
            console.log(`[OpenCC] 轉換器建立成功，載入 ${conversionMap.size} 個詞條。`);
            return (text) => this.convert(text, conversionMap);
        },

        async loadDictionaries(dictNames) {
            const dictPromises = dictNames.map(name => this.fetchDictionaryWithCache(name));
            return Promise.all(dictPromises);
        },

        async fetchDictionaryWithCache(name) {
            const cacheKey = CONFIG.storageKeys.dictCache + name;
            const cachedDict = await GM_getValue(cacheKey);
            if (cachedDict) {
                // console.log(`[OpenCC] 從快取載入字典: ${name}`);
                return cachedDict;
            }

            console.log(`[OpenCC] 開始從網路載入字典: ${name}`);
            for (const baseUrl of CONFIG.dictBaseUrls) {
                try {
                    const url = baseUrl + name + '.txt';
                    const response = await this.httpRequest(url);
                    if (response.status === 200) {
                        console.log(`[OpenCC] 成功從 ${baseUrl} 取得字典: ${name}`);
                        const textData = response.responseText;
                        await GM_setValue(cacheKey, textData);
                        return textData;
                    }
                } catch (error) {
                    console.warn(`[OpenCC] 從 ${baseUrl} 載入 ${name} 失敗:`, error.message);
                }
            }
            throw new Error(`無法獲取字典 ${name} 從所有來源。`);
        },

        httpRequest(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: resolve,
                    onerror: reject,
                    ontimeout: reject
                });
            });
        },

        buildConversionMap(dicts) {
            const conversionMap = new Map();
            dicts.forEach(dictText => {
                const lines = dictText.split('\n');
                for (const line of lines) {
                    if (line.startsWith('#') || line.trim() === '') continue;
                    const parts = line.split('\t');
                    if (parts.length < 2) continue;
                    const [key, value] = parts;
                    // 後載入的字典會覆蓋先載入的
                    conversionMap.set(key, value.split(' ')[0]); // 只取第一個候選詞
                }
            });
            return conversionMap;
        },

        convert(text, conversionMap) {
            let convertedText = '';
            for (let i = 0; i < text.length; ++i) {
                // 簡易的最大正向匹配
                let matched = false;
                for (let len = Math.min(10, text.length - i); len > 0; --len) {
                    const segment = text.substr(i, len);
                    if (conversionMap.has(segment)) {
                        convertedText += conversionMap.get(segment);
                        i += len - 1;
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    convertedText += text[i];
                }
            }
            return convertedText;
        }
    };


    // --- DOM 處理 ---
    function convertPage() {
        if (!state.converter || state.isConverting) return;
        state.isConverting = true;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                // 忽略已處理、不可見、或在特定標籤內的節點
                if (state.processedNodes.has(node) || !node.nodeValue.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                const parent = node.parentNode;
                if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'TEXTAREA' || parent.isContentEditable)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const nodesToConvert = [];
        let currentNode;
        while ((currentNode = walker.nextNode())) {
            nodesToConvert.push(currentNode);
        }

        if (nodesToConvert.length > 0) {
            // console.log(`[OpenCC] 發現 ${nodesToConvert.length} 個新文字節點需要轉換。`);
            nodesToConvert.forEach(node => {
                node.nodeValue = state.converter(node.nodeValue);
                state.processedNodes.add(node);
            });
        }
        state.isConverting = false;
    }

    function startObserver() {
        if (state.observer) state.observer.disconnect();

        state.observer = new MutationObserver(mutations => {
            clearTimeout(state.convertTimeout);
            state.convertTimeout = setTimeout(() => {
                // 檢查是否有節點新增
                const hasAddedNodes = mutations.some(m => m.addedNodes.length > 0);
                if (hasAddedNodes) {
                    // console.log('[OpenCC] 偵測到網頁內容變動，準備進行增量轉換...');
                    convertPage();
                }
            }, CONFIG.debounceTime);
        });

        state.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log('[OpenCC] MutationObserver 已啟動，將自動轉換動態內容。');
    }

    // --- 初始化與控制 ---
    async function init() {
        if (!state.userConfig.enabled) {
            console.log('[OpenCC 簡轉繁] 腳本已停用。');
            return;
        }
        console.log('[OpenCC 簡轉繁] 腳本啟動...');

        try {
            const chain = CONFIG.conversionChains[state.userConfig.conversion || CONFIG.defaultConversion];
            state.converter = await OpenCC.createConverter(chain);
            convertPage();
            startObserver();
        } catch (error) {
            console.error('[OpenCC 簡轉繁] 建立轉換器失敗，腳本將停止運作。錯誤原因:', error);
        }
    }

    async function loadConfig() {
        const savedConfig = await GM_getValue(CONFIG.storageKeys.config, {});
        state.userConfig = {
            enabled: savedConfig.enabled ?? CONFIG.defaultEnabled,
            conversion: savedConfig.conversion ?? CONFIG.defaultConversion,
        };
    }

    async function saveConfig() {
        await GM_setValue(CONFIG.storageKeys.config, state.userConfig);
    }

    function registerMenu() {
        const enabledText = () => state.userConfig.enabled ? '✅ 停用自動轉換' : '☑️ 啟用自動轉換';
        const currentModeText = () => `🔄 切換模式 (當前: ${CONFIG.conversionChains[state.userConfig.conversion].name})`;

        // 使用陣列來管理選單 ID，方便統一更新
        let menuIds = [];

        // 重新註冊所有選單的函數
        const updateMenu = () => {
            // 先移除舊的選單命令
            menuIds.forEach(id => {
                if(typeof GM_unregisterMenuCommand === 'function') {
                    GM_unregisterMenuCommand(id);
                }
            });
            menuIds = [];

            // 重新註冊選單
            menuIds.push(GM_registerMenuCommand(enabledText(), toggleEnable, 'E'));
            menuIds.push(GM_registerMenuCommand('手动執行一次轉換', () => { if (state.converter) convertPage(); }, 'M'));
            menuIds.push(GM_registerMenuCommand(currentModeText(), switchConversion,'S'));
        };

        const toggleEnable = async () => {
            state.userConfig.enabled = !state.userConfig.enabled;
            await saveConfig();
            alert(`OpenCC 自動轉換已 ${state.userConfig.enabled ? '啟用' : '停用'}，重新整理頁面生效。`);
            updateMenu();
        };

        const switchConversion = async () => {
            const modes = Object.keys(CONFIG.conversionChains);
            const currentIndex = modes.indexOf(state.userConfig.conversion);
            const nextIndex = (currentIndex + 1) % modes.length;
            state.userConfig.conversion = modes[nextIndex];
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
