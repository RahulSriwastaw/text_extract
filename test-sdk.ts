// run test
import { GoogleGenAI } from '@google/genai';

async function test() {
  const client = new GoogleGenAI({ apiKey: "INVALID_BLABLA" });
  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'hello',
    });
    console.log("Success!", Object.keys(response));
  } catch (err) {
    console.error("SDK ERROR MESSAGE:", err.message);
  }
}
test();
