// ==UserScript==
// @name         網頁簡轉繁 (OpenCC)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  使用 OpenCC 將網頁內文從簡體中文轉換為繁體中文，並支援動態載入內容的轉換。
// @author       Original Author & Modified by AI
// @match        *://*/*
// @exclude      *://*.google.com/*
// @exclude      *://*.bing.com/*
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @require      https://raw.githubusercontent.com/king31521/JavaScript/refs/heads/main/cn2t.js
// @run-at       document-idle
// ==/UserScript==

(async function() {
    'use strict';

    // 檢查 OpenCC 庫是否已成功載入
    if (typeof window.OpenCC === 'undefined') {
        console.error('Tampermonkey: OpenCC library failed to load via @require.');
        return;
    }

    // 字典 base URL
    const DICT_BASE = 'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/';

    // 設定轉換選項
    // s2t.json: 簡體 -> 繁體
    // s2tw.json: 簡體 -> 台灣正體
    // s2twp.json: 簡體 -> 台灣正體 (包含詞彙轉換)
    const ccOptions = { from: 's', to: 'twp', dictPath: DICT_BASE };

    let converter;

    // 異步獲取轉換器實例
    async function getConverter() {
        try {
            if (typeof window.OpenCC.createConverter === 'function') {
                return await window.OpenCC.createConverter(ccOptions);
            }
            if (typeof window.OpenCC.Converter === 'function') {
                return window.OpenCC.Converter(ccOptions);
            }
            if (typeof window.OpenCC === 'function') {
                return window.OpenCC(ccOptions);
            }
            throw new Error('Unknown OpenCC API shape');
        } catch (e) {
            console.error('Failed to create OpenCC converter:', e);
            throw e;
        }
    }

    // 執行文字轉換
    function convertText(s) {
        if (!s || !s.trim()) return s;
        if (!converter) return s; // 如果轉換器未準備好，則不轉換

        if (typeof converter === 'function') return converter(s);
        if (typeof converter.convert === 'function') return converter.convert(s);
        if (typeof converter.convertSync === 'function') return converter.convertSync(s);
        throw new Error('Unknown converter interface');
    }

    // 遍歷並轉換指定節點下的所有文字
    function translatePage(rootNode = document.body) {
        if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return;

        const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                // 排除 <script>, <style>, <textarea>, <input> 等標籤內的文字
                const parentTag = node.parentNode.nodeName.toLowerCase();
                if (['script', 'style', 'textarea', 'input', 'title'].includes(parentTag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                // 排除內容為空或只有空白的文字節點
                if (!node.nodeValue.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node;
        while (node = walker.nextNode()) {
            try {
                const originalText = node.nodeValue;
                const convertedText = convertText(originalText);
                if (originalText !== convertedText) {
                    node.nodeValue = convertedText;
                }
            } catch (err) {
                console.error('Text conversion error:', err);
            }
        }
    }

    // --- 主執行邏輯 ---

    // 1. 初始化轉換器
    try {
        converter = await getConverter();
        console.log('OpenCC converter loaded successfully.');
    } catch (e) {
        console.error('Aborting script due to converter initialization failure.');
        return;
    }

    // 2. 首次轉換整個頁面
    console.log('Performing initial page translation...');
    translatePage(document.body);

    // 3. 使用 MutationObserver 監聽後續 DOM 變化，以轉換動態載入的內容
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                // 只處理元素節點，因為 TreeWalker 會處理其下的文字節點
                if (node.nodeType === Node.ELEMENT_NODE) {
                    translatePage(node);
                }
            }
        }
    });

    // 開始監聽 body 的子節點和後代節點變化
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('MutationObserver is now watching for dynamic content.');

})();
