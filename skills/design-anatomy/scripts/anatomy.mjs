#!/usr/bin/env node
// design-anatomy CLI — zero dependencies (Node >= 18).
//
//   node anatomy.mjs probe  <image>                      -> {"width","height","format"}
//   node anatomy.mjs ocr    <image> [--engine auto|vision|tesseract] [--lang jpn+eng]
//                                                        -> {"engine","lines":[{text,bbox,conf}]}
//   node anatomy.mjs coverage <anatomy.json> <ocr.json> [--apply]   -> OCR text no element accounts for
//   node anatomy.mjs validate <anatomy.json>
//   node anatomy.mjs render <anatomy.json> [--out file.svg] [--mode sheet|wireframe|overlay] [--png]
//
// The agent (Claude / Codex / Gemini ...) does the *understanding* (roles, reading order).
// This script only does the deterministic parts: measuring, OCR, and drawing.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, extname, basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) opt[k] = true;
      else { opt[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function die(msg) {
  process.stderr.write(`design-anatomy: ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// probe: read width/height from the file header (PNG / JPEG / GIF / WebP)
// ---------------------------------------------------------------------------
export function probe(file) {
  const b = readFileSync(file);
  // PNG
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // GIF
  if (b.toString("ascii", 0, 3) === "GIF") {
    return { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  // WebP
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return { format: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { format: "webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") {
      return { format: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
  }
  // JPEG: walk markers until a SOFn frame header
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      const isSOF = m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m);
      if (isSOF) return { format: "jpeg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  die(`unsupported or unreadable image: ${file}`);
}

// ---------------------------------------------------------------------------
// ocr: text lines with pixel bboxes. Vision (macOS, good for Japanese) or tesseract.
// ---------------------------------------------------------------------------
function has(cmd) {
  try { execFileSync("which", [cmd], { stdio: "ignore" }); return true; } catch { return false; }
}

function ocrVision(file) {
  const swiftFile = join(HERE, "ocr-vision.swift");
  const out = execFileSync("swift", [swiftFile, resolve(file)], { encoding: "utf8", maxBuffer: 1 << 26 });
  return JSON.parse(out);
}

const CJK = /[　-ヿ㐀-鿿＀-￯]/;

function ocrTesseract(file, lang) {
  const tsv = execFileSync("tesseract", [resolve(file), "stdout", "-l", lang, "tsv"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26,
  });
  const rows = tsv.trim().split("\n").slice(1).map((r) => r.split("\t"));
  const lines = new Map();
  for (const r of rows) {
    const [level, , block, par, line, , left, top, width, height, conf, ...rest] = r;
    const text = rest.join("\t").trim();
    if (level !== "5" || !text || Number(conf) < 0) continue;
    const key = `${block}.${par}.${line}`;
    const w = { text, x: +left, y: +top, w: +width, h: +height, conf: +conf };
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(w);
  }
  const result = [];
  for (const words of lines.values()) {
    let text = "";
    for (const w of words) {
      const glue = text && !(CJK.test(text.at(-1)) && CJK.test(w.text[0])) ? " " : "";
      text += glue + w.text;
    }
    const x = Math.min(...words.map((w) => w.x));
    const y = Math.min(...words.map((w) => w.y));
    const x2 = Math.max(...words.map((w) => w.x + w.w));
    const y2 = Math.max(...words.map((w) => w.y + w.h));
    const conf = words.reduce((s, w) => s + w.conf, 0) / words.length / 100;
    result.push({ text, bbox: { x, y, w: x2 - x, h: y2 - y }, conf: +conf.toFixed(2) });
  }
  return { engine: "tesseract", lines: result };
}

export function ocr(file, { engine = "auto", lang = "jpn+eng" } = {}) {
  const canVision = process.platform === "darwin" && has("swift");
  const canTess = has("tesseract");
  if (engine === "vision" || (engine === "auto" && canVision)) {
    if (!canVision) die("vision engine needs macOS + swift");
    return ocrVision(file);
  }
  if (engine === "tesseract" || engine === "auto") {
    if (!canTess) return { engine: "none", lines: [], note: "No OCR engine found. Estimate text boxes visually." };
    return ocrTesseract(file, lang);
  }
  die(`unknown engine: ${engine}`);
}

// ---------------------------------------------------------------------------
// render: anatomy.json -> one SVG sheet
// ---------------------------------------------------------------------------
// role -> group. Groups decide color + wireframe glyph. Unknown roles fall back to "other".
const ROLE_GROUP = {
  background: "background",
  headline: "text", subheadline: "text", body: "text", caption: "text",
  price: "text", date: "text", label: "text", copy: "text", "other-text": "text",
  eyebrow: "text", heading: "text", info: "text", list: "text", note: "text", credit: "text",
  hashtag: "text", handle: "text", rating: "text",
  illustration: "image", photo: "image", product: "image", icon: "image", character: "image", "other-image": "image",
  qr: "image", avatar: "image", map: "image",
  cta: "action", button: "action", link: "action", input: "action", chip: "action",
  logo: "brand",
  badge: "decoration", decoration: "decoration", shape: "decoration", divider: "decoration",
  frame: "container", container: "container", card: "container", nav: "container",
  header: "container", statusbar: "container", tabbar: "container",
};

const GROUP_STYLE = {
  background: { color: "#5B5B66", name: "Background" },
  text:       { color: "#2F6BFF", name: "Text" },
  image:      { color: "#E0752D", name: "Image" },
  action:     { color: "#D6336C", name: "Action" },
  brand:      { color: "#7B4FE0", name: "Brand" },
  decoration: { color: "#8C8C96", name: "Decoration" },
  container:  { color: "#1F9D8A", name: "Container" },
  other:      { color: "#8C8C96", name: "Other" },
};

const FONT = `'Hiragino Sans','Noto Sans JP','Yu Gothic',system-ui,sans-serif`;
const MONO = `ui-monospace,'SFMono-Regular',Menlo,monospace`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DISPLAY = { cta: "CTA", qr: "QR code", subheadline: "Sub headline", statusbar: "Status bar", tabbar: "Tab bar", "other-text": "Other text", "other-image": "Other image" };
// "other-*" = recognised as text/image but its role couldn't be decided -> dashed outline.
const isUnclassified = (el) => el.role === "other" || el.role?.startsWith("other-");
const title = (s) => DISPLAY[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
const groupOf = (el) => ROLE_GROUP[el.role] ?? "other";
const clip = (s, n) => { const a = [...String(s ?? "")]; return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join(""); };
const r1 = (n) => Math.round(n * 10) / 10;

function imageDataUri(path) {
  const ext = extname(path).toLowerCase().replace(".", "");
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] ?? "image/png";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

function badge(n, x, y, color, r = 11) {
  return `<g><circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/>` +
    `<text x="${r1(x)}" y="${r1(y + 4)}" text-anchor="middle" font-family="${MONO}" font-size="${r <= 11 ? 11 : 12}" font-weight="700" fill="#fff">${n}</text></g>`;
}

// One element in wireframe style. (x,y,w,h) already scaled to the panel.
function glyph(el, g, x, y, w, h) {
  const c = GROUP_STYLE[g].color;
  const dash = isUnclassified(el) ? ` stroke-dasharray="5 3"` : "";
  const out = [];
  if (g === "background") {
    out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="#EFEFF3"/>`);
    return out.join("");
  }
  if (g === "text") {
    const n = Math.max(1, Math.min(6, el.lines ?? String(el.content ?? "").split("\n").length));
    const pad = Math.min(4, h * 0.1);
    const slot = (h - pad * 2) / n;
    const bar = Math.max(2, slot * (el.role === "headline" ? 0.5 : 0.38));
    out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="#fff" fill-opacity=".55" stroke="${c}" stroke-width="1.5"${dash}/>`);
    for (let i = 0; i < n; i++) {
      const bw = i === n - 1 && n > 1 ? w * 0.62 : w - pad * 2;
      const by = y + pad + slot * i + (slot - bar) / 2;
      out.push(`<rect x="${r1(x + pad)}" y="${r1(by)}" width="${r1(Math.max(4, bw))}" height="${r1(bar)}" rx="${r1(bar / 2)}" fill="${c}" fill-opacity="${el.role === "headline" ? 0.55 : 0.3}"/>`);
    }
    return out.join("");
  }
  if (g === "image") {
    out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="#E3E3E8" stroke="${c}" stroke-width="1.5"${dash}/>`);
    out.push(`<path d="M${r1(x)} ${r1(y)}L${r1(x + w)} ${r1(y + h)}M${r1(x + w)} ${r1(y)}L${r1(x)} ${r1(y + h)}" stroke="#B9B9C2" stroke-width="1"/>`);
    return out.join("");
  }
  if (g === "action") {
    const rx = Math.min(h / 2, 14);
    out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(rx)}" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="1.5"/>`);
    const bar = Math.max(2, Math.min(h * 0.22, 10));
    out.push(`<rect x="${r1(x + w * 0.25)}" y="${r1(y + (h - bar) / 2)}" width="${r1(w * 0.5)}" height="${r1(bar)}" rx="${r1(bar / 2)}" fill="${c}" fill-opacity=".6"/>`);
    return out.join("");
  }
  if (g === "brand") {
    const s = Math.min(h * 0.6, w * 0.3);
    out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="#fff" fill-opacity=".55" stroke="${c}" stroke-width="1.5"/>`);
    out.push(`<circle cx="${r1(x + h * 0.2 + s / 2)}" cy="${r1(y + h / 2)}" r="${r1(s / 2)}" fill="${c}" fill-opacity=".35"/>`);
    const bar = Math.max(2, Math.min(h * 0.22, 10));
    out.push(`<rect x="${r1(x + h * 0.2 + s + h * 0.2)}" y="${r1(y + (h - bar) / 2)}" width="${r1(Math.max(4, w - s - h * 0.6))}" height="${r1(bar)}" rx="${r1(bar / 2)}" fill="${c}" fill-opacity=".35"/>`);
    return out.join("");
  }
  if (g === "container") {
    out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${c}" fill-opacity=".06" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/>`);
    return out.join("");
  }
  if (el.role === "badge") {
    const rx = Math.min(w, h) / 2;
    out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(rx)}" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="1.5"/>`);
    const bar = Math.max(2, Math.min(h * 0.18, 10));
    out.push(`<rect x="${r1(x + w * 0.22)}" y="${r1(y + (h - bar) / 2)}" width="${r1(w * 0.56)}" height="${r1(bar)}" rx="${r1(bar / 2)}" fill="${c}" fill-opacity=".7"/>`);
    return out.join("");
  }
  // decoration / other
  out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="3 3"/>`);
  return out.join("");
}

// Badge sits on the element's top-left corner (so it never hides content), clamped into the panel.
function cornerBadge(el, ox, oy, s, pw, ph) {
  const r = 11;
  const x = Math.min(Math.max(ox + el.bbox.x * s, ox + r), ox + pw - r);
  const y = Math.min(Math.max(oy + el.bbox.y * s, oy + r), oy + ph - r);
  return { x, y };
}

// Containers sit between the background and the content so their tint never covers content.
const DEFAULT_Z = { background: -2, container: -1 };

// Nudge marker badges that would land on top of each other (e.g. background + frame corners).
function placeBadges(items) {
  const placed = [];
  for (const it of items) {
    let { x, y } = it;
    while (placed.some((p) => Math.hypot(p.x - x, p.y - y) < 22)) x += 24;
    placed.push({ x, y });
    it.x = x; it.y = y;
  }
  return items;
}

function ordered(elements) {
  // number in reading order (array order), draw in z order (background first)
  const numbered = elements.map((el, i) => ({ ...el, n: i + 1 }));
  const drawOrder = [...numbered].sort((a, b) => {
    const za = a.z ?? DEFAULT_Z[groupOf(a)] ?? 0;
    const zb = b.z ?? DEFAULT_Z[groupOf(b)] ?? 0;
    return za - zb || a.n - b.n;
  });
  return { numbered, drawOrder };
}

function panelWireframe(doc, ox, oy, s, { tags = false } = {}) {
  const { width: W, height: H } = doc.source;
  const { drawOrder } = ordered(doc.elements);
  const parts = [`<rect x="${ox}" y="${oy}" width="${r1(W * s)}" height="${r1(H * s)}" fill="#FAFAFB" stroke="#D4D4DA"/>`];
  for (const el of drawOrder) {
    const { x, y, w, h } = el.bbox;
    parts.push(glyph(el, groupOf(el), ox + x * s, oy + y * s, w * s, h * s));
  }
  const marks = placeBadges(drawOrder.map((el) => ({ el, ...cornerBadge(el, ox, oy, s, W * s, H * s) })));
  for (const { el, x: bx, y: by } of marks) {
    const g = groupOf(el);
    parts.push(badge(el.n, bx, by, GROUP_STYLE[g].color));
    const tag = el.label ?? title(el.role);
    if (tags && el.bbox.w * s > 90) {
      const tw = [...clip(tag, 18)].reduce((n, ch) => n + (CJK.test(ch) ? 11 : 6.6), 0) + 8;
      parts.push(`<rect x="${r1(bx + 13)}" y="${r1(by - 8)}" width="${r1(tw)}" height="16" rx="3" fill="#EFEFF3"/>`);
      parts.push(`<text x="${r1(bx + 16)}" y="${r1(by + 4)}" font-family="${FONT}" font-size="11" font-weight="600" fill="${GROUP_STYLE[g].color}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(clip(tag, 18))}</text>`);
    }
  }
  return parts.join("\n");
}

