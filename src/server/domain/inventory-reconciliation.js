import { ledgerStatuses } from './journal-validation.js';

const units = value => Math.round(Number(value ?? 0) * 1000);
const cents = value => Math.round(Number(value ?? 0) * 100);
const ruleFor = item => ['assembly', 'finished_product'].includes(item.inventory_type)
  ? 'finished_goods_inventory' : item.inventory_type === 'packaging' ? 'packaging_inventory' : 'raw_material_inventory';

// Replay recorded movements at the identity shared by both tables. Multiple
// valuation layers may share a printed lot. QC changes with the same source
// and destination net to zero, while value-only adjustments still replay.
export function reconcileInventory({ products, warehouses, balances, movements, accounts, rules, journals, lines }) {
  const items = new Map(products.map(row => [row.id, row]));
  const locations = new Map(warehouses.map(row => [row.id, row]));
  const gl = new Map(accounts.map(row => [row.id, row]));
  const postingRules = new Map();
  for (const rule of rules.filter(row => row.is_active !== false)) {
    postingRules.set(rule.rule_key, postingRules.has(rule.rule_key) ? null : rule.account_id);
  }
  const groups = new Map(), valuation = new Map(), references = [];
  const recordReference = (source, row, reason) => references.push({ source, id: row.id, product_id: row.product_id, reason });
  const groupFor = (row, warehouse) => {
    const identity = [row.product_id, warehouse, row.lot_number || ''];
    const key = JSON.stringify(identity);
    if (!groups.has(key)) groups.set(key, {
      product_id: row.product_id, product_name: items.get(row.product_id)?.name || row.product_name || row.product_id,
      warehouse_id: warehouse, warehouse_name: locations.get(warehouse)?.name || warehouse, lot_number: row.lot_number || '',
      balance_quantity: 0, ledger_quantity: 0, balance_value: 0, ledger_value: 0, balance_ids: [], movement_ids: [],
    });
    return groups.get(key);
  };
  const valuationFor = id => {
    if (!valuation.has(id)) valuation.set(id, {
      account_id: id, account_number: gl.get(id)?.account_number || '', name: gl.get(id)?.name || '',
      inventory_value: 0, ledger_value: 0,
    });
    return valuation.get(id);
  };
  for (const rule of ['raw_material_inventory', 'packaging_inventory', 'finished_goods_inventory', 'recovered_packaging_inventory']) {
    const id = postingRules.get(rule);
    if (gl.get(id)?.account_type === 'asset') valuationFor(id);
  }
  for (const row of balances) {
    const item = items.get(row.product_id), quantity = units(row.quantity), value = cents(row.total_value);
    if (!item || !locations.has(row.warehouse_id)) recordReference('StockBalance', row, 'missing_master');
    if (row.quantity == null || row.total_value == null || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(value) || value < 0) {
      recordReference('StockBalance', row, 'invalid_measure');
      continue;
    }
    const group = groupFor(row, row.warehouse_id);
    group.balance_ids.push(row.id);
    group.balance_quantity += quantity;
    group.balance_value += value;
    const fallback = item && (postingRules.get(ruleFor(item)) || (ruleFor(item) === 'packaging_inventory' && postingRules.get('raw_material_inventory')));
    const id = row.inventory_recovery_account_id || item?.inventory_account_id || fallback;
    if (gl.get(id)?.account_type === 'asset') valuationFor(id).inventory_value += value;
    else if (value) recordReference('StockBalance', row, 'missing_inventory_account');
  }
  for (const row of movements) {
    // Dated reversals have their own offsetting movements. Retain the original.
    if (!['approved', 'reversed'].includes(row.status)) continue;
    const from = row.source_warehouse_id, to = row.destination_warehouse_id;
    if (!items.has(row.product_id) || !from && !to || [from, to].some(id => id && !locations.has(id))) {
      recordReference('StockMovement', row, 'missing_master');
    }
    const quantity = units(row.quantity), value = cents(row.total_value);
    if (row.quantity == null || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(value) || quantity < 0 || value < 0) {
      recordReference('StockMovement', row, 'invalid_measure');
      continue;
    }
    for (const [warehouse, direction] of [[from, -1], [to, 1]]) {
      if (!warehouse || from === to) continue;
      const group = groupFor(row, warehouse);
      group.movement_ids.push(row.id);
      group.ledger_quantity += direction * quantity;
      group.ledger_value += direction * value;
    }
  }
  const posted = new Set(journals.filter(row => ledgerStatuses.includes(row.status)).map(row => row.id));
  for (const line of lines) {
    const report = valuation.get(line.account_id);
    if (report && line.status !== 'draft' && posted.has(line.journal_id)) {
      const debit = cents(line.debit), credit = cents(line.credit);
      if (Number.isSafeInteger(debit) && Number.isSafeInteger(credit) && debit >= 0 && credit >= 0) report.ledger_value += debit - credit;
      else recordReference('JournalLine', line, 'invalid_measure');
    }
  }
  const differences = [...groups.values()].filter(row => row.balance_quantity !== row.ledger_quantity || row.balance_value !== row.ledger_value)
    .map(row => ({
      ...row, balance_quantity: row.balance_quantity / 1000, ledger_quantity: row.ledger_quantity / 1000,
      quantity_difference: (row.balance_quantity - row.ledger_quantity) / 1000,
      balance_value: row.balance_value / 100, ledger_value: row.ledger_value / 100,
      value_difference: (row.balance_value - row.ledger_value) / 100,
    }));
  return {
    groups_checked: groups.size,
    lot_difference_count: differences.length,
    reference_issue_count: references.length,
    accounts: [...valuation.values()].sort((a, b) => a.account_number.localeCompare(b.account_number)).map(row => ({
      ...row, inventory_value: row.inventory_value / 100, ledger_value: row.ledger_value / 100,
      value_difference: (row.inventory_value - row.ledger_value) / 100,
    })),
    lots: differences.slice(0, 100).map(row => ({ ...row, balance_count: row.balance_ids.length, movement_count: row.movement_ids.length,
      balance_ids: row.balance_ids.slice(0, 30), movement_ids: row.movement_ids.slice(0, 30) })),
    references: references.slice(0, 100),
  };
}
