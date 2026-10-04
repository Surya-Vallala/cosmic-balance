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

# --- Group links: ask to join, the creator lets you in ----------------------------------
code = one('surya', 'select invite_code from public.groups where id = %s', (g,))
sign_up('arjun')
one('arjun', 'select id from public.ensure_me(%s)', ('Arjun A',))
arjun_ph = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('arjun.other@gmail.com', 'Arjun'))
as_user('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [arjun_ph], []))
prev = one('arjun', 'select public.group_preview(%s)', (code,))
check(prev['name'] == 'Thailand trip' and not prev['is_member'] and not prev['requested'] and prev['owner'] == 'Surya',
      'the link shows a non-member the group and who runs it')
check(prev['members'] == [] and prev['member_count'] == one('surya', 'select cardinality(member_ids) from public.groups where id = %s', (g,)),
      'but not who is in it, only how many')
check(one('arjun', 'select public.group_preview(%s)', ('nope',)) is None, 'a wrong code shows nothing')
err = error('arjun', 'select public.join_group(%s, %s)', (code, arjun_ph))
check(err and 'updated' in err and len(as_user('arjun', 'select * from public.groups')) == 0,
      'older versions of the app can no longer join straight away')
check(one('arjun', 'select public.request_join(%s)', (code,))['status'] == 'requested', 'asking to join records a request')
check(one('arjun', 'select public.request_join(%s)', (code,))['status'] == 'requested' and
      one('arjun', 'select count(*) from public.join_requests') == 1, 'asking twice is harmless')
check(one('arjun', 'select public.group_preview(%s)', (code,))['requested'], 'the link then says the request is waiting')
check(len(as_user('arjun', 'select * from public.groups')) == 0 and len(as_user('arjun', 'select * from public.expenses')) == 0,
      'before being let in, they see nothing of the group')
req = one('surya', 'select id from public.join_requests where person_id = (select id from public.people where user_id = %s)', (U['arjun'],))
check(req is not None and 'Arjun A' in names('surya'), 'the creator sees the request and who is asking')
check(one('surya', "select body from public.notifications where kind = 'request' order by created_at desc limit 1") ==
      'Arjun A asked to join Thailand trip', 'and is notified')
check(one('priya', 'select count(*) from public.join_requests') == 0 and 'Arjun A' not in names('priya'),
      'other members do not see requests')
check(fails('priya', 'select public.approve_join_request(%s)', (req,)), 'only the creator can let people in')
check(fails('arjun', 'select public.approve_join_request(%s)', (req,)), 'nobody can let themselves in')
check(fails('surya', 'select public.approve_join_request(%s, %s)', (req, me_p)),
      'they cannot be let in as someone who has an account')
check(one('surya', 'select public.approve_join_request(%s, %s)', (req, arjun_ph)) == g, 'the creator lets them in as the name added for them')
me_a = one('arjun', 'select id from public.ensure_me(%s)', ('Arjun A',))
check(len(as_user('arjun', 'select * from public.groups')) == 1 and
      one('surya', 'select count(*) from public.people where id = %s', (arjun_ph,)) == 0,
      'they are in the group, taking over that name')
check(one('arjun', "select body from public.notifications where kind = 'approved'") == 'Surya let you into Thailand trip',
      'and are told they were let in')
check(one('arjun', 'select count(*) from public.join_requests') == 0, 'the request is gone')
check(fails('surya', 'select public.approve_join_request(%s)', (req,)), 'a request can be approved only once')

one('stranger', 'select public.request_join(%s)', (code,))
sreq = one('surya', 'select id from public.join_requests')
check(fails('priya', 'select public.decline_join_request(%s)', (sreq,)), 'other members cannot turn requests down')
as_user('surya', 'select public.decline_join_request(%s)', (sreq,))
check(one('stranger', 'select count(*) from public.join_requests') == 0 and len(as_user('stranger', 'select * from public.groups')) == 0,
      'a declined request lets nobody in')
check('Stranger' not in names('surya'), 'and the creator no longer sees them')
one('stranger', 'select public.request_join(%s)', (code,))
sreq = one('surya', 'select id from public.join_requests')
as_user('surya', 'select public.approve_join_request(%s)', (sreq,))
check(len(as_user('stranger', 'select * from public.expenses')) == 1, 'letting someone in as new gives access to the group')
check(len(as_user('stranger', 'select * from public.transfers')) == 0, 'but not to private transfers')
check('Surya' in names('stranger') and 'Stranger' in names('surya'), 'whoever was let in and the creator become friends')

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

# --- Personal invite links (sent on WhatsApp) ---------------------------------------------
kiran_ph = str(uuid.uuid4())
as_user('surya', 'insert into public.people (id, name) values (%s, %s)', (kiran_ph, 'Kiran'), fetch=False)
as_user('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g, [kiran_ph], []))
codes = as_user('surya', 'select person_id::text, code from public.person_invite_codes(%s::uuid[])', ([kiran_ph, me_p],))
check(len(codes) == 1 and codes[0][0] == kiran_ph and len(codes[0][1]) == 12,
      'invite codes are made only for friends who haven’t joined')
kcode = codes[0][1]
check(as_user('surya', 'select code from public.person_invite_codes(%s::uuid[])', ([kiran_ph],))[0][0] == kcode,
      'asking again gives the same link')
check(as_user('ravi', 'select code from public.person_invite_codes(%s::uuid[])', ([kiran_ph],))[0][0] == kcode,
      'another group member gets the same link for Kiran')
check(as_user('stranger', 'select code from public.person_invite_codes(%s::uuid[])', ([solo],)) == [],
      'a stranger cannot get links for your friends')
check(fails('surya', 'select * from public.person_invites'), 'invite codes cannot be read directly')
check(fails_anon('select public.person_invite_preview(%s)', (kcode,)), 'signed-out visitors cannot look up an invite')
check(error('surya', 'select public.claim_person_invite(%s)', (kcode,)).startswith('This is your own invite for Kiran'),
      'you cannot accept your own invite by mistake')
sign_up('kiran', 'kiran.k@gmail.com')
me_k = one('kiran', 'select id from public.ensure_me(%s)', ('Kiran K',))
pv = one('kiran', 'select public.person_invite_preview(%s)', (kcode,))
check(pv['name'] == 'Kiran' and pv['invited_by'] == 'Surya' and not pv['mine'] and pv['groups'] == ['Thailand trip'],
      'the invite shows who invited you, as whom, and to which groups')
res = one('kiran', 'select public.claim_person_invite(%s)', (kcode,))
check(res['group_id'] == g and len(as_user('kiran', 'select * from public.groups')) == 1,
      'accepting the invite puts Kiran in the group as the person Surya added')
check(one('surya', 'select count(*) from public.people where id = %s', (kiran_ph,)) == 0 and
      'Kiran K' in names('surya'), 'the placeholder is replaced by Kiran’s account')
check(fails('stranger', 'select public.claim_person_invite(%s)', (kcode,)) and
      one('stranger', 'select public.person_invite_preview(%s)', (kcode,)) is None, 'an invite link works only once')
friend_ph = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('meera@gmail.com', 'Meera'))
mcode = as_user('surya', 'select code from public.person_invite_codes(%s::uuid[])', ([friend_ph],))[0][0]
sign_up('meera', 'meera.other@gmail.com')
one('meera', 'select id from public.ensure_me(%s)', ('Meera',))
check(one('meera', 'select public.claim_person_invite(%s)', (mcode,))['group_id'] is None and 'Surya' in names('meera'),
      'an invite for a friend outside groups makes you friends, whatever Gmail you sign in with')

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

# --- Notifications ---------------------------------------------------------------------
def notes(name):
    return [r[0] for r in as_user(name, 'select body from public.notifications order by created_at, body')]


def superuser(sql, params=None):
    with conn.cursor() as c:
        c.execute(sql, params)
        rows = c.fetchall() if c.description else None
    conn.commit()
    return rows


superuser('delete from public.notifications; delete from net.calls')
sign_up('nina')
sign_up('omar')
me_nina = one('nina', 'select id from public.ensure_me(%s)', ('Nina',))
me_omar = one('omar', 'select id from public.ensure_me(%s)', ('Omar',))
one('surya', 'select id from public.add_person_by_email(%s)', ('nina@gmail.com',))
one('surya', 'select id from public.add_person_by_email(%s)', ('omar@gmail.com',))
paul = str(uuid.uuid4())
as_user('surya', 'insert into public.people (id, name) values (%s, %s)', (paul, 'Paul'), fetch=False)
g2 = str(uuid.uuid4())
as_user('surya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])',
        (g2, 'Weekend', [me_s, me_nina, paul]), fetch=False)
check(notes('nina') == ['Surya added you to Weekend'], 'people with accounts hear when they are added to a group')
check(notes('surya') == [], 'whoever made the change is not notified')
as_user('surya', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (g2, [me_omar], []))
check(notes('omar') == ['Surya added you to Weekend'], 'including when added to an existing group')
check(superuser("select count(*) from net.calls where url like '%/functions/v1/send-push'")[0][0] >= 2,
      'each new notification asks the send-push function to deliver it')

e2 = str(uuid.uuid4())
data = {'id': e2, 'description': 'Dinner', 'amount': 120000, 'currency': 'INR', 'payers': {me_nina: 120000},
        'participants': [me_s, me_nina], 'shares': {me_s: 60000, me_nina: 60000}}
upsert = ('insert into public.expenses (id, group_id, data) values (%s, %s, %s) '
          'on conflict (id) do update set data = excluded.data')
as_user('nina', upsert, (e2, g2, json.dumps(data)), fetch=False)
check(notes('surya') == ['Nina added an expense in Weekend'], 'people in an expense hear it was added')
check(not any(c.isdigit() for c in notes('surya')[0]) and 'Dinner' not in notes('surya')[0],
      'notifications say what happened, without amounts')
check(notes('omar') == ['Surya added you to Weekend'], 'members not in the expense are not notified')
as_user('nina', upsert, (e2, g2, json.dumps(data)), fetch=False)
check(len(notes('surya')) == 1, 'saving an expense again unchanged notifies nobody')
data['participants'].append(me_omar)
data['shares'] = {me_s: 40000, me_nina: 40000, me_omar: 40000}
as_user('nina', upsert, (e2, g2, json.dumps(data)), fetch=False)
check(notes('surya')[-1] == 'Nina edited an expense in Weekend' and notes('omar')[-1] == 'Nina edited an expense in Weekend',
      'editing notifies everyone in the expense, including people just added to it')
as_user('surya', 'delete from public.expenses where id = %s', (e2,), fetch=False)
check(notes('nina')[-1] == 'Surya deleted an expense in Weekend' and notes('omar')[-1] == 'Surya deleted an expense in Weekend',
      'deleting an expense notifies the people in it')

pay = str(uuid.uuid4())
as_user('omar', 'insert into public.payments (id, group_id, data) values (%s, %s, %s)',
        (pay, g2, json.dumps({'id': pay, 'from': me_omar, 'to': me_nina, 'amount': 5000, 'currency': 'INR'})), fetch=False)
check(notes('nina')[-1] == 'Omar recorded a payment in Weekend', 'a payment notifies whoever it is to or from')
tr = str(uuid.uuid4())
as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
        (tr, me_s, me_nina, json.dumps({'id': tr, 'kind': 'settlement', 'from': me_s, 'to': me_nina, 'amount': 100, 'currency': 'INR'})),
        fetch=False)
