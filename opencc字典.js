// ==UserScript==
// @name         繁體中文（台灣）自動轉換 (性能重構版)
// @name:zh-TW   繁體中文（台灣）自動轉換 (性能重構版)
// @name:zh-CN   繁体中文（台湾）自动转换 (性能重构版)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  【性能重構】專為現代網頁應用（如Gmail）優化。透過標記防重、Trie樹算法、精準監聽，徹底解決卡頓問題。自動將簡體轉為繁體，字典永久快取。
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

    // --- 字典管理器 (永久快取) ---
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
            const data = {
                timestamp: Date.now(),
                phrases: [...phraseMap.entries()],
                chars: [...charMap.entries()]
            };
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

    // --- 翻譯核心 (使用Trie樹優化) ---
    const translator = {
        charMap: null,
        trie: null, // Trie樹用於詞語查找

        init(phraseMap, charMap) {
            this.charMap = charMap;
            this.trie = this._buildTrie(phraseMap);
        },

        // 構建Trie樹
        _buildTrie(phraseMap) {
            const root = {};
            for (const [key, value] of phraseMap.entries()) {
                let node = root;
                for (const char of key) {
                    node = node[char] || (node[char] = {});
                }
                node.end = value; // 在詞的結尾節點儲存翻譯值
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

                // 從當前位置i開始，在Trie樹中查找最長匹配的詞語
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

    // --- DOM 處理器 (已優化，增加標記防止重複) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        translateNode(node) {
            if (!node || node.nodeType === Node.COMMENT_NODE) return;

            // 檢查節點本身或其祖先節點是否已被翻譯，這是性能優化的關鍵
            if (node.nodeType === Node.ELEMENT_NODE && node.closest(`[${TRANSLATED_MARKER}]`)) {
                return;
            }

            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
            let currentNode;

            while (currentNode = walker.nextNode()) {
                if (currentNode.nodeType === Node.ELEMENT_NODE) {
                    const el = currentNode;
                    if (el.hasAttribute(TRANSLATED_MARKER) || this.ignoredTags.has(el.tagName) || el.isContentEditable) {
                        // 跳過已翻譯、被忽略或可編輯的元素及其所有子節點
                        let child = walker.firstChild();
                        while (child) { child = walker.nextSibling(); }
                        continue;
                    }

                    // 翻譯屬性
                    for (const attr of this.translatableAttributes) {
                        if (el.hasAttribute(attr)) {
                            const original = el.getAttribute(attr);
                            const translated = translator.translate(original);
                            if (original !== translated) el.setAttribute(attr, translated);
                        }
                    }
                } else if (currentNode.nodeType === Node.TEXT_NODE) {
                    // 翻譯文本節點
                    const original = currentNode.nodeValue;
                    if (original && original.trim().length > 0) {
                        const translated = translator.translate(original);
                        if (original !== translated) currentNode.nodeValue = translated;
                    }
                }
            }

            // 處理完成後，在根節點打上標記
            if (node.nodeType === Node.ELEMENT_NODE) {
                node.setAttribute(TRANSLATED_MARKER, 'true');
            }
        }
    };


    // --- 主執行流程 ---
    async function main() {
        // 前置檢查：如果頁面沒有簡體字，就不運行後續邏輯
        if (!/(\p{Script=Hani})+/u.test(document.body.innerText)) {
            console.log('繁中轉換：頁面未檢測到中文字符，腳本已停止。');
            return;
        }

        const dictionaries = await dictionaryManager.load();
        if (!dictionaries) return;

        translator.init(dictionaries.phraseMap, dictionaries.charMap);

        console.log("繁中轉換：初次翻譯開始...");
        domTranslator.translateNode(document.body);
        console.log("繁中轉換：初次翻譯完成，已啟動高效能監聽模式。");

        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                // 只處理新添加的節點
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        domTranslator.translateNode(node);
                    }
                }
                // 只處理文本內容的變更
                else if (mutation.type === 'characterData') {
                    domTranslator.translateNode(mutation.target.parentElement);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    // 延遲一點啟動，給頁面本身渲染留出時間
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }

})();
