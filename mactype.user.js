// ==UserScript==
// @name         自動字體優化
// @description  自動應用最大清晰度+系統字體優化
// @author       油小猴
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_getResourceText
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    let util = {
        getValue(name) {
            return GM_getValue(name);
        },

        setValue(name, value) {
            GM_setValue(name, value);
        },

        addStyle(id, tag, css) {
            tag = tag || 'style';
            let doc = document, styleDom = doc.getElementById(id);
            if (styleDom) return;
            let style = doc.createElement(tag);
            style.rel = 'stylesheet';
            style.id = id;
            tag === 'style' ? style.innerHTML = css : style.href = css;
            document.head.appendChild(style);
        },

        removeElementById(eleId) {
            let ele = document.getElementById(eleId);
            ele && ele.parentNode.removeChild(ele);
        }
    };

    let main = {
        /**
         * 配置默認值
         */
        initValue() {
            let value = [{
                name: 'current_val',
                value: 1 // 強制最大值
            }, {
                name: 'has_init',
                value: true // 跳過初始化
            }, {
                name: 'white_list',
                value: []
            }];

            value.forEach((v) => {
                util.getValue(v.name) === undefined && util.setValue(v.name, v.value);
            });
        },

        registerMenuCommand() {
            let whiteList = util.getValue('white_list');
            let host = location.host;
            if (whiteList.includes(host)) {
                GM_registerMenuCommand('💡 當前網站：❌', () => {
                    let index = whiteList.indexOf(host);
                    whiteList.splice(index, 1);
                    util.setValue('white_list', whiteList);
                    history.go(0);
                });
            } else {
                GM_registerMenuCommand('💡 當前網站：✔️', () => {
                    whiteList.push(host);
                    util.setValue('white_list', whiteList);
                    history.go(0);
                });
            }
        },

        generateStyle() {
            return `
                *:not(pre) {
                    -webkit-text-stroke: 1px !important;
                    text-stroke: 1px !important;
                    font-family: 
                        system-ui,  // 系統默認字體
                        -apple-system,  // iOS
                        BlinkMacSystemFont,  // Chrome/Mac
                        "Segoe UI",  // Windows
                        Roboto,  // Android
                        "PingFang SC",  // 蘋果中文字體
                        "Microsoft YaHei",  // 微軟雅黑
                        sans-serif !important;
                }
                ::selection {
                    color: #fff;
                    background: #338fff
                }
            `;
        },

        addPluginStyle() {
            let style = this.generateStyle();
            if (document.head) {
                util.addStyle('mactype-style', 'style', style);
            }
            const headObserver = new MutationObserver(() => {
                util.addStyle('mactype-style', 'style', style);
            });
            headObserver.observe(document.head, {childList: true, subtree: true});
        },

        isTopWindow() {
            return window.self === window.top;
        },

        init() {
            this.initValue();
            this.isTopWindow() && this.registerMenuCommand();
            if (util.getValue('white_list').includes(location.host)) return;
            this.addPluginStyle();
        }
    };
    
    main.init();
})();
