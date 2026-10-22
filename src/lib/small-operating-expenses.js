// Petty cash is for incidental, low-value operating purchases. Planned
// commitments use an approved expense request; compensation uses Payroll.
export const SMALL_OPERATING_CATEGORIES = [
  'fuel', 'office', 'transport', 'communication', 'cleaning', 'maintenance', 'travel', 'other',
];

const PAYROLL = /\b(?:salar(?:y|ies)|wages?|payroll|stipends?|compensation)\b/i;
const PLANNED = /\b(?:rents?|rentals?|leases?|leasing|insurance|subscriptions?|tax(?:es)?|loans?|mortgages?|electricity|water\s+bills?)\b/i;

export function isSmallOperatingAccount(account) {
  return !!account && (!account.account_type || account.account_type === 'expense') &&
    !PAYROLL.test(account.name || '') && !PLANNED.test(account.name || '');
}

export function smallOperatingExpenseIssue({ category, expenseAccount, description = '', payee = '' }) {
  if (!SMALL_OPERATING_CATEGORIES.includes(category))
    return 'This is not a routine small expense. Use an approved Expense Request instead.';
  const purpose = [expenseAccount?.name, description, payee].join(' ');
  if (PAYROLL.test(purpose))
    return 'Salaries and wages belong in Payroll, not small operating expenses.';
  if (PLANNED.test(purpose))
    return 'Rent, leases and other planned commitments require an approved Expense Request.';
  return '';
}
