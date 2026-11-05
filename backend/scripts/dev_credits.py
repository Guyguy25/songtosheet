"""Local test only: grant credits to your own test account.

Run from project root after creating an account:
    DEV_MODE=1 python scripts/dev_credits.py test@example.com 10
This is not a customer-facing free trial: it requires local shell/database access.
"""
import os
import sys
import uuid
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app

if __name__=='__main__':
    if os.getenv('DEV_MODE','1')!='1':
        raise SystemExit('Only allowed with DEV_MODE=1')
    if len(sys.argv)!=3 or '@' not in sys.argv[1]:
        raise SystemExit('Usage: DEV_MODE=1 python scripts/dev_credits.py email@example.com 10')
    email=sys.argv[1].strip().lower()
    credits=int(sys.argv[2])
    if not 1<=credits<=100:raise SystemExit('Amount must be 1–100')
    with app.db() as c:
        u=c.execute('SELECT id FROM users WHERE email=?',(email,)).fetchone()
        if not u:raise SystemExit('User not found. Sign up first.')
        c.execute('BEGIN IMMEDIATE')
        c.execute('UPDATE users SET credits=credits+? WHERE id=?',(credits,u['id']))
        c.execute('INSERT INTO credit_events VALUES(?,?,?,?,?)',('dev:'+uuid.uuid4().hex,u['id'],credits,'local-dev',int(time.time())))
    print(f'+{credits} test credits granted to {email} (local DEV_MODE only)')