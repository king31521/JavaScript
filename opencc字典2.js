// ==UserScript==
// @name         OpenCC-JS s2twp Auto-translate (Tampermonkey) - No UI
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Auto-convert Simplified Chinese on pages to Traditional Taiwanese (s2twp) using OpenCC dictionaries and GM_xmlhttpRequest. Exposes window.OpenCC. UI toggle removed.
// @author       Converted
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @connect      fastly.jsdelivr.net
// @connect      unpkg.com
// @license      Apache-2.0
// ==/UserScript==

(function() {
  'use strict';

  const DICT_SOURCES = [
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
  ];

  const dictionaryCache = new Map();

  function Trie() { this.root = {}; }
  Trie.prototype.insert = function(word, value) {
    let node = this.root;
    for (const char of word) {
      if (!node[char]) node[char] = {};
      node = node[char];
    }
    node.value = value;
    node.wordEnd = true;
  };
  Trie.prototype.convert = function(text) {
    let result = '';
    let i = 0;
    while (i < text.length) {
      let node = this.root;
      let j = i;
      let lastMatch = null;
      while (j < text.length && node[text[j]]) {
        node = node[text[j]];
        if (node.wordEnd) lastMatch = { end: j, value: node.value };
        j++;
      }
      if (lastMatch) {
        result += lastMatch.value;
        i = lastMatch.end + 1;
      } else {
        result += text[i];
        i++;
      }
    }
    return result;
  };

  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: { 'Accept': 'text/plain, */*' },
          onload(res) {
            if (res.status >= 200 && res.status < 300) resolve(res.responseText);
            else reject(new Error(`HTTP ${res.status}`));
          },
          onerror() { reject(new Error('Network error')); },
          ontimeout() { reject(new Error('Timeout')); }
        });
      } catch (e) { reject(e); }
    });
  }

  async function fetchWithFallback(dictName, baseSources) {
    let lastError = null;
    for (const baseUrl of baseSources) {
      try {
        const url = `${baseUrl}${dictName}.txt`;
        const text = await gmFetchText(url);
        return text;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Failed to fetch ${dictName}. Last: ${lastError && lastError.message}`);
  }

  async function fetchAndParseDict(dictName, customBaseUrl = null) {
    const sources = customBaseUrl ? [customBaseUrl] : DICT_SOURCES;
    const cacheKey = `${sources.join(',')}:${dictName}`;
    if (dictionaryCache.has(cacheKey)) return await dictionaryCache.get(cacheKey);

    const p = (async () => {
      const text = await fetchWithFallback(dictName, sources);
      const lines = text.split('\n');
      const dictData = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const tabIndex = trimmed.indexOf('\t');
        if (tabIndex > 0) {
          const key = trimmed.substring(0, tabIndex);
          const valuesPart = trimmed.substring(tabIndex + 1);
          const value = valuesPart.split(' ')[0];
          if (key && value) dictData.push([key, value]);
        }
      }
      return dictData;
    })();

    dictionaryCache.set(cacheKey, p);
    return p;
  }

  function ConverterFactory(dictionaries, chainName) {
    const tries = dictionaries.map((dictData) => {
      const trie = new Trie();
      for (const [k, v] of dictData) if (k && v && k !== v) trie.insert(k, v);
      return trie;
    });
    return function(text) {
      let result = text;
      for (let i = 0; i < tries.length; i++) result = tries[i].convert(result);
      return result;
    };
  }

  const conversionChains = {
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName']
  };

  function normalizeRequested(options) {
    if (typeof options === 'string') {
      const key = options.trim().toLowerCase();
      if (key === 's2t' || key === 's2tw' || key === 's2twp') return { chain: 's2twp', baseUrl: null };
      return { chain: key, baseUrl: null };
    }
    if (typeof options === 'object' && options !== null) {
      const from = (options.from || '').toString().trim().toLowerCase();
      const to = (options.to || '').toString().trim().toLowerCase();
      const baseUrl = options.dictPath || options.dictpath || null;
      if (from === 's' && (to === 't' || to === 'tw' || to === 'twp')) return { chain: 's2twp', baseUrl };
      return { chain: `${from}2${to}`, baseUrl };
    }
    return { chain: 's2twp', baseUrl: null };
  }

  const OpenCC = {
    async createConverter(options) {
      const normalized = normalizeRequested(options);
      let chainKey = normalized.chain;
      const baseUrl = normalized.baseUrl || null;
      if (typeof chainKey === 'string') {
        const ck = chainKey.trim().toLowerCase();
        if (ck === 's2t' || ck === 's2tw') chainKey = 's2twp';
        else chainKey = ck;
      }
      const dictNames = conversionChains[chainKey];
      if (!dictNames) throw new Error(`Conversion chain not found: ${chainKey}`);
      const dictionaries = await Promise.all(dictNames.map(n => fetchAndParseDict(n, baseUrl)));
      return ConverterFactory(dictionaries, chainKey);
    },
    clearCache() { dictionaryCache.clear(); },
    getSupportedConversions() { return Object.keys(conversionChains); },
    async testConversion(text, chainKey = 's2twp') {
      const conv = await this.createConverter(chainKey);
      return conv(text);
    }
  };

  window.OpenCC = OpenCC;

  // --- Auto-replace logic ---
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','OBJECT','CODE','PRE','TEXTAREA','INPUT']);
  const IGNORE_CLASS_PREFIX = 'opencc-ignore'; // optional class to skip nodes
  let converter = null;
  let isReady = false;

  function isEditable(node) {
    if (!node) return false;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el.matches && el.matches('[role="textbox"]')) return true;
    }
    return false;
  }

  function shouldSkipNode(node) {
    if (!node) return true;
    if (node.nodeType === Node.TEXT_NODE) {
      const p = node.parentNode;
      if (!p || p.nodeType !== Node.ELEMENT_NODE) return false;
      const t = p.tagName;
      if (SKIP_TAGS.has(t)) return true;
      if (p.className && p.className.toString().indexOf(IGNORE_CLASS_PREFIX) !== -1) return true;
      if (isEditable(p)) return true;
      return false;
    }
    return true;
  }

  function walkTextNodes(root, callback) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const tn of nodes) callback(tn);
  }

  // Throttle batch processing to avoid UI freeze
  let pendingNodes = [];
  let processing = false;
  function scheduleProcess(nodes) {
    pendingNodes = pendingNodes.concat(nodes);
    if (processing) return;
    processing = true;
    setTimeout(async () => {
      try {
        if (!converter) return;
        const batch = pendingNodes.splice(0, pendingNodes.length);
        for (const tn of batch) {
          try {
            const original = tn.nodeValue;
            const converted = converter(original);
            if (converted !== original) tn.nodeValue = converted;
          } catch (e) { /* ignore per-node errors */ }
        }
      } finally {
        processing = false;
        if (pendingNodes.length) scheduleProcess([]);
      }
    }, 100);
  }

  async function initAndRunAutoConvert() {
    if (isReady) return;
    try {
      converter = await OpenCC.createConverter('s2twp');
      isReady = true;
      // initial pass
      const initial = [];
      walkTextNodes(document.body, tn => initial.push(tn));
      scheduleProcess(initial);

      // observe dynamic changes
      const mo = new MutationObserver(mutations => {
        const nodes = [];
        for (const m of mutations) {
          if (m.type === 'characterData' && m.target && m.target.nodeType === Node.TEXT_NODE) {
            if (!shouldSkipNode(m.target)) nodes.push(m.target);
          } else {
            for (const n of m.addedNodes) {
              if (n.nodeType === Node.TEXT_NODE) {
                if (!shouldSkipNode(n)) nodes.push(n);
              } else if (n.nodeType === Node.ELEMENT_NODE) {
                walkTextNodes(n, tn => nodes.push(tn));
              }
            }
          }
        }
        if (nodes.length) scheduleProcess(nodes);
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    } catch (err) {
      console.error('OpenCC auto-init failed:', err);
    }
  }

  // start when DOM ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initAndRunAutoConvert();
  } else {
    window.addEventListener('DOMContentLoaded', initAndRunAutoConvert, { once: true });
  }

  // expose helper to manually run conversion on a string or element
  window.OpenCC_convertNode = async function(nodeOrText) {
    if (!isReady) {
      converter = await OpenCC.createConverter('s2twp');
      isReady = true;
    }
    if (typeof nodeOrText === 'string') return converter(nodeOrText);
    if (nodeOrText && nodeOrText.nodeType === Node.ELEMENT_NODE) {
      const list = [];
      walkTextNodes(nodeOrText, tn => list.push(tn));
      scheduleProcess(list);
      return true;
    }
    return null;
  };

})();
