/**
 * Modern, Promise-based, dependency-free OpenCC-JS.
 *
 * This version is configurable (dict path), uses fallback sources, and fixes TWVariants
 * final-character mapping by applying a forced per-character replacement pass after
 * phrase-level conversions.
 *
 * @version 1.2.4 (TWVariants final-character pass)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  // 備選字典來源（CDN）
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
    while (i < text.length) {
      let node = this.root;
      let j = i;
      let lastMatch = null;

      // 尋找最長匹配
      while (j < text.length && node[text[j]]) {
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
    let lastError;

    for (const baseUrl of baseSources) {
      try {
        const url = `${baseUrl}${dictName}.txt`;
        console.log(`Trying to fetch: ${url}`);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'text/plain, */*',
          },
          mode: 'cors'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        console.log(`Successfully fetched ${dictName} from ${baseUrl}`);
        return text;

      } catch (error) {
        console.warn(`Failed to fetch ${dictName} from ${baseUrl}:`, error.message);
        lastError = error;
        continue;
      }
    }

    throw new Error(`Failed to fetch ${dictName} from all sources. Last error: ${lastError && lastError.message}`);
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
          if (trimmedLine === '' || trimmedLine.startsWith('#')) {
            continue;
          }

          // 嚴格解析：以第一個 tab 分隔 key 與 values
          const tabIndex = trimmedLine.indexOf('\t');
          if (tabIndex > 0) {
            const key = trimmedLine.substring(0, tabIndex);
            const valuesPart = trimmedLine.substring(tabIndex + 1);

            // 取第一個轉換選項（用空格分隔）
            const value = valuesPart.split(' ')[0];

            if (key && value) {
              dictData.push([key, value]);
            }
          }
        }

        console.log(`Parsed ${dictData.length} entries from ${dictName}`);

        if (dictData.length > 0) {
          console.log(`${dictName} sample entries:`, dictData.slice(0, 3));
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

  /**
   * ConverterFactory 修正
   * - 接受 dictionaries (陣列) 與 dictNames（對應的字典名稱陣列）
   * - 對於某些字典（如 TWVariants / TWVariantsRev / HKVariants / HKVariantsRev）同時建立 charMap
   * - 在完成所有 Trie（片語/詞組）轉換後，強制做一遍逐字替換（使用所有收集到的 charMap，按鏈順序覆蓋）
   */
  function ConverterFactory(dictionaries, dictNames, chainName) {
    // 建立每個字典的 Trie（片語優先）
    const tries = dictionaries.map((dictData, index) => {
      const trie = new Trie();
      let insertCount = 0;

      for (const [key, value] of dictData) {
        if (key && value && key !== value) {
          trie.insert(key, value);
          insertCount++;
        }
      }

      console.log(`Dictionary ${index} (${dictNames[index]}) in ${chainName}: inserted ${insertCount} conversions`);
      return trie;
    });

    // 建立逐字映射集合：若字典名稱為變體字典，我們會從其 dictData 中建立 charMap
    const perCharMaps = []; // array of { name, map } 按字典順序

    for (let i = 0; i < dictNames.length; i++) {
      const name = dictNames[i];
      const dictData = dictionaries[i];

      // 這些字典通常是單字映射：TWVariants, TWVariantsRev, HKVariants, HKVariantsRev, etc.
      // 我們透過簡單啟發：若大部分 key 的長度為1，則可視為逐字字典；另外 name 包含 "Variants" 也是可用指標
      let singleCharCount = 0;
      let totalCount = 0;
      for (const [k] of dictData) {
        totalCount++;
        if (k.length === 1) singleCharCount++;
      }
      const looksLikeCharDict = (singleCharCount / Math.max(1, totalCount)) > 0.6 || /Variants|HK|TW|TWPhrasesNameRev|TWPhrasesITRev/i.test(name);

      if (looksLikeCharDict) {
        const map = Object.create(null);
        for (const [k, v] of dictData) {
          if (k && v) {
            // 只記錄單字對應或長度為1的 key，若 key 長度 >1 也記錄但在逐字替換時只適用單字
            if (k.length === 1) {
              map[k] = v;
            }
          }
        }
        perCharMaps.push({ name, map });
        console.log(`Per-char map created for ${name}, entries: ${Object.keys(map).length}`);
      } else {
        perCharMaps.push({ name, map: null });
      }
    }

    return function(text) {
      let result = text;

      // 逐步套用每個 Trie（片語/詞組）轉換
      for (let i = 0; i < tries.length; i++) {
        const previousResult = result;
        result = tries[i].convert(result);

        if (result !== previousResult) {
          console.log(`Step ${i + 1} conversion (${dictNames[i]}): "${previousResult}" -> "${result}"`);
        }
      }

      // 在所有片語轉換後，強制做逐字替換：按字典鏈的順序套用 perCharMaps（後面的覆蓋前面的）
      // 這能確保 TWVariants 等作為最終覆蓋在整段文字中每個殘留字
      // 我們先合併成單一最終 charMap（後面的字典覆蓋前面的）
      const finalCharMap = Object.create(null);
      for (let i = 0; i < perCharMaps.length; i++) {
        const entry = perCharMaps[i];
        if (entry.map) {
          for (const ch in entry.map) {
            finalCharMap[ch] = entry.map[ch];
          }
        }
      }

      // 若 finalCharMap 有條目，做逐字替換
      if (Object.keys(finalCharMap).length > 0) {
        // 最佳化：使用陣列拼接
        const chars = [];
        for (const ch of result) {
          if (finalCharMap[ch]) {
            chars.push(finalCharMap[ch]);
          } else {
            chars.push(ch);
          }
        }
        const afterCharReplace = chars.join('');
        if (afterCharReplace !== result) {
          console.log(`Final per-char replacement applied: "${result}" -> "${afterCharReplace}"`);
        }
        result = afterCharReplace;
      }

      return result;
    };
  }

  // 字典鏈配置
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
        if (!dictNames) {
          throw new Error(`Conversion chain not found: ${chainKey}. Available chains: ${Object.keys(conversionChains).join(', ')}`);
        }

        console.log(`Creating converter for ${chainKey} with dictionaries:`, dictNames);

        // 依序載入字典（可供自訂 baseUrl）
        const dictionaries = await Promise.all(
          dictNames.map(name => fetchAndParseDict(name, baseUrl))
        );

        console.log(`Successfully loaded all dictionaries for ${chainKey}`);

        // 偵錯：檢查 TWVariants 是否有內容
        if ((chainKey === 's2tw' || chainKey === 's2twp') && dictionaries.length >= 3) {
          const idx = dictNames.indexOf('TWVariants');
          if (idx >= 0) {
            const twVariantsDict = dictionaries[idx];
            console.log(`TWVariants dictionary loaded with ${twVariantsDict.length} entries`);
            if (twVariantsDict.length > 0) {
              console.log('TWVariants sample entries:', twVariantsDict.slice(0, 5));
            }
          }
        }

        return ConverterFactory(dictionaries, dictNames, chainKey);

      } catch (error) {
        console.error('createConverter failed:', error);
        throw error;
      }
    },

    // 清除快取
    clearCache() {
      dictionaryCache.clear();
      console.log('Dictionary cache cleared');
    },

    // 取得支援的轉換鏈
    getSupportedConversions() {
      return Object.keys(conversionChains);
    },

    // 測試方法
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

/*
 使用範例：
 (async () => {
   try {
     const converter = await OpenCC.createConverter('s2tw');
     const texts = ['简体中文', '台湾正体', '繁體字', '裡面', '裏面'];
     for (const t of texts) {
       console.log(`"${t}" -> "${converter(t)}"`);
     }
   } catch (e) {
     console.error(e);
   }
 })();
*/
