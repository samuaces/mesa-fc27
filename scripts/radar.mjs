// Radar de inversión: lee el historial diario (52 días) de las cartas que más importan para
// los SBC (fodder 84 a 91) y calcula si el precio actual es anormalmente bajo o alto frente
// a sus últimos 14 días. Es estadística (vuelta a la media), no una predicción.
// Salida: docs/radar.json
import { readFile, writeFile } from "node:fs/promises";

const UA = "mesa-fc27 personal price reader (+https://github.com/samuaces/mesa-fc27)";
const BASE = "https://nokafut.com/en/fc27";
const OFFLINE_DIR = process.env.OFFLINE_DIR;
const PER_TIER = 5;
const RATINGS = [84, 85, 86, 87, 88, 89, 90, 91];

const toNum = (s) => Number(String(s).replace(/[^\d.]/g, ""));
const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
   .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = (p) => { const s = p < 1000 ? 50 : p < 10000 ? 100 : p < 50000 ? 250 : p < 100000 ? 500 : 1000; return Math.ceil(p / s) * s; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function parsePlayer(html) {
  const cur = html.match(/precio__actual[\s\S]*?<b>([\d,]+)<\/b>/);
  const rows = [];
  for (const m of html.matchAll(/<tr><td>(\d{2})\/(\d{2})\/(\d{4})<\/td><td>([\d,]+)<\/td><td>([\d,]+)<\/td><td>([\d,]+)<\/td><td><b>([\d,]+)<\/b><\/td><\/tr>/g)) {
    rows.push({ date: `${m[3]}-${m[2]}-${m[1]}`, open: toNum(m[4]), low: toNum(m[5]), high: toNum(m[6]), close: toNum(m[7]) });
  }
  return { cur: cur ? toNum(cur[1]) : null, rows }; // rows[0] = hoy (día en curso)
}

export function analyse(p, ref) {
  if (p.rows.length < 16) return null;
  // el precio actual sale de la propia tabla diaria; si no cuadra con el de la lista, la ficha es de otra versión
  p = { ...p, cur: p.rows[0].close };
  if (!p.cur || (ref && (p.cur / ref > 1.6 || p.cur / ref < 0.6))) return null;
  const closes = p.rows.slice(1, 15).map((r) => r.close);          // 14 días cerrados
  const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  const sd = Math.max(Math.sqrt(closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length), mean * 0.01);
  const med14 = median(closes);
  const all = p.rows.slice(1).map((r) => r.close);
  const lo52 = Math.min(...all), hi52 = Math.max(...all);
  const z = (p.cur - mean) / sd;
  const bid = up(p.cur * 1.02);
  const target = up(med14 * 0.97);
  const netPct = target > bid ? (target * 0.95 / bid - 1) * 100 : 0;
  return {
    cur: p.cur, med14: Math.round(med14), hi14: Math.max(...closes), lo14: Math.min(...closes),
    lo52, hi52, days: p.rows.length,
    z: Math.round(z * 100) / 100,
    dropPct: Math.round((p.cur / med14 - 1) * 1000) / 10,
    sigmaPct: Math.round((sd / mean) * 1000) / 10,
    range52: hi52 > lo52 ? Math.round(((p.cur - lo52) / (hi52 - lo52)) * 100) : 50,
    bid, target, netPct: Math.round(netPct * 10) / 10,
  };
}

async function get(url, key) {
  if (OFFLINE_DIR) return readFile(`${OFFLINE_DIR}/${key}.html`, "utf8");
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const html = await get(`${BASE}/cheapest/`, "nokafut-cheapest");
  const parts = html.split(/<div class="bl__caja" id="m(\d+)">/);
  const list = [];
  for (let k = 1; k < parts.length; k += 2) {
    const rating = Number(parts[k]);
    if (!RATINGS.includes(rating)) continue;
    const body = parts[k + 1].split("</ol>")[0];
    let n = 0;
    for (const m of body.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const id = m[1].match(/\/player\/(\d+)-([^"]+)"/);
      const nm = m[1].match(/<span class="bl__txt"><b>([\s\S]*?)<\/b><small>([\s\S]*?)<\/small>/);
      if (!id || !nm || n >= PER_TIER) continue;
      n++;
      const pr = m[1].match(/<span class="bl__p">([\d.,]+)</);
      list.push({ id: id[1], slug: id[2], name: decode(nm[1]).trim(), rating, pos: (nm[2].match(/^\s*([A-Z]{1,3})\b/) || [])[1] || "", ref: pr ? toNum(pr[1]) : null });
    }
  }
  const cards = [];
  for (const c of list) {
    try {
      const page = await get(`${BASE}/player/${c.id}-${c.slug}`, c.id);
      const a = analyse(parsePlayer(page), c.ref);
      if (a) cards.push({ id: c.id, name: c.name, pos: c.pos, rating: c.rating, ...a });
    } catch (e) { console.log("fallo", c.name, String(e)); }
    if (!OFFLINE_DIR) await sleep(1200);
  }
  if (cards.length < 10) throw new Error(`Pocas cartas analizadas (${cards.length})`);
  cards.sort((x, y) => x.z - y.z);
  await writeFile("docs/radar.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "https://nokafut.com/en/fc27/", cards }));
  console.log(`Radar: ${cards.length} cartas. Más bajas respecto a su media:`);
  for (const c of cards.slice(0, 5)) console.log(`${c.name} ${c.rating} ahora ${c.cur} mediana14 ${c.med14} z ${c.z} neto ${c.netPct}%`);
}

if (process.argv[1] && process.argv[1].endsWith("radar.mjs")) await main();
