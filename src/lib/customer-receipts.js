import { erp } from '@/api/erpClient';

export async function customerReceiptAction(action, payload = {}) {
  try {
    const { data } = await erp.functions.invoke('customerReceipts', { action, ...payload });
    if (data.error) throw new Error(data.error);
    return data;
  } catch (error) {
    throw new Error(error.response?.data?.error || error.message);
  }
}

export async function confirmCustomerReceipt(payload) {
  const data = await customerReceiptAction('confirm', payload);
  return data.payment;
}