import {invalidateERPReads} from '@/api/erpClient';
export async function recurringExpenseRequest(body,query={}){
  const params=new URLSearchParams(Object.entries(query).filter(([,value])=>value));
  const response=await fetch('/api/accounting/recurring-expenses'+(params.size?'?'+params:''),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Recurring expenses could not be loaded.');
  if(body&&body.action!=='previewDueAccrual'){invalidateERPReads();if(typeof window!=='undefined')window.dispatchEvent(new Event('soeicam:recurring-expenses'));}return data;
}
