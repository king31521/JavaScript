/*
cn2t.js: Open Chinese Convert (OpenCC) in JavaScript
https://github.com/nk2028/cn2t.js

Version: 1.0.5 (Patched)

This is a modified version by an AI assistant.
Key changes:
1. Removed hard-coded large dictionaries.
2. Dictionaries are now fetched asynchronously from the OpenCC GitHub repository.
3. The main export is an async function `createConverter`.
4. Added caching to avoid re-downloading dictionaries.
5. (v1.0.4) Fixed a bug in dictionary parsing to correctly handle one-to-many mappings.
6. (v1.0.5) Corrected the dictionary processing order in `localePreset` to ensure
   proper conversion to regional standards (e.g., TW/HK variants).
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
    // Use a modified forward maximum matching algorithm.
    // The original implementation had a subtle bug in advancing the index.
    let i = 0;
    while (i < str.length) {
      let node = this.root;
      let longestMatch = { value: null, length: 0 };
      
      // Find the longest possible match starting from current position 'i'
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

  /* --- 以下是新增/修改的程式碼: 字典獲取邏輯 --- */

  // GitHub Raw 檔案的基礎 URL
  const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/';

  // 字典快取，避免重複下載
  const dictionaryCache = new Map();

  /**
   * 從 GitHub 獲取並解析字典檔
   * @param {string} dictName 字典名稱 (例如 'STCharacters')
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
          .filter(line => line && !line.startsWith('#')) // 過濾空行和註解
          .map(line => {
            const parts = line.split('\t');
            if (parts.length < 2) return null;

            const key = parts[0];
            const value = parts[1].split(' ')[0]; 

            return [key, value];
          })
          .filter(Boolean); // 過濾掉格式不正確的行
      });
    
    // 將 promise 存入快取，這樣即使同時請求多次也只會下載一次
    dictionaryCache.set(dictName, promise);
    return promise;
  }

  // --- 修正開始 ---
  // 定義各種轉換所需的字典檔名 (已修正順序)
  // 這是解決「異體字無法轉換」問題的關鍵
  const localePreset = {
    // 順序規則：先處理詞彙 (Phrases)，再處理單字 (Characters)
    from: {
      's': ['STPhrases', 'STCharacters'],
      't': ['TSPhrases', 'TSCharacters'],
      'tw': ['TWVariantsRev', 'TSPhrases', 'TSCharacters'], // 先處理台灣特有字(Rev)，再進行繁轉簡
      'hk': ['HKVariantsRev', 'TSPhrases', 'TSCharacters'], // 先處理香港特有字(Rev)，再進行繁轉簡
    },
    // 順序規則：先處理地區用詞 (Phrases)，再處理異體字 (Variants)
    to: {
      't': [], 
      's': [], 
      'tw': ['TWPhrases', 'TWVariants'],
      'hk': ['HKPhrases', 'HKVariants'],
    }
  };
  // --- 修正結束 ---

  /**
   * [非同步] 建立一個 OpenCC 轉換器 (從 GitHub 獲取字典)
   * @param {object} options 轉換選項, 例如 { from: 's', to: 'tw' }
   * @returns {Promise<(s: string) => string>} 一個 Promise，它會解析為一個轉換函數
   */
  async function createConverter(options) {
    if (!options || typeof options.from !== 'string' || typeof options.to !== 'string') {
      throw new Error('請提供 `from` 和 `to` 選項，例如 { from: "s", to: "t" }');
    }
    const from = options.from;
    const to = options.to;

    // 收集所有需要的字典檔名群組
    const dictNameGroups = [];

    // 處理 t2tw, t2hk 等轉換鏈
    if(from === 't' && (to === 'tw' || to === 'hk')) {
        // 繁體轉地區正體，直接使用 to 的字典
        dictNameGroups.push(localePreset.to[to]);
    } 
    // 處理 tw2t, hk2t 等轉換鏈
    else if ((from === 'tw' || from ==='hk') && to === 't') {
        // 地區正體轉繁體，使用 from 的反向字典
        dictNameGroups.push(localePreset.from[from].filter(name => name.includes('Rev')));
    }
    else {
        if (localePreset.from[from]) {
          dictNameGroups.push(localePreset.from[from]);
        }
        if (localePreset.to[to]) {
          dictNameGroups.push(localePreset.to[to]);
        }
    }
    
    // 修正了 createConverter 中的邏輯，使其更準確地處理轉換鏈
    const allDictNamesRaw = [].concat.apply([], dictNameGroups); 
    const allDictNames = allDictNamesRaw.filter(d => d); // 過濾掉空字串
    const uniqueDictNames = [...new Set(allDictNames)]; // 去除重複的字典

    // 平行下載所有字典
    const dictPromises = uniqueDictNames.map(name => fetchAndParseDict(name));
    const dictionaries = await Promise.all(dictPromises);

    // 將字典名稱與下載的內容對應起來
    const downloadedDicts = new Map();
    uniqueDictNames.forEach((name, index) => {
      downloadedDicts.set(name, dictionaries[index]);
    });

    // 根據順序重組字典群組
    const dictGroups = dictNameGroups.map(group => group.map(name => downloadedDicts.get(name)));

    // 使用舊的同步工廠函數建立轉換器
    return ConverterFactory.apply(null, dictGroups);
  }

  /* --- 新增程式碼結束 --- */


  /* --- 以下為原版的核心轉換邏輯，保持不變 --- */

  function ConverterFactory() {
    const tries = Array.from(arguments).map(dict => {
      const trie = new Trie();
      trie.build([].concat.apply([], dict));
      return trie;
    });

    return function(text) {
      return tries.reduce((text, trie) => trie.convert(text), text);
    };
  }

  function CustomConverter(dict) {
    const trie = new Trie();
    trie.build(dict);
    return text => trie.convert(text);
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
  exports.createConverter = createConverter; // 主要的異步創建函數
  exports.CustomConverter = CustomConverter; // 保持自訂義轉換器
  exports.HTMLConverter = HTMLConverter;     // 保持 HTML 轉換器
  exports.Trie = Trie;                         // 選擇性匯出 Trie 類，方便擴展

}(typeof exports === 'object' && typeof module !== 'undefined' ?
  (module.exports = exports = {}) :
  (this.OpenCC = {})));
