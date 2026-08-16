"""
Sprint 9 Tests: app.js module split verification, tool cards, todo panel.
Run: ./scripts/test.sh tests/test_sprint9.py -v
"""
import json, pathlib, urllib.error, urllib.request

from tests._pytest_port import BASE

def get_text(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.read().decode()

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read())

def post(path, body=None):
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code

# ── Module split: all 6 files served ──────────────────────────────────────
