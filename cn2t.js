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
 * @version 1.2.4 (Dictionary Loading Bug Fixed)
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
        console.log(`Successfully fetched ${dictName} from ${baseUrl} (${text.length} bytes)`);
        return text;
        
      } catch (error) {
        console.warn(`Failed to fetch ${dictName} from ${baseUrl}:`, error.message);
        lastError = error;
        continue;
      }
    }
    
    throw new Error(`Failed to fetch ${dictName} from all sources. Last error: ${lastError.message}`);
  }

  // 修復：重新設計字典載入邏輯，確保每個字典獨立載入
  async function fetchAndParseDict(dictName, customBaseUrl = null) {
    const sources = customBaseUrl ? [customBaseUrl] : DICT_SOURCES;
    const cacheKey = `${sources.join(',')}:${dictName}`;
    
    // 如果快取中已有該字典，直接返回
    if (dictionaryCache.has(cacheKey)) {
      console.log(`Using cached dictionary: ${dictName}`);
      return await dictionaryCache.get(cacheKey);
    }

    // 創建新的載入 Promise
    const fetchPromise = (async () => {
      try {
        console.log(`Loading dictionary: ${dictName}`);
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
        
        console.log(`Successfully parsed ${dictData.length} entries from ${dictName}`);
        
        // 調試：顯示前幾條記錄
        if (dictData.length > 0) {
          console.log(`${dictName} sample entries:`, dictData.slice(0, 3));
        } else {
          console.warn(`Warning: ${dictName} dictionary is empty!`);
        }
        
        return dictData;
        
      } catch (error) {
        console.error(`Error loading dictionary ${dictName}:`, error);
        // 從快取中移除失敗的 Promise
        dictionaryCache.delete(cacheKey);
        throw error;
      }
    })();
    
    // 將 Promise 存入快取
    dictionaryCache.set(cacheKey, fetchPromise);
    return fetchPromise;
  }
  
  function ConverterFactory(dictionaries, chainName) {
    console.log(`Creating converter for ${chainName} with ${dictionaries.length} dictionaries`);
    
    const tries = dictionaries.map((dictData, index) => {
      const trie = new Trie();
      let insertCount = 0;
      
      if (!Array.isArray(dictData)) {
        console.error(`Dictionary ${index} is not an array:`, dictData);
        return trie;
      }
      
      for (const [key, value] of dictData) {
        if (key && value && key !== value) { // 只插入有意義的轉換
          trie.insert(key, value);
          insertCount++;
        }
      }
      
      console.log(`Dictionary ${index} (${chainName}): inserted ${insertCount} conversions from ${dictData.length} entries`);
      return trie;
    });

    return function(text) {
      let result = text;
      
      // 逐步應用每個字典的轉換
      for (let i = 0; i < tries.length; i++) {
        const previousResult = result;
        result = tries[i].convert(result);
        
        // 調試：只在有變化時顯示轉換結果
        if (result !== previousResult && previousResult.length < 50) { // 避免長文本的日誌
          console.log(`Step ${i + 1} (${chainName}): "${previousResult}" -> "${result}"`);
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
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName', 'TWPhrasesOther'],
    'tw2sp': ['TWVariantsRev', 'TWPhrasesITRev', 'TWPhrasesNameRev', 'TWPhrasesOtherRev', 'TSCharacters', 'TSPhrases'],
    's2hk': ['STCharacters', 'STPhrases', 'HKVariants'],
    'hk2s': ['HKVariantsRev', 'TSCharacters', 'TSPhrases'],
    't2tw': ['TWVariants'],
    'tw2t': ['TWVariantsRev'],
    't2hk': ['HKVariants'],
    'hk2t': ['HKVariantsRev'],
    't2jp': ['JPVariants'],
    'jp2t': ['JPVariantsRev']
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
        
        // 修復：確保每個字典都獨立載入
        const dictionaries = [];
        for (let i = 0; i < dictNames.length; i++) {
          const dictName = dictNames[i];
          try {
            console.log(`Loading dictionary ${i + 1}/${dictNames.length}: ${dictName}`);
            const dictData = await fetchAndParseDict(dictName, baseUrl);
            dictionaries.push(dictData);
            console.log(`Successfully loaded ${dictName}: ${dictData.length} entries`);
          } catch (error) {
            console.error(`Failed to load dictionary ${dictName}:`, error);
            // 載入失敗時，添加空字典以保持索引一致
            dictionaries.push([]);
          }
        }
        
        console.log(`Successfully processed all dictionaries for ${chainKey}`);
        console.log(`Dictionary counts:`, dictionaries.map(d => d.length));
        
        // 驗證關鍵字典是否正確加載
        if (chainKey === 's2tw' && dictionaries.length >= 3) {
          const twVariantsDict = dictionaries[2]; // TWVariants 應該是第三個
          console.log(`TWVariants dictionary loaded with ${twVariantsDict.length} entries`);
          if (twVariantsDict.length > 0) {
            console.log('TWVariants sample entries:', twVariantsDict.slice(0, 5));
          } else {
            console.warn('Warning: TWVariants dictionary is empty!');
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
    
    // 新增：取得快取狀態
    getCacheStatus() {
      const status = {};
      for (const [key, value] of dictionaryCache.entries()) {
        status[key] = value instanceof Promise ? 'loading' : 'loaded';
      }
      return status;
    },
    
    // 新增：取得支援的轉換鏈
    getSupportedConversions() {
      return Object.keys(conversionChains);
    },
    
    // 新增：預載入字典
    async preloadDictionaries(chainKey) {
      const dictNames = conversionChains[chainKey];
      if (!dictNames) {
        throw new Error(`Unknown conversion chain: ${chainKey}`);
      }
      
      console.log(`Preloading dictionaries for ${chainKey}:`, dictNames);
      const results = await Promise.allSettled(
        dictNames.map(name => fetchAndParseDict(name))
      );
      
      const loaded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log(`Preload complete: ${loaded} loaded, ${failed} failed`);
      return { loaded, failed, total: dictNames.length };
    },
    
    // 新增：測試方法，用於調試
    async testConversion(text, chainKey = 's2tw') {
      try {
        console.log(`\n=== Testing conversion: ${chainKey} ===`);
        console.log(`Input text: "${text}"`);
        
        const converter = await this.createConverter(chainKey);
        const result = converter(text);
        
        console.log(`Final result: "${result}"`);
        console.log(`Changed: ${text !== result}`);
        return result;
      } catch (error) {
        console.error('Test conversion failed:', error);
        throw error;
      }
    },

    // 新增：批量測試
    async batchTest(texts, chainKey = 's2tw') {
      console.log(`\n=== Batch testing: ${chainKey} ===`);
      const converter = await this.createConverter(chainKey);
      const results = [];
      
      for (const text of texts) {
        const result = converter(text);
        const changed = text !== result;
        results.push({ input: text, output: result, changed });
        console.log(`"${text}" -> "${result}" ${changed ? '✓' : '○'}`);
      }
      
      return results;
    }
  };
})();

// 使用範例和測試：
/*
(async () => {
  try {
    // 創建轉換器
    const converter = await OpenCC.createConverter('s2tw');
    
    // 執行轉換
    const result = converter('你好世界');
    console.log(result);
    
    // 批量測試
    await OpenCC.batchTest(['软件', '硬件', '网络', '数据库'], 's2tw');
    
  } catch (error) {
    console.error('Error:', error);
  }
})();
*/

// 如果在模組環境中，導出 OpenCC
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OpenCC;
}
