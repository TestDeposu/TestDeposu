const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const MAX_BOOKS_PER_RUN = 1000;
const MAX_CONSECUTIVE_ERRORS = 15;
const DATA_FILE = 'scraped_books.json';
const ERROR_LOG = 'error.log';
const SCREENSHOT_FILE = 'screenshot.png';
const STATE_FILE = 'scraper_state.json';
const HISTORY_FILE = 'book_history.json';

// Dinamik Rota Haritasi (Farkli Türler)
const ROUTES = [
    'https://www.goodreads.com/list/show/1.Best_Books_Ever', // Karma
    'https://www.goodreads.com/list/show/50.The_Best_Epic_Fantasy_fiction', // Fantastik
    'https://www.goodreads.com/list/show/3.Best_Science_Fiction_Fantasy_Books', // Bilimkurgu
    'https://www.goodreads.com/list/show/15.Best_Historical_Fiction', // Tarih
    'https://www.goodreads.com/list/show/11.Best_Crime_Mystery_Books', // Polisiye/Gerilim
    'https://www.goodreads.com/list/show/123.Best_Romance_Books_Ever', // Romantik
    'https://www.goodreads.com/list/show/264.Books_That_Everyone_Should_Read_At_Least_Once' // Klasikler
];

// Human-like sleep function
const sleep = (min, max) => {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`[Uyku] İnsan gibi davranılıyor. ${ms / 1000} saniye bekleniyor...`);
    return new Promise(resolve => setTimeout(resolve, ms));
};

