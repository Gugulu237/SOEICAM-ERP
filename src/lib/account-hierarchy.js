/* localized-metadata */
import {ui} from './i18n.js';
// Chart-of-accounts structure: account type metadata, the account tree with
// rolled-up balances, account numbering and account validation rules.
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export const ACCOUNT_TYPES = [
  { value: "asset", get label(){return ui("Assets");}, normal: "debit", prefix: "1", statement: "balance_sheet" },
  { value: "liability", get label(){return ui("Liabilities");}, normal: "credit", prefix: "2", statement: "balance_sheet" },
  { value: "equity", get label(){return ui("Equity");}, normal: "credit", prefix: "3", statement: "balance_sheet" },
  { value: "revenue", get label(){return ui("Revenue");}, normal: "credit", prefix: "4", statement: "income_statement" },
  { value: "cogs", get label(){return ui("Cost of Sales");}, normal: "debit", prefix: "5", statement: "income_statement" },
  { value: "expense", get label(){return ui("Operating Expenses");}, normal: "debit", prefix: "6", statement: "income_statement" },
  { value: "other_income", get label(){return ui("Other Income");}, normal: "credit", prefix: "7", statement: "income_statement" },
  { value: "other_expense", get label(){return ui("Other Expenses");}, normal: "debit", prefix: "8", statement: "income_statement" },
];

export const typeMeta = (value) => ACCOUNT_TYPES.find((t) => t.value === value) || ACCOUNT_TYPES[0];
export const typeLabel = (value) => typeMeta(value).label;

const byNumber = (a, b) => {
  const na = Number(a.account_number);
  const nb = Number(b.account_number);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a.account_number || "").localeCompare(String(b.account_number || ""));
};

// Suggests the next free account number: inside the parent when nesting,
// otherwise the next slot in the account type's own number block.
export function suggestAccountNumber(accounts, type, parentId) {
  const taken = new Set(accounts.map(a => String(a.account_number)));
  const parent = parentId ? accounts.find((a) => a.id === parentId) : null;
  if (parent) {
    const base = Number(parent.account_number);
    const used = accounts
      .filter((a) => a.parent_id === parent.id)
      .map((a) => Number(a.account_number))
      .filter((n) => Number.isFinite(n));
    let next = used.length ? Math.max(...used) + 1 : (Number.isFinite(base) ? base + 1 : 1001);
    while (taken.has(String(next))) next++;
    return String(next);
  }
  const block = Number(typeMeta(type).prefix) * 1000;
  const used = accounts
    .map((a) => Number(a.account_number))
    .filter((n) => Number.isFinite(n) && n >= block && n < block + 1000);
  return String(used.length ? Math.max(...used) + 10 : block + 100);
}

export function isDescendantOf(candidateId, ancestorId, accounts) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let current = byId.get(ancestorId);
  const seen = new Set();
  while (current && current.parent_id && !seen.has(current.id)) {
    if (current.parent_id === candidateId) return true;
    seen.add(current.id);
    current = byId.get(current.parent_id);
  }
  return false;
}

// Builds the account tree grouped by account type, with balances rolled up
// through header accounts. Net is debit-positive: Dr when positive, Cr when negative.
export function buildAccountTree(accounts, balances) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const childrenMap = new Map();
  accounts.forEach((a) => {
    if (!a.parent_id || !byId.has(a.parent_id)) return;
    if (!childrenMap.has(a.parent_id)) childrenMap.set(a.parent_id, []);
    childrenMap.get(a.parent_id).push(a);
  });
  childrenMap.forEach((list) => list.sort(byNumber));

  const netOf = (a) => {
    const b = balances?.[a.id];
    return b ? round2((b.debit || 0) - (b.credit || 0)) : 0;
  };

  const rollups = new Map();
  const entryCounts = new Map();
  const counts = new Map();
  const visiting = new Set();

  const walk = (a) => {
    if (rollups.has(a.id)) return;
    if (visiting.has(a.id)) return; // cycle guard
    visiting.add(a.id);
    const kids = childrenMap.get(a.id) || [];
    let net = netOf(a);
    let entries = balances?.[a.id]?.entries || 0;
    let count = 1;
    kids.forEach((k) => {
      walk(k);
      net = round2(net + (rollups.get(k.id) || 0));
      entries += entryCounts.get(k.id) || 0;
      count += counts.get(k.id) || 0;
    });
    visiting.delete(a.id);
    rollups.set(a.id, net);
    entryCounts.set(a.id, entries);
    counts.set(a.id, count);
  };

  const roots = accounts.filter((a) => !a.parent_id || !byId.has(a.parent_id)).sort(byNumber);
  roots.forEach(walk);

  const sections = ACCOUNT_TYPES.map((meta) => {
    const sectionRoots = roots.filter((a) => a.account_type === meta.value);
    if (!sectionRoots.length) return null;
    return {
      value: meta.value,
      label: meta.label,
      roots: sectionRoots,
      net: round2(sectionRoots.reduce((s, r) => s + (rollups.get(r.id) || 0), 0)),
      count: sectionRoots.reduce((s, r) => s + (counts.get(r.id) || 0), 0),
    };
  }).filter(Boolean);

  const known = new Set(ACCOUNT_TYPES.map((t) => t.value));
  const strays = roots.filter((a) => !known.has(a.account_type));
  if (strays.length) {
    sections.push({
      value: "other",
      get label(){return ui("Other");},
      roots: strays,
      net: round2(strays.reduce((s, r) => s + (rollups.get(r.id) || 0), 0)),
      count: strays.reduce((s, r) => s + (counts.get(r.id) || 0), 0),
    });
  }

  return { sections, childrenMap, rollups, entryCounts, counts };
}

