// ==UserScript==
// @name         繁體中文（台灣）自動轉換 (極簡可靠版)
// @name:zh-TW   繁體中文（台灣）自動轉換 (極簡可靠版)
// @name:zh-CN   繁体中文（台湾）自动转换 (极简可靠版)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  【最終版 v8.0】採用 opencc-js 預編譯的 cn2t.js 作為核心。零外部依賴、同步初始化、極致簡潔可靠。
// @author       YourName & Refactored by Engineer
// @match        *://*/*
// @exclude      *.gov.tw/*
// @exclude      *.edu.tw/*
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/cn2t.js
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const TRANSLATED_MARKER = 'data-translated-by-opencc-v8';

    // --- DOM 處理器 (邏輯不變，保持高效) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        translateNode(node, converter) {
            if (!node || node.nodeType === Node.COMMENT_NODE || typeof converter !== 'function') {
                return;
            }

            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const parentTag = node.parentElement?.tagName;
                        if (parentTag && this.ignoredTags.has(parentTag)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (this.ignoredTags.has(node.tagName) || node.isContentEditable || node.hasAttribute(TRANSLATED_MARKER)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            // 先收集再處理，避免在遍歷中修改 DOM 引起的問題
            const nodesToProcess = [];
            while (walker.nextNode()) {
                nodesToProcess.push(walker.currentNode);
            }

            for (const n of nodesToProcess) {
                if (n.nodeType === Node.ELEMENT_NODE) {
                    for (const attr of this.translatableAttributes) {
                        if (n.hasAttribute(attr)) {
                            const original = n.getAttribute(attr);
                            const translated = converter(original);
                            if (original !== translated) n.setAttribute(attr, translated);
                        }
                    }
                } else if (n.nodeType === Node.TEXT_NODE) {
                    const original = n.nodeValue;
                    if (original?.trim()) { // 使用可選鍊(?.)和trim()簡化判斷
                        const translated = converter(original);
                        if (original !== translated) n.nodeValue = translated;
                    }
                }
            }

            if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute(TRANSLATED_MARKER)) {
                node.setAttribute(TRANSLATED_MARKER, 'true');
            }
        }
    };

    // --- 主執行流程 (同步，極簡化) ---
    function main() {
        if (!/(\p{Script=Hani})+/u.test(document.body.innerText)) {
            console.log('繁中轉換：頁面未檢測到中文字符，腳本已停止。');
            return;
        }

        // --- [核心修正：使用 cn2t.js 同步創建轉換器] ---
        // OpenCC.Converter() 在 cn2t.js 環境下是同步的，直接返回翻譯函式
        const converter = OpenCC.Converter();
        console.log("繁中轉換：自包含引擎 (cn2t) 初始化成功。");

        // 首次全頁翻譯
        domTranslator.translateNode(document.body, converter);
        console.log("繁中轉換：初次翻譯完成，已啟動動態內容監聽。");

        // 啟動 MutationObserver
        const observer = new MutationObserver(mutations => {
            // 使用 requestAnimationFrame 進行批量處理和防抖
            requestAnimationFrame(() => {
                for (const mutation of mutations) {
                    // 使用 switch 語句，邏輯更清晰
                    switch (mutation.type) {
                        case 'childList':
                            for (const node of mutation.addedNodes) {
                                domTranslator.translateNode(node, converter);
                            }
                            break;
                        case 'characterData':
                            const textNode = mutation.target;
                            // 確保父節點存在且不在忽略列表中
                            if (textNode.parentElement && !domTranslator.ignoredTags.has(textNode.parentElement.tagName)) {
                                const original = textNode.nodeValue;
                                const translated = converter(original);
                                if (original !== translated) {
                                    textNode.nodeValue = translated;
                                }
                            }
                            break;
                        case 'attributes':
                            const targetElement = mutation.target;
                            if (targetElement.nodeType === Node.ELEMENT_NODE) {
                                targetElement.removeAttribute(TRANSLATED_MARKER);
                                domTranslator.translateNode(targetElement, converter);
                            }
                            break;
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
