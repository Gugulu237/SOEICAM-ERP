import {monthIndex,shiftMonth,monthEnd} from './asset-schedule.js';

export const recurringExpenseAccount = account => account && ['expense','other_expense'].includes(account.account_type) && account.normal_balance==='debit' && account.is_posting!==false && !account.is_control_account && !account.is_treasury;
export function recurringVersion(schedule,month){
  monthIndex(month);
  return (schedule?.versions||[]).filter(v=>v.effective_month<=month).at(-1)||null;
}
export function recurringMonths(schedule,through){
  const start=schedule?.versions?.[0]?.effective_month;
  if(!start||start>through)return [];
  const count=monthIndex(through)-monthIndex(start)+1;
  if(count>1200)throw Error('Review recurring schedules older than 100 years.');
  return Array.from({length:count},(_,i)=>shiftMonth(start,i));
}
export function recurringDueDate(month,day){
  return month+'-'+String(Math.min(Number(day),Number(monthEnd(month).slice(-2)))).padStart(2,'0');
}