async function runBot() {
    console.log("🧟 Zombi Bot Uyandı. Ava çıkılıyor...");
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
    } catch (e) {
        fs.writeFileSync(ERROR_LOG, `Tarayıcı Başlatılamadı: ${e.message}`);
        console.error("Tarayıcı Başlatılamadı!", e);
        process.exit(1);
    }

    const page = await browser.newPage();
    
    // Rastgele User-Agent spoofing
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    
    let scrapedBooks = [];
    if (fs.existsSync(DATA_FILE)) {
        scrapedBooks = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        console.log(`[Hafıza] Mevcut kazınmış veri bulundu: ${scrapedBooks.length} kitap.`);
    }

    let historyBooks = [];
    if (fs.existsSync(HISTORY_FILE)) {
        const historyData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        if (historyData && historyData.books) {
            historyBooks = historyData.books.map(b => b.toLowerCase().trim());
        }
        console.log(`[Hafıza] Daha önce yazılmış (history) veri bulundu: ${historyBooks.length} kitap.`);
    }

    let state = { routeIndex: 0, currentUrl: ROUTES[0] };
    if (fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        console.log(`[Hafıza] Kaldığım yer bulundu: Rota ${state.routeIndex}, URL: ${state.currentUrl}`);
    }

    let consecutiveErrors = 0;
    let booksScrapedToday = 0;

    // hizli kontrol icin scrapedBooks basliklarini hash map/set yapalim
    const scrapedTitles = new Set(scrapedBooks.map(b => b.title.toLowerCase().trim()));

    while (booksScrapedToday < MAX_BOOKS_PER_RUN) {
        try {
            console.log(`Sayfaya gidiliyor: ${state.currentUrl}`);
            const response = await page.goto(state.currentUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            
            // Güvenlik Duvarı veya 403 kontrolü
            if (!response || response.status() === 403 || response.status() === 502) {
                throw new Error(`Cloudflare veya Sunucu Hatası: HTTP ${response ? response.status() : 'Bilinmiyor'}`);
            }

            // Sayfadaki kitap listesini çek
            const booksOnPage = await page.evaluate(() => {
                const results = [];
                const rows = document.querySelectorAll('tr[itemscope][itemtype="http://schema.org/Book"]');
                
                rows.forEach(row => {
                    const titleElement = row.querySelector('.bookTitle span[itemprop="name"]');
                    const authorElement = row.querySelector('.authorName span[itemprop="name"]');
                    const ratingElement = row.querySelector('.minirating');
                    
                    if (titleElement && authorElement && ratingElement) {
                        const title = titleElement.innerText.trim();
                        const author = authorElement.innerText.trim();
                        const ratingText = ratingElement.innerText.trim();
                        
                        const avgRatingMatch = ratingText.match(/([0-9.]+) avg rating/);
                        const ratingsCountMatch = ratingText.match(/— ([0-9,]+) ratings/);
                        
                        const avgRating = avgRatingMatch ? parseFloat(avgRatingMatch[1]) : 0;
                        const ratingCount = ratingsCountMatch ? parseInt(ratingsCountMatch[1].replace(/,/g, ''), 10) : 0;
                        
                        results.push({ title, author, avgRating, ratingCount });
                    }
                });
                return results;
            });

            console.log(`Bu sayfada ${booksOnPage.length} potansiyel kitap bulundu. Çöp ve Çakışma (Duplicate) filtreleri uygulanıyor...`);

            let addedFromThisPage = 0;

            for (const b of booksOnPage) {
                if (booksScrapedToday >= MAX_BOOKS_PER_RUN) break;

                const cleanTitle = b.title.toLowerCase().trim();

                // 1. Çakışma Filtresi: Daha önce Zombi Bot tarafından çekildi mi?
                if (scrapedTitles.has(cleanTitle)) {
                    continue; // Sessizce atla
                }

                // 2. Çakışma Filtresi: GitHub Bot tarafından sitemizde makalesi yazıldı mı?
                if (historyBooks.includes(cleanTitle)) {
                    continue; // Sessizce atla
                }

                // 3. Kalite Filtresi: Puanı yüksek mi?
                if (b.avgRating >= 3.6 && b.ratingCount >= 1000) {
                    scrapedBooks.push(b);
                    scrapedTitles.add(cleanTitle);
                    booksScrapedToday++;
                    addedFromThisPage++;
                    console.log(`[+] YENİ ALTIN KİTAP EKLENDİ: ${b.title} (${b.avgRating} Puan)`);
                }
            }

            console.log(`Bu sayfadan ${addedFromThisPage} adet %100 YENİ kitap çıkarıldı. (Toplam çekilen: ${booksScrapedToday}/${MAX_BOOKS_PER_RUN})`);

            consecutiveErrors = 0;
            
            // Veriyi kaydet
            fs.writeFileSync(DATA_FILE, JSON.stringify(scrapedBooks, null, 2));

            // Sonraki sayfayı bul
            const nextButton = await page.$('a.next_page');
            if (nextButton) {
                // Sayfayı kaydır, biraz insan gibi bekle
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                await sleep(2000, 5000);
                
                const href = await page.evaluate(el => el.href, nextButton);
                state.currentUrl = href;
                fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
                
                await sleep(15000, 45000);
            } else {
                console.log("Bu listenin sonuna gelindi. Rota haritasındaki sıradaki listeye geçiliyor...");
                state.routeIndex++;
                if (state.routeIndex >= ROUTES.length) {
                    console.log("🏆 BÜTÜN ROTA HARİTASI TAMAMLANDI! Başa sarılıyor...");
                    state.routeIndex = 0;
                }
                state.currentUrl = ROUTES[state.routeIndex];
                fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
                
                await sleep(15000, 30000);
            }

        } catch (error) {
            consecutiveErrors++;
            console.error(`❌ HATA ALINDI (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error.message}`);
            
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error("🚨 ACİL DURUM FRENİ ÇEKİLDİ! Peş peşe 15 hata alındı.");
                await page.screenshot({ path: SCREENSHOT_FILE, fullPage: true });
                fs.writeFileSync(ERROR_LOG, `[${new Date().toISOString()}] AUTO-KILL TETİKLENDİ.\nSon Hata: ${error.message}\nSayfa: ${state.currentUrl}`);
                console.log(`Ekran görüntüsü '${SCREENSHOT_FILE}' olarak kaydedildi.`);
                await browser.close();
                process.exit(1); 
            }
            
            await sleep(10000, 20000);
        }
    }

    console.log(`✅ Zombi Bot Günlük Mesaisini Tamamladı! Bugün ${booksScrapedToday} YENİ kitap çekildi.`);
    await browser.close();
}

runBot();
