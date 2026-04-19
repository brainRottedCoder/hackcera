require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

(async () => {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

  for (const model of models) {
    try {
      console.log(`\nTrying model: ${model}`);
      const res = await ai.models.generateContent({
        model,
        contents: 'Return this JSON exactly: {"tasks":[],"decisions":[],"risks":[]}',
        config: { temperature: 0.2, maxOutputTokens: 100 }
      });
      console.log("SUCCESS with", model);
      console.log("response.text:", res.text);
      break;
    } catch (e) {
      console.error(`FAILED ${model} — status: ${e.status || "?"} | message: ${e.message?.slice(0, 200)}`);
    }
  }
})();
