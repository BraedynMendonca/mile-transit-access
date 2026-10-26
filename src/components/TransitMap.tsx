import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Expand, Layers, MapPin, Minus, Plus } from 'lucide-react';
import type {
  Analysis,
  Category,
  CensusData,
  Dataset,
  Destination,
  Origin,
  PlaceResult,
  TractProperties,
} from '../lib/types';
import { TransitEngine } from '../lib/routing';

const symbols: Record<Category, string> = {
  groceries: 'M5 7h14l-1 14H6L5 7Zm4 0V5a3 3 0 0 1 6 0v2',
  libraries: 'M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2v16',
  parks: 'm12 2-7 9h4l-5 7h7v4h2v-4h7l-5-7h4L12 2Z',
  learning: 'm2 9 10-6 10 6-10 6L2 9Zm4 3v6l6 3 6-3v-6',
  health: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z',
};
const pointIcon = (category: Category, reachable: boolean, selected: boolean) =>
  L.divIcon({
    className: 'place-map-icon',
    html: `<span class="place-pin ${reachable ? 'reachable' : 'unreachable'} ${selected ? 'selected' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="${symbols[category]}"/></svg></span>`,
    iconSize: selected ? [38, 38] : [30, 30],
    iconAnchor: selected ? [19, 19] : [15, 15],
  });

