"""Upgrade test: a database set up with the first version of schema.sql, used
the way friends first tried it (adding each other by typing a Gmail address
as a name), then upgraded by running the current schema.sql.

    python3 supabase/test_upgrade.py      # needs git, psycopg2 and Postgres on :5433
"""
import json
import os
import subprocess
import tempfile
import uuid

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
PG = dict(host=os.environ.get('PGHOST', '/tmp'), port=int(os.environ.get('PGPORT', '5433')), user='postgres')
DB = 'ck_upgrade'
V1_COMMIT = 'ea02df8'  # the first published schema


def psql(db, *args):
    subprocess.run(['psql', '-h', PG['host'], '-p', str(PG['port']), '-U', 'postgres', '-d', db,
                    '-v', 'ON_ERROR_STOP=1', '-q', *args], check=True, capture_output=True, text=True)


v1 = subprocess.run(['git', '-C', HERE, 'show', f'{V1_COMMIT}:supabase/schema.sql'],
                    check=True, capture_output=True, text=True).stdout
with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
    f.write(v1)
    v1_path = f.name

psql('postgres', '-c', f'drop database if exists {DB} with (force)', '-c', f'create database {DB}')
psql(DB, '-f', os.path.join(HERE, 'test_stub.sql'))
psql(DB, '-f', v1_path)

conn = psycopg2.connect(dbname=DB, **PG)
U = {}


def sign_up(name):
    U[name] = str(uuid.uuid4())
    with conn.cursor() as c:
        c.execute('insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)',
                  (U[name], f'{name}@gmail.com', json.dumps({'full_name': name.title()})))
    conn.commit()


def as_user(name, sql, params=None):
    with conn.cursor() as c:
        try:
            c.execute('set local role authenticated')
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (U[name],))
            c.execute(sql, params)
            rows = c.fetchall() if c.description else None
            conn.commit()
            return rows
        except Exception:
            conn.rollback()
            raise


def one(name, sql, params=None):
    return as_user(name, sql, params)[0][0]


passed = 0


def check(cond, msg):
    global passed
    assert cond, msg
    passed += 1
    print('  ok:', msg)


def expense(gid, payer, people):
    eid = str(uuid.uuid4())
    share = 100000 // len(people)
    return eid, json.dumps({'id': eid, 'groupId': gid, 'description': 'Trial dinner', 'currency': 'INR', 'amount': 100000,
                            'payers': {payer: 100000}, 'shares': {p: share for p in people}, 'participants': people,
                            'splitType': 'equal', 'inputs': {}, 'date': 'x', 'createdAt': 'x'})


# --- Version 1: Surya and Ravi sign in and add each other by Gmail -------------------
sign_up('surya')
sign_up('ravi')
me_s = one('surya', 'select id from public.ensure_me(%s)', ('Surya',))
me_r = one('ravi', 'select id from public.ensure_me(%s)', ('Ravi',))

ph_ravi, ph_priya, ph_arjun = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
as_user('surya', 'insert into public.people (id, name) values (%s, %s), (%s, %s), (%s, %s)',
        (ph_ravi, 'ravi@gmail.com', ph_priya, ' Priya@Gmail.com ', ph_arjun, 'Arjun'))
g1 = str(uuid.uuid4())
as_user('surya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])',
        (g1, 'Trial', [me_s, ph_ravi, ph_priya, ph_arjun]))
e1, d1 = expense(g1, me_s, [me_s, ph_ravi, ph_priya, ph_arjun])
as_user('surya', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)', (e1, g1, d1))

ph_surya = str(uuid.uuid4())
as_user('ravi', 'insert into public.people (id, name) values (%s, %s)', (ph_surya, 'S.urya@gmail.com'))
g2 = str(uuid.uuid4())
as_user('ravi', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (g2, 'Trial 2', [me_r, ph_surya]))
e2, d2 = expense(g2, me_r, [me_r, ph_surya])
as_user('ravi', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)', (e2, g2, d2))

check(len(as_user('ravi', 'select * from public.groups')) == 1 and len(as_user('surya', 'select * from public.groups')) == 1,
      'before the upgrade: each of them only sees their own trial group (the reported problem)')

# --- Upgrade ---------------------------------------------------------------------
psql(DB, '-f', os.path.join(HERE, 'schema.sql'))
check(True, 'the current schema.sql runs cleanly on top of version 1')
check(one('surya', 'select count(*) from public.notifications') == 0,
      'upgrading (and the repairs it makes) sends nobody notifications')
code = one('surya', 'select public.reset_invite_code(id) from public.groups where name = %s', ('Trial',))
check(len(code) == 12, 'resetting an invite link works (version 1 needed pgcrypto, which Supabase keeps out of reach)')

groups_r = sorted(r[0] for r in as_user('ravi', 'select name from public.groups'))
groups_s = sorted(r[0] for r in as_user('surya', 'select name from public.groups'))
check(groups_r == ['Trial', 'Trial 2'] and groups_s == ['Trial', 'Trial 2'],
      'after the upgrade both of them see both trial groups')
