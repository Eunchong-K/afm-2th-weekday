const OpenAI = require('openai');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Read API key directly from the .env file
const envFilePath = path.join(__dirname, '../../../week-3/goblin/my-ai-chat/.env');
const envContent = fs.readFileSync(envFilePath, 'utf8');
const apiKeyMatch = envContent.match(/OPENAI_API_KEY=(.+)/);
const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : null;

if (!apiKey) {
  console.error('Could not find OPENAI_API_KEY in .env file');
  process.exit(1);
}

const client = new OpenAI({ apiKey });

async function downloadImage(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

async function generateImage(prompt, filePath) {
  console.log(`Generating: ${path.basename(filePath)}`);
  const response = await client.images.generate({
    model: 'dall-e-3',
    prompt: prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    response_format: 'url'
  });

  const imageUrl = response.data[0].url;
  console.log(`Downloading to: ${filePath}`);
  await downloadImage(imageUrl, filePath);
  console.log(`Saved: ${path.basename(filePath)}`);
}

async function main() {
  const thumbnailsDir = path.join(__dirname, 'recipes', 'thumbnails');

  const image1Prompt = `A warm hand-drawn illustration in soft watercolor style. Korean stir-fry dish: golden pan-fried tofu cubes, green cabbage, and soft scrambled eggs arranged in a simple white ceramic bowl. Garnished with sesame seeds and a golden drizzle of sesame oil. Warm golden tones. Flat design with pastel colors, clean white background, slight overhead angle, cozy home-cooking vibe. Square format. No text, no labels, no writing.`;

  const image2Prompt = `A warm hand-drawn illustration in soft watercolor style. A smoothie bowl with a creamy white silken tofu base topped with fresh blueberries in purple and deep blue hues, with a thin drizzle of golden honey. Served in a round white ceramic bowl on a clean cream background. Fresh and light purple color palette. Flat design with pastel colors, slight overhead angle, cozy and healthy vibe. Square format. No text, no labels, no writing.`;

  await generateImage(
    image1Prompt,
    path.join(thumbnailsDir, 'tofu-cabbage-egg-stirfry.png')
  );

  await generateImage(
    image2Prompt,
    path.join(thumbnailsDir, 'blueberry-tofu-smoothie-bowl.png')
  );

  console.log('Both images generated successfully!');
}

main().catch(console.error);
