'use strict';

/**
 * 文件读取与文件生成
 *
 * 读取侧三条防线：
 *   1. 先看大小再看类型，超限直接不读 —— 几 GB 的日志被当文本读进来会把应用当场拖崩
 *   2. 目录不能直接读成文本，展开成「目录树 + 关键文件内容」
 *   3. 遍历给「节点数 + 时间」双预算，别在 C:\Users 这种大目录里跑没完
 *
 * 生成侧支持 docx / xlsx / pptx / pdf，其余按纯文本写。
 */

const path = require('path');
const fs = require('fs');

const MAX_ATTACHMENT_CHARS = 60000;   // 单个附件送入模型的最大字符数
const MAX_READ_BYTES = 20 * 1024 * 1024;       // read_file / 附件单个文件上限 20MB
const MAX_TOOL_READ_BYTES = 2 * 1024 * 1024;   // 目录摘要里单文件最多读 2MB

const DIR_SKIP_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt',
  '.venv', 'venv', 'env', '__pycache__', '.idea', '.vscode', '.cache', '.gradle',
  'coverage', '.pytest_cache', '.mypy_cache', 'target', 'bin', 'obj',
]);
const DIR_TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.html', '.htm', '.css', '.scss', '.less', '.java', '.c', '.h', '.cpp', '.hpp',
  '.go', '.rs', '.rb', '.php', '.sh', '.bash', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.csv', '.xml', '.sql', '.vue', '.svelte', '.swift', '.kt', '.gradle', '.env',
]);
const DIR_MAX_NODES = 6000;          // 遍历节点上限
const DIR_MAX_DEPTH = 8;             // 递归深度上限
const DIR_TIME_BUDGET_MS = 10000;    // 遍历时间上限
const DIR_MAX_TREE_LINES = 400;      // 目录树最多列多少行
const DIR_DEFAULT_FILES = 40;        // 默认附带多少个文件的正文
const DIR_DEFAULT_CHARS = 120000;    // 目录摘要总字数上限

function lazyRequire(name) {
  return require(name);
}

