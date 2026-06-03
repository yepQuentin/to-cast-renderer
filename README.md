# TO Cast Renderer

Render structured TO Cast Markdown into a 2242px-wide HTML preview and export one high-quality JPG long image.

## Usage

```bash
npm install
npm run preview -- templates/to-cast-template.md
```

Open the printed local URL, review the preview, then click `下载高清长图 JPG`.

## Markdown Structure

```markdown
---
year: 2026
no: 11
date: 5/22
template: standard
---

# TO Cast 2026 No.11 5/22

## ABOUT GDG

### Key Projects

#### Project title
Project update body.
```

## Output

- One JPG long image
- Width: `2242px`
- Height: automatic
- Quality: `95`

## License

MIT
