#!/usr/bin/env python3
"""Assemble service data JSON for a VK dashboard node.

Reads data from files in $TMPD (set by the calling bash script):
  docker_ps.jsonl, err_*.log, pg_*.txt

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
    name = os.path.basename(fp)[4:-4]
    try:
        with open(fp) as f:
            lines = [l.rstrip() for l in f if l.strip()]
        if lines:
            error_logs[name] = lines
    except:
        pass

result = {
    "docker": {"containers": containers, "error_logs": error_logs},
    "postgresql": {
        "active_connections": read_int(os.path.join(tmpd, "pg_active.txt")),
        "db_size_bytes": read_int(os.path.join(tmpd, "pg_dbsize.txt")),
    },
}
print(json.dumps(result))
