// ==UserScript==
// @name         護眼模式 + 背景顏色 + 文字粗細
// @namespace    http://your-namespace-here/
// @version      1
// @description  Reduces brightness and changes background color, and makes all text bold
// @match        *://ngabbs.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 護眼模式，降低亮度，同时更改背景颜色
    function nightMode() {
        const brightness = 0.9;
        const bgColor = '#C7EDCC';
        const important = 'important';

        // 降低亮度
        document.documentElement.style.filter = `brightness(${brightness})`;

        // 更改背景颜色
        const elements = document.querySelectorAll('body, body *');
        elements.forEach(element => {
            if (getComputedStyle(element).getPropertyValue('background-color') !== 'rgba(0, 0, 0, 0)') {
                element.style.backgroundColor = bgColor;
                element.style.setProperty('background-color', bgColor, important);
            }
        });
    }

    // 获取RGB颜色
    function getRGBColor(node, prop) {
        const rgb = getComputedStyle(node, null).getPropertyValue(prop);
        if (/rgb\((\d+),\s(\d+),\s(\d+)\)/.exec(rgb)) {
            const r = parseInt(RegExp.$1, 10);
            const g = parseInt(RegExp.$2, 10);
            const b = parseInt(RegExp.$3, 10);
            return [r/255, g/255, b/255];
        }
        return rgb;
    }

    // 递归遍历所有元素，更改字体粗细
    function setBold(node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() !== 'input' && node.tagName.toLowerCase() !== 'select' && node.tagName.toLowerCase() !== 'textarea') {
            const style = getComputedStyle(node);
            if (parseInt(style.getPropertyValue('font-weight'), 10) < 950) {
                node.style.setProperty('font-weight', '950', 'important');
            }
            for (let i = 0; i < node.childNodes.length; i++) {
                setBold(node.childNodes[i]);
            }
        }
    }

    // 调用上述函数
    nightMode();
    setBold(document.body);
})();
