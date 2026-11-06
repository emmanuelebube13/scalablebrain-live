"""Build the public status file for the Scalable Brain live page, then publish it.

Direction of travel is one way: this job reads private systems and pushes a small
JSON file to a public branch. Nothing public can call back into a private system.

Safety rules, in order:
  1. Every value is chosen by hand below. Nothing is copied through wholesale.
  2. Database sessions are read-only, with a statement timeout.
  3. validate() refuses to publish if the file has an unknown key, a private-looking
     string, or the name of any strategy that is not already killed.
  4. If validation fails nothing is pushed, so the page goes stale and says so.

Usage: export.py [--no-push] [--out PATH]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BRAIN = Path(os.environ.get("SB_BRAIN", r"C:\SB\dev\systems\brain"))
DATA_CLONE = Path(os.environ.get("SB_LIVE_DATA", r"C:\SB\scalablebrain-live-data"))
TELEMETRY_URL = "http://127.0.0.1:8050/api/telemetry"
LOG_FILE = Path(os.environ.get("SB_LIVE_LOG", r"C:\SB\logs\public_live_export.log"))
MAX_BYTES = 250_000
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

log = logging.getLogger("public_live")

# Curated catalog: only these tables appear. Grain and notes are written by hand;
# columns, keys, relationships and row counts are read live from the database.
TABLES = [
    ("market", "dim_asset", "One row per tradable instrument.",
     "The shared dimension that prices, regimes, signals, outcomes and trades all join to."),
    ("market", "dim_strategy_registry", "One row per registered strategy.",
     "Keeps strategy identity separate from its results, so each fact table stores only the key."),
    ("market", "fact_market_prices", "One row per candle time, instrument and timeframe.",
     "Stores mid, bid and ask side by side, so trading costs are measured from real spreads. "
     "Each row also records the ingest run that wrote it."),
    ("market", "fact_market_prices_quarantine", "One row per rejected candle.",
     "Bad data is kept with a reason code instead of being deleted, so every rejection can be audited."),
    ("market", "fact_market_regime_v2", "One row per candle time, instrument and timeframe.",
     "Keeps causal regime labels apart from smoothed ones, so decisions can use only what was known at the time."),
    ("market", "fact_signals", "One row per candle time, instrument, timeframe and strategy.",
     "The composite key prevents duplicate signals. The version and config hash show which rules produced each one."),
    ("market", "fact_trade_outcomes", "One row per simulated trade outcome.",
     "Fold, out-of-sample and holdout flags are stored on the row, so training data cannot pass as test data."),
    ("market", "fact_live_trades", "One row per trade on the practice account.",
     "Links each broker trade to its strategy, model set and risk result, so every trade can be attributed."),
    ("research", "research.strategy", "One row per strategy idea.",
     "Holds the claim, mechanism and current stage. Moves between stages are recorded in stage_event."),
    ("research", "research.card", "One row per pre-registered hypothesis.",
     "Stores the rules, a SHA-256 of the card file and its git commit, so changes after registration are detectable."),
    ("research", "research.trial_ledger", "One row per registered trial, numbered in order.",
     "Counts every attempt, including failures. That count feeds the correction for repeated testing."),
    ("research", "research.run", "One row per backtest run.",
     "Stores the code version, data as-of time, parameters and cost model, so a run can be traced and repeated."),
    ("research", "research.run_metric", "One row per run, metric and fold.",
     "A long-format table with confidence bounds, so new metrics need no schema change."),
    ("research", "research.run_trade", "One row per simulated trade in a run.",
     "Keeps the trade-level evidence behind every summary number."),
    ("research", "research.run_series", "One row per run and time step.",
     "Daily equity, costs and financing, used for mark-to-market results and drawdown."),
    ("research", "research.stage_event", "One row per stage change.",
     "An audit trail of who moved a strategy, when, why, and which run was the evidence."),
    ("research", "research.forward_trade", "One row per forward-tested trade.",
     "A database trigger refuses deletes and freezes a row once closed. Only an open row's exit fields can change."),
    ("research", "research.incubation", "One row per strategy being forward-tested.",
     "Summarises forward results per strategy and flags late or failed recording."),
    ("external", "ext.series", "One row per external data series.",
     "Records each series' release lag and whether its values can be revised."),
    ("external", "ext.observation", "One row per series, observation time and availability time.",
     "Two time axes: when a value applied and when it became known, so a backtest can use only what was known then."),
    ("external", "ext.event", "One row per calendar event.",
     "Keeps scheduled, released and first-seen times, so an event cannot be used before it was known."),
]

SCHEDULED_TASKS = [
    (r"\ScalableBrain\hourly_signals", "Hourly signals"),
    (r"\ScalableBrain\daily_ingest_and_signals", "Daily data ingest"),
    (r"\ScalableBrain\persist_outcomes", "Outcome recording"),
    (r"\ScalableBrain\ops_watchdog", "Watchdog"),
    (r"\ScalableBrain\heartbeat", "Heartbeat"),
    (r"\ScalableBrain\backup_nightly", "Nightly backup"),
    (r"\SB research - daily", "Daily research"),
    (r"\SB trade journal sync (5m)", "Trade journal sync"),
]

ALLOWED_KEYS = {
    "schema", "total", "generated_at", "environment", "market", "open", "label", "systems", "id", "name",
    "status", "detail", "as_of", "scheduler", "last_run", "gate", "reduced", "rejected",
    "reconciliation", "state", "divergences", "data", "history_from", "total_rows", "total_gb",
    "timeframes", "tables", "store", "grain", "note", "rows", "mb", "pk", "columns", "type", "links",
    "research", "stages", "trials", "pass", "promising", "inconclusive", "killed", "pending",
    "runs_completed", "trades_simulated", "search_points", "forward", "trades", "closed",
    "strategies", "last_recorded", "killed_recent", "title", "family", "date",
}

FORBIDDEN = [
    ("account id", re.compile(r"\b\d{3}-\d{3}-\d{6,9}-\d{3}\b")),
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[a-z]{2,}", re.I)),
    ("ip address", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("private host", re.compile(r"\.ts\.net|localhost|\b127\.0\.0\.1\b", re.I)),
    ("file path", re.compile(r"\b[A-Z]:\\|/home/|/Users/")),
    ("token", re.compile(r"\b(?:ghp_|gho_|AKIA|ya29\.|sk-)[\w-]{8,}")),
    ("private key", re.compile(r"-----BEGIN")),
    ("secret-store path", re.compile(r"secrets/|\.env\b", re.I)),
]


def iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def market_state(now):
    """Spot FX is closed from Friday 17:00 to Sunday 17:00 New York time."""
    ny = now.astimezone(ZoneInfo("America/New_York"))
    closed = (
        (ny.weekday() == 4 and ny.hour >= 17)
        or ny.weekday() == 5
        or (ny.weekday() == 6 and ny.hour < 17)
    )
    return {"open": not closed, "label": "Market closed" if closed else "Market open"}


def read_only(conn):
    conn.exec_driver_sql("SET TRANSACTION READ ONLY")
    conn.exec_driver_sql("SET LOCAL statement_timeout = '15s'")


def table_rows(conn, text, reg):
    est, mb = conn.execute(
        text("SELECT reltuples::bigint, pg_total_relation_size(oid) / 1048576 FROM pg_class WHERE oid = CAST(:t AS regclass)"),
        {"t": reg},
    ).one()
    if est is not None and est >= 0:
        return int(est), int(mb)
    # Never analysed: count it, but a failed count must show as absent, not zero.
    try:
        with conn.begin_nested():
            conn.exec_driver_sql("SET LOCAL statement_timeout = '4s'")
            count = conn.execute(text(f"SELECT count(*) FROM {reg}")).scalar()
            conn.exec_driver_sql("SET LOCAL statement_timeout = '15s'")
        return int(count), int(mb)
    except Exception:
        return None, int(mb)


def describe_table(conn, text, store, reg, grain, note):
    rows, mb = table_rows(conn, text, reg)
    columns = conn.execute(
        text("""SELECT a.attname, format_type(a.atttypid, a.atttypmod)
                FROM pg_attribute a
                WHERE a.attrelid = CAST(:t AS regclass) AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY a.attnum"""),
        {"t": reg},
    ).fetchall()
    pk = conn.execute(
        text("""SELECT a.attname
                FROM pg_constraint c
                CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                WHERE c.conrelid = CAST(:t AS regclass) AND c.contype = 'p'
                ORDER BY k.ord"""),
        {"t": reg},
    ).fetchall()
    links = conn.execute(
        text("""SELECT DISTINCT confrelid::regclass::text FROM pg_constraint
                WHERE conrelid = CAST(:t AS regclass) AND contype = 'f'
                ORDER BY 1"""),
        {"t": reg},
    ).fetchall()
    return {
        "store": store,
        "name": reg,
        "grain": grain,
        "note": note,
        "rows": rows,
        "mb": mb,
        "pk": [r[0] for r in pk],
        "columns": [{"name": r[0], "type": r[1]} for r in columns],
        "links": [r[0] for r in links],
    }


def collect_database(now):
    """Returns the public data and research sections plus every name that must stay private."""
    sys.path.insert(0, str(BRAIN))
    os.chdir(BRAIN)
    from sqlalchemy import text
    from src.common.db import get_engine
    from src.research.db import get_research_engine

    tables = []
    timeframes, history_from, last_h1 = [], None, None
    with get_engine().connect() as conn:
        read_only(conn)
        for store, reg, grain, note in TABLES:
            if store == "market":
                tables.append(describe_table(conn, text, store, reg, grain, note))
        for gran, first, last in conn.execute(
            text('SELECT granularity, min("timestamp"), max("timestamp") FROM fact_market_prices GROUP BY 1')
        ):
            timeframes.append(gran)
            history_from = min(history_from, first) if history_from else first
            if gran == "H1":
                last_h1 = last
        conn.rollback()

    with get_research_engine().connect() as conn:
        read_only(conn)
        for store, reg, grain, note in TABLES:
            if store != "market":
                tables.append(describe_table(conn, text, store, reg, grain, note))

        stages = dict(conn.execute(text("SELECT current_stage, count(*) FROM research.strategy GROUP BY 1")).fetchall())
        outcomes = conn.execute(text("SELECT outcome, count(*) FROM research.trial_ledger GROUP BY 1")).fetchall()
        tally = {"pass": 0, "promising": 0, "inconclusive": 0, "killed": 0, "pending": 0}
        for outcome, count in outcomes:
            label = (outcome or "").upper()
            if not label:
                tally["pending"] += count
            elif label.startswith("KILL"):
                tally["killed"] += count
            elif label.startswith("PASS"):
                tally["pass"] += count
            elif label.startswith("PROMISING"):
                tally["promising"] += count
            elif label.startswith("INCONCLUSIVE"):
                tally["inconclusive"] += count
            else:
                tally["pending"] += count

        alive = conn.execute(
            text("SELECT strategy_key, title FROM research.strategy WHERE current_stage <> 'KILLED'")
        ).fetchall()
        private_names = {str(v).strip().lower() for row in alive for v in row if v and len(str(v).strip()) >= 6}

        killed_rows = conn.execute(
            text("""SELECT s.title, s.family, max(e.at) AS killed_at
                    FROM research.strategy s
                    JOIN research.stage_event e ON e.strategy_key = s.strategy_key AND e.to_stage = 'KILLED'
                    WHERE s.current_stage = 'KILLED' AND s.title IS NOT NULL
                    GROUP BY 1, 2 ORDER BY killed_at DESC LIMIT 12""")
        ).fetchall()
        killed_recent = [
            {"title": r[0], "family": r[1], "date": r[2].date().isoformat()}
            for r in killed_rows
            if not any(name in r[0].lower() for name in private_names)
        ]

        runs = conn.execute(text("SELECT count(*) FROM research.run WHERE status = 'done'")).scalar()
        trades_est = conn.execute(text("SELECT reltuples::bigint FROM pg_class WHERE oid = 'research.run_trade'::regclass")).scalar()
        points_est = conn.execute(text("SELECT reltuples::bigint FROM pg_class WHERE oid = 'research.search_point'::regclass")).scalar()
        fwd = conn.execute(
            text("""SELECT count(*), count(*) FILTER (WHERE exit_reason <> 'open'),
                           count(DISTINCT strategy_key), max(first_seen_at)
                    FROM research.forward_trade""")
        ).one()
        conn.rollback()

    known_rows = [t["rows"] for t in tables if t["rows"] is not None]
    data = {
        "history_from": history_from.date().isoformat() if history_from else None,
        "total_rows": sum(known_rows),
        "total_gb": round(sum(t["mb"] for t in tables) / 1024, 1),
        "timeframes": sorted(timeframes),
        "tables": tables,
    }
    research = {
        "stages": {k.lower(): int(v) for k, v in stages.items()},
        "trials": {"total": None, **tally},
        "runs_completed": int(runs),
        "trades_simulated": int(trades_est) if trades_est and trades_est > 0 else None,
        "search_points": int(points_est) if points_est and points_est > 0 else None,
        "forward": {
            "trades": int(fwd[0]),
            "closed": int(fwd[1]),
            "strategies": int(fwd[2]),
            "last_recorded": iso(fwd[3]),
        },
        "killed_recent": killed_recent,
    }
    research["trials"]["total"] = sum(tally.values())
    return data, research, private_names, last_h1


def fetch_telemetry():
    try:
        with urllib.request.urlopen(TELEMETRY_URL, timeout=8) as response:
            return json.load(response)
    except Exception as exc:
        log.warning("telemetry unavailable: %s", type(exc).__name__)
        return None


def collect_systems(telemetry, last_h1, market, now):
    payloads = (telemetry or {}).get("payloads") or {}
    systems = []

    if last_h1 is None:
        brain = ("unknown", "No hourly data found.")
    else:
        age = (now - last_h1).total_seconds() / 3600
        if not market["open"]:
            brain = ("closed", "Market closed. New candles resume when it reopens.")
        elif age <= 2.5:
            brain = ("ok", "Hourly market data is current.")
        elif age <= 6:
            brain = ("warn", "Hourly market data is running late.")
        else:
            brain = ("fault", "Hourly market data has stopped updating.")
    systems.append({"id": "s1", "name": "Brain", "status": brain[0], "detail": brain[1], "as_of": iso(last_h1)})

    s3 = payloads.get("s3health")
    if not isinstance(s3, dict):
        guardian = ("unknown", "No status received.")
    else:
        checks = s3.get("checks") or {}
        passed = bool(checks) and all(v is True for v in checks.values())
        if s3.get("status") == "ok" and passed:
            guardian = ("ok", "Risk gate is active and all its checks pass.")
        else:
            guardian = ("warn", "Risk gate reports a check that needs attention.")
    systems.append({"id": "s3", "name": "Guardian", "status": guardian[0], "detail": guardian[1], "as_of": iso(now)})

    s2 = payloads.get("s2health")
    if not isinstance(s2, dict):
        hand = ("unknown", "No status received.")
    elif s2.get("downtime_halted"):
        hand = ("warn", "Paused after downtime until reconciled and resumed.")
    elif s2.get("status") == "ok" and s2.get("trading_ready") is True:
        hand = ("ok", "Execution service is running and ready.")
    else:
        hand = ("warn", "Execution service is not ready.")
    systems.append({"id": "s2", "name": "Hand", "status": hand[0], "detail": hand[1], "as_of": iso(now)})

    published = (telemetry or {}).get("published_at")
    if not published:
        tele = ("unknown", "No telemetry snapshot received.")
        tele_at = None
    else:
        tele_at = datetime.fromisoformat(published.replace("Z", "+00:00"))
        age = (now - tele_at).total_seconds()
        tele = ("ok", "Telemetry snapshots are current.") if age <= 300 else ("warn", "Telemetry snapshots are late.")
    systems.append({"id": "tele", "name": "Telemetry", "status": tele[0], "detail": tele[1], "as_of": iso(tele_at)})

    gate = None
    decisions = payloads.get("decisions")
    if isinstance(decisions, dict) and isinstance(decisions.get("totals"), dict):
        gate = {
            "reduced": int(decisions["totals"].get("REDUCED", 0)),
            "rejected": int(decisions["totals"].get("REJECTED", 0)),
        }

    recon = None
    reconciliation = payloads.get("reconciliation")
    if isinstance(reconciliation, dict):
        count = (reconciliation.get("counts") or {}).get("divergences")
        state = reconciliation.get("state")
        recon = {
            "state": state if state in ("reconciled", "divergent", "unknown") else "unknown",
            "divergences": int(count) if isinstance(count, int) else None,
        }

    env = (payloads.get("environment") or {}).get("value")
    environment = env if env in ("practice", "demo") else "unknown"
    return systems, gate, recon, environment


def parse_task_time(raw):
    for fmt in ("%Y-%m-%d %I:%M:%S %p", "%m/%d/%Y %I:%M:%S %p", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M:%S"):
        try:
            return datetime.strptime(raw.strip().replace("\u202f", " "), fmt).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def collect_scheduler():
    out = []
    for task, label in SCHEDULED_TASKS:
        item = {"name": label, "status": "unknown", "last_run": None}
        try:
            result = subprocess.run(
                ["schtasks", "/query", "/tn", task, "/v", "/fo", "csv"],
                capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW,
            )
            rows = list(csv.DictReader(io.StringIO(result.stdout)))
            if result.returncode == 0 and rows:
                code = (rows[0].get("Last Result") or "").strip()
                last = parse_task_time(rows[0].get("Last Run Time") or "")
                item["last_run"] = iso(last)
                if code in ("0", "267009"):  # finished cleanly, or running now
                    item["status"] = "ok"
                elif code == "267011":  # registered but has not run yet
                    item["status"] = "unknown"
                elif code:
                    item["status"] = "warn"
        except Exception as exc:
            log.warning("task query failed for %s: %s", label, type(exc).__name__)
        out.append(item)
    return out


def validate(status, private_names=()):
    """Raises ValueError if the file is not safe to publish."""
    def walk(value, path, exempt_keys):
        if isinstance(value, dict):
            for key, child in value.items():
                if key not in ALLOWED_KEYS and not exempt_keys:
                    raise ValueError(f"unknown key {path}.{key}")
                walk(child, f"{path}.{key}", key == "stages")
        elif isinstance(value, list):
            for child in value:
                walk(child, path + "[]", False)
        elif isinstance(value, str):
            for label, pattern in FORBIDDEN:
                if pattern.search(value):
                    raise ValueError(f"{label} found at {path}")
        elif not (value is None or isinstance(value, (bool, int, float))):
            raise ValueError(f"unexpected type at {path}")

    walk(status, "$", False)
    blob = json.dumps(status, ensure_ascii=False).lower()
    # Column and table names come from a fixed catalog and can legitimately overlap.
    public_only = json.dumps(
        {k: v for k, v in status.items() if k != "data"}, ensure_ascii=False
    ).lower()
    for name in private_names:
        if name in public_only:
            raise ValueError("a strategy that is not killed appears in the public file")
    size = len(blob.encode("utf-8"))
    if size > MAX_BYTES:
        raise ValueError(f"file is too large: {size} bytes")


def build():
    now = datetime.now(timezone.utc)
    market = market_state(now)
    data, research, private_names, last_h1 = collect_database(now)
    systems, gate, recon, environment = collect_systems(fetch_telemetry(), last_h1, market, now)
    status = {
        "schema": 1,
        "generated_at": iso(now),
        "environment": environment,
        "market": market,
        "systems": systems,
        "scheduler": collect_scheduler(),
        "gate": gate,
        "reconciliation": recon,
        "data": data,
        "research": research,
    }
    validate(status, private_names)
    return status


def git(*args):
    return subprocess.run(
        ["git", "-C", str(DATA_CLONE), *args],
        capture_output=True, text=True, timeout=90, check=True, creationflags=NO_WINDOW,
    )


def publish(status):
    target = DATA_CLONE / "status.json"
    target.write_text(json.dumps(status, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    git("add", "status.json")
    # One rolling commit: the branch holds only the latest file, with no public history to grow.
    git("commit", "--amend", "--no-edit", "--allow-empty", "--reset-author")
    git("push", "--force", "origin", "data")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-push", action="store_true")
    parser.add_argument("--out")
    args = parser.parse_args()
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=LOG_FILE, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        status = build()
        if args.out:
            Path(args.out).write_text(json.dumps(status, ensure_ascii=False, indent=1), encoding="utf-8")
        if not args.no_push:
            publish(status)
        log.info("ok generated_at=%s pushed=%s", status["generated_at"], not args.no_push)
        return 0
    except Exception:
        log.exception("export failed; nothing was published")
        return 1


if __name__ == "__main__":
    sys.exit(main())
