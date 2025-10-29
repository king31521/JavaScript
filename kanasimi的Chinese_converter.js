// ==UserScript==
// @name         網站簡轉繁 (專業版，支援動態內容)
// @namespace    https://github.com/your-repo/userscripts
// @version      1.2.1
// @description  自動將網頁中的簡體中文轉換為繁體中文，基於 opencc-js，高效支援 NGA、貼吧等動態加載內容的網站。
// @author       AI Engineer
// @match        *://*/*
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/cn2t.js
// @grant        none
// @license      MIT
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. 配置與初始化 ---

    // 檢查 OpenCC 庫是否成功加載
    if (typeof window.OpenCC === 'undefined') {
        console.error('Tampermonkey: OpenCC-JS library failed to load. Script will not run.');
        return;
    }

    // 將全局的 OpenCC 轉換函數賦值給一個常量，方便調用
    const converter = window.OpenCC;

    // 定義一個集合，存儲不需要轉換內容的 HTML 標籤名
    // SCRIPT/STYLE: 避免破壞代碼和樣式
    // TEXTAREA/INPUT: 避免干擾用戶輸入
    // PRE/CODE: 通常用於顯示代碼，不應轉換
    const ignoredTags = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'PRE', 'CODE']);

    // --- 2. 核心轉換函數 ---

    /**
     * 遞歸遍歷指定 DOM 節點，將其下的文本節點內容從簡體轉換為繁體。
     * @param {Node} node - 要進行轉換的起始 DOM 節點。
     */
    function convertNodeToTraditional(node) {
        // 如果是元素節點 (Element)
        if (node.nodeType === Node.ELEMENT_NODE) {
            // 如果是需要忽略的標籤，則直接返回，不處理其子節點
            if (ignoredTags.has(node.tagName.toUpperCase())) {
                return;
            }
            // 遍歷所有子節點，進行遞歸轉換
            for (const child of node.childNodes) {
                convertNodeToTraditional(child);
            }
        }
        // 如果是文本節點 (Text)
        else if (node.nodeType === Node.TEXT_NODE) {
            const originalText = node.nodeValue;
            // 執行轉換
            const convertedText = converter(originalText);
            // 僅在文本內容有變化時才更新 DOM，避免不必要的重繪 (repaint)
            if (originalText !== convertedText) {
                node.nodeValue = convertedText;
            }
        }
    }

    // --- 3. 動態內容監聽器 ---

    // 創建一個 MutationObserver 實例，當 DOM 發生變化時觸發回調
    const observer = new MutationObserver((mutationsList) => {
        // 遍歷所有發生的變動
        for (const mutation of mutationsList) {
            // 我們只關心 'childList' 類型的變動，即有新節點被添加
            if (mutation.type === 'childList') {
                // 遍歷所有被添加的新節點
                for (const addedNode of mutation.addedNodes) {
                    // 對每個新節點進行簡轉繁處理
                    convertNodeToTraditional(addedNode);
                }
            }
        }
    });

    // --- 4. 腳本執行入口 ---

    // 等待 DOM 結構完全加載，但不必等待圖片等資源
    document.addEventListener('DOMContentLoaded', () => {
        // a. 獲取頁面的根節點 `<html>`
        const targetNode = document.documentElement;
        if (!targetNode) return;
        
        // b. 首次全頁轉換：對整個頁面執行一次初始轉換
        console.log('Tampermonkey: Initial page conversion to Traditional Chinese.');
        convertNodeToTraditional(targetNode);

        // c. 開始監聽：配置並啟動 observer，監聽後續的所有動態變化
        observer.observe(targetNode, {
            childList: true, // 監聽子節點的增加或刪除
            subtree: true    // 監聽所有後代節點，而不僅僅是直接子節點
        });
        console.log('Tampermonkey: MutationObserver is now watching for dynamic content.');
    });

    // 頁面卸載時，斷開 observer 連接，釋放資源（良好實踐）
    window.addEventListener('beforeunload', () => {
        if (observer) {
            observer.disconnect();
            console.log('Tampermonkey: MutationObserver disconnected.');
        }
    });

})();
