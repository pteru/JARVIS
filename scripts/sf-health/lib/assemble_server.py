#!/usr/bin/env python3
"""Assemble service data JSON for the SF server.

Reads data from files in $TMPD (set by the calling bash script):
  docker_ps.jsonl, err_*.log, redis_*.txt, pg_*.txt

SpotFusion has 3 separate Redis containers (each with DB0 only):
  - sparkeyes-plc-cache (PLC state data)
  - sparkeyes-global-cache (application cache)
  - sparkeyes-server-log (server logging)

No image-saver health check (SpotFusion doesn't have this service).

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

# Redis — 3 separate containers (each uses DB0 only)
plc_cache_size = read_int(os.path.join(tmpd, "redis_plc_cache_dbsize.txt"))
plc_cache_keys = read_lines(os.path.join(tmpd, "redis_plc_cache_keys.txt"))
plc_cache_values = {}
for key in plc_cache_keys:
    fp = os.path.join(tmpd, "redis_plc_cache_" + key + ".txt")
    pairs = read_lines(fp)
    d = {}
    for i in range(0, len(pairs) - 1, 2):
        d[pairs[i]] = pairs[i + 1]
    if d:
        plc_cache_values[key] = d

global_cache_size = read_int(os.path.join(tmpd, "redis_global_cache_dbsize.txt"))
global_cache_keys = read_lines(os.path.join(tmpd, "redis_global_cache_keys.txt"))

server_log_size = read_int(os.path.join(tmpd, "redis_server_log_dbsize.txt"))

# PostgreSQL
pg_active = read_int(os.path.join(tmpd, "pg_active.txt"))
pg_dbsize = read_int(os.path.join(tmpd, "pg_dbsize.txt"))

result = {
    "docker": {"containers": containers, "error_logs": error_logs},
    "redis": {
        "plc_cache": {
            "container": "sparkeyes-plc-cache",
            "keys": plc_cache_size,
            "key_list": plc_cache_keys,
            "values": plc_cache_values,
        },
        "global_cache": {
            "container": "sparkeyes-global-cache",
            "keys": global_cache_size,
            "key_list": global_cache_keys,
        },
        "server_log": {
            "container": "sparkeyes-server-log",
            "keys": server_log_size,
        },
    },
    "postgresql": {"active_connections": pg_active, "db_size_bytes": pg_dbsize},
}
print(json.dumps(result))
