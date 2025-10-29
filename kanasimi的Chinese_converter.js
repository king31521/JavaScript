// ==UserScript==
// @name         繁體中文（台灣）自動轉換 (OpenCC 終極版)
// @name:zh-TW   繁體中文（台灣）自動轉換 (OpenCC 終極版)
// @name:zh-CN   繁体中文（台湾）自动转换 (OpenCC 终极版)
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  【終極修正版】採用 kanasimi/opencc-js 作為翻譯核心，專為瀏覽器環境設計，純JS、無依賴、性能卓越。真正實現穩定可靠的繁簡轉換。
// @author       YourName & Refactored by Engineer
// @match        *://*/*
// @exclude      *.gov.tw/*
// @exclude      *.edu.tw/*
// @require      https://github.com/kanasimi/opencc-js/raw/master/dist/umd/full.js
// @resource     s2t_config https://github.com/kanasimi/opencc-js/raw/master/dist/umd/s2t.json
// @grant        GM_getResourceText
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const TRANSLATED_MARKER = 'data-translated-by-opencc-v7';

    // --- DOM 處理器 (保留了強大的 DOM 遍歷邏輯) ---
    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        translateNode(node, converter) {
            // 基礎驗證，確保節點和轉換器都有效
            if (!node || node.nodeType === Node.COMMENT_NODE || typeof converter !== 'function') {
                return;
            }

            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode: function(node) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const parentTag = node.parentElement?.tagName;
                        if (parentTag && domTranslator.ignoredTags.has(parentTag)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (domTranslator.ignoredTags.has(node.tagName) || node.isContentEditable || node.hasAttribute(TRANSLATED_MARKER)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }, false);

            const nodesToProcess = [];
            while (walker.nextNode()) {
                nodesToProcess.push(walker.currentNode);
            }

            for (const n of nodesToProcess) {
                if (n.nodeType === Node.ELEMENT_NODE) {
                    for (const attr of this.translatableAttributes) {
                        if (n.hasAttribute(attr)) {
                            const original = n.getAttribute(attr);
                            // [核心替換] 使用 opencc-js 實例進行翻譯
                            const translated = converter(original);
                            if (original !== translated) n.setAttribute(attr, translated);
                        }
                    }
                } else if (n.nodeType === Node.TEXT_NODE) {
                    const original = n.nodeValue;
                    if (original && original.trim().length > 0) {
                        // [核心替換] 使用 opencc-js 實例進行翻譯
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

    // --- 主執行流程 (異步初始化) ---
    async function main() {
        if (!/(\p{Script=Hani})+/u.test(document.body.innerText)) {
            console.log('繁中轉換：頁面未檢測到中文字符，腳本已停止。');
            return;
        }

        // --- [核心修正：異步初始化 OpenCC 轉換器] ---
        console.log("繁中轉換：正在初始化 OpenCC 引擎...");
        
        // 1. 從 @resource 異步讀取字典檔文本
        const s2t_config_text = GM_getResourceText('s2t_config');
        if (!s2t_config_text) {
            console.error('繁中轉換：無法加載 s2t.json 字典設定檔！腳本無法運行。');
            return;
        }
        
        // 2. 解析 JSON 設定並創建轉換器實例
        // OpenCC.Converter() 會返回一個可直接調用的翻譯函式
        const converter = OpenCC.Converter(JSON.parse(s2t_config_text));
        
        console.log("繁中轉換：引擎初始化成功，初次翻譯開始...");
        
        domTranslator.translateNode(document.body, converter);
        
        console.log("繁中轉換：初次翻譯完成，已啟動動態內容監聽。");

        // 設置 MutationObserver 來監聽後續動態變化
        const observer = new MutationObserver(mutations => {
            requestAnimationFrame(() => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            domTranslator.translateNode(node, converter);
                        }
                    } else if (mutation.type === 'characterData') {
                        const textNode = mutation.target;
                        if (textNode.parentElement && !domTranslator.ignoredTags.has(textNode.parentElement.tagName)) {
                            const original = textNode.nodeValue;
                            const translated = converter(original);
                            if (original !== translated) {
                                textNode.nodeValue = translated;
                            }
                        }
                    } else if (mutation.type === 'attributes') {
                        const targetElement = mutation.target;
                        if (targetElement.nodeType === Node.ELEMENT_NODE) {
                            targetElement.removeAttribute(TRANSLATED_MARKER);
                            domTranslator.translateNode(targetElement, converter);
                        }
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

    // 等待 DOM 加載完成後執行主程序
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
