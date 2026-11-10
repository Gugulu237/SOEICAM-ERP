export const PAYSLIP_MONEY_FIELDS=['base_salary','allowances','variable_pay','unpaid_time_amount','statutory_deductions','other_deductions'];
export const payrollMoney=value=>{
  if(value==null || !['string','number'].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>1e12 || Math.round(Number(value)*100)/100!==Number(value))throw Error('Enter explicit non-negative payroll amounts with up to two decimal places.');
  return Number(value);
};
export function payslipAmounts(input) {
  const amounts=Object.fromEntries(PAYSLIP_MONEY_FIELDS.map(key=>[key,payrollMoney(input[key] ?? 0)]));
  const gross=Math.round((amounts.base_salary+amounts.allowances+amounts.variable_pay-amounts.unpaid_time_amount)*100)/100;
  const deductions=Math.round((amounts.statutory_deductions+amounts.other_deductions)*100)/100;
  const net=Math.round((gross-deductions)*100)/100;
  if(gross<0 || net<0 || gross>1e12)throw Error('Unpaid time and deductions cannot exceed the earned salary.');
  return {...amounts,gross_pay:gross,net_pay:net,total_deductions:deductions};
}


export function payrollPaymentDateFloor(run={}) {
  return [run.payroll_posted_date,run.payroll_approval_date].filter(value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)).sort().at(-1)||'';
}
export function payrollAccrualSuggestion(month,current) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||month>current.slice(0,7))return '';
  const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  return last<current?last:current;
}
export function salaryPaymentPreview({line,account,amount,date,reference,minDate,maxDate}) {
  let paid,outstanding,available;
  try{paid=payrollMoney(amount);}catch{return {valid:false,error:'Enter the actual salary payment amount.'};}
  if(paid<=0)return {valid:false,error:'Enter a positive salary payment amount.'};
  try{outstanding=payrollMoney(line?.outstanding_amount);}catch{return {valid:false,error:'Refresh the employee outstanding salary before payment.'};}
  if(paid>outstanding)return {valid:false,error:'The payment exceeds this employee’s outstanding salary.'};
  if(!account)return {valid:false,error:'Select the treasury account used for this payment.'};
  try{available=payrollMoney(account.balance);}catch{return {valid:false,error:'Refresh the selected treasury balance before payment.'};}
  if(paid>available)return {valid:false,error:'The payment exceeds the selected treasury balance.'};
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||!minDate||date<minDate||date>maxDate)return {valid:false,error:'Choose a payment date from payroll approval through today.'};
  if(typeof reference!=='string'||reference.trim().length<3||reference.trim().length>200)return {valid:false,error:'Enter the payment receipt or transfer reference.'};
  return {valid:true,amount:paid,remaining:Math.round((outstanding-paid)*100)/100,treasuryAfter:Math.round((available-paid)*100)/100};
}