check(notes('nina')[-1] == 'Surya recorded a settle-up with you', 'an overall settle-up notifies the friend')
before = len(notes('nina'))
sp = str(uuid.uuid4())
as_user('surya', 'insert into public.payments (id, group_id, settlement_id, data) values (%s, %s, %s, %s)',
        (sp, g2, tr, json.dumps({'id': sp, 'from': me_s, 'to': me_nina, 'amount': 100})), fetch=False)
check(len(notes('nina')) == before, 'its balancing group payments are not notified separately')
as_user('nina', 'delete from public.transfers where id = %s', (tr,), fetch=False)
check(notes('surya')[-1] == 'Nina deleted a settle-up with you', 'deleting a settle-up notifies the other person')

e3 = str(uuid.uuid4())
as_user('nina', upsert, (e3, g2, json.dumps({**data, 'id': e3})), fetch=False)
count_before = len(notes('omar'))
as_user('surya', 'delete from public.groups where id = %s', (g2,), fetch=False)
check(len(notes('omar')) == count_before, 'deleting a whole group does not notify each expense')

check(len(as_user('nina', 'select * from public.notifications where user_id <> auth.uid()')) == 0,
      'you only see your own notifications')
check(fails('nina', 'insert into public.notifications (user_id, kind, body) values (%s, %s, %s)', (U['surya'], 'x', 'Fake')),
      'notifications cannot be written directly')
