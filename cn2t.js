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
          // --- 以下是修正的部分 ---
          .map(line => {
            const parts = line.split('\t');
            // 確保行格式正確，至少有一個 key 和一個 value
            if (parts.length < 2) return null;

            const key = parts[0];
            // OpenCC 規則：值可以是用空格分隔的多個候選詞，預設取第一個
            const value = parts[1].split(' ')[0]; 
            
            return [key, value];
          })
          .filter(Boolean); // 過濾掉上面產生的 null (格式不正確的行)
          // --- 修正結束 ---
      });
    
    // 將 promise 存入快取，這樣即使同時請求多次也只會下載一次
    dictionaryCache.set(dictName, promise);
    return promise;
  }
