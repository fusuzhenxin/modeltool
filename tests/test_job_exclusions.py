import json
import unittest
from backend.stability import snapshot
from backend.request_errors import error_issue
from tests import test_stability as fixtures


class JobExclusionTests(unittest.TestCase):
    site = fixtures.StabilityTests.site
    job = fixtures.StabilityTests.job
    def stats(self, **kwargs):
        return next(s for s in snapshot(self.db,at=fixtures.AT,**kwargs)["stations"] if s["station"]["id"]=="a")
    tearDown = fixtures.StabilityTests.tearDown

    def setUp(self):
        fixtures.StabilityTests.setUp(self)
        token=(self.db.directory/'setup.token').read_text()
        response=self.client.post('/api/auth/setup',json={'username':'admin','password':'test-exclusion-password','token':token})
        self.headers={'X-CSRF-Token':response.json()['csrf']}

    def action(self,job,action='exclude',**changes):
        body={'ids':[job['id']],'action':action}
        if action=='exclude':body.update(exclusion_reason='group_unavailable',note='已向商家核查，原检测分组被删除')
        return self.client.post('/api/admin/bulk/jobs',json=body|changes,headers=self.headers)

    def test_403_is_already_excluded_503_remains_failure_unless_reviewed(self):
        self.job();self.job(status='failed',error='接口返回 HTTP 403')
        failed=self.job(status='failed',error='接口返回 HTTP 503')
        before=self.stats();self.assertEqual((before['samples'],before['failed'],before['rate']),(2,1,50))
        self.assertEqual(before['excluded']['configuration'],1)
        response=self.action(failed);self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['count'],1)
        row=self.stats();self.assertEqual((row['samples'],row['completed'],row['failed'],row['rate']),(1,1,0,100))
        self.assertEqual((row['failure_streak'],row['max_failure_streak'],row['covered_days']),(0,0,1))
        self.assertEqual(row['excluded']['manual'],1)
        event=row['history'][-1];self.assertEqual((event['outcome'],event['cause'],event['exclusion_reason']),('manual','manual','分组已失效'))
        self.assertNotIn('商家',json.dumps(snapshot(self.db,at=fixtures.AT),ensure_ascii=False))
        with self.db.connect() as con:
            original=dict(con.execute('SELECT * FROM jobs WHERE id=?',(failed['id'],)).fetchone())
        self.assertEqual((original['status'],original['error']),('failed','接口返回 HTTP 503'))
        self.assertEqual(self.action(failed,'restore').json()['count'],1)
        restored=self.stats();self.assertEqual((restored['samples'],restored['failed'],restored['rate']),(2,1,50))
        review=self.db.get('job_exclusions',failed['id']);self.assertFalse(review['active']);self.assertEqual(len(review['history']),2)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM audit WHERE action IN ('job_sample_excluded','job_sample_restored')").fetchone()[0],2)

    def test_reason_and_evidence_required_and_only_terminal_failures_allowed(self):
        failed=self.job(status='failed',error='接口返回 HTTP 503')
        for changes in [{'note':''},{'note':'太短'},{'exclusion_reason':None},{'exclusion_reason':'fake'}]:
            self.assertEqual(self.action(failed,**changes).status_code,422)
        for status in ['done','queued','running']:
            job=self.job(status=status)
            result=self.action(job).json();self.assertEqual(result['count'],0);self.assertEqual(len(result['skipped']),1)
        self.assertEqual(self.db.list('job_exclusions'),[])

    def test_batch_skips_missing_and_done_and_does_not_duplicate_audit(self):
        failed=self.job(status='failed',error='接口返回 HTTP 503');done=self.job()
        result=self.action(failed,ids=[failed['id'],done['id'],'missing']).json()
        self.assertEqual(result['updated'],[failed['id']]);self.assertEqual(len(result['skipped']),2)
        self.assertEqual(self.action(failed).json()['count'],0)
        row=self.client.get('/api/admin/jobs').json()
        match=next(j for j in row if j['id']==failed['id'])
        self.assertTrue(match['exclusion']['active']);self.assertEqual(match['status'],'failed')
        self.assertEqual(len(self.db.get('job_exclusions',failed['id'])['history']),1)

    def test_exclusion_has_no_effect_on_other_stations_models_or_eligibility(self):
        self.site('b');self.job('b')
        failed=self.job(status='failed',error='接口返回 HTTP 503')
        self.action(failed)
        row=self.stats();self.assertEqual((row['samples'],row['covered_days'],row['eligible']),(0,0,False))
        data=snapshot(self.db,at=fixtures.AT)
        second=next(s for s in data['stations'] if s['station']['id']=='b')
        self.assertEqual((second['samples'],second['excluded']['manual']),(1,0))

    def test_admin_auth_and_csrf_are_required(self):
        failed=self.job(status='failed',error='接口返回 HTTP 503')
        body={'ids':[failed['id']],'action':'exclude','exclusion_reason':'group_unavailable','note':'确认原检测分组被删除'}
        self.assertEqual(self.client.post('/api/admin/bulk/jobs',json=body).status_code,403)
        self.client.cookies.clear()
        self.assertEqual(self.client.post('/api/admin/bulk/jobs',json=body,headers=self.headers).status_code,401)

if __name__=='__main__':unittest.main()
