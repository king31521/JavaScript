// ==UserScript==
// @name         網頁簡轉繁 (OpenCC)
// @name:en      Simplified to Traditional Chinese Converter (OpenCC)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  自動將網頁中的簡體中文轉換為繁體中文（台灣正體），並監聽頁面動態變化。
// @description:en Automatically converts Simplified Chinese on web pages to Traditional Chinese (Taiwan Standard) and monitors dynamic content changes.
// @author       YourName
// @match        *://*/*
// @grant        none
// @require      https://cdn.jsdelivr.net/gh/king31521/JavaScript@main/cn2t.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 因為 @require 已經預先加載了 opencc-js，所以 OpenCC 對象可以直接使用。
    // 創建 OpenCC 轉換器實例，從簡體（cn）轉換到台灣繁體（tw）。
    const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

    // 定義一個函數來遍歷並翻譯頁面上的文字節點
    function translateNode(node) {
        // 忽略的標籤列表，避免破壞頁面功能或樣式
        const ignoreTags = ['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE'];
        if (node.nodeType === Node.ELEMENT_NODE && ignoreTags.includes(node.tagName.toUpperCase())) {
            return;
        }

        // 遍歷所有子節點
        for (const childNode of node.childNodes) {
            // 如果是文字節點，直接進行轉換
            if (childNode.nodeType === Node.TEXT_NODE && childNode.nodeValue.trim() !== '') {
                childNode.nodeValue = converter(childNode.nodeValue);
            }
            // 如果是元素節點，遞歸調用
            else if (childNode.nodeType === Node.ELEMENT_NODE) {
                translateNode(childNode);
            }
        }
    }

    // 處理整個 Body 或特定節點的翻譯
    function translatePage(targetNode = document.body) {
        if (!targetNode) return;
        translateNode(targetNode);
        console.log('OpenCC: Page translated to Traditional Chinese.');
    }

    // 初始翻譯整個頁面
    translatePage();

    // 創建一個 MutationObserver 來監聽 DOM 的變化
    // 當頁面動態加載新內容時（例如 AJAX 加載、無限滾動），也能自動翻譯
    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    // 只處理新添加的元素節點
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        translateNode(node);
                    }
                }
            }
        }
    });

    // 配置觀察器選項：監聽子節點的添加和移除，並應用到整個子樹
    const observerConfig = {
        childList: true,
        subtree: true
    };

    // 開始觀察 document.body 的變化
    observer.observe(document.body, observerConfig);

})();