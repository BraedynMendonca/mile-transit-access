import { TransitEngine } from './routing';
import type { Dataset, Query } from './types';

let engine: TransitEngine;
const dailyCache = new Map<string, { time: number; count: number }[]>();
self.onmessage = (
  event: MessageEvent<
    | { type: 'init'; data: Dataset }
    | { type: 'analyze'; id: number; query: Query; compare: boolean }
  >,
) => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      engine = new TransitEngine(message.data);
      self.postMessage({ type: 'ready' });
      return;
    }
    const result = engine.analyze(message.query);
    const key = JSON.stringify({ ...message.query, departure: 0 });
    let daily = dailyCache.get(key);
    if (!daily) {
      daily = [480, 720, 1020, 1200].map((time) => ({
        time,
        count: engine.analyze({ ...message.query, departure: time }, false).places.length,
      }));
      dailyCache.set(key, daily);
    }
    const comparison = message.compare
      ? [480, 1200].map((time) => engine.analyze({ ...message.query, departure: time }, false))
      : null;
    self.postMessage({ type: 'result', id: message.id, result, daily, comparison });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Analysis failed.',
    });
  }
};
