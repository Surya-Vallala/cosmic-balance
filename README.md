# Cosmic Khaata

A Splitwise-style app for splitting bills with friends. Runs on Android and iPhone, built with Expo (React Native) and TypeScript.

Developed by **Tesseract Studio**, Hyderabad. Suggestions and questions: tools@tesseractstudio.co

Live app: **https://surya-vallala.github.io/cosmic-khaata/**

There are two ways to use it:

- **Continue with Google**: groups are saved online and shared. Everyone in a group sees the same expenses, can add their own, and sees changes from others within a second or two.
- **Use on this phone only**: no account; everything stays on the phone. Good for trying it out. Data here isn't moved to an account later.

## What it does

- **Groups** for trips, flats, regular dinners. Add friends by name, with an optional UPI ID.
- **One or more payers**: if a bill was paid jointly (you paid ₹2,000 and Ravi paid ₹1,000), pick "Multiple people" and enter what each person paid. Everyone's share is owed to the payers in proportion to what they paid.
- **Expenses** split four ways: equally (pick who shared), exact amounts, percentages, or shares (e.g. 2 for a couple, 1 for everyone else). Amounts are kept in paise, so splits always add up exactly.
- **Several currencies per group**: a Thailand trip can use ₹ and ฿ together. The first currency is the group's main one; for each other currency the group sets one exchange rate (it starts at an approximate value and can be changed any time). Each expense is entered in the currency it was paid in, using the dropdown next to the amount.
- **Balances** per group and per friend, in plain sentences ("Ravi pays you ₹450"). In multi-currency groups every balance is also shown in the other currencies ("or ฿156.79").
- **Group summary**: total spending (overall and per currency), who paid what share of it, and for each person what they paid, what their share cost, and what they owe or get back. Switch the whole summary between the group's currencies.
- **Transfers outside groups**: record money one person gave another (cash, a UPI transfer, a loan). It isn't part of any group, but it counts in your overall balance with that friend.
- **Overall settle-up with a friend**: adds up every group you share plus transfers, and settles it with one payment. Each group then shows the two of you as settled. (Groups in different main currencies are settled separately.)
- **Simplify debts** (on by default, can be switched off per group): the group settles with the fewest payments.
- **Settle up** in any of the group's currencies: the amount owed is shown in each, and paying the suggested amount clears the balance exactly. Record a payment. If you're paying someone who has a UPI ID, it opens GPay, PhonePe, Paytm or similar with the amount already filled in. If someone owes you, send a reminder through WhatsApp or any other app.
- **Activity feed** of everything that's been added, edited, or paid.
- **Sample data** on the welcome screen so you can explore before adding real expenses.
- **Export to spreadsheet** (Your profile): a CSV of every expense, payment and transfer, for backups.
- **About page**: developed by Tesseract Studio, with the contact email.

## Sharing with friends

1. Sign in with Google and start a group. Add friends by name (they don't need an account yet).
2. In the group, tap **Invite friends** and send the link on WhatsApp (or copy it).
3. A friend opens the link, signs in with Google and taps **I'm Ravi** (their name in the list). Everything already recorded for "Ravi" becomes theirs: expenses, payments and transfers. If they aren't in the list, they can join as themselves.
4. From then on they manage their own name and UPI ID, and see the group live.

Who sees what: you see a group only if you're in it. A transfer outside groups is seen only by the two people in it (and whoever recorded it). Only the person who created a group can delete it. Anyone with an invite link can join that group, so share it only with the friends in it; **Reset link** in the group's settings makes the old link stop working.

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
WEB_BASE_URL=/cosmic-khaata npx expo export --platform web
```

and upload the `dist` folder.

## Setting up the shared backend (one time)

The backend is a free Supabase project (`cosmic-khaata`). The app only contains the project URL and the **publishable** key, which are safe to ship; the database rules decide what each person can see. Never put the secret key (`sb_secret_…` or `service_role`) in the app.

1. **Database**: in Supabase, open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. It's safe to run again after changes.
2. **Google sign-in**: in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials, create an **OAuth client ID** of type *Web application* with
   - Authorised JavaScript origin: `https://surya-vallala.github.io`
   - Authorised redirect URI: `https://jwmnmrmocilfrqohhezf.supabase.co/auth/v1/callback`

   Then in Supabase → **Authentication → Sign In / Providers → Google**, turn it on and paste the client ID and client secret. The secret stays in Supabase.
3. **Where to send people back**: Supabase → **Authentication → URL Configuration**: set *Site URL* to `https://surya-vallala.github.io/cosmic-khaata/` and add the same address under *Redirect URLs*.

To point a build at a different Supabase project, set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` and `EXPO_PUBLIC_APP_URL` (see `src/cloud/config.ts`).

Sign-in with Google currently works in the web app (installed to the home screen). In Expo Go and native builds, use "on this phone only" for now.

## Run it from your computer (for development)

You need [Node.js](https://nodejs.org) (LTS version) on your computer and the **Expo Go** app on your phone (Play Store or App Store).

```bash
cd cosmic-khaata
npm install
npx expo start
```

A QR code appears in the terminal. On Android, scan it from Expo Go. On iPhone, scan it with the Camera app. Your phone and computer need to be on the same Wi-Fi network. If they can't see each other, run `npx expo start --tunnel` instead.

To try it in a browser instead: `npx expo start --web`.

## Project layout

```
App.tsx                  sign-in gate, navigation, font loading
src/
  auth.tsx               Google sign-in, "this phone only" mode, invite links
  cloud/                 Supabase client, loading/saving rows, live updates
  share.ts               share sheet / copy for invite links               splitting, balances, debt simplification (pure functions)
  logic.test.ts          tests for the money maths   (npx vitest run)
  money.ts               currencies, formatting (Indian grouping for ₹) and parsing
  store.tsx              app state; saves to the phone or syncs online
  theme.ts, ui.tsx       colours, type, shared components
  cosmos.tsx             Libra, black hole, pulsar and supernova illustrations
  export.ts              spreadsheet (CSV) export
  screens/               Welcome, Join, Onboarding, Home, Group, GroupSummary,
                         GroupForm, ExpenseForm, SettleUp, Friend, FriendForm,
                         Transfer, SettleAll, About
supabase/
  schema.sql             tables, access rules, join/claim functions
  test_rls.py            checks the access rules against a local Postgres
public/                  web app manifest, icons and page template
```

## Checks

```bash
npx tsc --noEmit     # type-check
npx expo lint        # lint
npx vitest run       # 45 tests: splits, payers, currencies, rounding, balances, summary,
                     # transfers, and converting between app state and database rows
```

## Next steps

1. **Google sign-in in native builds** (needs a development build and the Android/iOS OAuth clients).
2. **Optional native builds**: Android APKs via EAS Build (free plan). A real iPhone app needs TestFlight or the App Store (Apple Developer account, US$99/year); the installable web app avoids that.
3. Receipt photos, expense categories, editable dates, and recurring expenses like rent.
