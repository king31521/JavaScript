/**
 * OpenCC-JS 修正版：加強字典來源與載入偵錯，確保 TWVariants 可載入
 *
 * @version 1.2.5 (強化字典來源與載入偵錯)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  // 更可靠的字典來源清單（按嘗試順序）
  const DICT_SOURCES = [
    // GitHub raw by tag/branch — 正確格式： user/repo/branch/path/
    'https://raw.githubusercontent.com/BYVoid/OpenCC/ver.1.1.7/data/dictionary/',
    // jsDelivr (raw via npm/github)
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    // fastly jsdelivr fallback
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    // unpkg (npm package)
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
    // 公共備援（最後手段）
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/'
  ];

  const dictionaryCache = new Map();

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
        if (node.wordEnd) {
          lastMatch = { end: j, value: node.value };
        }
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

  async function fetchWithFallback(dictName, baseSources) {
    let lastError = null;
    for (const baseUrl of baseSources) {
      const url = `${baseUrl}${dictName}.txt`;
      try {
        console.log(`[fetch] Attempting ${url}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'text/plain, */*' },
          mode: 'cors'
        });

        if (!response.ok) {
          const statusText = `HTTP ${response.status}: ${response.statusText}`;
          console.warn(`[fetch] ${url} returned ${statusText}`);
          lastError = new Error(statusText);
          continue;
        }

        const contentLength = response.headers.get('content-length');
        const text = await response.text();
        console.log(`[fetch] Success ${url} (bytes: ${contentLength || text.length})`);
        return text;
      } catch (err) {
        console.warn(`[fetch] Error fetching ${url}: ${err && err.message}`);
        lastError = err;
        continue;
      }
    }
    throw new Error(`All sources failed for ${dictName}. Last error: ${lastError && lastError.message}`);
  }

  async function fetchAndParseDict(dictName, customBaseUrl = null) {
    const sources = customBaseUrl ? [customBaseUrl] : DICT_SOURCES;
    const cacheKey = `${sources.join(',')}:${dictName}`;

    if (dictionaryCache.has(cacheKey)) {
      return await dictionaryCache.get(cacheKey);
    }

    const fetchPromise = (async () => {
      try {
        const text = await fetchWithFallback(dictName, sources);
        const lines = text.split('\n');
        const dictData = [];

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine.startsWith('#')) continue;
          const tabIndex = trimmedLine.indexOf('\t');
          if (tabIndex > 0) {
            const key = trimmedLine.substring(0, tabIndex);
            const valuesPart = trimmedLine.substring(tabIndex + 1);
            const value = valuesPart.split(' ')[0];
            if (key && value) dictData.push([key, value]);
          }
        }

        console.log(`[parse] ${dictName} parsed ${dictData.length} entries`);
        if (dictData.length > 0) console.log(`[parse] ${dictName} sample:`, dictData.slice(0, 3));
        return dictData;
      } catch (error) {
        console.error(`[parse] Failed to load/parse ${dictName}: ${error && error.message}`);
        dictionaryCache.delete(cacheKey);
        throw error;
      }
    })();

    dictionaryCache.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  function ConverterFactory(dictionaries, dictNames, chainName) {
    const tries = dictionaries.map((dictData, idx) => {
      const trie = new Trie();
      let inserted = 0;
      for (const [k, v] of dictData) {
        if (k && v && k !== v) { trie.insert(k, v); inserted++; }
      }
      console.log(`[factory] Trie build ${dictNames[idx]} inserted ${inserted}`);
      return trie;
    });

    const perCharMaps = [];
    for (let i = 0; i < dictNames.length; i++) {
      const name = dictNames[i];
      const dictData = dictionaries[i];
      let single = 0, total = 0;
      for (const [k] of dictData) { total++; if (k.length === 1) single++; }
      const isCharDict = (single / Math.max(1, total)) > 0.6 || /Variants|HK|TW/i.test(name);
      if (isCharDict) {
        const map = Object.create(null);
        for (const [k, v] of dictData) {
          if (k && v && k.length === 1) map[k] = v;
        }
        perCharMaps.push({ name, map });
        console.log(`[factory] Per-char map for ${name}: ${Object.keys(map).length}`);
      } else {
        perCharMaps.push({ name, map: null });
      }
    }

    return function(text) {
      let result = text;
      for (let i = 0; i < tries.length; i++) {
        const prev = result;
        result = tries[i].convert(result);
        if (result !== prev) console.log(`[convert] After ${dictNames[i]}: "${prev}" -> "${result}"`);
      }

      const finalMap = Object.create(null);
      for (const entry of perCharMaps) {
        if (entry.map) {
          for (const ch in entry.map) finalMap[ch] = entry.map[ch];
        }
      }

      if (Object.keys(finalMap).length > 0) {
        let changed = false;
        const out = [];
        for (const ch of result) {
          if (finalMap[ch]) { out.push(finalMap[ch]); changed = true; } else out.push(ch);
        }
        const after = out.join('');
        if (changed) console.log(`[convert] Final per-char replacement applied: "${result}" -> "${after}"`);
        result = after;
      }

      return result;
    };
  }

  const conversionChains = {
    's2t': ['STCharacters', 'STPhrases'],
    't2s': ['TSCharacters', 'TSPhrases'],
    's2tw': ['STCharacters', 'STPhrases', 'TWVariants'],
    'tw2s': ['TWVariantsRev', 'TSCharacters', 'TSPhrases'],
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName'],
    'tw2sp': ['TWVariantsRev', 'TWPhrasesITRev', 'TWPhrasesNameRev', 'TSCharacters', 'TSPhrases'],
    's2hk': ['STCharacters', 'STPhrases', 'HKVariants'],
    'hk2s': ['HKVariantsRev', 'TSCharacters', 'TSPhrases'],
  };

  return {
    async createConverter(options) {
      try {
        let chainKey, baseUrl;
        if (typeof options === 'string') {
          chainKey = options;
          baseUrl = null;
        } else {
          chainKey = `${options.from}2${options.to}`;
          baseUrl = options.dictPath;
        }

        const dictNames = conversionChains[chainKey];
        if (!dictNames) throw new Error(`Unknown chain ${chainKey}`);

        console.log(`[create] Loading chain ${chainKey}:`, dictNames);

        const dictionaries = await Promise.all(
          dictNames.map(name => fetchAndParseDict(name, baseUrl))
        );

        console.log(`[create] Loaded ${dictionaries.length} dictionaries for ${chainKey}`);

        // 檢查 TWVariants 是否存在並輸出樣本
        const twIdx = dictNames.indexOf('TWVariants');
        if (twIdx >= 0) {
          const tw = dictionaries[twIdx];
          console.log(`[create] TWVariants entries: ${tw.length}`);
          if (tw.length > 0) console.log('[create] TWVariants sample:', tw.slice(0, 5));
        }

        return ConverterFactory(dictionaries, dictNames, chainKey);
      } catch (err) {
        console.error('[create] createConverter failed:', err && err.message);
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

    async testConversion(text, chainKey = 's2tw') {
      try {
        console.log(`[test] chain ${chainKey} input: "${text}"`);
        const converter = await this.createConverter(chainKey);
        const out = converter(text);
        console.log(`[test] result: "${out}"`);
        return out;
      } catch (err) {
        console.error('[test] failed:', err && err.message);
        throw err;
      }
    }
  };
})();