interface Props {
  data: Dataset;
  result: Analysis | null;
  origin: Origin;
  category: string;
  selected: PlaceResult | null;
  census: CensusData | null;
  equity: boolean;
  choosing: boolean;
  onChoose: (lat: number, lon: number) => void;
  onSelect: (place: Destination) => void;
  onTract: (tract: TractProperties) => void;
  onToggleEquity: () => void;
}
export default function TransitMap({
  data,
  result,
  origin,
  category,
  selected,
  census,
  equity,
  choosing,
  onChoose,
  onSelect,
  onTract,
  onToggleEquity,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<Record<string, L.LayerGroup>>({});
  const engine = useRef<TransitEngine | null>(null);
  const choosingRef = useRef(choosing);
  const onChooseRef = useRef(onChoose);
  const [tilesFailed, setTilesFailed] = useState(false);
  choosingRef.current = choosing;
  onChooseRef.current = onChoose;
  useEffect(() => {
    if (!container.current) return;
    const m = L.map(container.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      minZoom: 10,
      maxZoom: 18,
    }).setView([37.707, -121.878], 12);
    map.current = m;
    engine.current = new TransitEngine(data);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(m);
    let failures = 0;
    tiles.on('tileerror', () => {
      if (++failures > 3) setTilesFailed(true);
    });
    const base = L.layerGroup().addTo(m);
    L.polyline(
      data.graph.geometry ??
        data.graph.edges.map(([a, b]) => [data.graph.nodes[a], data.graph.nodes[b]]),
      { color: '#adb8b1', weight: 1, opacity: 0.18, interactive: false },
    ).addTo(base);
    const labels: [string, number, number][] = [
      ['DUBLIN', 37.727, -121.912],
      ['PLEASANTON', 37.665, -121.891],
      ['LIVERMORE', 37.689, -121.764],
    ];
    labels.forEach(([name, lat, lon]) =>
      L.marker([lat, lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'town-label',
          html: `<span>${name}</span>`,
          iconSize: [100, 20],
        }),
      }).addTo(base),
    );
    layers.current = Object.fromEntries(
      ['census', 'reach', 'stops', 'places', 'origin', 'journey'].map((name) => [
        name,
        L.layerGroup().addTo(m),
      ]),
    );
    m.on('click', (event) => {
      if (choosingRef.current) onChooseRef.current(event.latlng.lat, event.latlng.lng);
    });
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, [data]);
  useEffect(() => {
    if (!map.current || !layers.current.origin) return;
    const layer = layers.current.origin;
    layer.clearLayers();
    L.marker([origin.lat, origin.lon], {
      zIndexOffset: 1000,
      keyboard: false,
      interactive: false,
      icon: L.divIcon({
        className: 'origin-map-icon',
        html: '<span class="origin-pin"><span></span></span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    })
      .addTo(layer)
      .bindTooltip('Your starting point');
  }, [origin, data]);
  useEffect(() => {
    const layer = layers.current.reach,
      stops = layers.current.stops;
    if (!layer || !stops) return;
    layer.clearLayers();
    stops.clearLayers();
    if (!result) return;
    const reachable = new Set(result.reachableNodes.map(([i]) => i));
    const edges = data.graph.edges.flatMap(([a, b], i) =>
      reachable.has(a) && reachable.has(b)
        ? [data.graph.geometry?.[i] ?? [data.graph.nodes[a], data.graph.nodes[b]]]
        : [],
    );
    L.polyline(edges, { color: '#2c8b68', weight: 3.5, opacity: 0.6, interactive: false }).addTo(
      layer,
    );
    result.arrivals.forEach((arrival, i) => {
      if (!arrival || !data.stops[i].served) return;
      const stop = data.stops[i];
      const tip = document.createElement('span');
      tip.textContent = stop.name;
      L.circleMarker([stop.lat, stop.lon], {
        radius: 2.5,
        color: '#fff',
        weight: 1,
        fillColor: '#176a50',
        fillOpacity: 1,
      })
        .addTo(stops)
        .bindTooltip(tip);
    });
  }, [data, result]);
  useEffect(() => {
    const layer = layers.current.places,
      m = map.current;
    if (!layer || !m) return;
    const reachable = new Set(result?.places.map((p) => p.place.id));
    const render = () => {
      layer.clearLayers();
      const groups = new Map<string, Destination[]>();
      data.destinations
        .filter((p) => category === 'all' || p.category === category)
        .forEach((place) => {
          const xy = m.latLngToContainerPoint([place.lat, place.lon]);
          const selectedPlace = selected?.place.id === place.id;
          const key =
            selectedPlace || m.getZoom() >= 17
              ? place.id
              : `${Math.floor(xy.x / 45)}:${Math.floor(xy.y / 45)}`;
          const group = groups.get(key) || [];
          group.push(place);
          groups.set(key, group);
        });
      groups.forEach((group) => {
        if (group.length === 1) {
          const place = group[0];
          const isReachable = reachable.has(place.id);
          const tip = document.createElement('span');
          tip.textContent = place.name + (isReachable ? '' : ' · outside your time budget');
          const marker = L.marker([place.lat, place.lon], {
            icon: pointIcon(place.category, isReachable, selected?.place.id === place.id),
            zIndexOffset: isReachable ? 400 : 0,
            keyboard: true,
            title: place.name,
          })
            .addTo(layer)
            .bindTooltip(tip)
            .on('click', () => onSelect(place));
          marker.getElement()?.setAttribute('aria-label', place.name);
        } else {
          const count = group.filter((p) => reachable.has(p.id)).length;
          const center: [number, number] = [
            group.reduce((s, p) => s + p.lat, 0) / group.length,
            group.reduce((s, p) => s + p.lon, 0) / group.length,
          ];
          const title = `${group.length} mapped places · ${count} in reach. Zoom to explore.`;
          const tip = document.createElement('span');
          tip.textContent = title;
          const marker = L.marker(center, {
            title,
            icon: L.divIcon({
              className: 'cluster-map-icon',
              html: `<span class="place-cluster ${count ? 'has-reach' : ''}">${group.length}</span>`,
              iconSize: [32, 32],
              iconAnchor: [16, 16],
            }),
            zIndexOffset: count ? 350 : 0,
          })
            .addTo(layer)
            .bindTooltip(tip)
            .on('click', () => m.setView(center, m.getZoom() + 2, { animate: true }));
          marker.getElement()?.setAttribute('aria-label', title);
        }
      });
    };
    render();
    m.on('moveend', render);
    return () => {
      m.off('moveend', render);
    };
  }, [data, result, category, selected?.place.id, onSelect]);
  useEffect(() => {
    const layer = layers.current.journey;
    if (!layer) return;
    layer.clearLayers();
    if (!selected || !engine.current) return;
    for (const leg of selected.legs) {
      const points =
        leg.type === 'walk'
          ? engine.current.path(leg.from, leg.to)
          : leg.stopIndices.map((i) => [data.stops[i].lat, data.stops[i].lon] as [number, number]);
      if (points.length < 2) continue;
      L.polyline(points, { color: '#fff', weight: 9, opacity: 0.92, interactive: false }).addTo(
        layer,
      );
      L.polyline(points, {
        color: leg.type === 'walk' ? '#3b7460' : '#1e576e',
        weight: leg.type === 'walk' ? 4 : 5,
        opacity: 1,
        dashArray: leg.type === 'walk' ? '5 7' : undefined,
        interactive: false,
      }).addTo(layer);
    }
    if (map.current)
      map.current.fitBounds(
        L.latLngBounds([
          [origin.lat, origin.lon],
          [selected.place.lat, selected.place.lon],
        ]).pad(0.25),
        { maxZoom: 14, animate: true },
      );
  }, [selected, data, origin]);
  useEffect(() => {
    const layer = layers.current.census;
    if (!layer) return;
    layer.clearLayers();
    if (!equity || !census) return;
    L.geoJSON(census as GeoJSON.GeoJsonObject, {
      style: (feature) => {
        const p = feature?.properties as TractProperties;
        const rate = p.B08201_002E !== null && p.B08201_001E ? p.B08201_002E / p.B08201_001E : null;
        return {
          color: '#9c6b4a',
          weight: 1,
          opacity: 0.35,
          fillColor:
            rate === null
              ? '#adb0aa'
              : rate > 0.08
                ? '#9b633c'
                : rate > 0.04
                  ? '#c6945b'
                  : rate > 0.02
                    ? '#dec397'
                    : '#f0e7cf',
          fillOpacity: 0.48,
        };
      },
      onEachFeature: (feature, polygon) => {
        polygon.on('click', () => onTract(feature.properties as TractProperties));
      },
    }).addTo(layer);
  }, [census, equity, onTract]);
  return (
    <div className={`map-frame ${choosing ? 'choosing' : ''}`}>
      <div
        ref={container}
        className="leaflet-map"
        role="region"
        aria-label="Interactive transit access map for Dublin and the Tri-Valley"
      />
      <div className="map-topline">
        <span className="map-label">
          <span className="live-dot" /> SCHEDULE-BASED ACCESS
        </span>
        <button className={`map-layer-button ${equity ? 'active' : ''}`} onClick={onToggleEquity}>
          <Layers size={15} />
          <span>Vehicle access</span>
        </button>
      </div>
      {choosing && (
        <div className="map-pick-notice">
          <MapPin size={16} />
          Click a street to choose your starting point
        </div>
      )}
      {tilesFailed && (
        <div className="map-fallback">
          Street tiles unavailable. The downloaded walking network is still shown.
        </div>
      )}
      <div className="map-controls">
        <button title="Zoom in" aria-label="Zoom map in" onClick={() => map.current?.zoomIn()}>
          <Plus size={17} />
        </button>
        <button title="Zoom out" aria-label="Zoom map out" onClick={() => map.current?.zoomOut()}>
          <Minus size={17} />
        </button>
        <span />
        <button
          title="Show study area"
          aria-label="Fit map to study area"
          onClick={() =>
            map.current?.fitBounds([
              [37.645, -121.975],
              [37.755, -121.725],
            ])
          }
        >
          <Expand size={16} />
        </button>
      </div>
      <div className="map-legend">
        <span>
          <i className="legend-line" />
          Reachable walking network
        </span>
        <span>
          <i className="legend-dot" />
          Place in reach
        </span>
        {equity && (
          <span>
            <i className="legend-tract" />
            Darker = more households without a vehicle
          </span>
        )}
      </div>
      <div className="map-location-note">DUBLIN · PLEASANTON · LIVERMORE</div>
    </div>
  );
}
