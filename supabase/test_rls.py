"""Scenario test for supabase/schema.sql: row level security and functions.

Creates a fresh database on a local Postgres (16+) with the Supabase-like
stand-in in test_stub.sql, applies schema.sql, then plays out how friends
use the app. Each `as_user` call runs in its own transaction as the
`authenticated` role with that user's id, which is how Supabase evaluates
policies for a signed-in user.

    python3 supabase/test_rls.py          # needs psycopg2 and Postgres on :5433
"""
import json
import os
import subprocess
import uuid

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
PG = dict(host=os.environ.get('PGHOST', '/tmp'), port=int(os.environ.get('PGPORT', '5433')), user='postgres')
DB = 'ck_rls'


def psql(db, *args):
    subprocess.run(['psql', '-h', PG['host'], '-p', str(PG['port']), '-U', 'postgres', '-d', db,
                    '-v', 'ON_ERROR_STOP=1', '-q', *args], check=True, capture_output=True, text=True)


def fresh_database(name, *sql_files):
    psql('postgres', '-c', f'drop database if exists {name} with (force)', '-c', f'create database {name}')
    for f in sql_files:
        psql(name, '-f', f)


fresh_database(DB, os.path.join(HERE, 'test_stub.sql'), os.path.join(HERE, 'schema.sql'))
# Running the script a second time must be harmless.
psql(DB, '-f', os.path.join(HERE, 'schema.sql'))

conn = psycopg2.connect(dbname=DB, **PG)
conn.autocommit = False

U = {}


def sign_up(name, email=None):
    U[name] = str(uuid.uuid4())
    with conn.cursor() as c:
        c.execute('insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)',
                  (U[name], email or f'{name}@gmail.com', json.dumps({'full_name': name.title()})))
    conn.commit()


def as_user(name, sql, params=None, fetch=True, role='authenticated'):
    with conn.cursor() as c:
        try:
            c.execute(f'set local role {role}')
            if name:
                c.execute("select set_config('request.jwt.claim.sub', %s, true)", (U[name],))
            c.execute(sql, params)
            rows = c.fetchall() if fetch and c.description else None
            conn.commit()
            return rows
        except Exception:
            conn.rollback()
            raise


def one(name, sql, params=None):
    return as_user(name, sql, params)[0][0]


def error(name, sql, params=None):
    """The error message if the statement fails, else None."""
    try:
        as_user(name, sql, params)
        return None
    except psycopg2.Error as e:
        return (e.diag.message_primary or str(e)).strip()


def fails(name, sql, params=None):
    return error(name, sql, params) is not None


def fails_anon(sql, params=None):
    try:
        as_user(None, sql, params, role='anon')
        return False
    except psycopg2.Error:
        return True


def names(name):
    return sorted(r[0] for r in as_user(name, 'select name from public.people'))


passed = 0


def check(cond, msg):
    global passed
    assert cond, msg
    passed += 1
    print('  ok:', msg)


for n in ['surya', 'ravi', 'priya', 'stranger']:
    sign_up(n)

# --- Signing in ----------------------------------------------------------------
me_s = one('surya', 'select id from public.ensure_me(%s)', ('Surya',))
me_p = one('priya', 'select id from public.ensure_me(%s)', ('Priya',))
me_x = one('stranger', 'select id from public.ensure_me(%s)', ('Stranger',))
check(one('surya', 'select id from public.ensure_me(%s)', ('Other name',)) == me_s,
      'ensure_me returns the same person on later sign-ins')
check(one('surya', 'select email from public.people where id = %s', (me_s,)) == 'surya@gmail.com',
      'your person row carries your sign-in email')
check(fails_anon('select public.ensure_me(%s)', ('x',)) and fails_anon('select public.add_person_by_email(%s)', ('a@b.co',)),
      'signed-out visitors cannot call the app functions')
check(as_user(None, 'select * from public.people', role='anon') == [], 'and see no people')
check(fails('stranger', 'insert into public.people (name, user_id) values (%s, %s)', ('Me again', U['stranger'])),
      'nobody can insert a person row for an account directly')

# --- Adding friends by email ---------------------------------------------------------
row = as_user('surya', 'select id, user_id, name from public.add_person_by_email(%s, %s)', ('Priya@GMail.com', 'P'))[0]
check(row[0] == me_p and row[1] == U['priya'] and row[2] == 'Priya',
      'adding an email that has an account adds that person, with their own name')
