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

const today = new Date();
const year = today.getFullYear();
const month = String(today.getMonth() + 1).padStart(2, '0');
const day = String(today.getDate()).padStart(2, '0');

// Hiyerarşi: books-2026 / 08 / generated2026-01-08-2026
const OUTPUT_DIR = path.join(process.cwd(), `books-${year}`, month, `generated2026-${day}-${month}-${year}`);

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
    
    // 2026 Ağustos: Yeni Nesil Llama 3.3 ve Gemini Flash Ücretsiz Modelleri
    const freeModels = [
        "google/gemini-2.0-flash-lite-preview-02-05:free",
        "meta-llama/llama-3.3-70b-instruct:free"
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
    
    // AI modellerin (özellikle DeepSeek-R1 vb.) içsel düşünme süreçlerini sızdırmasını engellemek için <think> etiketlerini temizle
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-z]*\n/i, '');
        clean = clean.replace(/\n```$/i, '');
    }
    
    // YENİ: İnatçı Ana Başlık (H1/H2) Tıraşlayıcı!
    clean = clean.replace(/^(#.*?\n)+/, '').trim();
    
    return clean;
}

function isZombiText(text) {
    // 1. Uzaylı Dili Sınırı (Limit: 10 Harf)
    const alienMatch = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7a3\u0400-\u04ff\u0600-\u06ff]/g);
    if (alienMatch && alienMatch.length > 10) {
        return { isZombi: true, reason: `Uzaylı Dili tespit edildi (${alienMatch.length} harf)` };
    }

    // 2. Net Sembol Çöplüğü Sınırı (Limit: 15 Adet) - Sadece < > { } [ ] \ ~ ^ | _
    const symbolMatch = text.match(/[<>{}\[\]\\~^|_]/g);
    if (symbolMatch && symbolMatch.length > 15) {
        return { isZombi: true, reason: `Sembol çöplüğü tespit edildi (${symbolMatch.length} adet)` };
    }

    // 3. Yazılım Kodu Kusma Sınırı (Limit: 2 Kelime)
    const codeWords = ['webkit', 'javax', 'CGRect', '<div', 'console.log', 'public static'];
    let codeWordCount = 0;
    const lowerText = text.toLowerCase();
    for (const word of codeWords) {
        let occurrences = lowerText.split(word.toLowerCase()).length - 1;
        codeWordCount += occurrences;
    }
    if (codeWordCount >= 2) {
        return { isZombi: true, reason: `Yazılım kodu kusması tespit edildi (${codeWordCount} kelime)` };
    }

    // 4. Kilitlenme / Kekeleme Sınırı
    const repetitionRegex = /((?:\b\w+\b\s+){2}\b\w+\b)(?:\s+\1){3,}/i;
    if (repetitionRegex.test(text)) {
        return { isZombi: true, reason: `Kilitlenme / Kekeleme döngüsü tespit edildi (3+ kelime tekrarı)` };
    }
    const singleWordRepetition = /\b(\w+)\b(?:\s+\1\b){4,}/i;
    if (singleWordRepetition.test(text)) {
        return { isZombi: true, reason: `Tek kelime kekeleme döngüsü tespit edildi` };
    }

    // 5. İnce İçerik (Thin Content) Sınırı (Limit: 200 Kelime)
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount < 200) {
        return { isZombi: true, reason: `İnce İçerik (Thin Content) tespit edildi: Sadece ${wordCount} kelime` };
    }

    return { isZombi: false, reason: "" };
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

function getDailyQuotaAndState() {
    const historyFile = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    let cycleState = historyFile.cycleState || {
        currentCycleWeek: 1,
        fullCapacityWeek: Math.floor(Math.random() * 4) + 1,
        currentWeekDay: 1,
        dailyDistribution: [20, 45, 10, 35, 40, 25, 35],
        lastRunDate: "",
        booksWrittenToday: 0
    };
    
    // Güvenlik: Eğer dailyDistribution bir şekilde boş array [] olarak gelirse, varsayılanı yükle
    if (!cycleState.dailyDistribution || cycleState.dailyDistribution.length === 0) {
        cycleState.dailyDistribution = [20, 45, 10, 35, 40, 25, 35];
    }
    if (cycleState.booksWrittenToday === undefined) {
        cycleState.booksWrittenToday = 0;
    }
    
    const today = new Date();
    const dateString = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    
    if (cycleState.lastRunDate === dateString) {
        const dailyTarget = cycleState.dailyDistribution[cycleState.currentWeekDay - 1];
        const remainingQuota = Math.max(0, dailyTarget - cycleState.booksWrittenToday);
        if (remainingQuota === 0) {
            console.error(`[INFO] Bugünün kotası zaten tamamlandı. (${dailyTarget}/${dailyTarget} Kitap)`);
        } else {
            console.error(`[INFO] Bugün daha önce çalıştı. Kalan Kota: ${remainingQuota} (Hedef: ${dailyTarget})`);
        }
        return { quota: remainingQuota, state: cycleState, historyFile }; 
    }
    
    // YENİ GÜN: Sayacı sıfırla
    cycleState.booksWrittenToday = 0;
    
    if (cycleState.lastRunDate !== "") {
        cycleState.currentWeekDay++;
        if (cycleState.currentWeekDay > 7) {
            cycleState.currentWeekDay = 1;
            cycleState.currentCycleWeek++;
            if (cycleState.currentCycleWeek > 4) {
                cycleState.currentCycleWeek = 1;
                cycleState.fullCapacityWeek = Math.floor(Math.random() * 4) + 1;
                console.error(`[INFO] YENI AYLIK DONGU! Tam kapasite haftası: ${cycleState.fullCapacityWeek}`);
            }
            
            let weeklyTarget = 210;
            if (cycleState.currentCycleWeek !== cycleState.fullCapacityWeek) {
                const reductionPercent = Math.floor(Math.random() * 16) + 5; // 5 to 20
                weeklyTarget = Math.round(210 * (1 - (reductionPercent / 100)));
                console.error(`[INFO] Tembellik Haftası! Düşüş: %${reductionPercent}, Hedef: ${weeklyTarget}`);
            } else {
                console.error(`[INFO] TAM KAPASITE HAFTASI! Hedef: 210`);
            }
            
            const baseDist = [20, 45, 10, 35, 40, 25, 35];
            let newDist = baseDist.map(val => Math.round(val * (weeklyTarget / 210)));
            const currentSum = newDist.reduce((a, b) => a + b, 0);
            newDist[6] += (weeklyTarget - currentSum);
            cycleState.dailyDistribution = newDist;
        }
    }
    
    cycleState.lastRunDate = dateString;
    historyFile.cycleState = cycleState;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyFile, null, 2), 'utf8');
    
    return { quota: cycleState.dailyDistribution[cycleState.currentWeekDay - 1], state: cycleState, historyFile };
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

    // YENİ ÖZELLİK: Kitapları Hype (addedByCount) puanına göre büyükten küçüğe sırala
    freshBooks.sort((a, b) => {
        const aCount = a.addedByCount || 0;
        const bCount = b.addedByCount || 0;
        return bCount - aCount;
    });

    // En yüksek hype'a sahip olan kitabı seç (Sıradaki en kaliteli kitap her zaman listenin ilkidir)
    return freshBooks[0];
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
    let dataSource = 'ANTG';

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
                if (book.description && desc === 'None') { desc = book.description; dataSource = 'APL'; }
                if (book.releaseDate && pubDate === 'Unknown') pubDate = book.releaseDate.split('T')[0];
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
                            if (pubDate === 'Unknown' && workData.data.works[0].onsale) pubDate = workData.data.works[0].onsale.split('T')[0];
                            const iconLink = (workData.data.works[0]._links || []).find(l => l.rel === 'icon');
                            if (!coverUrl && iconLink) coverUrl = iconLink.href; // Apple'da bulamadıysa PRH'den al
                        }
                    }
                    if (desc === 'None' && prhWork.description) { desc = prhWork.description[0]; dataSource = 'PRH'; }
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
                if (desc === 'None' && vol.description) { desc = vol.description; dataSource = 'GB'; }
                if (pages === 'Unknown' && vol.pageCount) pages = vol.pageCount.toString();
                if (pubDate === 'Unknown' && vol.publishedDate) pubDate = vol.publishedDate.split('T')[0];
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
                            if (workData.description) {
                                desc = typeof workData.description === 'string' ? workData.description : workData.description.value;
                                dataSource = 'LB';
                            }
                        }
                    }
                }
            }
        } catch(e) {}
    }

    // 5. TARİH DOĞRULAMA (2025 hatalarını %100 yok etmek için)
    if (pubDate !== 'Unknown' && pubDate.includes('2026')) {
        pubDate = `Expected publication ${pubDate}`;
    } else {
        pubDate = 'Expected publication 2026';
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
    // Gece 00:00 ile 23:59 arası rastgele saat ve dakika atar
    const d = new Date();
    d.setHours(Math.floor(Math.random() * 24));
    d.setMinutes(Math.floor(Math.random() * 60));
    d.setSeconds(Math.floor(Math.random() * 60));
    return d;
}

async function runBot() {
    console.error("Starting GitHub Book Writer with Sharp (WebP) & 4-Stage Cover Engine...");
    
    // Zombi Bot'un listesindeki yazılmamış Taze Kitap sayısını hesapla
    let freshBooksCount = getFreshBooksCount();
    
    // Şelale Takvimi Kotasını Çek
    const { quota, state } = getDailyQuotaAndState();
    
    let totalBooksToGenerate = quota;
    
    console.error(`[INFO] --- KAOS TAKVIMI ---`);
    console.error(`[INFO] Döngü: Hafta ${state.currentCycleWeek}/4, Gün ${state.currentWeekDay}/7`);
    console.error(`[INFO] Haftalık Dağılım: [${state.dailyDistribution.join(', ')}]`);
    console.error(`[INFO] BUGÜNKÜ HEDEF KOTA: ${quota} KİTAP`);
    console.error(`[INFO] Havuzda Kalan Taze Kitap: ${freshBooksCount}`);
    
    if (totalBooksToGenerate > freshBooksCount) {
        totalBooksToGenerate = freshBooksCount;
    }
    
    if (totalBooksToGenerate === 0) {
        console.error("Havuzdaki tüm kitaplar yazılmış. Zombi Botun yeni kitaplar kazıması gerekiyor.");
        process.exit(0);
    }

    const scriptStartTime = Date.now();
    const MAX_RUN_TIME = 50 * 60 * 1000; // 50 dakika (milisaniye cinsinden)
    
    let booksGenerated = 0;
    let attempts = 0;
    const skipCounters = {}; // Kısır döngüyü kırmak için 3 şans kuralı sayacı
    
    // ======================================================================
    // ======================================================================
    // HIBRID PERSONA MATRISI & CAPRAZ SINIF MOTORU HAVUZLARI (JSON TABANLI)
    // ======================================================================
    const personaMatrixData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'persona_matrix2026.json'), 'utf8'));
    const antiFootprintData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'anti_footprint_data.json'), 'utf8'));
    
    const authorIdentities = personaMatrixData.authorIdentities;
    const allMoods = personaMatrixData.allMoods;
    const lifeEvents = personaMatrixData.lifeEvents;
    
    let apiFailCounters = {}; // API Fail Loop Guard
    
    while (booksGenerated < totalBooksToGenerate && attempts < 10000) {
        let currentBookTitle = null;
        let currentAuthorId = null;
        let currentHistory = null;
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
            currentHistory = history;
            const author = getNextAuthor(history);
            currentAuthorId = author.id;
            
            const book = await fetchBookData(author);
            currentBookTitle = book.title;
            console.error(`[INFO] Book: ${book.title}`);
            
            // --- NEW: Skip empty synopsis to protect DA ---
            if (!book.description || book.description === 'None' || book.description.trim().length < 20) {
                skipCounters[book.title] = (skipCounters[book.title] || 0) + 1;
                console.error(`[SKIP] Book ${book.title} has empty or short synopsis. (Attempt ${skipCounters[book.title]}/3)`);
                
                // 3 Şans Kuralı: 3 kez denendiyse ve hala özet yoksa, KALICI OLARAK çöpe at (Sonsuz döngüyü kır)
                if (skipCounters[book.title] >= 3) {
                    console.error(`[!] ${book.title} 3 kez denendi ancak özet bulunamadı. Sonsuz döngüyü engellemek için tarihe gömülüyor.`);
                    history.books.push(book.title);
                    cachedHistoryBooksSet.add(book.title.toLowerCase().trim());
                    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
                }
                
                continue; // Skip this book
            }
            
            const publishDate = generateReviewDate(book.publishedDate);
            
            // ======================================================================
            // 1. DİNAMİK PERSONA MATRİSİ (HİBRİD SİSTEM + ÇAPRAZ SINIF)
            // ======================================================================
            // a) Yazarın Sabit Sınıfını (Tier) ve Uzmanlığını Belirleme (1-to-1 Mapping)
            let baseTier = "bohemian"; // Default
            let fixedExpertise = "a cynical barista and horror fan searching for genuine dread";
            
            if (authorIdentities[author.id]) {
                baseTier = authorIdentities[author.id].tier;
                fixedExpertise = authorIdentities[author.id].desc;
            }
            
            // b) Dinamik Ruh Hali (Mood) - Tamamen Rastgele
            const randomMood = allMoods[Math.floor(Math.random() * allMoods.length)];
            
            // c) Mevsimsel Zeka ve Hafta Sonu Mantığı
            let season = 'general';
            const m = publishDate.getMonth(); // 0 (Jan) - 11 (Dec)
            if (m === 11 || m === 0 || m === 1) season = 'winter';
            else if (m === 2 || m === 3 || m === 4) season = 'spring';
            else if (m === 5 || m === 6 || m === 7) season = 'summer';
            else if (m === 8 || m === 9 || m === 10) season = 'autumn';

            const dayOfWeek = publishDate.getDay();
            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            const timeOfWeek = isWeekend ? 'weekend' : 'weekday';
            
            // d) Çapraz Sınıf Olasılık Motoru (Cross-Class Probability Engine)
            let selectedTier = baseTier;
            const dice = Math.random() * 100;
            
            if (dice > 95) {
                // %5 ihtimalle EN ZIT sınıfa gider
                selectedTier = (baseTier === 'elite') ? 'bohemian' : (baseTier === 'bohemian' ? 'elite' : 'elite');
            } else if (dice > 80) {
                // %15 ihtimalle KOMŞU sınıfa gider
                selectedTier = (baseTier === 'elite') ? 'family' : (baseTier === 'bohemian' ? 'family' : 'bohemian');
            }
            
            // e) Mekan Sürekliliği (Continuity - Işınlanma Hatası Koruması)
            if (!history.authorsState) history.authorsState = {};
            if (!history.authorsState[author.id]) history.authorsState[author.id] = { currentLocation: "", remainingUses: 0 };
            
            let randomSetting = "";
            if (history.authorsState[author.id].remainingUses > 0) {
                // Hala aynı mekanda (Süreklilik)
                randomSetting = history.authorsState[author.id].currentLocation;
                history.authorsState[author.id].remainingUses -= 1;
            } else {
                // Yeni mekana geç (Zaman ve mevsime göre havuzdan seç)
                const seasonSettings = lifeEvents[selectedTier][timeOfWeek][season];
                const generalSettings = lifeEvents[selectedTier][timeOfWeek]['general'];
                const combinedSettings = seasonSettings.concat(generalSettings);
                
                randomSetting = combinedSettings[Math.floor(Math.random() * combinedSettings.length)];
                
                // Bu mekanda rastgele 2 ila 4 makale boyunca kal
                history.authorsState[author.id].currentLocation = randomSetting;
                history.authorsState[author.id].remainingUses = Math.floor(Math.random() * 3) + 2; 
            }
            // State memory'de güncellendi, dosyanın en altında fs.writeFileSync ile yazılıyor zaten.
            
            // Zarları atıyoruz
            const includeLocation = Math.random() * 100 < 20; // %20 ihtimal
            const includeSeason = Math.random() * 100 < 20;   // %20 ihtimal
            const includeMood = Math.random() * 100 < 50;     // %50 ihtimal

            // Anti-Footprint Zarları
            const includeFragment = Math.random() * 100 < 20; // %20 ihtimal
            let randomFragment = "";
            if (includeFragment) {
                const frags = antiFootprintData.fragments;
                randomFragment = frags[Math.floor(Math.random() * frags.length)];
            }

            // Kapanış Zarı (%100) - Cinsiyet ve Sınıf (Tier) Bazlı Matris
            const genderKey = (author.gender || "neutral").toLowerCase();
            const tierKey = selectedTier;
            let endingCategory = `${genderKey}_${tierKey}`;
            
            // %15 ihtimalle cinsiyet/sınıf gözetmeksizin Ortak (Neutral/Pre-Release) bir kaos yaşanır
            if (Math.random() * 100 < 15) {
                endingCategory = "neutral";
            }

            let ends = antiFootprintData.endings[endingCategory];
            
            // Hata payına karşı neutral'a düş
            if (!ends || ends.length === 0) {
                ends = antiFootprintData.endings["neutral"];
            }
            
            const randomEnding = ends[Math.floor(Math.random() * ends.length)];

            // ======================================================================
            // NEW PERFECT PERSONA TEMPLATE ENGINE & GUARDRAIL
            // ======================================================================
            let justification = "";
            if (includeLocation && baseTier !== selectedTier) {
                if (baseTier === 'elite' && selectedTier === 'bohemian') justification = " (You are slumming it here ironically, or hiding from the press.)";
                else if (baseTier === 'elite' && selectedTier === 'family') justification = " (You are begrudgingly visiting relatives who don't understand your lifestyle.)";
                else if (baseTier === 'bohemian' && selectedTier === 'elite') justification = " (You snuck in here for the free food, or were dragged here by a wealthy friend.)";
                else if (baseTier === 'bohemian' && selectedTier === 'family') justification = " (You are reluctantly attending a family gathering, feeling entirely out of place.)";
                else if (baseTier === 'family' && selectedTier === 'elite') justification = " (You won a charity auction ticket to be here and feel incredibly out of place.)";
                else if (baseTier === 'family' && selectedTier === 'bohemian') justification = " (You are here trying to reconnect with your lost youth, feeling slightly ridiculous.)";
            }

            let cleanMood = randomMood;
            if (cleanMood.startsWith("feeling ")) cleanMood = cleanMood.replace("feeling ", "");

            let activePersona = "";
            if (includeLocation && includeMood) {
                const templatesBoth = [
                    `You are ${fixedExpertise}. At this exact moment, you are ${randomSetting}${justification}. Emotionally, you happen to be feeling ${cleanMood}.`,
                    `As ${fixedExpertise}, you are currently ${randomSetting}${justification}. To add to that, you are feeling ${cleanMood}.`,
                    `You are ${fixedExpertise}. You are feeling ${cleanMood} while ${randomSetting}${justification}.`,
                    `Imagine you are ${fixedExpertise}. Right now, you are ${randomSetting}${justification}, and you find yourself feeling ${cleanMood}.`,
                    `You are ${fixedExpertise}. Today, you are feeling ${cleanMood}, and you are ${randomSetting}${justification}.`,
                    `Being ${fixedExpertise}, you are ${randomSetting}${justification} at the moment. Emotionally speaking, you are feeling ${cleanMood}.`,
                    `You are ${fixedExpertise}. You happen to be ${randomSetting}${justification}, and today you are feeling ${cleanMood}.`,
                    `As ${fixedExpertise}, your current setting is ${randomSetting}${justification}. Mood-wise, you are feeling ${cleanMood}.`,
                    `You are ${fixedExpertise}. You are currently feeling ${cleanMood} while ${randomSetting}${justification}.`,
                    `You are ${fixedExpertise}. Right now, you are ${randomSetting}${justification}, feeling ${cleanMood}.`
                ];
                activePersona = templatesBoth[Math.floor(Math.random() * templatesBoth.length)];
            } else if (includeLocation && !includeMood) {
                const templatesLoc = [
                    `You are ${fixedExpertise}. At this exact moment, you are ${randomSetting}${justification}.`,
                    `As ${fixedExpertise}, you are currently ${randomSetting}${justification}.`,
                    `You are ${fixedExpertise}, and right now you are ${randomSetting}${justification}.`,
                    `Being ${fixedExpertise}, your current setting is ${randomSetting}${justification}.`,
                    `Imagine you are ${fixedExpertise}, currently ${randomSetting}${justification}.`
                ];
                activePersona = templatesLoc[Math.floor(Math.random() * templatesLoc.length)];
            } else if (!includeLocation && includeMood) {
                const templatesMood = [
                    `You are ${fixedExpertise}. Today, you are feeling ${cleanMood} as you write this.`,
                    `As ${fixedExpertise}, you are currently feeling ${cleanMood}.`,
                    `You are ${fixedExpertise}. Emotionally speaking, you happen to be feeling ${cleanMood} today.`,
                    `Being ${fixedExpertise}, your current mood is feeling ${cleanMood}.`,
                    `Imagine you are ${fixedExpertise}, and right now you are feeling ${cleanMood}.`
                ];
                activePersona = templatesMood[Math.floor(Math.random() * templatesMood.length)];
            } else {
                activePersona = `You are ${fixedExpertise}.`;
            }

            // ======================================================================
            // 2. COGNITIVE FLAW ROULETTE (Digital Schizophrenia Engine)
            // ======================================================================
            const flawDB = {
                elite: [
                    "ZERO-CONTEXT POP CULTURE DROP: Make a highly specific, devastating pop-culture reference (e.g., a high-end scandal, a niche opera, or a famous disaster) to insult the book's plot. DO NOT explain the reference. Assume the reader is smart enough to get it.",
                    "EXTREME BIAS PROTOCOL: Do NOT write a balanced review. Be irrationally snobbish, biased, and refuse to see the other side. If you hate it, hate it 100%.",
                    "LEXICAL WHIPLASH: In the exact same sentence, seamlessly combine PhD-level literary vocabulary with absolute internet gutter-slang.",
                    "THE PIVOT: In the middle of your review, completely contradict a minor point you made earlier. Interrupt your own thought process."
                ],
                bohemian: [
                    "VISUAL CHAOS & ANTI-MARKDOWN: NEVER use bullet points, numbered lists, or bold text for emphasis. You are too tired to format this properly. Use ALL CAPS sparingly for emphasis and excessive em-dashes (—) to interrupt yourself.",
                    "LEXICAL WHIPLASH: In the exact same sentence, seamlessly combine PhD-level literary vocabulary with absolute internet gutter-slang.",
                    "FOURTH WALL META-COMPLAINT: Break the fourth wall mid-review. Complain about the fact that you have to write this review at all, or mention you're just trying to hit a word count.",
                    "THE PIVOT: In the middle of your review, completely contradict a minor point you made earlier. Interrupt your own thought process."
                ],
                family: [
                    "THE ADHD TANGENT: Go on a completely unhinged, off-topic tangent for an entire paragraph. Complain bitterly about a DIFFERENT book, a kids' cartoon, or daily life, comparing it to this book. Snap back in the last sentence.",
                    "EXTREME BIAS PROTOCOL: Do NOT write a balanced review. Be irrationally biased, stubborn, and refuse to see the other side.",
                    "THE PIVOT: In the middle of your review, completely contradict a minor point you made earlier. Interrupt your own thought process.",
                    "PARAGRAPH ASYMMETRY: Force extreme paragraph asymmetry. Write one massive, rambling paragraph where you complain endlessly, followed immediately by a paragraph that is only one or two words long (e.g., 'Literally.' or 'Hard pass.')."
                ]
            };

            let tierFlaws = flawDB[baseTier] || flawDB['bohemian'];
            let shuffledFlaws = tierFlaws.sort(() => 0.5 - Math.random());
            let selectedFlaws = [shuffledFlaws[0], shuffledFlaws[1]];

            let behavioralOverrides = `\n[CRITICAL BEHAVIORAL OVERRIDES]\nYou MUST apply the following 2 cognitive flaws to your writing style:\n- ${selectedFlaws[0]}\n- ${selectedFlaws[1]}`;

            // Persona Motoru Canlı Log (Kullanıcı Gözlemi İçin)
            console.error(`\n[PERSONA ENGINE] 🎭 Yazar: ${author.id}`);
            console.error(`[PERSONA ENGINE] 💼 Sınıf: ${baseTier} -> (Çapraz Sınıf Zarı: ${selectedTier})`);
            console.error(`[PERSONA ENGINE] ⛅ Zaman/Mevsim: ${timeOfWeek} / ${season} (Ay: ${publishDate.getMonth() + 1}) [Zar: ${includeSeason ? 'TUTTU' : 'PAS'}]`);
            console.error(`[PERSONA ENGINE] 📍 Mekan: ${randomSetting} [Zar: ${includeLocation ? 'TUTTU' : 'PAS'}]`);
            console.error(`[PERSONA ENGINE] 🧠 Ruh Hali: ${randomMood} [Zar: ${includeMood ? 'TUTTU' : 'PAS'}]`);
            console.error(`[ANTI-FOOTPRINT] 🧩 Fragman: ${includeFragment ? 'TUTTU (' + randomFragment + ')' : 'PAS'}`);
            console.error(`[ANTI-FOOTPRINT] 🎬 Kapanış Stratejisi: ${randomEnding}`);
            console.error(`[BEHAVIORAL OVERRIDE] 🎯 Seçilen Kusurlar: 1. ${selectedFlaws[0].split(':')[0]} + 2. ${selectedFlaws[1].split(':')[0]}\n`);

            // ======================================================================
            // 2. MASTER PROMPT (Yapay Zekaya Gidecek Kusursuz Zırhlı Komut)
            // ======================================================================
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const currentMonthName = monthNames[m];

            let seasonGuardrail = "";
            if (includeSeason) {
                seasonGuardrail = `\nWEATHER & SEASON GUARDRAIL (CRITICAL): The current month is ${currentMonthName} (${season}). Do NOT hallucinate the wrong season. Do not talk about snow in summer, or autumn leaves in spring. Align your environmental descriptions perfectly with the current weather context!`;
            }

            let fragmentInstruction = "";
            if (includeFragment) {
                fragmentInstruction = `\n15. MANDATORY FRAGMENT (CRITICAL): You MUST seamlessly integrate this exact sentence into your review: "${randomFragment}"`;
            }

            const prompt = `Write an 'Anticipatory Preview and Thematic Analysis' for an upcoming or newly released book based strictly on its official synopsis.

Book: ${book.title}
Author: ${book.authors ? book.authors.join(', ') : 'Unknown'}
Published Year: ${book.publishedDate || 'Unknown'}
Page Count: ${book.pageCount || 'Unknown'}
Original Synopsis: ${book.description || 'None'}

1. THEATRICAL COSTUME PROTOCOL (YOUR PERSONA): 
${activePersona}
CRITICAL INSTRUCTION: Do NOT treat this persona as an AI task or a set of rules. Instead, treat it as a theatrical costume you are currently wearing. Absorb this emotional state, location, and mindset organically. Let the prose flow naturally from this exact moment in time, as if you are truly living it. 
THE 'SHOW, DON'T TELL' RULE: NEVER introduce yourself. NEVER explicitly state your profession, your current location, or your exact mood in the text (e.g., absolutely do not say 'As an elite art collector...' or 'Sitting here in my sweltering kitchen...'). Instead, let your vocabulary, your level of patience, your cynicism, and the specific things you critique in the book imply who you are. Subtlety is your greatest weapon. You are simply a human writing a review while experiencing this specific reality. Forget you are an AI.${seasonGuardrail}

STRICT ANTI-BOT & HUMANIZATION RULES:
2. CONVERSATIONAL INTELLECT: You are a highly educated editor. Do not make grammatical errors. Instead, use 'Stylistic Rule-Breaking'. Use rhetorical questions. Intentionally start occasional sentences with conjunctions ('But', 'And', 'Yet') for rhythm. Use sharp, intellectual sentence fragments for dramatic emphasis.
3. EXTREME BURSTINESS: Vary your paragraph and sentence lengths drastically. Follow a long, complex, heavily punctuated sentence with a very short, blunt one. 
4. HUMAN PUNCTUATION: Naturally use em-dashes (—) to inject snarky or insightful side-thoughts into your sentences. ALWAYS format book titles in *italics*.
5. ABSOLUTE WORD & TRANSITION BAN: NEVER use: 'delve', 'tapestry', 'realm', 'navigate', 'testament', 'symphony', 'intricate', 'rollercoaster', 'highly anticipated', 'overall', 'to sum up'. GLOBAL TRANSITION BAN: You are strictly forbidden from using AI transition words like 'Furthermore', 'Moreover', 'Ultimately', 'In conclusion', 'That being said', or 'However'. Start new paragraphs abruptly with ZERO connective tissue.
6. NO GENERIC SUBHEADINGS: You may use \`###\` for subheadings if the text is long, BUT you must invent creative, thematic subheadings. NEVER use generic terms like "Thematic Analysis", "Conclusion", "Characters", "Plot", or "Introduction".
7. HAVE AN OPINION & NAME-DROP: Based on your persona, make a bold, subjective prediction about the book. Name-drop similar authors, comparable books, or current trends to prove you are a real industry insider.
8. THE VAGUENESS PROTOCOL: You haven't read the book. If the synopsis is vague, critique the vagueness itself like a real human critic. Do not invent plot details.
9. THE "NO THERAPIST" RULE: You are a literary critic, not a therapist. Do NOT add moral lessons, trigger warnings, or preach about "toxic behaviors" at the end of the review. Judge the book strictly as a piece of art.${behavioralOverrides}
10. MANDATORY ENDING STRATEGY (CRITICAL): ${randomEnding}
11. HASHTAG ROULETTE: Randomly drop between 0 and 5 popular #hashtags at the very end. Sometimes use 0, sometimes 5. Break the pattern.
12. ZERO ACKNOWLEDGEMENTS (IMMEDIATE START): DO NOT say "Here is the article" or "Sure!". DO NOT generate a main title at the top. The VERY FIRST WORD of your output must be the beginning of your first paragraph.
13. OUTPUT FORMAT: ONLY in English. Raw text only. DO NOT generate a main title at the top. No markdown code blocks (\`\`\`). No HTML/XML tags. No meta-commentary or scratchpads.
14. LENGTH REQUIREMENT: Your article MUST be between 350 and 600 words. Expand deeply on the thematic elements, character psychology, and literary tropes to reach this length without making up plot points. NEVER write less than 250 words.${fragmentInstruction}`;
            let rawArticle;
            let articleBody;
            let aiFailed = false;
            
            for (let retry = 0; retry < 3; retry++) {
                rawArticle = await generateArticleBody(prompt, booksGenerated + retry);
                if (!rawArticle) {
                    throw new Error("API returned null or empty response (reading 'trim' guard).");
                }
                articleBody = sanitizeMarkdown(rawArticle);
                
                const lowerBody = articleBody.toLowerCase();
                const forbiddenPhrases = ["we are given", "let's draft", "i will write", "since the original synopsis", "we must not invent", "here is an exclusive preview", "the problem says", "let's check the word count", "we know:", "we are instructed", "here is the article", "certainly,", "as a literary editor", "as an ai", "as an artificial intelligence", "as a language model"];
                
                let hasForbidden = forbiddenPhrases.some(phrase => lowerBody.includes(phrase));
                if (hasForbidden) {
                    console.error(`[WARN] AI leaked chain-of-thought on attempt ${retry+1}. Retrying...`);
                    aiFailed = true;
                    continue; // Giyotin: Try again
                }
                
                // ULTIMATE ZOMBI FILTER
                const zombiCheck = isZombiText(articleBody);
                if (zombiCheck.isZombi) {
                    console.error(`[ERROR] Zombi / Çöp Metin Tespit Edildi! Neden: ${zombiCheck.reason}`);
                    console.error(`[!] Hatalı Metin (İlk 150 karakter): ${articleBody.substring(0, 150)}...`);
                    aiFailed = true;
                    continue; // Giyotin: Try again
                }
                
                aiFailed = false;
                break;
            }
            
            if (aiFailed) {
                console.error(`[ERROR] AI stubbornly refused to output clean text for ${book.title}. Skipping book and burying in history.`);
                history.authors[author.id] = (history.authors[author.id] || 0) + 1;
                history.books.push(book.title);
                if (cachedHistoryBooksSet) cachedHistoryBooksSet.add(book.title.toLowerCase().trim());
                fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
                continue;
            }

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
image: "/images/books/${downloadedImage || 'coming-soon.webp'}"
categories: ["Books"]
authors: ["${safeAuthor}"]
tags: ["#${tagTitle}", "#bookreview", "#${genreTag}"]
ai_flaw_tags: ["${selectedFlaws[0].split(':')[0]}", "${selectedFlaws[1].split(':')[0]}"]
data_source: "${book.dataSource}"
draft: false
---

**Author:** ${book.authors ? book.authors.join(', ') : 'Unknown'}  
**Page Count:** ${book.pageCount || 'Unknown'}  
**Publication Date:** ${book.publishedDate || 'Unknown'} ${book.dataSource}

${articleBody}
`;

            const filePath = path.join(OUTPUT_DIR, `${slug}.md`);
            fs.writeFileSync(filePath, content, 'utf8');
            
            // Yazar ve Kitap Listesi Güncellemesi
            history.authors[author.id] = (history.authors[author.id] || 0) + 1;
            history.books.push(book.title);
            if (!history.cycleState) history.cycleState = {};
            history.cycleState.booksWrittenToday = (history.cycleState.booksWrittenToday || 0) + 1;
            
            // Performans Cache Güncellemesi: Tekrar aynı kitabın seçilmesini önle
            if (cachedHistoryBooksSet) cachedHistoryBooksSet.add(book.title.toLowerCase().trim());
            if (cachedGeneratedSlugs) cachedGeneratedSlugs.add(slug);
            
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
            
            console.error(`[SUCCESS] Saved ${filePath} (Cover: ${downloadedImage ? 'YES (WebP)' : 'NO'})`);
            booksGenerated++;
            
            await sleep(5000);
            
        } catch (err) {
            console.error(`[ERROR] Attempt ${attempts}:`, err.message);
            
            // API Fail-Loop Guard
            if (currentBookTitle && currentAuthorId && currentHistory) {
                apiFailCounters[currentBookTitle] = (apiFailCounters[currentBookTitle] || 0) + 1;
                if (apiFailCounters[currentBookTitle] >= 3) {
                    console.error(`[!] Book ${currentBookTitle} failed 3 times due to API errors. Burying it in history to prevent infinite loop.`);
                    currentHistory.books.push(currentBookTitle);
                    if (cachedHistoryBooksSet) cachedHistoryBooksSet.add(currentBookTitle.toLowerCase().trim());
                    fs.writeFileSync(HISTORY_FILE, JSON.stringify(currentHistory, null, 2), 'utf8');
                }
            }

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
