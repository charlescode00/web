#!/usr/bin/env node
/*
 * 產生成品 index.html（單一檔案，字體內嵌）。
 *
 *     node tools/build.js
 *
 * 原始檔是 index.src.html（沒有字體資料，好讀好改）。這支程式會：
 *   1. 用瀏覽器打開原始檔，看每一段文字實際用哪個字體、哪個字重
 *   2. 加上程式會動態顯示的字（如果頁面有程式的話）
 *   3. 把字體切成只含這些字的小檔，以 base64 塞進 FONTS:BEGIN ～ FONTS:END 之間
 *   4. 寫出 index.html
 *
 * 如果手上只剩成品 index.html：把 FONTS:BEGIN ～ FONTS:END 之間清空，
 * 存成 index.src.html 就是原始檔（這支程式在找不到原始檔時會自動這樣做）。
 *
 * 需要：Node＋Playwright（Chromium）、Python 3＋fonttools＋brotli（pip install fonttools brotli）。
 * 字體原檔來自 npm 的 @fontsource 套件；第一次執行會自動下載到 tools/.fontsrc
 * （也可以用環境變數 FONT_SRC 指到既有的 node_modules/@fontsource）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'index.src.html');
const OUT = path.join(ROOT, 'index.html');
const BEGIN = '/* FONTS:BEGIN */';
const END = '/* FONTS:END */';
const NOTICE =
  '/* 內嵌字體子集：Noto Serif TC © Adobe；LXGW WenKai TC © The LXGW WenKai Project Authors。' +
  '皆為 SIL Open Font License 1.1（https://openfontlicense.org）。由 tools/build.js 產生，請勿手改。 */';


function fontSource() {
  if (process.env.FONT_SRC) return process.env.FONT_SRC;
  const dir = path.join(__dirname, '.fontsrc');
  const scoped = path.join(dir, 'node_modules', '@fontsource');
  if (!fs.existsSync(path.join(scoped, 'lxgw-wenkai-tc')) || !fs.existsSync(path.join(scoped, 'noto-serif-tc'))) {
    console.log('下載字體原檔到 tools/.fontsrc …');
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--silent',
      '@fontsource/noto-serif-tc@5', '@fontsource/lxgw-wenkai-tc@5'], { stdio: 'inherit' });
  }
  return scoped;
}

/* 只有成品時，從成品還原出原始檔 */
function ensureSource() {
  if (fs.existsSync(SRC)) return;
  const built = fs.readFileSync(OUT, 'utf8');
  const i = built.indexOf(BEGIN), j = built.indexOf(END);
  if (i < 0 || j < 0) throw new Error('index.html 裡找不到 FONTS:BEGIN／FONTS:END 標記');
  fs.mkdirSync(path.dirname(SRC), { recursive: true });
  fs.writeFileSync(SRC, built.slice(0, i + BEGIN.length) + '\n' + built.slice(j));
  console.log('已從 index.html 還原 index.src.html');
}

/* 頁面上每段文字 → { "字體|字重": "用到的字" } */
async function collectRoles() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + SRC);
  const roles = await page.evaluate(() => {
    const out = {};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || el.closest('script, style, noscript, .vh')) continue;
      const cs = getComputedStyle(el);
      const family = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      const key = family + '|' + cs.fontWeight;
      out[key] = (out[key] || '') + node.textContent.replace(/\s/g, '');
    }
    return out;
  });
  await browser.close();
  return roles;
}

/* 程式裡的字串（星期、營業中、開門…）也會顯示在頁面上 */
function scriptStrings(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const code = scripts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...code.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]).join('').replace(/[\x00-\x7F]/g, '');
}

(async () => {
  ensureSource();
  const html = fs.readFileSync(SRC, 'utf8');
  if (!html.includes(BEGIN) || !html.includes(END)) throw new Error('index.src.html 裡找不到 FONTS:BEGIN／FONTS:END 標記');

  const found = await collectRoles();
  const roles = {};
  for (const [key, chars] of Object.entries(found)) {
    if (key.startsWith('Receipt ')) roles[key] = chars;
    else console.warn('注意：有文字沒用到內嵌字體 →', key, [...new Set(chars)].join('').slice(0, 30));
  }
  const dynamic = scriptStrings(html);
  if (dynamic) for (const key of ['Receipt Hand|400', 'Receipt Hand|700']) roles[key] = (roles[key] || '') + dynamic;
  for (const key of Object.keys(roles)) roles[key] = [...new Set(roles[key])].sort().join('');

  const tmp = path.join(os.tmpdir(), 'receipt-font-roles.json');
  fs.writeFileSync(tmp, JSON.stringify(roles));
  const css = execFileSync('python3', [path.join(__dirname, 'subset_fonts.py'), fontSource(), tmp],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });

  const head = html.slice(0, html.indexOf(BEGIN) + BEGIN.length);
  const tail = html.slice(html.indexOf(END));
  fs.writeFileSync(OUT, head + '\n' + NOTICE + '\n' + css + tail);

  for (const [key, chars] of Object.entries(roles)) console.log(key.padEnd(18), chars);
  console.log('index.html：' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
})().catch((err) => { console.error(err.message || err); process.exit(1); });