check(one('surya', 'select id from public.add_person_by_email(%s)', ('p.riya+trip@gmail.com',)) == me_p,
      'Gmail addresses match regardless of case, dots and +suffix')
check('Priya' in names('surya') and 'Surya' in names('priya'),
      'once added by email, you are in each other’s friends list without sharing a group')
check(error('surya', 'select public.add_person_by_email(%s)', ('surya@gmail.com',)) == "That's your own email address.",
      'adding your own email is refused')
check(fails('surya', 'select public.add_person_by_email(%s)', ('not an email',)), 'a malformed email is refused')
sign_up('quiet')  # has an account but has never opened the app
row = as_user('surya', 'select id, user_id, name from public.add_person_by_email(%s)', ('quiet@gmail.com',))[0]
check(row[0] is not None and row[1] == U['quiet'] and row[2] == 'Quiet',
      'adding someone who signed up but never opened the app creates their person from their Google name')
check('Surya' in names('quiet') and one('quiet', 'select id from public.ensure_me(%s)', ('Q',)) == row[0],
      'and when they open the app they are that person, with you in their friends')
newbie_ph = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('newbie@gmail.com', 'Newbie'))
check(one('surya', 'select user_id is null and name = %s from public.people where id = %s', ('Newbie', newbie_ph)),
      'an email without an account becomes a placeholder with the given name')
check(one('surya', 'select id from public.add_person_by_email(%s)', ('NewBie@gmail.com',)) == newbie_ph,
      'adding the same email again reuses that placeholder')
check('Newbie' not in names('stranger'), 'strangers do not see your placeholders')

# --- Groups ------------------------------------------------------------------------
ravi_ph = str(uuid.uuid4())
as_user('surya', 'insert into public.people (id, name) values (%s, %s)', (ravi_ph, 'Ravi'), fetch=False)
g = str(uuid.uuid4())
check(fails('surya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])',
            (str(uuid.uuid4()), 'Sneaky', [me_s, me_x])),
      'you cannot put a stranger in a new group')
as_user('surya', 'insert into public.groups (id, name, member_ids, base_currency, rates) values (%s, %s, %s::uuid[], %s, %s)',
        (g, 'Thailand trip', [me_s, ravi_ph, me_p, newbie_ph], 'INR', json.dumps({'THB': 2.87})), fetch=False)
exp_id = str(uuid.uuid4())
expense = {'id': exp_id, 'groupId': g, 'description': 'Hostel', 'currency': 'THB', 'amount': 600000,
           'payers': {ravi_ph: 600000}, 'shares': {me_s: 300000, ravi_ph: 300000},
           'participants': [me_s, ravi_ph], 'splitType': 'equal', 'inputs': {}, 'date': 'x', 'createdAt': 'x'}
as_user('surya', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)', (exp_id, g, json.dumps(expense)), fetch=False)

check(len(as_user('surya', 'select * from public.groups')) == 1, 'creator sees the group')
check(len(as_user('priya', 'select * from public.groups')) == 1, 'a friend added by email sees the group straight away')
check(len(as_user('priya', 'select * from public.expenses')) == 1, 'members see the group expenses')
check(len(as_user('stranger', 'select * from public.groups')) == 0, 'a stranger cannot see the group')
check(len(as_user('stranger', 'select * from public.expenses')) == 0, 'a stranger cannot see its expenses')
check(fails('stranger', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)',
            (str(uuid.uuid4()), g, '{}')), 'a stranger cannot add expenses to the group')
check(names('stranger') == ['Stranger'], 'a stranger only sees themselves in people')
check(names('priya') == ['Newbie', 'Priya', 'Ravi', 'Surya'], 'members see everyone in their groups, including placeholders')
check(fails('priya', 'update public.groups set invite_code = %s where id = %s', ('hack', g)),
      'members cannot change the invite code directly')
check(fails('priya', 'update public.groups set member_ids = %s::uuid[] where id = %s', ([me_p], g)),
      'members cannot rewrite the member list directly')
check(fails('priya', 'delete from public.groups where id = %s returning id', (g,)) or
      len(as_user('surya', 'select * from public.groups')) == 1, 'only the creator can delete the group')
check(fails('stranger', 'update public.people set user_id = %s where id = %s', (U['stranger'], ravi_ph)),
      'nobody can attach their account to a placeholder directly')
