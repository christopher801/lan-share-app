/**
 * generate-assets.js
 * ─────────────────────────────────────────────────────────────
 * Script pou kreye tout assets vizyèl LAN Share otomatikman:
 *   - Logo SVG (vektè, kalite pafè)
 *   - PNG: 16, 32, 48, 64, 128, 256, 512, 1024 px
 *   - assets/icons/icon.png  (512px — pou Linux AppImage)
 *   - assets/icons/icon.ico  (multi-size — pou Windows NSIS)
 *   - assets/icons/icon.icns (macOS, si sou Mac)
 *   - renderer/logo.svg      (pou UI)
 *
 * Lanse: node generate-assets.js
 *
 * Depandans: ZERO — itilize sèlman Node.js built-in modules +
 *   canvas (si disponib) oubyen SVG pou ekri fichye dirèkteman.
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Koulè ak konstant ──────────────────────────────────────────
const BRAND = {
  bg:       '#0f172a',   // Background nwa deep navy
  accent:   '#3b82f6',   // Bleu elektrik
  accentL:  '#60a5fa',   // Bleu klè (gradient)
  white:    '#f1f5f9',
  green:    '#10b981',
};

// ─── Dosye output ───────────────────────────────────────────────
const ICONS_DIR    = path.join(__dirname, 'assets', 'icons');
const RENDERER_DIR = path.join(__dirname, 'renderer');

[ICONS_DIR, RENDERER_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ═══════════════════════════════════════════════════════════════
//  1. SVG LOGO  (design modèn, klè, pofesyonèl)
// ═══════════════════════════════════════════════════════════════

/**
 * Jenere SVG logo LAN Share.
 * Konsèp: Twa kouch (layers) ki reprezante "partaj" ak yon
 * siy WiFi/rezo anba — tout nan yon bwat kare fon nwa ak kwen awondi.
 *
 * @param {number} size  - Dimansyon (500 pa default pou fòma ki ka skalé)
 * @returns {string} SVG string konplè
 */
