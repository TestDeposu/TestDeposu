import fs from 'fs';
import path from 'path';

const searchDir = path.join(process.cwd(), 'books-2026');

const forbiddenPhrases = [
    "<think>",
    "we are given:",
    "let's draft",
    "i will write",
    "since the original synopsis",
    "we must not invent",
    "here is an exclusive preview",
    "the problem says",
    "let's check the word count"
];

function scanDirectory(dir) {
    let brokenFiles = [];
    if (!fs.existsSync(dir)) return brokenFiles;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            brokenFiles = brokenFiles.concat(scanDirectory(fullPath));
        } else if (file.endsWith('.md')) {
            const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
            const foundPhrases = forbiddenPhrases.filter(phrase => content.includes(phrase));
            
            if (foundPhrases.length > 0) {
                brokenFiles.push({
                    file: fullPath.replace(process.cwd(), ''),
                    phrases: foundPhrases
                });
            }
        }
    }
    return brokenFiles;
}

console.log("Tarama başlıyor... Lütfen bekleyin.");
const results = scanDirectory(searchDir);

if (results.length === 0) {
    console.log("Harika haber! Hiçbir bozuk veya yapay zeka sızıntısı olan dosya bulunamadı.");
} else {
    console.log(`\n[DİKKAT] ${results.length} adet bozuk dosya tespit edildi:\n`);
    results.forEach(res => {
        console.log(`Dosya: ${res.file}`);
        console.log(`Bulunan Sızıntılar: ${res.phrases.join(', ')}\n`);
    });
}
