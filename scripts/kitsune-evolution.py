#!/usr/bin/env python3
"""Transactional SQLite projection of updater install history for Kitsune Tree."""
import json, sqlite3, sys, hashlib
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
        manifest=payload.get("manifest")
        version=payload.get("activeVersion","")
        if manifest is not None:
            if not isinstance(manifest,dict) or manifest.get("schemaVersion")!=1 or manifest.get("project")!="JUUNIBI":
                raise ValueError("invalid manifest")
            nodes=manifest.get("nodes")
            if not isinstance(nodes,list) or len(nodes)>500 or not isinstance(version,str) or not (0<len(version)<=128):
                raise ValueError("invalid evolution snapshot")
            ids=set()
            for node in nodes:
                if not isinstance(node,dict) or not isinstance(node.get("id"),str) or len(node["id"])>64 or node["id"] in ids:
                    raise ValueError("invalid evolution node")
                if not isinstance(node.get("dependsOn"),list) or node.get("status") not in ("implemented","planned"):
                    raise ValueError("invalid evolution dependencies")
                ids.add(node["id"])
            if any(any(not isinstance(dep,str) or dep not in ids or dep==n["id"] for dep in n["dependsOn"]) for n in nodes):
                raise ValueError("missing evolution dependency")
            canonical=json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(",",":"))
            digest=hashlib.sha256(canonical.encode("utf8")).hexdigest()
            db.execute("""CREATE TABLE IF NOT EXISTS evolution_snapshots(
                version TEXT PRIMARY KEY, digest TEXT NOT NULL, manifest TEXT NOT NULL,
                recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
            old=db.execute("SELECT digest FROM evolution_snapshots WHERE version=?",(version,)).fetchone()
            if old is None:
                db.execute("INSERT INTO evolution_snapshots(version,digest,manifest) VALUES(?,?,?)",(version,digest,canonical))
            elif old[0]!=digest:
                # A version is immutable. Never overwrite its original architecture.
                raise ValueError("manifest changed for recorded version")
        db.commit()
        snapshots=[]
        if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_snapshots'").fetchone():
            for v,d,m in db.execute("SELECT version,digest,manifest FROM evolution_snapshots ORDER BY recorded_at DESC,version DESC LIMIT 30"):
                snapshots.append({"version":v,"digest":d,"manifest":json.loads(m)})
        rows=db.execute("""SELECT id,at,kind,from_version,to_version,message
            FROM evolution_events ORDER BY at DESC,id DESC LIMIT 200""").fetchall()
        return {"schemaVersion":1,"history":[dict(zip(("id","at","kind","from","to","message"),r)) for r in rows],
            "activeVersion":payload.get("activeVersion",""),"durable":True,"snapshots":snapshots}
if __name__=="__main__":
    try:
        print(json.dumps(snapshot(sys.argv[1],json.load(sys.stdin)),ensure_ascii=False))
    except (ValueError,sqlite3.Error,KeyError) as e:
        print(json.dumps({"error":str(e)}),file=sys.stderr)
        sys.exit(1)
