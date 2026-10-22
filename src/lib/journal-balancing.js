// Suggest only for a blank line; entered amounts always belong to the user.
export function balancingAmount(lines, index) {
  const line = lines[index];
  if (!line || Number(line.debit || 0) !== 0 || Number(line.credit || 0) !== 0) return null;
  let difference = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i === index) continue;
    const other = lines[i], debit = Number(other.debit || 0), credit = Number(other.credit || 0);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit && credit)) return null;
    if (!other.account_id && (debit || credit)) return null;
    difference += Math.round(debit * 100) - Math.round(credit * 100);
  }
  return difference > 0 ? { debit: 0, credit: difference / 100 } : difference < 0 ? { debit: -difference / 100, credit: 0 } : null;
}
