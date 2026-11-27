import json
import tempfile
import unittest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.worker import tick, work_once


class MultiModelScheduleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        token = (self.db.directory / "setup.token").read_text()
        auth = self.client.post("/api/auth/setup", json={"username":"admin", "password":"multi-model-test-password", "token":token})
        self.headers = {"X-CSRF-Token":auth.json()["csrf"]}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def post(self, path, body):
        return self.client.post("/api/admin/"+path, json=body, headers=self.headers)

    def station(self, name="first", keys=True):
        response = self.post("stations", {"name":name,"base_url":"https://"+name+".example/v1", "models":["gpt-test","claude-test"],
            "daily_calls":0,"daily_tokens":0,"api_keys":[
                {"name":"GPT","api_key":"sk-fixture-gpt-"+name,"model_scope":"bound","models":["gpt-test"]},
                *([{"name":"Claude","api_key":"sk-fixture-claude-"+name,"model_scope":"bound","models":["claude-test"],"protocol":"anthropic"}] if keys else [])]})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()["id"]

    def plans(self, ids, **changes):
        return [{"name":sid+" / "+model,"station_id":sid,"model":model,"kind":"site_candy","count":1,"schedule_mode":"daily","daily_time":"09:00",**changes}
                for sid in ids for model in ["gpt-test","claude-test"]]

    def test_same_station_many_models_and_multiple_stations_are_independent_plans(self):
        ids = [self.station(),self.station("second")]
        result = self.post("schedules/batch",{"schedules":self.plans(ids)})
        self.assertEqual(result.status_code,200,result.text)
        plans = result.json()["schedules"]
        self.assertEqual(len(plans),4)
        self.assertEqual(len({p["id"] for p in plans}),4)
        self.assertEqual({(p["station_id"],p["model"]) for p in plans},{(s,m) for s in ids for m in ["gpt-test","claude-test"]})
        self.assertTrue(all(p["daily_time"]=="09:00" and p["count"]==1 for p in plans))

    def test_invalid_or_missing_key_target_rolls_back_all_plans(self):
        sid=self.station(keys=False)
        result=self.post("schedules/batch",{"schedules":self.plans([sid])})
        self.assertEqual(result.status_code,409,result.text)
        self.assertEqual(self.db.list("schedules"),[])
        plans=self.plans([sid]);plans[1]["model"]="not-registered"
        self.assertEqual(self.post("schedules/batch",{"schedules":plans}).status_code,422)
        self.assertEqual(self.db.list("schedules"),[])

    def test_duplicate_station_model_pairs_and_batch_bounds_are_rejected(self):
        sid=self.station();plan=self.plans([sid])[0]
        for plans in [[],[plan,plan],[plan]*101]:
            self.assertEqual(self.post("schedules/batch",{"schedules":plans}).status_code,422)
        self.assertEqual(self.db.list("schedules"),[])

    def test_generated_jobs_use_each_models_key_and_protocol(self):
        sid=self.station()
        response=self.post("schedules/batch",{"schedules":self.plans([sid],schedule_mode="interval",interval_minutes=360,first_run="2020-01-01T00:00:00Z")})
        self.assertEqual(response.status_code,200,response.text)
        tick(self.db)
        seen=[]
        def upstream(url,headers,payload):
            seen.append((payload["model"],url,headers))
            return {"choices":[{"message":{"content":"A"}}],"content":[{"text":"A"}],"usage":{"total_tokens":20}}
        self.assertTrue(work_once(self.db,upstream));self.assertTrue(work_once(self.db,upstream))
        self.assertEqual(len(seen),2)
        for model,url,headers in seen:
            if model=="gpt-test":
                self.assertEqual(headers["Authorization"],"Bearer sk-fixture-gpt-first")
                self.assertTrue(url.endswith("/chat/completions"))
            else:
                self.assertEqual(headers["x-api-key"],"sk-fixture-claude-first")
                self.assertTrue(url.endswith("/messages"))
        self.assertEqual(len(self.db.list("reports")),2)

    def test_manual_batch_also_accepts_same_station_with_distinct_models(self):
        sid=self.station()
        runs=[{"station_id":sid,"model":m,"kind":"site_candy","count":1} for m in ["gpt-test","claude-test"]]
        duplicate=self.post("jobs/batch",{"runs":[runs[0],runs[0]]})
        self.assertEqual(duplicate.status_code,422)
        valid=self.post("jobs/batch",{"runs":runs})
        self.assertEqual(valid.status_code,200,valid.text)
        self.assertEqual(valid.json()["count"],2)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM usage").fetchone()[0],0)
            self.assertEqual({r[0] for r in con.execute("SELECT model FROM jobs")},{"gpt-test","claude-test"})

    def test_manual_batch_invalid_model_is_atomic(self):
        sid=self.station()
        runs=[{"station_id":sid,"model":m,"kind":"site_candy"} for m in ["gpt-test","missing"]]
        self.assertEqual(self.post("jobs/batch",{"runs":runs}).status_code,409)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM jobs").fetchone()[0],0)


if __name__=="__main__":unittest.main()
