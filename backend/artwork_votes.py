"""Visitor opinions on published artworks; votes do not change test results."""
from typing import Literal

from fastapi import HTTPException, Query, Request

from .core import now
from .models import StrictModel


class ArtworkVote(StrictModel):
    choice: Literal["real", "fake"] | None


def register_artwork_votes(app, db, identity, guest, throttle):
    def available(key, con):
        report = db.get("reports", key, con)
        station = db.get("stations", report["station_id"], con) if report else None
        art = report.get("result", {}).get("artwork", {}) if report else {}
        return bool(report and report.get("status") == "published" and station
                    and station.get("visible") and art.get("available") and art.get("html"))

    def counts(key, visitor, con):
        rows = con.execute("SELECT choice,COUNT(*) total FROM artwork_votes WHERE report_id=? GROUP BY choice", (key,)).fetchall()
        totals = {row["choice"]: row["total"] for row in rows}
        mine = con.execute("SELECT choice FROM artwork_votes WHERE report_id=? AND visitor=?", (key, visitor)).fetchone() if visitor else None
        return {"real": totals.get("real", 0), "fake": totals.get("fake", 0), "choice": mine[0] if mine else None}

    @app.get("/api/public/artwork-votes")
    def listing(request: Request, ids: str = Query(min_length=1, max_length=3000)):
        keys = list(dict.fromkeys(ids.split(",")))
        if len(keys) > 24 or any(not key or len(key) > 100 for key in keys):
            raise HTTPException(422, "一次最多查询 24 件作品")
        with db.connect() as con:
            viewer = identity(request, con)
            visitor = viewer["token"] if viewer else ""
            return {"items": {key: counts(key, visitor, con) for key in keys if available(key, con)}}

    @app.put("/api/public/reports/{key}/artwork-vote")
    def vote(key: str, spec: ArtworkVote, request: Request):
        with db.connect(write=True) as con:
            visitor = guest(request, con)
            if not available(key, con):
                raise HTTPException(404, "作品不存在或未公开")
            current = con.execute("SELECT choice FROM artwork_votes WHERE report_id=? AND visitor=?", (key, visitor)).fetchone()
            if (current[0] if current else None) != spec.choice:
                throttle(request, visitor, "artwork_vote", 120, con)
                if spec.choice is None:
                    con.execute("DELETE FROM artwork_votes WHERE report_id=? AND visitor=?", (key, visitor))
                else:
                    con.execute("INSERT INTO artwork_votes(report_id,visitor,choice,created) VALUES(?,?,?,?) ON CONFLICT(report_id,visitor) DO UPDATE SET choice=excluded.choice,created=excluded.created", (key, visitor, spec.choice, now()))
            return counts(key, visitor, con)
