import axios from 'axios';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  const unmatchedOrgs = ["BP", "Chevron", "Baker", "Baker Hughes"];
  const batch = unmatchedOrgs.map(o => `公司简称: "${o}" | 摘要上下文: ""`);

  const prompt = `你是一个顶级卖方数据分析师。
请将以下提取出的非标准公司口语化简称，结合我提供的一小段原文上下文，精准映射为【标准名称】并附上 Bloomberg Ticker。

要求：
1. Ticker 格式放在名称左侧方括号内，且【绝不能带有 "Equity" 字样】！
例如：将 "潍柴" 映射为 "[000338 CH] 潍柴动力"，将 "Jefferies" 映射为 "[JEF US] Jefferies"。
2. 名称规则严格：如果 Ticker 对应的官方实体是英文（如 FLNC US 对应 Fluence Energy），则名称必须保持原版英文 "Fluence Energy"，【绝对禁止】擅自将其翻译或错乱匹配为无关中文名（例如绝不能把 Fluence 写成 "福特"）。只有中国公司才使用中文官方名称。
3. 如果完全查不到真实实体或它未上市，请使用 "[Private] 公司名"，例如 "[Private] Enchanted Rock"。
4. 不要被零碎的字母误导，务必结合我提供的上下文判断它到底在指代哪家公司（比如 "MR" 在核能上下文里指的是 "[SMR US] NuScale Power"）。如果上下文看不出公司，宁可保持原样也不要瞎编。

输入数据：
${batch.join('\n')}

你必须返回一个严格合法的 JSON 字典，键是"公司简称"（原样返回），值是你推断出来的 "[Ticker] 规范名称"。
只返回JSON，绝对不要带有 \`\`\`json 等任何格式标记，绝对不要有其他任何说明文字。`;

  console.log("Sending prompt to Gemini...");
  const res = await axios.post(url, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
  });
  
  let text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log("Gemini Response:", text);
}

main().catch(console.error);
