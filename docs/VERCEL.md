# Vercel hosting and mobile website

## Target

- Vercel team: `pingmeherealways-2881s-projects`
- Team ID: `team_BgW00cCQ3P44w56H9d532KQa`
- Project: `mile-transit-access`
- Project ID: `prj_N3HRg7ssyYQmmSIAxlKcSaIDn3vV`
- Environment: Production
- Access: Public website; no Vercel SSO or password requirement. The source repository remains private.

This is a separate project from the account's other websites. Local linking information is stored in the ignored `.vercel/project.json`; it contains project identifiers, not a credential.

## Build and update

```sh
npm install
npm run build
npm run preview
```

The source configuration is a standard Vite deployment: build command `npm run build`, output directory `dist`. From this linked checkout, an authenticated Vercel CLI can publish with `npx vercel --prod`. In a fresh checkout, first run `npx vercel link` and select the existing `mile-transit-access` project in the team above. Do not create a duplicate project.

The initial production deployment uses the connected Vercel API to upload the exact locally verified `dist/` files by SHA-1 and size. `dist/vercel.json` configures those files as a static site with no remote build. Root `vercel.json` remains configured to build from source for future CLI or Git-based deployments.

## Mobile data delivery

The build compresses the original, validated transit snapshot to `transit.json.gz` and removes the redundant uncompressed copy from `dist/`. The production loader uses native browser decompression when available and fflate as a fallback. The decoded bytes and model are unchanged. Development continues to use the original JSON.

`data/web.json` records the original and compressed byte counts and original SHA-256 checksum. Versioned JavaScript and CSS receive immutable cache headers. Data snapshots use a shorter one-hour cache lifetime. Maps, calculations, itineraries, Census context, comparisons, and exports retain the same behavior.

## Mobile checks

- Production preview tested at 390 × 844.
- Page width equals viewport width; destination categories scroll inside their own row.
- Collapsible journey controls open and close on a phone layout.
- Compressed data loads successfully and produces the established default result: 116 places and 341 stops in reach.
- Libraries filtering shows Dublin and Pleasanton libraries with their actual modeled travel times.
- No browser warnings or errors were reported in the checked production-preview flow.

The app remains schedule-based and displays saved source dates; it is not a live vehicle tracker.
