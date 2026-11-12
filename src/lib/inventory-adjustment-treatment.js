// Classify the business reason before selecting the balancing account. Legacy
// requests remain operating counts; the interface requires an explicit choice.
export function inventoryAdjustmentTreatment(body={}) {
  const purpose=body.purpose===undefined?'operating':body.purpose;
  if(!['operating','opening_correction'].includes(purpose))throw Error('Choose the accounting purpose of this stock adjustment.');
  if(purpose==='operating') {
    if(body.correctionAccountId||body.correctionConfirmed)throw Error('Opening stock correction details cannot be used for an operating count.');
    return {purpose,correction_account_id:'',correction_confirmed:false};
  }
  if(typeof body.correctionAccountId!=='string'||!body.correctionAccountId.trim()||body.correctionConfirmed!==true)throw Error('Select the opening stock equity counterpart and confirm that this corrects an opening stock error.');
  return {purpose,correction_account_id:body.correctionAccountId.trim(),correction_confirmed:true};
}

export function validStockCorrectionAccount(account,cashIds=new Set()) {
  return !!account&&account.is_active!==false&&account.is_posting!==false&&(!account.currency||account.currency==='XAF')&&!account.is_treasury&&account.account_number!=='1050'&&!cashIds.has(account.id)&&account.account_type==='equity'&&account.normal_balance==='credit';
}

export const STOCK_COUNT_OFFSET_RULE = 'stock_count_offset_expense';
export const STOCK_COUNT_SURPLUS_POLICY = 'inventory_adjustment_expense_v1';
export const STOCK_COUNT_OFFSET_LABEL = 'Inventory Adjustment / Over-Short';
export const STOCK_COUNT_OFFSET_CHANGED = 'The mapped Inventory Adjustment / Over-Short expense account differs from this count. Review the account again.';
export const STOCK_COUNT_OFFSET_SETUP = 'Configure the Inventory Adjustment / Over-Short expense account in Accounting → Posting Rules.';

export function validStockCountOffsetAccount(account, cashIds = new Set()) {
  return !!account && account.is_active !== false && account.is_posting !== false &&
    (!account.currency || account.currency === 'XAF') && !account.is_treasury && !account.is_control_account &&
    account.account_number !== '1050' && !cashIds.has(account.id) &&
    ['expense', 'other_expense'].includes(account.account_type) && account.normal_balance === 'debit';
}

export function stockCountOffsetAccount(accounts, rules, cashIds) {
  const activeRules = rules.filter(rule => rule.rule_key === STOCK_COUNT_OFFSET_RULE && rule.is_active !== false);
  if (activeRules.length > 1) return null;
  const candidates = activeRules.length
    ? accounts.filter(account => account.id === activeRules[0].account_id)
    : accounts.filter(account => account.account_number === 'INVENTORY-LOSSES');
  if (candidates.length !== 1 || !validStockCountOffsetAccount(candidates[0], cashIds)) return null;
  return candidates[0];
}
