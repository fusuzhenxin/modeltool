import json
import tempfile
import unittest
from backend.core import Database


class ReportMemoryTests(unittest.TestCase):
    def test_report_projection_strips_raw_before_python_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Database(temp)
            for key, status in [('public', 'published'), ('private', 'draft')]:
                db.save('reports', key, {'status': status, 'result': {'raw': 'private' * 100000, 'artwork': {'html': 'html' * 100000, 'available': True}, 'sections': [{'kind': 'pelican', 'score': 90}], 'model': 'test'}})
            with db.connect() as con:
                # List reads must not touch the original large report documents.
                import sqlite3
                con.set_authorizer(lambda action, table, *_: sqlite3.SQLITE_DENY
                                   if action == sqlite3.SQLITE_READ and table == 'entities'
                                   else sqlite3.SQLITE_OK)
                with __import__('unittest.mock', fromlist=['patch']).patch.object(db, 'connect') as connect:
                    connect.return_value.__enter__.return_value = con
                    rows = list(db.report_rows(summary=True, published=True))
            self.assertEqual([r['id'] for r in rows], ['public'])
            self.assertNotIn('raw', rows[0]['result'])
            self.assertFalse(rows[0]['result'].get('sections'))
            self.assertNotIn('html', rows[0]['result']['artwork'])
            detail = list(db.report_rows(key='public', published=True))
            self.assertEqual(detail[0]['result']['sections'][0]['score'], 90)
            self.assertEqual(list(db.report_rows(key='private', published=True)), [])
            self.assertIn('raw', db.get('reports', 'public')['result'])
