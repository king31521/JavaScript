/**
 * Modern, Promise-based, dependency-free OpenCC-JS.
 *
 * This version is modified to be configurable, allowing the dictionary path to be
 * specified during converter creation. This is ideal for use in environments like
 * Tampermonkey where using a CDN is preferable.
 * 
 * This version is patched to fix 404 errors by pinning to a stable version and
 * updating the dictionary chains.
 *
 * @version 1.2.1 (Patched)
 * @license Apache-2.0
 */
var OpenCC = (function() {
  'use strict';

  // 修正 1：將字典來源從不穩定的 master 分支鎖定到穩定的 v1.1.7 版本。
  const DEFAULT_DICT_BASE_URL = 'https://www.jsdelivr.com/package/npm/opencc?tab=files&path=data%2Fdictionary/';
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

  async function fetchAndParseDict(dictName, baseUrl) {
    const cacheKey = `${baseUrl}:${dictName}`;
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

  // 修正 2：更新字典列表以對應新的檔案結構，解決 TWPhrases.txt 404 問題。
  const conversionChains = {
    's2t': ['STPhrases', 'STCharacters'],
    't2s': ['TSPhrases', 'TSCharacters'],
    's2tw': ['STPhrases', 'STCharacters', 'TWVariants'],
    'tw2s': ['TWVariantsRev', 'TSPhrases', 'TSCharacters'],
    's2twp': ['STPhrases', 'STCharacters', 'TWPhrasesIT', 'TWPhrasesName', 'TWVariants'],
    'tw2sp': ['TWVariantsRev', 'TWPhrasesITRev', 'TWPhrasesNameRev', 'TSPhrases', 'TSCharacters'],
    's2hk': ['STPhrases', 'STCharacters', 'HKVariants'],
    'hk2s': ['HKVariantsRev', 'TSPhrases', 'TSCharacters'],
  };
  
  return {
    async createConverter(options) {
      // 支援 { from: 's', to: 'twp' } 或直接傳入 's2twp'
      const chainKey = typeof options === 'string' ? options : `${options.from}2${options.to}`;
      const dictNames = conversionChains[chainKey];

      if (!dictNames) {
        throw new Error(`Conversion chain not found: ${chainKey}`);
      }
      
      const baseUrl = (options && options.dictPath) ? options.dictPath : DEFAULT_DICT_BASE_URL;

      const dictionaries = await Promise.all(dictNames.map(name => fetchAndParseDict(name, baseUrl)));
      
      return ConverterFactory(dictionaries);
    }
  };
})();
