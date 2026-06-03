#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererRoot = path.resolve(__dirname, "..");

const CANVAS_WIDTH = 2242;
const DEFAULT_PORT = 4321;
const MAIN_RED = "#AF1E23";
const TEXT_BLACK = "#231815";

const sectionColors = {
  "ABOUT GDG": MAIN_RED,
  "PARTNER VISITS": MAIN_RED,
  SPECIAL: MAIN_RED,
  "ABOUT GoerGroup": "#0E7B2A",
};

const brandColors = {
  "Goer Inno": "#0E7B2A",
  Dotcom: "#000000",
  goerlife: "#EA5513",
  Goeredu: "#00583C",
  Goertek: "#5DB53B",
  Wemake: "#70B828",
};

const contentTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function parseArgs(argv) {
  const args = {
    input: null,
    outDir: path.resolve(rendererRoot, "output"),
    port: DEFAULT_PORT,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      args.outDir = path.resolve(argv[++i]);
    } else if (arg === "--port") {
      args.port = Number(argv[++i]);
    } else if (!args.input) {
      args.input = path.resolve(arg);
    }
  }

  if (!args.input) {
    args.input = path.resolve(rendererRoot, "templates/to-cast-template.md");
  }

  return args;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }

  const closing = raw.indexOf("\n---", 3);
  if (closing === -1) {
    return { meta: {}, body: raw };
  }

  const frontmatter = raw.slice(3, closing).trim();
  const body = raw.slice(closing + 4).replace(/^\s*\n/, "");
  const meta = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    meta[key] = value.replace(/^["']|["']$/g, "").trim();
  }

  return { meta, body };
}

function ensureSection(doc, title) {
  let section = doc.sections.at(-1);
  if (!section || section.title !== title) {
    section = { title, groups: [] };
    doc.sections.push(section);
  }
  return section;
}

function ensureGroup(section, title) {
  let group = section.groups.at(-1);
  if (!group || group.title !== title) {
    group = { title, items: [] };
    section.groups.push(group);
  }
  return group;
}

function parseMarkdown(raw) {
  const { meta, body } = parseFrontmatter(raw);
  const doc = {
    meta,
    title: "",
    sections: [],
  };

  let currentSection = null;
  let currentGroup = null;
  let currentItem = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const heading = line.match(/^(#{1,4})\s+(.+)$/);

    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();

      if (level === 1) {
        doc.title = title;
        currentSection = null;
        currentGroup = null;
        currentItem = null;
      } else if (level === 2) {
        currentSection = ensureSection(doc, title);
        currentGroup = null;
        currentItem = null;
      } else if (level === 3) {
        if (!currentSection) {
          currentSection = ensureSection(doc, "ABOUT GDG");
        }
        currentGroup = ensureGroup(currentSection, title);
        currentItem = null;
      } else if (level === 4) {
        if (!currentSection) {
          currentSection = ensureSection(doc, "ABOUT GDG");
        }
        if (!currentGroup) {
          currentGroup = ensureGroup(currentSection, "重点项目");
        }
        currentItem = { title, lines: [] };
        currentGroup.items.push(currentItem);
      }
      continue;
    }

    if (!line.trim() && (!currentSection || !currentGroup || !currentItem)) continue;
    if (!currentSection && !line.trim()) continue;
    if (!currentSection) {
      currentSection = ensureSection(doc, "ABOUT GDG");
    }
    if (!currentGroup) {
      currentGroup = ensureGroup(currentSection, "重点项目");
    }
    if (!currentItem) {
      currentItem = { title: "", lines: [] };
      currentGroup.items.push(currentItem);
    }

    currentItem.lines.push(line);
  }

  return doc;
}

function getTheme(sectionTitle, groupTitle) {
  if (sectionTitle === "ABOUT GoerGroup") {
    return brandColors[groupTitle] || sectionColors[sectionTitle] || MAIN_RED;
  }
  return sectionColors[sectionTitle] || MAIN_RED;
}

