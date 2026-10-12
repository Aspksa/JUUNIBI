import tempfile, unittest, sqlite3
from pathlib import Path
from importlib.machinery import SourceFileLoader
evolution=SourceFileLoader("kitsune_evolution","scripts/kitsune-evolution.py").load_module()
def manifest(title="Core"):
 return {"schemaVersion":1,"project":"JUUNIBI","nodes":[{"id":"core","title":title,"dependsOn":[],"status":"implemented"}]}
class GrowthTests(unittest.TestCase):
 def test_idempotent_snapshot_and_conflict(self):
  with tempfile.TemporaryDirectory() as tmp:
   db=str(Path(tmp)/"evolution.sqlite")
   payload={"history":[],"activeVersion":"a"*40,"manifest":manifest()}
   first=evolution.snapshot(db,payload)
   self.assertEqual(len(first["snapshots"]),1)
   second=evolution.snapshot(db,payload)
   self.assertEqual(len(second["snapshots"]),1)
   with self.assertRaisesRegex(ValueError,"manifest changed"):
    evolution.snapshot(db,{**payload,"manifest":manifest("Tampered")})
   third=evolution.snapshot(db,{"history":[],"activeVersion":"b"*40,"manifest":manifest("Next")})
   self.assertEqual(len(third["snapshots"]),2)
 def test_unknown_dependency_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   payload={"history":[],"activeVersion":"a"*40,"manifest":{"schemaVersion":1,"project":"JUUNIBI","nodes":[{"id":"new","status":"planned","dependsOn":["missing"]}]}}
   with self.assertRaisesRegex(ValueError,"missing evolution dependency"):
    evolution.snapshot(str(Path(tmp)/"e.sqlite"),payload)
if __name__=="__main__":unittest.main()
