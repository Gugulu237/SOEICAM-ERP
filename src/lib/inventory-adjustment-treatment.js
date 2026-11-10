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
