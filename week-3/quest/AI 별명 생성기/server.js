require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/generate-nicknames", async (req, res) => {
  const { name, personality, hobby, style, lang } = req.body;

  if (!name) {
    return res.status(400).json({ error: "이름을 입력해주세요." });
  }

  const isEnglish = lang === "en";

  const prompt = isEnglish
    ? `You are an expert at creating fun and creative nicknames.

Create 3 to 5 fun and creative nicknames based on the following information:

- Name: ${name}
- Personality: ${personality || "unknown"}
- Hobbies: ${hobby || "unknown"}
- Nickname Style: ${style || "fun and witty"}

Rules:
1. Make the nicknames in English.
2. Match the requested nickname style.
3. Make them cute, funny, or witty by combining the name, personality, and hobbies creatively.
4. Respond ONLY with a JSON array. No other text.

Example:
["Nickname1", "Nickname2", "Nickname3"]`
    : `당신은 재미있고 창의적인 별명을 만들어주는 전문가입니다.

다음 정보를 바탕으로 재미있고 창의적인 별명을 3~5개 만들어주세요:

- 이름: ${name}
- 성격: ${personality || "알 수 없음"}
- 취미: ${hobby || "알 수 없음"}
- 별명 스타일: ${style || "재미있고 센스있는"}

규칙:
1. 별명은 한국어로 만들어주세요.
2. 요청한 별명 스타일을 반영해주세요.
3. 이름, 성격, 취미를 창의적으로 조합해주세요.
4. 반드시 JSON 배열 형태로만 응답해주세요. 다른 텍스트는 포함하지 마세요.

예시:
["별명1", "별명2", "별명3"]`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 512,
      temperature: 0.9,
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices[0].message.content.trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("별명 파싱 실패");

    const nicknames = JSON.parse(jsonMatch[0]);
    res.json({ nicknames });
  } catch (error) {
    console.error("Error:", error.status, error.message, error);
    const status = error.status || 500;
    const message = error.message || "별명 생성 중 오류가 발생했어요.";
    res.status(status).json({ error: `[${status}] ${message}` });
  }
});

app.listen(3000, () => {
  console.log("서버가 http://localhost:3000 에서 실행 중입니다.");
});
