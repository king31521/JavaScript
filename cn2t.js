/**
 * Modern, Promise-based, dependency-free OpenCC-JS.
 *
 * This version includes robust parsing and adjusted dictionary chain order so
 * TWVariants mappings are applied correctly for s2tw conversions.
 *
 * @version 1.2.4
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  const DICT_SOURCES = [
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
  ];

  const dictionaryCache = new Map();

  function Trie() {
    this.root = {};
  }

  Trie.prototype.insert = function(word, value) {
    let node = this.root;
    for (const char of word) {
      if (!node[char]) {
        node[char] = {};
      }
      node = node[char];
    }
    node.value = value;
    node.wordEnd = true;
  };

  Trie.prototype.convert = function(text) {
    let result = '';
    let i = 0;
    const len = text.length;
    while (i < len) {
      let node = this.root;
      let j = i;
      let lastMatch = null;

      while (j < len && node[text[j]]) {
        node = node[text[j]];
        if (node.wordEnd) {
          lastMatch = {
            end: j,
            value: node.value
          };
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
      try {
        const url = `${baseUrl}${dictName}.txt`;
        console.log(`Trying to fetch: ${url}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'text/plain, */*' },
          mode: 'cors'
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const text = await response.text();
        console.log(`Successfully fetched ${dictName} from ${baseUrl}`);
        return text;
      } catch (error) {
        console.warn(`Failed to fetch ${dictName} from ${baseUrl}:`, error.message || error);
        lastError = error;
        continue;
      }
    }
    throw new Error(`Failed to fetch ${dictName} from all sources. Last error: ${lastError && lastError.message ? lastError.message : lastError}`);
  }

  async function fetchAndParseDict(dictName, customBaseUrl = null) {
    const sources = customBaseUrl ? [customBaseUrl] : DICT_SOURCES;
    const cacheKey = `${sources.join(',')}:${dictName}`;

    if (dictionaryCache.has(cacheKey)) {
      return await dictionaryCache.get(cacheKey);
    }

    const fetchPromise = (async () => {
      try {
        const raw = await fetchWithFallback(dictName, sources);
        // 支援 CRLF 與 LF，並移除 BOM
        const text = raw.replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/);
        const dictData = [];

        for (let line of lines) {
          if (!line) continue;
          line = line.trim();
          if (!line || line.startsWith('#')) continue;

          // 支援 tab 或 多個空白作為 key/value 分隔，找到第一個 separator (tab 或 連續空白)
          // 優先使用 tab，如果沒有則使用第一段空白分隔
          let key = null;
          let valuesPart = null;

          const tabIndex = line.indexOf('\t');
          if (tabIndex >= 0) {
            key = line.substring(0, tabIndex).trim();
            valuesPart = line.substring(tabIndex + 1).trim();
          } else {
            // 使用第一個連續空白作為分隔點
            const m = line.match(/\s+/);
            if (m) {
              const idx = m.index;
              key = line.substring(0, idx).trim();
              valuesPart = line.substring(idx + m[0].length).trim();
            } else {
              // 若整行無分隔，跳過
              continue;
            }
          }

          if (!key || !valuesPart) continue;

          // 值可能包含多個候選，以任意空白分割，取第一個非空候選作為轉換值
          const valueTokens = valuesPart.split(/\s+/).filter(Boolean);
          if (valueTokens.length === 0) continue;
          const value = valueTokens[0];

          // 最後再做基本過濾（避免空字串）
          if (key.length > 0 && value.length > 0) {
            dictData.push([key, value]);
          }
        }

        console.log(`Parsed ${dictData.length} entries from ${dictName}`);
        if (dictData.length > 0) {
          console.log(`${dictName} sample entries:`, dictData.slice(0, 5));
        }

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
      const trie = new Trie();
      let insertCount = 0;
      for (const [key, value] of dictData) {
        if (key && value) {
          // 不再以 key===value 一律跳過（某些字典可能有意義）
          if (key !== value) {
            trie.insert(key, value);
            insertCount++;
          } else {
            // 若 key===value 但 key 為多字或有必要，仍可插入（此處保守策略只在不相等時插入）
          }
        }
      }
      console.log(`Dictionary ${index} in ${chainName}: inserted ${insertCount} conversions`);
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

  // 調整字典鏈順序：對 s2tw 將 TWVariants 放在 STPhrases 前或介於字符與片語之間
  const conversionChains = {
    's2t': ['STCharacters', 'STPhrases'],
    't2s': ['TSCharacters', 'TSPhrases'],
    // 對 s2tw：先用 STCharacters，再用 TWVariants 做單字異體映射，最後用 STPhrases/短語映射修正片語
    's2tw': ['STCharacters', 'TWVariants', 'STPhrases'],
    'tw2s': ['TWVariantsRev', 'TSCharacters', 'TSPhrases'],
    's2twp': ['STCharacters', 'TWVariants', 'STPhrases', 'TWPhrasesIT', 'TWPhrasesName'],
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
        if (!dictNames) {
          throw new Error(`Conversion chain not found: ${chainKey}. Available chains: ${Object.keys(conversionChains).join(', ')}`);
        }

        console.log(`Creating converter for ${chainKey} with dictionaries:`, dictNames);

        const dictionaries = await Promise.all(
          dictNames.map(name => fetchAndParseDict(name, baseUrl))
        );

        console.log(`Successfully loaded all dictionaries for ${chainKey}`);

        if (chainKey === 's2tw' && dictionaries.length >= 2) {
          // 顯示 TWVariants 條目數以利排查
          const idx = dictNames.indexOf('TWVariants');
          if (idx >= 0) {
            const twVariantsDict = dictionaries[idx];
            console.log(`TWVariants dictionary loaded with ${twVariantsDict.length} entries`);
            if (twVariantsDict.length > 0) {
              console.log('TWVariants sample entries:', twVariantsDict.slice(0, 10));
            }
          }
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
    }
  };
})();

/* 使用範例（註解）： 
(async () => {
  try {
    const converter = await OpenCC.createConverter('s2tw');
    console.log(converter('简体中文 裡面 裏面'));
  } catch (e) {
    console.error(e);
  }
})();
*/
