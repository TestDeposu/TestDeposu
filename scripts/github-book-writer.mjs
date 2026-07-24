import fs from 'fs';
import path from 'path';

// Load APIs from environment variables (Provided by GitHub Secrets)
const AUTHORS_FILE = path.join(process.cwd(), 'book_authors.json');
const HISTORY_FILE = path.join(process.cwd(), 'book_history.json');

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

async function downloadImage(imageUrl, slug) {
    if (!imageUrl || !imageUrl.startsWith('http')) return imageUrl;
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) return imageUrl;
        const buffer = await res.arrayBuffer();
        const ext = imageUrl.toLowerCase().includes('.png') ? '.png' : '.jpg';
        const filename = `${slug}${ext}`;
        // Save the image directly into the daily folder alongside the .md file
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), Buffer.from(buffer));
        return filename; 
    } catch (e) {
        return imageUrl;
    }
}

function getNextAuthor(history) {
    const authors = JSON.parse(fs.readFileSync(AUTHORS_FILE, 'utf8'));
    authors.sort((a, b) => (history.authors[a.id] || 0) - (history.authors[b.id] || 0));
    return authors[0];
}

async function getFamousBookSuggestionFromAI(genre, history) {
    const isNewBook = Math.random() < 0.5;
    const prompt = isNewBook 
        ? `You are a literature expert. I need 1 highly anticipated or newly released blockbuster bestseller book in the genre of "${genre}" that was published in 2025 or 2026. It must be a widely known or highly expected book.
Do NOT suggest any of these books: ${history.books.slice(-500).join(', ')}
Respond ONLY with the exact book title and the author's name, separated by a pipe character "|".
Example output: The Winds of Winter | George R. R. Martin`
        : `You are a literature expert. I need 1 globally famous, universally known, blockbuster bestseller book in the genre of "${genre}" that has sold millions of copies.
Do NOT suggest any of these books: ${history.books.slice(-500).join(', ')}
Respond ONLY with the exact book title and the author's name, separated by a pipe character "|".
Example output: The Da Vinci Code | Dan Brown`;

    let result = await generateArticleBody(prompt, Math.floor(Math.random() * 4));
    result = result.replace(/\*/g, '').replace(/"/g, '').replace(/'/g, '').trim();
    const parts = result.split('|').map(s => s.trim());
    if (parts.length < 2) return { title: result.split('\n')[0].trim(), author: "" };
    return { title: parts[0], author: parts[1] };
}

async function fetchBookData(author) {
    const baseGenre = author.genre.split(' ')[0];
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    
    const suggestion = await getFamousBookSuggestionFromAI(baseGenre, history);
    console.log(`[INFO] AI Suggested: ${suggestion.title}`);
    
    // Zombi bot tarafindan daha once uretilip uretilmedigini "book_history.json" uzerinden kontrol ediyoruz
    const isAlreadyWritten = history.books.some(b => b.toLowerCase() === suggestion.title.toLowerCase());
    if (isAlreadyWritten) {
        throw new Error(`Kitap zaten daha once (Zombi Bot tarafindan) yazilmis: ${suggestion.title}. Tekrar uretilmeyecek.`);
    }
    
    let doc = null;
    let dataSource = "OpenLibrary";
    
    // Try PRH first if API key is provided
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
                    let onsale = 'Unknown';
                    let coverHref = null;
                    if (workRes.ok) {
                        const workData = await workRes.json();
                        if (workData && workData.data && workData.data.works && workData.data.works.length > 0) {
                            onsale = workData.data.works[0].onsale ? workData.data.works[0].onsale.split('-')[0] : 'Unknown';
                            const iconLink = (workData.data.works[0]._links || []).find(l => l.rel === 'icon');
                            if (iconLink) coverHref = iconLink.href;
                        }
                    }
                    doc = {
                        title: prhWork.name,
                        author_name: prhWork.author ? [prhWork.author[0].split('|')[1]] : ['Unknown'],
                        first_publish_year: onsale,
                        number_of_pages_median: 'Unknown',
                        description: prhWork.description ? prhWork.description[0] : "None",
                        cover_i: coverHref ? `PRH_URL_${coverHref}` : null 
                    };
                    dataSource = "Penguin Random House";
                }
            }
        }
    } catch(e) { /* ignore */ }

    // Fallback to OpenLibrary API
    if (!doc) {
        dataSource = "OpenLibrary";
        const query = `title:"${suggestion.title}"`;
        const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1`;
        let res = await fetch(url);
        if (res.status === 429) { await sleep(15000); res = await fetch(url); }
        if (res.ok) {
            const data = await res.json();
            if (data.docs && data.docs.length > 0) doc = data.docs[0];
        }
        
        if (!doc) {
            const fbUrl = `https://openlibrary.org/search.json?q=subject:"${baseGenre}"+AND+"New York Times Bestseller"&limit=5`;
            const fbRes = await fetch(fbUrl);
            if (fbRes.ok) {
                const fbData = await fbRes.json();
                if (fbData.docs && fbData.docs.length > 0) doc = fbData.docs[0];
            }
        }
        
        if (doc) {
            try {
                const workRes = await fetch(`https://openlibrary.org${doc.key}.json`);
                if (workRes.ok) {
                    const workData = await workRes.json();
                    doc.description = workData.description ? (typeof workData.description === 'string' ? workData.description : workData.description.value) : 'None';
                }
            } catch(e) {}
        }
    }

    if (!doc) throw new Error("Could not fetch any book data.");

    let coverThumbnail = null;
    if (doc.cover_i && doc.cover_i.toString().startsWith('PRH_URL_')) {
        coverThumbnail = doc.cover_i.toString().replace('PRH_URL_', '');
    } else if (doc.cover_i) {
        coverThumbnail = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
    }

    return {
        title: doc.title || suggestion.title,
        authors: doc.author_name || [suggestion.author],
        publishedDate: doc.first_publish_year ? doc.first_publish_year.toString() : 'Unknown',
        pageCount: doc.number_of_pages_median ? doc.number_of_pages_median.toString() : 'Unknown',
        description: doc.description || 'None',
        imageLinks: coverThumbnail ? { thumbnail: coverThumbnail } : null,
        dataSource: dataSource
    };
}

