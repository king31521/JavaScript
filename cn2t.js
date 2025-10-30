/**
 * OpenCC-JS (self-contained) — 強化 TWVariants 載入與內嵌本地 TWVariants.txt
 *
 * 內嵌的 TWVariants 來自使用者上傳的 TWVariants.txt（已包含大量映射）。
 *
 * 使用：
 *   const conv = await OpenCC.createConverter({ from: 's', to: 'tw' });
 *   console.log(conv.info());
 *   console.log(conv('這裏 裡面 裏面 ...'));
 */
var OpenCC = (function() {
  'use strict';

  // CDN sources for dictionaries (fallback)
  const DICT_SOURCES = [
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
  ];

  // Cache of parsed dictionaries
  const dictionaryCache = new Map();

  // -------------------------
  // Local / embedded dictionaries (fallback when remote not available)
  // This includes the TWVariants.txt content you uploaded
  // -------------------------
  const LOCAL_DICTIONARIES_TEXT = {
    // TWVariants content (from your uploaded TWVariants.txt)
    'TWVariants': `僞\t偽
啓\t啟
喫\t吃
嫺\t嫻
嬀\t媯
峯\t峰
幺\t么
擡\t抬
棱\t稜
檐\t簷
污\t汙
泄\t洩
潙\t溈
潨\t潀
爲\t為
牀\t床
痹\t痺
癡\t痴
皁\t皂
着\t著
睾\t睪
祕\t秘
竈\t灶
糉\t粽
繮\t韁
纔\t才
羣\t群
脣\t唇
蔘\t參
蔿\t蒍
衆\t眾
裏\t裡
覈\t核
踊\t踴
鉢\t缽
鍼\t針
鮎\t鯰
麪\t麵
齶\t顎
`
    // 如果你還有其他本地字典，也可以在這加入，例如 'TWVariantsRev': '...' 
  };

  // -------------------------
  // Trie implementation for longest-match replacement
  // -------------------------
  function Trie() {
    this.root = {};
  }

  Trie.prototype.insert = function(word, value) {
    let node = this.root;
    for (const ch of word) {
      if (!node[ch]) node[ch] = {};
      node = node[ch];
    }
    node.value = value;
    node.wordEnd = true;
  };

  Trie.prototype.convert = function(text) {
    let res = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
      let node = this.root;
      let j = i;
      let lastMatch = null;
      while (j < n && node[text[j]]) {
        node = node[text[j]];
        if (node.wordEnd) lastMatch = { end: j, value: node.value };
        j++;
      }
      if (lastMatch) {
        res += lastMatch.value;
        i = lastMatch.end + 1;
      } else {
        res += text[i];
        i++;
      }
    }
    return res;
  };

  // -------------------------
  // Fetching and parsing dictionaries
  // - If a local dictionary exists in LOCAL_DICTIONARIES_TEXT, use it directly
  // - Otherwise attempt to fetch from the DICT_SOURCES fallback list
  // -------------------------
  async function fetchWithFallback(dictName, baseSources) {
    // If we have a local embedded text for this dict, use it immediately
    if (LOCAL_DICTIONARIES_TEXT[dictName]) {
      console.log(`Using embedded local dictionary for ${dictName}`);
      return LOCAL_DICTIONARIES_TEXT[dictName];
    }

    let lastError = null;
    for (const baseUrl of baseSources) {
      const url = `${baseUrl}${dictName}.txt`;
      try {
        console.log(`Fetching dictionary ${dictName} from ${url}`);
        const resp = await fetch(url, { method: 'GET', mode: 'cors', headers: { 'Accept': 'text/plain, */*' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const txt = await resp.text();
        console.log(`Fetched ${dictName} from ${baseUrl}`);
        return txt;
      } catch (err) {
        console.warn(`Fetch failed for ${url}:`, err && err.message ? err.message : err);
        lastError = err;
      }
    }
    // If all failed and no local text, throw
    throw new Error(`All sources failed for ${dictName}. Last: ${lastError && lastError.message ? lastError.message : lastError}`);
  }

  async function fetchAndParseDict(dictName, customBaseUrl = null) {
    const sources = customBaseUrl ? [customBaseUrl] : DICT_SOURCES;
    const cacheKey = `${sources.join(',')}:${dictName}`;

    if (dictionaryCache.has(cacheKey)) {
      return await dictionaryCache.get(cacheKey);
    }

    const p = (async () => {
      try {
        const raw = await fetchWithFallback(dictName, sources);
        const text = raw.replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/);
        const out = [];

        for (let line of lines) {
          if (!line) continue;
          line = line.trim();
          if (!line || line.startsWith('#')) continue;

          let key = null;
          let values = null;
          const tabIndex = line.indexOf('\t');
          if (tabIndex >= 0) {
            key = line.substring(0, tabIndex).trim();
            values = line.substring(tabIndex + 1).trim();
          } else {
            const m = line.match(/\s+/);
            if (m) {
              const idx = m.index;
              const len = m[0].length;
              key = line.substring(0, idx).trim();
              values = line.substring(idx + len).trim();
            } else {
              continue;
            }
          }

          if (!key || !values) continue;
          const tokens = values.split(/\s+/).filter(Boolean);
          if (tokens.length === 0) continue;
          const value = tokens[0];

          // Insert mapping (allow key===value entries to be handled if present)
          out.push([key, value]);
        }

        console.log(`Parsed ${out.length} entries from ${dictName}`);
        if (out.length > 0) console.log(`${dictName} sample entries:`, out.slice(0, 10));
        return out;
      } catch (err) {
        dictionaryCache.delete(cacheKey);
        throw err;
      }
    })();

    dictionaryCache.set(cacheKey, p);
    return p;
  }

  // -------------------------
  // Create converter from array of dictData with trie application
  // -------------------------
  function ConverterFactory(dictionaries, dictNames, chainName) {
    const tries = dictionaries.map((dictData, index) => {
      const trie = new Trie();
      let insertCount = 0;
      // Insert all mappings; respect longer keys automatically via trie matching
      for (const [key, value] of dictData) {
        if (key && value) {
          // Insert even if key===value because some dictionaries may include these intentionally
          trie.insert(key, value);
          insertCount++;
        }
      }
      console.log(`Dictionary ${index} (${dictNames[index]}) in ${chainName}: inserted ${insertCount} conversions`);
      return { trie, insertCount };
    });

    function convert(text) {
      let result = text;
      for (let i = 0; i < tries.length; i++) {
        const prev = result;
        result = tries[i].trie.convert(result);
        if (result !== prev) {
          console.log(`Chain ${chainName} step ${i + 1} (${dictNames[i]}) applied`);
        }
      }
      return result;
    }

    function info() {
      return dictNames.map((name, idx) => {
        const data = dictionaries[idx] || [];
        return { name, entries: data.length, inserted: tries[idx] ? tries[idx].insertCount : 0, sample: (data.slice ? data.slice(0, 10) : []) };
      });
    }

    return { convert, info, _raw: { names: dictNames, data: dictionaries } };
  }

  // -------------------------
  // Conversion chains (s2tw puts TWVariants between characters and phrases)
  // -------------------------
  const conversionChains = {
    's2t': ['STCharacters', 'STPhrases'],
    't2s': ['TSCharacters', 'TSPhrases'],
    's2tw': ['STCharacters', 'TWVariants', 'STPhrases'],
    'tw2s': ['TWVariantsRev', 'TSCharacters', 'TSPhrases'],
    's2twp': ['STCharacters', 'TWVariants', 'STPhrases', 'TWPhrasesIT', 'TWPhrasesName'],
    'tw2sp': ['TWVariantsRev', 'TWPhrasesITRev', 'TWPhrasesNameRev', 'TSCharacters', 'TSPhrases'],
    's2hk': ['STCharacters', 'STPhrases', 'HKVariants'],
    'hk2s': ['HKVariantsRev', 'TSCharacters', 'TSPhrases'],
  };

  // -------------------------
  // Public API
  // -------------------------
  return {
    async createConverter(options) {
      try {
        let chainKey, baseUrl;
        if (typeof options === 'string') {
          chainKey = options;
          baseUrl = null;
        } else {
          chainKey = `${options.from}2${options.to}`;
          baseUrl = options.dictPath || null;
        }

        const dictNames = conversionChains[chainKey];
        if (!dictNames) throw new Error(`Conversion chain not found: ${chainKey}`);

        console.log(`Creating converter ${chainKey} with dicts:`, dictNames);

        // Load dictionaries in order
        const loaders = dictNames.map(name => fetchAndParseDict(name, baseUrl));
        const dictionaries = await Promise.all(loaders);

        console.log(`Loaded ${dictionaries.length} dictionaries for ${chainKey}`);

        // Extra check: if TWVariants present, report its entries
        const twIndex = dictNames.indexOf('TWVariants');
        if (twIndex >= 0) {
          const twData = dictionaries[twIndex] || [];
          console.log(`TWVariants entries count: ${twData.length}`);
          if (twData.length === 0) {
            console.warn('TWVariants seems empty. Using embedded TWVariants if available or check dictPath/CORS');
          }
        }

        const factory = ConverterFactory(dictionaries, dictNames, chainKey);
        // return converter function extended with info and raw access
        return Object.assign(factory.convert, {
          info: () => factory.info(),
          _rawDicts: () => ({ names: dictNames, data: dictionaries })
        });
      } catch (err) {
        console.error('createConverter failed:', err && err.message ? err.message : err);
        throw err;
      }
    },

    clearCache() {
      dictionaryCache.clear();
      console.log('Dictionary cache cleared');
    },

    getSupportedConversions() {
      return Object.keys(conversionChains);
    },

    // convenience test method
    async testConversion(text, chainKey = 's2tw') {
      try {
        console.log(`Testing conversion ${chainKey} for text: "${text}"`);
        const conv = await this.createConverter(chainKey);
        const res = conv(text);
        console.log('Conversion result:', res);
        if (typeof conv.info === 'function') console.log('Dictionaries info:', conv.info());
        return res;
      } catch (err) {
        console.error('Test conversion failed:', err && err.message ? err.message : err);
        throw err;
      }
    }
  };
})();

// ------------------ immediate quick check ------------------
(async () => {
  try {
    const conv = await OpenCC.createConverter({ from: 's', to: 'tw' });
    console.log('Loaded dictionaries info:', conv.info());

    // Test string including the example and variations
    const testInputs = [
      '這裏', // 希望 -> 這裡
      '裡面', // 裡 -> 裡 (應為台灣裡)
      '裏面', // 裏 -> 裡
      '牀上', // 牀 -> 床
      '着裝', // 着 -> 著
      '污漬'  // 污 -> 汙
    ];

    for (const t of testInputs) {
      console.log(`"${t}" -> "${conv(t)}"`);
    }
  } catch (err) {
    console.error('Immediate check failed:', err);
  }
})();