function toAssetUrl(src, baseDir) {
  if (/^(https?:|data:|blob:)/i.test(src)) {
    return src;
  }
  return `/__asset?file=${encodeURIComponent(path.resolve(baseDir, src))}`;
}

function inlineMarkdown(value, theme) {
  const token = "__TO_CAST_THEME_OPEN__";
  const closeToken = "__TO_CAST_THEME_CLOSE__";
  let html = escapeHtml(value);

  html = html.replace(/\*\*(.+?)\*\*/g, `${token}$1${closeToken}`);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  return html
    .replaceAll(token, `<strong class="accent-text" style="color:${theme}">`)
    .replaceAll(closeToken, "</strong>");
}

function flushParagraph(lines, blocks) {
  if (!lines.length) return;
  blocks.push({ type: "paragraph", lines: [...lines] });
  lines.length = 0;
}

function flushList(list, blocks) {
  if (!list.items.length) return;
  blocks.push({ type: list.type, items: [...list.items] });
  list.items.length = 0;
  list.type = null;
}

function parseBlocks(lines, baseDir) {
  const blocks = [];
  const paragraph = [];
  const list = { type: null, items: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    const rule = trimmed === "---" || trimmed === "——" || trimmed === "___";

    if (!trimmed) {
      flushParagraph(paragraph, blocks);
      flushList(list, blocks);
      continue;
    }

    if (rule) {
      flushParagraph(paragraph, blocks);
      flushList(list, blocks);
      blocks.push({ type: "rule" });
      continue;
    }

    if (image) {
      flushParagraph(paragraph, blocks);
      flushList(list, blocks);
      blocks.push({
        type: "image",
        alt: image[1],
        src: toAssetUrl(image[2], baseDir),
      });
      continue;
    }

    if (bullet || numbered) {
      flushParagraph(paragraph, blocks);
      const type = bullet ? "ul" : "ol";
      if (list.type && list.type !== type) {
        flushList(list, blocks);
      }
      list.type = type;
      list.items.push((bullet || numbered)[1]);
      continue;
    }

    flushList(list, blocks);
    paragraph.push(trimmed);
  }

  flushParagraph(paragraph, blocks);
  flushList(list, blocks);
  return blocks;
}

function renderBlocks(lines, theme, baseDir) {
  return parseBlocks(lines, baseDir)
    .map((block) => {
      if (block.type === "paragraph") {
        return `<p>${block.lines.map((line) => inlineMarkdown(line, theme)).join("<br>")}</p>`;
      }
      if (block.type === "ul" || block.type === "ol") {
        const tag = block.type;
        return `<${tag}>${block.items
          .map((item) => `<li>${inlineMarkdown(item, theme)}</li>`)
          .join("")}</${tag}>`;
      }
      if (block.type === "image") {
        return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}"><figcaption>${escapeHtml(block.alt)}</figcaption></figure>`;
      }
      if (block.type === "rule") {
        return `<div class="item-rule" style="background:${theme}"></div>`;
      }
      return "";
    })
    .join("\n");
}

function renderGroup(group, section, baseDir, index) {
  const theme = getTheme(section.title, group.title);
  const railSide = index % 2 === 0 ? "rail-left" : "rail-right";
  const sectionTitle = index === 0 ? `<h2>${escapeHtml(section.title)}</h2>` : "";
  const items = group.items
    .map((item) => {
      const title = item.title
        ? `<h4 style="color:${theme}">${inlineMarkdown(item.title, theme)}</h4>`
        : "";
      return `<article class="cast-item">
        ${title}
        <div class="item-body">${renderBlocks(item.lines, theme, baseDir)}</div>
      </article>`;
    })
    .join("\n");

  return `<div class="cast-group ${railSide}" data-group="${escapeHtml(group.title)}" style="--theme:${theme};">
    ${sectionTitle}
    <h3>${escapeHtml(group.title)}</h3>
    ${items}
  </div>`;
}

function renderSection(section, baseDir) {
  return `<section class="cast-section">
    ${section.groups.map((group, index) => renderGroup(group, section, baseDir, index)).join("\n")}
  </section>`;
}

