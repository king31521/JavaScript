// ==UserScript==
// @name         繁體中文（台灣）自動轉換
// @name:zh-TW   繁體中文（台灣）自動轉換
// @name:zh-CN   繁体中文（台湾）自动转换
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  自動將網頁中的簡體字轉換為繁體中文（台灣正體），基於 OpenCC 的 STCharacters 和 STPhrases 字典，並能即時翻譯動態載入的內容。
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
    const DICT_URLS = {
        phrases: 'https://raw.githubusercontent.com/BYVoid/OpenCC/refs/heads/master/data/dictionary/STPhrases.txt',
        chars: 'https://raw.githubusercontent.com/BYVoid/OpenCC/refs/heads/master/data/dictionary/STCharacters.txt'
    };
    const CACHE_KEY_PREFIX = 'opencc_st_cache_';
    const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7天

    // --- 字典管理器 ---
    const dictionaryManager = {
        phraseMap: new Map(),
        charMap: new Map(),

        async load() {
            const cachedData = await this._loadFromCache();
            if (cachedData) {
                console.log('繁中轉換：從快取載入字典。');
                this.phraseMap = cachedData.phraseMap;
                this.charMap = cachedData.charMap;
                return;
            }

            console.log('繁中轉換：正在從網路獲取字典...');
            const [phrasesText, charsText] = await this._fetchDictionaries();
            
            this._parseDict(phrasesText, this.phraseMap, false);
            this._parseDict(charsText, this.charMap, true); // true 表示這是單字字典，要處理重複鍵

            await this._saveToCache();
            console.log('繁中轉換：字典獲取並快取成功。');
        },

        _parseDict(text, map, isCharDict) {
            text.split('\n').forEach(line => {
                if (!line.trim()) return;
                const parts = line.split('\t');
                if (parts.length < 2) return;

                const [key, value] = parts;
                const firstValue = value.split(' ')[0]; // 取第一個候選詞

                // 對於單字字典，如果鍵已存在，則不覆蓋（實現「取第一個」的邏輯）
                if (isCharDict && map.has(key)) {
                    return;
                }
                map.set(key, firstValue);
            });
        },

        async _fetchDictionaries() {
            const fetchPromise = (url) => new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: response => resolve(response.responseText),
                    onerror: error => reject(error)
                });
            });

            return Promise.all([
                fetchPromise(DICT_URLS.phrases),
                fetchPromise(DICT_URLS.chars)
            ]);
        },

        async _saveToCache() {
            const dataToCache = {
                timestamp: Date.now(),
                phrases: [...this.phraseMap.entries()],
                chars: [...this.charMap.entries()]
            };
            await GM_setValue(CACHE_KEY_PREFIX + 'data', JSON.stringify(dataToCache));
        },

        async _loadFromCache() {
            const cachedJson = await GM_getValue(CACHE_KEY_PREFIX + 'data', null);
            if (!cachedJson) return null;

            const cachedData = JSON.parse(cachedJson);
            if (Date.now() - cachedData.timestamp > CACHE_EXPIRATION_MS) {
                console.log('繁中轉換：字典快取已過期。');
                return null;
            }

            return {
                phraseMap: new Map(cachedData.phrases),
                charMap: new Map(cachedData.chars)
            };
        }
    };

    // --- 翻譯核心 ---
    const translator = {
        phraseMap: null,
        charMap: null,
        sortedPhraseKeys: [],

        init(phraseMap, charMap) {
            this.phraseMap = phraseMap;
            this.charMap = charMap;
            // 將詞彙按長度降序排序，確保最大正向匹配
            this.sortedPhraseKeys = [...this.phraseMap.keys()].sort((a, b) => b.length - a.length);
        },

        translate(text) {
            if (!this.phraseMap || !this.charMap) return text;
            if (!text || typeof text !== 'string') return text;

            let result = '';
            let i = 0;
            const len = text.length;

            while (i < len) {
                let found = false;
                // 1. 嘗試匹配最長的詞彙
                for (const key of this.sortedPhraseKeys) {
                    if (text.substring(i, i + key.length) === key) {
                        result += this.phraseMap.get(key);
                        i += key.length;
                        found = true;
                        break;
                    }
                }

                if (found) continue;

                // 2. 如果沒有詞彙匹配，嘗試匹配單字
                const char = text[i];
                if (this.charMap.has(char)) {
                    result += this.charMap.get(char);
                } else {
                    // 3. 如果都沒有，保留原字
                    result += char;
                }
                i++;
            }
            return result;
        }
    };

    // --- DOM 處理器 ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']),

        translateNode(node) {
            if (!node || node.nodeType === Node.COMMENT_NODE) return;

            // 檢查是否已翻譯或在忽略列表中
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.dataset.translated === 'true' || this.ignoredTags.has(node.tagName) || node.isContentEditable) {
                    return;
                }
            }
            
            // 遍歷子節點
            const childNodes = Array.from(node.childNodes);
            for (const child of childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    const originalText = child.nodeValue;
                    if (originalText && originalText.trim().length > 0) {
                        const translatedText = translator.translate(originalText);
                        if (originalText !== translatedText) {
                           child.nodeValue = translatedText;
                        }
                    }
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    this.translateNode(child);
                }
            }

            // 標記已翻譯的元素
            if (node.nodeType === Node.ELEMENT_NODE) {
                node.dataset.translated = 'true';
            }
        }
    };

    // --- 主執行流程 ---
    async function main() {
        try {
            await dictionaryManager.load();
            translator.init(dictionaryManager.phraseMap, dictionaryManager.charMap);

            console.log("繁中轉換：開始初次頁面翻譯...");
            domTranslator.translateNode(document.body);
            console.log("繁中轉換：初次翻譯完成。");

            // --- 設置 MutationObserver 來監聽動態內容 ---
            const observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        // 只處理元素節點，文字節點會由其父元素處理
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            domTranslator.translateNode(node);
                        }
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            console.log("繁中轉換：已啟動即時翻譯監聽。");

        } catch (error) {
            console.error("繁中轉換腳本出錯:", error);
        }
    }

    // 啟動腳本
    main();

})();