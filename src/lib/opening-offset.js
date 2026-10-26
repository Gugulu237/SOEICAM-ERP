// Preview an explicit equity counterpart. No account is selected or created here.
export function openingOffset(totals,accountId,accounts=[]){
 if(!accountId)return {line:null,error:''};
 const account=accounts.find(a=>a.id===accountId);
 if(!account||account.account_type!=='equity'||account.normal_balance!=='credit'||account.is_active===false||account.is_posting===false||account.opening_recorded||account.is_control_account||account.currency&&account.currency!=='XAF')return {line:null,error:'Choose an unused posting equity account for the opening counterpart.'};
 if(totals.accounts.some(l=>l.account_id===accountId))return {line:null,error:'This equity account is already entered. Remove the automatic offset or choose a different account.'};
 const debit=Math.round(totals.debit*100),credit=Math.round(totals.credit*100);
 if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit<0||credit<0)return {line:null,error:'Complete valid opening amounts before calculating the counterpart.'};
 const difference=debit-credit;
 if(Math.abs(difference)>1e14)return {line:null,error:'The opening counterpart exceeds the supported amount.'};
 return {line:difference?{account_id:accountId,debit:difference<0?-difference/100:0,credit:difference>0?difference/100:0}:null,error:''};
}
