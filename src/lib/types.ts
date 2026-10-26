export type Point = {
  lat: number;
  lon: number;
  node: number;
  snapDistance: number;
  name: string;
  id: string;
};
export type Category = 'groceries' | 'libraries' | 'parks' | 'learning' | 'health';
export interface Stop extends Point {
  agency: string;
  station: boolean;
  served: boolean;
}
export interface Destination extends Point {
  category: Category;
  url: string;
  address: string;
}
export interface Origin extends Point {
  stopIndex?: number;
}
export interface Route {
  id: string;
  shortName: string;
  name: string;
  agency: string;
  color: string;
  type: number;
}
export interface Service {
  id: string;
  days: number[];
  start: string;
  end: string;
  agency: string;
}
/** stop index, arrival seconds, departure seconds, pickup type, dropoff type */
export type StopTime = [number, number, number, number, number];
export interface Trip {
  id: string;
  route: number;
  service: number;
  headsign: string;
  times: StopTime[];
}
export interface Dataset {
  version: number;
  generatedAt: string;
  bounds: [number, number, number, number];
  defaultDate: string;
  validRange: { start: string; end: string };
  sources: { agency: string; trips: number; start: string; end: string }[];
  stops: Stop[];
  routes: Route[];
  services: Service[];
  exceptions: [number, string, number][];
  trips: Trip[];
  graph: {
    nodes: [number, number][];
    edges: [number, number, number][];
    geometry?: [number, number][][];
  };
  destinations: Destination[];
  origins: Origin[];
}
export interface Query {
  origin: Origin;
  date: string;
  departure: number;
  budget: number;
  maxWalk: number;
  maxBoardings: number;
}
export interface WalkLeg {
  type: 'walk';
  from: Point;
  to: Point;
  departure: number;
  arrival: number;
  meters: number;
}
export interface RideLeg {
  type: 'ride';
  route: number;
  trip: string;
  headsign: string;
  from: Point;
  to: Point;
  departure: number;
  arrival: number;
  stopIndices: number[];
}
export type Leg = WalkLeg | RideLeg;
export interface JourneyState {
  time: number;
  stop: number;
  boardings: number;
  walked: number;
  prev: JourneyState | null;
  leg: Leg;
}
export interface PlaceResult {
  place: Destination;
  arrival: number;
  minutes: number;
  boardings: number;
  walked: number;
  legs: Leg[];
}
export interface Analysis {
  places: PlaceResult[];
  arrivals: (JourneyState | null)[];
  reachableNodes: [number, number][];
  query: Query;
  activeTrips: number;
  computeMs: number;
}
export interface TractProperties {
  GEOID: string;
  NAME: string;
  State: string;
  County: string;
  B08201_001E: number | null;
  B08201_001M: number | null;
  B08201_002E: number | null;
  B08201_002M: number | null;
}
export interface CensusData {
  type: 'FeatureCollection';
  metadata?: { release: string; sourceUrl: string };
  features: {
    type: 'Feature';
    properties: TractProperties;
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
  }[];
}
