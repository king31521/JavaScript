/**
 * OpenCC-JS 修正版：容錯性的字典解析（支援任意空白分隔）並保持 TWVariants 最終逐字覆蓋
 *
 * @version 1.2.6 (改良字典解析)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  const DICT_SOURCES = [
    'https://raw.githubusercontent.com/BYVoid/OpenCC/ver.1.1.7/data/dictionary/',
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
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

  async function fetchWithFallback(dictName, baseSources) {
    let lastError = null;
    for (const baseUrl of baseSources) {
      const url = `${baseUrl}${dictName}.txt`;
      try {
        console.log(`[fetch] Trying ${url}`);
        const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'text/plain, */*' }, mode: 'cors' });
        if (!response.ok) {
          console.warn(`[fetch] ${url} returned HTTP ${response.status}`);
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        const text = await response.text();
        console.log(`[fetch] Success ${url} (chars: ${text.length})`);
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
    if (dictionaryCache.has(cacheKey)) return await dictionaryCache.get(cacheKey);

    const fetchPromise = (async () => {
      try {
        const text = await fetchWithFallback(dictName, sources);
        const lines = text.split(/\r?\n/);
        const dictData = [];

        for (let idx = 0; idx < lines.length; idx++) {
          const raw = lines[idx];
          if (!raw) continue;
          const trimmedLine = raw.trim();
          if (trimmedLine === '' || trimmedLine.startsWith('#')) continue;

          // 支援任意空白（tab 或空格）作為 key/value 的分隔
          // 找到第一個連續空白區段的位置
          const m = trimmedLine.match(/(\S+)\s+(.+)/);
          if (m) {
            const key = m[1];
            const valuesPart = m[2].trim();
            // value 取第一個非空項目（以空白分隔）
            const value = valuesPart.split(/\s+/)[0];
            if (key && value) {
              dictData.push([key, value]);
            }
          } else {
            // 若沒有 match，記錄 debug（但不中斷）
            // 某些檔案可能有以逗號或其他分隔，此時僅 log 出來方便排查
            // 但不自動嘗試複雜解析以避免誤判
            // 只在很少量的行出現才會被忽略
            // 若需要更寬鬆解析，可改為更複雜的分隔策略
            // eslint-disable-next-line no-console
            console.debug(`[parse] Unrecognized line format in ${dictName} at line ${idx + 1}: "${raw}"`);
          }
        }

        console.log(`[parse] ${dictName} parsed ${dictData.length} entries`);
        if (dictData.length === 0) {
          // 顯示前幾行原始內容以利除錯
          console.warn(`[parse] ${dictName} parsed 0 entries. First 8 raw lines:`, lines.slice(0, 8));
        } else {
          console.log(`[parse] ${dictName} sample:`, dictData.slice(0, 5));
        }

        return dictData;
      } catch (error) {
        console.error(`[parse] Failed to fetch/parse ${dictName}: ${error && error.message}`);
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
      console.log(`[factory] Trie ${dictNames[idx]} inserted ${inserted}`);
      return trie;
    });

    // 建立逐字映射（若字典看起來是逐字類型）
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

      // 合併 per-char maps（後者覆蓋前者）
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
        if (!dictNames) throw new Error(`Conversion chain not found: ${chainKey}`);

        console.log(`[create] Creating converter for ${chainKey}:`, dictNames);

        const dictionaries = await Promise.all(dictNames.map(name => fetchAndParseDict(name, baseUrl)));

        console.log(`[create] Loaded dictionaries count: ${dictionaries.length}`);

        // 顯示 TWVariants 狀態（若在 chain 裡）
        const twIdx = dictNames.indexOf('TWVariants');
        if (twIdx >= 0) {
          const tw = dictionaries[twIdx];
          console.log(`[create] TWVariants parsed entries: ${tw.length}`);
          if (tw.length > 0) console.log('[create] TWVariants sample:', tw.slice(0, 8));
          else console.warn('[create] TWVariants parsed 0 entries — 檔案存在但解析失敗或格式不同');
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
      console.log(`[test] Running testConversion for ${chainKey} with input: "${text}"`);
      const converter = await this.createConverter(chainKey);
      const out = converter(text);
      console.log(`[test] result: "${out}"`);
      return out;
    }
  };
})();
