import json
import unittest
from unittest.mock import patch
from tests import test_multi_model_schedules as fixtures
from backend.core import now
from backend.worker import enqueue,tick,work_once
from backend.request_errors import RequestIssue
from backend.stability import configuration

class PublicationTests(unittest.TestCase):
    setUp = fixtures.MultiModelScheduleTests.setUp
    tearDown = fixtures.MultiModelScheduleTests.tearDown
    station = fixtures.MultiModelScheduleTests.station
    post = fixtures.MultiModelScheduleTests.post
    plans = fixtures.MultiModelScheduleTests.plans
    def job(self,sid,**extra):
        return self.post('jobs',{'station_id':sid,'model':'gpt-test','kind':'site_candy','count':1,**extra})

    def finish(self,**result_changes):
        # Keep a genuine suite result shape while isolating network calls.
        result={'model':'gpt-test','kind':'site_candy','score':None,'level':'unknown','ability':{'score':0,'questions':1},'time':'2026-11-23 12:00','checks':[],**result_changes}
        with patch('backend.worker.run_suite',return_value=result):
            self.assertTrue(work_once(self.db))
        return self.db.list('reports')[0]

    def test_default_review_and_auto_publishes_even_low_score(self):
        sid=self.station();self.assertEqual(self.job(sid).status_code,200)
        self.assertEqual(self.finish()['status'],'draft')
        self.assertEqual(self.job(sid,publish_mode='auto').status_code,200)
        published=self.finish()
        self.assertEqual(published['status'],'published');self.assertEqual(published['publication_source'],'auto')
        public=self.client.get('/api/public/bootstrap?summary=true').json()['reports']
        self.assertTrue(any(r['id']==published['id'] and r['ability']['score']==0 for r in public))
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM audit WHERE action='report_published' AND actor='worker:auto'").fetchone()[0],1)

    def test_hidden_station_at_completion_stays_draft(self):
        sid=self.station();self.job(sid,publish_mode='auto')
        with self.db.connect(write=True) as con:
            station=self.db.get('stations',sid,con);station['visible']=False;self.db.save('stations',sid,station,con)
        self.assertEqual(self.finish()['status'],'draft')

    def test_failed_and_billing_never_publish(self):
        sid=self.station()
        for error in [RuntimeError('upstream failed'),RequestIssue('billing')]:
            self.assertEqual(self.job(sid,publish_mode='auto').status_code,200)
            with patch('backend.worker.run_suite',side_effect=error):self.assertTrue(work_once(self.db))
            self.assertEqual(self.db.list('reports'),[])

    def test_mode_does_not_bypass_active_dedup_or_change_comparison(self):
        sid=self.station();self.job(sid)
        self.assertEqual(self.job(sid,publish_mode='auto').status_code,409)
        base={'kind':'site_candy','count':10}
        self.assertEqual(configuration(json.dumps(base)),configuration(json.dumps(base|{'publish_mode':'auto'})))

    def test_batch_snapshot_and_retry_preserve_mode(self):
        sid=self.station();spec={'station_id':sid,'model':'gpt-test','kind':'site_candy','publish_mode':'auto'}
        response=self.post('jobs/batch',{'runs':[spec]});self.assertEqual(response.status_code,200,response.text)
        key=response.json()['ids'][0]
        with self.db.connect(write=True) as con:
            con.execute("UPDATE jobs SET status='failed' WHERE id=?",(key,))
        retry=self.post('jobs/'+key+'/retry',{});self.assertEqual(retry.status_code,200,retry.text)
        with self.db.connect() as con:
            self.assertEqual(json.loads(con.execute('SELECT config FROM jobs WHERE id=?',(retry.json()['id'],)).fetchone()[0])['publish_mode'],'auto')
        self.assertEqual(self.finish()['status'],'published')

    def test_schedule_edit_changes_only_future_jobs_and_preserves_next_run(self):
        sid=self.station();spec=self.plans([sid],schedule_mode='interval',first_run='2020-01-01T00:00:00Z',publish_mode='auto')[0]
        created=self.post('schedules',spec);self.assertEqual(created.status_code,200,created.text)
        plan=created.json();tick(self.db)
        saved=self.db.get('schedules',plan['id']);next_run=saved['next_run']
        result=self.post('bulk/schedules',{'ids':[plan['id']],'action':'edit','changes':{'publish_mode':'review'}})
        self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['count'],1)
        saved=self.db.get('schedules',plan['id']);self.assertEqual(saved['next_run'],next_run);self.assertEqual(saved['publish_mode'],'review')
        self.assertEqual(self.finish()['status'],'published')
        self.assertEqual(self.post('bulk/schedules',{'ids':[plan['id']],'action':'run'}).status_code,200)
        self.assertEqual(self.finish()['status'],'draft')

    def test_entity_listing_uses_index_without_large_temporary_sort(self):
        with self.db.connect() as con:
            plan = con.execute("EXPLAIN QUERY PLAN SELECT id,data FROM entities WHERE kind=? ORDER BY updated DESC", ("reports",)).fetchall()
        self.assertTrue(any("entities_updated" in row[3] for row in plan))
        self.assertFalse(any("TEMP B-TREE" in row[3] for row in plan))

    def test_invalid_mode_rejected_and_legacy_job_remains_review(self):
        sid=self.station();self.assertEqual(self.job(sid,publish_mode='anything').status_code,422)
        key=self.job(sid).json()['id']
        with self.db.connect(write=True) as con:
            config=json.loads(con.execute('SELECT config FROM jobs WHERE id=?',(key,)).fetchone()[0]);config.pop('publish_mode')
            con.execute('UPDATE jobs SET config=? WHERE id=?',(json.dumps(config),key))
        self.assertEqual(self.finish()['status'],'draft')

if __name__=='__main__':unittest.main()
