# Cosmic Balance

A Splitwise-style app for splitting bills with friends. Runs on Android and iPhone, built with Expo (React Native) and TypeScript.

Developed by **Tesseract Studio**, Hyderabad. Suggestions and questions: tools@tesseractstudio.co

Live app: **https://surya-vallala.github.io/cosmic-balance/**

(Earlier called Cosmic Khaata. Data saved on phones under the old name is kept.)

There are two ways to use it:

- **Continue with Google**: groups are saved online and shared. Everyone in a group sees the same expenses, can add their own, and sees changes from others within a second or two.
- **Use on this phone only**: no account; everything stays on the phone. Good for trying it out. Data here isn't moved to an account later.

## What it does

- **Groups** for trips, flats, regular dinners. Add friends by name, with an optional UPI ID.
- **One or more payers**: if a bill was paid jointly (you paid ₹2,000 and Ravi paid ₹1,000), pick "Multiple people" and enter what each person paid. Everyone's share is owed to the payers in proportion to what they paid.
- **Date of each expense and transfer**: today unless you change it (tap Date to pick another day from the phone's calendar).
- **Remarks** on an expense (optional, up to 500 characters) to explain it. Shown in italics under the expense in lists, in full when you open it, and in the Note column of the export. Everyone who can see the expense sees its remarks; notifications never include them.
- **Expenses** split four ways: equally (pick who shared), exact amounts, percentages, or shares (e.g. 2 for a couple, 1 for everyone else). Amounts are kept in paise, so splits always add up exactly.
- **Several currencies per group**: a Thailand trip can use ₹ and ฿ together. The first currency is the group's main one; for each other currency the group sets one exchange rate (it starts at an approximate value and can be changed any time). Each expense is entered in the currency it was paid in, using the dropdown next to the amount.
- **Balances** per group and per friend, in plain sentences ("Ravi pays you ₹450"). In multi-currency groups every balance is also shown in the other currencies ("or ฿156.79").
- **Group summary**: who pays whom (with Settle buttons), total spending (overall and per currency), who paid what share of it, and for each person what they paid, what their share cost, and what they owe or get back. Switch the whole summary between the group's currencies.
- **Expenses outside groups**: split something with one or more friends without making a group (Add expense → No group, or Add expense on a friend's page). Any currency, every split type. They count in your balance with each friend, and show on Home under **Outside groups** and on each friend's page.
- **Transfers outside groups**: record money one person gave another (cash, a UPI transfer, a loan). It isn't part of any group, but it counts in your overall balance with that friend.
- **Overall settle-up with a friend**: adds up every group you share plus transfers, and settles it with one payment. Each group then shows the two of you as settled. (Groups in different main currencies are settled separately.)
- **Simplify debts** (on by default, can be switched off per group): the group settles with the fewest payments.
- **Settle up** in any of the group's currencies: the amount owed is shown in each, and paying the suggested amount clears the balance exactly. Record a payment. If you're paying someone who has a UPI ID, it opens GPay, PhonePe, Paytm or similar with the amount already filled in. If someone owes you, send a reminder through WhatsApp or any other app.
- **Activity feed** of everything that's been added, edited, or paid.
- **Notifications** (shared mode): the bell on the home screen lists what concerns you, and phones can get them even when the app is closed. See below.
- **Remove a friend** you're settled up with (their page → Remove). History in groups is never rewritten, so someone in a group's expenses can be removed only after that group is deleted, and someone in a group another person created only after that person takes them out.
- **The phone's Back button** goes to the previous screen (each screen has its own address, so reloading also stays put).
- **Sample data** on the welcome screen so you can explore before adding real expenses.
- **Export to spreadsheet** (Your profile): a CSV of every expense, payment and transfer, for backups.
- **About page**: developed by Tesseract Studio, with the contact email.

## Sharing with friends

**Invite one friend with their own link** (the easy way; you don't need their Gmail):

1. Add them by name, in a group's "Who's in it" or under Friends → Add a friend.
2. Their friend page (**Invite …**), or the group's **Not joined yet** list, shows their link with a **Share** button. Share opens the phone's share menu: pick WhatsApp, then their chat.
3. They open the link and sign in with Google (any Google account). They see who invited them and to which groups, tap **Accept invite**, and everything recorded for them becomes theirs. No approval is needed: the link was made for them. Each link works once, and you're notified when they accept.

**Or send your friend link** (Friends → Add a friend → **Send a friend request**): share it on WhatsApp. Whoever opens it signs in and taps **Accept**; you get a notification and accept (or decline) them under Friends, and you're friends on both sides. **Make a new link** retires the old one.

**Or add friends by their Gmail address** (in a group's "Who's in it", or Friends → Add a friend):

- If they already use Cosmic Balance, they're added as themselves and see the group straight away.
- If they don't yet, they're added as "not joined yet". The first time they sign in with that Gmail, they land in the group with everything recorded for them, and you're notified.
- Gmail addresses match however they're typed: `S.Urya+trip@GMail.com` is `surya@gmail.com`.

**Or share the group's link** (good for a whole WhatsApp group): in the group, tap **Invite friends**, then **Share**. Anyone who opens it signs in and taps **Ask to join**: they see only the group's name, who runs it and how many are in it. The person who created the group gets a notification and an **Asking to join** list in the group, and taps **Let in** or **Decline**. If they were already added by name, **Let in** asks which name is theirs, and everything recorded for it becomes theirs. Nobody gets in without the creator's approval, so a link forwarded to the wrong chat is harmless; **Reset invite link** in the group's settings retires it anyway.

Who sees what: you see a group only if you're in it (or once you're let in). A transfer outside groups is seen only by the two people in it (and whoever recorded it). Friends added by Gmail see each other in their Friends lists. Only the person who created a group can delete it or let people in through its link; anyone else can leave a group they have no expenses in.

**Without a connection**, changes are kept on the phone and sent as soon as it's back online, even if the app was closed in between. A strip at the top says how many are waiting.

## Notifications

You're notified when a friend adds, edits or deletes an expense you're in, records a payment or settle-up with you, adds you to a group, asks to join a group you created, lets you in, or accepts your invite. Notifications say what happened, never amounts ("Ravi added an expense in Goa trip").

- **In the app**: the bell on the home screen shows how many are new; tap it for the list. Tapping one opens the group or friend.
- **On the phone, with the app closed**: Your profile → Notifications → **Turn on notifications** (the phone asks once). Works on Android (Chrome, best with the app installed) and on iPhone with iOS 16.4 or later, **only once the app is added to the Home Screen** and opened from there. Signing out turns them off on that phone.

Behind the scenes, the database records each notification and asks the small `send-push` function (in Supabase) to deliver it. Delivery uses the standard Web Push protocol and costs nothing.

## Look and feel

A minimal cosmic theme: deep-space background, starlight text, one warm star colour for actions and an orbit mark for the logo and group badges. Display type is Sora. A few thin-line illustrations, one per screen at most:

- **Libra**, the constellation of the scales, on the welcome, home and About screens
- **a black hole** on empty screens
- **a pulsar** while the app loads and on reminder panels
- **a supernova** when a payment is recorded or a balance is settled

## Install it on a phone (no app store)

The web version is an installable app. Open its link on the phone, then:

- **Android (Chrome)**: menu ⋮ → Install app (or Add to Home screen)
- **iPhone (Safari)**: Share → Add to Home Screen

It gets its own icon and opens full screen. To publish the web version under a sub-path (GitHub Pages):

```bash
WEB_BASE_URL=/cosmic-balance npx expo export --platform web
```

and upload the `dist` folder.

## Setting up the shared backend (one time)

The backend is a free Supabase project (named `cosmic-khaata` in the dashboard; the name there doesn't matter). The app only contains the project URL and the **publishable** key, which are safe to ship; the database rules decide what each person can see. Never put the secret key (`sb_secret_…` or `service_role`) in the app.

1. **Database**: in Supabase, open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. It's safe to run again, and running the latest version is also how an existing database is upgraded (data is kept). Run it *before* publishing a new version of the app.
2. **Google sign-in**: in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials, create an **OAuth client ID** of type *Web application* with
   - Authorised JavaScript origin: `https://surya-vallala.github.io`
   - Authorised redirect URI: `https://jwmnmrmocilfrqohhezf.supabase.co/auth/v1/callback`

   Then in Supabase → **Authentication → Sign In / Providers → Google**, turn it on and paste the client ID and client secret. The secret stays in Supabase.
3. **Where to send people back**: Supabase → **Authentication → URL Configuration**: set *Site URL* to `https://surya-vallala.github.io/cosmic-balance/` and add the same address under *Redirect URLs*.
4. **Notifications to phones**: Supabase → **Edge Functions → Deploy a new function → Via Editor**. Name it `send-push`, replace the sample code with all of [`supabase/functions/send-push/index.ts`](supabase/functions/send-push/index.ts), and deploy. Then open the function's **Details** and turn **off** JWT verification (the switch is called "Verify JWT"; the database calls it without a user's sign-in; the function only sends notifications that are already waiting, so this is safe). It needs no secrets: it uses the project's own keys and makes its push key pair the first time it runs. The schema turns on the `pg_net` extension it uses to call the function; if it couldn't, turn on **pg_net** under Database → Extensions and run the schema again.
5. **The name on Google's sign-in screen**: Google Cloud Console → Google Auth Platform → **Branding** → App name: `Cosmic Balance`.

To point a build at a different Supabase project, set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` and `EXPO_PUBLIC_APP_URL` (see `src/cloud/config.ts`).

Sign-in with Google currently works in the web app (installed to the home screen). In Expo Go and native builds, use "on this phone only" for now.

## Run it from your computer (for development)

You need [Node.js](https://nodejs.org) (LTS version) on your computer and the **Expo Go** app on your phone (Play Store or App Store).

```bash
cd cosmic-balance
npm install
npx expo start
```

A QR code appears in the terminal. On Android, scan it from Expo Go. On iPhone, scan it with the Camera app. Your phone and computer need to be on the same Wi-Fi network. If they can't see each other, run `npx expo start --tunnel` instead.

To try it in a browser instead: `npx expo start --web`.

## Project layout

```
App.tsx                  sign-in gate, navigation (with browser history), font loading
src/
  auth.tsx               Google sign-in, "this phone only" mode, invite links
  cloud/                 Supabase client, loading/saving rows, live updates
  linking.ts             screen addresses, so the phone's Back button works
  push.ts                phone notifications (Web Push) on this device
  notify-ui.tsx          the bell and the notifications on/off card
  invites.tsx, messages.ts, share.ts  invite links, their messages, the share menu
  emails.ts              email address check
  logic.ts               splitting, balances, debt simplification, removing friends (pure functions)
  logic.test.ts          tests for the money maths   (npx vitest run)
  money.ts               currencies, formatting (Indian grouping for ₹) and parsing
  store.tsx              app state; saves to the phone or syncs online
  theme.ts, ui.tsx       colours, type, shared components
  cosmos.tsx             Libra, black hole, pulsar and supernova illustrations
  export.ts              spreadsheet (CSV) export
  screens/               Welcome, Join, Onboarding, Home, Group, GroupSummary,
                         GroupForm, ExpenseForm, SettleUp, Friend, FriendForm,
                         Transfer, SettleAll, Notifications, About
supabase/
  schema.sql             tables, access rules, invites, join requests, notifications (re-run to upgrade)
  functions/send-push/   delivers notifications to phones (Web Push, no libraries)
  test_rls.py            checks the access rules against a local Postgres
  test_upgrade.py        upgrading databases made with versions 1 and 3
  test_stub.sql          a small stand-in for Supabase's auth and pg_net, for those tests
public/                  web app manifest, icons, service worker (sw.js) and page template
```

Free Supabase projects pause after about a week with no activity. The workflow in `.github/workflows/keep-supabase-awake.yml` makes one small read every day so that never happens (free for public repositories; GitHub stops scheduled workflows after 60 days without any commits, and emails you first).

## Checks

```bash
npx tsc --noEmit                 # type-check
npx expo lint                    # lint
npx vitest run                   # 71 tests: splits, payers, currencies, rounding, balances, summary,
                                 # transfers, removing friends, database rows, screen addresses, messages
python3 supabase/test_rls.py     # 147 checks of who can see and change what, join requests, notifications
                                 # and friend removal (needs Postgres 16 on :5433)
python3 supabase/test_upgrade.py # upgrading databases made with versions 1 and 3
# supabase/functions/send-push/test.mts: Web Push encryption and signing checked against the
# reference libraries, and delivery through a local database (see the top of the file)
```

The database tests create throwaway databases on a local Postgres with a small stand-in for Supabase's auth (`supabase/test_stub.sql`).

## Next steps

1. **Google sign-in in native builds** (needs a development build and the Android/iOS OAuth clients).
2. **Optional native builds**: Android APKs via EAS Build (free plan). A real iPhone app needs TestFlight or the App Store (Apple Developer account, US$99/year); the installable web app avoids that.
3. Receipt photos, expense categories, and recurring expenses like rent.
