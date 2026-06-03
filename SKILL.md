---
name: to-cast-publisher
description: Use when the user asks to create, preview, render, export, or update TO Cast weekly Markdown into a 2242px-wide long-image format. This skill converts structured Markdown into an HTML preview and exports one high-quality JPG long image after preview confirmation.
metadata:
  short-description: Render TO Cast Markdown to preview HTML and one JPG long image
---

# TO Cast Publisher

Use this skill to render structured TO Cast Markdown into a browser preview and export one high-quality JPG long image.

## Workflow

1. Ask for or locate the weekly Markdown file.
2. Start the preview server from this repository:

```bash
npm install
npm run preview -- /absolute/path/to/week.md
```

3. Open the local preview URL.
4. Check the HTML preview.
5. Click `下载高清长图 JPG` to export one long image.

## Markdown Contract

Frontmatter:

```markdown
---
year: 2026
no: 11
date: 5/22
template: standard
---
```

Heading roles:

- `#`: issue title, rendered in the top red TO Cast block.
- `##`: major section, usually `ABOUT GDG`, `ABOUT GoerGroup`, `PARTNER VISITS`.
- `###`: GDG category, GoerGroup brand, or partner name.
- `####`: concrete item title.
- Body text below `####`: item content.

Inline emphasis:

- `**important text**` renders in the current theme color.
- `####` item titles also follow the current theme color.

Images:

- Markdown images are allowed: `![caption](./assets/example.jpg)`.
- Images are limited to the content width and preserve aspect ratio.

## Theme Colors

Major sections:

- `ABOUT GDG`: `#AF1E23`
- `PARTNER VISITS`: `#AF1E23`
- `SPECIAL`: `#AF1E23`
- `ABOUT GoerGroup`: `#0E7B2A`

GoerGroup brand overrides:

- `Goer Inno`: `#0E7B2A`
- `Dotcom`: `#000000`
- `goerlife`: `#EA5513`
- `Goeredu`: `#00583C`
- `Goertek`: `#5DB53B`
- `Wemake`: `#70B828`

Unknown GoerGroup brands use the section default `#0E7B2A`.

## Output Rules

- Generate preview HTML first; do not export automatically.
- The preview canvas is 2242px wide and grows vertically with content.
- Export exactly one JPG long image, quality 95.
- Do not split into pages.
- Do not rewrite, summarize, or invent content unless explicitly asked.
- Keep the toolbar outside `.cast-canvas` so it is never included in the screenshot.
- Preserve the TO Cast divider between `##` major sections.
- Render each `###` group as an independent visual block. The thick theme color rail alternates left/right by group order under the same `##` section.
