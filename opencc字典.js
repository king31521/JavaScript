// ==UserScript==
// @name         繁體中文（台灣）自動轉換
// @name:zh-TW   繁體中文（台灣）自動轉換
// @name:zh-CN   繁体中文（台湾）自动转换
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自動將網頁中的簡體字轉換為繁體中文（台灣正體），基於 OpenCC，並能高效、穩定地翻譯動態內容，避免干擾用戶輸入和頁面加載。
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
        phrases: 'https://raw.githubusercontent.com/king31521/JavaScript/refs/heads/main/STPhrases.txt',
        chars: 'https://raw.githubusercontent.com/king31521/JavaScript/refs/heads/main/STCharacters.txt'
    };
    const CACHE_KEY_PREFIX = 'opencc_st_cache_';
    const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7天

    // --- 字典管理器 (此部分邏輯健全，無需修改) ---
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
        },

        _parseDict(text, map, isCharDict) {
            if (!text) return;
            text.split('\n').forEach(line => {
                if (!line.trim()) return;
                const parts = line.split('\t');
                if (parts.length < 2) return;
                const [key, value] = parts;
                const firstValue = value.split(' ')[0];
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
                    onload: response => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.responseText);
                        } else {
                            reject(new Error(`Failed to fetch ${url}, status: ${response.status}`));
                        }
                    },
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

    // --- 翻譯核心 (此部分邏輯健全，無需修改) ---
    const translator = {
        phraseMap: null,
        charMap: null,
        sortedPhraseKeys: [],

        init(phraseMap, charMap) {
            this.phraseMap = phraseMap;
            this.charMap = charMap;
            this.sortedPhraseKeys = [...this.phraseMap.keys()].sort((a, b) => b.length - a.length);
        },

        translate(text) {
            if (!this.phraseMap || !this.charMap || !text || typeof text !== 'string') {
                return text;
            }
            let result = '';
            let i = 0;
            const len = text.length;
            while (i < len) {
                let found_phrase = false;
                for (const key of this.sortedPhraseKeys) {
                    if (text.substring(i, i + key.length) === key) {
                        result += this.phraseMap.get(key);
                        i += key.length;
                        found_phrase = true;
                        break;
                    }
                }
                if (found_phrase) continue;

                const char = text[i];
                result += this.charMap.get(char) || char;
                i++;
            }
            return result;
        }
    };

    // --- DOM 處理器 (已重構) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        translateNode(node) {
            if (!node) return;

            // 遍歷節點樹
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);

            let currentNode;
            while (currentNode = walker.nextNode()) {
                if (currentNode.nodeType === Node.ELEMENT_NODE) {
                    // 檢查是否應忽略此元素及其子元素
                    if (this.ignoredTags.has(currentNode.tagName) || currentNode.isContentEditable) {
                        // 跳過此節點的所有子節點
                        let child = walker.firstChild();
                        while (child) {
                            child = walker.nextSibling();
                        }
                        continue;
                    }
                    // 翻譯元素的屬性
                    for (const attr of this.translatableAttributes) {
                        if (currentNode.hasAttribute(attr)) {
                            const originalValue = currentNode.getAttribute(attr);
                            const translatedValue = translator.translate(originalValue);
                            if (originalValue !== translatedValue) {
                                currentNode.setAttribute(attr, translatedValue);
                            }
                        }
                    }
                } else if (currentNode.nodeType === Node.TEXT_NODE) {
                    // 翻譯文本節點
                    const originalText = currentNode.nodeValue;
                    if (originalText && originalText.trim().length > 0) {
                        const translatedText = translator.translate(originalText);
                        if (originalText !== translatedText) {
                            currentNode.nodeValue = translatedText;
                        }
                    }
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

    // --- 主執行流程 (已重構) ---
    async function main() {
        try {
            await dictionaryManager.load();
            translator.init(dictionaryManager.phraseMap, dictionaryManager.charMap);

            console.log("繁中轉換：開始初次頁面翻譯...");
            domTranslator.translateNode(document.body);
            console.log("繁中轉換：初次翻譯完成。");

            // 待處理節點的集合
            const nodesToProcess = new Set();

            // 創建一個 Debounced 翻譯函數
            const debouncedTranslate = debounce(() => {
                // 複製集合內容並清空原集合，避免在處理時又被修改
                const nodes = [...nodesToProcess];
                nodesToProcess.clear();
                
                // console.log(`繁中轉換：處理 ${nodes.length} 個變更節點...`);
                for (const node of nodes) {
                    // 確保節點仍然在文檔中
                    if (document.body.contains(node)) {
                        domTranslator.translateNode(node);
                    }
                }
            }, 500); // 500ms 的延遲，可以根據需要調整

            const observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    // 處理新增的節點
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            // 只添加元素節點或有內容的文本節點的父節點
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                nodesToProcess.add(node);
                            } else if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
                                nodesToProcess.add(node.parentElement);
                            }
                        }
                    }
                    // 處理文本內容的變化
                    else if (mutation.type === 'characterData') {
                        // characterData 的 target 是文本節點本身，所以我們要處理其父元素
                        if (mutation.target.parentElement) {
                            nodesToProcess.add(mutation.target.parentElement);
                        }
                    }
                }

                // 如果有待處理的節點，觸發 debounced 函數
                if (nodesToProcess.size > 0) {
                    debouncedTranslate();
                }
            });

            observer.observe(document.body, {
                childList: true,      // 監聽子節點的增刪
                subtree: true,          // 監聽所有後代節點
                characterData: true   // 監聽文本內容的變化
            });

            console.log("繁中轉換：已啟動高效能即時翻譯監聽。");

        } catch (error) {
            console.error("繁中轉換腳本出錯:", error);
        }
    }

    // 啟動腳本
    main();

})();
