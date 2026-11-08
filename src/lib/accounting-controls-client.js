import {invalidateERPReads} from '@/api/erpClient';
export async function accountingControlRequest(area,body){
 const response=await fetch('/api/accounting/'+area,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok){const error=Error(data.error||'Accounting control could not be saved.');error.status=response.status;if(area==='degustation-appropriation'&&response.status===409&&data.diagnostics&&typeof data.diagnostics==='object'&&!Array.isArray(data.diagnostics))error.diagnostics=data.diagnostics;throw error;}if(body)invalidateERPReads();return data;
}
