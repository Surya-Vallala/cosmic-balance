// The one private line Split's forms get when Money is on: which of your
// accounts paid (or received) the money, and for an expense what your share
// counts as. Only you see it. Nothing shows unless Money is on and you have
// an account, and nothing from before you turned Money on changes unless you
// say so.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { toDay } from '../../dates';
import { formatMoney, paiseToInput, parseRupees } from '../../money';
import { categoryPath, convert, OUTSIDE, SPLIT_CATEGORY, suggestedAccount } from '../../pfm/logic';
import { useMaybeMoney } from '../../pfm/store';
import { AccountSheet, accountLabel, CategorySheet, PrivateLine, Tip } from '../../pfm/ui';
import { space } from '../../theme';
import type { CurrencyCode, Group, Id } from '../../types';
import { Field, styles as ui } from '../../ui';

export interface SplitMoneyOptions {
  /** The item being edited or viewed ('e:…', 'p:…', 't:…'); null for a new one. */
  linkKey: string | null;
  /** When the item happened, as it is on the form now (from before Money began: nothing is asked or saved unless already linked). */
  date?: string | null;
  groupId: Id | null;
  group?: Group | null;
  /** 'out': your money went out; 'in': it came in; null: none of yours moved. */
  direction: 'out' | 'in' | null;
  /** The item's currency. */
  currency: CurrencyCode;
  /** Your money that moved, in `currency` (null while not typed yet). */
  amount: number | null;
  /** An expense you have a share of: ask what it counts as. */
  share?: boolean;
  /** Save each choice at once (an item being viewed rather than a form). */
  immediate?: boolean;
  /** A one-time tip above the line. */
  tip?: { id: string; text: string };
}

interface Choices {
  account: Id | null | undefined;
  category: Id | undefined;
  charged: string;
}

