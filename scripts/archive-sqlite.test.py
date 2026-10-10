import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("archive-sqlite.py")
spec = importlib.util.spec_from_file_location("archive_sqlite", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SQLiteArchiveTests(unittest.TestCase):
    def test_import_idempotent_and_preserves_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            org = {"notes":[{"id":"task-1","kind":"todo","done":True,"text":"Зарядка","createdAt":"2026-10-01","completedAt":"2026-10-02"}],
                   "history":[{"id":"task-1","kind":"done","at":"2026-10-02","text":"Зарядка"}],"reminders":[],"missions":[]}
            ach = {"awards":{"firstpage":{"level":1,"firstAt":"2026-10-02"}},"records":{"best":[{"value":1}]}}
            (root/"organizer.json").write_text(json.dumps(org,ensure_ascii=False),encoding="utf-8")
            (root/"achievements.json").write_text(json.dumps(ach,ensure_ascii=False),encoding="utf-8")
            original = (root/"organizer.json").read_bytes()
            db = root/"archive.sqlite3"
            first = module.migrate(root,db)
            second = module.migrate(root,db)
            self.assertEqual(first,second)
            self.assertEqual(second,{"tasks":1,"events":1,"awards":1,"records":1})
            self.assertEqual((root/"organizer.json").read_bytes(),original)
            self.assertTrue(Path(str(db)+".bak").exists())
            with sqlite3.connect(db) as conn:
                self.assertEqual(json.loads(conn.execute("SELECT payload FROM tasks").fetchone()[0])["text"],"Зарядка")
                self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0],"ok")

    def test_invalid_source_does_not_modify_existing_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            db=root/"archive.sqlite3"
            module.migrate(root,db)
            (root/"organizer.json").write_text("{invalid",encoding="utf-8")
            with self.assertRaises(json.JSONDecodeError):
                module.migrate(root,db)
            with sqlite3.connect(db) as conn:
                self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0],"ok")

if __name__ == "__main__":
    unittest.main()
