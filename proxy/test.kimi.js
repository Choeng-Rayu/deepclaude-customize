const OpenAI = require("openai")
 
const client = new OpenAI({
    apiKey: process.env.MOONSHOT_API_KEY,
    baseURL: "https://api.moonshot.ai/v1",
})

async function main(){
    const completion = await client.chat.completions.create({
        model: "kimi-k2.6",
        messages: [
            {"role": "system", "content": "You are Kimi, an AI assistant provided by Moonshot AI."},
            {"role": "user", "content": "Hello, say ok"}
        ]
    })
     
    console.log(completion.choices[0].message.content)
}

main()