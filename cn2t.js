/**
 * Modern, Promise-based, dependency-free OpenCC-JS.
 *
 * This version is modified to be configurable, allowing the dictionary path to be
 * specified during converter creation. This is ideal for use in environments like
 * Tampermonkey where using a CDN is preferable.
 *
 * @version 1.2.0 (Configurable Edition)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  // 修改：將 URL 變為可配置的預設值
  const DEFAULT_DICT_BASE_URL = 'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/';
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

  // 修改：fetchAndParseDict 接收 baseUrl 作為參數
  async function fetchAndParseDict(dictName, baseUrl) {
    const cacheKey = `${baseUrl}:${dictName}`; // 緩存鍵需要包含 baseUrl
    if (dictionaryCache.has(cacheKey)) {
      return await dictionaryCache.get(cacheKey);
    }

    const fetchPromise = (async () => {
      const url = `${baseUrl}${dictName}.txt`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch dictionary ${dictName} from ${url}: ${response.statusText}`);
        }
        const text = await response.text();
        const lines = text.split('\n');
        const dictData = [];
        for (const line of lines) {
          if (line.trim() === '' || line.startsWith('#')) {
            continue;
          }
          const parts = line.split('\t');
          if (parts.length >= 2) {
            const [key, value] = parts;
            const values = value.split(' ')[0];
            dictData.push([key, values]);
          }
        }
        return dictData;
      } catch (error) {
        console.error(error);
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

  const conversionChains = {
    's2t': ['STPhrases', 'STCharacters'],
    't2s': ['TSPhrases', 'TSCharacters'],
    's2tw': ['STPhrases', 'STCharacters', 'TWVariants'],
    'tw2s': ['TWVariantsRev', 'TSPhrases', 'TSCharacters'],
    's2twp': ['STPhrases', 'STCharacters', 'TWPhrases', 'TWVariants'],
    'tw2sp': ['TWVariantsRev', 'TWPhrasesRev', 'TSPhrases', 'TSCharacters'],
    's2hk': ['STPhrases', 'STCharacters', 'HKVariants'],
    'hk2s': ['HKVariantsRev', 'TSPhrases', 'TSCharacters'],
  };
  
  return {
    async createConverter(options) {
      let chainKey = `${options.from}2${options.to}`;
      const dictNames = conversionChains[chainKey];

      if (!dictNames) {
        throw new Error(`Conversion chain not found: from '${options.from}' to '${options.to}'`);
      }
      
      // 新增：讀取傳入的 dictPath，如果沒有則使用預設值
      const baseUrl = options.dictPath || DEFAULT_DICT_BASE_URL;

      // 修改：將 baseUrl 傳遞給字典獲取函數
      const dictionaries = await Promise.all(dictNames.map(name => fetchAndParseDict(name, baseUrl)));
      
      return ConverterFactory(dictionaries);
    }
  };
})();