function getTitleParts(doc) {
  const year = doc.meta.year || "";
  const no = doc.meta.no || "";
  const date = doc.meta.date || "";

  if (year || no || date) {
    return {
      main: "TO Cast",
      meta: `${year}${no ? ` No.${no}` : ""}${date ? `  ${date}` : ""}`.trim(),
    };
  }

  const title = doc.title || "TO Cast";
  const match = title.match(/^(TO\s*Cast)\s+(.+)$/i);
  return {
    main: match ? match[1] : "TO Cast",
    meta: match ? match[2] : title.replace(/^TO\s*Cast\s*/i, ""),
  };
}

function renderCanvas(doc, baseDir) {
  const titleParts = getTitleParts(doc);
  const sections = doc.sections
    .map((section, index) => {
      const sectionHtml = renderSection(section, baseDir);
      const divider =
        index < doc.sections.length - 1
          ? `<div class="section-divider"><span>◆ ◆</span><b>TO Cast</b><span>◆ ◆</span></div>`
          : "";
      return `${sectionHtml}${divider}`;
    })
    .join("\n");

  return `<main class="cast-canvas" data-width="${CANVAS_WIDTH}">
    <header class="cast-header">
      <div class="brand-box">
        <div class="brand-title">${escapeHtml(titleParts.main)}</div>
        <div class="brand-meta">${escapeHtml(titleParts.meta)}</div>
      </div>
    </header>
    ${sections}
    <footer class="cast-footer">TO Cast</footer>
  </main>`;
}

function renderHtml(doc, baseDir, mode = "preview") {
  const canvas = renderCanvas(doc, baseDir);
  const toolbar =
    mode === "preview"
      ? `<div class="toolbar">
          <div>
            <strong>TO Cast Preview</strong>
            <span>2242px 宽高清长图</span>
          </div>
          <button id="downloadBtn">下载高清长图 JPG</button>
          <output id="status"></output>
        </div>`
      : "";

  const script =
    mode === "preview"
      ? `<script>
          const button = document.getElementById("downloadBtn");
          const status = document.getElementById("status");
          button.addEventListener("click", async () => {
            button.disabled = true;
            status.textContent = "正在导出...";
            try {
              const response = await fetch("/export", { method: "POST" });
              const payload = await response.json();
              if (!response.ok) throw new Error(payload.error || "导出失败");
              status.textContent = "导出完成";
              const link = document.createElement("a");
              link.href = payload.downloadUrl;
              link.download = payload.filename;
              document.body.appendChild(link);
              link.click();
              link.remove();
            } catch (error) {
              status.textContent = error.message;
            } finally {
              button.disabled = false;
            }
          });
        </script>`
      : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(doc.title || "TO Cast")}</title>
  <style>${css()}</style>
</head>
<body class="${mode === "export" ? "export-mode" : "preview-mode"}">
  ${toolbar}
  <div class="preview-stage">${canvas}</div>
  ${script}