function panelOverlay(doc, ox, oy, s, href) {
  const { width: W, height: H } = doc.source;
  const { drawOrder } = ordered(doc.elements);
  const parts = [];
  if (href) parts.push(`<image href="${href}" x="${ox}" y="${oy}" width="${r1(W * s)}" height="${r1(H * s)}" preserveAspectRatio="none"/>`);
  else parts.push(`<rect x="${ox}" y="${oy}" width="${r1(W * s)}" height="${r1(H * s)}" fill="#DDD"/>`);
  parts.push(`<rect x="${ox}" y="${oy}" width="${r1(W * s)}" height="${r1(H * s)}" fill="none" stroke="#D4D4DA"/>`);
  for (const el of drawOrder) {
    const g = groupOf(el);
    if (g === "background") continue;
    const { x, y, w, h } = el.bbox;
    parts.push(`<rect x="${r1(ox + x * s)}" y="${r1(oy + y * s)}" width="${r1(w * s)}" height="${r1(h * s)}" fill="none" stroke="${GROUP_STYLE[g].color}" stroke-width="2"${isUnclassified(el) ? ` stroke-dasharray="5 3"` : ""}/>`);
  }
  const marks = placeBadges(drawOrder.map((el) => ({ el, ...cornerBadge(el, ox, oy, s, W * s, H * s) })));
  for (const { el, x, y } of marks) parts.push(badge(el.n, x, y, GROUP_STYLE[groupOf(el)].color));
  return parts.join("\n");
}