d = one('ravi', 'select data from public.expenses where id = %s', (e1,))
check(me_r in d['shares'] and ph_ravi not in json.dumps(d), "Surya's trial expense now counts Ravi's real account")
d = one('surya', 'select data from public.expenses where id = %s', (e2,))
check(me_s in d['shares'] and ph_surya not in json.dumps(d), "Ravi's trial expense now counts Surya (dots in the Gmail don't matter)")
check(one('surya', 'select count(*) from public.people where id in (%s, %s)', (ph_ravi, ph_surya)) == 0,
      'the stand-in people are gone')
check(one('surya', 'select email from public.people where id = %s', (ph_priya,)) == 'priya@gmail.com',
      'a Gmail typed as a name for someone not signed up yet is kept as their email')
check(one('surya', 'select email is null and name = %s from public.people where id = %s', ('Arjun', ph_arjun)),
      'plain names are left as they are')

# --- Priya signs up after the upgrade ----------------------------------------------
sign_up('priya')
me_p = one('priya', 'select id from public.ensure_me(%s)', ('Priya',))
check([r[0] for r in as_user('priya', 'select name from public.groups')] == ['Trial'],
      'Priya lands in the trial group the first time she signs in')
d = one('priya', 'select data from public.expenses where id = %s', (e1,))
check(me_p in d['shares'], 'with her share of the expense')

# --- Old app versions still cached on a phone -----------------------------------------
err = None
try:
    as_user('surya', 'update public.groups set member_ids = %s::uuid[] where id = %s', ([me_s], g1))
except psycopg2.Error as e:
    err = e
check(err is not None, 'an old app version cannot overwrite the member list (it gets an error instead)')
check(one('surya', 'update public.groups set name = %s where id = %s returning name', ('Trial run', g1)) == 'Trial run',
      'but renaming a group still works')


# --- Version 3 (WhatsApp invites) to the current version ---------------------------------
V3_COMMIT = 'cc2265f'
v3 = subprocess.run(['git', '-C', HERE, 'show', f'{V3_COMMIT}:supabase/schema.sql'],
                    check=True, capture_output=True, text=True).stdout
with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
    f.write(v3)
    v3_path = f.name
conn.close()
DB = 'ck_upgrade3'
psql('postgres', '-c', f'drop database if exists {DB} with (force)', '-c', f'create database {DB}')
psql(DB, '-f', os.path.join(HERE, 'test_stub.sql'))
psql(DB, '-f', v3_path)
conn = psycopg2.connect(dbname=DB, **PG)
for n in ['surya', 'ravi', 'kiran']:
    sign_up(n)
me_s = one('surya', 'select id from public.ensure_me(%s)', ('Surya',))
me_r = one('ravi', 'select id from public.ensure_me(%s)', ('Ravi',))
g = str(uuid.uuid4())
as_user('surya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (g, 'Goa', [me_s]))
code = one('surya', 'select invite_code from public.groups where id = %s', (g,))
psql(DB, '-f', os.path.join(HERE, 'schema.sql'))
check(True, 'the current schema.sql runs cleanly on top of version 3')
check(one('ravi', 'select public.request_join(%s)', (code,))['status'] == 'requested',
      'a group made before join requests can be asked to join')
req = one('surya', 'select id from public.join_requests')
check(one('surya', "select body from public.notifications where kind = 'request'") == 'Ravi asked to join Goa',
      'its creator is notified')
as_user('surya', 'select public.approve_join_request(%s)', (req,))
check(len(as_user('ravi', 'select * from public.groups')) == 1, 'and can let them in')

# --- Version 4 (live before outside-group expenses and friend links) to the current version --
V4_COMMIT = '2e73036'
v4 = subprocess.run(['git', '-C', HERE, 'show', f'{V4_COMMIT}:supabase/schema.sql'],
                    check=True, capture_output=True, text=True).stdout
with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
    f.write(v4)
    v4_path = f.name
conn.close()
DB = 'ck_upgrade4'
psql('postgres', '-c', f'drop database if exists {DB} with (force)', '-c', f'create database {DB}')
psql(DB, '-f', os.path.join(HERE, 'test_stub.sql'))
psql(DB, '-f', v4_path)
conn = psycopg2.connect(dbname=DB, **PG)
for n in ['surya', 'ravi']:
    sign_up(n)
me_s = one('surya', 'select id from public.ensure_me(%s)', ('Surya',))
me_r = one('ravi', 'select id from public.ensure_me(%s)', ('Ravi',))
one('surya', 'select id from public.add_person_by_email(%s)', ('ravi@gmail.com',))
g = str(uuid.uuid4())
as_user('surya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (g, 'Goa', [me_s, me_r]))
e_id, d = expense(g, me_s, [me_s, me_r])
as_user('surya', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)', (e_id, g, d))
psql(DB, '-f', os.path.join(HERE, 'schema.sql'))
check(True, 'the current schema.sql runs cleanly on top of version 4')
check(len(as_user('ravi', 'select * from public.expenses')) == 1, 'group expenses are still there and visible')
n_id = str(uuid.uuid4())
as_user('surya', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)',
        (n_id, json.dumps({'payers': {me_s: 100}, 'participants': [me_s, me_r], 'shares': {me_s: 50, me_r: 50}})))
check(len(as_user('ravi', 'select * from public.expenses where group_id is null')) == 1, 'and expenses outside groups work')
check(len(one('surya', 'select public.my_friend_code()')) == 12, 'and friend links work')

print(f'\nAll {passed} upgrade checks passed.')
