#!/usr/bin/env python3
"""Transactional SQLite projection of updater install history for Kitsune Tree."""
import json, sqlite3, sys
from pathlib import Path

def snapshot(db_path, payload):
    if not isinstance(payload, dict): raise ValueError("invalid payload")
    items=payload.get("history",[])
    if not isinstance(items,list) or len(items)>5000: raise ValueError("invalid history")
    Path(db_path).parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(db_path, timeout=5) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("""CREATE TABLE IF NOT EXISTS evolution_events(
            id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL,
            from_version TEXT NOT NULL, to_version TEXT NOT NULL, message TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_evolution_time ON evolution_events(at DESC)")
        for x in items:
            if not isinstance(x,dict) or x.get("kind") not in ("install","rollback","failed","startup_failed"):
                continue
            keys=("id","at","from","to")
            if any(not isinstance(x.get(k),str) or len(x[k])>500 for k in keys): continue
            message=x.get("message","")
            if not isinstance(message,str): message=""
            db.execute("""INSERT INTO evolution_events VALUES(?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET at=excluded.at,kind=excluded.kind,
                from_version=excluded.from_version,to_version=excluded.to_version,message=excluded.message""",
                (x["id"],x["at"],x["kind"],x["from"],x["to"],message[:1000]))
        db.commit()
        rows=db.execute("""SELECT id,at,kind,from_version,to_version,message
            FROM evolution_events ORDER BY at DESC,id DESC LIMIT 200""").fetchall()
        return {"schemaVersion":1,"history":[dict(zip(("id","at","kind","from","to","message"),r)) for r in rows],
            "activeVersion":payload.get("activeVersion",""),"durable":True}
if __name__=="__main__":
    try:
        print(json.dumps(snapshot(sys.argv[1],json.load(sys.stdin)),ensure_ascii=False))
    except (ValueError,sqlite3.Error,KeyError) as e:
        print(json.dumps({"error":str(e)}),file=sys.stderr)
        sys.exit(1)
