# Role reference

Each role belongs to a **group** that decides its color and wireframe glyph in the sheet.
Pick the most specific role that fits; when two fit, prefer the one that says *what job the element does* for the viewer.

## Background

| role | use for | examples |
|---|---|---|
| `background` | the full-bleed base. Usually one element covering the canvas. Put the photo/color/gradient description in `content`. | 単色, グラデーション, 全面写真 |

## Text

| role | use for | examples |
|---|---|---|
| `headline` | the largest, first-read copy. One per design (UI: the page title). | 「ひんやり黒糖ラテ」 |
| `subheadline` | copy that directly supports the headline: a second line, a translation, a tagline. | "Coffee & the morning of the town" |
| `eyebrow` | small text placed *above* the headline that frames it: event/series name, category, kicker. | 「CITY COFFEE WEEK」, 「NEW ARRIVAL」 |
| `heading` | a section title inside the design (not the main headline). | UI の「おすすめ」 |
| `body` | explanatory sentences. | 「沖縄産黒糖のやさしい甘さ。」 |
| `list` | enumerated items: steps, bullet points, features. Use `lines` for the item count. | ① フォロー ② いいね ③ コメント |
| `info` | key–value details, typically date/time/venue/access, often aligned like a table. | 日時 / 時間 / 会場 |
| `price` | prices and price notes. | ¥580（税込） |
| `date` | a standalone date or period that is not part of an `info` block. | 8/31まで |
| `label` | short tag-like text with no container shape (when it has a shape, use `badge`). | NEW, PR |
| `caption` | small text describing a nearby element. | 写真の説明文 |
| `note` | disclaimers and fine print, often starting with ※ or *. | ※雨天決行 |
| `credit` | organizer, sponsor, copyright, photo credit. | 主催：〇〇実行委員会, © 2026 |
| `hashtag` | hashtags. | #カフェ巡り |
| `handle` | social account names / URLs used as an identity. | @morning_roast |
| `rating` | stars or scores. | ★★★★☆ 4.3（128） |
| `copy` | marketing copy that is clearly text but none of the above. Prefer a specific role. | |
| `other-text` | **text you can see but whose role you can't decide.** Drawn with a dashed outline. Also what `coverage --apply` adds for OCR lines no element covers — revisit those. | |

## Image

| role | use for |
|---|---|
| `photo` | photographs (including cut-out photos). |
| `illustration` | drawn/vector/3D artwork. |
| `product` | the thing being sold, whatever the medium (prefer this over photo/illustration when it is the product). |
| `character` | mascots and characters. |
| `icon` | small symbolic pictograms. |
| `avatar` | profile pictures (UI). |
| `qr` | QR codes and barcodes. |
| `map` | maps and access diagrams. |
| `other-image` | **imagery whose role you can't decide.** Dashed outline. |

## Action

| role | use for |
|---|---|
| `cta` | the primary call to action. Usually one. |
| `button` | other buttons, including floating action buttons. |
| `link` | text links ("すべて見る"). |
| `input` | text fields, search boxes, selects. |
| `chip` | filter chips / segmented choices. One element for the whole row is fine; mark the selected one in `content`. |

## Brand

| role | use for |
|---|---|
| `logo` | logos, wordmarks, brand symbols. |

## Decoration

| role | use for |
|---|---|
| `badge` | a shape carrying a short message: ribbons, seals, starbursts, pills. Put its text in `content`. |
| `shape` | background shapes that organize the layout (circles, blobs, color blocks). |
| `divider` | rules and separators. |
| `decoration` | ornaments with no message (sparkles, patterns). |

## Container

| role | use for |
|---|---|
| `frame` | a border around the whole design. |
| `card` | a repeated content unit. |
| `container` | any other grouping region. |
| `header` / `nav` | top bars and navigation. |
| `statusbar` | the OS status bar in screenshots. |
| `tabbar` | bottom tab navigation. |

Children of a container point to it with `parent`. A container that has children is treated as a frame only (its children carry the content).

## Fallback

`other` — when even the group is unclear. Dashed outline, gray.
