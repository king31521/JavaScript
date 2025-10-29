// ==UserScript==
// @name         繁體中文（台灣）自動轉換 (引擎重構版)
// @name:zh-TW   繁體中文（台灣）自動轉換 (引擎重構版)
// @name:zh-CN   繁体中文（台湾）自动转换 (引擎重构版)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  【終極版：引擎重構】採用 kanasimi/Chinese_converter.js 作為翻譯核心，同時保留原腳本強大的動態內容監聽機制，實現性能與維護性的最佳平衡。
// @author       YourName & Refactored by Engineer
// @match        *://*/*
// @exclude      *.gov.tw/*
// @exclude      *.edu.tw/*
// @require      https://github.com/kanasimi/Chinese_converter/raw/refs/heads/master/Chinese_converter.js
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    // 使用一個屬性來標記已經處理過的節點，避免在 MutationObserver 中重複處理
    const TRANSLATED_MARKER = 'data-translated-by-script-v6';

    // --- DOM 處理器 (保留了原腳本高效的 DOM 遍歷邏輯) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        translateNode(node) {
            // 基礎驗證，過濾掉註解等無效節點
            if (!node || node.nodeType === Node.COMMENT_NODE) return;

            // 使用 TreeWalker 高效遍歷所有需要翻譯的文字節點和元素節點
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode: function(node) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        // 如果父元素是應被忽略的標籤，則跳過其下的文字節點
                        const parentTag = node.parentElement?.tagName;
                        if (parentTag && domTranslator.ignoredTags.has(parentTag)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        // 忽略特定標籤、可編輯區域以及已經標記過的節點
                        if (domTranslator.ignoredTags.has(node.tagName) || node.isContentEditable || node.hasAttribute(TRANSLATED_MARKER)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }, false);

            // 為避免在遍歷過程中修改 DOM 樹導致 walker 失效，先收集再處理
            const nodesToProcess = [];
            let currentNode;
            while(currentNode = walker.nextNode()) {
                nodesToProcess.push(currentNode);
            }

            // 批量處理收集到的節點
            for (const n of nodesToProcess) {
                if (n.nodeType === Node.ELEMENT_NODE) {
                    // 翻譯元素的指定屬性
                    for (const attr of this.translatableAttributes) {
                        if (n.hasAttribute(attr)) {
                            const original = n.getAttribute(attr);
                            // [核心替換] 使用 Chinese_converter.js 進行翻譯
                            const translated = Chinese_converter.toTrad(original);
                            if (original !== translated) n.setAttribute(attr, translated);
                        }
                    }
                } else if (n.nodeType === Node.TEXT_NODE) {
                    // 翻譯文字節點的內容
                    const original = n.nodeValue;
                    if (original && original.trim().length > 0) {
                         // [核心替換] 使用 Chinese_converter.js 進行翻譯
                        const translated = Chinese_converter.toTrad(original);
                        if (original !== translated) n.nodeValue = translated;
                    }
                }
            }

            // 為處理過的根節點打上標記，優化後續觀察器的性能
            if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute(TRANSLATED_MARKER)) {
                node.setAttribute(TRANSLATED_MARKER, 'true');
            }
        }
    };

    // --- 主執行流程 ---
    function main() {
        // 啟動前檢查頁面是否可能包含中文字符，做初步性能優化
        if (!/(\p{Script=Hani})+/u.test(document.body.innerText)) {
            console.log('繁中轉換：頁面未檢測到中文字符，腳本已停止。');
            return;
        }

        // 由於 @require 已將 Chinese_converter 加載，我們無需再進行任何初始化
        console.log("繁中轉換：引擎已載入，初次翻譯開始...");
        domTranslator.translateNode(document.body);
        console.log("繁中轉換：初次翻譯完成，已啟動動態內容監聽。");

        // 設置 MutationObserver 來監聽後續動態添加到頁面的內容
        const observer = new MutationObserver(mutations => {
            // 使用 requestAnimationFrame 進行防抖，將同一事件循環中的多次 DOM 變化合併到一次處理
            window.requestAnimationFrame(() => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        // 處理新增的節點
                        for (const node of mutation.addedNodes) {
                            domTranslator.translateNode(node);
                        }
                    } else if (mutation.type === 'characterData') {
                        // 處理文字內容的直接變化
                        const textNode = mutation.target;
                        if (textNode.parentElement && !domTranslator.ignoredTags.has(textNode.parentElement.tagName)) {
                            const original = textNode.nodeValue;
                            // [核心替換] 使用 Chinese_converter.js 進行翻譯
                            const translated = Chinese_converter.toTrad(original);
                            // 這裡需要特別注意，為避免無限循環的 characterData 觸發，
                            // 必須確保只有在內容確實不同的情況下才賦值。
                            if (original !== translated) {
                                // 由於我們是對 mutation.target 直接操作，必須先斷開觀察器，操作完再重連
                                // 雖然現代瀏覽器對此有優化，但這是最保險的做法。
                                // 不過，由於我們是在 requestAnimationFrame 裡，且有 if 判斷，風險極低，暫時省略 disconnect/reconnect。
                                textNode.nodeValue = translated;
                            }
                        }
                    } else if (mutation.type === 'attributes') {
                        // 處理因 style 或 class 變化而顯示的隱藏內容
                        const targetElement = mutation.target;
                        if (targetElement.nodeType === Node.ELEMENT_NODE) {
                            // 移除標記，強制對該節點及其子節點進行重新翻譯檢查
                            targetElement.removeAttribute(TRANSLATED_MARKER);
                            domTranslator.translateNode(targetElement);
                        }
                    }
                }
            });
        });

        // 啟動觀察器，配置與原腳本一致，監聽最常見的動態變化
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['style', 'class'] // 精準監聽 style 和 class 變化，覆蓋 NGA 隱藏回復等場景
        });
    }

    // 等待 DOM 加載完成後執行主程序
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
