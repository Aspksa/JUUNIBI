#!/usr/bin/env python3
"""Bounded local SQLite metric history for Fox Commotion. Client-observed telemetry, not server-verified facts."""
import json
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

METRIC = re.compile(r"fox-(?:[0-9]|[1-9][0-9])\Z")


def run(db_path, request):
    if not isinstance(request, dict) or request.get("action") not in ("read", "write"):
        raise ValueError("invalid action")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    hour = now.strftime("%Y-%m-%dT%H")
    cutoff = (now-timedelta(days=90)).strftime("%Y-%m-%dT%H")
    with sqlite3.connect(db_path, timeout=5) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("""CREATE TABLE IF NOT EXISTS fox_metric_samples(
          metric_id TEXT NOT NULL, bucket TEXT NOT NULL, value INTEGER NOT NULL,
          source TEXT NOT NULL, PRIMARY KEY(metric_id,bucket))""")
        db.execute("""CREATE TABLE IF NOT EXISTS fox_events(
          id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL,
          title TEXT NOT NULL, detail TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS fox_by_time ON fox_metric_samples(bucket DESC)")
        if request["action"] == "write":
            readings = request.get("readings", [])
            events = request.get("events", [])
            if not isinstance(readings, list) or len(readings) > 100 or not isinstance(events, list) or len(events) > 150:
                raise ValueError("limit exceeded")
            for item in readings:
                if not isinstance(item, dict):
                    raise ValueError("invalid reading")
                metric_id = item.get("id")
                value = item.get("value")
                source = item.get("source")
                if not isinstance(metric_id, str) or not METRIC.fullmatch(metric_id) or type(value) is not int or not 0 <= value <= 10**12 or not isinstance(source, str) or len(source) > 160:
                    raise ValueError("invalid metric")
                db.execute("""INSERT INTO fox_metric_samples(metric_id,bucket,value,source) VALUES(?,?,?,?)
                  ON CONFLICT(metric_id,bucket) DO UPDATE SET value=excluded.value,source=excluded.source""",
                  (metric_id, hour, value, source))
            for event in events:
                if not isinstance(event, dict):
                    raise ValueError("invalid event")
                event_id, day, kind = event.get("id"), event.get("day"), event.get("kind")
                title, detail = event.get("title"), event.get("detail")
                if not isinstance(event_id, str) or not 1 <= len(event_id) <= 160 or not isinstance(day, str) or len(day) != 10 or kind not in ("growth", "warning", "achievement", "recovery", "update") or not isinstance(title, str) or not isinstance(detail, str):
                    raise ValueError("invalid event")
                db.execute("""INSERT INTO fox_events VALUES(?,?,?,?,?)
                  ON CONFLICT(id) DO NOTHING""", (event_id, day, kind, title[:180], detail[:360]))
            db.execute("DELETE FROM fox_metric_samples WHERE bucket < ?", (cutoff,))
            db.execute("DELETE FROM fox_events WHERE day < ?", ((now-timedelta(days=90)).strftime("%Y-%m-%d"),))
        db.commit()
        daily = {}
        rows = db.execute("""SELECT s.metric_id,substr(s.bucket,1,10),s.value FROM fox_metric_samples s
          JOIN (SELECT metric_id,substr(bucket,1,10) AS day,MAX(bucket) AS newest
                FROM fox_metric_samples GROUP BY metric_id,substr(bucket,1,10)) g
          ON s.metric_id=g.metric_id AND s.bucket=g.newest ORDER BY s.bucket""")
        for metric_id, day, value in rows:
            daily.setdefault(metric_id, []).append({"day": day, "value": value})
        hourly = {}
        for metric_id, bucket, value in db.execute(
            "SELECT metric_id,bucket,value FROM fox_metric_samples WHERE bucket>=? ORDER BY bucket", ((now-timedelta(hours=24)).strftime("%Y-%m-%dT%H"),)):
            hourly.setdefault(metric_id, []).append({"hour":bucket,"value":value})
        events = [dict(zip(("id","day","kind","title","detail"), row))
                  for row in db.execute("SELECT id,day,kind,title,detail FROM fox_events ORDER BY day DESC,id DESC LIMIT 150")]
        return {"schemaVersion":1,"durable":True,"provenance":"client-observed","daily":daily,"hourly":hourly,"events":list(reversed(events))}


if __name__ == "__main__":
    try:
        print(json.dumps(run(sys.argv[1], json.loads(sys.stdin.buffer.read().decode("utf-8"))), ensure_ascii=True))
    except (ValueError, TypeError, sqlite3.Error, OSError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
