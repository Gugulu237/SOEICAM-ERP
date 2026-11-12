// Purchase payments post directly. Legacy requests can still be reviewed.
// Cash released before delivery uses the configured supplier-prepayment asset.
// The receipt records Inventory/AP, then its verified advance allocation clears
// the prepayment asset against that receipt's original payable account.
//
import { erp } from "@/api/erpClient";


export async function prepareCashDisbursement({ po, treasuryAccount, amount, date, reference = '', notes = '', requestKey = crypto.randomUUID() }) {
  const { data } = await erp.functions.invoke('fieldOps', { action: 'recordPurchasePayment', requestKey, orderId: po.id, accountId: treasuryAccount?.id, amount, date, reference, description: notes });
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
