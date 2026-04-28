import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;

const THUMBNAILS = [
  {
    filename: "thumb_deer_v2.png",
    title: "사냥꾼 피해서 사슴 숨겨주기 (난이도 최상)",
    prompt: `YouTube thumbnail, cinematic 16:9 wide composition. Two Korean people desperately hiding a cute baby deer in an outdoor forest setting. On the left: a petite young Korean woman with a short dark bob haircut, soft cute facial features, wearing a light olive-green cardigan, crouching with a panicked terrified expression, arms spread wide trying to cover the deer. On the right: a heavyset Korean man with short black hair, chubby face, wearing a colorful plaid flannel shirt, also crouching with an extremely panicked shocked expression, one hand raised. Between them is an adorable small deer (Bambi-style). In the blurry dark background, a menacing hunter silhouette holding a rifle. Large bold Korean text at the top: "사냥꾼이 온다..." in blood-red with thick white outline. Bottom center huge yellow bold Korean text: "사슴을 지켜라!" with red drop shadow. Dark moody forest, dramatic high-contrast lighting, cinematic vignette. Korean comedy skit YouTube channel thumbnail style.`
  }
];

async function generateThumbnail(item) {
  console.log(`Generating: ${item.title}`);

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: item.prompt,
      size: '1536x1024',
      quality: 'high',
      n: 1
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const b64 = data.data[0].b64_json;
  const imageBuffer = Buffer.from(b64, 'base64');
  const outputPath = path.join(__dirname, item.filename);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(`  Saved: ${item.filename}`);
  return outputPath;
}

async function main() {
  for (const item of THUMBNAILS) {
    try {
      await generateThumbnail(item);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
  }
}

main();
