import { createHash } from 'node:crypto';
import { readRecords } from './commercial-workspace.js';
import { journalCents, journalDate, journalPayload, ledgerStatuses } from './journal-validation.js';
import { businessDate } from '../../lib/business-date.js';

const retired = asset => ['disposed', 'written_off'].includes(asset.status);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// A cached account balance alone is not evidence of capitalized cost. Reconcile
// every contributing journal, including reversed originals and their offsets.
export async function assetAccountLedgerEvidence(stores, account, allAccounts, prepared) {
  const targetLines = prepared?prepared.targetLines.filter(row=>row.account_id===account.id):await readRecords(stores.JournalLine, { account_id: account.id });
  const journalIds = [...new Set(targetLines.map(row => row.journal_id))], journals = [], lines = [];
  if(prepared){const ids=new Set(journalIds);journals.push(...prepared.journals.filter(row=>ids.has(row.id)));lines.push(...prepared.lines.filter(row=>ids.has(row.journal_id)));}
  else for (let i = 0; i < journalIds.length; i += 100) {
    const ids = journalIds.slice(i, i + 100);
    journals.push(...await readRecords(stores.JournalEntry, { id: { $in: ids } }));
    lines.push(...await readRecords(stores.JournalLine, { journal_id: { $in: ids } }));
  }
  const byJournal = new Map(journals.map(row => [row.id, row]));
  const knownAccounts = new Set(allAccounts.map(row => row.id));
  if (targetLines.some(row => !byJournal.has(row.journal_id))) throw Error('Reconcile the asset account ledger before linking depreciation: a source journal is missing.');
  let net = 0;
  for (const journal of journals.filter(row => ledgerStatuses.includes(row.status))) {
    journalDate(journal.entry_date);
    if (journal.entry_date > businessDate()) throw Error('Reconcile future-dated asset account postings before linking depreciation.');
    let debit = 0, credit = 0;
    const sourceLines = lines.filter(row => row.journal_id === journal.id);
    for (const row of sourceLines) {
      const d = journalCents(row.debit), c = journalCents(row.credit);
      if (d && c || row.status && !ledgerStatuses.includes(row.status) || !knownAccounts.has(row.account_id)) throw Error('Reconcile inconsistent asset account journal lines before linking depreciation.');
      debit += d; credit += c;
      if (row.account_id === account.id) net += d - c;
    }
    if (sourceLines.length < 2 || debit !== credit || debit !== journalCents(journal.total_debit) || credit !== journalCents(journal.total_credit) || !Number.isSafeInteger(debit) || !Number.isSafeInteger(net)) throw Error('Reconcile unbalanced asset account journals before linking depreciation.');
    if (journal.posting_payload && journal.posting_payload !== journalPayload({ entryDate:journal.entry_date, description:journal.description, sourceModule:journal.source_module, sourceDocumentType:journal.source_document_type, lines:sourceLines.filter(row => Number(row.debit) || Number(row.credit)) })) throw Error('The asset account journal no longer matches its original posting. Reconcile it before linking depreciation.');
  }
  const normalBalance = net * (account.normal_balance === 'credit' ? -1 : 1);
  if (!Number.isFinite(Number(account.balance)) || Math.abs(Number(account.balance) * 100 - normalBalance) > 0.001) throw Error('The asset account balance does not match its posted ledger. Reconcile it before linking depreciation.');
  return { balance: normalBalance / 100, journals, lines };
}

export function assetCostSources(ledger,accountId){
 return ledger.journals.filter(j=>ledgerStatuses.includes(j.status)).map(journal=>{
  const selected=ledger.lines.filter(row=>row.journal_id===journal.id&&row.account_id===accountId),debit=selected.reduce((n,row)=>n+journalCents(row.debit),0),credit=selected.reduce((n,row)=>n+journalCents(row.credit),0);
  return {id:journal.id,journal_number:journal.journal_number,entry_date:journal.entry_date,description:journal.description||'',reference:journal.reference||'',source_module:journal.source_module||'',debit:debit/100,credit:credit/100,net_cost:(debit-credit)/100};
 }).sort((a,b)=>a.entry_date.localeCompare(b.entry_date)||String(a.journal_number||a.id).localeCompare(String(b.journal_number||b.id),undefined,{numeric:true}));
}