function legend(doc, ox, oy, width) {
  const { numbered } = ordered(doc.elements);
  const cols = width >= 900 ? 2 : 1;
  const colW = (width - (cols - 1) * 32) / cols;
  const rowH = 30;
  const perCol = Math.ceil(numbered.length / cols);
  const maxChars = Math.floor((colW - 190) / 12);
  const parts = [];
  numbered.forEach((el, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = ox + col * (colW + 32), y = oy + row * rowH;
    const g = groupOf(el);
    const c = GROUP_STYLE[g].color;
    parts.push(`<line x1="${x}" y1="${y + rowH - 4}" x2="${r1(x + colW)}" y2="${y + rowH - 4}" stroke="#ECECF0"/>`);
    parts.push(badge(el.n, x + 11, y + 11, c));
    parts.push(`<text x="${x + 30}" y="${y + 15}" font-family="${FONT}" font-size="12" font-weight="700" fill="#1C1C22">${esc(clip(el.label ?? title(el.role), 14))}</text>`);
    parts.push(`<text x="${x + 140}" y="${y + 15}" font-family="${MONO}" font-size="10" fill="${c}">${esc(GROUP_STYLE[g].name)}</text>`);
    const body = el.content ? clip(String(el.content).replace(/\n/g, " / "), maxChars) : "";
    parts.push(`<text x="${x + 220}" y="${y + 15}" font-family="${FONT}" font-size="12" fill="#55555E">${esc(body)}</text>`);
  });
  return { svg: parts.join("\n"), height: perCol * rowH };
}

