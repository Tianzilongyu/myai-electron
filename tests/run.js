'use strict';

/**
 * 测试入口：node tests/run.js
 *
 * 四段式：
 *   1. 语法体检 —— 所有 js 文件 node --check
 *   2. 主进程单测 —— 配置 / AI 助手 / 安全底线 / 工具 / Agent / 文件生成
 *   3. 渲染层冒烟 —— jsdom 里把界面整个跑起来，走一遍主流程
 *   4. 接线检查 —— DOM id、api 面、IPC 通道、跨模块调用名
 *
 * 任何一项红了就退出码非 0。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* ---------------- 极简断言框架 ---------------- */
const results = { pass: 0, fail: 0, skip: 0 };
const failures = [];
let currentGroup = '';

const PLAIN = process.argv.includes('--plain') || Boolean(process.env.NO_COLOR);
const out = [];
const ANSI_RE = /\x1b\[\d+m/g;

function say(line) {
  out.push(line.replace(ANSI_RE, ''));
  process.stdout.write(line + '\n');
}

const C = {
  red: (s) => (PLAIN ? s : `\x1b[31m${s}\x1b[0m`),
  green: (s) => (PLAIN ? s : `\x1b[32m${s}\x1b[0m`),
  yellow: (s) => (PLAIN ? s : `\x1b[33m${s}\x1b[0m`),
  dim: (s) => (PLAIN ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s) => (PLAIN ? s : `\x1b[1m${s}\x1b[0m`),
};

const t = {
  group(name) {
    currentGroup = name;
    say(`\n── ${name} ${'─'.repeat(Math.max(0, 46 - name.length))}`);
  },
  ok(label, cond, detail) {
    if (cond) {
      results.pass += 1;
      say(`  ✓ ${label}`);
    } else {
      results.fail += 1;
      failures.push(`[${currentGroup}] ${label}${detail ? ' → ' + detail : ''}`);
      say(`  ✗ ${label}${detail ? ' → ' + detail : ''}`);
    }
    return Boolean(cond);
  },
  eq(label, actual, expected, detail) {
    const cond = Object.is(actual, expected) || actual === expected;
    return t.ok(label, cond, cond ? detail : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}${detail ? ' / ' + detail : ''}`);
  },
  info(label, text) {
    say(`  · ${label}：${text}`);
  },
  skip(label) {
    results.skip += 1;
    say(`  ~ ${label}`);
  },
};

/* ---------------- 1. 语法体检 ---------------- */
function syntaxCheck() {
  t.group('语法体检');
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue;
        walk(p);
      } else if (name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'tests'));
  files.push(path.join(ROOT, 'preload.js'));

  const node = process.execPath;
  let bad = 0;
  files.forEach((f) => {
    try {
      execFileSync(node, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      bad += 1;
      say(`  ✗ ${path.relative(ROOT, f)}`);
      say(String(e.stderr || e.message));
    }
  });
  t.eq(`${files.length} 个文件语法通过`, bad, 0);
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  say('\n=== MyAI 桌面客户端 · 自检 ===');
  say(C.bold(''));

  syntaxCheck();

  try {
    await require('./unit-main')(t);
  } catch (e) {
    t.ok('主进程单测执行完成', false, e.stack);
  }

  let App = null;
  try {
    App = await require('./smoke')(t);
  } catch (e) {
    t.group('渲染层冒烟');
    t.ok('渲染层冒烟执行完成', false, e.stack);
  }

  try {
    require('./wiring')(t, App);
  } catch (e) {
    t.group('接线检查');
    t.ok('接线检查执行完成', false, e.stack);
  }

  process.stdout.write(`\n${C.bold('=== 结果 ===')}\n`);
  say(`  通过 ${results.pass} · 失败 ${results.fail} · 跳过 ${results.skip}`);
  if (failures.length) {
    say('\n失败清单：');
    failures.forEach((f) => say(`  - ${f}`));
  }
  try {
    fs.writeFileSync(path.join(__dirname, '.report.txt'), out.join('\n'), 'utf8');
  } catch (e) { /* 写不出报告不影响退出码 */ }
  process.exit(results.fail ? 1 : 0);
})();
