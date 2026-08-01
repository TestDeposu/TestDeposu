import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Global Timeout Koruması: Hiçbir istek (API, Resim, Veri) 90 saniyeden fazla askıda kalamaz!
const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
    if (!options.signal) {
        options.signal = AbortSignal.timeout(90000);
    }
    return await originalFetch(url, options);
};

// Load APIs from environment variables (Provided by GitHub Secrets)
const AUTHORS_FILE = path.join(process.cwd(), 'book_authors2026.json');
const HISTORY_FILE = path.join(process.cwd(), 'book_history2026.json');
const SCRAPED_BOOKS_FILE = path.join(process.cwd(), 'scraped_books2026.json');

// Date formatting for the daily output folder
const today = new Date();
const dateStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
const OUTPUT_DIR = path.join(process.cwd(), `generated2026-${dateStr}`);

// Create the output directory for today's generations
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Utility for sleeping (rate-limit prevention)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// AI Engine Integration
const SLEEP_AFTER_BOOK = 5000;

// Bireysel Mola Sistemi (Circuit Breaker) Durumları
const apiCooldowns = { 'OpenRouter': 0, 'Nvidia': 0, 'Gemini': 0, 'Mistral': 0, 'Groq': 0, 'SambaNova': 0 };
const apiFailCounts = { 'OpenRouter': 0, 'Nvidia': 0, 'Gemini': 0, 'Mistral': 0, 'Groq': 0, 'SambaNova': 0 };

// Akıllı Kronometre (Smart Throttling) Sistemi
const apiMinimumDelays = { 'Nvidia': 3000, 'Gemini': 4500, 'OpenRouter': 25000, 'Mistral': 25000, 'SambaNova': 15000, 'Groq': 40000 };
const apiLastUsed = { 'OpenRouter': 0, 'Nvidia': 0, 'Gemini': 0, 'Mistral': 0, 'Groq': 0, 'SambaNova': 0 };

