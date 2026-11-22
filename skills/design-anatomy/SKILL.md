---
name: design-anatomy
description: Break a flat design image (banner, poster, thumbnail, social post, UI screenshot, LP section) into its anatomy — background, headline, sub copy, illustration, CTA, logo, etc. — judged from the actual text and imagery, and output a structured anatomy JSON plus a one-sheet wireframe diagram (SVG). Use when the user asks to analyze/deconstruct/wireframe a design image, e.g. "このバナーを分解して", "要素を図解して", "ワイヤーフレームにして", "design anatomy", "anatomy図にして".
license: MIT
---

# design-anatomy

Turn a finished design image into an **anatomy sheet**: the original with numbered markers, a wireframe redraw, and an element list — one image.

Division of labour:
- **You (the agent)** understand the design: which element plays which role, the reading order, the content.
- **`scripts/anatomy.mjs`** (Node ≥ 18, no dependencies) does the deterministic work: measure, OCR, validate, draw.

All script paths below are relative to the directory containing this SKILL.md.

## Workflow

### 1. Measure

```bash
node scripts/anatomy.mjs probe <image>
```

Use the returned `width`/`height` as the coordinate space. Every bbox is in **source pixels, top-left origin**.

### 2. OCR (recommended for text positions)

```bash
node scripts/anatomy.mjs ocr <image>          # auto: macOS Vision → tesseract → none
```

- macOS Vision handles Japanese without setup. tesseract needs language data for non-English (`jpn`).
- If the result is `engine: "none"`, continue and estimate text boxes visually.
- OCR boxes are **anchors, not answers**: merge lines that form one element (a 2-line headline is one `headline` with `lines: 2`), drop noise, and correct misread text by looking at the image.

### 3. Look and decide

View the image yourself. For each meaningful element decide:

| role | use for |
|---|---|
| `background` | the full-bleed base (color, photo, gradient). Usually one, covering the canvas. |
| `headline` / `subheadline` / `body` / `caption` | text by hierarchy. The largest, most attention-grabbing copy is `headline`. |
| `price` / `date` / `label` | text with a specific job (prices, dates/periods, small tags like "NEW"). |
| `illustration` / `photo` / `product` / `character` / `icon` | imagery. Pick by how it was made and what it shows. |
| `cta` / `button` / `link` | anything asking for action ("詳しくはこちら", "予約する"). |
| `logo` | brand marks and wordmarks. |
| `badge` / `decoration` / `shape` / `divider` | ornaments, ribbons, seals, lines, frames that carry no message by themselves. |
| `container` / `card` / `frame` / `nav` | regions that group other elements (use `parent` on children). |
| `other` | only if nothing above fits. |

Rules:
- **Order `elements` by reading order** (where the eye goes first → last), with `background` first. The sheet numbers follow this order.
- Text roles: `content` is the **exact visible text** (`\n` for line breaks). Never invent copy.
- Image roles: `content` is a short description of what is depicted ("湯気の立つコーヒーカップのイラスト").
- Prefer fewer, meaningful elements over many fragments (aim for 4–15).
- Put a `confidence` (0–1) on anything you're unsure about, and note uncertainties in `notes`.
- Add 2–5 `notes` about the layout itself: grid/alignment, hierarchy, visual flow, whitespace — this is the design insight the user is after.

### 4. Write the anatomy JSON

Save next to the image as `<image-name>.anatomy.json`. Schema: `schema/anatomy.schema.json`. Minimal shape:

```json
{
  "version": "0.1",
  "summary": "カフェの夏季限定ドリンク告知バナー",
  "source": { "path": "banner.png", "width": 1200, "height": 628, "type": "banner" },
  "elements": [
    { "id": "bg", "role": "background", "bbox": { "x": 0, "y": 0, "w": 1200, "h": 628 }, "content": "ベージュの単色" },
    { "id": "h1", "role": "headline", "bbox": { "x": 72, "y": 180, "w": 520, "h": 150 }, "lines": 2, "content": "夏の\nアイスラテ", "source": "ocr+vision" }
  ],
  "notes": ["左にテキスト、右にビジュアルの2カラム構成"]
}
```

`source.path` is relative to the JSON file.

### 5. Render and self-check

```bash
node scripts/anatomy.mjs render <image-name>.anatomy.json --png      # → .anatomy.svg + .anatomy.png (sheet)
node scripts/anatomy.mjs render <file> --mode wireframe --png        # wireframe only, source size
node scripts/anatomy.mjs render <file> --mode overlay --png          # boxes on the original, source size
```

- `render` validates first and prints warnings (e.g. a bbox outside the canvas). `validate <file>` runs the check alone.
- `--png` rasterizes with `rsvg-convert` or headless Chrome/Chromium. (ImageMagick's built-in SVG renderer can't draw the embedded source image — don't use it for the sheet.)

Then **look at the PNG** — panel A shows your boxes over the original. If boxes are off, fix the JSON and render again (up to 2 passes).

### 6. Report

Give the user: the sheet path, the element list (number · role · content), and your layout notes. Keep it short.

## Optional integrations

These depend on the host agent's tools — skip silently when unavailable:
- **Figma** (e.g. Figma MCP `use_figma`): redraw the anatomy as editable frames named by role.
- Convert the anatomy into another spec (e.g. a banner generation schema) when the user has one.
