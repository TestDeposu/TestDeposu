import fetch from 'node-fetch';

async function testOpenRouter() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.error("HATA: OPENROUTER_API_KEY bulunamadı!");
        console.error("Lütfen terminalde çalıştırmadan önce key'i tanımlayın.");
        process.exit(1);
    }

    console.log("OpenRouter'a bağlanılıyor...");

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "meta-llama/llama-3-8b-instruct:free",
                "messages": [
                    {
                        "role": "user", 
                        "content": "Lütfen bana kitap okumanın faydaları hakkında tam olarak 100 kelimelik kısa bir deneme yaz."
                    }
                ]
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices.length > 0) {
            console.log("\n✅ [BAŞARILI] OpenRouter'dan Gelen Cevap:\n");
            console.log(data.choices[0].message.content);
            console.log("\n------------------------------------------------");
        } else {
            console.error("❌ Beklenmeyen bir cevap döndü:", data);
        }
    } catch (error) {
        console.error("❌ İstek başarısız oldu:", error.message);
    }
}

testOpenRouter();
