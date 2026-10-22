import {erp} from '@/api/erpClient';
import {confirmCustomerReceipt} from '@/lib/customer-receipts';
import {businessDate} from '@/lib/business-date';
export function agingBucket(dueDate,asOf=businessDate()) {
  if(!dueDate || dueDate>=asOf)return 'current';
  const days=Math.floor((new Date(asOf)-new Date(dueDate))/86400000);
  return days<=30?'d1_30':days<=60?'d31_60':days<=90?'d61_90':'d90_plus';
}
export async function recordCustomerPayment({customer,amount,paymentDate,method,reference,allocations={},treasuryAccountId,requestKey}) {
  return confirmCustomerReceipt({customerId:customer.id,treasuryAccountId,amount,date:paymentDate,method,reference,requestKey:requestKey || crypto.randomUUID(),allocations:Object.entries(allocations).filter(([,value])=>Number(value)>0).map(([invoice_id,value])=>({invoice_id,amount:Number(value)}))});
}
// Bill payments are requests until General Manager approval and cash release.
export async function recordSupplierPayment({billId,treasuryAccountId,amount,paymentDate,reference,requestKey=crypto.randomUUID()}) {
  const {data}=await erp.functions.invoke('fieldOps',{action:'cashierRequestPayment',billId,accountId:treasuryAccountId,amount,date:paymentDate,reference,requestKey});
  return data.payment;
}
// Receiving has already posted Inventory / Payable. Register the source bill
// against that journal, without recognising the receipt a second time.
export async function createBillFromPO({po}) {
  const {data}=await erp.functions.invoke('fieldOps',{action:'registerSupplierBill',orderId:po.id});
  return data.bills[0];
}
