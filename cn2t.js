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
 * @version 1.2.3 (TWVariants Bug Fixed)
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
          
          // 修正：更嚴格的解析邏輯
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
        
        // 調試：顯示前幾條記錄
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
  
  function ConverterFactory(dictionaries, chainName) {
    const tries = dictionaries.map((dictData, index) => {
      const trie = new Trie();
      let insertCount = 0;
      
      for (const [key, value] of dictData) {
        if (key && value && key !== value) { // 只插入有意義的轉換
          trie.insert(key, value);
          insertCount++;
        }
      }
      
      console.log(`Dictionary ${index} in ${chainName}: inserted ${insertCount} conversions`);
      return trie;
    });

    return function(text) {
      let result = text;
      
      // 逐步應用每個字典的轉換
      for (let i = 0; i < tries.length; i++) {
        const previousResult = result;
        result = tries[i].convert(result);
        
        // 調試：顯示每步轉換結果
        if (result !== previousResult) {
          console.log(`Step ${i + 1} conversion: "${previousResult}" -> "${result}"`);
        }
      }
      
      return result;
    };
  }

  // 字典鏈配置 - 確保 TWVariants 在正確位置
  const conversionChains = {
    's2t': ['STCharacters', 'STPhrases'],
    't2s': ['TSCharacters', 'TSPhrases'],
    's2tw': ['STCharacters', 'STPhrases', 'TWVariants'], // 確保 TWVariants 最後執行
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
        
        // 驗證 TWVariants 字典是否正確加載
        if (chainKey === 's2tw' && dictionaries.length >= 3) {
          const twVariantsDict = dictionaries[2]; // TWVariants 應該是第三個
          console.log(`TWVariants dictionary loaded with ${twVariantsDict.length} entries`);
          if (twVariantsDict.length > 0) {
            console.log('TWVariants sample entries:', twVariantsDict.slice(0, 5));
          }
        }
        
        return ConverterFactory(dictionaries, chainKey);
        
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
    },
    
    // 新增：測試方法，用於調試
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

// 使用範例和測試：
/*
(async () => {
  try {
    // 測試簡體到台灣正體的轉換
    console.log('=== Testing s2tw conversion ===');
    const converter = await OpenCC.createConverter('s2tw');
    
    // 測試一些包含異體字的文本
    const testTexts = [
      '简体中文',
      '台湾正体',
      '繁體字',
      '裡面',
      '裏面'
    ];
    
    for (const text of testTexts) {
      const result = converter(text);
      console.log(`"${text}" -> "${result}"`);
    }
    
  } catch (error) {
    console.error('轉換器創建失敗:', error);
  }
})();
*/
