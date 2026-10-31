// ==UserScript==
// @name         Gululu 解鎖 + 自動登入 + 書籤列表
// @namespace    http://tampermonkey.net/
// @version      7.2
// @match        *://*.gululu.world/*
// @match        *://*.gululuworld.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==
(function() {
    var w = unsafeWindow;
    var TOKEN = 'eyJhbGciOiJIUzUxMiJ9.eyJsb2dpbl91c2VyX2tleSI6ImM3MTdhYjY5LTFkY2UtNDE0MC04MWUyLTgzNzNlMTc1MjQyMCJ9.FWb9WFZxBeAiVBMQhKAMsXK-wESEbgbjwW6a1qwmOb_zU4ZE4wUG2xfYCTDsM3kSIdfW3cv0XGSyAXZ14Js8aQ';
    var BASE = 'https://backend.gululuworld.com';

    function getOpusId() {
        return new URLSearchParams(window.location.search).get('opusId');
    }

    function deleteBookmark(markId, opusId, onSuccess, onFail) {
        fetch(BASE + '/floor/deleteBookmark', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + TOKEN,
                'platform': '2',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ opusId: parseInt(opusId), markId: markId, type: 0 })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            console.log('[Gululu] 刪除書籤:', data.code, data.msg);
            if (data.code === 200) { onSuccess(); } else { onFail(); }
        })
        .catch(function() { onFail(); });
    }

    function showBookmarkPanel() {
        var opusId = getOpusId();
        if (!opusId) { alert('請在小說頁面使用書籤功能'); return; }

        var old = document.getElementById('_gululu_bookmark_panel');
        if (old) { old.remove(); return; }

        var panel = document.createElement('div');
        panel.id = '_gululu_bookmark_panel';
        panel.style.cssText = [
            'position:fixed', 'top:0', 'right:0', 'width:85vw', 'max-width:360px',
            'height:100vh', 'background:#fff', 'z-index:99999',
            'box-shadow:-4px 0 16px rgba(0,0,0,0.18)',
            'display:flex', 'flex-direction:column', 'font-family:sans-serif', 'font-size:14px'
        ].join(';');

        panel.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;',
            'padding:16px;border-bottom:1px solid #eee;background:#f9f9f9">',
            '<span style="font-size:16px;font-weight:bold">📌 我的書籤</span>',
            '<button id="_gululu_bm_close" style="border:none;background:none;font-size:20px;cursor:pointer">✕</button>',
            '</div>',
            '<div id="_gululu_bm_list" style="flex:1;overflow-y:auto;padding:8px">',
            '<div style="text-align:center;color:#999;padding:40px">載入中...</div>',
            '</div>'
        ].join('');

        document.body.appendChild(panel);
        document.getElementById('_gululu_bm_close').onclick = function() { panel.remove(); };

        function loadList() {
            fetch(BASE + '/floor/bookmarkList?opusId=' + opusId + '&type=0&pageNum=1&pageSize=50', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer ' + TOKEN, 'platform': '2' }
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = document.getElementById('_gululu_bm_list');
                if (!list) return;
                if (!data.data || data.data.length === 0) {
                    list.innerHTML = '<div style="text-align:center;color:#999;padding:40px">尚無書籤</div>';
                    return;
                }
                list.innerHTML = data.data.map(function(item) {
                    return [
                        '<div style="display:flex;align-items:flex-start;',
                        'padding:12px 14px;border-bottom:1px solid #f0f0f0;',
                        'border-left:3px solid #2B9EF2;margin:6px 0;border-radius:4px;background:#fafcff">',
                        '<div data-sort="' + item.sort + '" style="flex:1;cursor:pointer">',
                        '<div style="color:#333;line-height:1.5;margin-bottom:6px">',
                        item.draftText.substring(0, 50) + (item.draftText.length > 50 ? '...' : ''),
                        '</div>',
                        '<div style="color:#999;font-size:12px">🕒 ' + item.creatTime + '　第 ' + item.sort + ' 樓</div>',
                        '</div>',
                        '<button data-bmid="' + item.bookmarkId + '" style="',
                        'border:none;background:none;color:#ccc;font-size:18px;',
                        'cursor:pointer;padding:0 4px;flex-shrink:0;line-height:1">🗑</button>',
                        '</div>'
                    ].join('');
                }).join('');

                // 點擊文字 → 跳樓層
                list.querySelectorAll('[data-sort]').forEach(function(el) {
                    el.addEventListener('click', function() {
                        var sort = parseInt(el.getAttribute('data-sort'));
                        panel.remove();
                        if (typeof w.jumpFloor === 'function') {
                            w.jumpFloor(sort, 0);
                            console.log('[Gululu] ✅ 跳到第', sort, '樓');
                        }
                    });
                });

                // 點擊刪除
                list.querySelectorAll('[data-bmid]').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var markId = parseInt(btn.getAttribute('data-bmid'));
                        btn.textContent = '⏳';
                        deleteBookmark(
                            markId,
                            opusId,
                            function() {
                                var row = btn.parentElement;
                                row.style.transition = 'opacity 0.3s';
                                row.style.opacity = '0';
                                setTimeout(function() { row.remove(); }, 300);
                                console.log('[Gululu] ✅ 書籤已刪除:', markId);
                            },
                            function() {
                                btn.textContent = '🗑';
                                alert('刪除失敗，請稍後再試');
                            }
                        );
                    });
                });
            })
            .catch(function(e) {
                var list = document.getElementById('_gululu_bm_list');
                if (list) list.innerHTML = '<div style="text-align:center;color:red;padding:40px">載入失敗: ' + e.message + '</div>';
            });
        }

        loadList();
    }

    // ── 偽裝 App 環境 ─────────────────────────────────
    w.isApp = true;
    w.ReactNativeWebView = {
        postMessage: function(data) {
            var msg;
            try { msg = JSON.parse(data); } catch(e) { msg = data; }
            if (msg.type === 'navigate') {
                switch(msg.route) {
                    case 'codeLogin':
                        setTimeout(function() {
                            if (typeof w.setToken === 'function') w.setToken(TOKEN);
                        }, 100);
                        break;
                    case 'bookMark':
                        showBookmarkPanel();
                        break;
                    case 'headlessWebview':
                    case 'webview':
                        if (msg.url) window.location.href = msg.url;
                        break;
                    default:
                        console.log('[Gululu] 未處理路由:', msg.route, msg);
                }
                return;
            }
            if (msg.type === 'track' || msg.type === 'takeOverBackHandler') return;
            console.log('[RN]', msg);
        }
    };

    // ── 自動登入 ──────────────────────────────────────
    var check = setInterval(function() {
        if (typeof w.setToken === 'function') {
            clearInterval(check);
            w.setToken(TOKEN);
            console.log('[Gululu] ✅ v7.2 啟動完成');
        }
    }, 100);
})();
