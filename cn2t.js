/**
 * OpenCC-JS 修正版：強制 TWVariants 最終逐字替換（更嚴謹的字典保留與逐字應用）
 *
 * @version 1.2.7 (強制 TWVariants 最終逐字替換)
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
          const m = trimmedLine.match(/(\S+)\s+(.+)/);
          if (m) {
            const key = m[1];
            const valuesPart = m[2].trim();
            const value = valuesPart.split(/\s+/)[0];
            if (key !== undefined && value !== undefined) {
              dictData.push([key, value]);
            }
          } else {
            console.debug(`[parse] Unrecognized line in ${dictName} line ${idx + 1}: "${raw}"`);
          }
        }

        console.log(`[parse] ${dictName} parsed ${dictData.length} entries`);
        if (dictData.length === 0) {
          console.warn(`[parse] ${dictName} parsed 0 entries. Raw head:\n`, lines.slice(0, 8));
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

  /**
   * ConverterFactory:
   * - 接收原始 dictData 陣列與 dictNames
   * - 建立 Trie 並保留 dictData 以供最終逐字替換
   * - 最終逐字替換步驟會從所有逐字字典（或字典中所有 key 的字元）建立最終 charMap
   */
  function ConverterFactory(dictionaries, dictNames, chainName) {
    // 建 Trie 並紀錄插入數量
    const tries = dictionaries.map((dictData, idx) => {
      const trie = new Trie();
      let inserted = 0;
      for (const [k, v] of dictData) {
        if (k && v && k !== v) { trie.insert(k, v); inserted++; }
      }
      console.log(`[factory] Trie build ${dictNames[idx]} inserted ${inserted}`);
      return trie;
    });

    // 保留原始 dictData（用於最終逐字替換）
    const rawDicts = dictNames.map((name, idx) => ({ name, data: dictionaries[idx] }));

    // 判斷哪些字典應視為逐字字典（啟發式）
    function looksLikeCharDict(name, dictData) {
      let single = 0, total = 0;
      for (const [k] of dictData) { total++; if (k.length === 1) single++; }
      return (single / Math.max(1, total)) > 0.6 || /Variants|HK|TW/i.test(name);
    }

    return function(text) {
      let result = text;

      // 1) 先逐字串/片語套用 Trie（保有長詞優先）
      for (let i = 0; i < tries.length; i++) {
        const prev = result;
        result = tries[i].convert(result);
        if (result !== prev) {
          console.log(`[convert] After ${dictNames[i]}: "${prev}" -> "${result}"`);
        }
      }

      // 2) 強制最終逐字替換（從 rawDicts 建立 finalMap，後面的字典覆蓋前面的）
      const finalMap = Object.create(null);

      // a) 先把明顯的單字對應加入 finalMap（key.length === 1）
      for (let i = 0; i < rawDicts.length; i++) {
        const { name, data } = rawDicts[i];
        if (!data || data.length === 0) continue;
        // 若看起來像逐字字典，或名稱含 Variants，優先處理
        if (looksLikeCharDict(name, data) || /Variants/i.test(name)) {
          for (const [k, v] of data) {
            if (k && v && k.length === 1) finalMap[k] = v;
          }
        }
      }

      // b) 若某些字仍未被替換，並且 rawDicts 中有多字 key（例如某些變體字典會有多字 key）
      // 我們再做一個保守處理：對於每個 remaining 字元，若該字出現在任何 dict 的 key（無論 key 長度），
      // 就使用該 dict 中第一個出現該字的 mapping（尊重 dicts 的順序由前到後，後者覆蓋前者）。
      // 這步是為了捕捉「key 非單字但其中含有異體字」的情況
      // 建立一個字元到映射的暫時表
      const supplementalMap = Object.create(null);
      for (let i = 0; i < rawDicts.length; i++) {
        const { name, data } = rawDicts[i];
        if (!data) continue;
        for (const [k, v] of data) {
          if (!k || !v) continue;
          // 對 key 中的每個字元，若尚未在 supplementalMap 中登記，先登記一個候選（後面的字典會覆蓋）
          for (const ch of k) {
            // 只有在 ch 尚未有 finalMap 時才考慮（finalMap 優先級高）
            if (!finalMap[ch]) supplementalMap[ch] = v;
          }
        }
      }

      // 合併 supplementalMap 到 finalMap（但不覆蓋已存在 finalMap）
      for (const ch in supplementalMap) {
        if (!finalMap[ch]) finalMap[ch] = supplementalMap[ch];
      }

      // c) 最終針對結果字串逐字替換
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

        // 顯示 TWVariants 的狀態以便 debug
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
