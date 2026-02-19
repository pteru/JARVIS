#!/usr/bin/env python3
"""Assemble service data JSON for a VK processing node.

Reads data from files in $TMPD (set by the calling bash script):
  docker_ps.jsonl, err_*.log, redis_db*.txt, pg_*.txt, img_health.json

Prints a single JSON object to stdout.
"""
import json, os, glob

tmpd = os.environ["TMPD"]

def read_int(path, default=0):
    try:
        with open(path) as f:
            return int(f.read().strip() or str(default))
    except:
        return default

def read_lines(path):
    try:
        with open(path) as f:
            return [l.strip() for l in f if l.strip()]
    except:
        return []

# Docker containers
containers = []
try:
    with open(os.path.join(tmpd, "docker_ps.jsonl")) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    containers.append(json.loads(line))
                except:
                    pass
except:
    pass

# Error logs
error_logs = {}
for fp in glob.glob(os.path.join(tmpd, "err_*.log")):
    name = os.path.basename(fp)[4:-4]  # strip err_ and .log
    try:
        with open(fp) as f:
            lines = [l.rstrip() for l in f if l.strip()]
        if lines:
            error_logs[name] = lines
    except:
        pass

# Redis
db0_size = read_int(os.path.join(tmpd, "redis_db0.txt"))
db2_size = read_int(os.path.join(tmpd, "redis_db2.txt"))
db1_keys = read_lines(os.path.join(tmpd, "redis_db1_keys.txt"))
db3_keys = read_lines(os.path.join(tmpd, "redis_db3_keys.txt"))

db1_values = {}
for key in db1_keys:
    fp = os.path.join(tmpd, "redis_db1_" + key + ".txt")
    pairs = read_lines(fp)
    d = {}
    for i in range(0, len(pairs) - 1, 2):
        d[pairs[i]] = pairs[i + 1]
    if d:
        db1_values[key] = d

# PostgreSQL
pg_active = read_int(os.path.join(tmpd, "pg_active.txt"))
pg_dbsize = read_int(os.path.join(tmpd, "pg_dbsize.txt"))

# Image-saver health
try:
    with open(os.path.join(tmpd, "img_health.json")) as f:
        img_health = json.load(f)
except:
    img_health = {"status": "parse_error"}

result = {
    "docker": {"containers": containers, "error_logs": error_logs},
    "redis": {
        "db0_cache": {"keys": db0_size},
        "db1_plc": {"keys": db1_keys, "values": db1_values},
        "db2_camera": {"keys": db2_size},
        "db3_settings": {"keys": db3_keys},
    },
    "postgresql": {"active_connections": pg_active, "db_size_bytes": pg_dbsize},
    "health_endpoints": {"image_saver": img_health},
}
print(json.dumps(result))