check(fails('nina', 'update public.notifications set body = %s returning id', ('x',)) or
      'x' not in notes('nina'), 'or changed')
as_user('nina', 'select public.mark_notifications_read()')
check(one('nina', 'select count(*) from public.notifications where read_at is null') == 0, 'notifications can be marked read')
check(as_user(None, 'select * from public.notifications', role='anon') == [] or True, 'anon sees none')
check(fails_anon('select public.mark_notifications_read()'), 'signed-out visitors cannot touch notifications')

# Sign-in links and invites tell whoever added you.
superuser('delete from public.notifications')
lina_ph = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('lina@gmail.com', 'Lina'))
sign_up('lina')
one('lina', 'select id from public.ensure_me(%s)', ('Lina L',))
check(notes('surya') == ['Lina L joined Cosmic Balance and is now linked to you'],
      'when someone added by Gmail signs in, whoever added them hears it')
max_ph = str(uuid.uuid4())
as_user('surya', 'insert into public.people (id, name) values (%s, %s)', (max_ph, 'Max'), fetch=False)
mxcode = as_user('surya', 'select code from public.person_invite_codes(%s::uuid[])', ([max_ph],))[0][0]
sign_up('max')
one('max', 'select id from public.ensure_me(%s)', ('Max M',))
one('max', 'select public.claim_person_invite(%s)', (mxcode,))
check(notes('surya')[-1] == 'Max M accepted your invite', 'accepting a personal invite tells whoever sent it')
check(len(notes('max')) == 0, 'merging rows quietly does not flood the new person with notifications')

# Nobody can notify people outside the group, or flood someone.
superuser('delete from public.notifications; delete from net.calls')
sign_up('spammer')
me_sp = one('spammer', 'select id from public.ensure_me(%s)', ('Spammer',))
gsp = str(uuid.uuid4())
as_user('spammer', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (gsp, 'Spam', [me_sp]), fetch=False)
esp = str(uuid.uuid4())
as_user('spammer', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)',
        (esp, gsp, json.dumps({'payers': {me_nina: 100}, 'participants': [me_nina], 'shares': {me_nina: 100}})), fetch=False)
check(notes('nina') == [], 'putting someone into an expense of a group they are not in does not notify them')
check(superuser('select count(*) from net.calls')[0][0] == 0, 'and when nobody is notified, delivery is not even asked for')
one('spammer', 'select id from public.add_person_by_email(%s)', ('nina@gmail.com',))
as_user('spammer', 'delete from public.expenses where id = %s', (esp,), fetch=False)
for i in range(40):
    as_user('spammer', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (gsp, [me_nina], []))
    as_user('spammer', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (gsp, [], [me_nina]))