export function aspect(w, h) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  if (w / g <= 32 && h / g <= 32) return `${w / g}:${h / g}`;
  return w >= h ? `${(w / h).toFixed(2)}:1` : `1:${(h / w).toFixed(2)}`;
}

// Spec-style dimension lines: width under the panel, height on its left.
function dimensions(W, H, ox, oy, pw, ph) {
  const c = "#8C8C96", t = 4;
  const by = oy + ph + 16, lx = ox - 16;
  const font = `font-family="${MONO}" font-size="10" fill="${c}"`;
  return [
    `<path d="M${ox} ${by - t}V${by + t}M${r1(ox + pw)} ${by - t}V${by + t}M${ox} ${by}H${r1(ox + pw)}" stroke="${c}"/>`,
    `<rect x="${r1(ox + pw / 2 - 30)}" y="${by - 7}" width="60" height="14" fill="#fff"/>`,
    `<text x="${r1(ox + pw / 2)}" y="${by + 3.5}" text-anchor="middle" ${font}>${W} px</text>`,
    `<path d="M${lx - t} ${oy}H${lx + t}M${lx - t} ${r1(oy + ph)}H${lx + t}M${lx} ${oy}V${r1(oy + ph)}" stroke="${c}"/>`,
    `<rect x="${lx - 7}" y="${r1(oy + ph / 2 - 30)}" width="14" height="60" fill="#fff"/>`,
    `<text transform="translate(${lx + 3.5} ${r1(oy + ph / 2)}) rotate(-90)" text-anchor="middle" ${font}>${H} px</text>`,
  ].join("");
}

