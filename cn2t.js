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
 * This version is now patched to correctly parse all dictionary types and, more
 * importantly, to correctly merge all dictionaries in a chain into a single
 * Trie. This fixes the fundamental flaw of sequential conversion and ensures
 * that longest-match precedence works correctly across character and phrase dictionaries.
 *
 * @version 1.2.7 (Patched)
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
            const value = parts[1].trim(); 
            if (key && value) {
              dictData.push([key, value]);
            }
          }
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

  // [FIXED] 重寫 ConverterFactory 以合併所有字典到單一 Trie
  function ConverterFactory(dictionaries) {
    const combinedTrie = new Trie();

    // 依序將所有字典檔的規則加入到同一個 Trie 中
    // OpenCC 的標準是先載入字元字典，再載入詞彙字典
    // 這樣可以確保在 Trie 中建立正確的詞彙路徑
    for (const dictData of dictionaries) {
      for (const [key, value] of dictData) {
        // 確保不插入無效或相同的規則
        if (key && value && key !== value) {
          combinedTrie.insert(key, value);
        }
      }
    }

    // 返回的轉換函式現在只對這個統一的 Trie 進行一次轉換
    return function(text) {
      return combinedTrie.convert(text);
    };
  }

  // 字典鏈配置
  const conversionChains = {
    's2t': ['STCharacters', 'STPhrases'],
    's2tw': ['STCharacters', 'STPhrases', 'TWVariants'],
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName'],
    // [MODIFIED] 根據要求移除 s2hk
    // 's2hk': ['STCharacters', 'STPhrases', 'HKVariants'], 
    
    // 繁轉簡功能預設仍不支援
    // 't2s': ['TSCharacters', 'TSPhrases'],
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

        // 使用修復後的工廠函數
        return ConverterFactory(dictionaries);
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

// 使用範例：現在 s2twp 應該可以完美地執行
(async () => {
  try {
    console.log('=== 測試簡體到台灣正體用語 (s2twp) ===');
    const converter = await OpenCC.createConverter('s2twp');
    
    let text = '服务器和打印机，里面有鼠标和忧郁的乌龟。';
    let result = converter(text);
    console.log(`Input:  "${text}"`);
    console.log(`Output: "${result}"`);
    console.log('預期輸出: "伺服器和印表機，裡面有滑鼠和憂鬱的烏龜。"'); // 加上預期結果以方便比對

    console.log('\n=== 再次測試混合詞彙 ===');
    let text2 = '我们不只使用鼠标和键盘，还使用调制解调器上网。';
    let result2 = converter(text2);
    console.log(`Input:  "${text2}"`);
    console.log(`Output: "${result2}"`);
    console.log('預期輸出: "我們不只使用滑鼠和鍵盤，還使用數據機上網。"');
    
  } catch (error) {
    console.error('初始化或轉換失敗:', error);
  }
})();