function clipText(text, limit) {
  if (typeof text !== 'string') return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n……（内容过长，已截取前 ${limit} 个字符）`;
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* 一次并发跑完一批 stat，比逐条 await 快一个量级；单条失败不影响其它 */
async function statMany(absPaths, onEntry) {
  const results = await Promise.all(absPaths.map((abs) =>
    fs.promises.stat(abs).then((st) => ({ abs, size: st.size, isFile: st.isFile() }), () => null)));
  results.forEach((r) => { if (r && onEntry) onEntry(r); });
  return results;
}

async function collectDirEntries(root, opts = {}) {
  const maxNodes = Number(opts.maxNodes) || DIR_MAX_NODES;
  const maxDepth = Number(opts.maxDepth) || DIR_MAX_DEPTH;
  const deadline = Date.now() + (Number(opts.timeBudget) || DIR_TIME_BUDGET_MS);

  const files = [];
  const dirs = [];
  let nodes = 0;
  let truncated = false;
  let skippedDirs = 0;

  async function walk(absDir, relDir, depth) {
    if (depth > maxDepth || nodes > maxNodes || Date.now() > deadline) { truncated = true; return; }
    let entries = [];
    try { entries = await fs.promises.readdir(absDir, { withFileTypes: true }); } catch (e) { return; }
    if (relDir) dirs.push(relDir);

    // 目录名升序，输出稳定；噪音目录单独记一笔，让用户知道为什么少东西
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (nodes > maxNodes || Date.now() > deadline) { truncated = true; return; }
      nodes += 1;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (DIR_SKIP_NAMES.has(ent.name) || ent.name.startsWith('.')) { skippedDirs += 1; continue; }
        await walk(abs, rel, depth + 1);
      } else if (ent.isFile()) {
        files.push({ rel, abs });
      }
    }
  }

  await walk(root, '', 0);

  // 体积最后统一补一遍（并发），遍历阶段不因此变慢
  await statMany(files.map((f) => f.abs), (r) => {
    const f = files.find((x) => x.abs === r.abs);
    if (f) f.size = r.size;
  });
  files.forEach((f) => { if (typeof f.size !== 'number') f.size = 0; });

  return { files, dirs, truncated, skippedDirs, nodes };
}

async function buildDirectoryBrief(dirPath, opts, readFileContent) {
  const o = opts || {};
  const maxFiles = Math.max(1, Number(o.maxFiles) || DIR_DEFAULT_FILES);
  const maxChars = Math.max(2000, Number(o.maxChars) || DIR_DEFAULT_CHARS);
  const { files, dirs, truncated, skippedDirs } = await collectDirEntries(dirPath, o);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  /* --- 目录树 --- */
  const lines = [];
  dirs.slice().sort().forEach((d) => lines.push(`${d}/`));
  files.slice().sort((a, b) => a.rel.localeCompare(b.rel))
    .forEach((f) => lines.push(`${f.rel}  (${fmtSize(f.size)})`));
  const treeLines = lines.slice(0, DIR_MAX_TREE_LINES);
  const treeTruncated = lines.length > treeLines.length;

  /* --- 挑一批文本文件读正文：先浅（层级少）后小 --- */
  const candidates = files
    .filter((f) => DIR_TEXT_EXT.has(path.extname(f.rel).toLowerCase()))
    .filter((f) => f.size > 0 && f.size <= MAX_TOOL_READ_BYTES)
    .sort((a, b) => (a.rel.split('/').length - b.rel.split('/').length) || (a.size - b.size));

  const picked = [];
  let used = 0;
  for (const f of candidates) {
    if (picked.length >= maxFiles) break;
    if (used + f.size > maxChars) break;
    let text = '';
    try { text = await readFileContent(f.abs); } catch (e) { continue; }
    if (!text.trim()) continue;
    if (used + text.length > maxChars) break;
    picked.push({ rel: f.rel, text });
    used += text.length;
  }

  const head = [
    `这是一个目录：${dirPath}`,
    `文件 ${files.length} 个 · 子目录 ${dirs.length} 个 · 合计 ${fmtSize(totalBytes)}`,
    skippedDirs ? `（已跳过 ${skippedDirs} 个依赖/构建/隐藏目录：node_modules、.git、dist 等）` : '',
    (truncated || treeTruncated) ? `（目录过大，只展示前 ${treeLines.length} 项）` : '',
    '',
    '【目录结构】',
  ].filter(Boolean).join('\n');

  const body = picked.map((f) => `\n【文件：${f.rel}】\n${f.text}`).join('\n');
  const tail = picked.length < candidates.length
    ? `\n\n（还有 ${candidates.length - picked.length} 个文本文件未展开，需要哪个请单独 read_file 读取其完整路径）`
    : '';

  return {
    content: `${head}\n${treeLines.join('\n')}\n${body}${tail}`,
    fileCount: files.length,
    dirCount: dirs.length,
    totalBytes,
    includedCount: picked.length,
    truncated: Boolean(truncated || treeTruncated),
  };
}

/* ==================================================================
 * 文件生成
 * ================================================================== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- Markdown 表格：界面和导出共用同一套解析 ---------- */

function isTableDivider(line) {
  const s = String(line).trim();
  return s.includes('-') && /^[\s|:-]*-[\s|:-]*$/.test(s);
}

function splitTableRow(line) {
  let s = String(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * 把连续的 Markdown 表格行收成 { header, rows }，非表格行不动。
 * 列数不齐的按表头数量补齐 —— 模型写的表格经常少一两个格子。
 */
function collectTable(lines, start) {
  if (start + 1 >= lines.length) return null;
  if (!isTableDivider(lines[start + 1])) return null;
  const header = splitTableRow(lines[start]);
  if (header.length === 0) return null;
  const rows = [];
  let i = start + 2;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!String(line).includes('|')) break;
    const cells = splitTableRow(line);
    const row = [];
    for (let c = 0; c < header.length; c += 1) row.push(cells[c] !== undefined ? cells[c] : '');
    rows.push(row);
  }
  return { header, rows, end: i };
}

function mdToDocxParagraphs(content) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  } = lazyRequire('docx');
  const lines = content.split('\n');
  const paragraphs = [];
  let inCode = false;
  let codeBuffer = [];

  const cell = (text, bold) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: Boolean(bold) })] })],
    shading: bold ? { fill: 'F3F4F6' } : undefined,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCode) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: codeBuffer.join('\n'), font: 'Consolas', size: 20 })],
          shading: { fill: 'F5F5F5' },
        }));
        codeBuffer = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }

    // 表格优先：不处理的话，AI 写的表格在 docx 里会变成一堆竖线文本
    if (line.includes('|')) {
      const table = collectTable(lines, i);
      if (table) {
        const rows = [new TableRow({ children: table.header.map((h) => cell(h, true)), tableHeader: true })];
        table.rows.forEach((r) => rows.push(new TableRow({ children: r.map((c) => cell(c, false)) })));
        paragraphs.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        paragraphs.push(new Paragraph({ text: '' }));
        i = table.end - 1;
        continue;
      }
    }

    if (line.startsWith('### ')) paragraphs.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
    else if (line.startsWith('## ')) paragraphs.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
    else if (line.startsWith('# ')) paragraphs.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
    else if (line.match(/^[-*] /)) paragraphs.push(new Paragraph({ text: '• ' + line.slice(2) }));
    else if (line.match(/^\d+\. /)) paragraphs.push(new Paragraph({ text: line }));
    else if (line.trim() === '') paragraphs.push(new Paragraph({ text: '' }));
    else paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  return { Document, Packer, paragraphs };
}

/**
 * xlsx 用的是二维数组。这里的坑是「普通句子里也有逗号」——
 * 以前无脑按逗号切，一句「你好，帮我看下这个」会变成两列。
 * 现在只认真正的 Markdown 表格；整篇都不像表格、且每行逗号数一致时才按 CSV 切。
 */
function parseTable(content) {
  const lines = content.split('\n').filter((l) => l.trim());
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].includes('|')) {
      const table = collectTable(lines, i);
      if (table) {
        rows.push(table.header);
        table.rows.forEach((r) => rows.push(r));
        i = table.end;
        continue;
      }
    }
    rows.push([lines[i].trim()]);
    i += 1;
  }
  const noTable = rows.every((r) => r.length === 1);
  const counts = new Set(lines.map((l) => l.split(',').length));
  const looksCsv = noTable && lines.length > 1 && lines.every((l) => l.includes(',')) && counts.size === 1;
  if (looksCsv) return lines.map((l) => l.split(',').map((c) => c.trim()));
  return rows;
}

async function generatePptx(filePath, content) {
  const PptxGenJS = lazyRequire('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const chunks = content.split(/\n(?=# )|\n---+\n/).filter((c) => c.trim());

  if (chunks.length === 0) {
    const slide = pptx.addSlide();
    slide.addText(content, { x: 0.5, y: 0.5, w: 9, h: 5, fontSize: 16 });
  } else {
    chunks.forEach((chunk) => {
      const lines = chunk.trim().split('\n');
      const slide = pptx.addSlide();
      const title = lines[0].replace(/^#+\s*/, '').trim();
      const body = lines.slice(1).join('\n').trim();
      slide.addText(title || '未命名', { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 28, bold: true, color: '1F2937' });
      if (body) {
        slide.addText(body, { x: 0.5, y: 1.6, w: 9, h: 4, fontSize: 16, color: '4B5563', valign: 'top', lineSpacingMultiple: 1.4 });
      }
    });
  }
  await pptx.writeFile({ fileName: filePath });
}

/* 生成 PDF 用：先转义再解析，避免 AI 输出里的标签被当成 HTML */
function mdToHtml(md) {
  let html = escapeHtml(md);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => `<pre><code>${code.replace(/^\n/, '')}</code></pre>`);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 表格（导出 PDF 时也一样要是真表格）
  const lines = html.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('|')) {
      const table = collectTable(lines, i);
      if (table) {
        let t = '<table><thead><tr>' + table.header.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
        table.rows.forEach((r) => { t += '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>'; });
        out.push(t + '</tbody></table>');
        i = table.end - 1;
        continue;
      }
    }
    out.push(lines[i]);
  }
  html = out.join('\n');

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.split(/\n{2,}/).map((block) => {
    const t = block.trim();
    if (!t) return '';
    if (/^<(h[1-6]|ul|ol|pre|table)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

function pdfHtml(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; padding: 32px; line-height: 1.8; color: #1f2937; font-size: 14px; }
  h1 { font-size: 24px; border-bottom: 2px solid #4d6bfe; padding-bottom: 8px; margin: 20px 0 12px; }
  h2 { font-size: 20px; margin: 16px 0 10px; }
  h3 { font-size: 16px; margin: 12px 0 8px; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 6px; white-space: pre-wrap; }
  code { font-family: Consolas, monospace; font-size: 13px; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 13px; }
  th, td { border: 1px solid #d1d5db; padding: 7px 10px; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
</style></head><body>${mdToHtml(content)}</body></html>`;
}

