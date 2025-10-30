// ==UserScript==
// @name         OpenCC-JS s2twp (Tampermonkey)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Force s2t -> s2twp mapping for OpenCC (s2twp only). Loads dictionary files via GM_xmlhttpRequest with fallback sources and exposes window.OpenCC.
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

  // --- Configuration ---
  const DICT_SOURCES = [
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
  ];

  const dictionaryCache = new Map();

  // --- Trie implementation ---
  function Trie() {
    this.root = {};
  }

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

  // --- Replace fetchWithFallback with GM_xmlhttpRequest-based fetch ---
  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: {
            'Accept': 'text/plain, */*'
          },
          onload(response) {
            if (response.status >= 200 && response.status < 300) {
              resolve(response.responseText);
            } else {
              reject(new Error(`HTTP ${response.status}: ${response.statusText || response.status}`));
            }
          },
          onerror(err) {
            reject(new Error(`Network error`));
          },
          ontimeout() {
            reject(new Error('Timeout'));
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function fetchWithFallback(dictName, baseSources) {
    let lastError = null;
    for (const baseUrl of baseSources) {
      try {
        const url = `${baseUrl}${dictName}.txt`;
        console.log(`Trying to fetch: ${url}`);
        const text = await gmFetchText(url);
        console.log(`Successfully fetched ${dictName} from ${baseUrl}`);
        return text;
      } catch (err) {
        console.warn(`Failed to fetch ${dictName} from ${baseUrl}:`, err && err.message);
        lastError = err;
      }
    }
    throw new Error(`Failed to fetch ${dictName} from all sources. Last error: ${lastError && lastError.message}`);
  }

  async function fetchAndParseDict(dictName, customBaseUrl = null) {
    const sources = customBaseUrl ? [customBaseUrl] : DICT_SOURCES;
    const cacheKey = `${sources.join(',')}:${dictName}`;
    if (dictionaryCache.has(cacheKey)) return await dictionaryCache.get(cacheKey);

    const p = (async () => {
      try {
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
        console.log(`Parsed ${dictData.length} entries from ${dictName}`);
        if (dictData.length) console.log(`${dictName} sample entries:`, dictData.slice(0, 3));
        return dictData;
      } catch (err) {
        console.error(`Error parsing dictionary ${dictName}:`, err);
        dictionaryCache.delete(cacheKey);
        throw err;
      }
    })();

    dictionaryCache.set(cacheKey, p);
    return p;
  }

  function ConverterFactory(dictionaries, chainName) {
    const tries = dictionaries.map((dictData, idx) => {
      const trie = new Trie();
      let inserted = 0;
      for (const [k, v] of dictData) {
        if (k && v && k !== v) { trie.insert(k, v); inserted++; }
      }
      console.log(`Dictionary ${idx} in ${chainName}: inserted ${inserted} conversions`);
      return trie;
    });

    return function(text) {
      let result = text;
      for (let i = 0; i < tries.length; i++) {
        const before = result;
        result = tries[i].convert(result);
        if (result !== before) console.log(`Step ${i + 1} conversion: "${before}" -> "${result}"`);
      }
      return result;
    };
  }

  // Only s2twp chain kept
  const conversionChains = {
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName']
  };

  // Normalize and force-map various requests to s2twp if appropriate
  function normalizeRequested(options) {
    if (typeof options === 'string') {
      const key = options.trim().toLowerCase();
      if (key === 's2t' || key === 's2tw' || key === 's2twp' || key === 's2twp') return { chain: 's2twp', baseUrl: null };
      return { chain: key, baseUrl: null };
    }

    if (typeof options === 'object' && options !== null) {
      const from = (options.from || '').toString().trim().toLowerCase();
      const to = (options.to || '').toString().trim().toLowerCase();
      const baseUrl = options.dictPath || options.dictpath || null;
      if (from === 's' && (to === 't' || to === 'tw' || to === 'twp')) return { chain: 's2twp', baseUrl };
      const key = `${from}2${to}`;
      return { chain: key, baseUrl };
    }

    return { chain: 's2twp', baseUrl: null };
  }

  // --- Public API object ---
  const OpenCC = {
    async createConverter(options) {
      try {
        const normalized = normalizeRequested(options);
        let chainKey = normalized.chain;
        const baseUrl = normalized.baseUrl || null;

        if (typeof chainKey === 'string') {
          const ck = chainKey.trim().toLowerCase();
          if (ck === 's2t' || ck === 's2tw') chainKey = 's2twp';
          else chainKey = ck;
        }

        const dictNames = conversionChains[chainKey];
        if (!dictNames) {
          throw new Error(`Conversion chain not found: ${chainKey}. Available chains: ${Object.keys(conversionChains).join(', ')}`);
        }

        console.log(`Creating converter for ${chainKey} with dictionaries:`, dictNames);

        const dictionaries = await Promise.all(dictNames.map(n => fetchAndParseDict(n, baseUrl)));

        console.log(`Successfully loaded all dictionaries for ${chainKey}`);

        const twIdx = dictNames.indexOf('TWVariants');
        if (twIdx >= 0 && dictionaries.length > twIdx) {
          console.log(`TWVariants dictionary loaded with ${dictionaries[twIdx].length} entries`);
          if (dictionaries[twIdx].length) console.log('TWVariants sample entries:', dictionaries[twIdx].slice(0, 5));
        }

        return ConverterFactory(dictionaries, chainKey);

      } catch (err) {
        console.error('createConverter failed:', err);
        throw err;
      }
    },

    clearCache() {
      dictionaryCache.clear();
      console.log('Dictionary cache cleared');
    },

    getSupportedConversions() {
      return Object.keys(conversionChains);
    },

    async testConversion(text, chainKey = 's2twp') {
      try {
        console.log(`Testing conversion: ${chainKey}`);
        const conv = await this.createConverter(chainKey);
        const out = conv(text);
        console.log(`Final result: "${out}"`);
        return out;
      } catch (err) {
        console.error('Test conversion failed:', err);
        throw err;
      }
    }
  };

  // Expose to window for page scripts and console usage
  try {
    window.OpenCC = OpenCC;
    console.log('OpenCC (s2twp) available at window.OpenCC');
  } catch (e) {
    console.warn('Could not attach OpenCC to window:', e);
  }

  // Add a Tampermonkey menu command to test conversion quickly
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('OpenCC: Test conversion (prompt)', async () => {
      try {
        const input = prompt('輸入要轉換的簡體文字 (s2twp):', '汉字测试');
        if (input === null) return;
        const result = await OpenCC.testConversion(input, 's2twp');
        alert(`輸入: ${input}\n結果: ${result}`);
      } catch (err) {
        alert('轉換失敗: ' + (err && err.message));
      }
    });
  } else {
    // Fallback: listen for Ctrl+Shift+O to prompt test conversion
    window.addEventListener('keydown', async (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyO') {
        try {
          const input = prompt('輸入要轉換的簡體文字 (s2twp):', '汉字测试');
          if (input === null) return;
          const result = await OpenCC.testConversion(input, 's2twp');
          alert(`輸入: ${input}\n結果: ${result}`);
        } catch (err) {
          alert('轉換失敗: ' + (err && err.message));
        }
      }
    }, false);
  }

})();
