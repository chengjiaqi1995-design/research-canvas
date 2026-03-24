require('dotenv').config();
const axios = require('axios');

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  const batch = ["National Grid", "Red Electrica", "英伟达", "NVDA", "潍柴", "Enchanted Rock"];
  
  const prompt = `你是一个顶级卖方数据分析师。
请将以下非标准的公司口语化简称，映射为【标准名称 (Bloomberg Ticker)】的格式。
例如：将"潍柴"或"潍柴动力股份有限公司"映射为"潍柴动力 (000338 CH)"。将"Jefferies"映射为"Jefferies (JEF US)"。
如果你完全查不到它在这个世界上对应的任何实体，可以用 (Private) 注释，例如 "Enchanted Rock (Private)"。

输入公司列表：
${batch.join('\n')}

你必须返回一个合法的 JSON 字典，键是原名字，值是规范化后的名字配合Ticker。只返回JSON，千万千万不要带有 \`\`\`json 等任何格式标记或任何其他文本。`;

  try {
    const aiResponse = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      }
    });

    let text = aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    console.log("Raw Response:");
    console.log(aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text);
    console.log("Parsed JSON:");
    console.log(JSON.parse(text));
  } catch (err) {
    if (err.response) {
      console.log(err.response.data);
    } else {
      console.log(err);
    }
  }
}
run();
