import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const raw = await readFile(new URL('../public/data/transit.json', import.meta.url));
const packed = gzipSync(raw, { level: 9 });
await writeFile(new URL('../public/data/transit.json.gz', import.meta.url), packed);
await writeFile(
  new URL('../public/data/web.json', import.meta.url),
  JSON.stringify(
    {
      encoding: 'gzip',
      path: '/data/transit.json.gz',
      originalBytes: raw.length,
      downloadBytes: packed.length,
      sha256: createHash('sha256').update(raw).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Mobile data: ${(packed.length / 1e6).toFixed(2)} MB (${Math.round((1 - packed.length / raw.length) * 100)}% smaller).`,
);
