const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const MAX_BOOKS_PER_RUN = 1000;
const MAX_CONSECUTIVE_ERRORS = 15;
const DATA_FILE = 'scraped_books2026.json';
const ERROR_LOG = 'error2026.log';
const SCREENSHOT_FILE = 'screenshot2026.png';
const STATE_FILE = 'scraper_state2026.json';
const HISTORY_FILE = 'book_history2026.json';

const MAX_PAGE_PER_LIST = 10; // Bir listede 10 sayfadan (1000 kitap) derine inme, sıradaki listeye geç

const ROUTES = [];

// 1. AŞAMA: 01 Eylül 2026'dan İtibaren 16 Aylık Gelecek Yayın Takvimi (Next.js Apollo Engine)
// Hedef: Eylül 2026 - Aralık 2027 arası çıkacak en popüler Big 5 / Bestseller kitaplar
let startYear = 2026;
let startMonth = 9; // 01 Eylül 2026
for (let i = 0; i < 16; i++) {
    ROUTES.push(`https://www.goodreads.com/book/popular_by_date/${startYear}/${startMonth}`);
    startMonth++;
    if (startMonth > 12) {
        startMonth = 1;
        startYear++; // Sonraki yıla devret
    }
}

// 2. AŞAMA: Özel Seçilmiş 2026 Gelecek Elit Listopia Katalogları (Sadece saf 2026 çıkacak listeleri)
ROUTES.push(
    "https://www.goodreads.com/list/show/231549.Can_t_Wait_Sci_Fi_Fantasy_of_2026_",
    "https://www.goodreads.com/list/show/240105.Anticipated_Literary_Fiction_2026",
    "https://www.goodreads.com/list/show/220720.2026_Debuts",
    "https://www.goodreads.com/list/show/222716.2026_Adult_Romance_Releases",
    "https://www.goodreads.com/list/show/226283.Romantasy_TBR_2026",
    "https://www.goodreads.com/list/show/222366.2026_LGBTQIA_Books",
    "https://www.goodreads.com/list/show/191460.2026_books_coming_soon",
    "https://www.goodreads.com/list/show/236720.September_2026_Most_Anticipated_Romance_Releases",
    "https://www.goodreads.com/list/show/223793.2026_Releases",
    "https://www.goodreads.com/list/show/221908.2026_YA_Releases"
);

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
        try {
            state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            console.log(`[Hafıza] Kaldığım yer bulundu: Rota ${state.routeIndex}, URL: ${state.currentUrl}`);
        } catch (e) {
            state = { routeIndex: 0, currentUrl: ROUTES[0] };
        }
    }

    // Güvenlik Kalkanı: Eğer kaydedilen rota haritanın ötesindeyse veya geçersizse başa sar
    if (!state.currentUrl || state.routeIndex >= ROUTES.length || state.routeIndex < 0) {
        console.log("[Hafıza] Rota tamamlanmış veya sınır dışı. Rota başa sarılıyor (0)...");
        state.routeIndex = 0;
        state.currentUrl = ROUTES[0];
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

            const isModernPopularByDate = state.currentUrl.includes('popular_by_date');

            // Eğer Modern Apollo GraphQL / Next.js sayfasıysa (popular_by_date)
            // 'Show more books' butonuna basarak tüm aylık bülteni yükle
            if (isModernPopularByDate) {
                console.log(`[Apollo Engine] 'Show more books' butonları taranıyor ve tüm aylık liste yükleniyor...`);
                for (let i = 0; i < 10; i++) {
                    const buttons = await page.$$('button');
                    let moreBtn = null;
                    for (const b of buttons) {
                        const txt = await page.evaluate(el => el.innerText, b).catch(() => '');
                        if (txt && txt.toLowerCase().includes('show more books')) {
                            moreBtn = b;
                            break;
                        }
                    }
                    if (moreBtn) {
                        console.log(`[Apollo] 'Show more books' tıklandı (${i + 1}/10)...`);
                        await page.evaluate(el => el.scrollIntoView(), moreBtn);
                        await moreBtn.click().catch(() => {});
                        await sleep(2000, 3500);
                    } else {
                        console.log(`[Apollo] Listenin sonuna ulaşıldı veya buton kalmadı.`);
                        break;
                    }
                }
            }

            // Sayfadaki kitap listesini çek (Hem Apollo Next.js hem Klasik Listopia Uyumlu)
            const booksOnPage = await page.evaluate(() => {
                const results = [];

                // 1. Next.js Apollo BookListItem elementleri (popular_by_date)
                const modernItems = document.querySelectorAll('article.BookListItem');
                if (modernItems && modernItems.length > 0) {
                    modernItems.forEach(item => {
                        const titleEl = item.querySelector('a[data-testid="bookTitle"]');
                        const authorEl = item.querySelector('span[data-testid="name"]');
                        const ratingEl = item.querySelector('.AverageRating__ratingValue');
                        const ratingCountEl = item.querySelector('span[data-testid="ratingsCount"]');

                        if (titleEl && authorEl) {
                            const title = titleEl.innerText.trim();
                            const author = authorEl.innerText.trim();
                            const avgRating = ratingEl ? parseFloat(ratingEl.innerText.trim()) : 0;
                            let ratingCount = 0;
                            if (ratingCountEl) {
                                const m = ratingCountEl.innerText.match(/([0-9,]+)\s+rating/i);
                                if (m) ratingCount = parseInt(m[1].replace(/,/g, ''), 10);
                            }

                            // popular_by_date listesi doğrudan Goodreads'in en popüler/en çok beklenen listesidir
                            const addedByCount = 500;
                            const votersCount = 50;
                            const listopiaScore = 500;

                            results.push({ title, author, avgRating, ratingCount, addedByCount, votersCount, listopiaScore });
                        }
                    });
                    return results;
                }

                // 2. Klasik Listopia tr satırları
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
                        
                        // Extract "added by X people", "score: X", "Y people voted" for Hype Score
                        let addedByCount = 0;
                        let votersCount = 0;
                        let listopiaScore = 0;
                        
                        const smallTextElements = row.querySelectorAll('.smallText.uitext');
                        smallTextElements.forEach(el => {
                            const text = el.innerText;
                            const addedMatch = text.match(/added by ([0-9,]+) people/i);
                            if (addedMatch) {
                                addedByCount = parseInt(addedMatch[1].replace(/,/g, ''), 10);
                            }
                            const votedMatch = text.match(/([0-9,]+)\s+(?:people|person)\s+voted/i);
                            if (votedMatch) {
                                votersCount = parseInt(votedMatch[1].replace(/,/g, ''), 10);
                            }
                            const scoreMatch = text.match(/score:\s*([0-9,]+)/i);
                            if (scoreMatch) {
                                listopiaScore = parseInt(scoreMatch[1].replace(/,/g, ''), 10);
                            }
                        });
                        
                        results.push({ title, author, avgRating, ratingCount, addedByCount, votersCount, listopiaScore });
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

                // 3. ÇIKMIŞ KİTAP ENGELİ (Anti-Published Shield)
                // Piyasaya çıkmamış 2026 kitaplarının Goodreads'te binlerce değerlendirmesi olamaz.
                // Erken okuma (ARC) kopyaları en fazla birkaç yüz değerlendirme alır.
                // Eğer bir kitabın 1.000'den fazla değerlendirmesi varsa, o kitap geçmişte ÇIKMIŞ ESKİ KİTAPTIR!
                if (b.ratingCount && b.ratingCount > 1000) {
                    continue; // 2010, 1997 gibi çıkmış eski kitapları doğrudan ele!
                }

                // 4. Kalite / Hype Filtresi (Yalnızca 2026'da ÇIKACAK Elit Kitaplar)
                const isMonthly = state.currentUrl.includes('popular_by_date') || state.currentUrl.includes('legacy_popular_by_date');
                let isQualityPassed = false;

                if (isMonthly) {
                    // Aylık Gelecek Yayın Listelerinde: En az 300 kişi listesine eklemiş olmalı (Big 5 Yayınevi Eşiği)
                    isQualityPassed = (b.addedByCount && b.addedByCount >= 300);
                } else {
                    // Listopia Sayfalarında: Yalnızca yüksek beklentisi olan 2026 kitapları
                    // Kural 1: En az 10 kişi "Bekliyorum" diye oy vermiş olmalı VE Listopia puanı >= 250 olmalı
                    // Kural 2: VEYA Listopia puanı tek başına >= 500 ve en az 5 kişi oy vermiş olmalı
                    const meetsCommunity = (b.votersCount >= 10 && b.listopiaScore >= 250);
                    const meetsHighScore = (b.listopiaScore >= 500 && b.votersCount >= 5);
                    const meetsAddedBy = (b.addedByCount >= 300);

                    isQualityPassed = (meetsCommunity || meetsHighScore || meetsAddedBy);
                }

                if (!isQualityPassed) {
                    continue; // 800 milyonluk hedef kitleye uymayan, düşük oylu çöp kitapları atla
                }

                // 5. Alfabe/Spam Filtresi: Çince, Japonca, Kiril vb. garip karakterleri atla
                if (/[^\x00-\x7F]/.test(cleanTitle) && cleanTitle.length > 30) {
                     // Sadece latin karakter olmayan ve uzun olanları ele
                     // continue;
                }

                scrapedBooks.push(b);
                scrapedTitles.add(cleanTitle);
                booksScrapedToday++;
                addedFromThisPage++;
                const hypeInfo = b.addedByCount > 0 ? `${b.addedByCount} kişi eklemiş` : `${b.votersCount} oy, ${b.listopiaScore} puan`;
                console.log(`[+] YENİ ELİT KİTAP EKLENDİ: ${b.title} (${hypeInfo})`);
            }

            console.log(`Bu sayfadan ${addedFromThisPage} adet %100 YENİ kitap çıkarıldı. (Toplam çekilen: ${booksScrapedToday}/${MAX_BOOKS_PER_RUN})`);

            consecutiveErrors = 0;
            
            // Veriyi kaydet
            fs.writeFileSync(DATA_FILE, JSON.stringify(scrapedBooks, null, 2));

            // Sonraki sayfayı bul veya sonraki listeye geç
            let shouldAdvanceToList = false;

            if (isModernPopularByDate) {
                // popular_by_date sayfalarında 'Show more books' ile tüm ay zaten çekildi, sıradaki aya/listeye geç
                shouldAdvanceToList = true;
            } else {
                const nextButton = await page.$('a.next_page');

                if (nextButton) {
                    const href = await page.evaluate(el => el.href, nextButton);
                    
                    // Derinlik Kontrolü: 10. sayfayı geçmişse dur, sıradaki listeye geç
                    const pageMatch = href.match(/page=(\d+)/);
                    if (pageMatch && parseInt(pageMatch[1], 10) > MAX_PAGE_PER_LIST) {
                        console.log(`[Derinlik Kalkanı] Listenin ilk ${MAX_PAGE_PER_LIST} sayfası tarandı (kaymak tabaka alındı). Sıradaki 2026 listesine geçiliyor...`);
                        shouldAdvanceToList = true;
                    } else {
                        // Sayfayı kaydır, biraz insan gibi bekle
                        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                        await sleep(2000, 5000);
                        
                        state.currentUrl = href;
                        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
                        await sleep(15000, 35000);
                    }
                } else {
                    shouldAdvanceToList = true;
                }
            }

            if (shouldAdvanceToList) {
                console.log("Bu listenin sonuna gelindi veya sınır doldu. Rota haritasındaki sıradaki listeye geçiliyor...");
                state.routeIndex++;
                if (state.routeIndex >= ROUTES.length) {
                    console.log("🏆 BÜTÜN ROTA HARİTASI TAMAMLANDI! Rota başa sarılıyor (0)...");
                    state.routeIndex = 0;
                    state.currentUrl = ROUTES[0];
                    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
                    break; // Bu koşu tamamlandı, sonraki tetiklenmede baştan başlayacak
                }
                state.currentUrl = ROUTES[state.routeIndex];
                fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
                
                await sleep(5000, 15000);
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
