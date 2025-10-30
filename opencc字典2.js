// ==UserScript==
// @name         網頁簡轉繁 (OpenCC) - 最終合併版
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  使用 OpenCC 將網頁從簡體轉換為繁體。此版本已內置轉換引擎，無需外部依賴，並修復了異體字轉換問題。
// @author       Your Name (Modified from OpenCC-JS)
// @match        *://*/*
// @exclude      *://*.google.com/*
// @exclude      *://*.bing.com/*
// @exclude      *://*.facebook.com/*
// @exclude      *://*.youtube.com/*
// @exclude      *://*.github.com/*
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    /******************************************************************************
     *  內置 OpenCC 轉換引擎 (版本 1.2.0, 可配置)
     ******************************************************************************/
    const OpenCC = (function() {
        const DEFAULT_DICT_BASE_URL = 'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/';
        const dictionaryCache = new Map();

        function Trie() { this.root = {}; }
        Trie.prototype.insert = function(word, value) {
            let node = this.root;
            for (const char of word) {
                if (!node[char]) { node[char] = {}; }
                node = node[char];
            }
            node.value = value;
            node.wordEnd = true;
        };
        Trie.prototype.convert = function(text) {
            let result = '';
            let i = 0;
            while (i < text.length) {
                let node = this.root;
                let j = i;
                let lastMatch = null;
                while (j < text.length && node[text[j]]) {
                    node = node[text[j]];
                    if (node.wordEnd) { lastMatch = { end: j, value: node.value }; }
                    j++;
                }
                if (lastMatch) {
                    result += lastMatch.value;
                    i = lastMatch.end + 1;
                } else {
                    result += text[i];
                    i++;
                }
            }
            return result;
        };

        async function fetchAndParseDict(dictName, baseUrl) {
            const cacheKey = `${baseUrl}:${dictName}`;
            if (dictionaryCache.has(cacheKey)) { return await dictionaryCache.get(cacheKey); }
            const fetchPromise = (async () => {
                const url = `${baseUrl}${dictName}.txt`;
                try {
                    const response = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: "GET",
                            url: url,
                            onload: resolve,
                            onerror: reject,
                            ontimeout: reject
                        });
                    });
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const text = response.responseText;
                    const lines = text.split('\n');
                    const dictData = [];
                    for (const line of lines) {
                        if (line.trim() === '' || line.startsWith('#')) continue;
                        const parts = line.split('\t');
                        if (parts.length >= 2) {
                            dictData.push([parts[0], parts[1].split(' ')[0]]);
                        }
                    }
                    return dictData;
                } catch (error) {
                    console.error(`無法獲取字典 ${dictName} 從 ${url}:`, error);
                    dictionaryCache.delete(cacheKey);
                    throw error;
                }
            })();
            dictionaryCache.set(cacheKey, fetchPromise);
            return fetchPromise;
        }

        function ConverterFactory(dictionaries) {
            const tries = dictionaries.map(dictData => {
                const trie = new Trie();
                for (const [key, value] of dictData) { trie.insert(key, value); }
                return trie;
            });
            return function(text) {
                return tries.reduce((currentText, trie) => trie.convert(currentText), text);
            };
        }

        const conversionChains = {
            's2t': ['STPhrases', 'STCharacters'],
            't2s': ['TSPhrases', 'TSCharacters'],
            's2tw': ['STPhrases', 'STCharacters', 'TWVariants'],
            'tw2s': ['TWVariantsRev', 'TSPhrases', 'TSCharacters'],
            's2twp': ['STPhrases', 'STCharacters', 'TWPhrases', 'TWVariants'],
            'tw2sp': ['TWVariantsRev', 'TWPhrasesRev', 'TSPhrases', 'TSCharacters'],
            's2hk': ['STPhrases', 'STCharacters', 'HKVariants'],
            'hk2s': ['HKVariantsRev', 'TSPhrases', 'TSCharacters'],
        };

        return {
            async createConverter(options) {
                const chainKey = `${options.from}2${options.to}`;
                const dictNames = conversionChains[chainKey];
                if (!dictNames) {
                    throw new Error(`未找到轉換鏈: from '${options.from}' to '${options.to}'`);
                }
                const baseUrl = options.dictPath || DEFAULT_DICT_BASE_URL;
                console.log(`[OpenCC] 開始從 ${baseUrl} 載入字典: ${dictNames.join(', ')}`);
                const dictionaries = await Promise.all(dictNames.map(name => fetchAndParseDict(name, baseUrl)));
                return ConverterFactory(dictionaries);
            }
        };
    })();


    /******************************************************************************
     *  您的腳本主邏輯
     ******************************************************************************/
    (async function() {
        console.log('[OpenCC 簡轉繁] 腳本啟動...');

        const DICT_BASE_URL = 'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/';
        const CONVERTER_OPTIONS = {
            from: 's',
            to: 'twp', // s2twp: 簡體 -> 台灣繁體 (含地區詞彙)
            dictPath: DICT_BASE_URL
        };

        let converter;
        try {
            converter = await OpenCC.createConverter(CONVERTER_OPTIONS);
            console.log('[OpenCC 簡轉繁] 轉換器建立成功！');
        } catch (error) {
            console.error('[OpenCC 簡轉繁] 建立轉換器失敗，腳本將停止運作。錯誤原因:', error);
            return; // 如果轉換器建立失敗，直接退出
        }

        const convertedNodes = new WeakSet();

        function convertText(text) {
            if (!text || !converter) return text;
            return converter(text);
        }

        function convertNode(node) {
            if (!node || convertedNodes.has(node)) {
                return;
            }

            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
            let textNode;
            const nodesToConvert = [];
            while (textNode = walker.nextNode()) {
                const parent = textNode.parentElement;
                if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE' && parent.tagName !== 'TEXTAREA' && !parent.isContentEditable) {
                    if (textNode.nodeValue.trim() !== '') {
                        nodesToConvert.push(textNode);
                    }
                }
            }

            for (const n of nodesToConvert) {
                if (convertedNodes.has(n)) continue;
                // 偵測是否有簡體字，避免不必要的轉換
                if (/[一-龥]/.test(n.nodeValue)) { // 簡單檢測，可以優化
                    const originalText = n.nodeValue;
                    const convertedText = convertText(originalText);
                    if (originalText !== convertedText) {
                        n.nodeValue = convertedText;
                    }
                }
                convertedNodes.add(n);
            }
            convertedNodes.add(node);
        }

        // 監控 DOM 變化，處理動態載入的內容
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            convertNode(node);
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            convertNode(node.parentElement);
                        }
                    }
                } else if (mutation.type === 'attributes') {
                     // 處理 NGA 這類透過改變 style 來顯示的隱藏內容
                    if (mutation.target.nodeType === Node.ELEMENT_NODE) {
                         // 避免重複轉換已經處理過的元素
                         if(!convertedNodes.has(mutation.target)){
                              convertNode(mutation.target);
                         }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class'] // 監控 style 和 class 的變化
        });

        // 初始執行一次
        convertNode(document.body);
        console.log('[OpenCC 簡轉繁] 頁面初始轉換完成，並已啟動監控。');

    })();
})();
