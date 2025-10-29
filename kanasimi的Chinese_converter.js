// ==UserScript==
// @name         繁體中文（台灣）自動轉換 (引擎修正版)
// @name:zh-TW   繁體中文（台灣）自動轉換 (引擎修正版)
// @name:zh-CN   繁体中文（台湾）自动转换 (引擎修正版)
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  【修正版 v6.1】採用 kanasimi/Chinese_converter.js 作為翻譯核心。已修正 API 調用方式，確保腳本正常工作。
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

    const TRANSLATED_MARKER = 'data-translated-by-script-v6-1';

    const domTranslator = {
        ignoredTags: new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']),
        translatableAttributes: new Set(['title', 'placeholder', 'alt']),

        // 接收一個已經實例化的 converter
        translateNode(node, converter) {
            if (!node || node.nodeType === Node.COMMENT_NODE || !(converter && typeof converter.toTrad === 'function')) {
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
            let currentNode;
            while(currentNode = walker.nextNode()) {
                nodesToProcess.push(currentNode);
            }

            for (const n of nodesToProcess) {
                if (n.nodeType === Node.ELEMENT_NODE) {
                    for (const attr of this.translatableAttributes) {
                        if (n.hasAttribute(attr)) {
                            const original = n.getAttribute(attr);
                             // [核心修正] 在 converter 實例上調用 toTrad
                            const translated = converter.toTrad(original);
                            if (original !== translated) n.setAttribute(attr, translated);
                        }
                    }
                } else if (n.nodeType === Node.TEXT_NODE) {
                    const original = n.nodeValue;
                    if (original && original.trim().length > 0) {
                         // [核心修正] 在 converter 實例上調用 toTrad
                        const translated = converter.toTrad(original);
                        if (original !== translated) n.nodeValue = translated;
                    }
                }
            }

            if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute(TRANSLATED_MARKER)) {
                node.setAttribute(TRANSLATED_MARKER, 'true');
            }
        }
    };

    function main() {
        if (!/(\p{Script=Hani})+/u.test(document.body.innerText)) {
            console.log('繁中轉換：頁面未檢測到中文字符，腳本已停止。');
            return;
        }

        // --- [核心修正] ---
        // Chinese_converter 是一個建構函式，必須先實例化才能使用。
        // 這個實例在腳本運行期間將被複用，以獲得最佳性能。
        const converter = new Chinese_converter();
        console.log("繁中轉換：引擎實例化成功，初次翻譯開始...");

        domTranslator.translateNode(document.body, converter);
        console.log("繁中轉換：初次翻譯完成，已啟動動態內容監聽。");

        const observer = new MutationObserver(mutations => {
            window.requestAnimationFrame(() => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            domTranslator.translateNode(node, converter);
                        }
                    } else if (mutation.type === 'characterData') {
                        const textNode = mutation.target;
                        if (textNode.parentElement && !domTranslator.ignoredTags.has(textNode.parentElement.tagName)) {
                            const original = textNode.nodeValue;
                             // [核心修正] 在 converter 實例上調用 toTrad
                            const translated = converter.toTrad(original);
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