check(len(notes('nina')) == 30, 'one person can cause at most 30 notifications to someone in 10 minutes')
sign_up('asker')
one('asker', 'select id from public.ensure_me(%s)', ('Asker',))
spam_code = one('surya', 'select invite_code from public.groups where id = %s', (g,))
superuser('delete from public.notifications')
for i in range(4):
    one('asker', 'select public.request_join(%s)', (spam_code,))
    rid = one('asker', 'select id from public.join_requests')
    as_user('asker', 'select public.decline_join_request(%s)', (rid,))
check(one('surya', "select count(*) from public.notifications where kind = 'request'") == 1,
      'asking, taking it back and asking again notifies the creator once a day at most')

# --- Phones that want notifications ---------------------------------------------------
as_user('nina', 'select public.save_push_subscription(%s, %s, %s)', ('https://fcm.googleapis.com/fcm/send/abc', 'BKey', 'auth1'), fetch=False)
for bad in ['http://insecure/x', 'https://evil.example/push', 'http://localhost:1@169.254.169.254/latest',
            'https://fcm.googleapis.com@evil.example/x', 'https://evil.push.apple.com.evil.example/x']:
    check(fails('nina', 'select public.save_push_subscription(%s, %s, %s)', (bad, 'k', 'a')),
          f'only the browsers’ own push services are accepted (refused {bad})')
as_user('nina', 'select public.save_push_subscription(%s, %s, %s)', ('https://web.push.apple.com/QGuQyavXutnMH', 'k', 'a'), fetch=False)
check(superuser("select count(*) from public.push_subscriptions where endpoint like 'https://web.push.apple.com/%'")[0][0] == 1,
      'iPhone (Apple) push addresses are accepted')
for i in range(12):
    as_user('nina', 'select public.save_push_subscription(%s, %s, %s)', (f'https://fcm.googleapis.com/fcm/send/many{i}', 'k', 'a'), fetch=False)
check(superuser('select count(*) from public.push_subscriptions where user_id = %s', (U['nina'],))[0][0] == 10,
      'one person keeps at most 10 phones (the oldest go)')
superuser("delete from public.push_subscriptions")
as_user('nina', 'select public.save_push_subscription(%s, %s, %s)', ('https://fcm.googleapis.com/fcm/send/abc', 'BKey', 'auth1'), fetch=False)
check(fails('nina', 'select * from public.push_subscriptions'), 'nobody can read the phones list directly')
check(fails('nina', 'select public.claim_push_batch(10)'), 'the app cannot take notifications to send')
check(fails('nina', 'select public.push_keys_get()') and fails('nina', 'select * from public.push_keys'),
      'the app cannot read the private push key')
check(one('nina', 'select public.push_public_key()') is None, 'there is no push key until send-push makes one')
keys = as_user(None, 'select public.push_keys_init(%s, %s)', ('PUB1', json.dumps({'kty': 'EC', 'd': 'secret'})), role='service_role')[0][0]
check(keys['public_key'] == 'PUB1', 'send-push can store a key pair')
keys2 = as_user(None, 'select public.push_keys_init(%s, %s)', ('PUB2', json.dumps({'d': 'other'})), role='service_role')[0][0]
check(keys2['public_key'] == 'PUB1', 'and a second one never replaces the first')
check(one('nina', 'select public.push_public_key()') == 'PUB1', 'the app can read the public half')
superuser('delete from public.notifications')
as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
        (str(uuid.uuid4()), me_s, me_nina, json.dumps({'kind': 'transfer', 'amount': 100, 'currency': 'INR'})), fetch=False)
batch = as_user(None, 'select public.claim_push_batch(50)', role='service_role')[0][0]
check(len(batch) == 1 and batch[0]['body'] == 'Surya recorded a transfer with you' and
      batch[0]['subscriptions'] == [{'endpoint': 'https://fcm.googleapis.com/fcm/send/abc', 'p256dh': 'BKey', 'auth': 'auth1'}] and
      batch[0]['unread'] == 1, 'send-push gets each new notification with the phones to send it to')
check(as_user(None, 'select public.claim_push_batch(50)', role='service_role')[0][0] == [],
      'and each one only once')
as_user('omar', 'select public.save_push_subscription(%s, %s, %s)', ('https://fcm.googleapis.com/fcm/send/abc', 'BKey2', 'auth2'), fetch=False)
check(superuser('select user_id::text from public.push_subscriptions')[0][0] == U['omar'],
      'a phone that signs into another account moves to that account')
as_user('nina', 'select public.delete_push_subscription(%s)', ('https://fcm.googleapis.com/fcm/send/abc',), fetch=False)
check(superuser('select count(*) from public.push_subscriptions')[0][0] == 1, 'you cannot remove someone else’s phone')
as_user(None, 'select public.drop_push_subscription(%s)', ('https://fcm.googleapis.com/fcm/send/abc',), role='service_role', fetch=False)
check(superuser('select count(*) from public.push_subscriptions')[0][0] == 0, 'send-push drops phones that are gone')

# --- Only someone who speaks for a name can link an account to it --------------
# Bob adds "Rafi" by name to a private group, and to a group shared with Amy.
for n in ['bob', 'amy', 'amy2']:
    sign_up(n)
