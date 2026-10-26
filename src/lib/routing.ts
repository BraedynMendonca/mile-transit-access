import type {
  Analysis,
  Dataset,
  JourneyState,
  Leg,
  Origin,
  PlaceResult,
  Point,
  Query,
  Service,
} from './types';

export const WALK_METERS_PER_SECOND = 1.25;
export const TRANSFER_SECONDS = 120;
const MAX_FOOT_DISTANCE = 15 * 60 * WALK_METERS_PER_SECOND;

class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(value: [number, number]) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= value[0]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = value;
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1][0] < a[c][0]) c++;
        if (a[c][0] >= last[0]) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export function haversine(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const p =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(p)));
}

export function dateOffset(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function serviceRuns(
  service: Service,
  index: number,
  date: string,
  exceptions: Dataset['exceptions'],
): boolean {
  const key = date.replaceAll('-', '');
  const exception = exceptions.find((e) => e[0] === index && e[1] === key);
  if (exception) return exception[2] === 1;
  const day = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return key >= service.start && key <= service.end && service.days[day] === 1;
}

export function clock(seconds: number, suffix = true): string {
  const total = Math.round(seconds / 60);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h24 % 12 || 12}:${String(m).padStart(2, '0')}${suffix ? (h24 >= 12 ? ' pm' : ' am') : ''}`;
}

function legsFrom(state: JourneyState | null): Leg[] {
  const legs: Leg[] = [];
  let current = state;
  while (current) {
    legs.push(current.leg);
    current = current.prev;
  }
  return legs.reverse().filter((l) => l.type === 'ride' || l.meters > 15);
}

/** Round-based earliest-arrival routing. Each round permits one additional boarding.
 * Walking edges come from OSM connectivity; total time includes waits and transfers.
 * Walk tolerance is PER LEG. Final walks start only at an alighting stop, preventing
 * chains of walking-only stop hops from silently bypassing that tolerance.
 */
export class TransitEngine {
  readonly data: Dataset;
  readonly adjacency: [number, number, number][][];
  private stopNodes = new Map<number, number[]>();
  private footCache = new Map<number, Map<number, number>>();
  private linkCache = new Map<number, [number, number][]>();
  constructor(data: Dataset) {
    this.data = data;
    this.adjacency = Array.from({ length: data.graph.nodes.length }, () => []);
    data.graph.edges.forEach(([a, b, d], i) => {
      this.adjacency[a].push([b, d, i]);
      this.adjacency[b].push([a, d, i]);
    });
    data.stops.forEach((s, i) => {
      if (s.node < 0 || !s.served) return;
      const items = this.stopNodes.get(s.node) || [];
      items.push(i);
      this.stopNodes.set(s.node, items);
    });
  }
  walking(node: number): Map<number, number> {
    const cached = this.footCache.get(node);
    if (cached) return cached;
    const distances = new Map<number, number>();
    if (node < 0 || !this.adjacency[node]) return distances;
    const heap = new Heap();
    distances.set(node, 0);
    heap.push([0, node]);
    while (heap.size) {
      const [d, n] = heap.pop();
      if (d !== distances.get(n)) continue;
      for (const [next, meters] of this.adjacency[n]) {
        const nd = d + meters;
        if (nd <= MAX_FOOT_DISTANCE && nd < (distances.get(next) ?? Infinity)) {
          distances.set(next, nd);
          heap.push([nd, next]);
        }
      }
    }
    this.footCache.set(node, distances);
    return distances;
  }
  private links(stop: number): [number, number][] {
    const cached = this.linkCache.get(stop);
    if (cached) return cached;
    const s = this.data.stops[stop];
    const links: [number, number][] = [];
    for (const [node, d] of this.walking(s.node))
      for (const i of this.stopNodes.get(node) || []) {
        if (i !== stop)
          links.push([i, d + (s.snapDistance || 0) + (this.data.stops[i].snapDistance || 0)]);
      }
    this.linkCache.set(stop, links);
    return links;
  }
  snap(lat: number, lon: number): Origin | null {
    let nearest = -1,
      distance = Infinity;
    this.data.graph.nodes.forEach(([y, x], i) => {
      const d = haversine({ lat, lon }, { lat: y, lon: x });
      if (d < distance) {
        distance = d;
        nearest = i;
      }
    });
    if (distance > 220) return null;
    return {
      id: 'custom',
      name: 'Selected map location',
      lat,
      lon,
      node: nearest,
      snapDistance: Math.round(distance),
    };
  }
  path(from: Point, to: Point): [number, number][] {
    if (from.node < 0 || to.node < 0)
      return [
        [from.lat, from.lon],
        [to.lat, to.lon],
      ];
    const heap = new Heap();
    const distances = new Map([[from.node, 0]]);
    const prev = new Map<number, [number, number]>();
    heap.push([0, from.node]);
    while (heap.size) {
      const [d, n] = heap.pop();
      if (d !== distances.get(n)) continue;
      if (n === to.node) break;
      for (const [next, meters, edge] of this.adjacency[n]) {
        const nd = d + meters;
        if (nd <= MAX_FOOT_DISTANCE && nd < (distances.get(next) ?? Infinity)) {
          distances.set(next, nd);
          prev.set(next, [n, edge]);
          heap.push([nd, next]);
        }
      }
    }
    if (!distances.has(to.node)) return [];
    const segments: [number, number][][] = [];
    let n = to.node;
    while (n !== from.node) {
      const p = prev.get(n);
      if (!p) return [];
      const [previous, edgeIndex] = p;
      const edge = this.data.graph.edges[edgeIndex];
      const geometry = this.data.graph.geometry?.[edgeIndex] ?? [
        this.data.graph.nodes[edge[0]],
        this.data.graph.nodes[edge[1]],
      ];
      segments.push(edge[0] === previous ? geometry : geometry.slice().reverse());
      n = previous;
    }
    return [[from.lat, from.lon], ...segments.reverse().flat(), [to.lat, to.lon]];
  }
  analyze(query: Query, includeStreets = true): Analysis {
    const started = performance.now();
    const { data } = this;
    const { origin } = query;
    const start = query.departure * 60;
    const deadline = start + query.budget * 60;
    const maxFoot = query.maxWalk * 60 * WALK_METERS_PER_SECOND;
    const best: (JourneyState | null)[] = data.stops.map(() => null);
    const rideBest: (JourneyState | null)[] = data.stops.map(() => null);
    const originWalk = this.walking(origin.node);
    for (const [node, meters] of originWalk)
      for (const i of this.stopNodes.get(node) || []) {
        const stop = data.stops[i];
        const total = meters + origin.snapDistance + (stop.snapDistance || 0);
        const time = start + total / WALK_METERS_PER_SECOND;
        if (total <= maxFoot && time <= deadline)
          best[i] = {
            time,
            stop: i,
            boardings: 0,
            walked: total,
            prev: null,
            leg: {
              type: 'walk',
              from: origin,
              to: stop,
              departure: start,
              arrival: time,
              meters: total,
            },
          };
      }
    // Include previous service day's post-midnight trips and next day's early trips.
    const active = [-1, 0, 1].flatMap((day) => {
      const date = dateOffset(query.date, day);
      const offset = day * 86400;
      const services = data.services.map((s, i) => serviceRuns(s, i, date, data.exceptions));
      return data.trips
        .filter(
          (t) =>
            services[t.service] &&
            t.times.at(-1)![1] + offset >= start &&
            t.times[0][2] + offset <= deadline,
        )
        .map((trip) => ({ trip, offset }));
    });
    for (let round = 1; round <= query.maxBoardings; round++) {
      const previous = best.slice();
      const rides: (JourneyState | null)[] = data.stops.map(() => null);
      for (const { trip, offset } of active) {
        let boarding: { state: JourneyState; index: number } | null = null;
        for (let j = 0; j < trip.times.length; j++) {
          const [stopIndex, arr, dep, pickup, dropoff] = trip.times[j];
          const arrival = arr + offset;
          const departure = dep + offset;
          if (
            boarding &&
            j > boarding.index &&
            dropoff !== 1 &&
            arrival <= deadline &&
            arrival < (rides[stopIndex]?.time ?? Infinity)
          ) {
            const st = boarding.state;
            rides[stopIndex] = {
              time: arrival,
              stop: stopIndex,
              boardings: st.boardings + 1,
              walked: st.walked,
              prev: st,
              leg: {
                type: 'ride',
                route: trip.route,
                trip: trip.id,
                headsign: trip.headsign,
                from: data.stops[trip.times[boarding.index][0]],
                to: data.stops[stopIndex],
                departure: trip.times[boarding.index][2] + offset,
                arrival,
                stopIndices: trip.times.slice(boarding.index, j + 1).map((s) => s[0]),
              },
            };
          }
          const candidate = previous[stopIndex];
          if (
            !boarding &&
            pickup !== 1 &&
            candidate &&
            candidate.boardings < query.maxBoardings &&
            candidate.time + (candidate.boardings > 0 ? TRANSFER_SECONDS : 0) <= departure &&
            departure >= start &&
            departure <= deadline
          )
            boarding = { state: candidate, index: j };
        }
      }
      let improved = false;
      rides.forEach((ride, i) => {
        if (!ride) return;
        if (ride.time < (rideBest[i]?.time ?? Infinity)) rideBest[i] = ride;
        if (ride.time < (best[i]?.time ?? Infinity)) {
          best[i] = ride;
          improved = true;
        }
        for (const [target, meters] of this.links(i)) {
          const time = ride.time + meters / WALK_METERS_PER_SECOND;
          if (meters > maxFoot || time > deadline || time >= (best[target]?.time ?? Infinity))
            continue;
          best[target] = {
            time,
            stop: target,
            boardings: ride.boardings,
            walked: ride.walked + meters,
            prev: ride,
            leg: {
              type: 'walk',
              from: data.stops[i],
              to: data.stops[target],
              departure: ride.time,
              arrival: time,
              meters,
            },
          };
          improved = true;
        }
      });
      if (!improved) break;
    }
    const places: PlaceResult[] = [];
    for (const place of data.destinations) {
      let arrival = Infinity,
        via: JourneyState | null = null,
        finalMeters = 0;
      const direct =
        (originWalk.get(place.node) ?? Infinity) + origin.snapDistance + place.snapDistance;
      if (direct <= maxFoot) {
        arrival = start + direct / WALK_METERS_PER_SECOND;
        finalMeters = direct;
      }
      for (let i = 0; i < rideBest.length; i++) {
        const state = rideBest[i];
        if (!state) continue;
        const stop = data.stops[i];
        const meters =
          (this.walking(stop.node).get(place.node) ?? Infinity) +
          stop.snapDistance +
          place.snapDistance;
        const time = state.time + meters / WALK_METERS_PER_SECOND;
        if (meters <= maxFoot && time < arrival) {
          arrival = time;
          via = state;
          finalMeters = meters;
        }
      }
      if (arrival > deadline) continue;
      const from = via ? data.stops[via.stop] : origin;
      const final: Leg = {
        type: 'walk',
        from,
        to: place,
        departure: via?.time ?? start,
        arrival,
        meters: finalMeters,
      };
      const legs = legsFrom(via);
      if (finalMeters > 15) legs.push(final);
      places.push({
        place,
        arrival,
        minutes: Math.ceil((arrival - start) / 60),
        boardings: via?.boardings ?? 0,
        walked: (via?.walked ?? 0) + finalMeters,
        legs,
      });
    }
    places.sort((a, b) => a.arrival - b.arrival || a.place.name.localeCompare(b.place.name));
    const reach = new Map<number, number>();
    if (includeStreets) {
      const add = (point: Point, time: number) => {
        for (const [node, d] of this.walking(point.node)) {
          const total = d + point.snapDistance;
          const at = time + total / WALK_METERS_PER_SECOND;
          if (total <= maxFoot && at <= deadline && at < (reach.get(node) ?? Infinity))
            reach.set(node, at);
        }
      };
      add(origin, start);
      rideBest.forEach((s, i) => {
        if (s) add(data.stops[i], s.time);
      });
    }
    return {
      places,
      arrivals: best,
      reachableNodes: Array.from(reach),
      query,
      activeTrips: active.length,
      computeMs: Math.round(performance.now() - started),
    };
  }
}