export function render(doc, { mode = "sheet", imagePath } = {}) {
  const { width: W, height: H } = doc.source;
  const href = imagePath && existsSync(imagePath) ? imageDataUri(imagePath) : null;

  if (mode === "wireframe" || mode === "overlay") {
    const body = mode === "wireframe" ? panelWireframe(doc, 0, 0, 1, { tags: true }) : panelOverlay(doc, 0, 0, 1, href);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${body}\n</svg>\n`;
  }

  // sheet: [original + markers] [wireframe] side by side, legend below.
  const M = 48, GAP = 32, HEAD = 104, PANEL_W = 560, PANEL_H = 860;
  const s = Math.min(PANEL_W / W, PANEL_H / H);
  const pw = W * s, ph = H * s;
  const sheetW = Math.round(M * 2 + pw * 2 + GAP);
  const lg = legend(doc, M, 0, sheetW - M * 2);
  const legendY = M + HEAD + ph + 72;
  const sheetH = Math.round(legendY + lg.height + M);

  const groupsUsed = [...new Set(doc.elements.map(groupOf))];
  let cx = sheetW - M;
  const chips = [...groupsUsed].reverse().map((g) => {
    const name = GROUP_STYLE[g].name;
    cx -= 16 + name.length * 6.8;
    const x = cx;
    cx -= 18;
    return `<circle cx="${r1(x + 5)}" cy="${M + 28}" r="5" fill="${GROUP_STYLE[g].color}"/><text x="${r1(x + 15)}" y="${M + 32}" font-family="${MONO}" font-size="11" fill="#55555E">${name}</text>`;
  }).join("");

  const name = doc.source.path ? basename(doc.source.path) : "untitled";
  const meta = `${name} · ${doc.source.type ?? "design"} · ${doc.elements.length} elements`;
  const size = `${W} × ${H} px  ·  ${aspect(W, H)}`;
  const labelY = M + HEAD - 12;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">
<rect width="100%" height="100%" fill="#FFFFFF"/>
<text x="${M}" y="${M + 6}" font-family="${MONO}" font-size="11" letter-spacing="2" fill="#8C8C96">DESIGN ANATOMY</text>
<text x="${M}" y="${M + 34}" font-family="${FONT}" font-size="22" font-weight="700" fill="#1C1C22">${esc(clip(doc.summary ?? name, 40))}</text>
<text x="${M}" y="${M + 56}" font-family="${MONO}" font-size="11" fill="#8C8C96">${esc(meta)}</text>
${chips}
<text x="${M}" y="${labelY}" font-family="${MONO}" font-size="10" letter-spacing="1.5" fill="#8C8C96">A — SOURCE</text>
<text x="${r1(M + pw)}" y="${labelY}" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="700" fill="#1C1C22">${size}</text>
<text x="${r1(M + pw + GAP)}" y="${labelY}" font-family="${MONO}" font-size="10" letter-spacing="1.5" fill="#8C8C96">B — WIREFRAME</text>
${panelOverlay(doc, M, M + HEAD, s, href)}
${dimensions(W, H, M, M + HEAD, pw, ph)}
${panelWireframe(doc, r1(M + pw + GAP), M + HEAD, s)}
<text x="${M}" y="${legendY - 18}" font-family="${MONO}" font-size="10" letter-spacing="1.5" fill="#8C8C96">C — ELEMENTS (reading order)</text>
${shiftY(lg.svg, legendY)}
</svg>
`;
}

// legend() was laid out at y=0; move it down to the legend block.
function shiftY(svg, dy) {
  return svg.replace(/\b(y|y1|y2|cy)="([\d.]+)"/g, (_, k, v) => `${k}="${r1(Number(v) + dy)}"`);
}

// ---------------------------------------------------------------------------
// rasterize: SVG -> PNG. ImageMagick's built-in SVG renderer can't read the embedded
// data-URI image, so prefer rsvg-convert, then a headless Chrome/Chromium.
// ---------------------------------------------------------------------------
const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome", "chromium", "chromium-browser",
];