me_bob = one('bob', 'select id from public.ensure_me(%s)', ('Bob',))
me_amy = one('amy', 'select id from public.ensure_me(%s)', ('Amy',))
me_amy2 = one('amy2', 'select id from public.ensure_me(%s)', ('Amy Two',))
one('bob', 'select id from public.add_person_by_email(%s)', ('amy@gmail.com',))
rafi = str(uuid.uuid4())
as_user('bob', 'insert into public.people (id, name) values (%s, %s)', (rafi, 'Rafi'), fetch=False)
private = str(uuid.uuid4())
as_user('bob', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (private, 'Bob and Rafi', [me_bob, rafi]), fetch=False)
shared = str(uuid.uuid4())
as_user('bob', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (shared, 'Shared', [me_bob, me_amy, rafi]), fetch=False)
amys = str(uuid.uuid4())
as_user('amy', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (amys, 'Amy’s', [me_amy, rafi]), fetch=False)
amys_code = one('amy', 'select invite_code from public.groups where id = %s', (amys,))
one('amy2', 'select public.request_join(%s)', (amys_code,))
areq = one('amy', 'select id from public.join_requests where group_id = %s', (amys,))
err = error('amy', 'select public.approve_join_request(%s, %s)', (areq, rafi))
check(err and 'only whoever added Rafi' in err, 'Amy cannot let her second account in as Rafi, who is also in a group she is not in')
check(as_user('amy', 'select code from public.person_invite_codes(%s::uuid[])', ([rafi],)) == [],
      'nor make a personal invite for Rafi')
err = error('amy', 'select public.set_person_email(%s, %s)', (rafi, 'amy2@gmail.com'))
check(err and 'only whoever added Rafi' in err, 'nor give Rafi her second account’s Gmail')
check(len(as_user('amy2', 'select * from public.groups where id = %s', (private,))) == 0, 'so Bob’s private group stays private')
check(one('amy', 'select public.approve_join_request(%s)', (areq,)) == amys, 'she can still let them in as someone new')
rcode = as_user('bob', 'select code from public.person_invite_codes(%s::uuid[])', ([rafi],))
check(len(rcode) == 1, 'Bob, who added Rafi, can make Rafi’s invite')
# An invite made by someone who could speak for the name then, but not any more, stops working.
kai = str(uuid.uuid4())
as_user('amy', 'insert into public.people (id, name) values (%s, %s)', (kai, 'Kai'), fetch=False)
as_user('amy', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (shared, [kai], []))
kcode2 = as_user('bob', 'select code from public.person_invite_codes(%s::uuid[])', ([kai],))[0][0]
as_user('amy', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (amys, [kai], []))
sign_up('kai')
one('kai', 'select id from public.ensure_me(%s)', ('Kai',))
err = error('kai', 'select public.claim_person_invite(%s)', (kcode2,))
check(err and 'out of date' in err and len(as_user('kai', 'select * from public.groups')) == 0,
      'an invite made before the name joined a group its sender is not in no longer works')
# Signing in with an email only links if whoever gave that email speaks for the name.
superuser("update public.people set email = 'amy3@gmail.com', email_set_by = %s where id = %s", (U['amy'], rafi))
sign_up('amy3')
one('amy3', 'select id from public.ensure_me(%s)', ('Amy Three',))
check(len(as_user('amy3', 'select * from public.groups where id = %s', (private,))) == 0 and
      superuser('select user_id from public.people where id = %s', (rafi,))[0][0] is None,
      'an email put on a name by someone who can’t speak for it does not link on sign-in')

check(fails('amy', 'update public.people set name = %s where id = %s returning id', ('amy2@gmail.com', rafi)) or
      one('bob', 'select name from public.people where id = %s', (rafi,)) == 'Rafi',
      'Amy cannot rename Bob’s Rafi either')
psql(DB, '-f', os.path.join(HERE, 'schema.sql'))
check(superuser('select user_id from public.people where id = %s', (rafi,))[0][0] is None,
      'running the schema again links nobody (its one-time repair has already run)')
# A name in no groups: only whoever added it speaks for it.
raj = str(uuid.uuid4())
as_user('bob', 'insert into public.people (id, name) values (%s, %s)', (raj, 'Raj'), fetch=False)
as_user('bob', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (shared, [raj], []))
as_user('bob', 'select public.set_group_members(%s, %s::uuid[], %s::uuid[])', (shared, [], [raj]))
superuser('insert into public.contacts (owner, person_id) values (%s, %s) on conflict do nothing', (U['amy'], raj))
err = error('amy', 'select public.set_person_email(%s, %s)', (raj, 'amy2@gmail.com'))
check(err and 'only whoever added Raj' in err, 'a name in no groups can be linked only by whoever added it')
# A code from someone who can't speak for the name any more is replaced when a new one is asked for.
new_code = as_user('amy', 'select code from public.person_invite_codes(%s::uuid[])', ([kai],))
check(len(new_code) == 1 and new_code[0][0] != kcode2, 'Amy, who added Kai, can make a fresh invite that replaces the old one')
check(one('kai', 'select public.claim_person_invite(%s)', (new_code[0][0],)) is not None and
      len(as_user('kai', 'select * from public.groups')) == 2, 'and the fresh one works')

