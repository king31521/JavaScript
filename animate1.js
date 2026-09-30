var rule = {
    title: 'Anime1動漫[防盜鏈修復版]',
    host: 'https://anime1.me',
    url: 'https://anime1.me',
    searchUrl: 'https://anime1.me**',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    class_name: '近期更新#動畫列表',
    class_url: 'current#list',
    
    homeUrl: 'https://anime1.me',
    homeVod: 'js:
        var d = [];
        var html = request(input);
        var items = pdfa(html, "main#main article");
        items.forEach(function(item) {
            var title = pdfh(item, "h1.entry-title a&&Text");
            var url = pdfh(item, "h1.entry-title a&&href");
            var pic = "https://unsplash.com";
            var desc = pdfh(item, "footer.entry-footer&&Text");
            d.push({
                vod_id: url,
                vod_name: title,
                vod_pic: pic,
                vod_remarks: desc.trim()
            });
        });
        setResult(d);
    ',

    category: 'js:
        var d = [];
        var targetUrl = input;
        if (MY_CATE === "current") {
            targetUrl = "https://anime1.me";
        } else if (MY_CATE === "list") {
            targetUrl = "https://anime1.me";
        }
        var html = request(targetUrl);
        var items = pdfa(html, "main#main article");
        items.forEach(function(item) {
            var title = pdfh(item, "h1.entry-title a&&Text");
            var url = pdfh(item, "h1.entry-title a&&href");
            var pic = "https://unsplash.com";
            var desc = pdfh(item, "span.entry-date a&&Text");
            d.push({
                vod_id: url,
                vod_name: title,
                vod_pic: pic,
                vod_remarks: desc
            });
        });
        setResult(d);
    ',

    detail: 'js:
        var html = request(input);
        var title = pdfh(html, "h1.entry-title&&Text");
        var vod = {
            vod_id: input,
            vod_name: title,
            vod_type: "動漫",
            vod_pic: "https://unsplash.com",
            vod_content: title,
        };
        
        var playUrls = [];
        // 如果單頁面直接是播放頁，將網址作為傳遞參數送去 play 解析
        playUrls.push("同步正片$" + input);
        
        vod.vod_play_from = "Anime1官方線路";
        vod.vod_play_url = playUrls.join("#");
        setResult(vod);
    ',

    search: 'js:
        var d = [];
        var html = request(input);
        var items = pdfa(html, "main#main article");
        items.forEach(function(item) {
            var title = pdfh(item, "h1.entry-title a&&Text");
            var url = pdfh(item, "h1.entry-title a&&href");
            d.push({
                vod_id: url,
                vod_name: title,
                vod_pic: "https://unsplash.com",
                vod_remarks: ""
            });
        });
        setResult(d);
    ',

    // 🔥 核心突破防盜鏈邏輯
    play: 'js:
        try {
            var html = request(input);
            // 1. 抓取 Anime1 內部 API 驗證所需要的加密屬性 data-apiv2
            var videoTag = pdfh(html, "video&&data-apiv2");
            
            if (!videoTag) {
                // 如果找不到加密屬性，嘗試抓取普通標籤
                var directSrc = pdfh(html, "video&&src") || pdfh(html, "source&&src");
                if (directSrc) {
                    setResult({
                        parse: 0,
                        url: directSrc,
                        header: { "User-Agent": "Mozilla/5.0", "Referer": "https://anime1.me/" }
                    });
                } else {
                    setResult({ parse: 0, url: "" });
                }
            } else {
                // 2. 模擬網站內部的 Ajax POST 請求，帶上其防盜鏈參數向後台要 mp4 直鏈
                var apiUrl = "https://anime1.me"; 
                var postData = "d=" + encodeURIComponent(videoTag);
                
                var apiResponse = post(apiUrl, {
                    body: postData,
                    headers: {
                        "Origin": "https://anime1.me",
                        "Referer": input,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "X-Requested-With": "XMLHttpRequest"
                    }
                });

                // 3. 解析 API 回傳的 JSON 數據（格式通常為 [{"file":"https://anime1.me"}]）
                var resJson = JSON.parse(apiResponse);
                var realVideoUrl = resJson[0].file;

                // 如果協定不完整，自動幫它補上 https:
                if (realVideoUrl.indexOf("//") === 0) {
                    realVideoUrl = "https:" + realVideoUrl;
                }

                // 4. 將帶有防盜鏈 Header 的最終直鏈丟給 OK影視播放
                setResult({
                    parse: 0,
                    url: realVideoUrl,
                    header: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer": "https://anime1.me/",
                        "Origin": "https://anime1.me"
                    }
                });
            }
        } catch (e) {
            setResult({ parse: 0, url: "" });
        }
    '
};
