// ==UserScript==
// @name         色大
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Changes the styles of the current page
// @match        https://www.gululuworld.com/book*
// @match        https://ngabbs.com/*
// @grant        none
// ==/UserScript==

(function() {
    var newSS, styles='* { background: #C7EDCC ! important; color: black !important; line-height: 160% !important; font-size: 25pt !important; letter-spacing:2px !important } :link, :link * { color: #0000EE !important } :visited, :visited * { color: #551A8B !important }';
    if(document.createStyleSheet) {
        document.createStyleSheet("javascript:'"+styles+"'");
    } else {
        newSS=document.createElement('link');
        newSS.rel='stylesheet';
        newSS.href='data:text/css,'+escape(styles);
        document.getElementsByTagName("head")[0].appendChild(newSS);
    }
})();
