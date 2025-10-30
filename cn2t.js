/**
 * Modern, Promise-based, dependency-free OpenCC-JS (s2twp only).
 *
 * @version trimmed-for-s2twp
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

          const tabIndex = trimmedLine.indexOf('\t');
          if (tabIndex > 0) {
            const key = trimmedLine.substring(0, tabIndex);
            const valuesPart = trimmedLine.substring(tabIndex + 1);
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

  function ConverterFactory(dictionaries, chainName) {
    const tries = dictionaries.map((dictData, index) => {
      const trie = new Trie();
      let insertCount = 0;

      for (const [key, value] of dictData) {
        if (key && value && key !== value) {
          trie.insert(key, value);
          insertCount++;
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

  // Only the s2twp chain is kept
  const conversionChains = {
    's2twp': ['STCharacters', 'STPhrases', 'TWVariants', 'TWPhrasesIT', 'TWPhrasesName']
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

        // Verify TWVariants loaded if present
        const twIndex = dictNames.indexOf('TWVariants');
        if (twIndex >= 0 && dictionaries.length > twIndex) {
          const twVariantsDict = dictionaries[twIndex];
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

    clearCache() {
      dictionaryCache.clear();
      console.log('Dictionary cache cleared');
    },

    getSupportedConversions() {
      return Object.keys(conversionChains);
    },

    async testConversion(text, chainKey = 's2twp') {
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
