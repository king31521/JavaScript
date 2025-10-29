// ==UserScript==
// @name         網頁簡轉繁 (台灣正體 - 純字元轉換)
// @name:en      Simplified to Traditional Chinese (TW Variant, Char-only)
// @description  基於 Chinese_converter 的高性能網頁簡體轉繁體腳本，僅轉換字元，不處理地區詞彙。
// @description:en High-performance script to convert simplified Chinese to traditional Chinese on webpages, using Chinese_converter. Character-level conversion only, without phrase conversion.
// @version      2.0.0
// @namespace    https://gist.github.com/your-username
// @author       Your Name (Modified from king31521's script)
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/gh/kanasimi/Chinese_converter@latest/dist/chinese-converter.js
// ==/UserScript==

(function () {
    'use strict';

    // [MODIFIED] 移除原有的巨大 dic 物件和 opencc 函數

    // [MODIFIED] 使用 Chinese_converter 進行轉換
    // 選擇 's2t' 模式，實現純粹的簡體到繁體字符轉換，不進行詞彙替換
    const convert = (str) => {
        if (!str) return '';
        return ChineseConverter.convert(str, 's2t');
    };

    const ignoreNode = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'svg']);

    const traverse = (node) => {
        if (!node) {
            return;
        }

        // 避免重複轉換
        if (node.isConverted) {
            return;
        }

        const nodeName = node.nodeName.toUpperCase();
        if (ignoreNode.has(nodeName)) {
            node.isConverted = true;
            return;
        }

        // 處理元素節點
        if (node.nodeType === Node.ELEMENT_NODE) {
            // 處理 input 和 textarea 的 placeholder
            if (node.placeholder) {
                node.placeholder = convert(node.placeholder);
            }
            // 處理 input 的 value (僅限於按鈕類型)
            if (node.nodeName === 'INPUT' && (node.type === 'button' || node.type === 'submit')) {
                if (node.value) {
                    node.value = convert(node.value);
                }
            }
        }

        // 處理文本節點
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
            node.nodeValue = convert(node.nodeValue);
        }

        node.isConverted = true;

        // 遍歷子節點
        if (node.childNodes && node.childNodes.length > 0) {
            for (const child of node.childNodes) {
                traverse(child);
            }
        }
    };

    // 使用 MutationObserver 監控 DOM 變化
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    traverse(node);
                }
            }
        }
    });

    // 等待 DOMContentLoaded 後開始遍歷和監控
    document.addEventListener('DOMContentLoaded', () => {
        // 初始遍歷整個 body
        traverse(document.body);

        // 開始監控
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });

    // 處理在 DOMContentLoaded 之前就可能存在的 title
    const initialTitle = convert(document.title);
    if (document.title !== initialTitle) {
        document.title = initialTitle;
    }

    // 監控 title 變化
    new MutationObserver(() => {
        const newTitle = convert(document.title);
        if (document.title !== newTitle) {
            document.title = newTitle;
        }
    }).observe(document.querySelector('title'), {
        childList: true
    });

})();