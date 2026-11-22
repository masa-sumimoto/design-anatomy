# design-anatomy

> An agent skill that turns a flat design image into an **anatomy sheet** (numbered markers, wireframe, element list, palette), a **content spec** (size + type/value pairs), and a **taste prompt** (the look & feel with all copy and layout stripped).
>
> バナーやポスターなどのデザイン画像を、背景・見出し・サブコピー・イラスト・CTA などの要素に分解して、**1枚の図版（anatomy 図）** にするエージェント用 skill です。

![example sheet](examples/cafe-banner.anatomy.png)

Works with any agent that reads the [Agent Skills](https://agentskills.io) `SKILL.md` format — Claude Code, Codex, Gemini CLI, GitHub Copilot, and others.

## How it works / しくみ

| step | who | what |
|---|---|---|
| measure | script | read image size (`probe`) |
| OCR | script | text lines + pixel boxes (`ocr`: macOS Vision → tesseract) |
| understand | **agent** | decide each element's role, reading order, and content by looking at the image |
| write | agent | `<image>.anatomy.json` ([schema](skills/design-anatomy/schema/anatomy.schema.json)) |
| taste | **agent** | describe the look without words or layout → `taste` in the JSON |
| draw | script | SVG/PNG sheet (`render`) |
| brief | script | `<image>.content.yaml` + `<image>.taste.md` (`brief`) |

The agent does the judgement; a zero-dependency Node script does the deterministic parts.
判断はエージェント、計測・OCR・描画は依存ゼロの Node スクリプト、という分担です。

## Install / インストール

```bash
npx skills add masa-sumimoto/design-anatomy
```

Or copy `skills/design-anatomy/` into your agent's skills directory (e.g. `~/.claude/skills/`, `~/.codex/skills/`).

Requirements: Node ≥ 18. Optional: macOS (Vision OCR, Japanese-ready) or `tesseract`; `rsvg-convert` or Chrome for PNG output.

## Usage / 使い方

Ask your agent:

> このバナーを design-anatomy で分解して `./banner.png`
>
> Break down `./poster.jpg` with design-anatomy.

Or run the script directly:

```bash
S=skills/design-anatomy/scripts/anatomy.mjs
node $S probe banner.png
node $S ocr banner.png > banner.ocr.json
node $S coverage banner.anatomy.json banner.ocr.json   # OCR text no element covers
node $S validate banner.anatomy.json
node $S render banner.anatomy.json --png                 # sheet
node $S render banner.anatomy.json --mode wireframe --png
node $S brief banner.anatomy.json                        # content.yaml + taste.md
```

## Outputs / 出力

| file | what | use it for |
|---|---|---|
| `*.anatomy.png` | one-sheet diagram | understanding the structure at a glance |
| `*.content.yaml` | size + `type`/`value` pairs | briefs, copy decks, design specs |
| `*.taste.md` | taste prompt (EN/JA), palette, facets, asset prompts, negative | style references, mood boards, image generation |

See [examples/](examples/) for a full set.

## Roles / 役割

| group | roles |
|---|---|
| Background | `background` |
| Text | `headline` `subheadline` `eyebrow` `heading` `body` `list` `info` `price` `date` `label` `caption` `note` `credit` `hashtag` `handle` `rating` `copy` · `other-text` |
| Image | `photo` `illustration` `product` `character` `icon` `avatar` `qr` `map` · `other-image` |
| Action | `cta` `button` `link` `input` `chip` |
| Brand | `logo` |
| Decoration | `badge` `shape` `divider` `decoration` |
| Container | `frame` `card` `container` `header` `nav` `statusbar` `tabbar` |

Elements the agent can't classify become `other-text` / `other-image` (dashed outline). `coverage` flags OCR text that no element accounts for.
分類できない要素は `other-text` / `other-image`（破線）になり、`coverage` が拾い漏れた文字を検出します。

Definitions: [references/roles.md](skills/design-anatomy/references/roles.md)

## License

MIT
