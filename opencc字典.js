// ==UserScript==
// @name         繁體中文（台灣）自動轉換
// @name:zh-TW   繁體中文（台灣）自動轉換
// @name:zh-CN   繁体中文（台湾）自动转换
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  【最終優化】自動將簡體轉為繁體。採用「即時+延遲」雙通道策略，瞬時翻譯、穩定防崩潰，且字典快取永久有效。
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
    const DEBOUNCE_DELAY_MS = 100; // 用於保障通道的延遲 (毫秒)
    const DICT_URLS = {
        phrases: 'https://raw.githubusercontent.com/king31521/JavaScript/refs/heads/main/STPhrases.txt',
        chars: 'https://raw.githubusercontent.com/king31521/JavaScript/refs/heads/main/STCharacters.txt'
    };
    const CACHE_KEY_PREFIX = 'opencc_st_cache_';
    // const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 已移除時間限制，此行不再需要

    // --- 字典管理器 (已修改為永久快取) ---
    const dictionaryManager = {
        phraseMap: new Map(),
        charMap: new Map(),

        async load() {
            const cachedData = await this._loadFromCache();
            if (cachedData) {
                // 不再提示從快取載入，因為這將是常態
                this.phraseMap = cachedData.phraseMap;
                this.charMap = cachedData.charMap;
                return;
            }

            console.log('繁中轉換：首次運行或快取被清除，正在從網路獲取字典...');
            try {
                const [phrasesText, charsText] = await this._fetchDictionaries();
                this._parseDict(phrasesText, this.phraseMap, false);
                this._parseDict(charsText, this.charMap, true);
                await this._saveToCache();
                console.log('繁中轉換：字典已成功獲取並永久快取。');
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
                if (isCharDict && map.has(key)) return;
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

        // 在儲存時，我們依然可以儲存時間戳，以備不時之需，但讀取時會忽略它
        async _saveToCache() {
            const dataToCache = {
                timestamp: Date.now(),
                phrases: [...this.phraseMap.entries()],
                chars: [...this.charMap.entries()]
            };
            await GM_setValue(CACHE_KEY_PREFIX + 'data', JSON.stringify(dataToCache));
        },

        // **核心修改點：移除時間檢查**
        async _loadFromCache() {
            const cachedJson = await GM_getValue(CACHE_KEY_PREFIX + 'data', null);
            if (!cachedJson) {
                return null; // 如果沒有快取，返回 null
            }
            
            // 快取存在，直接解析並返回，不再檢查時間戳
            console.log('繁中轉換：已從永久快取載入字典。');
            const cachedData = JSON.parse(cachedJson);
            
            return {
                phraseMap: new Map(cachedData.phrases),
                charMap: new Map(cachedData.chars)
            };
        }
    };

    // --- 翻譯核心 (無需修改) ---
    const translator = {
        phraseMap: null, charMap: null, sortedPhraseKeys: [],
        init(phraseMap, charMap) { this.phraseMap = phraseMap; this.charMap = charMap; this.sortedPhraseKeys = [...this.phraseMap.keys()].sort((a, b) => b.length - a.length); },
        translate(text) {
            if (!this.phraseMap || !this.charMap || !text || typeof text !== 'string') return text;
            let result = '', i = 0, len = text.length;
            while (i < len) {
                let found_phrase = false;
                for (const key of this.sortedPhraseKeys) { if (text.substring(i, i + key.length) === key) { result += this.phraseMap.get(key); i += key.length; found_phrase = true; break; } }
                if (found_phrase) continue;
                const char = text[i]; result += this.charMap.get(char) || char; i++;
            }
            return result;
        }
    };

    // --- DOM 處理器 (無需修改) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),
        translateNode(node) {
            if (!node) return;
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
            let currentNode;
            while (currentNode = walker.nextNode()) {
                if (currentNode.nodeType === Node.ELEMENT_NODE) {
                    if (this.ignoredTags.has(currentNode.tagName) || currentNode.isContentEditable) { let child = walker.firstChild(); while (child) { child = walker.nextSibling(); } continue; }
                    for (const attr of this.translatableAttributes) { if (currentNode.hasAttribute(attr)) { const v = currentNode.getAttribute(attr), t_v = translator.translate(v); if (v !== t_v) currentNode.setAttribute(attr, t_v); } }
                } else if (currentNode.nodeType === Node.TEXT_NODE) {
                    const v = currentNode.nodeValue;
                    if (v && v.trim().length > 0) { const t_v = translator.translate(v); if (v !== t_v) currentNode.nodeValue = t_v; }
                }
            }
        }
    };

    // --- Debounce 防抖函數 ---
    function debounce(func, delay) {
        let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); };
    }

    // --- 主執行流程 (無需修改) ---
    async function main() {
        try {
            await dictionaryManager.load();
            translator.init(dictionaryManager.phraseMap, dictionaryManager.charMap);

            domTranslator.translateNode(document.body);
            console.log("繁中轉換：初次翻譯完成，已啟動【極速即時 & 永久快取】監聽。");

            const nodesToProcess = new Set();
            const debouncedTranslate = debounce(() => {
                const nodes = [...nodesToProcess]; nodesToProcess.clear();
                for (const node of nodes) { if (document.body.contains(node)) domTranslator.translateNode(node); }
            }, DEBOUNCE_DELAY_MS);

            const observer = new MutationObserver(mutations => {
                let needsDebouncedRun = false;
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) { if (node.nodeType === Node.ELEMENT_NODE) domTranslator.translateNode(node); }
                    }
                    if (mutation.type === 'childList') { nodesToProcess.add(mutation.target); needsDebouncedRun = true; }
                    else if (mutation.type === 'characterData') { if (mutation.target.parentElement) { nodesToProcess.add(mutation.target.parentElement); needsDebouncedRun = true; } }
                }
                if (needsDebouncedRun) debouncedTranslate();
            });

            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        } catch (error) {
            console.error("繁中轉換腳本出錯:", error);
        }
    }

    main();

})();
