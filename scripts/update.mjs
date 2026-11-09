// Lee los precios de NokaFut (console) y guarda:
//   docs/data.json     estado actual del mercado
//   docs/history.json  suelo de precio por valoración en cada lectura (para ver qué hora es más barata)
// Si algo no se puede leer, el script falla y se conservan los datos anteriores.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const UA = "mesa-fc27 personal price reader (+https://github.com/samuaces/mesa-fc27)";
const BASE = "https://nokafut.com/en/fc27";
const OFFLINE_DIR = process.env.OFFLINE_DIR; // para probar con HTML guardado

const decode = (s) =>
  s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const toNum = (s) => Number(String(s).replace(/[^\d.]/g, ""));

async function get(name, path) {
  if (OFFLINE_DIR) return readFile(`${OFFLINE_DIR}/${name}.html`, "utf8");
  const res = await fetch(`${BASE}/${path}`, { headers: { "user-agent": UA, "accept-language": "en" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

function parseCheapest(html) {
  const parts = html.split(/<div class="bl__caja" id="m(\d+)">/);
  const tiers = [];
  for (let k = 1; k < parts.length; k += 2) {
    const rating = Number(parts[k]);
    const body = parts[k + 1].split("</ol>")[0];
    const cards = [];
    for (const m of body.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const r = m[1];
      const id = r.match(/\/player\/(\d+)-/);
      const nm = r.match(/<span class="bl__txt"><b>([\s\S]*?)<\/b><small>([\s\S]*?)<\/small>/);
      const pr = r.match(/<span class="bl__p">([\d.,]+)<small[^>]*>([\d.,]+)/);
      if (!id || !nm || !pr) continue;
      const small = nm[2];
      const pos = (small.match(/^\s*([A-Z]{1,3})\b/) || [])[1] || "";
      const version = decode(small.replace(/<[^>]+>/g, " ")).trim().split(/\s+/).slice(1).join(" ");
      cards.push({
        id: id[1],
        name: decode(nm[1]).trim(),
        pos,
        version,
        price: toNum(pr[1]),
        itemScore: toNum(pr[2]),
      });
    }
    if (cards.length) tiers.push({ rating, cards });
  }
  return tiers;
}

function visibleText(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<template[\s\S]*?<\/template>/g, "")
      .replace(/<[^>]+>/g, "\n")
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
}

function parseMarket(html) {
  const t = visibleText(html);
  const indices = {};
  for (const m of t.matchAll(/Index (Icons|\d+)\s+([\d.]+)\s+(?:([▲▼])\s*)?([\d.]+)\s*%/g)) {
    const id = m[1];
    if (indices[id]) continue;
    const sign = m[3] === "▼" ? -1 : 1;
    indices[id] = { value: Number(m[2]), change24h: sign * Number(m[4]) };
  }
  const mood = t.match(/Market mood[\s\S]*?(\d+)\s*\/\s*100\s*·\s*([^\n]+)\n[\s\S]*?(\d+)% went up \(([\d,]+) up, ([\d,]+) down\)/);
  if (!mood) throw new Error("No se encontró el ánimo del mercado");
  return {
    indices,
    mood: {
      score: Number(mood[1]),
      text: mood[2].trim(),
      upPct: Number(mood[3]),
      up: toNum(mood[4]),
      down: toNum(mood[5]),
    },
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

const cheapestHtml = await get("nokafut-cheapest", "cheapest/");
const marketHtml = await get("nokafut-market", "market");

const tiers = parseCheapest(cheapestHtml).filter((t) => t.rating >= 81 && t.rating <= 95);
const market = parseMarket(marketHtml);

// comprobaciones: si el formato de la web cambia, que falle en vez de publicar datos mal leídos
const need = [83, 84, 85, 86, 87, 88, 89, 90];
for (const r of need) {
  const t = tiers.find((x) => x.rating === r);
  if (!t || t.cards.length < 3) throw new Error(`Faltan cartas de valoración ${r}`);
  if (!t.cards.every((c) => c.price > 0 && c.name)) throw new Error(`Datos raros en valoración ${r}`);
}
if (Object.keys(market.indices).length < 4) throw new Error("Faltan índices");

const now = new Date().toISOString();
const data = {
  updatedAt: now,
  source: { name: "NokaFut", url: `${BASE}/cheapest/`, platform: "consola (PS/Xbox)" },
  mood: market.mood,
  indices: market.indices,
  tiers: tiers.map((t) => ({
    rating: t.rating,
    price: t.cards[0].price,
    itemScore: t.cards[0].itemScore,
    cards: t.cards.slice(0, 5),
  })),
};

// historial: un punto por lectura con el suelo de cada valoración, 14 días
const hist = await readJson("docs/history.json", { points: [] });
const p = {};
for (const t of tiers) if (t.rating >= 83 && t.rating <= 90) p[t.rating] = t.cards[0].price;
hist.points.push({ t: now, p });
const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
hist.points = hist.points.filter((x) => new Date(x.t).getTime() >= cutoff);

await mkdir("docs", { recursive: true });
await writeFile("docs/data.json", JSON.stringify(data, null, 1));
await writeFile("docs/history.json", JSON.stringify(hist));
console.log(`OK ${now} · mood ${data.mood.score} · ${data.tiers.length} valoraciones · ${hist.points.length} puntos`);
for (const t of data.tiers.filter((x) => x.rating >= 83 && x.rating <= 90))
  console.log(t.rating, t.cards.slice(0, 3).map((c) => `${c.name} ${c.pos} ${c.price}`).join(" | "));
