// 临时编码检测脚本：扫描 src/ 下所有 .vue/.ts 文件，找出非 UTF-8 编码的文件
const fs = require('fs');
const path = require('path');

const root = 'C:/Users/yangx/Desktop/PixelForge/PixelForge/src';
const bad = [];
const total = [];

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (/\.(vue|ts)$/.test(e.name)) {
      total.push(p);
      const buf = fs.readFileSync(p);
      try {
        const dec = new TextDecoder('utf-8', { fatal: true });
        dec.decode(buf);
      } catch {
        bad.push(p);
      }
    }
  }
}

walk(root);
console.log('扫描 .vue/.ts 文件总数:', total.length);
console.log('非 UTF-8 文件数:', bad.length);
console.log('---');
bad.forEach(p => console.log(p.replace(root + path.sep, '')));
