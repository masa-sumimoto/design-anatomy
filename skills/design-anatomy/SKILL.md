---
name: design-anatomy
description: Break a flat design image (banner, poster, thumbnail, social post, UI screenshot, LP section) into its anatomy — background, headline, sub copy, illustration, CTA, logo, etc. — judged from the actual text and imagery. Outputs a one-sheet wireframe diagram, a copy-paste content spec (size + type/value pairs), and a taste prompt that captures the look with all text and layout stripped. Use when the user asks to analyze/deconstruct/wireframe a design image, e.g. "このバナーを分解して", "要素を図解して", "ワイヤーフレームにして", "design anatomy", "anatomy図にして".
license: MIT
---

# design-anatomy

Turn a finished design image into three outputs:

1. **Anatomy sheet** (`.anatomy.png`) — the original with numbered markers, a wireframe redraw, the element list, and a palette/keyword strip.
2. **Content spec** (`.content.yaml`) — size and `type`/`value` pairs in reading order, ready to copy.
3. **Taste prompt** (`.taste.md`) — the look & feel only (no copy, no counts, no positions), ready to reuse for a new design in the same taste.

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

View the image yourself and assign each meaningful element a **role**. Roles by group (full definitions and examples: `references/roles.md` — read it when unsure):

| group | roles |
|---|---|
| Background | `background` |
| Text | `headline` `subheadline` `eyebrow` `heading` `body` `list` `info` `price` `date` `label` `caption` `note` `credit` `hashtag` `handle` `rating` `copy` · `other-text` |
| Image | `photo` `illustration` `product` `character` `icon` `avatar` `qr` `map` · `other-image` |
| Action | `cta` `button` `link` `input` `chip` |
| Brand | `logo` |
| Decoration | `badge` `shape` `divider` `decoration` |
| Container | `frame` `card` `container` `header` `nav` `statusbar` `tabbar` |
| Fallback | `other` |

**Can't decide?** Use `other-text` for text and `other-image` for imagery (`other` if even the group is unclear). They are drawn with a dashed outline so the user sees what is unresolved. Don't force a wrong role.

Rules:
- **Order `elements` by reading order** (where the eye goes first → last), with `background` first. The sheet numbers follow this order.
- Text roles: `content` is the **exact visible text** (`\n` for line breaks). Never invent copy.
- Badges, buttons, logos: `content` is **only their text** ("夏季限定"), never the shape or color — those belong in `taste`.
- Image roles: `content` is a short description of what is depicted ("湯気の立つコーヒーカップのイラスト").
- Prefer fewer, meaningful elements over many fragments (aim for 4–15; UI screens may need up to ~20).
- **Repeated components** (cards, list rows): break down the first instance with `parent`, then add the rest as single `card` elements whose `content` says "same structure as card1".
- OCR misreads happen (dropped kanji, wrong star counts). Always check text against the image.
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

### 4b. Check coverage (when OCR ran)

Save the OCR output (e.g. `<image-name>.ocr.json`) and run:

```bash
node scripts/anatomy.mjs coverage <image-name>.anatomy.json <image-name>.ocr.json
```

It lists OCR lines that no element accounts for. Add them to the right element, or run with `--apply` to append them as `other-text`, then reclassify what you can.

### 4c. Write the taste

Add a `taste` object to the JSON. It describes **how the design looks and feels, as if every word and the layout skeleton were removed** — so someone could make a different design with different copy in the same taste.

Must NOT contain: any visible copy, element counts ("three labels"), positions or sizes ("headline top-left"), brand names shown in the design.
Should cover:

| field | what to write |
|---|---|
| `prompt` | English, one paragraph, image-model friendly: style/genre/era → color mood → type character → imagery medium → texture/finish → mood. |
| `prompt_ja` | The same in Japanese. |
| `keywords` | 5–8 short tags. |
| `palette` | 3–6 colors: `hex`, an evocative `name`, and `use` (ground, type, accent...). |
| `typography` | Classification, weight, contrast, spacing, feel — never the words. |
| `imagery` | Photo/illustration medium, rendering style, lighting. |
| `texture` / `mood` | Surface & finish; emotional tone. |
| `references` | Eras, movements, genres, media it evokes (no living artists' names). |
| `assets` | One text-free generation prompt per key visual (`target` = element id/role). End each with "no text". |
| `negative` | What would break this taste. Include "any text inside generated images". |

Be specific and sensory ("oat-beige", "high-contrast Mincho", "matte, no gradients") rather than generic ("nice", "modern").

### 5. Render and self-check

```bash
node scripts/anatomy.mjs render <image-name>.anatomy.json --png      # → .anatomy.svg + .anatomy.png (sheet)
node scripts/anatomy.mjs render <file> --mode wireframe --png        # wireframe only, source size
node scripts/anatomy.mjs render <file> --mode overlay --png          # boxes on the original, source size
```

- `render` validates first and prints warnings (e.g. a bbox outside the canvas). `validate <file>` runs the check alone.
- `--png` rasterizes with `rsvg-convert` or headless Chrome/Chromium. (ImageMagick's built-in SVG renderer can't draw the embedded source image — don't use it for the sheet.)

Then **look at the PNG** — panel A shows your boxes over the original. If boxes are off, fix the JSON and render again (up to 2 passes).

Write the text outputs:

```bash
node scripts/anatomy.mjs brief <image-name>.anatomy.json   # → <image-name>.content.yaml + <image-name>.taste.md
```

### 6. Report

Give the user, briefly:
- **Size**: `width × height px` and aspect ratio (also printed on the sheet, e.g. `1080 × 1350 px · 4:5`).
- **The sheet** path (show the image if the host can display it).
- **The content spec**: paste the `.content.yaml` in a code block so it can be copied. Call out any `other-*` elements as unresolved.
- **The taste prompt**: paste `prompt` and `prompt_ja` in code blocks; mention the asset prompts are in `.taste.md`.
- Your layout notes (2–5 lines).

## Optional integrations

These depend on the host agent's tools — skip silently when unavailable:
- **Figma** (e.g. Figma MCP `use_figma`): redraw the anatomy as editable frames named by role.
- Convert the anatomy into another spec (e.g. a banner generation schema) when the user has one.
