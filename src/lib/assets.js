// Fixed asset register: acquisition, straight-line depreciation and disposal.
import { base44 } from "@/api/base44Client";
import { postJournal, round2 } from "@/lib/posting";

export const monthlyDepreciation = (asset) => {
  if (asset.depreciation_method !== "straight_line" || !asset.useful_life_months) return 0;
  return round2((round2(asset.acquisition_cost) - round2(asset.salvage_value)) / asset.useful_life_months);
};

// Remaining depreciable amount before hitting salvage value.
export const remainingDepreciable = (asset) =>
  round2(round2(asset.acquisition_cost) - round2(asset.salvage_value) - round2(asset.accumulated_depreciation));

const monthEnd = (dateStr) => {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
};

// Register an asset. If a funding (credit) account is supplied, post the acquisition:
// Dr fixed asset, Cr cash/bank/payable.
export async function createAsset({ data, fundingAccount, userId = "" }) {
  const cost = round2(data.acquisition_cost);
  const asset = await base44.entities.FixedAsset.create({
    ...data,
    asset_number: data.asset_number || `FA-${Date.now().toString(36).toUpperCase()}`,
    acquisition_cost: cost,
    accumulated_depreciation: 0,
    net_book_value: cost,
    status: "active",
  });

  if (fundingAccount) {
    const journal = await postJournal({
      entryDate: asset.acquisition_date,
      description: `Asset acquisition: ${asset.name}`,
      sourceModule: "assets", sourceDocumentType: "FixedAsset", sourceDocumentId: asset.id,
      userId,
      lines: [
        { account_id: asset.asset_account_id, account_number: asset.asset_account_number, account_name: asset.asset_account_name, debit: cost, credit: 0 },
        { account_id: fundingAccount.id, account_number: fundingAccount.account_number, account_name: fundingAccount.name, debit: 0, credit: cost },
      ],
    });
    await base44.entities.FixedAsset.update(asset.id, { journal_id: journal.id });
  }

  await base44.entities.AuditLog.create({
    action: "create_asset", module: "assets", entity_type: "FixedAsset", entity_id: asset.id,
    user_id: userId, description: `Registered asset ${asset.name} at ${cost} XAF`,
  });
  return asset;
}

// Post one month of depreciation for a single asset:
// Dr depreciation expense, Cr accumulated depreciation.
export async function depreciateAsset({ asset, date, periodLabel, userId = "" }) {
  const amount = Math.min(monthlyDepreciation(asset), remainingDepreciable(asset));
  if (amount <= 0) return null;

  const entry = await base44.entities.DepreciationEntry.create({
    asset_id: asset.id, asset_number: asset.asset_number, asset_name: asset.name,
    period_label: periodLabel, depreciation_date: date, amount,
    accumulated_after: round2(asset.accumulated_depreciation + amount),
    net_book_value_after: round2(asset.acquisition_cost - asset.accumulated_depreciation - amount),
    created_by: userId,
  });

  const journal = await postJournal({
    entryDate: date,
    description: `Depreciation ${periodLabel}: ${asset.name}`,
    sourceModule: "assets", sourceDocumentType: "DepreciationEntry", sourceDocumentId: entry.id,
    userId,
    lines: [
      { account_id: asset.expense_account_id, account_number: asset.expense_account_number, account_name: asset.expense_account_name, debit: amount, credit: 0 },
      { account_id: asset.accum_dep_account_id, account_number: asset.accum_dep_account_number, account_name: asset.accum_dep_account_name, debit: 0, credit: amount },
    ],
  });
  await base44.entities.DepreciationEntry.update(entry.id, { journal_id: journal.id });

  const accumulated = round2(asset.accumulated_depreciation + amount);
  const nbv = round2(asset.acquisition_cost - accumulated);
  await base44.entities.FixedAsset.update(asset.id, {
    accumulated_depreciation: accumulated,
    net_book_value: nbv,
    last_depreciation_date: date,
    status: round2(accumulated) >= round2(asset.acquisition_cost - asset.salvage_value) ? "fully_depreciated" : "active",
  });
  return entry;
}

