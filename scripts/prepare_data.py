#!/usr/bin/env python3
"""Build a small, inspectable transit analysis snapshot from public source data.

Requires Python 3.10+ and curl. No API key or third-party Python package is needed.
Caltrans' monthly analysis copy of Wheels is used instead of a private 511 token.
"""
import argparse
import base64
import concurrent.futures
import csv
import datetime as dt
import hashlib
import gzip
import io
import json
import math
import re
from pathlib import Path
import subprocess
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.data-cache'
OUT = ROOT / 'public' / 'data'
BBOX = (37.62, -121.99, 37.78, -121.70)
WHEELS_FEED = base64.b64encode(b'https://api.511.org/transit/datafeeds?operator_id=WH').decode()
RESOURCES = {
 'routes': 'c6bbb637-988f-431c-8444-aef7277297f8',
 'stops': '8c876204-e12b-48a2-8299-10f6ae3d4f2b',
 'trips': '0e4da89e-9330-43f8-8de9-305cb7d4918f',
 'stop_times': 'd31eef2f-e223-4ca4-a86b-170acc6b2590',
 'calendar': 'a79f10b8-b322-43f3-b3f4-ba46a8dbe9ab',
 'calendar_dates': '06a21a8e-dba3-4e7e-8726-f2e992cc1a80',
}

def download(url, path, refresh=False, post=None, timeout=120):
    if path.exists() and not refresh:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    command = ['curl', '-fLsS', '--retry', '2', '--max-time', str(timeout)]
    if post:
        command += ['--data-urlencode', 'data=' + post]
    command += [url, '-o', str(temporary)]
    subprocess.run(command, check=True)
    temporary.replace(path)
    return path

def wheels_table(name, refresh=False):
    path = CACHE / ('wheels-' + name + '.json')
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    result, offset = [], 0
    while True:
        args = {'resource_id': RESOURCES[name], 'filters': json.dumps({'base64_url': WHEELS_FEED}), 'limit': 32000, 'offset': offset}
        url = 'https://data.ca.gov/api/3/action/datastore_search?' + urllib.parse.urlencode(args)
        p = download(url, CACHE / f'{name}-{offset}.json', refresh)
        payload = json.loads(p.read_text())
        if not payload.get('success'):
            raise RuntimeError(f'Caltrans request failed: {name}')
        records = payload['result']['records']
        result.extend(records)
        if len(result) >= payload['result'].get('total', len(result)) or not records:
            break
        offset += len(records)
    path.write_text(json.dumps(result))
    print(f'Wheels {name}: {len(result):,} rows', flush=True)
    return result

def zip_table(archive, name):
    try:
        return list(csv.DictReader(io.TextIOWrapper(archive.open(name + '.txt'), encoding='utf-8-sig')))
    except KeyError:
        return []

def seconds(value):
    if value is None or value == '':
        return None
    if isinstance(value, (int, float)):
        return int(value)
    # Caltrans exposes normalized time strings; GTFS permits hours beyond 24.
    value = str(value).split(' ')[-1]
    if ':' not in value:
        return int(float(value))
    h, m, s = value.split(':')
    return int(h) * 3600 + int(m) * 60 + int(float(s))

def date_string(value):
    return str(value).replace('-', '')[:8]

def haversine(a, b):
    rad = math.pi / 180
    p1, p2 = a[0] * rad, b[0] * rad
    dlat, dlon = (b[0] - a[0]) * rad, (b[1] - a[1]) * rad
    return 6371000 * 2 * math.asin(min(1, math.sqrt(math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2)))

def within(lat, lon):
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]

