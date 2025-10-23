// ==UserScript==
// @name         繁體中文（台灣）自動轉換
// @name:zh-TW   繁體中文（台灣）自動轉換
// @name:zh-CN   繁体中文（台湾）自动转换
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  【速度優化】自動將網頁中的簡體字轉換為繁體中文（台灣正體）。採用「即時+延遲」雙通道策略，在提供瞬時翻譯的同時確保頁面加載穩定。
// @author       ChatGPT & YourName
// @match        *://*/*
// @exclude      *.gov.tw/*
// @exclude      *.edu.tw/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      raw.githubusercontent.com
// @license      MIT
// ==/UserScript==

(async function() {
    'use strict';

    // --- 配置 ---
    const DEBOUNCE_DELAY_MS = 100; // 將延遲從 500ms 縮短到 100ms，可以根據需要調整 (例如 50-150)
    const DICT_URLS = {
        phrases: 'https://raw.githubusercontent.com/king31521/JavaScript/refs/heads/main/STPhrases.txt',
        chars: 'https://raw.githubusercontent.com/king31521/JavaScript/refs/heads/main/STCharacters.txt'
    };
    const CACHE_KEY_PREFIX = 'opencc_st_cache_';
    const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7天

    // --- 字典管理器 (無需修改) ---
    const dictionaryManager = {
        phraseMap: new Map(),
        charMap: new Map(),
        async load() { /* ... 原始代碼 ... */ },
        _parseDict(text, map, isCharDict) { /* ... 原始代碼 ... */ },
        async _fetchDictionaries() { /* ... 原始代碼 ... */ },
        async _saveToCache() { /* ... 原始代碼 ... */ },
        async _loadFromCache() { /* ... 原始代碼 ... */ }
    };
    // 為了簡潔，此處省略 manager 的完整實現，請使用你已有的代碼

    // --- 翻譯核心 (無需修改) ---
    const translator = {
        phraseMap: null,
        charMap: null,
        sortedPhraseKeys: [],
        init(phraseMap, charMap) { /* ... 原始代碼 ... */ },
        translate(text) { /* ... 原始代碼 ... */ }
    };
    // 為了簡潔，此處省略 translator 的完整實現，請使用你已有的代碼

    // --- DOM 處理器 (無需修改) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),
        translateNode(node) { /* ... 原始代碼 ... */ }
    };
    // 為了簡潔，此處省略 translator 的完整實現，請使用你已有的代碼
    
    // --- 填充省略的代碼（將這些函數複製回腳本中） ---
    dictionaryManager.load = async function() {
        const cachedData = await this._loadFromCache();
        if (cachedData) {
            console.log('繁中轉換：從快取載入字典。');
            this.phraseMap = cachedData.phraseMap;
            this.charMap = cachedData.charMap;
            return;
        }
        console.log('繁中轉換：正在從網路獲取字典...');
        try {
            const [phrasesText, charsText] = await this._fetchDictionaries();
            this._parseDict(phrasesText, this.phraseMap, false);
            this._parseDict(charsText, this.charMap, true);
            await this._saveToCache();
            console.log('繁中轉換：字典獲取並快取成功。');
        } catch (error) {
            console.error('繁中轉換：獲取字典失敗，腳本可能無法正常工作。', error);
            throw error;
        }
    };
    dictionaryManager._parseDict = function(text, map, isCharDict) {
        if (!text) return;
        text.split('\n').forEach(line => {
            if (!line.trim()) return;
            const parts = line.split('\t');
            if (parts.length < 2) return;
            const [key, value] = parts;
            const firstValue = value.split(' ')[0];
            if (isCharDict && map.has(key)) return;
            map.set(key, firstValue);
        });
    };
    dictionaryManager._fetchDictionaries = async function() {
        const fetchPromise = (url) => new Promise((resolve, reject) => {
            GM_xmlhttpRequest({ method: 'GET', url: url, onload: r => (r.status >= 200 && r.status < 300) ? resolve(r.responseText) : reject(new Error(`Status ${r.status}`)), onerror: e => reject(e) });
        });
        return Promise.all([fetchPromise(DICT_URLS.phrases), fetchPromise(DICT_URLS.chars)]);
    };
    dictionaryManager._saveToCache = async function() {
        const data = { timestamp: Date.now(), phrases: [...this.phraseMap.entries()], chars: [...this.charMap.entries()] };
        await GM_setValue(CACHE_KEY_PREFIX + 'data', JSON.stringify(data));
    };
    dictionaryManager._loadFromCache = async function() {
        const json = await GM_getValue(CACHE_KEY_PREFIX + 'data', null);
        if (!json) return null;
        const data = JSON.parse(json);
        if (Date.now() - data.timestamp > CACHE_EXPIRATION_MS) return null;
        return { phraseMap: new Map(data.phrases), charMap: new Map(data.chars) };
    };
    translator.init = function(phraseMap, charMap) {
        this.phraseMap = phraseMap;
        this.charMap = charMap;
        this.sortedPhraseKeys = [...this.phraseMap.keys()].sort((a, b) => b.length - a.length);
    };
    translator.translate = function(text) {
        if (!this.phraseMap || !this.charMap || !text || typeof text !== 'string') return text;
        let result = '', i = 0, len = text.length;
        while (i < len) {
            let found_phrase = false;
            for (const key of this.sortedPhraseKeys) {
                if (text.substring(i, i + key.length) === key) {
                    result += this.phraseMap.get(key); i += key.length; found_phrase = true; break;
                }
            }
            if (found_phrase) continue;
            const char = text[i]; result += this.charMap.get(char) || char; i++;
        }
        return result;
    };
    domTranslator.translateNode = function(node) {
        if (!node) return;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
        let currentNode;
        while (currentNode = walker.nextNode()) {
            if (currentNode.nodeType === Node.ELEMENT_NODE) {
                if (this.ignoredTags.has(currentNode.tagName) || currentNode.isContentEditable) {
                    let child = walker.firstChild(); while (child) { child = walker.nextSibling(); } continue;
                }
                for (const attr of this.translatableAttributes) {
                    if (currentNode.hasAttribute(attr)) {
                        const v = currentNode.getAttribute(attr), t_v = translator.translate(v);
                        if (v !== t_v) currentNode.setAttribute(attr, t_v);
                    }
                }
            } else if (currentNode.nodeType === Node.TEXT_NODE) {
                const v = currentNode.nodeValue;
                if (v && v.trim().length > 0) {
                    const t_v = translator.translate(v);
                    if (v !== t_v) currentNode.nodeValue = t_v;
                }
            }
        }
    };


    // --- Debounce 防抖函數 ---
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // --- 主執行流程 (已重構成雙通道策略) ---
    async function main() {
        try {
            await dictionaryManager.load();
            translator.init(dictionaryManager.phraseMap, dictionaryManager.charMap);

            console.log("繁中轉換：開始初次頁面翻譯...");
            domTranslator.translateNode(document.body);
            console.log("繁中轉換：初次翻譯完成。");

            // 待處理節點的集合，用於延遲保障通道
            const nodesToProcess = new Set();
            
            // 創建一個 Debounced 翻譯函數 (延遲保障通道)
            const debouncedTranslate = debounce(() => {
                const nodes = [...nodesToProcess];
                nodesToProcess.clear();
                
                // console.log(`繁中轉換[延遲保障]：處理 ${nodes.length} 個變更節點...`);
                for (const node of nodes) {
                    if (document.body.contains(node)) {
                        domTranslator.translateNode(node);
                    }
                }
            }, DEBOUNCE_DELAY_MS);

            const observer = new MutationObserver(mutations => {
                let needsDebouncedRun = false;

                for (const mutation of mutations) {
                    // --- 1. 即時通道 ---
                    // 對於所有新增的節點，立即進行翻譯，以獲得最佳響應速度
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            // 只處理元素節點，文本節點會在遍歷時被處理
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // console.log("繁中轉換[即時]：翻譯新增節點", node);
                                domTranslator.translateNode(node);
                            }
                        }
                    }

                    // --- 2. 準備延遲保障通道 ---
                    // 無論是哪種變動，都將其目標節點加入待處理集合
                    if (mutation.type === 'childList') {
                        // childList 變動，將父節點加入處理
                        nodesToProcess.add(mutation.target);
                        needsDebouncedRun = true;

                    } else if (mutation.type === 'characterData') {
                        // 文字內容變動，將父元素加入處理
                        if (mutation.target.parentElement) {
                            nodesToProcess.add(mutation.target.parentElement);
                            needsDebouncedRun = true;
                        }
                    }
                }

                // 如果有任何需要延遲處理的節點，觸發 debounce
                if (needsDebouncedRun) {
                    debouncedTranslate();
                }
            });

            observer.observe(document.body, {
                childList: true,      // 監聽子節點的增刪
                subtree: true,        // 監聽所有後代節點
                characterData: true   // 監聽文本內容的變化
            });

            console.log("繁中轉換：已啟動【極速即時】翻譯監聽。");

        } catch (error) {
            console.error("繁中轉換腳本出錯:", error);
        }
    }

    // 啟動腳本
    main();

})();
