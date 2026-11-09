// Primera versión: descarga las páginas de precios y guarda el HTML en docs/debug
// para ver su estructura real. Después se sustituye por el lector definitivo.
import { mkdir, writeFile } from "node:fs/promises";

const UA = "mesa-fc27 personal price reader (+https://github.com/samuaces/mesa-fc27)";
const PAGES = {
  "nokafut-cheapest": "https://nokafut.com/en/fc27/cheapest/",
  "nokafut-market": "https://nokafut.com/en/fc27/market",
  "fodder-cheapest": "https://fodder.gg/cheapest/item-score",
};

await mkdir("docs/debug", { recursive: true });
const report = { at: new Date().toISOString(), pages: {} };

for (const [key, url] of Object.entries(PAGES)) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" } });
    const html = await res.text();
    report.pages[key] = { status: res.status, bytes: html.length };
    await writeFile(`docs/debug/${key}.html`, html);
  } catch (e) {
    report.pages[key] = { error: String(e) };
  }
}
await writeFile("docs/debug/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
