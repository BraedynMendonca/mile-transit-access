#!/usr/bin/env python3
"""Fetch a bounded local OSM snapshot when public Overpass mirrors are unavailable.

Small cached map requests use the OSM API's documented 50,000-node limit.
At most two requests run concurrently; an oversized box is subdivided.
"""
import concurrent.futures
import json
import time
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.data-cache'
BBOX=(37.62,-121.99,37.78,-121.70)

def fetch(box):
    south,west,north,east=box
    key='_'.join(f'{v:.5f}' for v in box)
    path=CACHE/'osm-tiles'/(key+'.osm')
    if not path.exists():
        path.parent.mkdir(parents=True,exist_ok=True)
        url=f'https://api.openstreetmap.org/api/0.6/map?bbox={west:.6f},{south:.6f},{east:.6f},{north:.6f}'
        r=subprocess.run(['curl','-LsS','--max-time','60','--user-agent','MileTransitAccessLab/1.0',url,'-o',str(path),'-w','%{http_code}'],capture_output=True,text=True)
        if r.stdout=='400' and 'too many nodes' in path.read_text():
            path.unlink();y=(south+north)/2;x=(west+east)/2
            return [b for child in [(south,west,y,x),(south,x,y,east),(y,west,north,x),(y,x,north,east)] for b in fetch(child)]
        if r.returncode or r.stdout!='200':
            path.unlink(missing_ok=True)
            raise RuntimeError(f'OSM map request failed ({r.stdout}): {r.stderr}')
    return [path]

def main():
    CACHE.mkdir(exist_ok=True)
    boxes=[]
    for y in range(5):
        for x in range(8):
            boxes.append((BBOX[0]+(BBOX[2]-BBOX[0])*y/5,BBOX[1]+(BBOX[3]-BBOX[1])*x/8,BBOX[0]+(BBOX[2]-BBOX[0])*(y+1)/5,BBOX[1]+(BBOX[3]-BBOX[1])*(x+1)/8))
    paths=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        for p in executor.map(fetch,boxes):
            paths.extend(p);print(f'OSM local snapshot: {len(paths)} tiles',flush=True)
    nodes,ways,pois={},{},{}
    for path in paths:
        root=ET.parse(path).getroot()
        raw_nodes={int(n.attrib['id']):{'type':'node','id':int(n.attrib['id']),'lat':float(n.attrib['lat']),'lon':float(n.attrib['lon']),'tags':{t.attrib['k']:t.attrib['v'] for t in n.findall('tag')}} for n in root.findall('node')}
        for n in root.findall('node'):
            v=raw_nodes[int(n.attrib['id'])];t=v['tags']
            if t.get('name') and (t.get('shop')=='supermarket' or t.get('leisure')=='park' or t.get('amenity') in ['library','school','college','hospital','clinic']):pois[('node',v['id'])]=v
        for w in root.findall('way'):
            tags={t.attrib['k']:t.attrib['v'] for t in w.findall('tag')};refs=[int(n.attrib['ref']) for n in w.findall('nd')];wid=int(w.attrib['id'])
            walk=tags.get('highway') and tags['highway'] not in ['motorway','trunk','motorway_link','trunk_link','construction','proposed','raceway'] and tags.get('foot')!='no' and tags.get('access') not in ['private','no']
            if walk:
                ways[wid]={'type':'way','id':wid,'nodes':refs,'tags':tags}
                for n in refs:
                    if n in raw_nodes:nodes[n]=raw_nodes[n]
            if tags.get('name') and (tags.get('shop')=='supermarket' or tags.get('leisure')=='park' or tags.get('amenity') in ['library','school','college','hospital','clinic']):
                coords=[raw_nodes[n] for n in refs if n in raw_nodes]
                if coords:pois[('way',wid)]={'type':'way','id':wid,'tags':tags,'center':{'lat':sum(n['lat'] for n in coords)/len(coords),'lon':sum(n['lon'] for n in coords)/len(coords)}}
    (CACHE/'walk-network.json').write_text(json.dumps({'elements':list(nodes.values())+list(ways.values()),'source':'OpenStreetMap API 0.6 local snapshot'}))
    (CACHE/'places.json').write_text(json.dumps({'elements':list(pois.values()),'source':'OpenStreetMap API 0.6 local snapshot'}))
    print(f'OSM complete: {len(nodes):,} road/path nodes; {len(ways):,} ways; {len(pois):,} places',flush=True)

if __name__=='__main__':main()