// Run depreciation across all eligible assets for a given month (YYYY-MM).
export async function runDepreciation({ month, userId = "" }) {
  const date = monthEnd(`${month}-01`);
  const assets = await base44.entities.FixedAsset.filter({ status: "active" });
  const eligible = assets.filter(
    (a) => a.depreciation_method === "straight_line" &&
      a.acquisition_date <= date &&
      (!a.last_depreciation_date || a.last_depreciation_date < date) &&
      remainingDepreciable(a) > 0
  );
  let posted = 0, total = 0;
  for (const asset of eligible) {
    const entry = await depreciateAsset({ asset, date, periodLabel: month, userId });
    if (entry) { posted += 1; total = round2(total + entry.amount); }
  }
  await base44.entities.AuditLog.create({
    action: "run_depreciation", module: "assets", entity_type: "DepreciationEntry", entity_id: month,
    user_id: userId, description: `Depreciation run ${month}: ${posted} assets, ${total} XAF`,
  });
  return { posted, total, skipped: assets.length - eligible.length };
}

// Dispose of an asset: remove cost + accumulated depreciation, book proceeds and gain/loss.
export async function disposeAsset({ asset, date, proceeds, proceedsAccount, gainLossAccount, userId = "" }) {
  proceeds = round2(proceeds);
  const accumulated = round2(asset.accumulated_depreciation);
  const cost = round2(asset.acquisition_cost);
  const nbv = round2(cost - accumulated);
  const gainLoss = round2(proceeds - nbv); // positive = gain
  if (proceeds > 0 && !proceedsAccount) throw new Error("Select the account receiving the sale proceeds");
  if (gainLoss !== 0 && !gainLossAccount) throw new Error("Select a gain/loss on disposal account");

  const lines = [
    { account_id: asset.accum_dep_account_id, account_number: asset.accum_dep_account_number, account_name: asset.accum_dep_account_name, debit: accumulated, credit: 0, description: "Remove accumulated depreciation" },
    { account_id: asset.asset_account_id, account_number: asset.asset_account_number, account_name: asset.asset_account_name, debit: 0, credit: cost, description: "Remove asset cost" },
  ];
  if (proceeds > 0) lines.push({ account_id: proceedsAccount.id, account_number: proceedsAccount.account_number, account_name: proceedsAccount.name, debit: proceeds, credit: 0, description: "Disposal proceeds" });
  if (gainLoss > 0) lines.push({ account_id: gainLossAccount.id, account_number: gainLossAccount.account_number, account_name: gainLossAccount.name, debit: 0, credit: gainLoss, description: "Gain on disposal" });
  if (gainLoss < 0) lines.push({ account_id: gainLossAccount.id, account_number: gainLossAccount.account_number, account_name: gainLossAccount.name, debit: -gainLoss, credit: 0, description: "Loss on disposal" });

  const journal = await postJournal({
    entryDate: date,
    description: `Disposal of ${asset.name}`,
    sourceModule: "assets", sourceDocumentType: "AssetDisposal", sourceDocumentId: asset.id,
    userId, lines,
  });

  await base44.entities.FixedAsset.update(asset.id, {
    status: "disposed", disposal_date: date, disposal_proceeds: proceeds,
    disposal_gain_loss: gainLoss, net_book_value: 0,
  });
  await base44.entities.AuditLog.create({
    action: "dispose_asset", module: "assets", entity_type: "FixedAsset", entity_id: asset.id,
    user_id: userId, description: `Disposed ${asset.name} for ${proceeds} XAF (${gainLoss >= 0 ? "gain" : "loss"} ${Math.abs(gainLoss)} XAF)`,
  });
  return journal;
}