export function validateAccount(form, accounts, balances) {
  const errors = [];
  const number = String(form.account_number || "").trim();
  if (!number) errors.push("An account number is required");
  if (!String(form.name || "").trim()) errors.push("An account name is required");

  const clash = accounts.find((a) => a.id !== form.id && String(a.account_number || "").trim() === number);
  if (clash) errors.push(`Account number ${number} is already used by ${clash.name}`);

  const parent = form.parent_id ? accounts.find((a) => a.id === form.parent_id) : null;
  if (form.parent_id && !parent) errors.push("The selected parent account no longer exists");
  if (form.id && form.parent_id === form.id) errors.push("An account cannot be its own parent");
  if (parent) {
    if (parent.account_type !== form.account_type) {
      errors.push(`${parent.account_number} is a ${typeLabel(parent.account_type).toLowerCase()} account, so a ${typeLabel(form.account_type).toLowerCase()} account cannot sit under it`);
    }
    if (parent.is_active === false) errors.push("Choose an active parent account");
    if (form.id && isDescendantOf(form.id, parent.id, accounts)) {
      errors.push("An account cannot be nested inside one of its own sub-accounts");
    }
  }

  const posted = balances?.[form.id];
  const hasPostings = posted && (posted.entries > 0 || (posted.debit || 0) !== 0 || (posted.credit || 0) !== 0);
  if (hasPostings) {
    const original = accounts.find((a) => a.id === form.id);
    if (original && original.account_type !== form.account_type) {
      errors.push("The account type cannot change once the account has postings");
    }
    if (form.is_posting === false) {
      errors.push("This account already has postings, so it cannot become a header account");
    }
  }

  return errors;
}

// Posting parents retain their own ledger activity as well as child rollups.
export function eligibleAccountParents(accounts, form) {
  return accounts.filter(a => a.id !== form.id && a.is_active !== false && a.account_type === form.account_type && (!form.id || !isDescendantOf(form.id, a.id, accounts))).sort(byNumber);
}

export function visibleAccounts(accounts, balances, {type='all', status='visible', query=''}={}) {
  const byId=new Map(accounts.map(a=>[a.id,a]));
  let list=accounts.filter(a=>type==='all' || a.account_type===type);
  const used=a=>Number(balances?.[a.id]?.entries)>0 || Number(a.balance || 0)!==0 || Number(a.opening_debit || 0)!==0 || Number(a.opening_credit || 0)!==0;
  if(status==='visible')list=list.filter(a=>a.is_active!==false && !a.is_hidden);
  if(status==='hidden')list=list.filter(a=>a.is_hidden);
  if(status==='active')list=list.filter(a=>a.is_active!==false);
  if(status==='inactive')list=list.filter(a=>a.is_active===false);
  if(status==='used')list=list.filter(used);
  const q=query.trim().toLowerCase();
  if(q)list=list.filter(a=>`${a.account_number} ${a.name}`.toLowerCase().includes(q));
  // Keep ancestor context, including hidden grouping rows, for search/used views.
  if(q || status==='used'){
    const keep=new Set(list.map(a=>a.id));
    for(const a of list){let id=a.parent_id;const seen=new Set([a.id]);while(id && byId.has(id) && !seen.has(id)){seen.add(id);keep.add(id);id=byId.get(id).parent_id;}}
    list=accounts.filter(a=>keep.has(a.id));
  }
  return list;
}