export function useSplitMoney(o: SplitMoneyOptions): {
  /** The line(s), the pickers and the tip; null when there's nothing to show. */
  element: React.ReactNode;
  /** Keep the choices for this item (call when it's saved). */
  save: (key: string) => void;
  /** Forget them (call when the item is deleted). */
  forget: (key: string) => void;
} {
  const money = useMaybeMoney();
  const m = money?.m;
  const link = o.linkKey && m ? m.links[o.linkKey] : undefined;
  const groupKey = o.groupId ?? OUTSIDE;
  const [sheet, setSheet] = useState<'account' | 'category' | null>(null);
  const [account, setAccount] = useState<{ id: Id | null } | null>(null);
  const [category, setCategory] = useState<Id | null>(null);
  const [charged, setCharged] = useState<{ basis: string; text: string } | null>(null);
  // What the item looked like when opened: a charged amount saved for it still applies while that's unchanged.
  const [firstBasis] = useState(() => (link ? `${link.accountId}|${o.amount}|${o.currency}` : null));

  const hasAccounts = !!m && Object.values(m.accounts).some((a) => !a.hidden);
  const startedOn = m?.settings.startedOn ?? null;
  // From before Money began (an old item, or one dated back): the opening balances
  // already include it, so nothing is asked (unless it was linked already).
  const fromBefore = !link && !!o.date && !!startedOn && toDay(o.date) < startedOn;
  const active = !!money && !!m && money.on && hasAccounts && !fromBefore;
  const accountLine = o.direction !== null;

  const chosen: Id | null | undefined = account
    ? account.id
    : link
      ? link.accountId
      : m
        ? suggestedAccount(m, o.groupId, o.currency)
        : undefined;
  const acc = chosen && m ? m.accounts[chosen] : undefined;
  const cross = !!acc && acc.currency !== o.currency && !!o.amount;
  const basis = `${chosen}|${o.amount}|${o.currency}`;
  const auto = cross && m && o.amount ? convert(m.settings, o.amount, o.currency, acc!.currency, o.group) : null;
  const chargedText =
    charged && charged.basis === basis
      ? charged.text
      : link?.amount !== undefined && firstBasis === basis
        ? paiseToInput(link.amount)
        : auto !== null
          ? paiseToInput(auto)
          : '';
  const chosenCategory: Id | undefined = category ?? link?.categoryId ?? undefined;
  const groupCategory = m?.settings.groupCategory[groupKey];
  const shownCategory = chosenCategory ?? (groupCategory && m?.categories[groupCategory] ? groupCategory : SPLIT_CATEGORY);

  const write = (key: string, c: Choices, rememberUsual: boolean) => {
    if (!active || !money || !m) return;
    if (!accountLine && !o.share) return;
    const categoryId = o.share ? c.category : link?.categoryId ?? undefined;
    if (!accountLine && categoryId === undefined && !link) return;
    const accountId = accountLine ? c.account ?? null : link?.accountId ?? null;
    const a = accountId ? m.accounts[accountId] : undefined;
    const isCross = accountLine && !!a && a.currency !== o.currency && !!o.amount;
    const amount = isCross ? parseRupees(c.charged) ?? convert(m.settings, o.amount!, o.currency, a!.currency, o.group) : undefined;
    money.setLink(key, {
      accountId,
      ...(amount !== undefined ? { amount } : {}),
      ...(categoryId ? { categoryId } : {}),
    });
    if (accountLine && rememberUsual && m.settings.usual[groupKey] !== accountId) {
      money.setSettings({ usual: { ...m.settings.usual, [groupKey]: accountId } });
    }
  };
  const current = (): Choices => ({ account: chosen, category: chosenCategory, charged: chargedText });

  const save = (key: string) => write(key, current(), !!account);
  const forget = (key: string) => {
    if (money?.m.links[key]) money.setLink(key, null);
  };

  if (!active || !m || !money || (!accountLine && !o.share)) return { element: null, save, forget };

  const label = o.direction === 'out' ? 'Paid from' : 'Received into';
  const showTip = !!o.tip && !m.settings.tips.includes(o.tip.id);
  const categoryText = categoryPath(m.categories, shownCategory).join(' › ');

  const element = (
    <View style={{ marginTop: space.lg }}>
      {showTip && o.tip ? <Tip text={o.tip.text} onDone={() => money.tipSeen(o.tip!.id)} /> : null}
      {accountLine ? (
        <PrivateLine
          testID="money-account-line"
          label={label}
          value={accountLabel(m, chosen)}
          onPress={() => setSheet('account')}
        />
      ) : null}
      {accountLine && cross && acc ? (
        <View style={{ marginTop: -space.sm }}>
          <Field
            label={`Charged to ${acc.name} (${acc.currency})`}
            value={chargedText}
            onChangeText={(text) => setCharged({ basis, text })}
            onBlur={() => o.immediate && o.linkKey && write(o.linkKey, current(), false)}
            keyboardType="decimal-pad"
            accessibilityLabel={`Charged to ${acc.name}`}
            hint={`What ${acc.name} was charged for your ${formatMoney(o.amount!, o.currency)}. Only you see this.`}
          />
        </View>
      ) : null}
      {o.share ? (
        <PrivateLine
          testID="money-category-line"
          label="Your share counts as"
          value={categoryText}
          onPress={() => setSheet('category')}
        />
      ) : null}
      {accountLine && chosen === null ? (
        <Text style={[ui.hint, { marginTop: -space.md, marginBottom: space.md }]}>
          Not tracked: none of your accounts change.{o.share ? ' Your share still counts as spending.' : ''}
        </Text>
      ) : null}
      <AccountSheet
        visible={sheet === 'account'}
        onClose={() => setSheet(null)}
        title={label}
        selected={chosen}
        none={{
          label: 'Don’t track',
          hint: o.share !== undefined && o.direction === 'out' ? 'Only your share counts as spending either way' : 'None of your accounts change',
        }}
        onPick={(id) => {
          setAccount({ id });
          if (o.immediate && o.linkKey) write(o.linkKey, { ...current(), account: id, charged: '' }, true);
        }}
      />
      {o.share ? (
        <CategorySheet
          visible={sheet === 'category'}
          kind="expense"
          title="Your share counts as"
          selected={shownCategory === SPLIT_CATEGORY ? null : shownCategory}
          onPick={(id) => {
            setCategory(id);
            if (o.immediate && o.linkKey) write(o.linkKey, { ...current(), category: id }, false);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
  return { element, save, forget };
}
