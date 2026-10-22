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
