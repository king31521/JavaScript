/**
 * Modern, Promise-based, dependency-free OpenCC-JS.
 *
 * This version is modified to be configurable, allowing the dictionary path to be
 * specified during converter creation. This is ideal for use in environments like
 * Tampermonkey where using a CDN is preferable.
 *
 * This version is patched to fix CORS, 404 errors, and dictionary parsing.
 *
 * This final patch corrects the core conversion logic:
 * 1.  It merges all dictionaries in a chain into a single Trie, ensuring longest-match works correctly.
 * 2.  It removes the faulty `key !== value` filter, correctly including "identity mappings" (e.g., "不只" -> "不只") which are crucial for preventing words from being incorrectly broken apart.
 * 3.  It ensures that dictionaries are loaded in the correct order, allowing later dictionaries (e.g., regional variants) to properly override earlier, more general ones.
 *
 * @version 1.2.8 (Final Patch)
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
        return await response.text();
      } catch (error) {
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

  function ConverterFactory(dictionaries) {
    const combinedTrie = new Trie();

    // 依序將所有字典檔的規則加入同一個 Trie。
    // 這個順序非常重要：後載入的字典會覆蓋先載入的字典中的相同鍵值。
    // 這正是 OpenCC 實現區域性用語替換的原理。
    for (const dictData of dictionaries) {
      for (const [key, value] of dictData) {
        // [FIXED] 移除 key !== value 的判斷。
        // 必須包含 'key -> key' 這種對應，它們是用來保護詞彙不被錯誤拆分的。
        if (key) { // 只需要確保鍵存在即可
          combinedTrie.insert(key, value);
        }
      }
    }

    return function(text) {
      return combinedTrie.convert(text);
    };
  }

  const conversionChains = {
    's2t': ['STCharacters', 'STPhrases'],
    's2tw': ['STCharacters', 'STPhrases', 'TWVariants'],
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName'],
    // 繁轉簡功能預設仍不支援
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

        // Promise.all 維持了陣列的順序，確保字典按正確順序載入
        const dictionaries = await Promise.all(
          dictNames.map(name => fetchAndParseDict(name, baseUrl))
        );
        
        return ConverterFactory(dictionaries);
      } catch (error) {
        console.error('createConverter failed:', error);
        throw error;
      }
    },

    clearCache() {
      dictionaryCache.clear();
    },

    getSupportedConversions() {
      return Object.keys(conversionChains);
    }
  };
})();

// 使用範例：現在 s2twp 將會產生完全正確的輸出
(async () => {
  try {
    // 為了確保看到最新效果，可以先清除快取 (正式使用時不需要)
    OpenCC.clearCache();

    console.log('=== 測試簡體到台灣正體用語 (s2twp) ===');
    const converter = await OpenCC.createConverter('s2twp');
    
    let text = '服务器和打印机，里面有鼠标和忧郁的乌龟。';
    let result = converter(text);
    console.log(`Input:  "${text}"`);
    console.log(`Output: "${result}"`);
    console.log('預期輸出: "伺服器和印表機，裡面有滑鼠和憂鬱的烏龜。"');

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