// Custom Date logic: Protects against creating paradoxes by ensuring review date >= publish date.
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
    
    // If the book is coming out strictly after our time window, push the date slightly ahead of its release.
    if (baseMinTs >= endTs) {
        return new Date(baseMinTs + (Math.random() * 30 * 24 * 60 * 60 * 1000));
    }
    
    const randomTs = baseMinTs + Math.random() * (endTs - baseMinTs);
    return new Date(randomTs);
}

async function runBot() {
    console.log("Starting GitHub Book Writer...");
    let booksGenerated = 0;
    
    for (let i = 0; i < 30; i++) {
        try {
            console.log(`\n--- Generation ${i+1} ---`);
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
            
            const rawArticle = await generateArticleBody(prompt, i);
            const articleBody = sanitizeMarkdown(rawArticle);

            const slug = book.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            let rawImage = book.imageLinks ? book.imageLinks.thumbnail : null;
            if (rawImage && rawImage.startsWith('http:')) rawImage = rawImage.replace('http:', 'https:');
            
            const downloadedImage = await downloadImage(rawImage, slug);
            
            const safeTitle = book.title.replace(/"/g, "'");
            const safeAuthor = author.name.replace(/"/g, "'");
            const tagTitle = slug.substring(0, 20).replace(/-$/, '');
            const genreTag = author.genre.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            const sourceAbbr = book.dataSource === 'Penguin Random House' ? 'PRH' : 'OL';
            
            const content = `---
title: "${safeTitle} Book Review and Summary"
meta_title: "${safeTitle} Book Review | ${safeAuthor}"
description: "Everything you need to know about ${safeTitle} with our detailed review."
date: ${publishDate.toISOString()}
image: "/images/books/${downloadedImage || 'default.jpg'}"
categories: ["Books"]
authors: ["${safeAuthor}"]
tags: ["#${tagTitle}", "#bookreview", "#${genreTag}"]
data_source: "${book.dataSource}"
draft: false
---

# ${book.title}

**Author:** ${book.authors ? book.authors.join(', ') : 'Unknown'}  
**Page Count:** ${book.pageCount || 'Unknown'}  
**Publication Date:** ${book.publishedDate || 'Unknown'}-${sourceAbbr}

${articleBody}
`;

            const filePath = path.join(OUTPUT_DIR, `${slug}.md`);
            fs.writeFileSync(filePath, content, 'utf8');
            
            history.authors[author.id] = (history.authors[author.id] || 0) + 1;
            history.books.push(book.title);
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
            
            console.log(`[SUCCESS] Saved ${filePath}`);
            booksGenerated++;
            
            await sleep(5000);
            
        } catch (err) {
            console.error(`[ERROR] Loop ${i+1}:`, err.message);
            if (err.message && err.message.includes("429")) {
                console.log("Rate limit hit. Exiting loop safely so action can commit.");
                break;
            }
        }
    }
    console.log(`[FINISH] Generated ${booksGenerated} books.`);
    process.exit(0); // Exit successfully so Action continues
}

runBot();
