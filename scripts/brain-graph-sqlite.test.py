import importlib.util
import tempfile
from pathlib import Path
import unittest

script=Path(__file__).with_name("brain-graph-sqlite.py")
spec=importlib.util.spec_from_file_location("brain_graph_sqlite",script)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class GraphTests(unittest.TestCase):
    def test_durable_confirmed_graph_and_idempotency(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/"graph.sqlite3"
            record={"id":"x","goal":"check backup","chosen":"inspect files","observed":"success","observedAt":"2026-10-12","taskType":"backup"}
            self.assertEqual(mod.run(db,{"action":"sync","items":[record]})["synced"],1)
            mod.run(db,{"action":"sync","items":[record]})
            self.assertEqual(mod.run(db,{"action":"stats"}),{"decisions":1,"edges":3})
            self.assertEqual(mod.run(db,{"action":"search","query":"backup"})["items"][0]["id"],"x")
            self.assertEqual(mod.run(db,{"action":"list"})["items"][0]["observed"],"success")
    def test_rejects_unconfirmed(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                mod.run(Path(directory)/"graph.sqlite3",{"action":"sync","items":[{"observed":None}]})

if __name__=="__main__": unittest.main()
