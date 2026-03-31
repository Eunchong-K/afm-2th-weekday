require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const SYSTEM_PROMPT = `당신은 따뜻하고 공감 능력이 뛰어난 심리 상담사입니다.
상담사로서 다음 원칙을 따르세요:

1. 항상 공감하며 경청하는 자세를 보여주세요.
2. 판단하지 않고 내담자의 감정을 있는 그대로 수용하세요.
3. 적절한 질문을 통해 내담자가 스스로 생각을 정리할 수 있도록 도와주세요.
4. 위로와 격려의 말을 건네되, 진심이 담긴 표현을 사용하세요.
5. 필요한 경우 간단한 심리학적 기법(인지행동치료, 마음챙김 등)을 안내해주세요.
6. 심각한 정신건강 문제가 감지되면 전문 상담사나 정신건강 전문의 방문을 권유하세요.
7. 답변은 한국어로 해주세요.
8. 너무 길지 않게, 대화하듯 자연스럽게 답변하세요.`;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages 배열이 필요합니다." });
  }

  const apiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: apiMessages,
        temperature: 0.8,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res
        .status(response.status)
        .json({ error: err.error?.message || "OpenAI API 오류" });
    }

    const data = await response.json();
    res.json({ reply: data.choices[0].message.content });
  } catch (err) {
    console.error("API 호출 오류:", err.message);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

app.listen(PORT, () => {
  console.log(`심리 상담 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
