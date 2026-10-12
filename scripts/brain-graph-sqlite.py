#!/usr/bin/env python3
"""JUUNIBI owner-confirmed decision graph. SQLite is the durable source of graph edges."""
import json
import sqlite3
import sys
from pathlib import Path

def run(db_path, request):
    db_path=Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path, timeout=5) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, goal TEXT NOT NULL, chosen TEXT NOT NULL, observed TEXT NOT NULL CHECK(observed IN ('success','failure')), observed_at TEXT NOT NULL, task_type TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS graph_edges (decision_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(decision_id,kind,target), FOREIGN KEY(decision_id) REFERENCES decisions(id))")
        db.execute("CREATE INDEX IF NOT EXISTS idx_decision_task ON decisions(task_type,observed_at)")
        if request.get("action")=="sync":
            items=request.get("items",[])
            if not isinstance(items,list) or len(items)>100: raise ValueError("invalid items")
            for item in items:
                if not isinstance(item,dict) or item.get("observed") not in ("success","failure"): raise ValueError("unconfirmed outcome")
                for key in ("id","goal","chosen","observedAt"):
                    if not isinstance(item.get(key),str) or not item[key].strip() or len(item[key])>500: raise ValueError("invalid decision")
                db.execute("INSERT INTO decisions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET goal=excluded.goal,chosen=excluded.chosen,observed=excluded.observed,observed_at=excluded.observed_at,task_type=excluded.task_type",
                    (item["id"],item["goal"],item["chosen"],item["observed"],item["observedAt"],item.get("taskType")))
                for kind,target in (("goal",item["goal"]),("strategy",item["chosen"]),("outcome",item["observed"])):
                    db.execute("INSERT OR IGNORE INTO graph_edges VALUES(?,?,?)",(item["id"],kind,target))
            db.commit()
            return {"synced":len(items),"durable":True}
        if request.get("action")=="search":
            query=request.get("query")
            if not isinstance(query,str) or not query.strip() or len(query)>500: raise ValueError("invalid query")
            limit=request.get("limit",10)
            if type(limit)!=int or not 1<=limit<=20: raise ValueError("invalid limit")
            rows=db.execute("SELECT id,goal,chosen,observed,observed_at,task_type FROM decisions ORDER BY observed_at DESC LIMIT 1000").fetchall()
            words=set(query.casefold().split())
            results=[]
            for row in rows:
                matching=len(words.intersection(set((row[1]+" "+row[2]).casefold().split())))
                if matching: results.append({"id":row[0],"goal":row[1],"chosen":row[2],"observed":row[3],"observedAt":row[4],"taskType":row[5],"score":matching})
            results.sort(key=lambda r:(-r["score"],r["observedAt"]),reverse=False)
            return {"items":results[:limit],"searchMode":"lexical","durable":True}
        if request.get("action")=="list":
            limit=request.get("limit",100)
            if type(limit)!=int or not 1<=limit<=100: raise ValueError("invalid limit")
            rows=db.execute("SELECT id,goal,chosen,observed,observed_at,task_type FROM decisions ORDER BY observed_at DESC LIMIT ?",(limit,)).fetchall()
            return {"items":[{"id":r[0],"goal":r[1],"chosen":r[2],"observed":r[3],"observedAt":r[4],"taskType":r[5]} for r in rows]}
        if request.get("action")=="stats":
            return {"decisions":db.execute("SELECT count(*) FROM decisions").fetchone()[0],"edges":db.execute("SELECT count(*) FROM graph_edges").fetchone()[0]}
        raise ValueError("unknown action")

if __name__=="__main__":
    try:
        request=json.load(sys.stdin)
        result=run(sys.argv[1],request)
        print(json.dumps(result,ensure_ascii=False))
    except (ValueError,KeyError,sqlite3.Error) as error:
        print(json.dumps({"error":str(error)}))
        sys.exit(1)