async function fetchFromOpenRouter(prompt) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
    
    // 2026 Temmuz: Yeni Nesil 4 Elit Bedava Model
    const freeModels = [
        "google/gemma-4-31b-it:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "openai/gpt-oss-20b:free",
        "inclusionai/ling-3.0-flash:free"
    ];
    
    let lastError = null;
    
    for (const model of freeModels) {
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${apiKey}`, 
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/TestDeposu",
                    "X-Title": "BookWriter"
                },
                body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], max_tokens: 1500 })
            });
            
            let data;
            try { data = await response.json(); } catch (e) { throw new Error(`HTTP ${response.status}`); }
            
            if (!response.ok) {
                // If it's a rate limit on the account level, stop trying other models
                if (data.error?.message?.toLowerCase().includes("rate limit") || response.status === 429) {
                     throw new Error(data.error?.message || "Rate limit exceeded on OpenRouter");
                }
                throw new Error(data.error?.message || `Error ${response.status}`);
            }
            
            return data.choices[0].message.content; // Return the first successful elite model
            
        } catch (e) {
            lastError = e;
            console.warn(`[WARN] OpenRouter Model (${model}) failed. Trying the next elite model...`);
            
            // Break if the entire account is rate limited
            if (e.message.toLowerCase().includes("rate limit") || e.message.includes("429")) {
                break;
            }
        }
    }
    
    throw new Error(`All 10 elite OpenRouter models failed. Last Error: ${lastError.message}`);
}

async function fetchFromNvidia(prompt) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error("NVIDIA_API_KEY is missing");
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'meta/llama-3.1-70b-instruct', messages: [{ role: 'user', content: prompt }], max_tokens: 1500, temperature: 0.7 })
    });
    let data;
    try { data = await response.json(); } catch (e) { throw new Error(`Nvidia HTTP ${response.status} (Non-JSON)`); }
    if (!response.ok) throw new Error(data.error?.message || `Nvidia Error ${response.status}`);
    return data.choices[0].message.content;
}

async function fetchFromGroq(prompt) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is missing");
    
    // 500K Limitli modellerden oluşan şelale
    const activeModels = [
        "llama-3.1-8b-instant",
        "mixtral-8x7b-32768"
    ];
    
    let lastError = null;
    
    for (const model of activeModels) {
        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], max_tokens: 1500 })
            });
            
            let data;
            try { data = await response.json(); } catch (e) { throw new Error(`HTTP ${response.status}`); }
            
            if (!response.ok) {
                // Hata alırsak diğer modele geç, limit dolduysa kalkanı aç (break)
                if (data.error?.message?.toLowerCase().includes("rate limit") || response.status === 429) {
                     throw new Error(data.error?.message || "Rate limit exceeded on Groq");
                }
                throw new Error(data.error?.message || `Error ${response.status}`);
            }
            
            return data.choices[0].message.content;
            
        } catch (e) {
            lastError = e;
            console.warn(`[WARN] Groq Model (${model}) failed. Trying the next model...`);
            
            if (e.message.toLowerCase().includes("rate limit") || e.message.includes("429")) {
                break;
            }
        }
    }
    
    throw new Error(`All Groq models failed. Last Error: ${lastError.message}`);
}

async function fetchFromMistral(prompt) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY is missing");
    
    // --- NEW: Mistral Multi-Model Fallback ---
    const activeModels = [
        "open-mistral-nemo",      // Stage 1: Cost/Performance champion
        "mistral-small-latest",   // Stage 2: Standard and stable backup
        "open-mixtral-8x7b"       // Stage 3: Last resort if servers fail
    ];
    
    let lastError = null;
    
    for (const model of activeModels) {
        try {
            const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], max_tokens: 1500 })
            });
            
            let data;
            try { data = await response.json(); } catch (e) { throw new Error(`HTTP ${response.status}`); }
            
            if (!response.ok) {
                // If it's a rate limit on the account level, stop trying other models
                if (data.error?.message?.toLowerCase().includes("rate limit") || response.status === 429) {
                     throw new Error(data.error?.message || "Rate limit exceeded on Mistral");
                }
                throw new Error(data.error?.message || `Error ${response.status}`);
            }
            
            return data.choices[0].message.content; // Return the first successful model
            
        } catch (e) {
            lastError = e;
            console.warn(`[WARN] Mistral Model (${model}) failed. Trying the next model...`);
            
            // Break if the entire account is rate limited
            if (e.message.toLowerCase().includes("rate limit") || e.message.includes("429")) {
                break;
            }
        }
    }
    
    throw new Error(`All Mistral models failed. Last Error: ${lastError.message}`);
}

async function fetchFromSambaNova(prompt) {
    const apiKey = process.env.SAMBANOVA_API_KEY;
    if (!apiKey) throw new Error("SAMBANOVA_API_KEY is missing");
    
    // SambaNova Supported Fallback Models (July 2026)
    const activeModels = [
        "Meta-Llama-3.3-70B-Instruct", 
        "Llama-4-Maverick-17B-128E-Instruct",
        "DeepSeek-V3-0324",
        "Qwen3-32B"
    ];
    
    let lastError = null;
    
    for (const model of activeModels) {
        try {
            const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], max_tokens: 1500, temperature: 0.7 })
            });
            
            let data;
            try { data = await response.json(); } catch (e) { throw new Error(`HTTP ${response.status}`); }
            
            if (!response.ok) {
                // If it's a rate limit on the account level, stop trying other models
                if (data.error?.message?.toLowerCase().includes("rate limit") || response.status === 429) {
                     throw new Error(data.error?.message || "Rate limit exceeded on SambaNova");
                }
                throw new Error(data.error?.message || `Error ${response.status}`);
            }
            
            return data.choices[0].message.content; // Return the first successful model
            
        } catch (e) {
            lastError = e;
            console.warn(`[WARN] SambaNova Model (${model}) failed. Trying the next model...`);
            
            // Break if the entire account is rate limited
            if (e.message.toLowerCase().includes("rate limit") || e.message.includes("429")) {
                break;
            }
        }
    }
    
    throw new Error(`All SambaNova models failed. Last Error: ${lastError.message}`);
}

async function fetchFromGemini(prompt) {
    const yeniApiKey = (process.env.GEMINI_API_KEY || "").trim();
    const eskiApiKey = (process.env.GEMINIESKI_API_KEY || "").trim();
    
    if (!yeniApiKey && !eskiApiKey) throw new Error("İki GEMINI API şifresi de eksik!");
    
    // Şifreleri sırayla denemek için diziye alıyoruz
    const keysToTry = [];
    if (yeniApiKey) keysToTry.push(yeniApiKey);
    if (eskiApiKey && eskiApiKey !== yeniApiKey) keysToTry.push(eskiApiKey);
    
    // Yalnızca kullanıcının belirlediği yüksek kotalı yeni nesil modeller
    const flashModels = [
        "gemini-3.5-flash-lite", // 1. Tercih (500 limit)
        "gemini-3.1-flash-lite", // 2. Tercih (500 limit)
        "gemini-3.6-flash",      // 3. Tercih (En yeni nesil)
        "gemini-2.5-flash-lite"  // Son çare yedek kalkan
    ];
    
    let lastError = null;
    
    // Önce şifreleri, sonra modelleri döner
    for (const apiKey of keysToTry) {
        for (const model of flashModels) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { maxOutputTokens: 1500 }
                    })
                });
                
                let data;
                try { data = await response.json(); } catch (e) { throw new Error(`HTTP ${response.status}`); }
                
                if (!response.ok) {
                    if (data.error?.message?.toLowerCase().includes("quota") || response.status === 429) {
                         throw new Error(data.error?.message || "Rate limit or daily quota exceeded on Gemini");
                    }
                    throw new Error(data.error?.message || `Error ${response.status}`);
                }
                
                return data.candidates[0].content.parts[0].text;
                
            } catch (e) {
                lastError = e;
                console.warn(`[WARN] Gemini Model (${model}) failed with a key. Trying the next option...`);
                
                // Günlük kota (RPD) dolduysa veya limit aşıldıysa döngüyü kırma, bir sonraki modele geç!
                // Sadece hesap/şifre banlanmışsa bu şifreyle diğer modelleri denemeyi bırak
                if (e.message.includes("API key not valid")) {
                    break;
                }
            }
        }
    }
    
    throw new Error(`All Gemini keys and models failed. Last Error: ${lastError.message}`);
}

async function generateArticleBody(prompt, apiIndex = 0) {
    const apis = [
        { name: 'Nvidia', fn: fetchFromNvidia },
        { name: 'Gemini', fn: fetchFromGemini },
        { name: 'Mistral', fn: fetchFromMistral },
        { name: 'Groq', fn: fetchFromGroq },
        { name: 'SambaNova', fn: fetchFromSambaNova },
        { name: 'OpenRouter', fn: fetchFromOpenRouter }
    ];
    
    let currentIdx = apiIndex % apis.length;
    let attemptedCount = 0;
    
    while (attemptedCount < apis.length) {
        const api = apis[currentIdx];
        
        // Eğer mola süresi henüz bitmediyse bu API'yi atla
        if (Date.now() < apiCooldowns[api.name]) {
            console.error(`[!] ${api.name} is on 15-min cooldown. Skipping to next...`);
            currentIdx = (currentIdx + 1) % apis.length;
            attemptedCount++;
            continue;
        }

        // Akıllı Kronometre: Hız sınırı (Rate Limit) süresi dolmamışsa API'yi atla
        if (Date.now() - apiLastUsed[api.name] < apiMinimumDelays[api.name]) {
            console.error(`[!] ${api.name} rate limit delay not met (Smart Throttling). Skipping to next...`);
            currentIdx = (currentIdx + 1) % apis.length;
            attemptedCount++;
            continue;
        }

        console.error(`[AI] Attempting ${api.name}...`);
        try {
            apiLastUsed[api.name] = Date.now(); // API'nin kullanıldığı anı kaydet
            const result = await api.fn(prompt);
            apiFailCounts[api.name] = 0; // Başarılı olunca hata sayacını sıfırla
            return result;
        } catch (e) {
            console.warn(`[WARN] ${api.name} failed: ${e.message}`);
            
            // Eğer rate limit ise hatayı say, 3 olunca 15 dakika yedeğe çek
            if (e.message && (e.message.includes("429") || e.message.toLowerCase().includes("rate limit"))) {
                apiFailCounts[api.name]++;
                if (apiFailCounts[api.name] >= 3) {
                    console.error(`[!] ${api.name} gave 3 consecutive Rate Limit errors. Putting on 15-min cooldown.`);
                    apiCooldowns[api.name] = Date.now() + 15 * 60 * 1000; // 15 dakika cooldown
                    apiFailCounts[api.name] = 0; // Molaya çıkınca sayacı sıfırlayalım
                }
            }
            
            currentIdx = (currentIdx + 1) % apis.length; // Next API
            attemptedCount++;
        }
    }
    throw new Error("Aktif durumdaki tüm yapay zeka (AI) API'leri hata verdi veya hepsi 15 dakikalık dinlenmede.");
}

function sanitizeMarkdown(text) {
    let clean = text.trim();
    if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-z]*\n/i, '');
        clean = clean.replace(/\n```$/i, '');
    }
    return clean;
}

