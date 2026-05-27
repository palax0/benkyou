import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatten(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const root = resolve(process.cwd(), 'apps/web/messages');
const en = JSON.parse(readFileSync(`${root}/en.json`, 'utf8')) as Record<string, unknown>;
const zh = JSON.parse(readFileSync(`${root}/zh.json`, 'utf8')) as Record<string, unknown>;

const enKeys = flatten(en);
const zhKeys = flatten(zh);

const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));

if (missingInZh.length || missingInEn.length) {
  if (missingInZh.length) console.error('Missing in zh.json:', missingInZh);
  if (missingInEn.length) console.error('Missing in en.json:', missingInEn);
  process.exit(1);
}

console.log(`✓ i18n keys consistent (${enKeys.length} keys in both)`);
