import {invalidateERPReads} from '@/api/erpClient';
export async function accountingControlRequest(area,body){
 const response=await fetch('/api/accounting/'+area,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Accounting control could not be saved.');if(body)invalidateERPReads();return data;
}
