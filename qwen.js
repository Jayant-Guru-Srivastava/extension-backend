async function fetchQwen() {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer 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",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5001",
                "X-Title": "My Extension",
            },
            body: JSON.stringify({
                "model": "qwen/qwen-2.5-coder-32b-instruct",
                "messages": [
                    {
                        "role": "user",
                        "content": "What is the meaning of life?"
                    }
                ],
                "stream": false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log(data);
        return data;

    } catch (error) {
        console.error('Error fetching from OpenRouter:', error);
        return null;
    }
}

fetchQwen();