import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const posters = [
  {
    filename: "poster_01_main.png",
    prompt:
      "Korean Netflix horror drama movie poster titled 'GIRIGO (기리고)'. " +
      "A dark eerie smartphone screen glowing with a cursed wish-granting app interface in the center. " +
      "The app shows a glowing red accept button and a skull warning icon. " +
      "Shadowy silhouettes of Korean high school students surrounding the phone, trapped in darkness. " +
      "Dripping blood-red typography for the title at the top. " +
      "Cinematic ultra-detailed vertical movie poster format, dark atmosphere, fog, neon red accents. " +
      "Netflix original series branding at the bottom.",
  },
  {
    filename: "poster_02_group.png",
    prompt:
      "Korean Netflix horror drama poster for 'GIRIGO (기리고)'. " +
      "Five Korean high school students in school uniforms standing together in a dark school hallway at night, " +
      "each face showing fear and desperation, looking at a glowing cursed smartphone. " +
      "A cursed wish-granting app glows ominously above them. " +
      "Dramatic cinematic lighting, deep shadows, horror atmosphere. " +
      "Vertical movie poster with bold title text at the bottom. " +
      "Photorealistic, dark blue and red color palette, Netflix style.",
  },
  {
    filename: "poster_03_phone_curse.png",
    prompt:
      "Horror movie poster concept for Korean Netflix series 'GIRIGO'. " +
      "A cracked smartphone screen showing a cursed wish-granting app with a demonic red glow. " +
      "Ghostly hands reaching out from the screen toward the viewer. " +
      "Black smoke and cursed rune symbols surrounding the phone. " +
      "Dark school building silhouette in the background. " +
      "Vertical poster, ultra-cinematic, terrifying horror atmosphere, " +
      "Korean horror drama aesthetic, Netflix branding style.",
  },
  {
    filename: "poster_04_countdown.png",
    prompt:
      "Dark atmospheric movie poster for Korean horror drama 'GIRIGO (기리고)' on Netflix. " +
      "Close-up of a terrified Korean teenage girl face half-lit by the glow of a cursed phone app. " +
      "The phone screen shows a countdown timer and a death warning. " +
      "Tears streaming down her cheek, blood-red light casting dramatic shadows. " +
      "Cinematic horror style, vertical poster format, dramatic contrast, " +
      "dark red and black color scheme, Netflix original branding at bottom.",
  },
  {
    filename: "poster_05_dark_school.png",
    prompt:
      "Cinematic horror poster for Korean Netflix drama 'GIRIGO (기리고)'. " +
      "Aerial view of an empty dark Korean high school at midnight. " +
      "Glowing cursed app symbols etched into the schoolyard ground like a curse magic circle. " +
      "A lone student figure standing in the center of the circle looking up in terror. " +
      "Dark blue and crimson atmosphere, foggy, eerie supernatural feeling. " +
      "Ultra-wide vertical movie poster, dramatic lighting from below, " +
      "Netflix series style, high cinematic production value.",
  },
];

async function generateAndSave(poster) {
  console.log(`Generating: ${poster.filename} ...`);
  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt: poster.prompt,
    size: "1024x1536",
    quality: "high",
    n: 1,
  });

  const b64 = response.data[0].b64_json;
  const buffer = Buffer.from(b64, "base64");
  const outputPath = path.join(__dirname, poster.filename);
  fs.writeFileSync(outputPath, buffer);
  console.log(`  Saved: ${outputPath}`);
}

(async () => {
  for (const poster of posters) {
    await generateAndSave(poster);
  }
  console.log("\nAll posters generated successfully!");
})();