// Yeni WEBP ve 150KB Sıkıştırma Motoru
async function downloadImage(imageUrl, slug) {
    if (!imageUrl || !imageUrl.startsWith('http')) return null;
    
    // Güvenlik: Apple bazen http atabilir, kesinlikle https'e çevir
    imageUrl = imageUrl.replace(/^http:/, 'https:');
    
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        
        const filename = `${slug}.webp`;
        const outPath = path.join(OUTPUT_DIR, filename);
        
        // Resmi oku, WebP formatına (kalite 80 - 150kb altı hedeflenerek) çevir ve kaydet
        await sharp(Buffer.from(buffer))
            .webp({ quality: 80, effort: 6 })
            .toFile(outPath);
            
        return filename; 
    } catch (e) {
        console.error(`[WARN] Kapak WebP çevrimi hatası: ${e.message}`);
        return null;
    }
}

function getNextAuthor(history) {
    const authors = JSON.parse(fs.readFileSync(AUTHORS_FILE, 'utf8'));
    authors.sort((a, b) => (history.authors[a.id] || 0) - (history.authors[b.id] || 0));
    return authors[0];
}

// ================= PERFORMANCE CACHE =================
let cachedScrapedBooks = null;
let cachedHistoryBooksSet = null;
let cachedGeneratedSlugs = null;

