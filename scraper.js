const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const MAX_BOOKS_PER_RUN = 5;
const MAX_CONSECUTIVE_ERRORS = 15;
const DATA_FILE = 'scraped_books.json';
const ERROR_LOG = 'error.log';
const SCREENSHOT_FILE = 'screenshot.png';

// Human-like sleep function
const sleep = (min, max) => {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`[Uyku] İnsan gibi davranılıyor. ${ms / 1000} saniye bekleniyor...`);
    return new Promise(resolve => setTimeout(resolve, ms));
};

// 1. Zombi Bot Başlangıç
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
        console.log(`Mevcut veri bulundu: ${scrapedBooks.length} kitap.`);
    }

    let consecutiveErrors = 0;
    let booksScrapedToday = 0;
    let currentPageUrl = 'https://www.goodreads.com/list/show/1.Best_Books_Ever'; // Örnek hedef liste

    while (booksScrapedToday < MAX_BOOKS_PER_RUN) {
        try {
            console.log(`Sayfaya gidiliyor: ${currentPageUrl}`);
            const response = await page.goto(currentPageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            
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
                        
                        // Örnek Rating text: "4.28 avg rating — 9,134,234 ratings"
                        const avgRatingMatch = ratingText.match(/([0-9.]+) avg rating/);
                        const ratingsCountMatch = ratingText.match(/— ([0-9,]+) ratings/);
                        
                        const avgRating = avgRatingMatch ? parseFloat(avgRatingMatch[1]) : 0;
                        const ratingCount = ratingsCountMatch ? parseInt(ratingsCountMatch[1].replace(/,/g, ''), 10) : 0;
                        
                        results.push({ title, author, avgRating, ratingCount });
                    }
                });
                return results;
            });

            console.log(`Bu sayfada ${booksOnPage.length} potansiyel kitap bulundu. Çöp filtreleri uygulanıyor...`);

            // Çöp Filtreleri (Trash Filter)
            for (const b of booksOnPage) {
                if (booksScrapedToday >= MAX_BOOKS_PER_RUN) break;

                // Kalite Filtreleri
                if (b.avgRating >= 3.6 && b.ratingCount >= 1000) {
                    // Mükemmel! Havuza ekle
                    scrapedBooks.push(b);
                    booksScrapedToday++;
                    console.log(`[+] ALTIN KİTAP EKLENDİ: ${b.title} (${b.avgRating} Puan / ${b.ratingCount} Oy)`);
                } else {
                    console.log(`[-] Çöp Kitap Elendi: ${b.title}`);
                }
            }

            // Başarılı olduk, hata sayacını sıfırla
            consecutiveErrors = 0;
            
            // Veriyi kaydet
            fs.writeFileSync(DATA_FILE, JSON.stringify(scrapedBooks, null, 2));

            // Sonraki sayfayı bul
            const nextButton = await page.$('a.next_page');
            if (nextButton) {
                // Sayfayı kaydır, biraz insan gibi bekle ve tıkla
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                await sleep(2000, 5000);
                
                const href = await page.evaluate(el => el.href, nextButton);
                currentPageUrl = href;
                
                // Mola (İnsan Taklidi: 15-45 saniye arası kahve molası)
                await sleep(15000, 45000);
            } else {
                console.log("Sonraki sayfa bulunamadı. Liste bitti.");
                break;
            }

        } catch (error) {
            consecutiveErrors++;
            console.error(`❌ HATA ALINDI (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error.message}`);
            
            // AUTO-KILL SWITCH (ACİL DURUM FRENİ)
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error("🚨 ACİL DURUM FRENİ ÇEKİLDİ! Peş peşe 15 hata alındı.");
                
                // Olay Yeri İnceleme
                await page.screenshot({ path: SCREENSHOT_FILE, fullPage: true });
                fs.writeFileSync(ERROR_LOG, `[${new Date().toISOString()}] AUTO-KILL TETİKLENDİ.\nSon Hata: ${error.message}\nSayfa: ${currentPageUrl}`);
                
                console.log(`Ekran görüntüsü '${SCREENSHOT_FILE}' olarak kaydedildi.`);
                await browser.close();
                process.exit(1); // Güvenli kapanış, otomasyon başarısız sayılacak ve email atacak.
            }
            
            // Hata sonrası ufak bir şaşkınlık beklemesi
            await sleep(10000, 20000);
        }
    }

    console.log(`✅ Zombi Bot Günlük Mesaisini Tamamladı! Bugün ${booksScrapedToday} kitap çekildi.`);
    await browser.close();
}

runBot();
