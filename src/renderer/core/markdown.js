;(function (global) {
  'use strict';

  /**
   * Markdown 渲染（先转义，再解析；链接做协议白名单）
   *
   * 安全：整段先 escapeHtml，再只把自己生成的标签放回去，
   * 所以模型输出里的 <script> / onerror= 之类一律变成纯文本。
   *
   * 性能：结果按原文缓存。renderMessages 全量重画、编辑重发、切换会话
   * 都会重复渲染同样的内容，缓存能把这部分直接省掉。
   */
  const App = (global.App = global.App || {});
  const escapeHtml = (s) => App.utils.escapeHtml(s);
  const sanitizeUrl = (s) => App.utils.sanitizeUrl(s);

  const CACHE_MAX = 30;
  const CACHE_MAX_CHARS = 120000;
  const cache = new Map();

  function cached(text, produce) {
    if (text.length > CACHE_MAX_CHARS) return produce();
    const hit = cache.get(text);
    if (hit !== undefined) {
      // 命中后挪到末尾，维持一个简单的 LRU
      cache.delete(text);
      cache.set(text, hit);
      return hit;
    }
    const value = produce();
    cache.set(text, value);
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    return value;
  }

  /**
   * 表格：模型写的表格经常不规矩 —— 少写结尾竖线、列数前后不齐、带对齐冒号。
   * 这里统一兜住，不让它们退化成一堆竖线文本。
   */
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function isDivider(line) {
    return /^[\s|:-]*-[\s|:-]*$/.test(line.trim()) && line.includes('-');
  }

  function alignOf(cell) {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  }

  function renderTable(lines) {
    const headers = splitRow(lines[0]);
    const aligns = splitRow(lines[1]).map(alignOf);
    const colCount = headers.length;
    let html = '<div class="table-wrap"><div class="table-scroll"><table><thead><tr>';
    headers.forEach((h, i) => {
      html += `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${h}</th>`;
    });
    html += '</tr></thead><tbody>';
    lines.slice(2).forEach((line) => {
      const cells = splitRow(line);
      // 列数不对就补齐或截断，宁可留空格也不要整行错位
      const row = [];
      for (let i = 0; i < colCount; i += 1) row.push(cells[i] !== undefined ? cells[i] : '');
      html += '<tr>' + row.map((cell, i) =>
        `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${cell}</td>`).join('') + '</tr>';
    });
    return html + '</tbody></table></div></div>';
  }

  function renderMarkdown(text) {
    if (!text) return '';

    return cached(text, () => {
      let html = escapeHtml(text);

      const codeBlocks = [];
      html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
        const idx = codeBlocks.length;
        const label = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
        codeBlocks.push(`${label}<pre><code>${code.replace(/^\n/, '')}</code></pre>`);
        return `\u0000CODEBLOCK${idx}\u0000`;
      });

      const inlineCodes = [];
      html = html.replace(/`([^`\n]+)`/g, (_m, code) => {
        const idx = inlineCodes.length;
        inlineCodes.push(`<code>${code}</code>`);
        return `\u0000INLINECODE${idx}\u0000`;
      });

      // 表格：连续若干行「看起来像表格」就整块收进来，分隔行只认含 - 的那种
      html = html.replace(/((?:^[^\n]*\|[^\n]*$\n?){2,})/gm, (tableBlock) => {
        const lines = tableBlock.split('\n').filter((l) => l.trim());
        if (lines.length < 2) return tableBlock;
        if (!isDivider(lines[1])) return tableBlock;
        return renderTable(lines);
      });

      html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
      html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
      html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

      html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
      html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

      html = html.replace(/^---+$/gm, '<hr>');
      html = html.replace(/^\*\*\*+$/gm, '<hr>');

      html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
      html = html.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3');
      html = html.replace(/(^|[^_])_([^_\n]+)_([^_]|$)/g, '$1<em>$2</em>$3');
      html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

      // 链接：只放行 http(s) / mailto / tel，其余退化成纯文本
      html = html.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, label, url) => {
        const safe = sanitizeUrl(url);
        if (!safe) return label || '';
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });

      html = html.replace(/^[\-\*\+]\s+(.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

      html = html.replace(/^\d+\.\s+(.+)$/gm, '<li-ordered>$1</li-ordered>');
      html = html.replace(/(<li-ordered>.*<\/li-ordered>\n?)+/g, (m) =>
        '<ol>' + m.replace(/<\/?li-ordered>/g, (tag) => (tag.startsWith('</') ? '</li>' : '<li>')) + '</ol>');

      html = html.split(/\n{2,}/).map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (/^<(h[1-6]|ul|ol|pre|blockquote|table|div|hr|li)/.test(trimmed)) return trimmed;
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
      }).join('\n');

      html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_m, i) => codeBlocks[+i]);
      html = html.replace(/\u0000INLINECODE(\d+)\u0000/g, (_m, i) => inlineCodes[+i]);

      return html;
    });
  }

  App.markdown = { render: renderMarkdown, clearCache: () => cache.clear() };
})(typeof globalThis !== 'undefined' ? globalThis : this);
