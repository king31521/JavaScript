// ==UserScript==
// @name         繁體中文（台灣）自動轉換 (終極兼容版)
// @name:zh-TW   繁體中文（台灣）自動轉換 (終極兼容版)
// @name:zh-CN   繁体中文（台湾）自动转换 (终极兼容版)
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  【終極版】監聽屬性變化，完美翻譯動態顯示內容(如NGA隱藏回復)！兼顧性能與兼容性，徹底解決卡頓與漏翻。採用Trie樹+精準監聽，字典永久快取。
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

    // --- 字典管理器 (與v5.1相同) ---
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

    // --- 翻譯核心 (與v5.1相同, 使用Trie樹) ---
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

    // --- DOM 處理器 (與v5.1相同) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        translateNode(node) {
            if (!node || node.nodeType === Node.COMMENT_NODE) return;

            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode: function(node) {
                    // 遍歷時，如果節點本身或其父節點被忽略，則過濾掉
                    if (node.nodeType === Node.TEXT_NODE) {
                        const parentTag = node.parentElement?.tagName;
                        if (parentTag && domTranslator.ignoredTags.has(parentTag)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (domTranslator.ignoredTags.has(node.tagName) || node.isContentEditable) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        // 如果節點已經被標記，則跳過，這是為了避免在一次大的翻譯任務中重複工作
                        if (node.hasAttribute(TRANSLATED_MARKER)) {
                           return NodeFilter.FILTER_REJECT;
                        }
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }, false);

            const nodesToProcess = [];
            let currentNode;
            while(currentNode = walker.nextNode()) {
                nodesToProcess.push(currentNode);
            }

            for (const n of nodesToProcess) {
                if (n.nodeType === Node.ELEMENT_NODE) {
                    for (const attr of this.translatableAttributes) {
                        if (n.hasAttribute(attr)) {
                            const original = n.getAttribute(attr);
                            const translated = translator.translate(original);
                            if (original !== translated) n.setAttribute(attr, translated);
                        }
                    }
                } else if (n.nodeType === Node.TEXT_NODE) {
                    const original = n.nodeValue;
                    if (original && original.trim().length > 0) {
                        const translated = translator.translate(original);
                        if (original !== translated) n.nodeValue = translated;
                    }
                }
            }
            if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute(TRANSLATED_MARKER)) {
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
        console.log("繁中轉換：初次翻譯完成，已啟動終極兼容模式監聽。");

        const observer = new MutationObserver(mutations => {
            // 使用請求動畫幀來批量處理變化，避免單次事件循環中過度渲染
            window.requestAnimationFrame(() => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            domTranslator.translateNode(node);
                        }
                    } else if (mutation.type === 'characterData') {
                        const textNode = mutation.target;
                        if (textNode.parentElement && !domTranslator.ignoredTags.has(textNode.parentElement.tagName)) {
                            const original = textNode.nodeValue;
                            const translated = translator.translate(original);
                            if (original !== translated) {
                                textNode.nodeValue = translated;
                            }
                        }
                    } else if (mutation.type === 'attributes') {
                        // **【核心修正】** 處理屬性變化，如 style="display: block"
                        const targetElement = mutation.target;
                        if (targetElement.nodeType === Node.ELEMENT_NODE) {
                            // 移除標記，以便重新翻譯
                            targetElement.removeAttribute(TRANSLATED_MARKER);
                            domTranslator.translateNode(targetElement);
                        }
                    }
                }
            });
        });
        
        // **【核心修正】** 在觀察器配置中增加對 style 和 class 屬性的監聽
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true, // 啟用屬性監聽
            attributeFilter: ['style', 'class'] // 只關心這兩個最關鍵的屬性
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