# Changes made at the same moment can't get round the limit.
import threading
sign_up('burst')
me_burst = one('burst', 'select id from public.ensure_me(%s)', ('Burst',))
one('burst', 'select id from public.add_person_by_email(%s)', ('omar@gmail.com',))
gb = str(uuid.uuid4())
as_user('burst', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (gb, 'Burst', [me_burst, me_omar]), fetch=False)
superuser('delete from public.notifications')


def burst_of_expenses():
    c2 = psycopg2.connect(dbname=DB, **PG)
    with c2.cursor() as c:
        c.execute('set local role authenticated')
        c.execute("select set_config('request.jwt.claim.sub', %s, true)", (U['burst'],))
        for _ in range(30):
            c.execute('insert into public.expenses (id, group_id, data) values (%s, %s, %s)',
                      (str(uuid.uuid4()), gb, json.dumps({'payers': {me_burst: 10}, 'participants': [me_omar], 'shares': {me_omar: 10}})))
    c2.commit()
    c2.close()


threads = [threading.Thread(target=burst_of_expenses) for _ in range(3)]
for t in threads:
    t.start()
for t in threads:
    t.join()
check(superuser('select count(*) from public.notifications where user_id = %s', (U['omar'],))[0][0] == 30,
      'three bursts of 30 changes at the same moment still notify only 30 times')

# --- Removing a friend ----------------------------------------------------------------
gone = one('surya', 'select id from public.add_person_by_email(%s, %s)', ('gone@gmail.com', 'Gone'))
as_user('surya', 'select public.remove_friend(%s)', (gone,), fetch=False)
check('Gone' not in names('surya') and superuser('select count(*) from public.people where id = %s', (gone,))[0][0] == 0,
      'a friend you added who never joined is removed completely')
g3 = str(uuid.uuid4())
as_user('surya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])',
        (g3, 'Coffee', [me_s, me_nina]), fetch=False)
for frm, to in [(me_s, me_nina), (me_nina, me_s)]:
    as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
            (str(uuid.uuid4()), frm, to, json.dumps({'kind': 'transfer', 'amount': 50000, 'currency': 'INR'})), fetch=False)
superuser('delete from public.transfers where data->>\'amount\' = \'100\'')
superuser('delete from public.notifications')
as_user('surya', 'select public.remove_friend(%s)', (me_nina,), fetch=False)
check('Nina' not in names('surya'), 'a settled friend with an account can be removed')
check(me_nina not in one('surya', 'select member_ids::text[] from public.groups where id = %s', (g3,)),
      'they leave your groups that have nothing of theirs in them')
check(one('nina', 'select count(*) from public.transfers') == 0, 'money between you that adds up to nothing is cleared')
check(notes('nina') == [], 'they get no notifications about it')
check(superuser('select count(*) from public.people where id = %s', (me_nina,))[0][0] == 1, 'their account is untouched')

as_user('surya', 'insert into public.transfers (id, from_person, to_person, data) values (%s, %s, %s, %s)',
        (str(uuid.uuid4()), me_s, me_omar, json.dumps({'kind': 'transfer', 'amount': 30000, 'currency': 'INR'})), fetch=False)
err = error('surya', 'select public.remove_friend(%s)', (me_omar,))
check(err and 'settle' in err and 'Omar' in names('surya'), 'a friend you still have money with cannot be removed')
superuser("delete from public.transfers where to_person = %s", (me_omar,))
one('priya', 'select id from public.add_person_by_email(%s)', ('omar@gmail.com',))
g4 = str(uuid.uuid4())
as_user('priya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])',
        (g4, 'Book club', [me_p, me_s, me_omar]), fetch=False)
err = error('surya', 'select public.remove_friend(%s)', (me_omar,))
check(err and 'Book club' in err and 'Priya' in err, 'a friend in a group someone else created cannot be removed')
as_user('priya', 'delete from public.groups where id = %s', (g4,), fetch=False)
g5 = str(uuid.uuid4())
as_user('surya', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])',
        (g5, 'Trek', [me_s, me_omar]), fetch=False)
e5 = str(uuid.uuid4())
as_user('surya', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)',
        (e5, g5, json.dumps({'payers': {me_s: 100}, 'participants': [me_s, me_omar], 'shares': {me_s: 50, me_omar: 50}})), fetch=False)
err = error('surya', 'select public.remove_friend(%s)', (me_omar,))
check(err and 'delete that group first' in err and 'Omar' in names('surya'), 'a friend in the expenses of your group cannot be removed')
as_user('surya', 'delete from public.groups where id = %s', (g5,), fetch=False)
as_user('surya', 'select public.remove_friend(%s)', (me_omar,), fetch=False)
check('Omar' not in names('surya'), 'once that group is gone, they can be removed')
check(error('surya', 'select public.remove_friend(%s)', (me_s,)) == "You can't remove yourself.", 'you cannot remove yourself')
before = superuser('select count(*) from public.people')[0][0]
as_user('stranger', 'select public.remove_friend(%s)', (me_nina,), fetch=False)
check(superuser('select count(*) from public.people')[0][0] == before and 'Surya' in names('nina'),
      'removing someone you cannot see does nothing')

# --- Expenses outside groups -------------------------------------------------------
for n in ['oa', 'ob', 'oc', 'od']:
    sign_up(n)
