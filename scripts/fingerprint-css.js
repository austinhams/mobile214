#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cssDir = path.join(__dirname, '..', 'public', 'css');
const src = path.join(cssDir, 'tailwind.css');

if (!fs.existsSync(src)) {
  console.error('tailwind.css not found — run build:css first');
  process.exit(1);
}

const content = fs.readFileSync(src);
const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
const hashedName = `tailwind.${hash}.css`;
const dest = path.join(cssDir, hashedName);

// Remove any previously fingerprinted files
for (const f of fs.readdirSync(cssDir)) {
  if (/^tailwind\.[a-f0-9]{8}\.css$/.test(f)) {
    fs.unlinkSync(path.join(cssDir, f));
  }
}

// Write the new fingerprinted file
fs.copyFileSync(src, dest);

// Write the asset manifest so app.js can resolve the filename at runtime
const manifest = { 'tailwind.css': `/css/${hashedName}` };
fs.writeFileSync(
  path.join(cssDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

console.log(`CSS fingerprinted: ${hashedName}`);
