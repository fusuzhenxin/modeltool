import json
import smtplib
import ssl
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend import mailing
from backend.core import now


class MailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url='http://127.0.0.1')
        token = (self.db.directory/'setup.token').read_text()
        setup = self.client.post('/api/auth/setup', json={'username':'admin','password':'mail-test-admin-password','token':token})
        self.headers = {'X-CSRF-Token':setup.json()['csrf']}
        self.guest = TestClient(self.app, base_url='http://127.0.0.1')
        self.guest_headers = {'X-Proposal-CSRF':self.guest.get('/api/public/proposal-session').json()['csrf']}
        self.settings = {'enabled':True,'host':'smtp.example.com','port':465,'security':'ssl','username':'sender@example.com','password':'private-smtp-authorization','from_email':'sender@example.com','from_name':'ModelTool','notify_email':'operator@example.com','site_url':'https://www.modeltool.cn'}
        self.application = {'name':'邮件测试站','website_url':'https://mail-relay.example','login_url':'https://mail-relay.example/login','username':'private-probe-login','password':'private-probe-password','email':'applicant@example.com','notes':'private-account-note','consent':True}

    def tearDown(self):
        self.guest.close();self.client.close();self.temp.cleanup()

    def configure(self, **overrides):
        response=self.client.put('/api/admin/mail',json=self.settings|overrides,headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)

    def submit(self):
        response=self.guest.post('/api/public/station-applications',json=self.application,headers=self.guest_headers)
        self.assertEqual(response.status_code,201,response.text)
        return response.json()['id']

    def rows(self):
        with self.db.connect() as con:
            return [dict(r) for r in con.execute('SELECT * FROM mail_outbox ORDER BY created,id')]

    def test_mail_configuration_auth_encryption_and_secret_preservation(self):
        self.assertEqual(self.guest.get('/api/admin/mail').status_code,401)
        self.assertEqual(self.client.put('/api/admin/mail',json=self.settings).status_code,403)
        self.configure()
        response=self.client.get('/api/admin/mail')
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertTrue(response.json()['settings']['has_password'])
        self.assertNotIn('password_cipher',response.text)
        self.assertNotIn(self.settings['password'],response.text)
        stored=mailing.config(self.db)
        self.assertNotIn(self.settings['password'],json.dumps(stored))
        self.assertEqual(self.db.decrypt(stored['password_cipher']),self.settings['password'])
        self.configure(password='',from_name='New display name')
        self.assertEqual(mailing.config(self.db)['password_cipher'],stored['password_cipher'])
        self.assertNotIn(self.settings['password'],self.guest.get('/api/public/bootstrap').text)
        self.configure(enabled=False,password='',clear_password=True)
        self.assertFalse(self.client.get('/api/admin/mail').json()['settings']['has_password'])

    def test_bad_configuration_and_email_headers_are_rejected_without_echoing_secrets(self):
        for change in ({'host':''},{'notify_email':'not-mail'},{'from_email':'sender@example.com\nBcc:evil@example.com'}, {'from_name':'name\r\nbcc: evil'}, {'security':'none'}, {'port':0}):
            response=self.client.put('/api/admin/mail',json=self.settings|change,headers=self.headers)
            self.assertEqual(response.status_code,422,response.text)
            self.assertNotIn(self.settings['password'],response.text)
        response=self.client.put('/api/admin/mail',json=self.settings|{'password':''},headers=self.headers)
        self.assertEqual(response.status_code,422)
        for invalid in ('a@example.com\nBcc:x@y.com','bad','a..b@example.com','a@localhost'):
            response=self.guest.post('/api/public/station-applications',json=self.application|{'email':invalid},headers=self.guest_headers)
            self.assertEqual(response.status_code,422)

    def test_smtp_ssl_and_starttls_use_real_library_without_insecure_fallback(self):
        self.configure()
        settings=mailing.config(self.db)
        for mode in ('ssl','starttls'):
            smtp=Mock();smtp.send_message.return_value={};smtp.esmtp_features={}
            with patch('backend.mailing.smtplib.SMTP_SSL',return_value=smtp) as secure,patch('backend.mailing.smtplib.SMTP',return_value=smtp) as normal:
                mailing.send_email(self.db,settings|{'security':mode},{'recipient':'receiver@example.com','subject':'测试通知','body':'通知正文'},'message-id')
                smtp.login.assert_called_once_with('sender@example.com',self.settings['password'],initial_response_ok=False)
                message=smtp.send_message.call_args.args[0]
                self.assertEqual(message['To'],'receiver@example.com')
                self.assertIn('通知正文',message.get_content())
                self.assertNotIn(self.settings['password'],str(message))
                self.assertEqual(message['Message-ID'],'<message-id@example.com>')
                if mode=='ssl':
                    normal.assert_not_called();context=secure.call_args.kwargs['context']
                else:
                    secure.assert_not_called();smtp.starttls.assert_called_once();context=smtp.starttls.call_args.kwargs['context']
                self.assertTrue(context.check_hostname);self.assertEqual(context.verify_mode,ssl.CERT_REQUIRED)

    def test_login_authentication_avoids_plain_disconnect_and_preserves_rejection(self):
        self.configure();settings=mailing.config(self.db)
        smtp=Mock();smtp.esmtp_features={'auth':'LOGIN PLAIN XOAUTH2'};smtp.send_message.return_value={}
        payload={'recipient':'receiver@example.com','subject':'测试','body':'正文'}
        with patch('backend.mailing.smtplib.SMTP_SSL',return_value=smtp):
            mailing.send_email(self.db,settings,payload,'auth-login')
            smtp.ehlo_or_helo_if_needed.assert_called_once()
            smtp.login.assert_not_called()
            smtp.auth.assert_called_once_with('LOGIN',smtp.auth_login,initial_response_ok=False)
            self.assertEqual(smtp.user,settings['username'])
            self.assertEqual(smtp.password,self.settings['password'])
            smtp.send_message.reset_mock()
            smtp.auth.side_effect=smtplib.SMTPAuthenticationError(535,b'private upstream message')
            with self.assertRaises(smtplib.SMTPAuthenticationError) as caught:
                mailing.send_email(self.db,settings,payload,'auth-rejected')
            smtp.send_message.assert_not_called()
            self.assertIn('SMTP 服务',mailing.error_message(caught.exception))
            self.assertNotIn('private',mailing.error_message(caught.exception))
        self.assertIn('中断连接',mailing.error_message(smtplib.SMTPServerDisconnected('secret')))

    def test_submission_review_notifications_are_atomic_private_and_idempotent(self):
        self.configure();key=self.submit()
        rows=self.rows();self.assertEqual(len(rows),2)
        for row in rows:
            payload=json.loads(self.db.decrypt(row['payload']))
            for private in ('private-probe-login','private-probe-password','private-account-note'):
                self.assertNotIn(private,json.dumps(payload))
        decision={'status':'approved','base_url':'https://api.mail-relay.example/v1','models':['m'],'note':'internal-secret-review-note'}
        url='/api/admin/station-applications/'+key
        self.assertEqual(self.client.put(url,json=decision,headers=self.headers).status_code,200)
        self.assertEqual(self.client.put(url,json=decision,headers=self.headers).status_code,200)
        self.assertEqual(len(self.rows()),3)
        payload=json.loads(self.db.decrypt(self.rows()[-1]['payload']))
        self.assertIn('审核通过',payload['body']);self.assertNotIn(decision['note'],payload['body'])
        messages=[]
        while mailing.deliver_one(self.db,send=lambda db,s,p,k:messages.append(p)):
            pass
        self.assertEqual(len(messages),3);self.assertTrue(all(r['status']=='sent' for r in self.rows()))
        self.assertEqual({p['recipient'] for p in messages},{None,'applicant@example.com'})

    def test_failed_delivery_retries_then_stops_and_does_not_expose_smtp_error(self):
        self.configure();self.submit();key=self.rows()[0]['id']
        def fail(*args):
            raise smtplib.SMTPAuthenticationError(535,b'private-smtp-authorization upstream secret')
        for attempt in range(1,6):
            self.assertTrue(mailing.deliver_one(self.db,only_id=key,send=fail))
            row=next(row for row in self.rows() if row['id']==key)
            self.assertEqual(row['attempts'],attempt)
            self.assertEqual(row['status'],'failed' if attempt==5 else 'pending')
            self.assertNotIn('private-smtp',row['last_error'])
            self.assertIn('登录失败',row['last_error'])
            if attempt<5:
                self.assertFalse(mailing.deliver_one(self.db,only_id=key,send=fail))
                with self.db.connect(write=True) as con:con.execute('UPDATE mail_outbox SET next_attempt=0 WHERE id=?',(key,))
        self.assertFalse(mailing.deliver_one(self.db,only_id=key,send=fail))
        self.assertEqual(self.client.post('/api/admin/mail/'+key+'/retry',json={},headers=self.headers).status_code,200)
        self.assertTrue(mailing.deliver_one(self.db,only_id=key,send=lambda *args:None))
        self.assertEqual(self.client.post('/api/admin/mail/'+key+'/retry',json={},headers=self.headers).status_code,409)

    def test_queue_survives_disabled_mail_and_claims_once_across_dispatchers(self):
        self.submit();key=self.rows()[0]['id']
        self.assertFalse(mailing.deliver_one(self.db,only_id=key,send=lambda *args:self.fail('Disabled SMTP was used')))
        self.configure();calls=[]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:mailing.deliver_one(self.db,only_id=key,send=lambda *args:calls.append(1)),range(2)))
        self.assertEqual(sorted(results),[False,True]);self.assertEqual(calls,[1])
        key=self.rows()[1]['id']
        with self.db.connect(write=True) as con:con.execute("UPDATE mail_outbox SET status='sending',lease=? WHERE id=?",(now()-10,key))
        self.assertTrue(mailing.deliver_one(self.db,only_id=key,send=lambda *args:None))

    def test_real_test_mail_endpoint_reports_smtp_acceptance_and_failure(self):
        path='/api/admin/mail/test';body={'recipient':'self@example.com'}
        self.assertEqual(self.guest.post(path,json=body).status_code,401)
        self.assertEqual(self.client.post(path,json=body).status_code,403)
        self.assertEqual(self.client.post(path,json=body,headers=self.headers).status_code,422)
        self.configure()
        with patch('backend.mailing.send_email') as send:
            result=self.client.post(path,json=body,headers=self.headers)
            self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['status'],'sent');send.assert_called_once()
        with patch('backend.mailing.send_email',side_effect=RuntimeError('private upstream diagnostic')):
            result=self.client.post(path,json=body,headers=self.headers)
            self.assertEqual(result.status_code,502);self.assertNotIn('private upstream',result.text)

    def test_rejection_notifies_applicant_and_deletion_removes_unsent_notifications(self):
        self.configure();key=self.submit();url='/api/admin/station-applications/'+key
        self.assertEqual(self.client.put(url,json={'status':'rejected','note':'private reason'},headers=self.headers).status_code,200)
        self.assertEqual(len(self.rows()),3)
        payload=json.loads(self.db.decrypt(self.rows()[-1]['payload']))
        self.assertIn('暂未通过',payload['body']);self.assertNotIn('private reason',payload['body'])
        self.assertEqual(self.client.delete(url,headers=self.headers).status_code,200)
        self.assertEqual(self.rows(),[])
