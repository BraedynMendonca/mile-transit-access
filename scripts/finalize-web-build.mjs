import { readFile, writeFile, unlink } from 'node:fs/promises';

// The production loader reads the compressed snapshot. Keep the source JSON for
// validation and development, but avoid publishing a redundant 12 MB asset.
await unlink(new URL('../dist/data/transit.json', import.meta.url));
const source = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
// This second configuration supports deploying the already-built dist directory.
await writeFile(
  new URL('../dist/vercel.json', import.meta.url),
  JSON.stringify(
    {
      $schema: source.$schema,
      framework: null,
      buildCommand: null,
      outputDirectory: null,
      headers: source.headers,
    },
    null,
    2,
  ) + '\n',
);