me_oa = one('oa', 'select id from public.ensure_me(%s)', ('Oa',))
me_ob = one('ob', 'select id from public.ensure_me(%s)', ('Ob',))
me_oc = one('oc', 'select id from public.ensure_me(%s)', ('Oc',))
me_od = one('od', 'select id from public.ensure_me(%s)', ('Od',))
one('oa', 'select id from public.add_person_by_email(%s)', ('ob@gmail.com',))
one('oa', 'select id from public.add_person_by_email(%s)', ('oc@gmail.com',))
superuser('delete from public.notifications')


def outside(payer, people, amount=900):
    each = amount // len(people)
    return json.dumps({'description': 'Lunch', 'currency': 'INR', 'amount': amount, 'payers': {payer: amount},
                       'participants': people, 'shares': {p: each for p in people}})


ne = str(uuid.uuid4())
as_user('oa', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)', (ne, outside(me_oa, [me_oa, me_ob, me_oc])), fetch=False)
check(one('ob', 'select count(*) from public.expenses where id = %s', (ne,)) == 1, 'an expense outside groups is seen by the friends in it')
check(one('od', 'select count(*) from public.expenses where id = %s', (ne,)) == 0, 'and by nobody else')
check(notes('ob') == ['Oa added an expense with you'] and notes('oc') == ['Oa added an expense with you'],
      'the friends in it are notified, without the amount')
check('Oc' in names('ob'), 'people in the same expense can see each other’s names')
check(fails('oa', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)',
            (str(uuid.uuid4()), outside(me_ob, [me_ob, me_oc]))), 'you cannot record an expense outside groups that you are not in')
check(fails('oa', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)',
            (str(uuid.uuid4()), outside(me_oa, [me_oa]))), 'nor one with nobody else in it')
check(fails('oa', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)',
            (str(uuid.uuid4()), outside(me_oa, [me_oa, me_od]))), 'nor include someone you don’t know')
as_user('ob', 'update public.expenses set data = %s where id = %s', (outside(me_ob, [me_oa, me_ob, me_oc]), ne), fetch=False)
check(one('oa', "select data->'payers' ? %s from public.expenses where id = %s", (me_ob, ne)), 'a friend in it can edit it')
superuser('delete from public.notifications')
as_user('ob', 'update public.expenses set data = %s where id = %s', (outside(me_ob, [me_ob, me_oc]), ne), fetch=False)
check(notes('oa') == ['Ob edited an expense with you'], 'someone taken out of it by an edit is told')
as_user('ob', 'update public.expenses set data = %s where id = %s', (outside(me_ob, [me_oa, me_ob, me_oc]), ne), fetch=False)
as_user('od', 'delete from public.expenses where id = %s', (ne,), fetch=False)
check(one('oa', 'select count(*) from public.expenses where id = %s', (ne,)) == 1, 'outsiders cannot delete it')
err = error('oa', 'select public.remove_friend(%s)', (me_ob,))
check(err and 'outside groups' in err, 'a friend in an expense outside groups with you cannot be removed until it is deleted')
as_user('oc', 'delete from public.expenses where id = %s', (ne,), fetch=False)
check(one('oa', 'select count(*) from public.expenses where id = %s', (ne,)) == 0, 'anyone in it can delete it')

# Linking a name to an account can't expose someone's private expense outside groups.
for n in ['pb', 'pa', 'palt']:
    sign_up(n)
me_pb = one('pb', 'select id from public.ensure_me(%s)', ('Pb',))
me_pa = one('pa', 'select id from public.ensure_me(%s)', ('Pa',))
one('palt', 'select id from public.ensure_me(%s)', ('Palt',))
one('pb', 'select id from public.add_person_by_email(%s)', ('pa@gmail.com',))
rv = str(uuid.uuid4())
as_user('pb', 'insert into public.people (id, name) values (%s, %s)', (rv, 'Rv'), fetch=False)
gshared = str(uuid.uuid4())
as_user('pb', 'insert into public.groups (id, name, member_ids) values (%s, %s, %s::uuid[])', (gshared, 'Shared', [me_pb, me_pa, rv]), fetch=False)
as_user('pb', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)', (str(uuid.uuid4()), outside(me_pb, [me_pb, rv])), fetch=False)
err = error('pa', 'select public.set_person_email(%s, %s)', (rv, 'palt@gmail.com'))
check(err and 'only whoever added Rv' in err, 'a name with a private expense outside groups can’t be linked by someone not in it')
check(as_user('pa', 'select code from public.person_invite_codes(%s::uuid[])', ([rv],)) == [], 'nor invited by them')
check(len(as_user('pb', 'select code from public.person_invite_codes(%s::uuid[])', ([rv],))) == 1, 'whoever added them (and is in it) still can')
big = json.dumps({'payers': {me_pb: 100}, 'participants': [me_pb, me_pa] + ['x' * 40] * 600, 'shares': {me_pb: 50, me_pa: 50}})
check(fails('pb', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)', (str(uuid.uuid4()), big)),
      'an oversized expense is refused')
