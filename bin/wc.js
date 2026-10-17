#!/usr/bin/env node
const fs = require('fs');
const { count } = require('../src/count');

const args = process.argv.slice(2);

let json = false;
let file = null;

for (const arg of args) {
  if (arg === '--json') {
    json = true;
  } else if (arg.startsWith('--')) {
    console.error('usage: wc [--json] <file>');
    process.exit(1);
  } else if (file === null) {
    file = arg;
  } else {
    console.error('usage: wc [--json] <file>');
    process.exit(1);
  }
}

if (file === null) {
  console.error('usage: wc [--json] <file>');
  process.exit(1);
}

let text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (err) {
  console.error(`wc: cannot read ${file}: ${err.message}`);
  process.exit(1);
}

const c = count(text);

if (json) {
  console.log(JSON.stringify({ lines: c.lines, words: c.words, chars: c.chars }));
} else {
  console.log(`${c.lines} ${c.words} ${c.chars} ${file}`);
}