function initCache() {
    if (cachedScrapedBooks) return; // Zaten yüklendiyse atla
    
    console.error("[INFO] Dosyalar okunup önbelleğe alınıyor (Performans Optimizasyonu)...");
    
    // 1. Scraped Books Yükle
    if (fs.existsSync(SCRAPED_BOOKS_FILE)) {
        cachedScrapedBooks = JSON.parse(fs.readFileSync(SCRAPED_BOOKS_FILE, 'utf8'));
    } else {
        cachedScrapedBooks = [];
    }
    
    // 2. History Yükle ve Set'e çevir (O(1) arama hızı için)
    if (fs.existsSync(HISTORY_FILE)) {
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        cachedHistoryBooksSet = new Set(history.books.map(b => b.toLowerCase().trim()));
    } else {
        cachedHistoryBooksSet = new Set();
    }
    
    // 3. Mevcut slugları yükle
    cachedGeneratedSlugs = getGeneratedBookSlugs();
}

function getGeneratedBookSlugs() {
    const slugs = new Set();
    const dirs = fs.readdirSync(process.cwd()).filter(d => d.startsWith('generated-') && fs.statSync(d).isDirectory());
    for (const dir of dirs) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            slugs.add(file.replace('.md', ''));
        }
    }
    return slugs;
}

function selectBookFromScrapedData(history) {
    initCache();
    if (cachedScrapedBooks.length === 0) {
        throw new Error("scraped_books.json bulunamadı. Lütfen Zombi Botu çalıştırın.");
    }
    
    // Filtreleme: Daha önce yazılmış kitapları ve diske inmiş slugları ele
    let freshBooks = [];
    for (const b of cachedScrapedBooks) {
        const titleLower = b.title.toLowerCase().trim();
        const rawSlug = `${b.title}-${b.author}`;
        const slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        
        // Zırhlı Koruma: Kitap adı sadece emoji veya geçersiz karakterlerden oluşuyorsa (slug boşsa), bu saçma kitabı tamamen ele!
        if (!slug || slug.length < 2) continue;
        
        if (!cachedHistoryBooksSet.has(titleLower) && !cachedGeneratedSlugs.has(slug)) {
            freshBooks.push(b);
        }
    }
    
    if (freshBooks.length === 0) {
        throw new Error("Havuzdaki tüm kitaplar yazılmış. Zombi Botun yeni kitaplar kazıması gerekiyor.");
    }

    const randomIndex = Math.floor(Math.random() * freshBooks.length);
    return freshBooks[randomIndex];
}

