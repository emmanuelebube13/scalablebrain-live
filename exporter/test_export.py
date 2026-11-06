"""Run: python -I exporter/test_export.py. Stdlib only, so it needs no test runner."""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from export import market_state, validate


def good():
    return {"schema": 1, "environment": "practice", "research": {"stages": {"killed": 3, "any_stage": 1}}}


def refused(status, names=()):
    try:
        validate(status, names)
    except ValueError:
        return True
    return False


checks = {
    "accepts a clean file": not refused(good()),
    "refuses an unknown key": refused({**good(), "balance": 84000}),
    "refuses a nested unknown key": refused({"research": {"equity": 1}}),
    "refuses an account id": refused({"detail": "acct 101-002-12345678-001"}),
    "refuses an email": refused({"detail": "someone@gmail.com"}),
    "refuses an ip address": refused({"detail": "ssh to 100.64.0.1"}),
    "refuses a tailnet host": refused({"detail": "box.tail123.ts.net"}),
    "refuses a windows path": refused({"detail": r"C:\SB\secrets"}),
    "refuses a token": refused({"detail": "gho_abcdefgh12345"}),
    "refuses a live strategy name": refused({"research": {"killed_recent": [{"title": "Trend Pullback Indices"}]}}, {"trend pullback indices"}),
    "allows a killed title": not refused({"research": {"killed_recent": [{"title": "FX fix reversal"}]}}, {"trend pullback indices"}),
    "friday 16:59 new york is open": market_state(datetime(2026, 11, 6, 21, 59, tzinfo=timezone.utc))["open"],
    "friday 17:00 new york is closed": not market_state(datetime(2026, 11, 6, 22, 0, tzinfo=timezone.utc))["open"],
    "saturday is closed": not market_state(datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc))["open"],
    "sunday 17:00 new york is open": market_state(datetime(2026, 11, 8, 22, 0, tzinfo=timezone.utc))["open"],
}
failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print("ok  " if ok else "FAIL", name)
sys.exit(1 if failed else 0)
