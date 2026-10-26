#!/usr/bin/env python3
"""Validate the shipped snapshot and its provenance without any network requests."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'public'/'data'
raw=(root/'transit.json').read_bytes();d=json.loads(raw);m=json.loads((root/'manifest.json').read_text())
assert hashlib.sha256(raw).hexdigest()==m['sha256'],'Snapshot checksum mismatch'
assert d['validRange']['start']<=d['defaultDate'].replace('-','')<=d['validRange']['end']
assert d['validRange']['start']<=d['validRange']['end'],'No shared service period'
assert len({s['id'] for s in d['stops']})==len(d['stops']),'Duplicate stop IDs'
assert len({t['id'] for t in d['trips']})==len(d['trips']),'Duplicate trip IDs'
assert len(d['graph']['geometry'])==len(d['graph']['edges'])
for a,b,meters in d['graph']['edges']:
    assert 0<=a<len(d['graph']['nodes']) and 0<=b<len(d['graph']['nodes']) and meters>0
for t in d['trips']:
    assert len(t['times'])>=2
    assert 0<=t['route']<len(d['routes']) and 0<=t['service']<len(d['services'])
    for i,st in enumerate(t['times']):
        assert 0<=st[0]<len(d['stops']) and st[2]>=st[1]
        if i:assert st[1]>=t['times'][i-1][2]
for p in d['destinations']+d['origins']:
    assert 0<=p['node']<len(d['graph']['nodes']) and 0<=p['snapDistance']<=220
c=json.loads((root/'census.geojson').read_text());assert c['features'] and 'metadata' in c
assert '2020–2024' in c['metadata']['release']
print(f"Validated {len(d['trips']):,} trips, {len(d['stops'])} stops, {len(d['destinations'])} places, {len(c['features'])} Census tracts; checksum and graph references pass.")