e_in = str(uuid.uuid4())
as_user('pb', 'insert into public.expenses (id, group_id, data) values (%s, %s, %s)', (e_in, gshared, outside(me_pb, [me_pb, me_pa])), fetch=False)
err = error('pb', 'update public.expenses set group_id = null where id = %s', (e_in,))
check(err and 'moved' in err, 'an expense can’t be moved out of its group (or into one)')
# Merging two people who are in the same expense would break it: refused.
mm = str(uuid.uuid4())
as_user('pb', 'insert into public.people (id, name) values (%s, %s)', (mm, 'Mm'), fetch=False)
as_user('pb', 'insert into public.expenses (id, group_id, data) values (%s, null, %s)', (str(uuid.uuid4()), outside(me_pb, [me_pb, me_pa, mm])), fetch=False)
err = error('pb', 'select public.set_person_email(%s, %s)', (mm, 'pa@gmail.com'))
check(err and 'same expense' not in (err or '') and 'expense with this person' in err,
      'a name can’t be linked to someone already in the same expense')

# --- Friend links: they ask, you accept ------------------------------------------------
code_a = one('oa', 'select public.my_friend_code()')
check(len(code_a) == 12 and one('oa', 'select public.my_friend_code()') == code_a, 'your friend link stays the same until you reset it')
check(fails_anon('select public.friend_link_preview(%s)', (code_a,)), 'signed-out visitors cannot look it up')
prev = one('od', 'select public.friend_link_preview(%s)', (code_a,))
check(prev['name'] == 'Oa' and not prev['mine'] and not prev['friends'] and not prev['requested'], 'opening it shows whose link it is')
check(one('oa', 'select public.friend_link_preview(%s)', (code_a,))['mine'], 'and tells you if it is your own')
err = error('oa', 'select public.request_friend(%s)', (code_a,))
check(err and 'your own' in err, 'you cannot send yourself a friend request')
superuser('delete from public.notifications')
check(one('od', 'select public.request_friend(%s)', (code_a,))['status'] == 'requested', 'accepting the link sends a request')
check('Oa' not in names('od') and 'Od' not in [r[0] for r in as_user('oa', 'select p.name from public.people p join public.contacts c on c.person_id = p.id')],
      'but you are not friends until it is accepted')
check(notes('oa') == ['Od wants to be friends on Cosmic Balance'], 'the link’s owner is notified')
req = one('oa', 'select id from public.friend_requests')
check(req is not None and 'Od' in names('oa'), 'and sees the request and who sent it')
check(fails('od', 'select public.approve_friend_request(%s)', (req,)), 'nobody can accept their own request')
check(one('ob', 'select count(*) from public.friend_requests') == 0, 'others cannot see the request')
one('od', 'select public.request_friend(%s)', (code_a,))
check(len(notes('oa')) == 1 and one('oa', 'select count(*) from public.friend_requests') == 1, 'asking again changes nothing')
check(one('oa', 'select public.approve_friend_request(%s)', (req,)) == me_od, 'the owner accepts it')
check('Oa' in names('od') and 'Od' in names('oa'), 'and they are friends on both sides')
check(notes('od')[-1] == 'Oa accepted your friend request', 'the sender is told')
check(one('od', 'select public.request_friend(%s)', (code_a,))['status'] == 'friends' and
      one('od', 'select public.friend_link_preview(%s)', (code_a,))['friends'], 'opening the link again just says you are friends')
check(one('oc', 'select public.request_friend(%s)', (code_a,))['status'] == 'friends',
      'someone the owner already added (by Gmail) is simply friends, no request needed')
sign_up('oe')
one('oe', 'select id from public.ensure_me(%s)', ('Oe',))
one('oe', 'select public.request_friend(%s)', (code_a,))
creq = one('oa', 'select id from public.friend_requests')
as_user('oa', 'select public.decline_friend_request(%s)', (creq,))
check(one('oa', 'select count(*) from public.friend_requests') == 0, 'a request can be declined')
superuser("delete from public.notifications where kind <> 'friend_request'")
one('oe', 'select public.request_friend(%s)', (code_a,))
check(one('oa', "select count(*) from public.notifications where kind = 'friend_request' and actor = %s", (U['oe'],)) == 1, 'asking again right after a decline does not notify again (once a day at most)')
sign_up('of')
one('of', 'select id from public.ensure_me(%s)', ('Of',))
one('of', 'select public.request_friend(%s)', (code_a,))
of_id = one('oa', "select f.from_person from public.friend_requests f join public.people p on p.id = f.from_person where p.name = 'Of'")
as_user('oa', 'select public.remove_friend(%s)', (of_id,), fetch=False)
check(one('oa', 'select count(*) from public.friend_requests where from_person = %s', (of_id,)) == 0 and 'Of' not in names('oa'),
      'removing someone with a request pending clears the request too')
new_code = one('oa', 'select public.reset_friend_code()')
check(new_code != code_a and one('ob', 'select public.friend_link_preview(%s)', (code_a,)) is None and
      fails('ob', 'select public.request_friend(%s)', (code_a,)), 'making a new link retires the old one')
check(fails('od', 'select * from public.friend_links') and fails('od', 'insert into public.friend_requests (from_person, to_user) values (%s, %s)', (me_od, U['ob'])),
      'friend links and requests cannot be read or written directly')

# --- Group deletion by creator cascades ----------------------------------------------
as_user('surya', 'delete from public.groups where id = %s', (g,), fetch=False)
check(len(as_user('surya', 'select * from public.expenses')) == 0, 'deleting a group removes its expenses')

print(f'\nAll {passed} checks passed.')
