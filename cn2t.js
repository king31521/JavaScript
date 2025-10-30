/**
 * OpenCC-JS (self-contained) — 強化 TWVariants 載入檢查與 s2tw 測試
 *
 * Usage:
 * - OpenCC.createConverter({ from: 's', to: 'tw' }) -> returns converter function with .info() and ._rawDicts()
 * - OpenCC.testConversion(text, 's2tw') -> convenience test
 *
 * Paste entire file to browser Console to run immediate test for "這裏" -> "這裡".
 */
var OpenCC = (function() {
  'use strict';

  const DICT_SOURCES = [
    'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://fastly.jsdelivr.net/gh/BYVoid/OpenCC@ver.1.1.7/data/dictionary/',
    'https://unpkg.com/opencc-data@1.0.5/data/dictionary/',
  ];

  const dictionaryCache = new Map();

  function Trie() { this.root = {}; }

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

  async function fetchWithFallback(dictName, baseSources) {
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
          out.push([key, value]);
        }

        console.log(`Parsed ${out.length} entries from ${dictName}`);
        return out;
      } catch (err) {
        dictionaryCache.delete(cacheKey);
        throw err;
      }
    })();

    dictionaryCache.set(cacheKey, p);
    return p;
  }

  function ConverterFactory(dictionaries, dictNames, chainName) {
    const tries = dictionaries.map((d) => {
      const t = new Trie();
      let cnt = 0;
      for (const [k, v] of d) {
        if (k && v && k !== v) {
          t.insert(k, v);
          cnt++;
        }
      }
      return { trie: t, count: cnt };
    });

    function convert(text) {
      let r = text;
      for (let i = 0; i < tries.length; i++) {
        const prev = r;
        r = tries[i].trie.convert(r);
        if (r !== prev) {
          console.log(`Chain ${chainName} step ${i + 1} applied`);
        }
      }
      return r;
    }

    function info() {
      return dictNames.map((name, idx) => {
        const dictData = dictionaries[idx] || [];
        return { name: name, entries: dictData.length, inserted: tries[idx] ? tries[idx].count : 0, sample: (dictData.slice ? dictData.slice(0, 10) : []) };
      });
    }

    return { convert, info, _raw: { names: dictNames, data: dictionaries } };
  }

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

        const dictLoaders = dictNames.map(name => fetchAndParseDict(name, baseUrl));
        const dictionaries = await Promise.all(dictLoaders);

        console.log(`Loaded ${dictionaries.length} dictionaries for ${chainKey}`);

        const factory = ConverterFactory(dictionaries, dictNames, chainKey);

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

    async testConversion(text, chainKey = 's2tw') {
      try {
        console.log(`Testing conversion ${chainKey} for text: "${text}"`);
        const conv = await this.createConverter(chainKey);
        const res = conv(text);
        console.log('Conversion result:', res);
        if (typeof conv.info === 'function') {
          console.log('Dictionaries info:', conv.info());
        }
        return res;
      } catch (err) {
        console.error('Test conversion failed:', err && err.message ? err.message : err);
        throw err;
      }
    }
  };
})();

// ------------------ immediate test ------------------
(async () => {
  try {
    const conv = await OpenCC.createConverter({ from: 's', to: 'tw' });
    console.log('Loaded dictionaries info:', conv.info());

    const input = '這裏';
    const output = conv(input);

    console.log('Input :', input);
    console.log('Output:', output);

    if (output === '這裡') {
      console.log('Result: SUCCESS — "這裏" converted to "這裡"');
    } else {
      console.warn('Result: FAILED — conversion did not produce "這裡"');
      if (typeof conv._rawDicts === 'function') {
        const raw = conv._rawDicts();
        const dictNames = raw.names;
        const dictData = raw.data;
        const hits = [];
        for (let i = 0; i < dictNames.length; i++) {
          const name = dictNames[i];
          const data = dictData[i] || [];
          for (const [k, v] of data) {
            if (k === '這裏' || v === '這裏' || (k && k.includes && k.includes('這裏')) || (v && v.includes && v.includes('這裏'))) {
              hits.push({ dict: name, key: k, value: v });
            }
          }
        }
        if (hits.length > 0) {
          console.log('Found entries related to "這裏":', hits.slice(0, 50));
        } else {
          console.warn('No entries for "這裏" found in loaded dictionaries.');
          console.warn('If TWVariants seems empty, check network/CORS, dictPath, or supply a local TWVariants.txt.');
        }
      } else {
        console.warn('Raw dictionary access not available on converter.');
      }
    }
  } catch (err) {
    console.error('Immediate test failed:', err);
  }
})();
