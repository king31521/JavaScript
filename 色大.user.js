// ==UserScript==
// @name         色大
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Changes the styles of the current page
// @match        www.gululu.world/book*
// @match        ngabbs.com/*
// @grant        none
// ==/UserScript==

(function() {
  var ID = 'se-da-style';
  var styles = [
    '* {',
    '  background: #C7EDCC !important;',
    '  color: black !important;',
    '}',
    'p, span, a, li, td, th, dt, dd, label, blockquote, figcaption, caption, h1, h2, h3, h4, h5, h6 {',
    '  font-size: 25pt !important;',
    '  line-height: 160% !important;',
    '  letter-spacing: 2px !important;',
    '}',
    ':link, :link * { color: #0000EE !important }',
    ':visited, :visited * { color: #551A8B !important }'
  ].join('\n');

  function inject() {
    if (document.getElementById(ID)) return;
    var el = document.createElement('style');
    el.id = ID;
    el.textContent = styles;
    (document.head || document.documentElement).appendChild(el);
  }

  inject();

  var mo = new MutationObserver(inject);
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
