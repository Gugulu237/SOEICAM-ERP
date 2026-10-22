/* localized-metadata */
import {ui} from './i18n.js';
export const ITEM_ACCOUNT_FIELDS = [
  { field: 'cogs_account_id', get label(){return ui("COGS Account");}, types: ['cogs'] },
  { field: 'revenue_account_id', get label(){return ui("Income Account");}, types: ['revenue', 'other_income'] },
  { field: 'inventory_account_id', get label(){return ui("Inventory Asset Account");}, types: ['asset'] },
];
export const availableItemAccount = (account, types) => account && account.is_active !== false && account.is_posting !== false && types.includes(account.account_type);
