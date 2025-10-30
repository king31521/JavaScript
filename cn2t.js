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
 * @version 1.2.2 (CORS Fixed)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  // 修正：使用正確的 raw 文件 URL，並提供多個備選源
  const DICT_SOURCES = [
    // jsDelivr CDN (推薦，支持 CORS)
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    // 備選 CDN
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    // unpkg CDN
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
        console.log(`Trying to fetch: ${url}`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'text/plain, */*',
          },
          // 如果是同源請求或支持 CORS 的源，使用默認模式
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
            const [key, value] = parts;
            // 取第一個轉換選項（如果有多個選項的話）
            const values = value.split(' ')[0];
            dictData.push([key, values]);
          }
        }
        
        console.log(`Parsed ${dictData.length} entries from ${dictName}`);
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
    const tries = dictionaries.map(dictData => {
      const trie = new Trie();
      for (const [key, value] of dictData) {
        trie.insert(key, value);
      }
      return trie;
    });

    return function(text) {
      return tries.reduce((currentText, trie) => trie.convert(currentText), text);
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
        // 支援 { from: 's', to: 'twp' } 或直接傳入 's2twp'
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
        return ConverterFactory(dictionaries);
        
      } catch (error) {
        console.error('createConverter failed:', error);
        throw error;
      }
    },
    
    // 新增：清除快取的方法
    clearCache() {
      dictionaryCache.clear();
      console.log('Dictionary cache cleared');
    },
    
    // 新增：取得支援的轉換鏈
    getSupportedConversions() {
      return Object.keys(conversionChains);
    }
  };
})();

// 使用範例：
/*
(async () => {
  try {
    // 創建簡體到繁體轉換器
    const converter = await OpenCC.createConverter('s2t');
    console.log(converter('简体中文'));  // 輸出：簡體中文
    
    // 或使用物件語法
    const converter2 = await OpenCC.createConverter({ from: 's', to: 'tw' });
    console.log(converter2('简体中文'));  // 輸出：簡體中文
    
  } catch (error) {
    console.error('轉換器創建失敗:', error);
  }
})();
*/
