# Cosmic Khaata

A Splitwise-style app for splitting bills with friends. Runs on Android and iPhone, built with Expo (React Native) and TypeScript.

Developed by **Tesseract Studio**, Hyderabad. Suggestions and questions: tools@tesseractstudio.co

This is the **prototype**: everything is stored on the phone itself, with no accounts and no server yet. Each person's phone holds its own copy of the data, so for now one person keeps track for the group. The next step is a shared backend (Supabase) so everyone sees the same groups live.

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
App.tsx                  navigation + font loading
src/
  logic.ts               splitting, balances, debt simplification (pure functions)
  logic.test.ts          tests for the money maths   (npx vitest run)
  money.ts               currencies, formatting (Indian grouping for ₹) and parsing
  store.tsx              app state, saving to the phone, sample data
  theme.ts, ui.tsx       colours, type, shared components
  cosmos.tsx             Libra, black hole, pulsar and supernova illustrations
  export.ts              spreadsheet (CSV) export
  screens/               Onboarding, Home, Group, GroupSummary, GroupForm,
                         ExpenseForm, SettleUp, Friend, FriendForm,
                         Transfer, SettleAll, About
public/                  web app manifest, icons and page template
```

## Checks

```bash
npx tsc --noEmit     # type-check
npx vitest run       # 35 tests: splits, payers, currencies, rounding, balances, summary, transfers
```

## Next steps

1. **Shared data**: Supabase (free plan, Mumbai region) for Sign in with Google and a shared database, with group invite links over WhatsApp, so every friend sees the same groups and can add expenses themselves.
2. **Optional native builds**: Android APKs via EAS Build (free plan). A real iPhone app needs TestFlight or the App Store (Apple Developer account, US$99/year); the installable web app avoids that.
3. Receipt photos, expense categories, editable dates, and recurring expenses like rent.
