/*
cn2t.js: Open Chinese Convert (OpenCC) in JavaScript
https://github.com/nk2028/cn2t.js

Version: 1.1.0 (Patched)

This is a modified version by an AI assistant.
Key changes:
1.  Dictionaries are fetched asynchronously from GitHub.
2.  Caching is used to avoid re-downloading.
3.  (v1.0.5) The dictionary processing order in `localePreset` was corrected.
4.  (v1.1.0) The core `ConverterFactory` was rewritten to ensure each dictionary
    is applied sequentially as a separate step, not merged. This fixes
    the persistent issue where variant characters were not being converted.
*/

(function(exports) {
  'use strict';

  function Trie() {
    this.root = {};
  }

  Trie.prototype.add = function (word, value) {
    let node = this.root;
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      if (!node[char]) {
        node[char] = {};
      }
      node = node[char];
    }
    node.value = value;
  };

  Trie.prototype.build = function(dict) {
    for (let i = 0, len = dict.length; i < len; i++) {
      const item = dict[i];
      this.add(item[0], item[1]);
    }
  };

  Trie.prototype.convert = function(str, callback) {
    let result = '';
    let i = 0;
    while (i < str.length) {
      let node = this.root;
      let longestMatch = { value: null, length: 0 };
      
      for (let j = i; j < str.length; j++) {
        const char = str[j];
        if (node[char]) {
          node = node[char];
          if (node.value) {
            longestMatch.value = node.value;
            longestMatch.length = j - i + 1;
          }
        } else {
          break;
        }
      }

      if (longestMatch.value !== null) {
        const word = longestMatch.value;
        result += (typeof callback === 'function') ? callback(word) : word;
        i += longestMatch.length;
      } else {
        result += str[i];
        i++;
      }
    }
    return result;
  };

  // GitHub Raw 檔案的基礎 URL
  const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/';

  // 字典快取
  const dictionaryCache = new Map();

  /**
   * 從 GitHub 獲取並解析字典檔
   * @param {string} dictName 字典名稱
   * @returns {Promise<string[][]>} 解析後的字典資料
   */
  async function fetchAndParseDict(dictName) {
    if (dictionaryCache.has(dictName)) {
      return await dictionaryCache.get(dictName);
    }

    const url = `${GITHUB_RAW_URL}${dictName}.txt`;
    const promise = fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`無法獲取字典: ${dictName} (HTTP ${response.status})`);
        }
        return response.text();
      })
      .then(text => {
        return text
          .split('\n')
          .filter(line => line && !line.startsWith('#'))
          .map(line => {
            const parts = line.split('\t');
            if (parts.length < 2) return null;
            const key = parts[0];
            const value = parts[1].split(' ')[0];
            return [key, value];
          })
          .filter(Boolean);
      });
    
    dictionaryCache.set(dictName, promise);
    return promise;
  }

  // 定義各種轉換所需的字典檔名 (順序至關重要)
  const localePreset = {
    // 順序規則：先處理詞彙 (Phrases)，再處理單字 (Characters)
    from: {
      's': ['STPhrases', 'STCharacters'],
      't': ['TSPhrases', 'TSCharacters'],
      'tw': ['TWVariantsRev', 'TSPhrases', 'TSCharacters'],
      'hk': ['HKVariantsRev', 'TSPhrases', 'TSCharacters'],
    },
    // 順序規則：先處理地區用詞 (Phrases)，再處理異體字 (Variants)
    to: {
      't': [],
      's': [],
      'tw': ['TWPhrases', 'TWVariants'],
      'hk': ['HKPhrases', 'HKVariants'],
    }
  };
  
  // --- 核心修正開始: 重寫轉換器工廠 ---
  
  /**
   * [核心] 建立轉換器工廠。
   * 此函數現在確保每個字典都作為一個獨立的步驟被應用。
   * @param {Array<Array<[string, string]>>} dictionaries - 一個包含多個字典數據的陣列
   * @returns {(text: string) => string} - 一個轉換函數
   */
  function ConverterFactory(dictionaries) {
    // 為每個字典數據創建一個獨立的 Trie
    const tries = dictionaries.map(dict => {
      const trie = new Trie();
      trie.build(dict);
      return trie;
    });

    // 返回的函數會依次執行每個 Trie 的轉換
    return function(text) {
      return tries.reduce((currentText, trie) => trie.convert(currentText), text);
    };
  }
  
  /**
   * [異步] 建立一個 OpenCC 轉換器
   * @param {object} options 轉換選項, 例如 { from: 's', to: 'tw' }
   * @returns {Promise<(s: string) => string>} 一個 Promise，它會解析為一個轉換函數
   */
  async function createConverter(options) {
    if (!options || typeof options.from !== 'string' || typeof options.to !== 'string') {
      throw new Error('請提供 `from` 和 `to` 選項，例如 { from: "s", to: "t" }');
    }
    const { from, to } = options;
    
    // 1. 根據 from/to 確定完整的字典轉換鏈 (一個扁平的陣列)
    let dictChainNames = [];
    if(from === 't' && (to === 'tw' || to === 'hk')) {
      dictChainNames = localePreset.to[to];
    } else if ((from === 'tw' || from ==='hk') && to === 't') {
      dictChainNames = localePreset.from[from].filter(name => name.includes('Rev'));
    } else {
      const fromDicts = localePreset.from[from] || [];
      const toDicts = localePreset.to[to] || [];
      dictChainNames = [...fromDicts, ...toDicts];
    }

    const uniqueDictNames = [...new Set(dictChainNames)].filter(Boolean);
    
    // 2. 平行下載所有需要的字典
    await Promise.all(uniqueDictNames.map(name => fetchAndParseDict(name)));
    
    // 3. 按照轉換鏈的順序，從快取中獲取已下載的字典數據
    const orderedDictData = await Promise.all(
        dictChainNames.map(name => dictionaryCache.get(name))
    );
    
    // 4. 使用新的 ConverterFactory 建立轉換器
    return ConverterFactory(orderedDictData.filter(Boolean));
  }
  
  // --- 核心修正結束 ---

  function CustomConverter(dict) {
    const trie = new Trie();
    trie.build(dict);
    // 為了與新工廠兼容，將其包裝在工廠中
    return ConverterFactory([dict]);
  }

  function HTMLConverter(converter, tagsToExclude) {
    tagsToExclude = (tagsToExclude || 'style,script,textarea,pre,code').split(',');
    const re = new RegExp('<(' + tagsToExclude.join('|') + ')[^>]*>[\\s\\S]*?<\\/\\1>|<[^>]+>', 'ig');
    
    return function(html) {
      const textArr = html.split(re);
      const tags = html.match(re) || [];
      
      let result = '';
      for (let i = 0; i < textArr.length; i++) {
        result += converter(textArr[i]);
        if (i < tags.length) {
          result += tags[i];
        }
      }
      return result;
    };
  }
  
  // 匯出接口
  exports.createConverter = createConverter;
  exports.CustomConverter = CustomConverter;
  exports.HTMLConverter = HTMLConverter;
  exports.Trie = Trie;

}(typeof exports === 'object' && typeof module !== 'undefined' ?
  (module.exports = exports = {}) :
  (this.OpenCC = {})));
