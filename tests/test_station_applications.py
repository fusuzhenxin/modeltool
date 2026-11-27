import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import Database


class StationApplicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.admin = TestClient(self.app, base_url="http://127.0.0.1")
        token = (self.db.directory / "setup.token").read_text()
        setup = self.admin.post('/api/auth/setup', json={"username": "admin", "password": "application-test-password", "token": token})
        self.admin_headers = {"X-CSRF-Token": setup.json()["csrf"]}
        self.guest = TestClient(self.app, base_url="http://127.0.0.1")
        self.headers = {"X-Proposal-CSRF": self.guest.get('/api/public/proposal-session').json()['csrf']}
        self.body = {"name": "示例中转站", "website_url": "https://relay.example", "login_url": "https://relay.example/console/login",
                     "username": "probe-user-private", "password": "  probe-password-private  ", "contact": "QQ 123456",
                     "notes": "测试所有模型分组", "consent": True}

    def tearDown(self):
        self.guest.close(); self.admin.close(); self.temp.cleanup()

    def submit(self, **overrides):
        return self.guest.post('/api/public/station-applications', json=self.body | overrides, headers=self.headers)

    def application(self, **overrides):
        result = self.submit(**overrides)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()['id']

    def test_credentials_encrypted_and_never_in_default_or_public_responses(self):
        key = self.application()
        stored = self.db.get('station_applications', key)
        encoded = json.dumps(stored)
        self.assertNotIn(self.body['username'], encoded)
        self.assertNotIn(self.body['password'], encoded)
        reloaded = Database(self.temp.name)
        self.assertEqual(json.loads(reloaded.decrypt(stored['credentials_cipher'])), {k: self.body[k] for k in ('username', 'password')})
        for path, client in [('/api/admin/station-applications', self.admin), ('/api/admin/station-applications/'+key, self.admin),
                             ('/api/public/bootstrap', self.guest), ('/api/public/proposals', self.guest), ('/api/public/stability', self.guest)]:
            result = client.get(path)
            self.assertEqual(result.status_code, 200, result.text)
            for secret in ('credentials_cipher', self.body['username'], self.body['password']):
                self.assertNotIn(secret, result.text)
        with self.db.connect() as con:
            self.assertEqual(con.execute('SELECT count(*) FROM jobs').fetchone()[0], 0)
        self.assertEqual(self.db.list('stations'), [])

    def test_credentials_require_admin_post_and_csrf_and_are_audited(self):
        key = self.application(); path = '/api/admin/station-applications/'+key+'/credentials'
        self.assertEqual(self.guest.get('/api/admin/station-applications').status_code, 401)
        self.assertEqual(self.guest.post(path, json={}, headers=self.headers).status_code, 401)
        self.assertEqual(self.admin.post(path, json={}).status_code, 403)
        self.assertEqual(self.admin.get(path).status_code, 404)
        response = self.admin.post(path, json={}, headers=self.admin_headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json(), {k: self.body[k] for k in ('username', 'password')})
        with self.db.connect() as con:
            row = con.execute("SELECT actor,target FROM audit WHERE action='station_application_credentials_viewed'").fetchone()
            self.assertEqual(tuple(row), ('admin', key))

    def test_required_fields_consent_and_validation_do_not_echo_password(self):
        for field in ('name', 'website_url', 'login_url', 'username', 'password', 'contact', 'consent'):
            body = {k: v for k, v in self.body.items() if k != field}
            response = self.guest.post('/api/public/station-applications', json=body, headers=self.headers)
            self.assertEqual(response.status_code, 422, field)
            self.assertNotIn(self.body['password'], response.text)
        for override in ({'password': '   '}, {'username': ' '}, {'consent': False}, {'login_url': 'http://127.0.0.1/login'},
                         {'website_url': 'https://localhost'}, {'login_url': 'https://a:b@relay.example'},
                         {'website_url': 'javascript:alert(1)'}, {'login_url': 'https://relay.example/?password=x'}, {'company': 'spam'}):
            self.assertEqual(self.submit(**override).status_code, 422, override.keys())
        self.assertEqual(self.db.list('station_applications'), [])

    def test_guest_session_csrf_and_cross_site_boundaries(self):
        self.assertEqual(self.guest.post('/api/public/station-applications', json=self.body).status_code, 403)
        for headers in (self.headers | {'Origin': 'https://evil.example'}, self.headers | {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.guest.post('/api/public/station-applications', json=self.body, headers=headers).status_code, 403)
        self.assertEqual(self.db.list('station_applications'), [])

    def test_pending_domain_deduplication_is_atomic(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.submit(website_url='https://www.relay.example/path'), range(2)))
        self.assertEqual(sorted(r.status_code for r in results), [201, 409])
        self.assertEqual(self.submit().status_code, 409)
        self.assertEqual(len(self.db.list('station_applications')), 1)

    def test_rate_limit_applies_across_new_visitor_sessions_at_same_address(self):
        for i in range(3):
            self.application(website_url=f'https://r{i}.example')
        with TestClient(self.app, base_url='http://127.0.0.1') as other:
            csrf = other.get('/api/public/proposal-session').json()['csrf']
            result = other.post('/api/public/station-applications', json=self.body, headers={'X-Proposal-CSRF': csrf})
            self.assertEqual(result.status_code, 429)
        self.assertEqual(len(self.db.list('station_applications')), 3)

    def test_review_and_import_require_actual_models_keep_station_hidden_and_disabled(self):
        key = self.application(); path = '/api/admin/station-applications/'+key
        self.assertEqual(self.admin.put(path, json={'status':'approved'}, headers=self.admin_headers).status_code, 422)
        result = self.admin.put(path, json={'status':'reviewing','note':'已验证登录'}, headers=self.admin_headers)
        self.assertEqual(result.json()['status'], 'reviewing')
        decision = {'status':'approved','note':'额度充足，待配置 Key','base_url':'https://api.relay.example/v1','models':['model-a','model-b']}
        result = self.admin.put(path, json=decision, headers=self.admin_headers)
        self.assertEqual(result.status_code, 200, result.text)
        station_id = result.json()['station_id']; station = self.db.get('stations', station_id)
        self.assertFalse(station['visible']); self.assertFalse(station['enabled'])
        self.assertEqual(station['models'], ['model-a','model-b'])
        self.assertNotIn('credentials_cipher', station); self.assertEqual(station['key_cipher'], '')
        self.assertEqual(self.guest.get('/api/public/bootstrap').json()['stations'], [])
        self.assertEqual(self.admin.put(path, json=decision, headers=self.admin_headers).json()['station_id'], station_id)
        self.assertEqual(len(self.db.list('stations')), 1)
        self.assertEqual(self.admin.put(path, json={'status':'rejected'}, headers=self.admin_headers).status_code, 409)

    def test_duplicate_import_does_not_override_existing_station(self):
        existing = self.admin.post('/api/admin/stations', json={'name':'原有站点','base_url':'https://api.relay.example/v1','models':['model-old'],'api_key':'sk-existing-private'}, headers=self.admin_headers).json()
        before = self.db.get('stations', existing['id'])
        key = self.application()
        result = self.admin.put('/api/admin/station-applications/'+key, json={'status':'approved','base_url':'https://api.relay.example/v1','models':['model-new']}, headers=self.admin_headers)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(self.db.get('stations', existing['id']), before)
        self.assertEqual(self.db.get('station_applications', key)['status'], 'pending')

    def test_filter_reject_resubmit_and_delete_credentials(self):
        key = self.application(); path = '/api/admin/station-applications/'+key
        self.assertEqual(self.guest.put(path, json={'status':'rejected'}).status_code, 401)
        self.assertEqual(self.admin.put(path, json={'status':'rejected','note':'无法登录'}, headers=self.admin_headers).status_code, 200)
        result = self.admin.get('/api/admin/station-applications?q=relay.example&status=rejected').json()
        self.assertEqual(result['total'], 1); self.assertEqual(result['counts']['rejected'], 1)
        self.assertEqual(self.admin.get('/api/admin/station-applications?status=approved').json()['total'], 0)
        self.assertEqual(self.admin.get('/api/admin/station-applications?status=invalid').status_code, 422)
        self.application(password='updated-password')
        self.assertEqual(self.admin.delete(path).status_code, 403)
        self.assertEqual(self.admin.delete(path, headers=self.admin_headers).status_code, 200)
        self.assertIsNone(self.db.get('station_applications', key))
        self.assertEqual(self.admin.post(path+'/credentials', json={}, headers=self.admin_headers).status_code, 404)
