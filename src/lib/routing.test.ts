import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransitEngine, serviceRuns } from './routing';
import type { Dataset, Query, StopTime, Trip } from './types';

function dataset(): Dataset {
  const points = [0, 1, 2, 3].map((i) => ({
    id: String(i),
    name: `Place ${i}`,
    lat: 37.7,
    lon: -121.9 + i * 0.001,
    node: i,
    snapDistance: 0,
  }));
  return {
    version: 1,
    generatedAt: '2026-10-26',
    bounds: [37, -122, 38, -121],
    defaultDate: '2026-10-26',
    validRange: { start: '20260101', end: '20261231' },
    sources: [],
    origins: [points[0]],
    stops: points.map((p) => ({ ...p, agency: 'wheels', station: false, served: true })),
    destinations: points.map((p) => ({
      ...p,
      category: 'libraries',
      url: 'https://www.openstreetmap.org',
      address: '',
    })),
    routes: [{ id: 'r', shortName: '1', name: 'Test', agency: 'wheels', color: '#000', type: 3 }],
    services: [
      {
        id: 'weekday',
        days: [1, 1, 1, 1, 1, 0, 0],
        start: '20260101',
        end: '20261231',
        agency: 'wheels',
      },
    ],
    exceptions: [],
    trips: [],
    graph: {
      nodes: points.map((p) => [p.lat, p.lon]),
      edges: [
        [0, 1, 720],
        [1, 2, 720],
      ],
    },
  };
}
const st = (stop: number, time: number, pickup = 0, dropoff = 0): StopTime => [
  stop,
  time,
  time,
  pickup,
  dropoff,
];
const trip = (id: string, times: StopTime[]): Trip => ({
  id,
  route: 0,
  service: 0,
  headsign: 'Test',
  times,
});
const query = (d: Dataset, overrides: Partial<Query> = {}): Query => ({
  origin: d.origins[0],
  date: '2026-10-26',
  departure: 480,
  budget: 30,
  maxWalk: 5,
  maxBoardings: 2,
  ...overrides,
});

test('waiting time is included and a departed trip cannot be boarded', () => {
  const d = dataset();
  d.trips = [trip('t', [st(0, 8 * 3600 + 300), st(2, 8 * 3600 + 900)])];
  const e = new TransitEngine(d);
  const early = e.analyze(query(d));
  assert.equal(early.places.find((p) => p.place.id === '2')?.minutes, 15);
  const late = e.analyze(query(d, { departure: 486 }));
  assert.equal(
    late.places.some((p) => p.place.id === '2'),
    false,
  );
  assert.equal(
    e.analyze(query(d, { budget: 10 })).places.some((p) => p.place.id === '2'),
    false,
  );
});
test('a connection needs a two-minute transfer buffer and respects boarding limits', () => {
  const d = dataset();
  d.trips = [
    trip('first', [st(0, 8 * 3600 + 300), st(1, 8 * 3600 + 600)]),
    trip('too-tight', [st(1, 8 * 3600 + 660), st(2, 8 * 3600 + 720)]),
    trip('valid', [st(1, 8 * 3600 + 780), st(2, 8 * 3600 + 1080)]),
  ];
  const e = new TransitEngine(d);
  const result = e.analyze(query(d));
  assert.equal(result.places.find((p) => p.place.id === '2')?.minutes, 18);
  assert.equal(
    e.analyze(query(d, { maxBoardings: 1 })).places.some((p) => p.place.id === '2'),
    false,
  );
});
test('nearby coordinates on disconnected paths never create a walking shortcut', () => {
  const d = dataset();
  d.graph.nodes[3] = [37.7, -121.900001];
  assert.equal(
    new TransitEngine(d).analyze(query(d)).places.some((p) => p.place.id === '3'),
    false,
  );
});
test('walking through successive bus stops cannot bypass the walking-leg limit', () => {
  const d = dataset();
  d.graph.edges = [
    [0, 1, 200],
    [1, 2, 200],
  ];
  const result = new TransitEngine(d).analyze(query(d));
  assert.equal(
    result.places.some((p) => p.place.id === '1'),
    true,
  );
  assert.equal(
    result.places.some((p) => p.place.id === '2'),
    false,
  );
});
test('service exceptions override weekday patterns', () => {
  const d = dataset();
  assert.equal(serviceRuns(d.services[0], 0, '2026-10-26', []), true);
  assert.equal(serviceRuns(d.services[0], 0, '2026-10-26', [[0, '20261026', 2]]), false);
  assert.equal(serviceRuns(d.services[0], 0, '2026-10-25', [[0, '20261025', 1]]), true);
});
test('post-midnight trips use the previous service day calendar', () => {
  const d = dataset();
  d.services[0].days = [1, 0, 0, 0, 0, 0, 0];
  d.trips = [trip('overnight', [st(0, 24 * 3600 + 300), st(2, 24 * 3600 + 900)])];
  const r = new TransitEngine(d).analyze(query(d, { date: '2026-10-27', departure: 0 }));
  assert.equal(r.places.find((p) => p.place.id === '2')?.minutes, 15);
});
test('pickup and dropoff restrictions are honored', () => {
  const d = dataset();
  d.trips = [trip('no-pickup', [st(0, 8 * 3600 + 300, 1), st(2, 8 * 3600 + 900)])];
  assert.equal(
    new TransitEngine(d).analyze(query(d)).places.some((p) => p.place.id === '2'),
    false,
  );
  d.trips = [trip('no-dropoff', [st(0, 8 * 3600 + 300), st(2, 8 * 3600 + 900, 0, 1)])];
  assert.equal(
    new TransitEngine(d).analyze(query(d)).places.some((p) => p.place.id === '2'),
    false,
  );
});
