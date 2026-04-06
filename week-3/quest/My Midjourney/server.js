require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = 3003;

const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL = 'black-forest-labs/FLUX.1-schnell';
const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// JSON body parser
app.use(express.json());

// Serve index.html
app.use(express.static(path.join(__dirname)));

// 한국어 → 영어 번역 (MyMemory 무료 API)
async function translateToEnglish(text) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ko|en`;
    const res = await fetch(url);
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (translated && translated !== text) {
      console.log(`[Translate] ${text} → ${translated}`);
      return translated;
    }
  } catch (e) {
    console.warn('[Translate] 번역 실패, 원본 사용:', e.message);
  }
  return text;
}

// 한국어 포함 여부 감지
function hasKorean(text) {
  return /[\uAC00-\uD7A3]/.test(text);
}

// Image generation endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, stylePrompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: '프롬프트를 입력해 주세요.' });
    }

    // 한국어면 영어로 번역
    let userPrompt = prompt.trim();
    if (hasKorean(userPrompt)) {
      userPrompt = await translateToEnglish(userPrompt);
    }

    // 스타일 수식어 합산
    const fullPrompt = stylePrompt
      ? `${userPrompt}, ${stylePrompt}`
      : userPrompt;

    console.log(`[Generate] Model : ${HF_MODEL}`);
    console.log(`[Generate] Prompt: ${fullPrompt}`);

    // Hugging Face Inference API 호출 (응답: binary 이미지)
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true',
        'x-use-cache': 'false',
      },
      body: JSON.stringify({
        inputs: fullPrompt,
        parameters: {
          num_inference_steps: 4,
          guidance_scale: 0.0,
          width: 1024,
          height: 768,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Error] HF API ${response.status}: ${errorText}`);
      return res.status(response.status).json({
        error: `Hugging Face API 오류 (${response.status})`,
        details: errorText,
      });
    }

    // binary → base64 data URL 변환
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    console.log(`[Success] ${contentType} / ${(buffer.byteLength / 1024).toFixed(1)} KB`);

    res.json({
      images: [{ url: dataUrl }],
      prompt: fullPrompt,
      model: HF_MODEL,
    });
  } catch (err) {
    console.error('[Error]', err.message);
    res.status(500).json({ error: '서버 내부 오류', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  마이 미드저니 서버 실행 중: http://localhost:${PORT}\n`);
});
