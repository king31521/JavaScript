// ==UserScript==
// @name         網頁簡轉繁 (台灣正體 - 純字元轉換)
// @name:en      Simplified to Traditional Chinese (TW Variant, Char-only)
// @description  基於 Chinese_converter 的高性能網頁簡體轉繁體腳本，僅轉換字元，不處理地區詞彙。
// @description:en High-performance script to convert simplified Chinese to traditional Chinese on webpages, using Chinese_converter. Character-level conversion only, without phrase conversion.
// @version      2.0.1
// @namespace    https://greasyfork.org/users/12345
// @author       Your Name (Based on king31521's script)
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-start
//
// @require      https://cdn.jsdelivr.net/gh/kanasimi/Chinese_converter@latest/dist/chinese-converter.js
// @note         使用 jsDelivr CDN 加載 Chinese_converter 的 "分發(dist)" 版本。
// @note         這是標準做法，可確保腳本的性能、穩定性和跨區域可用性。
// @note         切勿直接引用 GitHub 上的源文件。
//
// ==/UserScript==

(function () {
    'use strict';

    // 依賴庫 ChineseConverter 通過 @require 注入，在此可直接使用。

    // 轉換函數: 調用 ChineseConverter API
    // 選用 's2t' 模式，實現簡體到繁體的純字符轉換，不包含地區詞彙修正。
    const convert = (str) => {
        if (!str || typeof str !== 'string') return str;
        return ChineseConverter.convert(str, 's2t');
    };

    // 節點黑名單，避免轉換這些標籤內的內容，防止破壞代碼或用戶輸入
    const ignoreNode = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'svg']);

    /**
     * 深度優先遍歷DOM節點並執行轉換
     * @param {Node} node - 起始節點
     */
    const traverse = (node) => {
        if (!node) {
            return;
        }

        // 使用自定義屬性標記已處理節點，避免重複轉換，提高性能
        if (node.isConverted) {
            return;
        }

        const nodeName = node.nodeName.toUpperCase();
        if (ignoreNode.has(nodeName)) {
            node.isConverted = true; // 同樣標記，防止子節點被意外遍歷
            return;
        }

        // 處理元素節點的屬性
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.placeholder) {
                node.placeholder = convert(node.placeholder);
            }
            if (node.nodeName === 'INPUT' && (node.type === 'button' || node.type === 'submit' || node.type === 'reset') && node.value) {
                node.value = convert(node.value);
            }
        }

        // 處理文本節點
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.trim()) {
            node.nodeValue = convert(node.nodeValue);
        }

        node.isConverted = true;

        // 遞歸遍歷子節點
        // 使用 node.childNodes 以包含所有類型的子節點（包括文本節點）
        if (node.childNodes && node.childNodes.length > 0) {
            for (const child of node.childNodes) {
                traverse(child);
            }
        }
    };

    // 使用 MutationObserver 監控後續動態加載的內容 (AJAX, SPA)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => traverse(node));
            }
        }
    });

    // 頁面加載完成後，執行首次全頁轉換並啟動監控
    document.addEventListener('DOMContentLoaded', () => {
        // 初始遍歷整個 body
        traverse(document.body);

        // 啟動監控，監聽子節點和整個子樹的變化
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });

    // 處理頁面標題 <title>
    // 初始標題可能在 DOMContentLoaded 之前就存在
    const initialTitle = convert(document.title);
    if (document.title !== initialTitle) {
        document.title = initialTitle;
    }

    // 監控 <title> 節點的變化（適用於單頁應用程序）
    new MutationObserver(() => {
        const newTitle = convert(document.title);
        // 檢查 document.title !== newTitle 避免無限循環觸發
        if (document.title !== newTitle) {
            document.title = newTitle;
        }
    }).observe(document.querySelector('title'), {
        childList: true
    });

})();
