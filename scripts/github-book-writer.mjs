import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Load APIs from environment variables (Provided by GitHub Secrets)
const AUTHORS_FILE = path.join(process.cwd(), 'book_authors.json');
const HISTORY_FILE = path.join(process.cwd(), 'book_history.json');
const SCRAPED_BOOKS_FILE = path.join(process.cwd(), 'scraped_books.json');

// Date formatting for the daily output folder
const today = new Date();
const dateStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
const OUTPUT_DIR = path.join(process.cwd(), `generated-${dateStr}`);

// Create the output directory for today's generations
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Utility for sleeping (rate-limit prevention)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// AI Engine Integrations
async function fetchFromNvidia(prompt) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error("NVIDIA_API_KEY is missing");
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'meta/llama-3.1-70b-instruct', messages: [{ role: 'user', content: prompt }], max_tokens: 1500, temperature: 0.7 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "NVIDIA API Error");
    return data.choices[0].message.content;
}

async function fetchFromGroq(prompt) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is missing");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], max_tokens: 1500 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Groq Error");
    return data.choices[0].message.content;
}

async function fetchFromMistral(prompt) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY is missing");
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: prompt }], max_tokens: 1500 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Mistral Error");
    return data.choices[0].message.content;
}

async function fetchFromSambaNova(prompt) {
    const apiKey = process.env.SAMBANOVA_API_KEY;
    if (!apiKey) throw new Error("SAMBANOVA_API_KEY is missing");
    const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'Meta-Llama-3.3-70B-Instruct', messages: [{ role: 'user', content: prompt }], max_tokens: 1500, temperature: 0.7 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "SambaNova Error");
    return data.choices[0].message.content;
}

async function generateArticleBody(prompt, apiIndex = 0) {
    const apis = [
        { name: 'Nvidia', fn: fetchFromNvidia },
        { name: 'Mistral', fn: fetchFromMistral },
        { name: 'Groq', fn: fetchFromGroq },
        { name: 'SambaNova', fn: fetchFromSambaNova }
    ];
    
    const primaryIndex = apiIndex % 4;
    console.log(`[AI] Attempting ${apis[primaryIndex].name}...`);
    try {
        return await apis[primaryIndex].fn(prompt);
    } catch (e1) {
        console.warn(`[WARN] ${apis[primaryIndex].name} failed: ${e1.message}. Falling back...`);
        const fallbackIndex = (primaryIndex + 1) % 4;
        try {
            return await apis[fallbackIndex].fn(prompt);
        } catch (e2) {
            console.warn(`[WARN] ${apis[fallbackIndex].name} failed: ${e2.message}. 2nd Fallback...`);
            const fallbackIndex2 = (primaryIndex + 2) % 4;
            return await apis[fallbackIndex2].fn(prompt);
        }
    }
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

function selectBookFromScrapedData(history) {
    if (!fs.existsSync(SCRAPED_BOOKS_FILE)) {
        throw new Error("scraped_books.json bulunamadı. Lütfen Zombi Botu çalıştırın.");
    }
    
    const scrapedBooks = JSON.parse(fs.readFileSync(SCRAPED_BOOKS_FILE, 'utf8'));
    const historyBooksLower = history.books.map(b => b.toLowerCase().trim());
    
    // Filtreleme: Daha önce yazılmış kitapları ele
    let freshBooks = scrapedBooks.filter(b => !historyBooksLower.includes(b.title.toLowerCase().trim()));
    
    if (freshBooks.length === 0) {
        throw new Error("Havuzdaki tüm kitaplar yazılmış. Zombi Botun yeni kitaplar kazıması gerekiyor.");
    }

    const randomIndex = Math.floor(Math.random() * freshBooks.length);
    return freshBooks[randomIndex];
}

async function fetchBookData(author) {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const suggestion = selectBookFromScrapedData(history);
    console.log(`[INFO] Scraped Listesinden Seçildi: ${suggestion.title} by ${suggestion.author}`);
    
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
    console.log("Starting GitHub Book Writer with Sharp (WebP) & 4-Stage Cover Engine...");
    let booksGenerated = 0;
    let attempts = 0;
    
    while (booksGenerated < 30 && attempts < 100) {
        attempts++;
        try {
            console.log(`\n--- Generation Attempt ${attempts} (Success: ${booksGenerated}/30) ---`);
            const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            const author = getNextAuthor(history);
            
            const book = await fetchBookData(author);
            console.log(`[INFO] Book: ${book.title}`);
            
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
            const slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            
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
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
            
            console.log(`[SUCCESS] Saved ${filePath} (Cover: ${downloadedImage ? 'YES (WebP)' : 'NO'})`);
            booksGenerated++;
            
            await sleep(5000);
            
        } catch (err) {
            console.error(`[ERROR] Attempt ${attempts}:`, err.message);
            if (err.message && err.message.includes("429")) {
                console.log("Rate limit hit. Exiting loop safely so action can commit.");
                break;
            }
            await sleep(3000);
        }
    }
    console.log(`[FINISH] Generated ${booksGenerated} books in ${attempts} attempts.`);
    process.exit(0); 
}

runBot();
