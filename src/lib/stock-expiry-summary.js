import {businessDate} from './business-date.js';

const recordedDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
};

// A physical-stock summary of the already permitted balances. Unlike dispatch
// priority, this includes held, expired and outbound stock without releasing it.
export function stockExpirySummary(balances=[],today=businessDate()){
  const result=new Map();
  for(const balance of balances){
    if(!balance.product_id||!['number','string'].includes(typeof balance.quantity)||String(balance.quantity).trim()===''||!Number.isFinite(Number(balance.quantity))||Number(balance.quantity)<=0)continue;
    let entry=result.get(balance.product_id);
    if(!entry){entry={date:null,expired:false,positiveBatches:0,missingDates:0,invalidDates:0};result.set(balance.product_id,entry);}
    entry.positiveBatches++;
    const date=recordedDate(balance.expiry_date);
    if(date){if(!entry.date||date<entry.date)entry.date=date;}
    else if(balance.expiry_date==null||String(balance.expiry_date).trim()==='')entry.missingDates++;
    else entry.invalidDates++;
  }
  for(const entry of result.values())entry.expired=!!entry.date&&entry.date<today;
  return result;
}
