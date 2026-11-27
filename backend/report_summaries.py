"""Transactionally maintained read projections; original report data stays intact."""
from .report_quality import TRACE_SQL

SUMMARY_PATHS = ("$.result.raw", "$.result.artwork.html", "$.result.sections", "$.result.checks",
                 "$.result.conditions", "$.result.retest", "$.result.findings")


def install(con):
    con.executescript("""
        CREATE TABLE IF NOT EXISTS report_summaries (
            id TEXT PRIMARY KEY, data TEXT NOT NULL, trace_summary TEXT, conditions TEXT,
            passed INTEGER NOT NULL, attention INTEGER NOT NULL, updated REAL NOT NULL,
            model TEXT, observed REAL
        );
        CREATE INDEX IF NOT EXISTS report_summaries_updated ON report_summaries(updated DESC);
        CREATE INDEX IF NOT EXISTS report_summaries_model ON report_summaries(model, observed);
    """)
    paths = ",".join("'" + p + "'" for p in SUMMARY_PATHS)
    def select(source):
        return f"""SELECT e.id,json_remove(e.data,{paths}),{TRACE_SQL},
            json_extract(e.data,'$.result.conditions'),
            (SELECT count(*) FROM json_each(e.data,'$.result.checks') c WHERE json_extract(c.value,'$.status')='pass'),
            (SELECT count(*) FROM json_each(e.data,'$.result.checks') c WHERE json_extract(c.value,'$.status') IN ('fail','warn')),
            e.updated,json_extract(e.data,'$.result.model'),json_extract(e.data,'$.created')
            FROM {source} WHERE e.kind='reports'"""
    # SQLite triggers cover admin review, worker publication and direct SQL tools.
    # Updates happen in the same transaction, so hiding a report takes effect immediately.
    for name in ("insert", "update"):
        trigger = con.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
                              ("report_summaries_" + name,)).fetchone()
        if trigger and "reference_only" not in trigger[0]:
            con.execute("DROP TRIGGER report_summaries_" + name)
    for event, name in (("INSERT", "insert"), ("UPDATE OF data,updated", "update")):
        con.execute(f"""CREATE TRIGGER IF NOT EXISTS report_summaries_{name}
            AFTER {event} ON entities WHEN NEW.kind='reports' BEGIN
            DELETE FROM report_summaries WHERE id=NEW.id;
            INSERT INTO report_summaries {select('entities e')} AND e.id=NEW.id;
            END""")
    con.execute("""CREATE TRIGGER IF NOT EXISTS report_summaries_delete
        AFTER DELETE ON entities WHEN OLD.kind='reports' BEGIN
        DELETE FROM report_summaries WHERE id=OLD.id; END""")
    # Existing installations are populated once. Later starts only check indexed IDs.
    con.execute("INSERT INTO report_summaries " + select("entities e") +
                " AND NOT EXISTS (SELECT 1 FROM report_summaries s WHERE s.id=e.id)")
