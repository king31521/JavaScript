/**
 * Modern, Promise-based, dependency-free OpenCC-JS.
 *
 * This version is modified to be configurable, allowing the dictionary path to be
 * specified during converter creation. This is ideal for use in environments like
 * Tampermonkey where using a CDN is preferable.
 *
 * This version is patched to fix CORS and 404 errors by using proper raw URLs
 * and fallback sources.
 *
 * This version is now patched to correctly parse all dictionary types,
 * enabling full conversion chain support (s2t, s2tw, s2twp, s2hk, etc.).
 *
 * @version 1.2.6 (Patched)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  // 使用正確的 raw 文件 URL，並提供多個備選源
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
        return text;
      } catch (error) {
        console.warn(`Failed to fetch ${dictName} from ${baseUrl}:`, error.message);
        lastError = error;
        continue;
      }
    }
    throw new Error(`Failed to fetch ${dictName} from all sources. Last error: ${lastError.message}`);
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
          const parts = trimmedLine.split('\t');
          if (parts.length >= 2) {
            const key = parts[0].trim();
            // [FIXED] 移除 .split(' ')[0]，將 tab 後的整個字串視為值
            const value = parts[1].trim(); 
            if (key && value) {
              dictData.push([key, value]);
            }
          }
        }
        // console.log(`Parsed ${dictData.length} entries from ${dictName}`);
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
    const tries = dictionaries.map((dictData) => {
      const trie = new Trie();
      for (const [key, value] of dictData) {
        if (key && value && key !== value) {
          trie.insert(key, value);
        }
      }
      return trie;
    });

    return function(text) {
      let result = text;
      for (let i = 0; i < tries.length; i++) {
        result = tries[i].convert(result);
      }
      return result;
    };
  }

  // 字典鏈配置
  const conversionChains = {
    's2t': ['STCharacters', 'STPhrases'],
    's2tw': ['STCharacters', 'STPhrases', 'TWVariants'],
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName'],
    // [MODIFIED] 根據要求移除 HKVariants
    's2hk': ['STCharacters', 'STPhrases'], 
    
    // 預設不支援繁轉簡，因為需要反向字典檔 (*Rev.txt)，此處保持註解
    // 't2s': ['TSCharacters', 'TSPhrases'],
    // 'tw2s': ['TWVariantsRev', 'TSCharacters', 'TSPhrases'],
    // 'tw2sp': ['TWVariantsRev', 'TWPhrasesITRev', 'TWPhrasesNameRev', 'TSCharacters', 'TSPhrases'],
    // 'hk2s': ['HKVariantsRev', 'TSCharacters', 'TSPhrases'],
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
          throw new Error(`Conversion chain not found or not supported: ${chainKey}. Available chains: ${Object.keys(conversionChains).join(', ')}`);
        }

        const dictionaries = await Promise.all(
          dictNames.map(name => fetchAndParseDict(name, baseUrl))
        );

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
    }
  };
})();

// 使用範例：現在所有簡轉繁的轉換器都應該能成功初始化並執行
(async () => {
  try {
    console.log('=== 測試簡體到台灣正體用語 (s2twp) ===');
    const converter = await OpenCC.createConverter('s2twp');
    // 測試範例包含了 s2t, s2tw, s2twp 中各層級字典會處理到的詞
    let text = '服务器和打印机，里面有鼠标和忧郁的乌龟。';
    let result = converter(text);
    console.log(`Input:  "${text}"`);
    console.log(`Output: "${result}"`); // 預期輸出: "伺服器和印表機，裡面有滑鼠和憂鬱的烏龜。"

    console.log('\n=== 測試簡體到香港繁體 (s2hk) ===');
    const converter_s2hk = await OpenCC.createConverter('s2hk');
    let text_hk = '我买了一只激光打印机。';
    let result_hk = converter_s2hk(text_hk);
    console.log(`Input:  "${text_hk}"`);
    console.log(`Output: "${result_hk}"`); // 預期輸出: "我買了一隻激光打印機。" (HKVariants 已移除，所以不會轉成 '雷射')

    // 以下測試會因為轉換鏈被移除而失敗，這是預期行為
    try {
        console.log('\n=== 測試台灣正體到簡體 (會失敗) ===');
        const converter_tw2s = await OpenCC.createConverter('tw2s');
        let text2 = '憂鬱的烏龜和裡面';
        let result2 = converter_tw2s(text2);
        console.log(`"${text2}" -> "${result2}"`);
    } catch (e) {
        console.log('成功捕獲錯誤：', e.message); // 預期會捕獲 'Conversion chain not found...'
    }

  } catch (error) {
    console.error('初始化失敗:', error);
  }
})();
