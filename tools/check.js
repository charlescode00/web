#!/usr/bin/env node
/*
 * 自我檢查：用幾種螢幕寬度打開 index.html，檢查易讀性的硬性條件，並存下截圖。
 *
 *     node tools/check.js [截圖輸出資料夾]
 *
 * 檢查項目
 *   ・沒有橫向捲動、文字沒有超出畫面或被裁掉
 *   ・所有文字 ≥ 20px；地址、電話、商品類別 ≥ 28px
 *   ・文字與底色對比 ≥ 7:1
 *   ・可按的元件 ≥ 56px 高，彼此間距 ≥ 8px
 *   ・每個字都有內嵌字體可用（沒有掉回系統字體）
 *   ・不連任何外部資源、程式沒有錯誤
 *   ・照片：都載得到、有替代文字、寫了寬高（載入時版面不跳動）、不超出畫面，
 *     單張 ≤ 200 KB，整頁（含照片）≤ 1.2 MB
 *   ・成品 index.html 和原始檔 index.src.html 同步（沒有忘記跑 build）
 *   ・手機第一個畫面看得到店名、店章、介紹
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HTML = path.resolve(__dirname, '..', 'index.html');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;

const SIZES = [
  { name: 'phone-320', width: 320, height: 568 },
  { name: 'phone-360', width: 360, height: 640 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-412', width: 412, height: 915 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
];

/* 在瀏覽器裡執行：量測並回報問題 */
function audit() {
  const problems = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth) problems.push(`橫向捲動：內容寬 ${de.scrollWidth} > 畫面 ${de.clientWidth}`);

  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  const backgroundOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (bg.a > 0.99) return { rgb: bg.rgb, image: cs.backgroundImage !== 'none' && n !== document.body ? n : null, node: n };
    }
    return { rgb: [255, 255, 255], image: null, node: null };
  };

  /* 內嵌字體涵蓋哪些字 */
  const covered = {};
  document.fonts.forEach((face) => {
    const key = face.family.replace(/["']/g, '') + '|' + face.weight;
    covered[key] = covered[key] || [];
    face.unicodeRange.split(',').forEach((part) => {
      const m = part.trim().match(/^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i);
      if (m) covered[key].push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16)]);
    });
  });

  const BIG = '.big, .num, .cat';
  let minSize = Infinity, minBig = Infinity, minContrast = Infinity;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || el.closest('script, style, .vh') || el.closest('[hidden]')) continue;
    const cs = getComputedStyle(el);
    const label = `「${text.slice(0, 10)}」`;

    const size = parseFloat(cs.fontSize);
    minSize = Math.min(minSize, size);
    if (size < 19.95) problems.push(`字太小 ${size.toFixed(1)}px ${label}`);
    if (el.closest(BIG)) {
      minBig = Math.min(minBig, size);
      if (size < 27.95) problems.push(`關鍵資訊小於 28px：${size.toFixed(1)}px ${label}`);
    }

    const bg = backgroundOf(el);
    const l1 = lum(parse(cs.color).rgb), l2 = lum(bg.rgb);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    minContrast = Math.min(minContrast, ratio);
    if (ratio < 7) problems.push(`對比不足 ${ratio.toFixed(2)}:1 ${label}`);
    if (bg.image) problems.push(`文字壓在花紋上 ${label}`);

    const family = cs.fontFamily.split(',')[0].trim().replace(/["']/g, '');
    const ranges = covered[family + '|' + cs.fontWeight];
    if (!ranges) problems.push(`沒有用內嵌字體：${family} ${cs.fontWeight} ${label}`);
    else {
      const missing = [...text].filter((ch) => !/\s/.test(ch) && !ranges.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b));
      if (missing.length) problems.push(`內嵌字體缺字「${[...new Set(missing)].join('')}」 ${label}`);
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) {
      if (box.right > de.clientWidth + 0.5 || box.left < -0.5) { problems.push(`文字超出畫面 ${label}`); break; }
    }
  }

  /* 文字有沒有被自己的容器裁掉 */
  document.querySelectorAll('h1, h2, p, td, th, a, span, b, small').forEach((el) => {
    if (el.closest('.vh')) return;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') {
      problems.push(`內容被裁掉：<${el.tagName.toLowerCase()} class="${el.className}">`);
    }
  });

  /* 可按的元件 */
  const taps = [...document.querySelectorAll('a, button')].map((el) => ({ el, box: el.getBoundingClientRect() }));
  let minTap = Infinity, minGap = Infinity;
  taps.forEach(({ el, box }) => {
    minTap = Math.min(minTap, box.height);
    if (box.height < 55.5) problems.push(`可按元件不到 56px 高：${box.height.toFixed(0)}px「${el.textContent.trim()}」`);
  });
  for (let i = 0; i < taps.length; i++) {
    for (let j = i + 1; j < taps.length; j++) {
      const a = taps[i], b = taps[j];
      if (getComputedStyle(a.el.closest('.bar') || a.el).position !== getComputedStyle(b.el.closest('.bar') || b.el).position) continue;
      const dx = Math.max(a.box.left - b.box.right, b.box.left - a.box.right, 0);
      const dy = Math.max(a.box.top - b.box.bottom, b.box.top - a.box.bottom, 0);
      const gap = Math.max(dx, dy);
      minGap = Math.min(minGap, gap);
      if (gap < 8) problems.push(`可按元件太靠近（${gap.toFixed(0)}px）：「${a.el.textContent.trim()}」「${b.el.textContent.trim()}」`);
    }
  }

  /* 照片 */
  document.querySelectorAll('img').forEach((img) => {
    const name = img.getAttribute('src');
    if (!img.complete || !img.naturalWidth) problems.push(`照片載不到：${name}`);
    if (!img.getAttribute('alt')) problems.push(`照片沒有替代文字：${name}`);
    if (!img.getAttribute('width') || !img.getAttribute('height')) problems.push(`照片沒寫寬高：${name}`);
    const b = img.getBoundingClientRect();
    if (b.right > de.clientWidth + 0.5 || b.left < -0.5) problems.push(`照片超出畫面：${name}`);
  });

  const bar = document.querySelector('.bar');
  return {
    problems,
    minSize, minBig, minContrast: +minContrast.toFixed(2), minTap, minGap,
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
    pageHeight: de.scrollHeight,
    firstScreen: [...document.querySelectorAll('.name, .seal, .intro')].every((el) => {
      const b = el.getBoundingClientRect();
      return b.bottom <= innerHeight - (bar ? bar.getBoundingClientRect().height : 0);
    }),
  };
}

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, locale: 'zh-TW' });
    const page = await context.newPage();
    const external = [], errors = [];
    page.on('request', (r) => { if (!/^(file|data):/.test(r.url())) external.push(r.url()); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('file://' + HTML);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {             // 一路捲到底，讓延遲載入的照片都載進來
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
      scrollTo(0, 0);
    });
    await page.waitForTimeout(1500);              // 等店章的進場動畫結束
    const result = await page.evaluate(audit);
    external.forEach((u) => result.problems.push('連到外部資源：' + u));
    errors.forEach((e) => result.problems.push('程式錯誤：' + e));
    if (size.width <= 412 && !result.firstScreen) result.problems.push('第一個畫面放不下店名、店章、介紹');
    const { problems, ...numbers } = result;
    console.log(size.name.padEnd(13), JSON.stringify(numbers));
    problems.forEach((p) => { failed = true; console.log('   ✗ ' + p); });
    if (OUT) {
      await page.screenshot({ path: path.join(OUT, size.name + '-first-screen.png') });
      await page.addStyleTag({ content: '.bar{display:none}' });   // 整頁長圖不拍固定按鈕列，免得擋住中間
      await page.screenshot({ path: path.join(OUT, size.name + '.png'), fullPage: true });
    }
    await context.close();
  }

  /* 成品和原始檔有沒有同步 */
  const source = fs.readFileSync(HTML, 'utf8');
  const strip = (s) => s.replace(/\/\* FONTS:BEGIN \*\/[\s\S]*?\/\* FONTS:END \*\//, '');
  const SRC = path.resolve(__dirname, '..', 'index.src.html');
  if (fs.existsSync(SRC) && strip(fs.readFileSync(SRC, 'utf8')) !== strip(source)) {
    failed = true;
    console.log('   ✗ index.html 和 index.src.html 不同步，請先執行 node tools/build.js');
  }

  /* 照片檔案大小 */
  let total = fs.statSync(HTML).size;
  for (const src of [...source.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1])) {
    const file = path.resolve(path.dirname(HTML), src);
    if (!fs.existsSync(file)) { failed = true; console.log('   ✗ 找不到照片檔：' + src); continue; }
    const kb = fs.statSync(file).size / 1024;
    total += fs.statSync(file).size;
    if (kb > 200) { failed = true; console.log(`   ✗ 照片太大 ${kb.toFixed(0)} KB：${src}`); }
  }
  console.log(`整頁大小（含照片）：${(total / 1024).toFixed(0)} KB`);
  if (total > 1.2 * 1024 * 1024) { failed = true; console.log('   ✗ 整頁超過 1.2 MB'); }

  await browser.close();
  console.log(failed ? '\n有項目沒通過。' : '\n全部通過。');
  process.exit(failed ? 1 : 0);
})();
