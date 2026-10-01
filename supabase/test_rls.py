"""Scenario test for supabase/schema.sql row level security and functions.

Runs against a local Postgres with a Supabase-like auth stub. Each `as_user`
call runs in its own transaction as the `authenticated` role with the given
user id, exactly how Supabase evaluates policies for a signed-in user.
"""
import json
import uuid
import psycopg2

conn = psycopg2.connect(host='/tmp', port=5433, user='postgres', dbname='ck')
conn.autocommit = False

U = {n: str(uuid.uuid4()) for n in ['surya', 'ravi', 'priya', 'stranger']}
with conn.cursor() as c:
    c.execute('truncate public.payments, public.expenses, public.transfers, public.groups, public.people cascade')
    c.execute('delete from auth.users')
    for n, i in U.items():
        c.execute('insert into auth.users (id, email) values (%s, %s)', (i, f'{n}@example.com'))
conn.commit()


def as_user(name, sql, params=None, fetch=True):
    with conn.cursor() as c:
        try:
            c.execute('set local role authenticated')
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (U[name],))
            c.execute(sql, params)
            rows = c.fetchall() if fetch and c.description else None
            conn.commit()
            return rows
        except Exception:
            conn.rollback()
            raise


def fails(name, sql, params=None):
    try:
        as_user(name, sql, params)
        return False
    except psycopg2.Error:
        return True


passed = 0


def check(cond, msg):
    global passed
    assert cond, msg
    passed += 1
    print('  ok:', msg)


# --- Everyone signs in once -------------------------------------------------
me_s = as_user('surya', 'select id from public.ensure_me(%s)', ('Surya',))[0][0]
me_p = as_user('priya', 'select id from public.ensure_me(%s)', ('Priya',))[0][0]
as_user('stranger', 'select id from public.ensure_me(%s)', ('Stranger',))
check(as_user('surya', 'select id from public.ensure_me(%s)', ('Other name',))[0][0] == me_s,
      'ensure_me returns the same person on later sign-ins')

# --- Surya adds Ravi by name (placeholder) and creates a group ---------------
ravi_ph = str(uuid.uuid4())
as_user('surya', 'insert into public.people (id, name) values (%s, %s)', (ravi_ph, 'Ravi'), fetch=False)
g = str(uuid.uuid4())
as_user('surya', 'insert into public.groups (id, name, member_ids, base_currency, rates) values (%s, %s, %s::uuid[], %s, %s)',
        (g, 'Thailand trip', [me_s, ravi_ph, me_p], 'INR', json.dumps({'THB': 2.87})), fetch=False)
exp_id = str(uuid.uuid4())
expense = {'id': exp_id, 'groupId': g, 'description': 'Hostel', 'currency': 'THB', 'amount': 600000,
           'payers': {ravi_ph: 600000}, 'shares': {me_s: 200000, ravi_ph: 200000, me_p: 200000},
           'participants': [me_s, ravi_ph, me_p], 'splitType': 'equal', 'inputs': {}, 'date': 'x', 'createdAt': 'x'}
as_user('surya', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)', (exp_id, g, json.dumps(expense)), fetch=False)

check(len(as_user('surya', 'select * from public.groups')) == 1, 'creator sees the group')
check(len(as_user('priya', 'select * from public.groups')) == 1, 'a member added by the creator sees the group')
check(len(as_user('priya', 'select * from public.expenses')) == 1, 'members see the group expenses')
check(len(as_user('stranger', 'select * from public.groups')) == 0, 'a stranger cannot see the group')
check(len(as_user('stranger', 'select * from public.expenses')) == 0, 'a stranger cannot see its expenses')
check(fails('stranger', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)',
            (str(uuid.uuid4()), g, '{}')), 'a stranger cannot add expenses to the group')
check(len(as_user('stranger', 'select * from public.people')) == 1, 'a stranger only sees themselves in people')
names_p = sorted(r[0] for r in as_user('priya', 'select name from public.people'))
check(names_p == ['Priya', 'Ravi', 'Surya'], 'members see everyone in their groups, including placeholders')
check(fails('priya', 'update public.groups set invite_code = %s where id = %s', ('hack', g)),
      'members cannot change the invite code directly')
check(fails('priya', 'delete from public.groups where id = %s returning id', (g,)) or
      len(as_user('surya', 'select * from public.groups')) == 1, 'only the creator can delete the group')
check(fails('stranger', "update public.people set user_id = %s where id = %s", (U['stranger'], ravi_ph)),
      'nobody can attach their account to a placeholder directly')