export function rasterize(svgPath, pngPath) {
  const svg = readFileSync(svgPath, "utf8");
  const w = Number(svg.match(/width="(\d+)"/)?.[1]);
  const h = Number(svg.match(/height="(\d+)"/)?.[1]);
  if (has("rsvg-convert")) {
    execFileSync("rsvg-convert", ["-z", "2", "-o", pngPath, svgPath]);
    return pngPath;
  }
  const chrome = CHROMES.find((c) => (c.startsWith("/") ? existsSync(c) : has(c)));
  if (chrome) {
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
      `--window-size=${w},${h}`, `--screenshot=${resolve(pngPath)}`, `file://${resolve(svgPath)}`,
    ], { stdio: "ignore" });
    return pngPath;
  }
  die("no rasterizer found (install librsvg or Chrome), or open the SVG in a browser.");
}

// ---------------------------------------------------------------------------
// coverage: OCR lines that no element accounts for -> candidates for "other-text"
// ---------------------------------------------------------------------------
function overlapRatio(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h || 1); // share of OCR box `a` inside element `b`
}

export function coverage(doc, ocrResult, { threshold = 0.6 } = {}) {
  // An element "holds" text unless it is the background, a whole-canvas frame, or a parent
  // whose children carry the text. (Otherwise a frame would "cover" every line and hide misses.)
  const parents = new Set(doc.elements.map((el) => el.parent).filter(Boolean));
  const holders = doc.elements.filter((el) =>
    groupOf(el) !== "background" && el.role !== "frame" && !parents.has(el.id));
  const uncovered = [];
  let covered = 0;
  for (const line of ocrResult.lines ?? []) {
    if (!line.text?.trim()) continue;
    const hit = holders.some((el) => overlapRatio(line.bbox, el.bbox) >= threshold);
    if (hit) covered++; else uncovered.push(line);
  }
  return { covered, uncovered };
}

