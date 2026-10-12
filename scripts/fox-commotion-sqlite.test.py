#!/usr/bin/env python3
"""Regression tests for the separate Fox Commotion SQLite store."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT=Path(__file__).with_name("fox-commotion-sqlite.py")

def call(db,request,should_pass=True):
    result=subprocess.run([sys.executable,str(SCRIPT),str(db)],input=json.dumps(request),
      text=True,capture_output=True,timeout=12,check=False)
    if should_pass:
        assert result.returncode==0,result.stderr
        return json.loads(result.stdout)
    assert result.returncode!=0,"malformed request unexpectedly succeeded"

def main():
    with tempfile.TemporaryDirectory() as directory:
        database=Path(directory)/"fox.sqlite3"
        initial=call(database,{"action":"read"})
        assert initial["durable"] and initial["daily"]=={} and initial["hourly"]=={}
        event={"id":"release:1","day":"2026-10-12","kind":"update","title":"Релиз","detail":"Verified"}
        payload={"action":"write","readings":[{"id":"fox-1","value":7,"source":"Brain"}],"events":[event]}
        written=call(database,payload)
        assert written["provenance"]=="client-observed"
        assert written["daily"]["fox-1"][-1]["value"]==7
        assert len(written["events"])==1
        written=call(database,payload)
        assert len(written["events"])==1
        call(database,{"action":"write","readings":[{"id":"fox-1","value":True,"source":"bad"}],"events":[]},False)
        call(database,{"action":"write","readings":[{"id":"fox-100","value":8,"source":"bad"}],"events":[]},False)
        call(database,{"action":"write","readings":[{"id":"fox-1","value":-5,"source":"bad"}],"events":[]},False)
        after=call(database,{"action":"read"})
        assert after["daily"]["fox-1"][-1]["value"]==7
        assert len(after["events"])==1
    print("Fox SQLite: all tests passed")

if __name__=="__main__":
    main()
