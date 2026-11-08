#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.pipeline_restore');
const chunks = fs.readdirSync(dir).filter(f => f.endsWith('.b64')).sort();
const b64 = chunks.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
const content = Buffer.from(b64, 'base64').toString('utf8');
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), 'authoritativeVerificationPipeline.ts');
fs.writeFileSync(target, content);
console.log('Restored', target, content.length, 'bytes');