function buildSVG(size = 500) {
  const s  = size;
  const cx = s / 2;
  const cy = s / 2;

  // Kalkile pwen relatif pou tout eleman
  const pad    = s * 0.12;
  const radius = s * 0.18;   // kwen awondi bwat

  // Lay 1 (gwo) : s*0.55 wotè, s*0.42 lajè
  // Lay 2 (mwayen) : desann 16%
  // Lay 3 (piti) : desann 32%
  const lw1 = s * 0.44, lh1 = s * 0.10, lr1 = s * 0.03;
  const lw2 = s * 0.34, lh2 = lh1, lr2 = lr1;
  const lw3 = s * 0.22, lh3 = lh1, lr3 = lr1;
  const lGap = s * 0.065;
  const lTop = cy - (lh1 * 1.5 + lGap);

  // Siy WiFi (3 ark anba layers)
  const wCx  = cx;
  const wCy  = cy + s * 0.20;
  const wR1  = s * 0.10, wR2 = s * 0.17, wR3 = s * 0.24;
  const wSW  = s * 0.032;
  const wDot = s * 0.038;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <defs>
    <!-- Background gradient -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0a0f1e"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- Accent gradient pou layers -->
    <linearGradient id="layerGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${BRAND.accent}"/>
      <stop offset="100%" stop-color="${BRAND.accentL}"/>
    </linearGradient>

    <!-- Glow filter -->
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${s * 0.018}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Softer glow pou WiFi -->
    <filter id="glowSoft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${s * 0.012}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Clip pou kwen awondi -->
    <clipPath id="roundClip">
      <rect x="0" y="0" width="${s}" height="${s}" rx="${radius}" ry="${radius}"/>
    </clipPath>
  </defs>

  <!-- ── Background ── -->
  <rect x="0" y="0" width="${s}" height="${s}" rx="${radius}" ry="${radius}"
        fill="url(#bgGrad)"/>

  <!-- Subtle inner glow border -->
  <rect x="${s*0.01}" y="${s*0.01}"
        width="${s*0.98}" height="${s*0.98}"
        rx="${radius * 0.9}" ry="${radius * 0.9}"
        fill="none"
        stroke="${BRAND.accent}" stroke-opacity="0.18" stroke-width="${s*0.008}"/>

  <!-- ── Layers (3 rektang empile) ── -->
  <!-- Layer 3 (do, piti, pal) -->
  <rect x="${cx - lw3/2}" y="${lTop + lh1*2 + lGap*2}"
        width="${lw3}" height="${lh3}" rx="${lr3}" ry="${lr3}"
        fill="${BRAND.accent}" fill-opacity="0.35"
        filter="url(#glow)"/>

  <!-- Layer 2 (mitan) -->
  <rect x="${cx - lw2/2}" y="${lTop + lh1 + lGap}"
        width="${lw2}" height="${lh2}" rx="${lr2}" ry="${lr2}"
        fill="${BRAND.accent}" fill-opacity="0.65"
        filter="url(#glow)"/>

  <!-- Layer 1 (devan, gwo, plen) -->
  <rect x="${cx - lw1/2}" y="${lTop}"
        width="${lw1}" height="${lh1}" rx="${lr1}" ry="${lr1}"
        fill="url(#layerGrad)"
        filter="url(#glow)"/>

  <!-- ── WiFi arcs ── -->
  <!-- Ark 3 (gwo, pal) -->
  <path d="${wifiArc(wCx, wCy, wR3, wSW)}"
        fill="none" stroke="${BRAND.accent}" stroke-opacity="0.3"
        stroke-width="${wSW}" stroke-linecap="round"
        filter="url(#glowSoft)"/>

  <!-- Ark 2 (mwayen) -->
  <path d="${wifiArc(wCx, wCy, wR2, wSW)}"
        fill="none" stroke="${BRAND.accent}" stroke-opacity="0.6"
        stroke-width="${wSW}" stroke-linecap="round"
        filter="url(#glowSoft)"/>

  <!-- Ark 1 (piti, plen) -->
  <path d="${wifiArc(wCx, wCy, wR1, wSW)}"
        fill="none" stroke="url(#layerGrad)"
        stroke-width="${wSW}" stroke-linecap="round"
        filter="url(#glowSoft)"/>

  <!-- Dot WiFi -->
  <circle cx="${wCx}" cy="${wCy + wSW/2}" r="${wDot}"
          fill="url(#layerGrad)"
          filter="url(#glow)"/>

  <!-- ── Lejann tèks (opsyonèl, sèlman si size >= 200) ── -->
  ${size >= 200 ? `
  <text x="${cx}" y="${s * 0.94}"
        font-family="'Space Grotesk', 'Helvetica Neue', Arial, sans-serif"
        font-size="${s * 0.075}" font-weight="700"
        fill="${BRAND.white}" fill-opacity="0.55"
        text-anchor="middle" letter-spacing="${s * 0.008}">LAN SHARE</text>
  ` : ''}
</svg>`;
}

/**
 * Kalkile path pou yon demi-sèk WiFi.
 * Sèlman pati siperyè (180° ark).
 */
function wifiArc(cx, cy, r, strokeW) {
  // Arc de 220° centré en bas (comme icône WiFi classique)
  // De -110° à +110° (0° = droite, sens trigonométrique)
  const startAngle = (180 + 35) * Math.PI / 180;  // 215°
  const endAngle   = (360 - 35) * Math.PI / 180;  // 325°
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

// ─── Ekri SVG fichye ──────────────────────────────────────────

function writeSVG() {
  const svgContent = buildSVG(500);
  const outMain    = path.join(ICONS_DIR, 'icon.svg');
  const outRenderer= path.join(RENDERER_DIR, 'logo.svg');

  fs.writeFileSync(outMain,     svgContent);
  fs.writeFileSync(outRenderer, svgContent);
  console.log('✅ SVG     →', outMain);
  console.log('✅ SVG     →', outRenderer);
}

// ═══════════════════════════════════════════════════════════════
//  2. PNG multi-size (via Canvas si disponib, osinon SVG raw)
// ═══════════════════════════════════════════════════════════════

const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

async function writePNGs() {
  // Eseye itilize canvas npm package
  let createCanvas;
  try {
    ({ createCanvas } = require('canvas'));
    console.log('ℹ️  Canvas disponib — ap jenere PNG reyèl');
    await writePNGsWithCanvas(createCanvas);
  } catch (_) {
    // Canvas pa disponib: ekri placeholder SVG ki rename .png
    // Electron ka li SVG dirèkteman kòm icon sou plizyè platfòm
    console.log('ℹ️  Canvas pa disponib — ap kopye SVG kòm PNG placeholder');
    writePNGsAsSVGFallback();
  }
}

async function writePNGsWithCanvas(createCanvas) {
  const { loadImage } = require('canvas');

  // Jenere SVG pou chak tay, konvèti an PNG
  for (const size of PNG_SIZES) {
    const canvas = createCanvas(size, size);
    const ctx    = canvas.getContext('2d');

    // Kreye SVG pou dimansyon sa a
    const svgBuf = Buffer.from(buildSVG(size));
    const img    = await loadImage(svgBuf);
    ctx.drawImage(img, 0, 0, size, size);

    const pngBuf  = canvas.toBuffer('image/png');
    const outPath = path.join(ICONS_DIR, `icon_${size}.png`);
    fs.writeFileSync(outPath, pngBuf);
    console.log(`✅ PNG ${String(size).padStart(4)}px →`, outPath);
  }

  // Kopye 512px kòm icon.png (sèvi pou Linux)
  fs.copyFileSync(
    path.join(ICONS_DIR, 'icon_512.png'),
    path.join(ICONS_DIR, 'icon.png')
  );
  console.log('✅ PNG     → assets/icons/icon.png (Linux AppImage icon)');
}

function writePNGsAsSVGFallback() {
  // Ekri SVG pou chak tay kòm .png (non-standard, men fonksyonèl pou dev)
  for (const size of PNG_SIZES) {
    const svgContent = buildSVG(size);
    const outPath    = path.join(ICONS_DIR, `icon_${size}.png`);
    fs.writeFileSync(outPath, svgContent);
    console.log(`✅ SVG→PNG ${String(size).padStart(4)}px →`, outPath);
  }
  // icon.png pou Linux
  fs.copyFileSync(
    path.join(ICONS_DIR, 'icon_512.png'),
    path.join(ICONS_DIR, 'icon.png')
  );
  console.log('✅ SVG→PNG → assets/icons/icon.png');

  console.log('');
  console.log('  💡 Pou vrè PNG binè, enstale canvas:');
  console.log('     npm install canvas');
  console.log('     Epi relanse: node generate-assets.js');
}

// ═══════════════════════════════════════════════════════════════
//  3. ICO  (Windows) — fòma multi-size binè natif
// ═══════════════════════════════════════════════════════════════

/**
 * Kreye yon fichye .ico de baz ki genyen 4 tay: 16, 32, 48, 256.
 *
 * Fòma ICO:
 *   Header  6 bytes
 *   N × Directory entry  16 bytes
 *   N × Image data (PNG embeds, pou 256px; BMP pou rès)
 *
 * Nou itilize PNG-inside-ICO (sipòte depi Windows Vista):
 *   Chak entry se sèlman referans yon PNG konplè andedan ICO.
 */
async function writeICO() {
  let createCanvas, loadImage;
  try {
    ({ createCanvas, loadImage } = require('canvas'));
  } catch (_) {
    // San canvas, kreye yon ICO placeholder minimòm
    writeICOMinimal();
    return;
  }

  const icoSizes = [16, 32, 48, 256];
  const pngBuffers = [];

  for (const size of icoSizes) {
    const canvas = createCanvas(size, size);
    const ctx    = canvas.getContext('2d');
    const svgBuf = Buffer.from(buildSVG(size));
    const img    = await loadImage(svgBuf);
    ctx.drawImage(img, 0, 0, size, size);
    pngBuffers.push({ size, buf: canvas.toBuffer('image/png') });
  }

  const icoBuffer = buildICOBuffer(pngBuffers);
  const outPath   = path.join(ICONS_DIR, 'icon.ico');
  fs.writeFileSync(outPath, icoBuffer);
  console.log('✅ ICO     →', outPath);
}

/**
 * Konstrui ICO buffer kòrèkteman.
 * @param {{ size: number, buf: Buffer }[]} entries
 * @returns {Buffer}
 */
function buildICOBuffer(entries) {
  const N = entries.length;

  // Header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // Reserved
  header.writeUInt16LE(1, 2);   // Type: 1 = ICO
  header.writeUInt16LE(N, 4);   // Number of images

  // Directory: 16 bytes × N
  const dirSize  = N * 16;
  const dirBuf   = Buffer.alloc(dirSize);
  const dataOffset0 = 6 + dirSize;

  let offset = dataOffset0;
  entries.forEach(({ size, buf }, i) => {
    const base = i * 16;
    dirBuf.writeUInt8(size >= 256 ? 0 : size, base);      // Width  (0 = 256)
    dirBuf.writeUInt8(size >= 256 ? 0 : size, base + 1);  // Height (0 = 256)
    dirBuf.writeUInt8(0,    base + 2);  // Color count (0 = truecolor)
    dirBuf.writeUInt8(0,    base + 3);  // Reserved
    dirBuf.writeUInt16LE(1, base + 4);  // Color planes
    dirBuf.writeUInt16LE(32,base + 6);  // Bits per pixel
    dirBuf.writeUInt32LE(buf.length, base + 8);  // Size of image data
    dirBuf.writeUInt32LE(offset,     base + 12); // Offset of image data
    offset += buf.length;
  });

  const dataBufs = entries.map(e => e.buf);
  return Buffer.concat([header, dirBuf, ...dataBufs]);
}

/** ICO minimal 1×1 pixel pou si canvas pa disponib */
function writeICOMinimal() {
  // ICO 1×1 blank valide (32 bytes)
  const minimal = Buffer.from([
    0x00,0x00, 0x01,0x00, 0x01,0x00,          // Header: ICO, 1 entry
    0x01,0x01,0x00,0x00,0x01,0x00,             // Dir: 1×1, 1 plane
    0x18,0x00, 0x28,0x00,0x00,0x00,            // 24 bpp, offset
    0x28,0x00,0x00,0x00,                        // BMP header size
    0x01,0x00,0x00,0x00, 0x02,0x00,0x00,0x00,  // width=1, height=2(XOR+AND)
    0x01,0x00, 0x18,0x00,                       // planes, bpp
    0x00,0x00,0x00,0x00, 0x06,0x00,0x00,0x00,  // compression, size
    0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,  // resolution
    0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,  // colors
    0x0f,0x17,0x2a,                             // pixel BGR (#2a170f ≈ navy)
    0x00,                                        // padding
    0x00,0x00,0x00,0x00,                        // AND mask
  ]);
  const outPath = path.join(ICONS_DIR, 'icon.ico');
  fs.writeFileSync(outPath, minimal);
  console.log('✅ ICO     →', outPath, '(placeholder — enstale canvas pou vrè ICO)');
}

// ═══════════════════════════════════════════════════════════════
//  4. ICNS  (macOS, sèlman si sou darwin)
// ═══════════════════════════════════════════════════════════════

async function writeICNS() {
  if (process.platform !== 'darwin') {
    console.log('ℹ️  ICNS  — sote (sèlman nesesè sou macOS)');
    return;
  }

  let createCanvas, loadImage;
  try {
    ({ createCanvas, loadImage } = require('canvas'));
  } catch (_) {
    console.log('ℹ️  ICNS  — canvas pa disponib, sote');
    return;
  }

  // macOS ICNS sizes
  const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];
  const pngPaths  = [];

  for (const size of icnsSizes) {
    const canvas = createCanvas(size, size);
    const ctx    = canvas.getContext('2d');
    const svgBuf = Buffer.from(buildSVG(size));
    const img    = await loadImage(svgBuf);
    ctx.drawImage(img, 0, 0, size, size);
    const p = path.join(ICONS_DIR, `icon_tmp_${size}.png`);
    fs.writeFileSync(p, canvas.toBuffer('image/png'));
    pngPaths.push({ size, p });
  }

  // Sèvi iconutil macOS pou kreye .icns
  const { execSync } = require('child_process');
  const iconsetDir   = path.join(ICONS_DIR, 'icon.iconset');
  if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir);

  const icnsMap = {
    16: 'icon_16x16', 32: 'icon_16x16@2x',
    64: 'icon_32x32@2x', 128: 'icon_128x128',
    256: 'icon_128x128@2x', 512: 'icon_256x256@2x',
    1024: 'icon_512x512@2x',
  };

  pngPaths.forEach(({ size, p }) => {
    const name = icnsMap[size];
    if (name) fs.copyFileSync(p, path.join(iconsetDir, `${name}.png`));
    fs.unlinkSync(p); // nèt temp
  });

  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(ICONS_DIR, 'icon.icns')}"`);
    fs.rmSync(iconsetDir, { recursive: true });
    console.log('✅ ICNS    →', path.join(ICONS_DIR, 'icon.icns'));
  } catch (e) {
    console.warn('⚠️  iconutil echwe:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  5. MANIFEST — lis tout fichye jenere
// ═══════════════════════════════════════════════════════════════

function writeManifest() {
  const files = fs.readdirSync(ICONS_DIR).map(f => ({
    file: f,
    size: fs.statSync(path.join(ICONS_DIR, f)).size,
  }));

  const manifest = {
    generated: new Date().toISOString(),
    brandColors: BRAND,
    files,
  };

  const outPath = path.join(ICONS_DIR, 'manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log('✅ Manifest →', outPath);
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   LAN Share — Asset Generator  v1.0  ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');

  console.log('📐 Jenerasyon SVG...');
  writeSVG();

  console.log('');
  console.log('🖼️  Jenerasyon PNG multi-size...');
  await writePNGs();

  console.log('');
  console.log('🪟  Jenerasyon ICO (Windows)...');
  await writeICO();

  console.log('');
  console.log('🍎  Jenerasyon ICNS (macOS)...');
  await writeICNS();

  console.log('');
  console.log('📋 Ekri manifest...');
  writeManifest();

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('✅ Done! Tout assets nan  assets/icons/');
  console.log('   renderer/logo.svg  disponib pou UI');
  console.log('');
  console.log('   Pou vrè PNG/ICO (kòrèk):');
  console.log('   npm install canvas && node generate-assets.js');
  console.log('═══════════════════════════════════════════');
  console.log('');
}

main().catch(err => {
  console.error('❌ Erè:', err);
  process.exit(1);
});