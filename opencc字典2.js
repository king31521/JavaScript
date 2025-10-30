// ==UserScript==
// @name         網頁簡轉繁 (OpenCC) - 最終合併版 v2.2 (修復版)
// @namespace    https://github.com/seyhn/opencc-web-extension
// @version      2.2
// @description  基於 OpenCC 實現的網頁繁簡轉換，自動處理動態載入內容。修復不翻譯頁面的bug。
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
// @grant        GM_unregisterMenuCommand
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置區 ---
    const CONFIG = {
        // 字典檔案的 CDN 來源
        dictBaseUrls: [
            'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
            'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
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
        initializationComplete: false,
        menuIds: []
    };

    // --- OpenCC 核心引擎 ---
    const OpenCC = {
        async createConverter(chain) {
            console.log(`[OpenCC] 開始建立轉換器: ${chain.name}`);
            try {
                const dicts = await this.loadDictionaries(chain.dicts);
                const conversionMap = this.buildConversionMap(dicts);
                console.log(`[OpenCC] 轉換器建立成功，載入 ${conversionMap.size} 個詞條。`);
                return (text) => this.convert(text, conversionMap);
            } catch (error) {
                console.error(`[OpenCC] 建立轉換器失敗:`, error);
                throw error;
            }
        },

        async loadDictionaries(dictNames) {
            console.log(`[OpenCC] 載入字典: ${dictNames.join(', ')}`);
            const dictPromises = dictNames.map(name => this.fetchDictionaryWithCache(name));
            const results = await Promise.allSettled(dictPromises);
            
            const successfulDicts = [];
            const failedDicts = [];
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    successfulDicts.push(result.value);
                } else {
                    failedDicts.push(dictNames[index]);
                    console.warn(`[OpenCC] 字典載入失敗: ${dictNames[index]}`);
                }
            });
            
            if (successfulDicts.length === 0) {
                throw new Error('所有字典載入失敗');
            }
            
            if (failedDicts.length > 0) {
                console.warn(`[OpenCC] 部分字典載入失敗: ${failedDicts.join(', ')}`);
            }
            
            return successfulDicts;
        },

        async fetchDictionaryWithCache(name) {
            const cacheKey = CONFIG.storageKeys.dictCache + name;
            try {
                const cachedDict = await GM_getValue(cacheKey);
                if (cachedDict && typeof cachedDict === 'string' && cachedDict.length > 0) {
                    console.log(`[OpenCC] 從快取載入字典: ${name}`);
                    return cachedDict;
                }
            } catch (error) {
                console.warn(`[OpenCC] 讀取快取失敗: ${name}`, error);
            }

            console.log(`[OpenCC] 開始從網路載入字典: ${name}`);
            const errors = [];
            
            for (const baseUrl of CONFIG.dictBaseUrls) {
                try {
                    const url = baseUrl + name + '.txt';
                    const response = await this.httpRequest(url);
                    if (response.status === 200 && response.responseText) {
                        console.log(`[OpenCC] 成功從 ${baseUrl} 取得字典: ${name}`);
                        const textData = response.responseText;
                        try {
                            await GM_setValue(cacheKey, textData);
                        } catch (saveError) {
                            console.warn(`[OpenCC] 保存快取失敗: ${name}`, saveError);
                        }
                        return textData;
                    }
                } catch (error) {
                    errors.push(`${baseUrl}: ${error.message}`);
                    console.warn(`[OpenCC] 從 ${baseUrl} 載入 ${name} 失敗:`, error.message);
                }
            }
            throw new Error(`無法獲取字典 ${name}。錯誤: ${errors.join('; ')}`);
        },

        httpRequest(url) {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('請求超時'));
                }, 10000); // 10秒超時

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 10000,
                    onload: (response) => {
                        clearTimeout(timeout);
                        resolve(response);
                    },
                    onerror: (error) => {
                        clearTimeout(timeout);
                        reject(new Error('網路錯誤'));
                    },
                    ontimeout: () => {
                        clearTimeout(timeout);
                        reject(new Error('請求超時'));
                    }
                });
            });
        },

        buildConversionMap(dicts) {
            const conversionMap = new Map();
            let totalEntries = 0;
            
            dicts.forEach((dictText, index) => {
                if (!dictText || typeof dictText !== 'string') {
                    console.warn(`[OpenCC] 無效的字典數據: 索引 ${index}`);
                    return;
                }
                
                const lines = dictText.split('\n');
                let entries = 0;
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
                    
                    const parts = trimmedLine.split('\t');
                    if (parts.length < 2) continue;
                    
                    const [key, value] = parts;
                    if (key && value) {
                        // 後載入的字典會覆蓋先載入的
                        conversionMap.set(key, value.split(' ')[0]); // 只取第一個候選詞
                        entries++;
                    }
                }
                
                console.log(`[OpenCC] 字典 ${index + 1} 載入 ${entries} 個詞條`);
                totalEntries += entries;
            });
            
            console.log(`[OpenCC] 總共載入 ${totalEntries} 個詞條`);
            return conversionMap;
        },

        convert(text, conversionMap) {
            if (!text || typeof text !== 'string') return text;
            
            let convertedText = '';
            for (let i = 0; i < text.length; ++i) {
                // 簡易的最大正向匹配
                let matched = false;
                for (let len = Math.min(10, text.length - i); len > 0; --len) {
                    const segment = text.substring(i, i + len); // 修復: 使用 substring 替代已廢棄的 substr
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
        if (!state.converter || state.isConverting || !state.initializationComplete) {
            return;
        }
        
        state.isConverting = true;
        console.log('[OpenCC] 開始轉換頁面...');

        try {
            const walker = document.createTreeWalker(
                document.body || document.documentElement, 
                NodeFilter.SHOW_TEXT, 
                {
                    acceptNode: (node) => {
                        // 修復: 改進節點過濾邏輯
                        if (!node || !node.nodeValue || state.processedNodes.has(node)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        
                        const text = node.nodeValue.trim();
                        if (!text || text.length === 0) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        
                        const parent = node.parentNode;
                        if (!parent) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        
                        const tagName = parent.tagName;
                        if (tagName && ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'].includes(tagName)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        
                        if (parent.isContentEditable) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            const nodesToConvert = [];
            let currentNode;
            while ((currentNode = walker.nextNode())) {
                nodesToConvert.push(currentNode);
            }

            if (nodesToConvert.length > 0) {
                console.log(`[OpenCC] 發現 ${nodesToConvert.length} 個文字節點需要轉換。`);
                let convertedCount = 0;
                
                nodesToConvert.forEach(node => {
                    try {
                        const originalText = node.nodeValue;
                        const convertedText = state.converter(originalText);
                        
                        if (convertedText !== originalText) {
                            node.nodeValue = convertedText;
                            convertedCount++;
                        }
                        
                        state.processedNodes.add(node);
                    } catch (error) {
                        console.warn('[OpenCC] 轉換節點時發生錯誤:', error);
                    }
                });
                
                console.log(`[OpenCC] 完成轉換，共處理 ${convertedCount} 個節點`);
            } else {
                console.log('[OpenCC] 沒有發現需要轉換的新文字節點');
            }
        } catch (error) {
            console.error('[OpenCC] 轉換頁面時發生錯誤:', error);
        } finally {
            state.isConverting = false;
        }
    }

    function startObserver() {
        if (state.observer) {
            state.observer.disconnect();
        }

        state.observer = new MutationObserver(mutations => {
            clearTimeout(state.convertTimeout);
            state.convertTimeout = setTimeout(() => {
                // 檢查是否有節點新增
                const hasAddedNodes = mutations.some(m => m.addedNodes.length > 0);
                if (hasAddedNodes && state.initializationComplete) {
                    console.log('[OpenCC] 偵測到網頁內容變動，準備進行增量轉換...');
                    convertPage();
                }
            }, CONFIG.debounceTime);
        });

        if (document.body) {
            state.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            console.log('[OpenCC] MutationObserver 已啟動，將自動轉換動態內容。');
        } else {
            console.warn('[OpenCC] document.body 不存在，無法啟動 MutationObserver');
        }
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
            if (!chain) {
                throw new Error(`無效的轉換模式: ${state.userConfig.conversion}`);
            }
            
            console.log(`[OpenCC] 使用轉換模式: ${chain.name}`);
            state.converter = await OpenCC.createConverter(chain);
            state.initializationComplete = true;
            
            // 等待 DOM 完全載入
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => {
                        convertPage();
                        startObserver();
                    }, 100);
                });
            } else {
                setTimeout(() => {
                    convertPage();
                    startObserver();
                }, 100);
            }
            
            console.log('[OpenCC 簡轉繁] 初始化完成');
        } catch (error) {
            console.error('[OpenCC 簡轉繁] 建立轉換器失敗，腳本將停止運作。錯誤原因:', error);
            state.initializationComplete = false;
        }
    }

    async function loadConfig() {
        try {
            const savedConfig = await GM_getValue(CONFIG.storageKeys.config, {});
            state.userConfig = {
                enabled: savedConfig.enabled ?? CONFIG.defaultEnabled,
                conversion: savedConfig.conversion ?? CONFIG.defaultConversion,
            };
            console.log('[OpenCC] 配置載入完成:', state.userConfig);
        } catch (error) {
            console.error('[OpenCC] 載入配置失敗:', error);
            state.userConfig = {
                enabled: CONFIG.defaultEnabled,
                conversion: CONFIG.defaultConversion,
            };
        }
    }

    async function saveConfig() {
        try {
            await GM_setValue(CONFIG.storageKeys.config, state.userConfig);
            console.log('[OpenCC] 配置已保存:', state.userConfig);
        } catch (error) {
            console.error('[OpenCC] 保存配置失敗:', error);
        }
    }

    function registerMenu() {
        const enabledText = () => state.userConfig.enabled ? '✅ 停用自動轉換' : '☑️ 啟用自動轉換';
        const currentModeText = () => `🔄 切換模式 (當前: ${CONFIG.conversionChains[state.userConfig.conversion].name})`;

        // 重新註冊所有選單的函數
        const updateMenu = () => {
            // 先移除舊的選單命令
            state.menuIds.forEach(id => {
                if(typeof GM_unregisterMenuCommand === 'function') {
                    try {
                        GM_unregisterMenuCommand(id);
                    } catch (e) {
                        // 忽略錯誤
                    }
                }
            });
            state.menuIds = [];

            // 重新註冊選單
            try {
                state.menuIds.push(GM_registerMenuCommand(enabledText(), toggleEnable, 'E'));
                state.menuIds.push(GM_registerMenuCommand('手動執行一次轉換', manualConvert, 'M'));
                state.menuIds.push(GM_registerMenuCommand(currentModeText(), switchConversion,'S'));
                state.menuIds.push(GM_registerMenuCommand('🗑️ 清除字典快取', clearCache, 'C'));
            } catch (error) {
                console.error('[OpenCC] 註冊選單失敗:', error);
            }
        };

        const toggleEnable = async () => {
            state.userConfig.enabled = !state.userConfig.enabled;
            await saveConfig();
            alert(`OpenCC 自動轉換已 ${state.userConfig.enabled ? '啟用' : '停用'}，重新整理頁面生效。`);
            updateMenu();
        };

        const manualConvert = () => {
            if (state.converter && state.initializationComplete) {
                state.processedNodes = new WeakSet(); // 清除已處理標記
                convertPage();
                alert('手動轉換完成！');
            } else {
                alert('轉換器尚未準備好，請稍候再試。');
            }
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

        const clearCache = async () => {
            try {
                const dictNames = [];
                Object.values(CONFIG.conversionChains).forEach(chain => {
                    dictNames.push(...chain.dicts);
                });
                const uniqueDictNames = [...new Set(dictNames)];
                
                for (const name of uniqueDictNames) {
                    const cacheKey = CONFIG.storageKeys.dictCache + name;
                    await GM_setValue(cacheKey, null);
                }
                
                alert(`已清除 ${uniqueDictNames.length} 個字典的快取，重新整理頁面生效。`);
            } catch (error) {
                console.error('[OpenCC] 清除快取失敗:', error);
                alert('清除快取失敗，請檢查控制台錯誤訊息。');
            }
        };

        updateMenu();
    }

    // --- 腳本主入口 ---
    (async function main() {
        console.log('[OpenCC 簡轉繁] 腳本開始載入...');
        
        try {
            await loadConfig();
            registerMenu();
            
            // 確保在適當的時機初始化
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                await init();
            }
        } catch (error) {
            console.error('[OpenCC 簡轉繁] 主函數執行失敗:', error);
        }
    })();

})();