# --- A transfer outside groups ----------------------------------------------
t_id = str(uuid.uuid4())
as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
        (t_id, me_s, ravi_ph, json.dumps({'id': t_id, 'kind': 'transfer', 'from': me_s, 'to': ravi_ph,
                                            'currency': 'INR', 'amount': 150000})), fetch=False)
check(len(as_user('surya', 'select * from public.transfers')) == 1, 'the creator sees their transfer')
check(len(as_user('priya', 'select * from public.transfers')) == 0, 'other group members do not see private transfers')

# --- Ravi signs up and opens the invite link ---------------------------------
code = as_user('surya', 'select invite_code from public.groups where id = %s', (g,))[0][0]
me_r = as_user('ravi', 'select id from public.ensure_me(%s)', ('Ravi K',))[0][0]
prev = as_user('ravi', 'select public.group_preview(%s)', (code,))[0][0]
check(prev['name'] == 'Thailand trip' and not prev['is_member'], 'invite preview shows the group to a non-member')
unclaimed = [m for m in prev['members'] if not m['claimed']]
check([m['id'] for m in unclaimed] == [ravi_ph], 'preview lists the unclaimed placeholder to pick')
check(as_user('ravi', 'select public.group_preview(%s)', ('nope',))[0][0] is None, 'a wrong code shows nothing')
check(len(as_user('ravi', 'select * from public.groups')) == 0, 'before joining, Ravi cannot see the group')

as_user('ravi', 'select public.join_group(%s, %s)', (code, ravi_ph))
check(len(as_user('ravi', 'select * from public.groups')) == 1, 'after claiming, Ravi sees the group')
data = as_user('ravi', 'select data from public.expenses where id = %s', (exp_id,))[0][0]
check(me_r in data['payers'] and ravi_ph not in json.dumps(data), "the expense now uses Ravi's real account")
check(as_user('surya', 'select count(*) from public.people where id = %s', (ravi_ph,))[0][0] == 0,
      'the placeholder is gone')
mem = as_user('surya', 'select member_ids from public.groups where id = %s', (g,))[0][0]
check(me_r in mem and ravi_ph not in mem, 'group membership points at Ravi')
tr = as_user('ravi', 'select from_person, to_person, data from public.transfers')
check(len(tr) == 1 and tr[0][1] == me_r and tr[0][2]['to'] == me_r, "Surya's cash transfer moved to Ravi's account and he sees it")
linked = as_user('surya', 'select user_id is not null from public.people where id = %s', (me_r,))[0][0]
check(linked, 'Surya now sees Ravi as a real account')
check(fails('surya', 'update public.people set name = %s where id = %s returning id', ('Not Ravi', me_r)) or
      as_user('surya', 'select name from public.people where id = %s', (me_r,))[0][0] == 'Ravi K',
      "Surya cannot rename Ravi's real account")

# joining again is harmless; claiming a taken person fails
check(as_user('ravi', 'select public.join_group(%s, null)', (code,))[0][0] == g, 'joining twice is harmless')
check(fails('stranger', 'select public.join_group(%s, %s)', (code, me_r)), 'nobody can claim a real account')

# --- The stranger joins as a new member -------------------------------------
as_user('stranger', 'select public.join_group(%s, null)', (code,))
check(len(as_user('stranger', 'select * from public.expenses')) == 1, 'joining as new gives access to the group')
check(len(as_user('stranger', 'select * from public.transfers')) == 0, 'but not to private transfers')

# --- Settle-up payments cascade with their settlement ------------------------
s_id = str(uuid.uuid4())
as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
        (s_id, me_r, me_s, json.dumps({'kind': 'settlement'})), fetch=False)
p_id = str(uuid.uuid4())
as_user('surya', 'insert into public.payments (id, group_id, settlement_id, data) values (%s, %s, %s, %s)',
        (p_id, g, s_id, json.dumps({'id': p_id})), fetch=False)
as_user('ravi', 'delete from public.transfers where id = %s', (s_id,), fetch=False)
check(as_user('surya', 'select count(*) from public.payments where id = %s', (p_id,))[0][0] == 0,
      'deleting an overall settle-up removes its group payments')

# --- Invite code reset -------------------------------------------------------
new_code = as_user('surya', 'select public.reset_invite_code(%s)', (g,))[0][0]
check(new_code != code and as_user('priya', 'select public.group_preview(%s)', (code,))[0][0] is None,
      'resetting the invite code retires the old link')
check(fails('priya', 'select public.merge_person(%s, %s)', (me_p, me_s)), 'merge_person cannot be called from the app')

# --- Group deletion by creator cascades -------------------------------------
as_user('surya', 'delete from public.groups where id = %s', (g,), fetch=False)
check(len(as_user('surya', 'select * from public.expenses')) == 0, 'deleting a group removes its expenses')

print(f'\nAll {passed} checks passed.')
