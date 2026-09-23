;(function (global) {
  'use strict';

  /**
   * [[SAVE:xxx]] 标记解析
   *
   * 模型输出经常不规矩，这里做宽容解析：
   *   - 标记里多几个空格、大小写不一致都认
   *   - 正文外面套了代码围栏就剥掉
   *   - 忘了写闭合标记时，内容一直取到消息结尾（或下一个 SAVE 之前）
   *   - 文件名做安全化处理，防止模型写成 ../../x
   */
  const App = (global.App = global.App || {});

  const OPEN_RE = /\[\[\s*SAVE\s*:\s*([^\]]+?)\s*\]\]/gi;
  const CLOSE_RE = /\[\[\s*\/\s*SAVE\s*\]\]/gi;

  /* 文件名去掉路径分隔符和非法字符，防止模型写成 ../../x 之类 */
  function safeFileName(name) {
    const cleaned = String(name || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/^\.+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return cleaned || '未命名.txt';
  }

  /* 模型常常给文件正文套一层代码围栏，这里剥掉 */
  function stripCodeFence(text) {
    const t = String(text || '').trim();
    const m = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
    return m ? m[1] : t;
  }

  function parseSaveMarkers(content) {
    const text = String(content || '');
    const opens = [];
    let m;
    OPEN_RE.lastIndex = 0;
    while ((m = OPEN_RE.exec(text)) !== null) {
      opens.push({ fileName: m[1], start: m.index, openEnd: m.index + m[0].length });
    }
    if (opens.length === 0) return { files: [], cleanText: text.trim() };

    const files = [];
    const ranges = [];
    opens.forEach((op, i) => {
      CLOSE_RE.lastIndex = op.openEnd;
      const close = CLOSE_RE.exec(text);
      const bodyEnd = close ? close.index : (i + 1 < opens.length ? opens[i + 1].start : text.length);
      const rangeEnd = close ? close.index + close[0].length : bodyEnd;
      const body = stripCodeFence(text.slice(op.openEnd, bodyEnd));
      if (body.trim()) files.push({ fileName: safeFileName(op.fileName), content: body.trim() });
      ranges.push([op.start, rangeEnd]);
    });

    let clean = '';
    let cursor = 0;
    ranges.forEach(([s, e]) => {
      clean += text.slice(cursor, s);
      cursor = Math.max(cursor, e);
    });
    clean += text.slice(cursor);

    return { files, cleanText: clean.trim() };
  }

  App.saveMarkers = { parse: parseSaveMarkers, safeFileName, stripCodeFence };
})(typeof globalThis !== 'undefined' ? globalThis : this);
