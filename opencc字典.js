// ==UserScript==
// @name         繁體中文（台灣）自動轉換 (性能與動態兼容版)
// @name:zh-TW   繁體中文（台灣）自動轉換 (性能與動態兼容版)
// @name:zh-CN   繁体中文（台湾）自动转换 (性能与动态兼容版)
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  【終極版】兼顧極致性能與動態內容即時翻譯。為Gmail、論壇等各類網站優化，徹底解決卡頓與漏翻問題。採用Trie樹+精準監聽，字典永久快取。
// @author       YourName & Optimized by AI
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
    const TRANSLATED_MARKER = 'data-translated';

    // --- 字典管理器 (與v5.0相同) ---
    const dictionaryManager = {
        async load() {
            const cached = await this._loadFromCache();
            if (cached) return cached;
            console.log('繁中轉換：首次運行或快取清除，正在從網路獲取字典...');
            try {
                const [phrasesText, charsText] = await this._fetchDictionaries();
                const dictionaries = {
                    phraseMap: this._parseDict(phrasesText),
                    charMap: this._parseDict(charsText, true)
                };
                await this._saveToCache(dictionaries);
                console.log('繁中轉換：字典已成功獲取並永久快取。');
                return dictionaries;
            } catch (error) {
                console.error('繁中轉換：獲取字典失敗，腳本可能無法正常工作。', error);
                return null;
            }
        },
        _parseDict(text, isCharDict = false) {
            const map = new Map();
            if (!text) return map;
            text.split('\n').forEach(line => {
                const parts = line.split('\t');
                if (parts.length < 2) return;
                const [key, value] = parts;
                if (key) {
                    const firstValue = value.split(' ')[0];
                    if (!isCharDict || !map.has(key)) {
                        map.set(key, firstValue);
                    }
                }
            });
            return map;
        },
        _fetchDictionaries() {
            const fetchPromise = (url) => new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url: url,
                    onload: resp => (resp.status >= 200 && resp.status < 300) ? resolve(resp.responseText) : reject(new Error(`Fetch failed: ${url}, status: ${resp.status}`)),
                    onerror: err => reject(err)
                });
            });
            return Promise.all([fetchPromise(DICT_URLS.phrases), fetchPromise(DICT_URLS.chars)]);
        },
        async _saveToCache({phraseMap, charMap}) {
            const data = { timestamp: Date.now(), phrases: [...phraseMap.entries()], chars: [...charMap.entries()] };
            await GM_setValue(CACHE_KEY_PREFIX + 'data', JSON.stringify(data));
        },
        async _loadFromCache() {
            const json = await GM_getValue(CACHE_KEY_PREFIX + 'data', null);
            if (!json) return null;
            console.log('繁中轉換：已從永久快取載入字典。');
            const data = JSON.parse(json);
            return { phraseMap: new Map(data.phrases), charMap: new Map(data.chars) };
        }
    };

    // --- 翻譯核心 (與v5.0相同, 使用Trie樹) ---
    const translator = {
        charMap: null,
        trie: null,
        init(phraseMap, charMap) {
            this.charMap = charMap;
            this.trie = this._buildTrie(phraseMap);
        },
        _buildTrie(phraseMap) {
            const root = {};
            for (const [key, value] of phraseMap.entries()) {
                let node = root;
                for (const char of key) { node = node[char] || (node[char] = {}); }
                node.end = value;
            }
            return root;
        },
        translate(text) {
            if (!this.trie || !this.charMap || !text || typeof text !== 'string') return text;
            let result = '';
            let i = 0;
            const len = text.length;
            while (i < len) {
                let node = this.trie;
                let longestMatch = null;
                let phraseLength = 0;
                for (let j = i; j < len; j++) {
                    const char = text[j];
                    if (node[char]) {
                        node = node[char];
                        if (node.end) {
                            longestMatch = node.end;
                            phraseLength = j - i + 1;
                        }
                    } else {
                        break;
                    }
                }
                if (longestMatch) {
                    result += longestMatch;
                    i += phraseLength;
                } else {
                    const char = text[i];
                    result += this.charMap.get(char) || char;
                    i++;
                }
            }
            return result;
        }
    };

    // --- DOM 處理器 (邏輯修正) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        translateNode(node) {
            if (!node || node.nodeType === Node.COMMENT_NODE) return;

            // **【核心修正】** 不再檢查父級是否被翻譯，只處理傳入的節點本身。
            // `data-translated` 標記現在在 TreeWalker 內部作為單次任務的優化，而不是作為全局守衛。

            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
            let currentNode;

            while (currentNode = walker.nextNode()) {
                if (currentNode.nodeType === Node.ELEMENT_NODE) {
                    const el = currentNode;
                    // 在遍歷內部，如果遇到已標記的節點，則跳過其子樹，這是為了在單次大型翻譯任務中避免重複勞動。
                    if (el.hasAttribute(TRANSLATED_MARKER) || this.ignoredTags.has(el.tagName) || el.isContentEditable) {
                        let child = walker.firstChild();
                        while (child) { child = walker.nextSibling(); }
                        continue;
                    }
                    for (const attr of this.translatableAttributes) {
                        if (el.hasAttribute(attr)) {
                            const original = el.getAttribute(attr);
                            const translated = translator.translate(original);
                            if (original !== translated) el.setAttribute(attr, translated);
                        }
                    }
                } else if (currentNode.nodeType === Node.TEXT_NODE) {
                    const original = currentNode.nodeValue;
                    if (original && original.trim().length > 0) {
                        const translated = translator.translate(original);
                        if (original !== translated) currentNode.nodeValue = translated;
                    }
                }
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                node.setAttribute(TRANSLATED_MARKER, 'true');
            }
        }
    };

    // --- 主執行流程 ---
    async function main() {
        if (!/(\p{Script=Hani})+/u.test(document.body.innerText)) {
            console.log('繁中轉換：頁面未檢測到中文字符，腳本已停止。');
            return;
        }

        const dictionaries = await dictionaryManager.load();
        if (!dictionaries) return;
        translator.init(dictionaries.phraseMap, dictionaries.charMap);

        console.log("繁中轉換：初次翻譯開始...");
        domTranslator.translateNode(document.body);
        console.log("繁中轉換：初次翻譯完成，已啟動兼容動態內容的高效能監聽模式。");

        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                // **【邏輯修正】** 區分對待不同變動類型
                if (mutation.type === 'childList') {
                    // 對所有新增的節點，直接進行翻譯，解決論壇翻頁等問題
                    for (const node of mutation.addedNodes) {
                        domTranslator.translateNode(node);
                    }
                } else if (mutation.type === 'characterData') {
                    // 對於文本變動，只翻譯變動的那個節點，極致高效
                    const textNode = mutation.target;
                    // 確保父元素不是被忽略的類型
                    if (textNode && textNode.parentElement && !domTranslator.ignoredTags.has(textNode.parentElement.tagName)) {
                        const original = textNode.nodeValue;
                        const translated = translator.translate(original);
                        if (original !== translated) {
                            textNode.nodeValue = translated;
                        }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