</body>
</html>`;
}

function css() {
  return `
    :root {
      --main-red: ${MAIN_RED};
      --text-black: ${TEXT_BLACK};
      --paper: #ffffff;
      --preview-bg: #e9e5df;
      --cast-font: Helvetica, "Source Han Sans SC", "Source Han Sans CN", "Noto Sans CJK SC", "思源黑体", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
    }

    * { box-sizing: border-box; }

    html,
    body {
      margin: 0;
      color: var(--text-black);
      font-family: var(--cast-font);
      background: var(--preview-bg);
    }

    .toolbar {
      position: fixed;
      z-index: 10;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: min(1120px, calc(100vw - 40px));
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 14px 18px;
      background: rgba(255,255,255,.96);
      border: 1px solid rgba(35,24,21,.14);
      border-radius: 8px;
      box-shadow: 0 12px 30px rgba(35,24,21,.16);
      font-size: 16px;
    }

    .toolbar strong {
      display: block;
      font-size: 18px;
    }

    .toolbar span,
    .toolbar output {
      color: rgba(35,24,21,.68);
    }

    .toolbar button {
      height: 44px;
      padding: 0 18px;
      border: 0;
      border-radius: 6px;
      background: var(--main-red);
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    .toolbar button:disabled {
      cursor: wait;
      opacity: .68;
    }

    .preview-stage {
      display: flex;
      justify-content: center;
      padding: 130px 0 80px;
      overflow-x: auto;
    }

    .preview-mode .cast-canvas {
      transform: scale(.34);
      transform-origin: top center;
      margin-bottom: calc(-66%);
      box-shadow: 0 18px 70px rgba(35,24,21,.18);
    }

    .export-mode {
      background: white;
    }

    .export-mode .preview-stage {
      display: block;
      padding: 0;
    }

    .cast-canvas {
      width: ${CANVAS_WIDTH}px;
      min-height: 1000px;
      background: var(--paper);
      overflow: hidden;
    }

    .cast-header {
      padding-top: 330px;
      padding-left: 126px;
    }

    .brand-box {
      display: inline-block;
      min-width: 760px;
      background: var(--main-red);
      color: #fff;
      padding: 30px 36px 28px;
      line-height: 1;
    }

    .brand-title {
      font-size: 142px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .brand-meta {
      margin-top: 24px;
      font-size: 58px;
      font-weight: 800;
      letter-spacing: 0;
    }

    .cast-section {
      position: relative;
      margin: 350px 100px 0 128px;
    }

    .cast-section h2 {
      margin: 0 0 112px;
      color: var(--text-black);
      font-size: 118px;
      line-height: .92;
      font-weight: 900;
      letter-spacing: 0;
      white-space: nowrap;
    }

    .cast-group + .cast-group {
      margin-top: 150px;
    }

    .cast-group {
      --theme: var(--main-red);
      position: relative;
      padding-top: 0;
      padding-bottom: 0;
      min-height: 250px;
    }

    .cast-group.rail-left {
      padding-left: 100px;
      padding-right: 132px;
      border-left: 42px solid var(--theme);
      border-right: 7px solid var(--theme);
    }

    .cast-group.rail-right {
      padding-left: 136px;
      padding-right: 100px;
      border-left: 7px solid var(--theme);
      border-right: 42px solid var(--theme);
    }

    .cast-group h3 {
      margin: 0 0 72px;
      color: var(--text-black);
      font-size: 76px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: 0;
    }

    .cast-item + .cast-item {
      margin-top: 66px;
    }

    .cast-item h4 {
      margin: 0 0 20px;
      font-size: 42px;
      line-height: 1.32;
      font-weight: 900;
      letter-spacing: 0;
    }

    .item-body {
      font-size: 42px;
      line-height: 1.86;
      font-weight: 500;
      letter-spacing: 0;
    }

    .item-body p {
      margin: 0;
    }

    .item-body p + p,
    .item-body ul + p,
    .item-body ol + p,
    .item-body figure + p {
      margin-top: 28px;
    }

    .item-body ul,
    .item-body ol {
      margin: 0;
      padding-left: 1.35em;
    }

    .item-body li + li {
      margin-top: 16px;
    }

    .item-body a {
      color: inherit;
      text-decoration: none;
      border-bottom: 2px solid currentColor;
    }

    .accent-text {
      font-weight: 900;
    }

    .item-rule {
      width: 154px;
      height: 8px;
      margin: 48px 0;
    }

    figure {
      margin: 44px 0 0;
    }

    figure img {
      display: block;
      max-width: 100%;
      height: auto;
      object-fit: contain;
    }

    figcaption {
      display: none;
    }

    .section-divider {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 48px;
      margin: 310px 0 0;
      color: var(--main-red);
      font-size: 36px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: 0;
    }

    .section-divider b {
      font-size: 38px;
      font-weight: 900;
    }

    .cast-footer {
      margin-top: 330px;
      height: 250px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--main-red);
      color: white;
      font-size: 112px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: 0;
    }

    @media (max-width: 900px) {
      .preview-stage {
        justify-content: flex-start;
        padding-top: 112px;
      }

      .preview-mode .cast-canvas {
        transform: scale(.18);
        transform-origin: top left;
      }
    }
  `;
}

function formatNo(no) {
  const raw = String(no || "xx").replace(/^No\.?/i, "");
  return raw.padStart(2, "0");
}

function formatDateForFile(date, year) {
  const match = String(date || "").match(/(\d{1,2})\D+(\d{1,2})/);
  if (!match) return "";
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  return `${year}${month}${day}`;
}

function outputFilename(doc) {
  const year = doc.meta.year || "2026";
  const no = formatNo(doc.meta.no);
  const date = formatDateForFile(doc.meta.date, year);
  return `TO-Cast-${year}-No${no}${date ? `-${date}` : ""}.jpg`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "content-type": "application/json; charset=utf-8",
  });
}

async function exportImage({ origin, outDir, doc }) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    throw new Error("Playwright 未安装。请在 to-cast-renderer 目录运行 npm install。");
  }

  await mkdir(outDir, { recursive: true });
  const filename = outputFilename(doc);
  const outputPath = path.join(outDir, filename);
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({
      viewport: { width: CANVAS_WIDTH, height: 1200 },
      deviceScaleFactor: 1,
    });

    await page.goto(`${origin}/cast`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });

    const canvas = page.locator(".cast-canvas");
    await canvas.screenshot({
      path: outputPath,
      type: "jpeg",
      quality: 95,
      animations: "disabled",
    });
  } finally {
    await browser.close();
  }

  return { filename, outputPath };
}

async function serveAsset(reqUrl, res) {
  const file = reqUrl.searchParams.get("file");
  if (!file) {
    send(res, 404, "missing file");
    return;
  }

  const resolved = path.resolve(file);
  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) throw new Error("not file");
    const contentType = contentTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    createReadStream(resolved).pipe(res);
  } catch {
    send(res, 404, "asset not found");
  }
}

async function startServer(args) {
  const raw = await readFile(args.input, "utf8");
  const doc = parseMarkdown(raw);
  const baseDir = path.dirname(args.input);

  let server;
  const requestHandler = async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);

    try {
      if (req.method === "GET" && reqUrl.pathname === "/") {
        send(res, 200, renderHtml(doc, baseDir, "preview"), {
          "content-type": "text/html; charset=utf-8",
        });
        return;
      }

      if (req.method === "GET" && reqUrl.pathname === "/cast") {
        send(res, 200, renderHtml(doc, baseDir, "export"), {
          "content-type": "text/html; charset=utf-8",
        });
        return;
      }

      if (req.method === "GET" && reqUrl.pathname === "/__asset") {
        await serveAsset(reqUrl, res);
        return;
      }

      if (req.method === "POST" && reqUrl.pathname === "/export") {
        const origin = `http://${req.headers.host}`;
        const exported = await exportImage({ origin, outDir: args.outDir, doc });
        json(res, 200, {
          filename: exported.filename,
          outputPath: exported.outputPath,
          downloadUrl: `/download/${encodeURIComponent(exported.filename)}`,
        });
        return;
      }

      if (req.method === "GET" && reqUrl.pathname.startsWith("/download/")) {
        const filename = decodeURIComponent(reqUrl.pathname.replace("/download/", ""));
        const file = path.join(args.outDir, path.basename(filename));
        res.writeHead(200, {
          "content-type": "image/jpeg",
          "content-disposition": `attachment; filename="${path.basename(file)}"`,
        });
        createReadStream(file).pipe(res);
        return;
      }

      send(res, 404, "not found");
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  };

  for (let port = args.port; port < args.port + 20; port += 1) {
    try {
      server = createServer(requestHandler);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      });
      return { server, port, doc };
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }

  throw new Error(`无法找到可用端口：${args.port}-${args.port + 19}`);
}

const args = parseArgs(process.argv);
const { port, doc } = await startServer(args);
const url = `http://127.0.0.1:${port}`;

console.log(`TO Cast preview: ${url}`);
console.log(`Markdown: ${args.input}`);
console.log(`Output: ${args.outDir}`);
console.log(`Expected image: ${outputFilename(doc)}`);
