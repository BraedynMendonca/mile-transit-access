import { gunzipSync, strFromU8 } from 'fflate';
import type { Dataset } from './types';

/** Production ships the identical snapshot compressed to keep phone downloads small. */
export async function loadTransitData(signal: AbortSignal): Promise<Dataset> {
  const path = import.meta.env.DEV ? '/data/transit.json' : '/data/transit.json.gz';
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error('The transit snapshot could not be loaded. Please reload.');
  if (import.meta.env.DEV) return response.json() as Promise<Dataset>;

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Also accept a host that already decoded an HTTP Content-Encoding response.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return JSON.parse(strFromU8(bytes)) as Dataset;
  }
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json() as Promise<Dataset>;
  }
  return JSON.parse(strFromU8(gunzipSync(bytes))) as Dataset;
}