check(fails('priya', 'update public.people set email = %s where id = %s', ('priya@gmail.com', ravi_ph)),
      'nobody can change an email directly')

# --- Changing members safely ----------------------------------------------------------
err = error('priya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [], [ravi_ph]))
check(err and 'expenses' in err, 'someone in the group’s expenses cannot be removed')
err = error('priya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [], [me_s]))
check(err and 'created' in err, 'the person who created the group cannot be removed')
err = error('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [], [me_s]))
check(err and 'delete it instead' in err, 'the creator is told to delete the group instead of leaving')
check(fails('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [me_x], [])),
      'you can only add people you know')
check(fails('stranger', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [me_x], [])),
      'a non-member cannot change members')
as_user('priya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [], [me_p]))
check(len(as_user('priya', 'select * from public.groups')) == 0, 'a member who is not in any expense can leave')
as_user('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [me_p], []))
check(len(as_user('priya', 'select * from public.groups')) == 1, 'and can be added back')
mem = one('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])::text[]', (g, [me_p], []))
check(sorted(mem) == sorted([me_s, ravi_ph, me_p, newbie_ph]), 'adding someone already in the group changes nothing')

# --- A transfer outside groups ----------------------------------------------------------
t_id = str(uuid.uuid4())
as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
        (t_id, me_s, ravi_ph, json.dumps({'id': t_id, 'kind': 'transfer', 'from': me_s, 'to': ravi_ph,
                                            'currency': 'INR', 'amount': 150000})), fetch=False)
check(len(as_user('surya', 'select * from public.transfers')) == 1, 'the creator sees their transfer')
check(len(as_user('priya', 'select * from public.transfers')) == 0, 'other group members do not see private transfers')

# --- A friend added by email signs up later ---------------------------------------
sign_up('newbie')
me_n = one('newbie', 'select id from public.ensure_me(%s)', ('Newbie Kumar',))
check(me_n != newbie_ph and len(as_user('newbie', 'select * from public.groups')) == 1,
      'signing in with an email someone added puts you straight into their group')
check(one('surya', 'select count(*) from public.people where id = %s', (newbie_ph,)) == 0,
      'the placeholder is replaced by the real account')
check('Surya' in names('newbie') and 'Newbie Kumar' in names('surya'),
      'the person who added you and you are in each other’s friends list')

# --- Giving an existing placeholder an email ------------------------------------------
check(fails('stranger', 'select public.set_person_email(%s, %s)', (ravi_ph, 'stranger@gmail.com')),
      'a stranger cannot put an email on your placeholder')
check(fails('surya', 'select public.set_person_email(%s, %s)', (me_p, 'x@gmail.com')),
      'a real account’s email cannot be changed by others')
solo = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('later@gmail.com', 'Later'))
check(one('surya', 'select public.set_person_email(%s, %s)', (solo, '')) == solo and
      one('surya', 'select email from public.people where id = %s', (solo,)) is None,
      'an email can be cleared from a placeholder')

# Ravi signed up but hasn't been linked: Surya types Ravi's email on the "Ravi" placeholder.
me_r = one('ravi', 'select id from public.ensure_me(%s)', ('Ravi K',))
check(len(as_user('ravi', 'select * from public.groups')) == 0, 'before being linked, Ravi cannot see the group')
new_id = one('surya', 'select public.set_person_email(%s, %s)', (ravi_ph, 'RAVI@gmail.com'))
check(new_id == me_r, 'giving a placeholder the email of an existing account links it at once')
check(len(as_user('ravi', 'select * from public.groups')) == 1, 'and Ravi now sees the group')
data = one('ravi', 'select data from public.expenses where id = %s', (exp_id,))
check(me_r in data['payers'] and ravi_ph not in json.dumps(data), "the expense now uses Ravi's real account")
mem = one('surya', 'select member_ids::text[] from public.groups where id = %s', (g,))
check(me_r in mem and ravi_ph not in mem, 'group membership points at Ravi')
tr = as_user('ravi', 'select from_person, to_person, data from public.transfers')
check(len(tr) == 1 and tr[0][1] == me_r and tr[0][2]['to'] == me_r, "Surya's cash transfer moved to Ravi's account and he sees it")
check(fails('surya', 'update public.people set name = %s where id = %s returning id', ('Not Ravi', me_r)) or
      one('surya', 'select name from public.people where id = %s', (me_r,)) == 'Ravi K',
      "Surya cannot rename Ravi's real account")

# --- Invite links ------------------------------------------------------------------
code = one('surya', 'select invite_code from public.groups where id = %s', (g,))
sign_up('arjun')
one('arjun', 'select id from public.ensure_me(%s)', ('Arjun',))
arjun_ph = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('arjun.other@gmail.com', 'Arjun'))
as_user('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [arjun_ph], []))
prev = one('arjun', 'select public.group_preview(%s)', (code,))
check(prev['name'] == 'Thailand trip' and not prev['is_member'], 'invite preview shows the group to a non-member')
check([m['id'] for m in prev['members'] if not m['claimed']] == [arjun_ph], 'preview lists the unclaimed placeholder to pick')
check(one('arjun', 'select public.group_preview(%s)', ('nope',)) is None, 'a wrong code shows nothing')
one('arjun', 'select public.join_group(%s, %s)', (code, arjun_ph))
check(len(as_user('arjun', 'select * from public.groups')) == 1, 'claiming a placeholder from the link joins the group')
check(one('arjun', 'select public.join_group(%s, null)', (code,)) == g, 'joining twice is harmless')
check(fails('stranger', 'select public.join_group(%s, %s)', (code, me_r)), 'nobody can claim a real account')
as_user('stranger', 'select public.join_group(%s, null)', (code,))
check(len(as_user('stranger', 'select * from public.expenses')) == 1, 'joining as new gives access to the group')
check(len(as_user('stranger', 'select * from public.transfers')) == 0, 'but not to private transfers')

# A member saving the group with an old copy can no longer drop someone who just joined.
as_user('priya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [], []))
check(me_x in one('surya', 'select member_ids::text[] from public.groups where id = %s', (g,)),
      'someone who joined meanwhile stays in the group')

# Placeholder in the same group as the real person: sign-in leaves it alone instead of failing.
dup = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('stranger@gmail.com', 'Dup'))
check(dup == me_x, 'an email with an account never creates a duplicate placeholder')
clash = str(uuid.uuid4())
with conn.cursor() as c:  # simulate an old-style placeholder with that email sitting next to them
    c.execute("insert into public.people (id, name, email, created_by) values (%s, 'Old', 'stranger@gmail.com', %s)", (clash, U['surya']))
    c.execute('update public.groups set member_ids = member_ids || %s::uuid where id = %s', (clash, g))
conn.commit()
check(one('stranger', 'select id from public.ensure_me(%s)', ('Stranger',)) == me_x,
      'signing in still works when a clashing placeholder exists')

# --- Settle-up payments cascade with their settlement ----------------------------------
s_id = str(uuid.uuid4())
as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
        (s_id, me_r, me_s, json.dumps({'kind': 'settlement'})), fetch=False)
p_id = str(uuid.uuid4())
as_user('surya', 'insert into public.payments (id, group_id, settlement_id, data) values (%s, %s, %s, %s)',
        (p_id, g, s_id, json.dumps({'id': p_id})), fetch=False)
as_user('ravi', 'delete from public.transfers where id = %s', (s_id,), fetch=False)
check(one('surya', 'select count(*) from public.payments where id = %s', (p_id,)) == 0,
      'deleting an overall settle-up removes its group payments')

# --- Invite code reset ---------------------------------------------------------------
new_code = one('surya', 'select public.reset_invite_code(%s)', (g,))
check(new_code != code and one('priya', 'select public.group_preview(%s)', (code,)) is None,
      'resetting the invite code retires the old link')
check(fails('priya', 'select public.merge_person(%s, %s)', (me_p, me_s)), 'merge_person cannot be called from the app')
check(fails('priya', 'select public.person_for_account(%s)', (U['surya'],)), 'person_for_account cannot be called from the app')
check(fails('priya', 'insert into public.contacts (owner, person_id) values (%s, %s)', (U['priya'], me_x)),
      'friends lists cannot be written directly')

# --- Group deletion by creator cascades ----------------------------------------------
as_user('surya', 'delete from public.groups where id = %s', (g,), fetch=False)
check(len(as_user('surya', 'select * from public.expenses')) == 0, 'deleting a group removes its expenses')

print(f'\nAll {passed} checks passed.')