// ---------------------------------------------------------------------------
// validate (light): catches the mistakes agents actually make
// ---------------------------------------------------------------------------
export function validate(doc) {
  const errs = [];
  const warn = [];
  const src = doc.source ?? {};
  if (!(src.width > 0 && src.height > 0)) errs.push("source.width/height must be positive numbers (run `probe`).");
  if (!Array.isArray(doc.elements) || !doc.elements.length) errs.push("elements[] must be a non-empty array.");
  const ids = new Set();
  (doc.elements ?? []).forEach((el, i) => {
    const at = `elements[${i}]${el.id ? ` (${el.id})` : ""}`;
    if (!el.role) errs.push(`${at}: role is required.`);
    else if (!ROLE_GROUP[el.role] && el.role !== "other") warn.push(`${at}: unknown role "${el.role}" -> drawn as "other".`);
    if (el.id) { if (ids.has(el.id)) errs.push(`${at}: duplicate id.`); ids.add(el.id); }
    const b = el.bbox;
    if (!b || [b.x, b.y, b.w, b.h].some((v) => typeof v !== "number")) { errs.push(`${at}: bbox {x,y,w,h} numbers required.`); return; }
    if (b.w <= 0 || b.h <= 0) errs.push(`${at}: bbox w/h must be > 0.`);
    if (b.x < 0 || b.y < 0 || b.x + b.w > src.width + 1 || b.y + b.h > src.height + 1) warn.push(`${at}: bbox exceeds the canvas.`);
  });
  return { errs, warn };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  if (cmd === "probe") {
    if (!pos[0]) die("usage: probe <image>");
    process.stdout.write(JSON.stringify(probe(pos[0])) + "\n");
  } else if (cmd === "ocr") {
    if (!pos[0]) die("usage: ocr <image> [--engine auto|vision|tesseract] [--lang jpn+eng]");
    process.stdout.write(JSON.stringify(ocr(pos[0], { engine: opt.engine, lang: opt.lang }), null, 2) + "\n");
  } else if (cmd === "render") {
    if (!pos[0]) die("usage: render <anatomy.json> [--out file.svg] [--mode sheet|wireframe|overlay] [--png]");
    const jsonPath = resolve(pos[0]);
    const doc = JSON.parse(readFileSync(jsonPath, "utf8"));
    const { errs, warn } = validate(doc);
    warn.forEach((w) => process.stderr.write(`warn: ${w}\n`));
    if (errs.length) die("invalid anatomy:\n  - " + errs.join("\n  - "));
    const imagePath = doc.source.path ? resolve(dirname(jsonPath), doc.source.path) : null;
    const svg = render(doc, { mode: opt.mode ?? "sheet", imagePath });
    const out = opt.out ?? jsonPath.replace(/\.json$/i, "") + (opt.mode && opt.mode !== "sheet" ? `.${opt.mode}` : "") + ".svg";
    writeFileSync(out, svg);
    process.stdout.write(out + "\n");
    if (opt.png) process.stdout.write(rasterize(out, out.replace(/\.svg$/i, ".png")) + "\n");
  } else if (cmd === "coverage") {
    if (!pos[1]) die("usage: coverage <anatomy.json> <ocr.json> [--apply]");
    const doc = JSON.parse(readFileSync(pos[0], "utf8"));
    const res = coverage(doc, JSON.parse(readFileSync(pos[1], "utf8")));
    process.stdout.write(`covered: ${res.covered}, uncovered: ${res.uncovered.length}\n`);
    res.uncovered.forEach((l) => process.stdout.write(`  - "${l.text}" @ ${JSON.stringify(l.bbox)}\n`));
    if (opt.apply && res.uncovered.length) {
      res.uncovered.forEach((l, i) => doc.elements.push({
        id: `other-text-${i + 1}`, role: "other-text", bbox: l.bbox, content: l.text,
        confidence: l.conf, source: "ocr",
      }));
      writeFileSync(pos[0], JSON.stringify(doc, null, 2) + "\n");
      process.stdout.write(`appended ${res.uncovered.length} other-text element(s) to ${pos[0]}\n`);
    }
  } else if (cmd === "validate") {
    const doc = JSON.parse(readFileSync(pos[0], "utf8"));
    const { errs, warn } = validate(doc);
    warn.forEach((w) => process.stdout.write(`warn: ${w}\n`));
    errs.forEach((e) => process.stdout.write(`error: ${e}\n`));
    process.stdout.write(errs.length ? "invalid\n" : "ok\n");
    process.exit(errs.length ? 1 : 0);
  } else {
    die("commands: probe | ocr | coverage | validate | render");
  }
}