function getFreshBooksCount() {
    initCache();
    if (cachedScrapedBooks.length === 0) return 0;
    
    let count = 0;
    for (const b of cachedScrapedBooks) {
        const titleLower = b.title.toLowerCase().trim();
        const rawSlug = `${b.title}-${b.author}`;
        const slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        
        // Zırhlı Koruma: Kitap adı sadece emoji veya geçersiz karakterlerden oluşuyorsa sayıma dahil etme!
        if (!slug || slug.length < 2) continue;
        
        if (!cachedHistoryBooksSet.has(titleLower) && !cachedGeneratedSlugs.has(slug)) {
            count++;
        }
    }
    return count;
}

async function fetchBookData(author) {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const suggestion = selectBookFromScrapedData(history);
    console.error(`[INFO] Scraped Listesinden Seçildi: ${suggestion.title} by ${suggestion.author}`);
    
    let coverUrl = null;
    let desc = 'None';
    let pages = 'Unknown';
    let pubDate = 'Unknown';
    let dataSource = 'Multi-API';

    // 1. APPLE BOOKS API (En Yüksek Kalite, Şifresiz)
    try {
        const appleUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(suggestion.title + " " + suggestion.author)}&media=ebook&entity=ebook&limit=1`;
        const appleRes = await fetch(appleUrl);
        if (appleRes.ok) {
            const appleData = await appleRes.json();
            if (appleData.results && appleData.results.length > 0) {
                const book = appleData.results[0];
                if (book.artworkUrl100) {
                    // Apple'ın ufak resmini (100x100) Yüksek Çözünürlüğe (1000x1000) zorluyoruz
                    coverUrl = book.artworkUrl100.replace('100x100bb', '1000x1000bb');
                }
                if (book.description && desc === 'None') desc = book.description;
                if (book.releaseDate && pubDate === 'Unknown') pubDate = book.releaseDate.split('-')[0];
            }
        }
    } catch(e) {}

    // 2. PRH API (Resmi Yayıncı)
    try {
        const prhKey = process.env.PENGUIN_API_KEY;
        if (prhKey) {
            const prhUrl = `https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US/search?q=${encodeURIComponent(suggestion.title)}&api_key=${prhKey}`;
            const prhRes = await fetch(prhUrl);
            const prhText = await prhRes.text();
            if (prhRes.ok && !prhText.includes('Developer Inactive')) {
                const prhData = JSON.parse(prhText);
                if (prhData && prhData.data && prhData.data.results && prhData.data.results.length > 0) {
                    const prhWork = prhData.data.results[0];
                    const workRes = await fetch(`https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US/works/${prhWork.key}?api_key=${prhKey}`);
                    if (workRes.ok) {
                        const workData = await workRes.json();
                        if (workData && workData.data && workData.data.works && workData.data.works.length > 0) {
                            if (pubDate === 'Unknown' && workData.data.works[0].onsale) pubDate = workData.data.works[0].onsale.split('-')[0];
                            const iconLink = (workData.data.works[0]._links || []).find(l => l.rel === 'icon');
                            if (!coverUrl && iconLink) coverUrl = iconLink.href; // Apple'da bulamadıysa PRH'den al
                        }
                    }
                    if (desc === 'None' && prhWork.description) desc = prhWork.description[0];
                }
            }
        }
    } catch(e) {}

    // 3. GOOGLE BOOKS API (Devasa Kütüphane)
    try {
        const googleUrl = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(suggestion.title)}+inauthor:${encodeURIComponent(suggestion.author)}&maxResults=1`;
        const googleRes = await fetch(googleUrl);
        if (googleRes.ok) {
            const googleData = await googleRes.json();
            if (googleData.items && googleData.items.length > 0) {
                const vol = googleData.items[0].volumeInfo;
                if (!coverUrl && vol.imageLinks && vol.imageLinks.thumbnail) {
                    // Mümkünse daha büyük kapağı (zoom=3) çekmeye çalış
                    coverUrl = vol.imageLinks.thumbnail.replace('zoom=1', 'zoom=3'); 
                }
                if (desc === 'None' && vol.description) desc = vol.description;
                if (pages === 'Unknown' && vol.pageCount) pages = vol.pageCount.toString();
                if (pubDate === 'Unknown' && vol.publishedDate) pubDate = vol.publishedDate.split('-')[0];
            }
        }
    } catch (e) {}

    // 4. OPEN LIBRARY (Son Kale)
    if (!coverUrl || desc === 'None' || pages === 'Unknown' || pubDate === 'Unknown') {
        try {
            const olUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(suggestion.title)}&author=${encodeURIComponent(suggestion.author)}&limit=1`;
            const olRes = await fetch(olUrl);
            if (olRes.ok) {
                const olData = await olRes.json();
                if (olData.docs && olData.docs.length > 0) {
                    const doc = olData.docs[0];
                    if (!coverUrl && doc.cover_i) {
                        coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
                    }
                    if (pages === 'Unknown' && doc.number_of_pages_median) pages = doc.number_of_pages_median.toString();
                    if (pubDate === 'Unknown' && doc.first_publish_year) pubDate = doc.first_publish_year.toString();
                    
                    if (desc === 'None') {
                        const workRes = await fetch(`https://openlibrary.org${doc.key}.json`);
                        if (workRes.ok) {
                            const workData = await workRes.json();
                            if (workData.description) desc = typeof workData.description === 'string' ? workData.description : workData.description.value;
                        }
                    }
                }
            }
        } catch(e) {}
    }

    return {
        title: suggestion.title, 
        authors: [suggestion.author],
        publishedDate: pubDate,
        pageCount: pages,
        description: desc,
        coverUrl: coverUrl,
        dataSource: dataSource
    };
}

