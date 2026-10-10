#!/usr/bin/env python3
"""Safely import JUUNIBI JSON history into a durable, queryable SQLite archive.

This is an additive archive, not a replacement for the live organizer JSON.
Run: python scripts/archive-sqlite.py [--data-dir data] [--db data/juunibi-history.sqlite3]
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
from datetime import datetime, timezone

SCHEMA_VERSION = 1

def load_object(path):
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected JSON object")
    return value

def migrate(data_dir: Path, db: Path):
    # Read and validate all sources before touching the target database.
    organizer = load_object(data_dir / "organizer.json")
    achievements = load_object(data_dir / "achievements.json")
    for key in ("notes", "history", "reminders", "missions"):
        if key in organizer and not isinstance(organizer[key], list):
            raise ValueError(f"organizer.{key} must be a list")
    for key in ("awards", "records"):
        if key in achievements and not isinstance(achievements[key], dict):
            raise ValueError(f"achievements.{key} must be an object")
    db.parent.mkdir(parents=True, exist_ok=True)
    if db.exists():
        # A copy is taken before any schema or data changes.
        with sqlite3.connect(db) as source, sqlite3.connect(str(db) + ".bak") as backup:
            source.backup(backup)
    conn = sqlite3.connect(db)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("CREATE TABLE IF NOT EXISTS archive_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, done INTEGER NOT NULL, created_at TEXT, completed_at TEXT, payload TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS events (event_key TEXT PRIMARY KEY, task_id TEXT, happened_at TEXT, kind TEXT, payload TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS missions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS awards (id TEXT PRIMARY KEY, level INTEGER NOT NULL, payload TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        conn.execute("CREATE INDEX IF NOT EXISTS events_task_date ON events(task_id, happened_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS tasks_completion ON tasks(completed_at)")
        for obj in organizer.get("notes", []):
            if not isinstance(obj, dict) or not isinstance(obj.get("id"), str):
                raise ValueError("Invalid task entry")
            conn.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,done=excluded.done,created_at=excluded.created_at,completed_at=excluded.completed_at,payload=excluded.payload",
                (obj["id"], str(obj.get("kind", "todo")), int(bool(obj.get("done"))), obj.get("createdAt"), obj.get("completedAt"), json.dumps(obj, ensure_ascii=False)))
        # Existing history may contain equal timestamps; include position in deterministic event identity.
        for i, obj in enumerate(organizer.get("history", [])):
            if not isinstance(obj, dict):
                raise ValueError("Invalid event entry")
            from hashlib import sha256
            payload = json.dumps(obj, ensure_ascii=False, sort_keys=True)
            key = sha256((str(i) + ":" + payload).encode("utf-8")).hexdigest()
            conn.execute("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?)", (key, obj.get("id"), obj.get("at"), obj.get("kind"), payload))
        for table, items in (("reminders", organizer.get("reminders", [])), ("missions", organizer.get("missions", []))):
            for obj in items:
                if not isinstance(obj, dict) or not isinstance(obj.get("id"), str):
                    raise ValueError(f"Invalid {table} entry")
                conn.execute(f"INSERT INTO {table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", (obj["id"], json.dumps(obj, ensure_ascii=False)))
        for key, obj in achievements.get("awards", {}).items():
            if not isinstance(obj, dict):
                raise ValueError("Invalid award entry")
            conn.execute("INSERT INTO awards VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET level=excluded.level,payload=excluded.payload",
                (key, int(obj.get("level", 0)), json.dumps(obj, ensure_ascii=False)))
        for key, obj in achievements.get("records", {}).items():
            conn.execute("INSERT INTO records VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", (key, json.dumps(obj, ensure_ascii=False)))
        conn.execute("INSERT OR REPLACE INTO archive_meta VALUES ('schema_version',?)", (str(SCHEMA_VERSION),))
        conn.commit()
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"SQLite integrity check: {result}")
        return {table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in ("tasks", "events", "awards", "records")}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--db", type=Path)
    args = parser.parse_args()
    db = args.db or args.data_dir / "juunibi-history.sqlite3"
    try:
        print(json.dumps(migrate(args.data_dir, db), ensure_ascii=False))
    except Exception as error:
        print(f"SQLite archive failed: {error}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