export async function assetAccountWorkspace(stores, accountId) {
  const [accounts, allAssets, treasury, rules, products] = await Promise.all([
    readRecords(stores.Account), readRecords(stores.FixedAsset), readRecords(stores.TreasuryAccount),
    readRecords(stores.PostingRule, { is_active:true }), readRecords(stores.Product),
  ]);
  const account = accounts.find(row => row.id === accountId);
  if (!account) throw Error('Choose an existing asset account.');
  const assets = allAssets.filter(row => row.asset_account_id === account.id), blocked = [];
  if (account.is_active !== true || account.is_posting === false || account.account_type !== 'asset' || account.normal_balance !== 'debit') blocked.push('Choose an active debit-normal asset posting account.');
  if (account.currency && account.currency !== 'XAF') blocked.push('Choose an asset account denominated in XAF.');
  if (account.is_control_account === true || account.is_treasury === true || treasury.some(row => row.gl_account_id === account.id)) blocked.push('Treasury and control accounts cannot be linked as depreciable assets.');
  const controls = rules.filter(row => /receivable|payable|inventory|work_in_progress|wip|prepayment|cash|bank/.test(row.rule_key || '')).filter(row => row.account_id === account.id);
  const inventoryProducts = products.filter(row => row.inventory_account_id === account.id);
  if (controls.length || inventoryProducts.length) blocked.push('An account mapped to cash, stock, receivables or prepayments cannot be linked as a depreciable asset.');
  let ledger, registered = 0;
  try {
    ledger = await assetAccountLedgerEvidence(stores, account, accounts);
    for (const asset of assets.filter(row => !retired(row))) registered += journalCents(asset.acquisition_cost);
    if (!Number.isSafeInteger(registered)) throw Error('Registered asset costs exceed the supported precision.');
    if (registered > Math.round(ledger.balance * 100)) blocked.push('Registered asset costs exceed this account balance. Reconcile the register before linking another asset.');
    if (ledger.balance <= 0) blocked.push('This account has no positive posted asset cost to link.');
  } catch (error) { blocked.push(error.message); }
  const unassigned = ledger ? Math.max(0, Math.round(ledger.balance * 100) - registered) / 100 : 0;
  if (ledger && unassigned === 0 && ledger.balance > 0 && !blocked.length) blocked.push('All posted cost in this account is already assigned to registered assets.');
  return {
    account, assets, accounts: accounts.filter(row => row.is_active === true),
    ledger_cost: ledger?.balance ?? null, registered_cost: registered / 100, unassigned_cost: unassigned,
    eligible: blocked.length === 0, blocked_reasons: blocked,
    token: digest({ account, assets, ledger, treasury: treasury.filter(row => row.gl_account_id === account.id), controls, inventoryProducts }),
    cost_sources:ledger?assetCostSources(ledger,account.id):[],
  };
}

export async function validateAssetAccountLink(stores, body) {
  if (body.confirmExistingCost !== true) throw Error('Confirm that this is existing capitalized cost with no prior depreciation.');
  if (body.fundingAccountId || body.data?.funding_account_id || body.data?.fundingAccountId || body.data?.journal_id || body.data?.accumulated_depreciation || body.data?.last_depreciation_date) throw Error('Linking existing cost cannot create an acquisition or import prior depreciation.');
  const workspace = await assetAccountWorkspace(stores, body.accountId);
  if (body.workspaceToken !== workspace.token) throw Error('The account or asset register changed. Refresh the account before linking depreciation.');
  if (!workspace.eligible) throw Error(workspace.blocked_reasons.join(' '));
  const cost = journalCents(body.data?.acquisition_cost);
  if (cost <= 0 || cost > Math.round(workspace.unassigned_cost * 100)) throw Error('Enter a positive asset cost within the unassigned posted account balance.');
  // Importing an unallocated contra balance without its historic asset schedule
  // would repeat depreciation. The narrow linking workflow must stop for review.
  const contra = workspace.accounts.find(row => row.id === body.data?.accum_dep_account_id);
  if (!contra || contra.account_type !== 'asset' || contra.normal_balance !== 'credit' || contra.is_posting === false || contra.currency && contra.currency !== 'XAF') throw Error('Choose an active accumulated depreciation posting account in XAF.');
  const allAccounts = await readRecords(stores.Account);
  const evidence = await assetAccountLedgerEvidence(stores, contra, allAccounts);
  const assets = await readRecords(stores.FixedAsset, { accum_dep_account_id: contra.id });
  const assigned = assets.filter(row => !retired(row)).reduce((sum, row) => sum + journalCents(row.accumulated_depreciation), 0);
  if (!Number.isSafeInteger(assigned) || assigned !== Math.round(evidence.balance * 100)) throw Error('This accumulated depreciation account has an unassigned or inconsistent balance. Reconcile prior depreciation before linking another asset.');
  return workspace;
}
