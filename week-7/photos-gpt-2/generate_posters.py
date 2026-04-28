import openai
import base64
import os

client = openai.OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY")
)

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

posters = [
    {
        "filename": "poster_01_main.png",
        "prompt": (
            "Korean Netflix horror drama movie poster titled '기리고 (GIRIGO)'. "
            "A dark, eerie smartphone screen glowing with a cursed wish-granting app interface in the center. "
            "The app shows a glowing red accept button. Shadowy silhouettes of Korean high school students "
            "surrounding the phone, trapped in darkness. Dripping blood-red typography for the title. "
            "Cinematic, ultra-detailed, vertical movie poster format, dark atmosphere, fog, neon red accents. "
            "Netflix original series branding."
        ),
    },
    {
        "filename": "poster_02_group.png",
        "prompt": (
            "Korean Netflix horror drama poster for '기리고 (GIRIGO)'. "
            "Five Korean high school students in uniforms standing together in a dark school hallway at night, "
            "each face showing fear and desperation. A glowing cursed smartphone app floats above them. "
            "Dramatic cinematic lighting, deep shadows, horror atmosphere. "
            "Vertical movie poster with bold Korean and English title text at the bottom. "
            "Photorealistic, dark blue and red color palette."
        ),
    },
    {
        "filename": "poster_03_phone_curse.png",
        "prompt": (
            "Horror movie poster concept for Korean Netflix series '기리고'. "
            "A cracked smartphone screen showing a wish-granting app with a demonic red glow. "
            "Ghostly hands reaching out from the screen. Black smoke and cursed symbols surrounding the phone. "
            "The background is pitch black with a school building silhouette. "
            "Vertical poster, ultra-cinematic, 4K quality, terrifying horror atmosphere, "
            "Korean drama aesthetic, Netflix branding style."
        ),
    },
    {
        "filename": "poster_04_countdown.png",
        "prompt": (
            "Dark atmospheric movie poster for Korean horror drama '기리고 (GIRIGO)' on Netflix. "
            "A close-up of a terrified Korean teenage girl's face half-lit by the glow of a cursed phone app. "
            "The phone screen shows a countdown timer and a skull icon. "
            "Tears on her cheek, blood-red light casting shadows. "
            "Cinematic horror style, vertical poster format, dramatic contrast, "
            "dark red and black color scheme, Netflix original branding."
        ),
    },
    {
        "filename": "poster_05_dark_school.png",
        "prompt": (
            "Cinematic horror poster for Korean Netflix drama '기리고 (GIRIGO)'. "
            "Aerial view of an empty dark Korean high school at midnight, "
            "glowing app symbols etched into the ground like a curse circle. "
            "Small figure of a student standing in the center looking up. "
            "Dark blue and crimson atmosphere, foggy, eerie. "
            "Ultra-wide vertical movie poster, dramatic lighting from below, "
            "Netflix series style, high production value."
        ),
    },
]

def generate_and_save(poster):
    print(f"Generating: {poster['filename']} ...")
    response = client.images.generate(
        model="gpt-image-1",
        prompt=poster["prompt"],
        size="1024x1536",
        quality="high",
        n=1,
    )
    image_data = response.data[0].b64_json
    image_bytes = base64.b64decode(image_data)
    output_path = os.path.join(OUTPUT_DIR, poster["filename"])
    with open(output_path, "wb") as f:
        f.write(image_bytes)
    print(f"  Saved: {output_path}")

for poster in posters:
    generate_and_save(poster)

print("\nAll posters generated successfully!")
