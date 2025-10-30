/**
 * Modern, Promise-based, dependency-free OpenCC-JS.
 *
 * Patched to:
 * - Include raw.githubusercontent.com dictionary source
 * - Try multiple filename extensions (.txt, .utf8)
 * - Robust parsing and defensive handling so all conversion chains run
 *
 * @version 1.2.4 (Add raw.githubusercontent.com + multi-ext fallback)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  // 字典來源：優先 CDN，再 fallback 到 raw.githubusercontent.com
  const DICT_SOURCES = [
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
    // raw.githubusercontent fallback（確保版本路徑正確）
    'https://raw.githubusercontent.com/BYVoid/OpenCC/ver.1.1.7/data/dictionary/'
  ];

  // 嘗試的副檔名順序
  const DICT_EXTS = ['.txt', '.utf8', '.txt.gz'];

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

  async function fetchUrl(url, options = {}) {
    const response = await fetch(url, Object.assign({ method: 'GET', mode: 'cors', headers: { 'Accept': 'text/plain, */*' } }, options));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.text();
  }

  async function fetchWithFallback(dictName, baseSources) {
    let lastError = null;

    for (const baseUrl of baseSources) {
      for (const ext of DICT_EXTS) {
        const tryUrl = `${baseUrl}${dictName}${ext}`;
        try {
          console.log(`Trying to fetch: ${tryUrl}`);
          const text = await fetchUrl(tryUrl);
          console.log(`Successfully fetched ${dictName} from ${tryUrl}`);
          return text;
        } catch (err) {
          console.warn(`Failed to fetch ${dictName} from ${tryUrl}: ${err.message}`);
          lastError = err;
          // continue to next ext or base
        }
      }
    }

    throw new Error(`Failed to fetch ${dictName} from all sources. Last error: ${lastError ? lastError.message : 'unknown'}`);
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
        const lines = text.split(/\r?\n/);
        const dictData = [];

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;

          // 支援 tab 或多個空白作為 key/value 分隔
          const tabIndex = line.indexOf('\t');
          if (tabIndex > 0) {
            const key = line.substring(0, tabIndex).trim();
            const valuesPart = line.substring(tabIndex + 1).trim();

            // 使用正則化 whitespace 分割，取第一個非空值
            const value = (valuesPart.split(/\s+/).find(v => v && v.length > 0)) || '';

            if (key && value) dictData.push([key, value]);
          } else {
            // 有時候字典使用空白分隔（沒有 tab），嘗試第一個空白
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
              const key = parts[0].trim();
              const value = parts[1].trim();
              if (key && value) dictData.push([key, value]);
            }
          }
        }

        console.log(`Parsed ${dictData.length} entries from ${dictName}`);
        if (dictData.length > 0) console.log(`${dictName} sample entries:`, dictData.slice(0, 3));
        else console.warn(`${dictName} parsed with 0 entries`);

        return dictData;
      } catch (error) {
        console.error(`Error parsing dictionary ${dictName}:`, error);
        dictionaryCache.delete(cacheKey);
        throw error;
      }
    })();

    dictionaryCache.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  function ConverterFactory(dictionaries, chainName) {
    const tries = dictionaries.map((dictData, index) => {
      if (!Array.isArray(dictData)) {
        console.warn(`Dictionary at index ${index} for chain ${chainName} is not an array. Coercing to empty array.`);
        dictData = [];
      }

      const trie = new Trie();
      let insertCount = 0;

      for (const pair of dictData) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const key = pair[0];
        const value = pair[1];
        if (key && value && key !== value) {
          trie.insert(key, value);
          insertCount++;
        }
      }

      console.log(`Dictionary ${index} in ${chainName}: inserted ${insertCount} conversions`);
      if (insertCount === 0) console.warn(`Dictionary ${index} in ${chainName} had no usable entries`);
      return trie;
    });

    return function(text) {
      let result = text;
      for (let i = 0; i < tries.length; i++) {
        const previousResult = result;
        result = tries[i].convert(result);
        if (result !== previousResult) {
          console.log(`Step ${i + 1} conversion: "${previousResult}" -> "${result}"`);
        }
      }
      return result;
    };
  }

  // 字典鏈配置 - 確保順序正確（TWVariants 在 s2tw 中靠後）
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
          baseUrl = options.dictPath || null;
        }

        const dictNames = conversionChains[chainKey];
        if (!dictNames) {
          throw new Error(`Conversion chain not found: ${chainKey}. Available chains: ${Object.keys(conversionChains).join(', ')}`);
        }

        console.log(`Creating converter for ${chainKey} with dictionaries:`, dictNames);

        const dictionaries = await Promise.all(
          dictNames.map(name => fetchAndParseDict(name, baseUrl))
        );

        console.log(`Successfully loaded all dictionaries for ${chainKey}`);

        if (chainKey === 's2tw' && dictionaries.length >= 3) {
          const twVariantsDict = dictionaries[2];
          console.log(`TWVariants dictionary loaded with ${twVariantsDict.length} entries`);
          if (twVariantsDict.length > 0) console.log('TWVariants sample entries:', twVariantsDict.slice(0, 5));
        }

        return ConverterFactory(dictionaries, chainKey);
      } catch (error) {
        console.error('createConverter failed:', error);
        throw error;
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
        console.log(`Testing conversion: ${chainKey}`);
        console.log(`Input text: "${text}"`);
        const converter = await this.createConverter(chainKey);
        const result = converter(text);
        console.log(`Final result: "${result}"`);
        return result;
      } catch (error) {
        console.error('Test conversion failed:', error);
        throw error;
      }
    },

    // 進階：逐字典檢查工具，方便 debug（會回傳每個字典前 n 筆）
    async inspectDictionaries(chainKey = 's2tw', sampleSize = 5, customBaseUrl = null) {
      const dictNames = conversionChains[chainKey];
      if (!dictNames) throw new Error(`Conversion chain not found: ${chainKey}`);
      const dictionaries = await Promise.all(dictNames.map(n => fetchAndParseDict(n, customBaseUrl)));
      return dictNames.map((name, idx) => ({ name, entriesCount: (dictionaries[idx] || []).length, sample: (dictionaries[idx] || []).slice(0, sampleSize) }));
    }
  };
})();

/* 使用範例（取消註解以測試）
(async () => {
  try {
    const converter = await OpenCC.createConverter('s2tw');
    console.log(converter('简体中文 裡面 裏面'));
    
    // 逐字典檢查範例
    const inspection = await OpenCC.inspectDictionaries('s2tw');
    console.log('Inspection:', inspection);
  } catch (e) {
    console.error(e);
  }
})();
*/
