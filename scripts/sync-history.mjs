import fs from 'fs';
import path from 'path';

// Varsayılan olarak proje kök dizinindeki book_history.json
const HISTORY_FILE = path.join(process.cwd(), 'book_history.json');

// Sizin bilgisayarınızdaki (plate-and-prose içindeki) markdown dosyalarının bulunduğu klasör yolu
// İhtiyaca göre bu yolu değiştirebilirsiniz. Örnek: '../plate-and-prose/src/content/books'
const BOOKS_DIR = process.argv[2] || path.join(process.cwd(), 'src/content/books');

async function runSync() {
    console.log(`[SYNC] Mükemmel Senkronizasyon Aracı Başlatıldı...`);
    
    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`[HATA] ${HISTORY_FILE} bulunamadı!`);
        process.exit(1);
    }

    if (!fs.existsSync(BOOKS_DIR)) {
        console.error(`[HATA] ${BOOKS_DIR} klasörü bulunamadı! Lütfen yolu doğru verin (Örn: node sync-history.mjs ../plate-and-prose/src/content/books)`);
        process.exit(1);
    }

    const historyData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    
    // Markdown dosyalarını tarayalım
    const files = fs.readdirSync(BOOKS_DIR).filter(f => f.endsWith('.md'));
    console.log(`[SYNC] ${BOOKS_DIR} içinde ${files.length} adet .md dosyası bulundu.`);

    let addedCount = 0;
    
    for (const file of files) {
        const filePath = path.join(BOOKS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Markdown içinden 1. başlığı (# Kitap Adı) bulalım
        const match = content.match(/^#\s+(.+)$/m);
        if (match && match[1]) {
            const title = match[1].trim();
            const isAlreadyInHistory = historyData.books.some(b => b.toLowerCase().trim() === title.toLowerCase().trim());
            
            if (!isAlreadyInHistory) {
                historyData.books.push(title);
                addedCount++;
                console.log(`[+] Eklendi: ${title}`);
            }
        }
    }

    if (addedCount > 0) {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2), 'utf8');
        console.log(`[BAŞARILI] Toplam ${addedCount} yeni kitap book_history.json dosyasına eklendi ve senkronize edildi!`);
    } else {
        console.log(`[BİLGİ] Her şey zaten güncel. book_history.json dosyasına eklenecek yeni kitap bulunamadı.`);
    }
}

runSync();
