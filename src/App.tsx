import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bus,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Footprints,
  GraduationCap,
  HeartPulse,
  Info,
  Layers,
  Leaf,
  MapPin,
  Navigation,
  Search,
  Share2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  TrainFront,
  Trees,
  X,
} from 'lucide-react';
import type {
  Analysis,
  Category,
  CensusData,
  Dataset,
  Destination,
  Origin,
  PlaceResult,
  Query,
  TractProperties,
} from './lib/types';
import { clock, dateOffset, TransitEngine, WALK_METERS_PER_SECOND } from './lib/routing';
import TransitMap from './components/TransitMap';
import Dialog from './components/Dialog';
import AccessChanges from './components/AccessChanges';

const categories: { id: Category; label: string; icon: typeof ShoppingBag; color: string }[] = [
  { id: 'groceries', label: 'Groceries', icon: ShoppingBag, color: '#b98039' },
  { id: 'libraries', label: 'Libraries', icon: BookOpen, color: '#547dab' },
  { id: 'parks', label: 'Parks', icon: Trees, color: '#568b63' },
  { id: 'learning', label: 'Learning', icon: GraduationCap, color: '#8770a8' },
  { id: 'health', label: 'Health', icon: HeartPulse, color: '#b86d72' },
];
const categoryInfo = (id: Category) => categories.find((c) => c.id === id)!;
const isoDate = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
const prettyDate = (value: string) =>
  new Date(value + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const bounded = (value: string | null, fallback: number, min: number, max: number) => {
  const n = value === null ? fallback : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

interface WorkerMessage {
  type: 'ready' | 'result' | 'error';
  id?: number;
  result?: Analysis;
  daily?: { time: number; count: number }[];
  comparison?: Analysis[] | null;
  message?: string;
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [census, setCensus] = useState<CensusData | null>(null);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [date, setDate] = useState('');
  const [departure, setDeparture] = useState(480);
  const [budget, setBudget] = useState(45);
  const [maxWalk, setMaxWalk] = useState(10);
  const [maxBoardings, setMaxBoardings] = useState(2);
  const [result, setResult] = useState<Analysis | null>(null);
  const [daily, setDaily] = useState<{ time: number; count: number }[]>([]);
  const [comparison, setComparison] = useState<Analysis[] | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [view, setView] = useState<'explore' | 'compare'>('explore');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showOutside, setShowOutside] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [equity, setEquity] = useState(false);
  const [tract, setTract] = useState<TractProperties | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [dialog, setDialog] = useState<'sources' | 'method' | 'share' | null>(null);
  const [toast, setToast] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [mobileSettings, setMobileSettings] = useState(false);
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const mapEngine = useRef<TransitEngine | null>(null);
  const compareScroll = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/data/transit.json', { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error('The transit snapshot could not be loaded.');
        return r.json() as Promise<Dataset>;
      })
      .then((d) => {
        if (!d.stops?.length || !d.trips?.length || !d.origins?.length)
          throw new Error('The transit snapshot is incomplete. Run the data refresh script.');
        const params = new URLSearchParams(window.location.search);
        let initial = d.origins.find((o) => o.id === params.get('origin')) || d.origins[0];
        const engine = new TransitEngine(d);
        mapEngine.current = engine;
        if (params.has('lat') && params.has('lon')) {
          const custom = engine.snap(Number(params.get('lat')), Number(params.get('lon')));
          if (custom) initial = custom;
        }
        const chosenDate = params.get('date') || d.defaultDate;
        const parsedDate = new Date(chosenDate + 'T12:00:00Z');
        const realDate =
          Number.isFinite(parsedDate.getTime()) &&
          parsedDate.toISOString().slice(0, 10) === chosenDate;
        setDate(
          /^\d{4}-\d{2}-\d{2}$/.test(chosenDate) &&
            realDate &&
            chosenDate >= isoDate(d.validRange.start) &&
            chosenDate <= isoDate(d.validRange.end)
            ? chosenDate
            : d.defaultDate,
        );
        setDeparture(bounded(params.get('time'), 480, 0, 1439));
        setBudget(bounded(params.get('budget'), 45, 15, 90));
        setMaxWalk(bounded(params.get('walk'), 10, 5, 15));
        setMaxBoardings(bounded(params.get('boardings'), 2, 1, 3));
        if (params.get('view') === 'compare') setView('compare');
        setData(d);
        setOrigin(initial);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    fetch('/data/census.geojson', { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c?.features) setCensus(c);
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!data) return;
    const w = new Worker(new URL('./lib/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const m = event.data;
      if (m.type === 'ready') setWorkerReady(true);
      if (m.type === 'result' && m.id === request.current && m.result) {
        setResult(m.result);
        setDaily(m.daily || []);
        setComparison(m.comparison || null);
        setBusy(false);
      }
      if (m.type === 'error') {
        setError(m.message || 'The access calculation failed.');
        setBusy(false);
      }
    };
    w.onerror = () => {
      setError('The analysis worker could not start. Please reload this page.');
      setBusy(false);
    };
    // Geometry is needed for drawing, not analysis. Avoid copying it to the worker.
    const { geometry: _geometry, ...workerGraph } = data.graph;
    w.postMessage({ type: 'init', data: { ...data, graph: workerGraph } });
    return () => {
      w.terminate();
      setWorkerReady(false);
    };
  }, [data]);
  const query = useMemo<Query | null>(
    () => (origin && date ? { origin, date, departure, budget, maxWalk, maxBoardings } : null),
    [origin, date, departure, budget, maxWalk, maxBoardings],
  );
  useEffect(() => {
    if (!workerReady || !query) return;
    const id = ++request.current;
    setBusy(true);
    const timer = window.setTimeout(
      () =>
        worker.current?.postMessage({ type: 'analyze', id, query, compare: view === 'compare' }),
      120,
    );
    return () => window.clearTimeout(timer);
  }, [query, workerReady, view]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setSelectedId(null);
    setShowAll(false);
  }, [origin, date, departure, budget, maxWalk, maxBoardings]);
  useEffect(() => {
    if (view === 'compare' && comparison && !busy && compareScroll.current) {
      document
        .querySelector('.comparison-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      compareScroll.current = false;
    }
  }, [view, comparison, busy]);

  const selected = result?.places.find((p) => p.place.id === selectedId) || null;
  const selectPlace = useCallback(
    (place: Destination) => {
      if (result?.places.some((p) => p.place.id === place.id)) setSelectedId(place.id);
      else
        setToast('This place is outside the current time or walking limit. Try a larger budget.');
    },
    [result],
  );
  const chooseOrigin = useCallback((lat: number, lon: number) => {
    const point = mapEngine.current?.snap(lat, lon);
    if (!point) {
      setToast('Choose a point within 220 metres of a mapped public walking route.');
      return;
    }
    setOrigin(point);
    setChoosing(false);
    setSelectedId(null);
  }, []);
  const selectTract = useCallback((p: TractProperties) => setTract(p), []);
  const toggleEquity = useCallback(() => setEquity((p) => !p), []);
  const visible = useMemo(() => {
    if (!data || !result) return [];
    const matched = new Map(result.places.map((p) => [p.place.id, p]));
    const ordered = data.destinations
      .filter(
        (p) =>
          (category === 'all' || category === p.category) &&
          p.name.toLowerCase().includes(search.toLowerCase()) &&
          (showOutside || matched.has(p.id)),
      )
      .map((place) => ({ place, journey: matched.get(place.id) }))
      .sort(
        (a, b) =>
          (a.journey?.minutes ?? Infinity) - (b.journey?.minutes ?? Infinity) ||
          a.place.name.localeCompare(b.place.name),
      );
    if (category === 'all' && !search && !showOutside) {
      const highlights = categories
        .map((c) => ordered.find((p) => p.place.category === c.id))
        .filter((p): p is (typeof ordered)[number] => Boolean(p));
      const highlighted = new Set(highlights.map((p) => p.place.id));
      return [...highlights, ...ordered.filter((p) => !highlighted.has(p.place.id))];
    }
    return ordered;
  }, [data, result, category, search, showOutside]);
  const summary = result
    ? {
        places: result.places.length,
        stops: result.arrivals.filter(Boolean).length,
        categories: new Set(result.places.map((p) => p.place.category)).size,
      }
    : null;

  function makeUrl() {
    if (!query) return window.location.href;
    const p = new URLSearchParams({
      origin: query.origin.id,
      date: query.date,
      time: String(departure),
      budget: String(budget),
      walk: String(maxWalk),
      boardings: String(maxBoardings),
      view,
    });
    if (query.origin.id === 'custom') {
      p.set('lat', String(query.origin.lat));
      p.set('lon', String(query.origin.lon));
    }
    return `${window.location.origin}${window.location.pathname}?${p}`;
  }
  async function share() {
    const url = makeUrl();
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link copied. Your location, date, and settings are included.');
    } catch {
      setShareUrl(url);
      setDialog('share');
    }
  }
  function downloadCsv() {
    if (!data || !result || !query) return;
    const found = new Map(result.places.map((p) => [p.place.id, p]));
    const rows: unknown[][] = [
      [
        'place',
        'category',
        'reachable',
        'travel_minutes',
        'boardings',
        'walking_metres',
        'departure_date',
        'departure_time_pacific',
        'origin',
        'budget_minutes',
        'max_walk_minutes_per_leg',
        'snapshot_utc',
        'source',
      ],
    ];
    data.destinations.forEach((p) => {
      const r = found.get(p.id);
      rows.push([
        p.name,
        p.category,
        Boolean(r),
        r?.minutes ?? '',
        r?.boardings ?? '',
        r ? Math.round(r.walked) : '',
        date,
        clock(departure * 60),
        origin?.name,
        budget,
        maxWalk,
        data.generatedAt,
        p.url,
      ]);
    });
    const csv = rows
      .map((row) =>
        row
          .map((v) => {
            let s = String(v ?? '');
            if (typeof v === 'string' && /^[=+@-]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mile-access-${date}-${departure}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('Access results exported with source and analysis settings.');
  }
  function eveningCase() {
    compareScroll.current = true;
    setDeparture(1200);
    setBudget(45);
    setView('compare');
    setCategory('all');
    document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (error && !data)
    return (
      <div className="startup">
        <div className="brand-symbol">m</div>
        <h1>We couldn’t load the transit data.</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  if (!data || !origin)
    return (
      <div className="startup">
        <div className="brand-symbol">m</div>
        <h1>A little more possibility.</h1>
        <p>Loading real transit schedules for the Tri-Valley…</p>
        <div className="loading-track">
          <span />
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Mile home">
          <span className="brand-symbol">
            <svg viewBox="0 0 30 30" fill="none">
              <path
                d="M5 22V8l10 10L25 8v14"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            mile<span className="brand-period">.</span>
          </span>
          <span className="brand-tag">TRANSIT ACCESS LAB</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={view === 'explore' ? 'nav-active' : ''}
            onClick={() => setView('explore')}
          >
            Explore
          </button>
          <button
            className={view === 'compare' ? 'nav-active' : ''}
            onClick={() => {
              compareScroll.current = true;
              setView('compare');
              if (view === 'compare' && comparison && !busy) {
                document
                  .querySelector('.comparison-section')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                compareScroll.current = false;
              }
            }}
          >
            Compare times
          </button>
          <button onClick={() => setDialog('method')}>
            How it works <ArrowUpRight size={13} />
          </button>
        </nav>
        <span className="location-badge">
          <MapPin size={14} />
          Tri-Valley, CA <span>94568</span>
        </span>
      </header>
      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">
              <span />
              MORE ACCESS. MORE POSSIBILITY.
            </div>
            <h1>
              Dublin, <em>without the drive.</em>
            </h1>
            <p>See what a bus ride, a train, and a little walking can open up.</p>
          </div>
          <button className="case-card" onClick={eveningCase}>
            <span className="case-icon">
              <Sparkles size={20} />
            </span>
            <span>
              <small>A QUESTION WORTH ASKING</small>
              <strong>What changes after 8 pm?</strong>
            </span>
            <ArrowUpRight size={20} />
          </button>
        </section>
        <section id="workspace" className="workspace" aria-label="Transit access explorer">
          <aside className={`planner ${mobileSettings ? 'mobile-open' : ''}`}>
            <div className="planner-title">
              <span className="section-kicker">YOUR JOURNEY</span>
              <SlidersHorizontal size={16} />
              <button
                className="mobile-planner-toggle"
                aria-expanded={mobileSettings}
                onClick={() => setMobileSettings((v) => !v)}
              >
                {mobileSettings ? 'Close settings' : 'Change journey'}
                <ChevronDown size={14} />
              </button>
            </div>
            <div className="mobile-planner-summary">
              {origin.name}
              <span>
                {clock(departure * 60)} · {budget} min
              </span>
            </div>
            <label className="field-label" htmlFor="origin">
              Where are you starting?
            </label>
            <div className="origin-select">
              <MapPin size={17} />
              <select
                id="origin"
                value={origin.id}
                onChange={(event) => {
                  const next = data.origins.find((o) => o.id === event.target.value);
                  if (next) {
                    setOrigin(next);
                    setChoosing(false);
                  }
                }}
              >
                {origin.id === 'custom' && <option value="custom">Selected map location</option>}
                {data.origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <button
              className={`map-pick-button ${choosing ? 'active' : ''}`}
              onClick={() => setChoosing((v) => !v)}
            >
              <Navigation size={13} />
              {choosing ? 'Cancel map selection' : 'Choose a point on the map'}
              <ArrowUpRight size={12} />
            </button>
            <div className="control-divider" />
            <label className="field-label" htmlFor="date">
              When are you leaving?
            </label>
            <div className="date-field">
              <CalendarDays size={15} />
              <input
                id="date"
                type="date"
                value={date}
                min={isoDate(data.validRange.start)}
                max={isoDate(data.validRange.end)}
                onChange={(e) => {
                  if (
                    e.target.value >= isoDate(data.validRange.start) &&
                    e.target.value <= isoDate(data.validRange.end)
                  )
                    setDate(e.target.value);
                }}
              />
            </div>
            <div className="time-heading">
              <span>
                <Clock3 size={14} />
                Departure
              </span>
              <input
                aria-label="Departure time, Pacific time"
                type="time"
                value={`${String(Math.floor(departure / 60)).padStart(2, '0')}:${String(departure % 60).padStart(2, '0')}`}
                onInput={(e) => {
                  const [h, m] = e.currentTarget.value.split(':').map(Number);
                  if (Number.isFinite(h) && Number.isFinite(m)) setDeparture(h * 60 + m);
                }}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number);
                  if (Number.isFinite(h) && Number.isFinite(m)) setDeparture(h * 60 + m);
                }}
              />
            </div>
            <input
              className="range"
              aria-label="Departure time slider"
              type="range"
              min="300"
              max="1380"
              step="15"
              value={Math.max(300, Math.min(1380, departure))}
              onChange={(e) => setDeparture(Number(e.target.value))}
            />
            <div className="range-labels">
              <span>5 am</span>
              <span>All times Pacific</span>
              <span>11 pm</span>
            </div>
            <div className="control-divider" />
            <div className="budget-label">
              <label className="field-label" htmlFor="budget">
                How far can your time go?
              </label>
              <strong>
                {budget}
                <small> min</small>
              </strong>
            </div>
            <input
              id="budget"
              className="range"
              type="range"
              min="15"
              max="90"
              step="5"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
            <div className="budget-presets">
              {[15, 30, 45, 60].map((v) => (
                <button
                  key={v}
                  className={budget === v ? 'active' : ''}
                  onClick={() => setBudget(v)}
                >
                  {v} min
                </button>
              ))}
            </div>
            <div className="walk-field">
              <label className="field-label">
                <Footprints size={14} />
                Walking per leg
              </label>
              <div className="segmented" role="group" aria-label="Maximum walking time per leg">
                {[5, 10, 15].map((v) => (
                  <button
                    key={v}
                    aria-pressed={maxWalk === v}
                    className={maxWalk === v ? 'active' : ''}
                    onClick={() => setMaxWalk(v)}
                  >
                    {v} min
                  </button>
                ))}
              </div>
            </div>
            <div className="transfer-field">
              <label htmlFor="transfers">Transfers</label>
              <select
                id="transfers"
                value={maxBoardings}
                onChange={(e) => setMaxBoardings(Number(e.target.value))}
              >
                <option value="1">No transfers</option>
                <option value="2">Up to 1 transfer</option>
                <option value="3">Up to 2 transfers</option>
              </select>
            </div>
            <div className="planner-note">
              <Info size={14} />
              <p>Travel time includes walking, waiting, and transfers. Places may be closed.</p>
            </div>
            <div className="day-profile">
              <div>
                <strong>A day of possibilities</strong>
                <span>Mapped places within {budget} min</span>
              </div>
              <div className="mini-chart">
                {daily.length ? (
                  daily.map((d) => (
                    <button
                      key={d.time}
                      title={`${clock(d.time * 60)}: ${d.count} reachable places`}
                      onClick={() => setDeparture(d.time)}
                      aria-label={`${d.count} places at ${clock(d.time * 60)}; select this departure time`}
                      className={departure === d.time ? 'selected' : ''}
                    >
                      <span className="mini-number">{d.count}</span>
                      <i
                        style={{
                          height: `${Math.max(3, (d.count / Math.max(1, ...daily.map((x) => x.count))) * 42)}px`,
                        }}
                      />
                      <span>{clock(d.time * 60).replace(':00', '')}</span>
                    </button>
                  ))
                ) : (
                  <span className="chart-loading">Calculating the day…</span>
                )}
              </div>
            </div>
          </aside>
          <div className="map-column">
            <div className="map-toolbar">
              <div className="view-title">
                <span>{view === 'explore' ? 'THE ACCESS EXPLORER' : 'THE EVENING GAP'}</span>
                <strong>
                  {view === 'explore' ? (
                    <>Your next {budget} minutes, mapped.</>
                  ) : (
                    <>Same place. Different possibilities.</>
                  )}
                </strong>
              </div>
              <button className="text-button" aria-label="Share view" onClick={share}>
                <Share2 size={15} />
                <span>Share view</span>
              </button>
            </div>
            <div className="map-container">
              <TransitMap
                data={data}
                result={result}
                origin={origin}
                category={category}
                selected={selected}
                census={census}
                equity={equity}
                choosing={choosing}
                onChoose={chooseOrigin}
                onSelect={selectPlace}
                onTract={selectTract}
                onToggleEquity={toggleEquity}
              />
              {busy && (
                <div className="calculating" role="status">
                  <span className="spinner" />
                  Finding your possibilities…
                </div>
              )}
              {selected && (
                <div className="journey-panel">
                  <div className="journey-panel-top">
                    <span className="section-kicker">YOUR WAY THERE</span>
                    <button
                      aria-label="Close journey details"
                      className="icon-button"
                      onClick={() => setSelectedId(null)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <h3>{selected.place.name}</h3>
                  <div className="journey-summary">
                    <strong>{selected.minutes} min</strong>
                    <span>{Math.round(selected.walked / 100) / 10} km walking</span>
                    <span>Arrive {clock(selected.arrival)}</span>
                  </div>
                  <div className="journey-steps">
                    {selected.legs.map((leg, i) => {
                      const wait =
                        i === 0
                          ? Math.max(0, leg.departure - departure * 60)
                          : Math.max(0, leg.departure - selected.legs[i - 1].arrival);
                      return (
                        <div className="journey-step" key={i}>
                          <span className={`leg-icon ${leg.type}`}>
                            {leg.type === 'walk' ? (
                              <Footprints size={14} />
                            ) : data.routes[leg.route].agency === 'bart' ? (
                              <TrainFront size={14} />
                            ) : (
                              <Bus size={14} />
                            )}
                          </span>
                          <div>
                            {wait >= 60 && <small>Wait {Math.ceil(wait / 60)} min</small>}
                            <strong>
                              {leg.type === 'walk'
                                ? `Walk ${Math.ceil((leg.arrival - leg.departure) / 60)} min`
                                : `${data.routes[leg.route].agency === 'bart' ? 'BART' : `Wheels ${data.routes[leg.route].shortName}`} · ${Math.ceil((leg.arrival - leg.departure) / 60)} min`}
                            </strong>
                            <span>{leg.type === 'walk' ? `to ${leg.to.name}` : leg.headsign}</span>
                            <small>
                              {clock(leg.departure)} → {clock(leg.arrival)}
                            </small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <a href={selected.place.url} target="_blank" rel="noreferrer">
                    View place source <ExternalLink size={12} />
                  </a>
                </div>
              )}
              {equity && tract && !selected && (
                <div className="tract-panel">
                  <button
                    className="icon-button"
                    aria-label="Close neighborhood context"
                    onClick={() => setTract(null)}
                  >
                    <X size={16} />
                  </button>
                  <span className="section-kicker">NEIGHBORHOOD CONTEXT</span>
                  <h3>{tract.NAME}</h3>
                  <strong>
                    {tract.B08201_002E !== null && tract.B08201_001E
                      ? `${((tract.B08201_002E / tract.B08201_001E) * 100).toFixed(1)}%`
                      : 'No data'}
                  </strong>
                  <p>of households have no vehicle available</p>
                  <small>
                    {tract.B08201_002E !== null
                      ? `${number(tract.B08201_002E)} households ± ${tract.B08201_002M !== null ? number(tract.B08201_002M) : 'unreported MOE'}`
                      : 'Estimate unavailable'}{' '}
                    · {census?.metadata?.release || 'ACS'}
                  </small>
                  <p className="tiny-note">
                    Census context describes the full tract. It does not identify individual
                    households or measure who is served by the highlighted streets.
                  </p>
                </div>
              )}
            </div>
            <div className={`access-summary ${busy ? 'updating' : ''}`} aria-live="polite">
              <div className="summary-lead">
                <span className="summary-icon">
                  <Navigation size={21} />
                </span>
                <div>
                  <strong>
                    {summary?.places ?? '—'}
                    <small> / {data.destinations.length}</small>
                  </strong>
                  <span>mapped places in reach</span>
                </div>
              </div>
              <div>
                <strong>{summary?.stops ?? '—'}</strong>
                <span>transit stops in reach</span>
              </div>
              <div>
                <strong>
                  {summary?.categories ?? '—'}
                  <small> / 5</small>
                </strong>
                <span>types of everyday places</span>
              </div>
              <span className="summary-footnote">
                <span className="live-dot" />
                Real schedules.
                <br />
                Computed locally.
              </span>
            </div>
          </div>
        </section>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {view === 'compare' && comparison && (
          <section className="comparison-section">
            <div className="section-heading">
              <div>
                <div className="eyebrow">LOOK BEYOND A SINGLE TRIP</div>
                <h2>What does the evening change?</h2>
                <p>Same origin and date. Same {budget}-minute budget. Different departure times.</p>
              </div>
              <span className="comparison-date">{prettyDate(date)}</span>
            </div>
            <div className="comparison-grid">
              {comparison.map((r, i) => (
                <button
                  key={i}
                  className={`compare-card ${i === 1 ? 'evening' : ''}`}
                  onClick={() => {
                    setDeparture(i === 0 ? 480 : 1200);
                    setView('explore');
                  }}
                >
                  <span>{i === 0 ? 'MORNING · 8 AM' : 'EVENING · 8 PM'}</span>
                  <strong>
                    {r.places.length}
                    <small>places reachable</small>
                  </strong>
                  <p>
                    {r.places.filter((p) => p.boardings > 0).length} involve a transit ride{' '}
                    <ArrowUpRight size={18} />
                  </p>
                </button>
              ))}
              <div className="compare-breakdown">
                {categories.map((cat) => {
                  const a = comparison[0].places.filter((p) => p.place.category === cat.id).length,
                    b = comparison[1].places.filter((p) => p.place.category === cat.id).length;
                  return (
                    <div key={cat.id}>
                      <cat.icon size={15} />
                      <span>{cat.label}</span>
                      <span>{a}</span>
                      <ArrowRight size={12} />
                      <strong className={b < a ? 'decrease' : ''}>{b}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="comparison-caveat">
              This measures scheduled reachability to OSM-mapped places, not opening hours or actual
              on-time performance.
            </p>
            <AccessChanges
              comparison={comparison}
              onInspect={(place, time) => {
                setDeparture(time);
                setView('explore');
                setCategory(place.category);
                setSearch(place.name);
                document
                  .querySelector('.destinations-section')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          </section>
        )}
        <section className="destinations-section" aria-label="Reachable places">
          <div className="section-heading">
            <div>
              <div className="eyebrow">EVERYDAY DESTINATIONS</div>
              <h2>A little closer than you think.</h2>
              <p>Explore what’s within your time budget. Select a place to see the journey.</p>
            </div>
            <button className="secondary-button" onClick={downloadCsv} disabled={!result || busy}>
              <Download size={15} />
              Export results
            </button>
          </div>
          <div className="destination-controls">
            <div className="category-tabs" role="group" aria-label="Filter destination category">
              <button
                className={category === 'all' ? 'active' : ''}
                aria-pressed={category === 'all'}
                onClick={() => setCategory('all')}
              >
                All places <span>{result?.places.length ?? '—'}</span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  className={category === cat.id ? 'active' : ''}
                  aria-pressed={category === cat.id}
                  onClick={() => setCategory(cat.id)}
                >
                  <cat.icon size={14} />
                  {cat.label}
                </button>
              ))}
            </div>
            <label className="destination-search">
              <Search size={15} />
              <input
                placeholder="Find a place"
                aria-label="Search destinations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <div className="destination-meta">
            <span>
              {visible.length} {showOutside ? 'mapped' : 'reachable'} places
              {category !== 'all'
                ? ` · ${categoryInfo(category as Category).label.toLowerCase()}`
                : ''}
            </span>
            <label>
              <input
                type="checkbox"
                checked={showOutside}
                onChange={(e) => setShowOutside(e.target.checked)}
              />
              Include places outside the budget
            </label>
          </div>
          <div className="destination-grid">
            {(showAll ? visible : visible.slice(0, 8)).map(({ place, journey }) => {
              const cat = categoryInfo(place.category);
              return (
                <button
                  className={`destination-card ${!journey ? 'outside' : ''} ${selectedId === place.id ? 'selected' : ''}`}
                  key={place.id}
                  onClick={() => {
                    selectPlace(place);
                    if (journey)
                      document
                        .getElementById('workspace')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <div className="destination-card-top">
                    <span className={`destination-icon ${place.category}`}>
                      <cat.icon size={20} />
                    </span>
                    {journey ? (
                      <span className="travel-badge">
                        <Clock3 size={12} />
                        {journey.minutes} min
                      </span>
                    ) : (
                      <span className="outside-badge">Outside budget</span>
                    )}
                  </div>
                  <h3>{place.name}</h3>
                  <span className="destination-type">
                    {cat.label}
                    {place.address ? ` · ${place.address}` : ''}
                  </span>
                  <div className="destination-card-bottom">
                    <span>
                      {journey ? (
                        journey.boardings === 0 ? (
                          <>
                            <Footprints size={14} />
                            Walk only
                          </>
                        ) : (
                          <>
                            <Bus size={14} />
                            {journey.boardings} ride{journey.boardings > 1 ? 's' : ''}
                            <span className="tiny-dot" />
                            <Footprints size={13} />
                            {Math.ceil(journey.walked / WALK_METERS_PER_SECOND / 60)} min
                          </>
                        )
                      ) : (
                        'Try a different time or budget'
                      )}
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                </button>
              );
            })}
          </div>
          {result && !busy && !visible.length && (
            <div className="empty-state">
              <Search size={26} />
              <h3>No places match this view.</h3>
              <p>Try another category, a larger travel budget, or a different departure time.</p>
              <button
                className="secondary-button"
                onClick={() => {
                  setCategory('all');
                  setSearch('');
                  setBudget(60);
                }}
              >
                Broaden the search
              </button>
            </div>
          )}
          {visible.length > 8 && (
            <button className="show-more" onClick={() => setShowAll((p) => !p)}>
              {showAll ? 'Show fewer places' : `Explore all ${visible.length} places`}
              <ChevronDown size={15} className={showAll ? 'rotated' : ''} />
            </button>
          )}
        </section>
        <section className="purpose-strip">
          <span>
            <Leaf size={24} />
          </span>
          <div>
            <h3>Access is more than a line on a map.</h3>
            <p>
              A stop nearby doesn’t always mean a useful trip. Mile makes the time between places
              visible.
            </p>
          </div>
          <button className="text-button" onClick={() => setDialog('method')}>
            Meet the method <ArrowUpRight size={16} />
          </button>
        </section>
        <footer>
          <div>
            <span className="footer-brand">mile.</span>
            <span>An independent civic project for the Tri-Valley.</span>
          </div>
          <div>
            <span>
              Schedules: BART · Wheels via Caltrans ·{' '}
              <a href="https://511.org" target="_blank" rel="noreferrer">
                data provided by 511.org
              </a>
            </span>
            <button onClick={() => setDialog('sources')}>
              Data & sources <ArrowUpRight size={12} />
            </button>
          </div>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {dialog === 'share' && (
        <Dialog title="Share this view" onClose={() => setDialog(null)}>
          <p>Copy this link to share the origin, date, and travel settings.</p>
          <input
            className="share-input"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.target.select()}
          />
        </Dialog>
      )}
      {dialog === 'method' && (
        <Dialog
          title="A map of possibilities, built from schedules."
          onClose={() => setDialog(null)}
        >
          <p>
            Mile asks a specific question:{' '}
            <strong>which mapped everyday places can you reach within a time budget?</strong> It
            analyzes scheduled transit and a downloaded walking network in your browser.
          </p>
          <div className="method-steps">
            <div>
              <span>01</span>
              <h3>Start with a real departure.</h3>
              <p>
                The engine selects trips that operate on your date, including holiday exceptions and
                trips continuing after midnight. Every result includes waiting time.
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>Follow the actual network.</h3>
              <p>
                Walking follows connected OSM streets and paths. A round-based timetable search
                permits up to your chosen number of transfers, with a two-minute transfer buffer.
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>Count what’s within reach.</h3>
              <p>
                Travel time includes the walk to transit, rides, waits, and the final walk to a
                destination. Your walking limit applies separately to each walking leg.
              </p>
            </div>
          </div>
          <h3>What the map means</h3>
          <p>
            Green street segments connect walking nodes reached within your budget. They are a
            modeled access estimate. Selected transit lines join actual stop locations
            schematically; they are not turn-by-turn directions.
          </p>
          <h3>What to keep in mind</h3>
          <ul>
            <li>
              Schedules are a saved public-data snapshot, not live predictions. Delays,
              cancellations, opening hours, fares, and accessibility are not modeled.
            </li>
            <li>
              Walking is modeled at 4.5 km/h. Stops and places snap to a nearby mapped walking node
              within 220 metres; these short connectors are estimates.
            </li>
            <li>
              OSM places and paths can be incomplete. Missing places are not evidence of missing
              services. The study area is bounded to the Tri-Valley.
            </li>
            <li>
              The vehicle-access layer describes whole Census tracts. It is contextual, not a count
              of households actually served.
            </li>
          </ul>
          <button className="secondary-button" onClick={() => setDialog('sources')}>
            Inspect the data sources <ArrowRight size={15} />
          </button>
        </Dialog>
      )}
      {dialog === 'sources' && (
        <Dialog title="Real data. An inspectable method." onClose={() => setDialog(null)}>
          <p>
            Snapshot built{' '}
            {new Date(data.generatedAt).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'America/Los_Angeles',
            })}
            . Selectable dates are constrained to the overlapping service-calendar range. This app
            does not use live vehicle predictions.
          </p>
          <div className="source-list">
            <a
              href="https://data.ca.gov/dataset/cal-itp-gtfs-ingest-pipeline-dataset"
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <Bus size={20} />
              </span>
              <div>
                <strong>Wheels schedules via Caltrans</strong>
                <p>
                  Public Cal-ITP analysis snapshot: routes, stops, trips, stop times, calendars, and
                  exceptions. Original data provided by 511.org.
                </p>
                <small>
                  {number(data.sources.find((s) => s.agency === 'wheels')?.trips || 0)} study-area
                  trips
                </small>
              </div>
              <ExternalLink size={15} />
            </a>
            <a
              href="https://www.bart.gov/schedules/developers/gtfs"
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <TrainFront size={20} />
              </span>
              <div>
                <strong>BART GTFS schedules</strong>
                <p>
                  Official schedule download. Only stops in the study area are included. Service is
                  selected from actual calendar records.
                </p>
                <small>
                  {number(data.sources.find((s) => s.agency === 'bart')?.trips || 0)} study-area
                  trips
                </small>
              </div>
              <ExternalLink size={15} />
            </a>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              <span>
                <MapPin size={20} />
              </span>
              <div>
                <strong>OpenStreetMap contributors</strong>
                <p>
                  Public walking streets and paths, plus mapped groceries, libraries, parks,
                  learning, and health destinations. ODbL; map tiles © OpenStreetMap contributors.
                </p>
                <small>
                  {number(data.graph.nodes.length)} network nodes · {data.destinations.length}{' '}
                  places
                </small>
              </div>
              <ExternalLink size={15} />
            </a>
            <a
              href={
                census?.metadata?.sourceUrl ||
                'https://www.arcgis.com/home/item.html?id=458ceeeff7e847af8257ad5ce58e0161'
              }
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <Layers size={20} />
              </span>
              <div>
                <strong>U.S. Census {census?.metadata?.release || 'ACS'}, via Esri</strong>
                <p>
                  Table B08201: household vehicle availability. Census tract estimates and 90%
                  margins of error. Counts can be uncertain, especially in small areas.
                </p>
                <small>{census?.features.length || 0} eastern Alameda County tracts</small>
              </div>
              <ExternalLink size={15} />
            </a>
          </div>
          <a
            className="download-manifest"
            href="/data/manifest.json"
            target="_blank"
            rel="noreferrer"
          >
            Open the data manifest <ExternalLink size={14} />
          </a>
          <p className="tiny-note">
            Mile is an independent student project and is not affiliated with BART, Wheels, MTC,
            Caltrans, or the Census Bureau. For actual travel, check the operator’s current
            timetable and alerts.
          </p>
        </Dialog>
      )}
    </div>
  );
}