function generateReviewDate(bookPublishedYear) {
    const startTs = new Date('2024-10-01T00:00:00Z').getTime();
    const endTs = new Date('2026-06-30T23:59:59Z').getTime();
    
    let baseMinTs = startTs;
    if (bookPublishedYear && !isNaN(bookPublishedYear)) {
        const bookTs = new Date(`${bookPublishedYear}-01-01T00:00:00Z`).getTime();
        if (bookTs > baseMinTs) {
            baseMinTs = bookTs;
        }
    }
    
    if (baseMinTs >= endTs) {
        return new Date(baseMinTs + (Math.random() * 30 * 24 * 60 * 60 * 1000));
    }
    
    const randomTs = baseMinTs + Math.random() * (endTs - baseMinTs);
    return new Date(randomTs);
}

async function runBot() {
    console.error("Starting GitHub Book Writer with Sharp (WebP) & 4-Stage Cover Engine...");
    
    // Zombi Bot'un listesindeki yazılmamış Taze Kitap sayısını hesapla
    const totalBooksToGenerate = getFreshBooksCount();
    console.error(`[INFO] Havuzda yazılmayı bekleyen toplam TAZE KİTAP sayısı: ${totalBooksToGenerate}`);
    
    if (totalBooksToGenerate === 0) {
        console.error("Havuzdaki tüm kitaplar yazılmış. Zombi Botun yeni kitaplar kazıması gerekiyor.");
        process.exit(0);
    }

    const scriptStartTime = Date.now();
    const MAX_RUN_TIME = 50 * 60 * 1000; // 50 dakika (milisaniye cinsinden)
    
    let booksGenerated = 0;
    let attempts = 0;
    
    while (booksGenerated < totalBooksToGenerate && attempts < 10000) {
        attempts++;
        
        // 50 DAKİKA KORUMASI (Safe Shutdown)
        if (Date.now() - scriptStartTime >= MAX_RUN_TIME) {
            console.error(`[!] GÜVENLİ KAPANIŞ (Safe Shutdown): Script 50 dakikadır çalışıyor.`);
            console.error(`[!] GitHub'ın zorla kapatmasını (timeout) önlemek için işlem güvenle sonlandırılıyor.`);
            console.error(`[!] Bu sayede şu ana kadar üretilen ${booksGenerated} kitap güvenle GitHub'a commit'lenecek.`);
            break; // Döngüyü kır, alt satırdaki başarılı bitişe gitsin.
        }

        try {
            console.error(`\n--- Generation Attempt ${attempts} (Success: ${booksGenerated}/${totalBooksToGenerate}) ---`);
            const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            const author = getNextAuthor(history);
            
            const book = await fetchBookData(author);
            console.error(`[INFO] Book: ${book.title}`);
            
            const publishDate = generateReviewDate(book.publishedDate);
            
            const prompt = `You are a professional book reviewer.
Book: ${book.title}
Author: ${book.authors ? book.authors.join(', ') : 'Unknown'}
Published Year: ${book.publishedDate || 'Unknown'}
Page Count: ${book.pageCount || 'Unknown'}
Original Synopsis: ${book.description || 'None'}

Using this data, write a convincing, short, and striking preview/critique of the book (maximum 800-900 words) focusing on the main theme and author's style.
At the very end of the review, you MUST add 5-6 popular #hashtags related to the book's content.
Output the result ONLY in English. Never wrap the output in markdown code blocks, provide clean text.`;
            
            const rawArticle = await generateArticleBody(prompt, booksGenerated);
            const articleBody = sanitizeMarkdown(rawArticle);

            // Kusursuz Benzersizlik (Unique Slug): KİTAP ADI + YAZAR ADI
            const rawSlug = `${book.title}-${book.authors.join('-')}`;
            let slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            
            // Eğer kazınan veri aşırı bozuksa (hiçbir harf içermiyorsa) kitabı atla
            if (!slug || slug.length < 2) {
                console.error(`[ERROR] Geçersiz veya bozuk kitap adı tespit edildi: ${book.title}. Bu kitap atlanıyor.`);
                continue;
            }
            
            // WebP Dönüşümü ve İndirme
            const downloadedImage = await downloadImage(book.coverUrl, slug);
            
            const safeTitle = book.title.replace(/"/g, "'");
            const safeAuthor = author.name.replace(/"/g, "'");
            
            // Sadece kitap adına dayalı kısa tag
            const tagTitle = book.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '').substring(0, 20).replace(/-$/, '');
            const genreTag = author.genre.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            
            const content = `---
title: "${safeTitle} Book Review and Summary"
meta_title: "${safeTitle} Book Review | ${safeAuthor}"
description: "Everything you need to know about ${safeTitle} with our detailed review."
date: ${publishDate.toISOString()}
image: "/images/books/${downloadedImage || 'default.webp'}"
categories: ["Books"]
authors: ["${safeAuthor}"]
tags: ["#${tagTitle}", "#bookreview", "#${genreTag}"]
data_source: "${book.dataSource}"
draft: false
---

# ${book.title}

**Author:** ${book.authors ? book.authors.join(', ') : 'Unknown'}  
**Page Count:** ${book.pageCount || 'Unknown'}  
**Publication Date:** ${book.publishedDate || 'Unknown'}

${articleBody}
`;

            const filePath = path.join(OUTPUT_DIR, `${slug}.md`);
            fs.writeFileSync(filePath, content, 'utf8');
            
            history.authors[author.id] = (history.authors[author.id] || 0) + 1;
            history.books.push(book.title);
            
            // Performans Cache Güncellemesi: Tekrar aynı kitabın seçilmesini önle
            if (cachedHistoryBooksSet) cachedHistoryBooksSet.add(book.title.toLowerCase().trim());
            if (cachedGeneratedSlugs) cachedGeneratedSlugs.add(slug);
            
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
            
            console.error(`[SUCCESS] Saved ${filePath} (Cover: ${downloadedImage ? 'YES (WebP)' : 'NO'})`);
            booksGenerated++;
            
            await sleep(5000);
            
        } catch (err) {
            console.error(`[ERROR] Attempt ${attempts}:`, err.message);
            // Yılmaz Döngü: Eğer tüm API'ler molada ise 60 saniye dinlenip tekrar döngüye gir (Mola bitene kadar bu loop devam eder)
            if (err.message && err.message.includes("dinlenmede")) {
                console.error("[!] Tüm API'ler limit hatası verdi veya mola durumunda. 60 saniye bekletilip tekrar yoklanacak...");
                await sleep(60000);
            } else {
                await sleep(5000);
            }
        }
    }
    console.error(`[FINISH] Generated ${booksGenerated} books in ${attempts} attempts.`);
    process.exit(0); 
}

runBot();