function createFileService({ tempDir, createHiddenWindow }) {
  async function readFileContent(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let text = '';

    // 先看大小和类型再读。直接 readFileSync 全文进内存的话，
    // 一个几 GB 的日志/视频被当成文本读进来，整个应用会当场崩掉。
    try {
      const st = await fs.promises.stat(filePath);
      if (st.isDirectory()) return '（这是一个目录，不是文件）';
      if (st.size > MAX_READ_BYTES) {
        return `（文件过大：${(st.size / 1024 / 1024).toFixed(1)}MB，超过 ${MAX_READ_BYTES / 1024 / 1024}MB 上限，未读取）`;
      }
    } catch (e) {
      throw new Error(`无法访问文件：${(e && e.message) || e}`);
    }

    if (ext === '.docx') {
      const mammoth = lazyRequire('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      const XLSX = lazyRequire('xlsx');
      const workbook = XLSX.readFile(filePath, { cellDates: true });
      text = workbook.SheetNames
        .map((sheetName) => `【工作表：${sheetName}】\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`)
        .join('\n\n');
    } else if (ext === '.pdf') {
      const { PDFParse } = lazyRequire('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
      try {
        const result = await parser.getText();
        text = (result && result.text) || '';
        if (!text.trim() && Array.isArray(result && result.pages)) {
          text = result.pages.map((p) => p && p.text ? p.text : '').join('\n');
        }
      } finally {
        await parser.destroy().catch(() => {});
      }
      if (!text.trim()) text = '（这个 PDF 没有可提取的文字层，可能是扫描件或纯图片）';
    } else {
      text = fs.readFileSync(filePath, 'utf-8');
    }

    return clipText(text, MAX_ATTACHMENT_CHARS);
  }

  async function generatePDF(filePath, content) {
    const tmpFile = path.join(tempDir, `gen_${Date.now()}.html`);
    fs.writeFileSync(tmpFile, pdfHtml(content), 'utf-8');

    const win = createHiddenWindow();
    try {
      await win.loadFile(tmpFile);
      const pdfData = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'default' },
      });
      fs.writeFileSync(filePath, pdfData);
    } finally {
      win.close();
      try { fs.unlinkSync(tmpFile); } catch (e) { /* 清理失败可忽略 */ }
    }
  }

  async function generateFile(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') {
      const { Document, Packer, paragraphs } = mdToDocxParagraphs(content);
      const doc = new Document({ sections: [{ children: paragraphs }] });
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(filePath, buffer);
      return;
    }
    if (ext === '.xlsx') {
      const XLSX = lazyRequire('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(parseTable(content));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, filePath);
      return;
    }
    if (ext === '.pptx') { await generatePptx(filePath, content); return; }
    if (ext === '.pdf') { await generatePDF(filePath, content); return; }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return {
    readFileContent,
    generateFile,
    generatePDF,
    buildDirectoryBrief: (dirPath, opts) => buildDirectoryBrief(dirPath, opts, readFileContent),
    collectDirEntries,
  };
}

module.exports = {
  createFileService,
  collectDirEntries,
  buildDirectoryBrief,
  mdToHtml,
  mdToDocxParagraphs,
  parseTable,
  collectTable,
  escapeHtml,
  clipText,
  fmtSize,
  MAX_ATTACHMENT_CHARS,
  MAX_READ_BYTES,
};