def build_transit(tables):
    stops, routes, services, trips = [], [], [], []
    stop_ids, route_ids, service_ids = {}, {}, {}
    exceptions = []
    source_stats = []
    for agency, rows in tables.items():
        relevant = set()
        for r in rows['stops']:
            lat, lon = float(r['stop_lat']), float(r['stop_lon'])
            if not within(lat, lon) or str(r.get('location_type') or '0') not in ('0', '1'):
                continue
            key = agency + ':' + r['stop_id']
            stop_ids[key] = len(stops)
            relevant.add(r['stop_id'])
            stops.append({'id': key, 'name': r['stop_name'], 'lat': lat, 'lon': lon, 'agency': agency, 'station': str(r.get('location_type')) == '1'})
        for r in rows['routes']:
            key = agency + ':' + r['route_id']
            route_ids[key] = len(routes)
            routes.append({'id': key, 'shortName': r.get('route_short_name') or r.get('route_long_name') or 'BART', 'name': r.get('route_long_name') or '', 'agency': agency, 'color': '#'+(r.get('route_color') or ('007f75' if agency == 'wheels' else '2487c4')), 'type': int(r['route_type'])})
        for r in rows['calendar']:
            key = agency + ':' + r['service_id']
            service_ids[key] = len(services)
            services.append({'id': key, 'days': [int(r.get(d) or 0) for d in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')], 'start': date_string(r['start_date']), 'end': date_string(r['end_date']), 'agency': agency})
        for r in rows['calendar_dates']:
            key = agency + ':' + r['service_id']
            if key not in service_ids:
                service_ids[key] = len(services)
                services.append({'id': key, 'days': [0]*7, 'start': date_string(r['date']), 'end': date_string(r['date']), 'agency': agency})
            exceptions.append([service_ids[key], date_string(r['date']), int(r['exception_type'])])
        times = {}
        for r in rows['stop_times']:
            if r['stop_id'] not in relevant:
                continue
            arr, dep = seconds(r.get('arrival_time')), seconds(r.get('departure_time'))
            if arr is None and dep is None:
                continue
            arr = arr if arr is not None else dep
            dep = dep if dep is not None else arr
            times.setdefault(r['trip_id'], []).append((int(r['stop_sequence']), [stop_ids[agency+':'+r['stop_id']],arr,dep,int(r.get('pickup_type') or 0),int(r.get('drop_off_type') or 0)]))
        before = len(trips)
        for r in rows['trips']:
            st = [v for _, v in sorted(times.get(r['trip_id'], []))]
            sk, rk = agency+':'+r['service_id'], agency+':'+r['route_id']
            if len(st) < 2 or sk not in service_ids or rk not in route_ids:
                continue
            if any(st[i][1] < st[i-1][2] for i in range(1,len(st))):
                continue
            trips.append({'id':agency+':'+r['trip_id'], 'route': route_ids[rk], 'service':service_ids[sk], 'headsign':r.get('trip_headsign') or routes[route_ids[rk]]['name'], 'times':st})
        dates = [r['start'] for r in services if r['agency']==agency]
        ends = [r['end'] for r in services if r['agency']==agency]
        source_stats.append({'agency':agency,'trips':len(trips)-before,'start':min(dates),'end':max(ends)})
    used_stops={x[0] for trip in trips for x in trip['times']}
    for i,s in enumerate(stops):
        s['served']=i in used_stops
    return stops, routes, services, exceptions, trips, source_stats

def build_osm(refresh=False):
    for name in ['walk-network','places']:
        cached=CACHE/(name+'.json');bundled=ROOT/'data'/'source'/(name+'.json.gz')
        if not refresh and not cached.exists() and bundled.exists():
            cached.write_bytes(gzip.decompress(bundled.read_bytes()))
    bbox=','.join(str(x) for x in BBOX)
    walk_query=f'[out:json][timeout:100];way[highway][highway!~"motorway|trunk|proposed|construction|motorway_link|trunk_link"][access!~"private|no"][foot!="no"]({bbox});(._;>;);out body;'
    poi_query=f'[out:json][timeout:90];(nwr[amenity~"^(library|college|school|hospital|clinic)$"][name]({bbox});nwr[shop=supermarket][name]({bbox});nwr[leisure=park][name]({bbox}););out center tags;'
    for name,query in [('walk-network',walk_query),('places',poi_query)]:
        path=CACHE/(name+'.json')
        if not path.exists() or refresh:
            errors=[]
            for endpoint in ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter']:
                try:
                    download(endpoint,path,True,query,150)
                    break
                except Exception as error:errors.append(str(error))
            else:raise RuntimeError('OpenStreetMap download unavailable: '+ '; '.join(errors))
    raw=json.loads((CACHE/'walk-network.json').read_text())
    raw_nodes={x['id']:x for x in raw['elements'] if x['type']=='node'}
    ways=[x for x in raw['elements'] if x['type']=='way' and 'highway' in x.get('tags',{})]
    node_ids={n for w in ways for n in w.get('nodes',[]) if n in raw_nodes}
    index={n:i for i,n in enumerate(sorted(node_ids))}
    nodes=[[round(raw_nodes[n]['lat'],6),round(raw_nodes[n]['lon'],6)] for n in sorted(node_ids)]
    edges,seen=[],set()
    for w in ways:
        for a,b in zip(w['nodes'],w['nodes'][1:]):
            if a not in index or b not in index or a==b:continue
            ai,bi=index[a],index[b]
            k=tuple(sorted((ai,bi)))
            if k in seen:continue
            seen.add(k)
            edges.append([ai,bi,max(1,round(haversine(nodes[ai],nodes[bi])))])
    pois=json.loads((CACHE/'places.json').read_text())
    places=[]
    seen_names=[]
    for p in pois['elements']:
        tags=p.get('tags',{});name=tags.get('name')
        if not name:continue
        loc=p.get('center',p)
        if 'lat' not in loc or not within(loc['lat'],loc['lon']):continue
        cat='groceries' if tags.get('shop')=='supermarket' else 'parks' if tags.get('leisure')=='park' else 'libraries' if tags.get('amenity')=='library' else 'health' if tags.get('amenity') in ('clinic','hospital') else 'learning'
        # Drop duplicate point/area representations of the same nearby place.
        if any(n.casefold()==name.casefold() and haversine(c,(loc['lat'],loc['lon']))<350 for n,c in seen_names):continue
        seen_names.append((name,(loc['lat'],loc['lon'])))
        places.append({'id':f"osm:{p['type']}/{p['id']}",'name':name,'category':cat,'lat':loc['lat'],'lon':loc['lon'],'url':f"https://www.openstreetmap.org/{p['type']}/{p['id']}",'address':' '.join(str(tags.get(x,'')) for x in ('addr:housenumber','addr:street')).strip()})
    print(f'OSM: {len(nodes):,} walking nodes, {len(edges):,} edges, {len(places)} places',flush=True)
    return {'nodes':nodes,'edges':edges},places

def snap_entities(entities,graph):
    # Spatial binning keeps this near-linear while preserving actual great-circle distance.
    bins={}
    for i,(lat,lon) in enumerate(graph['nodes']):bins.setdefault((int(lat*100),int(lon*100)),[]).append(i)
    for e in entities:
        y,x=int(e['lat']*100),int(e['lon']*100)
        candidates=[i for dy in (-1,0,1) for dx in (-1,0,1) for i in bins.get((y+dy,x+dx),[])]
        if not candidates:e['node']=-1;e['snapDistance']=None;continue
        d,n=min((haversine((e['lat'],e['lon']),graph['nodes'][i]),i) for i in candidates)
        e['node']=n if d<=220 else -1
        e['snapDistance']=round(d)

def contract_graph(graph,entities):
    """Remove degree-two geometry nodes without changing routing distances/topology.

    Every stop/POI snap is protected. Original polyline geometry stays on each edge.
    This is a graph contraction, not a straight-line walking shortcut.
    """
    adjacency=[[] for _ in graph['nodes']]
    for a,b,d in graph['edges']:
        adjacency[a].append((b,d));adjacency[b].append((a,d))
    protected={e['node'] for e in entities if e['node']>=0}
    critical={i for i,neighbors in enumerate(adjacency) if len(neighbors)!=2}|protected
    mapping={old:new for new,old in enumerate(sorted(critical))}
    new_nodes=[graph['nodes'][i] for i in sorted(critical)]
    visited=set();edges=[];geometries=[]
    for start in sorted(critical):
        for target,dist in adjacency[start]:
            edge=tuple(sorted((start,target)))
            if edge in visited:continue
            visited.add(edge);points=[graph['nodes'][start],graph['nodes'][target]]
            previous,current=start,target
            while current not in critical:
                next_node,step=next(x for x in adjacency[current] if x[0]!=previous)
                visited.add(tuple(sorted((current,next_node))))
                dist+=step;previous,current=current,next_node;points.append(graph['nodes'][current])
            edges.append([mapping[start],mapping[current],dist]);geometries.append(points)
    for e in entities:
        if e['node']>=0:e['node']=mapping[e['node']]
    print(f'Routing graph: {len(new_nodes):,} junctions; {len(edges):,} connected segments',flush=True)
    return {'nodes':new_nodes,'edges':edges,'geometry':geometries}

def build_census(refresh=False):
    path=OUT/'census.geojson'
    if path.exists() and not refresh:
        return
    item_url='https://www.arcgis.com/sharing/rest/content/items/458ceeeff7e847af8257ad5ce58e0161?f=pjson'
    item=json.loads(download(item_url,CACHE/'acs-item.json',refresh).read_text())
    match=re.search(r'Current Vintage</strong>:\s*(\d{4}-\d{4})',item.get('description',''))
    if not match:raise RuntimeError('Census vintage could not be verified')
    args={'where':"GEOID LIKE '0600145%'",'outFields':'GEOID,NAME,State,County,B08201_001E,B08201_001M,B08201_002E,B08201_002M','f':'geojson','outSR':'4326','geometryPrecision':5}
    url=item['url']+'/2/query?'+urllib.parse.urlencode(args)
    raw=json.loads(download(url,CACHE/'acs-tracts.json',refresh).read_text())
    if not raw.get('features'):raise RuntimeError('Census response contains no tract data')
    raw['metadata']={'release':'ACS '+match.group(1).replace('-','–')+' 5-year','table':'B08201','sourceUrl':'https://www.arcgis.com/home/item.html?id=458ceeeff7e847af8257ad5ce58e0161','downloadUrl':url,'retrievedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
    path.write_text(json.dumps(raw,separators=(',',':')))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--refresh',action='store_true',help='Refresh transit and Census sources')
    p.add_argument('--refresh-transit',action='store_true')
    p.add_argument('--refresh-census',action='store_true')
    p.add_argument('--refresh-walk',action='store_true',help='Explicitly re-download the walking network; normally the bundled OSM snapshot is reused')
    args=p.parse_args()
    CACHE.mkdir(exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        wheel_rows=dict(zip(RESOURCES,executor.map(lambda name:wheels_table(name,args.refresh or args.refresh_transit),RESOURCES)))
    bart_zip=download('https://www.bart.gov/dev/schedules/google_transit.zip',CACHE/'bart.zip',args.refresh or args.refresh_transit)
    with zipfile.ZipFile(bart_zip) as z:bart_rows={name:zip_table(z,name) for name in RESOURCES}
    stops,routes,services,exceptions,trips,stats=build_transit({'wheels':wheel_rows,'bart':bart_rows})
    graph,places=build_osm(args.refresh_walk)
    snap_entities(stops+places,graph)
    places=[p for p in places if p['node']>=0]
    graph=contract_graph(graph,stops+places)
    build_census(args.refresh or args.refresh_census)
    common_start=max(s['start'] for s in stats);common_end=min(s['end'] for s in stats)
    if common_start>common_end:raise RuntimeError('The transit feed calendars do not overlap. Refresh data before analysis.')
    today=dt.date.today();default=dt.date.fromisoformat(f'{common_start[:4]}-{common_start[4:6]}-{common_start[6:]}')
    end=dt.date.fromisoformat(f'{common_end[:4]}-{common_end[4:6]}-{common_end[6:]}')
    default=min(max(today,default),end)
    if default.weekday()!=0 and default+dt.timedelta(days=(7-default.weekday())%7)<=end:default+=dt.timedelta(days=(7-default.weekday())%7)
    origins=[]
    for name,match in [('Dublin/Pleasanton BART','Dublin/Pleasanton'),('West Dublin/Pleasanton BART','West Dublin/Pleasanton'),('Livermore Transit Center','Livermore Transit Center'),('Las Positas College','Las Positas College'),('Dublin Library','Alameda County Library Dublin'),('Dublin High School','Dublin High School'),('Emerald Glen Park','Emerald Glen Community Park')]:
        candidates=[(i,s) for i,s in enumerate(stops) if s['node']>=0 and (s['name']==match or match.lower() in s['name'].lower())]
        if candidates:
            i,s=min(candidates,key=lambda x:(not x[1]['station'],len(x[1]['name'])))
            origins.append({'id':name.lower().replace('/','-').replace(' ','-'),'name':name,'lat':s['lat'],'lon':s['lon'],'node':s['node'],'snapDistance':s['snapDistance'],'stopIndex':i})
        else:
            dest=next((s for s in places if match.lower() in s['name'].lower()),None)
            if dest:origins.append({k:dest[k] for k in ('id','name','lat','lon','node','snapDistance')})
    if not origins:raise RuntimeError('No study origins found')
    bundle={'version':1,'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'bounds':BBOX,'defaultDate':default.isoformat(),'validRange':{'start':common_start,'end':common_end},'sources':stats,'stops':stops,'routes':routes,'services':services,'exceptions':exceptions,'trips':trips,'graph':graph,'destinations':places,'origins':origins}
    text=json.dumps(bundle,separators=(',',':'))
    (OUT/'transit.json').write_text(text)
    manifest={'generatedAt':bundle['generatedAt'],'sha256':hashlib.sha256(text.encode()).hexdigest(),'bytes':len(text.encode()),'stops':len(stops),'trips':len(trips),'routes':len(routes),'places':len(places),'walkingNodes':len(graph['nodes']),'walkingEdges':len(graph['edges']),'sources':stats,'sourceUrls':{'wheels':'https://data.ca.gov/dataset/cal-itp-gtfs-ingest-pipeline-dataset','bart':'https://www.bart.gov/schedules/developers/gtfs','walking':'https://www.openstreetmap.org/copyright'},'validRange':bundle['validRange']}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2),flush=True)

if __name__=='__main__':main()
