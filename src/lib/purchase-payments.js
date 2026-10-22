// Cash disbursement for approved purchase orders.
// Cash released to a supplier before/at delivery is booked as an advance against
// the supplier payable control account, so the later goods receipt (Dr Inventory,
// Cr Payable) nets the supplier balance back to zero.
//
// No cash leaves the till on the cashier's word alone:
//   prepareCashDisbursement (cashier asks) → approveCashDisbursement (General Manager)
//   → releaseCashDisbursement (cashier hands the money over, the ledger moves).
import { erp } from "@/api/erpClient";


export async function prepareCashDisbursement({ po, treasuryAccount, amount, date, reference = '', notes = '', requestKey = crypto.randomUUID() }) {
  const { data } = await erp.functions.invoke('fieldOps', { action: 'cashierRequestPayment', requestKey, orderId: po.id, accountId: treasuryAccount?.id, amount, date, reference, description: notes });
  return data.payment;
}

export async function approveCashDisbursement({ payment }) {
  const {data}=await erp.functions.invoke('fieldOps',{action:'approvePurchasePayment',paymentId:payment.id});
  return data;
}

export async function rejectCashDisbursement({ payment, reason = "" }) {
  const {data}=await erp.functions.invoke('fieldOps',{action:'rejectPurchasePayment',paymentId:payment.id,reason});
  return data;
}

// Step 3 — the cashier releases approved cash: the ledger and the till move here.
export async function releaseCashDisbursement({ payment, treasuryAccount, requestKey = crypto.randomUUID() }) {
  const { data } = await erp.functions.invoke('fieldOps', { action: 'cashierReleasePayment', requestKey, paymentId: payment.id, accountId: treasuryAccount?.id });
  return data;
}
