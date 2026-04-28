import openai
import base64
import os
from pathlib import Path

API_KEY = os.environ.get("OPENAI_API_KEY")
client = openai.OpenAI(api_key=API_KEY)

OUTPUT_DIR = Path(__file__).parent

THUMBNAILS = [
    {
        "filename": "thumb_01_deer.png",
        "title": "사냥꾼 피해서 사슴 숨겨주기 (난이도 최상)",
        "prompt": (
            "YouTube thumbnail, 16:9 landscape, 1536x1024. "
            "A panicked Korean man in casual clothes crouching in a dense forest, desperately hiding a cute deer behind his back. "
            "A scary hunter with a rifle is approaching in the blurry background. "
            "Bold Korean text overlay at the top '사냥꾼이 온다...' in red with white stroke, "
            "and at the bottom '사슴을 지켜라!' in large bright yellow bold font. "
            "High contrast cinematic lighting, dark moody forest background, red warning color accents. "
            "Dramatic facial expression of extreme tension. Korean YouTube comedy/skit channel style thumbnail."
        ),
    },
    {
        "filename": "thumb_02_idol.png",
        "title": "아이돌 하기 싫은 여고생 김채원 진로상담",
        "prompt": (
            "YouTube thumbnail, 16:9 landscape, 1536x1024. "
            "A Korean high school girl in a school uniform with perfect visuals and a deadpan unamused expression, "
            "standing in front of a glittery K-pop idol stage background, arms crossed. "
            "Bold Korean text on the left side: '비주얼은 완벽한데' in white bold font, "
            "and '아이돌 하기 싫어요' in large hot pink bold font with yellow glow effect. "
            "Bottom corner label 'EP.2 김채원' in a pink badge. "
            "Vibrant pink and purple gradient background, confetti and spotlights. "
            "Korean YouTube comedy drama thumbnail style, high energy, pop art aesthetic."
        ),
    },
    {
        "filename": "thumb_03_teacher.png",
        "title": "한국지리 일타강사 문쌤 수능특강",
        "prompt": (
            "YouTube thumbnail, 16:9 landscape, 1536x1024. "
            "A stern middle-aged Korean male teacher in a yellow polo shirt standing dramatically in front of a green chalkboard, "
            "pointing a stick directly at the viewer with an intense expression. "
            "The chalkboard has geography diagrams and Korean text. "
            "Bold Korean text overlay: '이 문제 틀리면' in white large bold font at the top, "
            "and '수능 망함 ❌' in huge red bold font in the center. "
            "Small text badge '한국지리 일타강사' in green. "
            "Dark vignette edges, dramatic spotlight on the teacher, high contrast. "
            "Korean educational comedy YouTube channel style thumbnail."
        ),
    },
]


def generate_thumbnail(item):
    print(f"Generating: {item['title']}")
    response = client.images.generate(
        model="gpt-image-1",
        prompt=item["prompt"],
        size="1536x1024",
        quality="high",
        n=1,
    )
    image_data = response.data[0].b64_json
    image_bytes = base64.b64decode(image_data)
    output_path = OUTPUT_DIR / item["filename"]
    with open(output_path, "wb") as f:
        f.write(image_bytes)
    print(f"Saved: {output_path}")
    return str(output_path)


if __name__ == "__main__":
    results = []
    for item in THUMBNAILS:
        path = generate_thumbnail(item)
        results.append((item, path))
    print("\nAll thumbnails generated!")
    for item, path in results:
        print(f"  - {item['filename']}: {item['title']}")
