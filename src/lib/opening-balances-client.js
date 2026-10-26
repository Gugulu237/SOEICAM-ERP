import {invalidateERPReads} from '@/api/erpClient';
export async function openingBalancesRequest(body){
 const response=await fetch('/api/accounting/opening-balances',{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Opening balances could not be saved.');
 if(body)invalidateERPReads();return data;
}
