const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

// ========================================
// Pokemon Data
// ========================================
const POKEMON_DATA = [
  {
    id: 1,
    nameKo: "이상해씨",
    nameEn: "Bulbasaur",
    types: ["풀", "독"],
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png",
    height: 0.7,
    weight: 6.9,
    description:
      "태어났을 때부터 등에 이상한 씨앗이 심어져 있으며, 몸과 함께 자란다.",
    stats: { hp: 45, attack: 49, defense: 49, speed: 45 },
  },
  {
    id: 4,
    nameKo: "파이리",
    nameEn: "Charmander",
    types: ["불꽃"],
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png",
    height: 0.6,
    weight: 8.5,
    description:
      "꼬리에 타오르는 불꽃은 생명력의 상징이며, 기분이 좋으면 불꽃이 흔들흔들 타오른다.",
    stats: { hp: 39, attack: 52, defense: 43, speed: 65 },
  },
  {
    id: 7,
    nameKo: "꼬부기",
    nameEn: "Squirtle",
    types: ["물"],
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/7.png",
    height: 0.5,
    weight: 9.0,
    description:
      "긴 목을 등껍질 안에 집어넣고 입에서 물을 세차게 뿜어서 공격한다.",
    stats: { hp: 44, attack: 48, defense: 65, speed: 43 },
  },
  {
    id: 25,
    nameKo: "피카츄",
    nameEn: "Pikachu",
    types: ["전기"],
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
    height: 0.4,
    weight: 6.0,
    description:
      "양 볼에 작은 전기 주머니가 있다. 위험해지면 전기를 방출한다.",
    stats: { hp: 35, attack: 55, defense: 40, speed: 90 },
  },
  {
    id: 133,
    nameKo: "이브이",
    nameEn: "Eevee",
    types: ["노말"],
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/133.png",
    height: 0.3,
    weight: 6.5,
    description:
      "불안정한 유전자를 가지고 있어 주변 환경에 따라 다양한 모습으로 진화할 수 있다.",
    stats: { hp: 55, attack: 55, defense: 50, speed: 55 },
  },
];

// ========================================
// Search Function
// ========================================
function searchPokemon(query) {
  if (!query) return POKEMON_DATA;

  const q = query.trim().toLowerCase();
  if (!q) return POKEMON_DATA;

  return POKEMON_DATA.filter((p) => {
    const idMatch =
      String(p.id) === q || String(p.id).padStart(3, "0").includes(q);
    const nameKoMatch = p.nameKo.toLowerCase().includes(q);
    const nameEnMatch = p.nameEn.toLowerCase().includes(q);
    return idMatch || nameKoMatch || nameEnMatch;
  });
}

// ========================================
// MIME Types
// ========================================
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

// ========================================
// Server
// ========================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: GET /api/pokemon?q=검색어
  if (url.pathname === "/api/pokemon") {
    const query = url.searchParams.get("q") || "";
    const results = searchPokemon(query);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(results));
    return;
  }

  // Static files: serve from /public
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = path.join(__dirname, "public", filePath);

  // Prevent directory traversal
  if (!fullPath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>404 - 페이지를 찾을 수 없습니다</h1>");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`포켓몬 검색 서버가 실행 중입니다: http://localhost:${PORT}`);
});
