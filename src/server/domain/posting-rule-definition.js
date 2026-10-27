import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {validPostingRuleAccount} from '../../lib/posting-rule-types.js';
export async function preparePostingRule(stores,context,input,existing){
 if(requireActiveContext(context)!=='admin')throw forbidden('Only the General Manager can change posting rules.');assertModule({...context,role:'admin'},'accounting');
 if(Object.keys(input).some(k=>!['rule_key','label','description','account_id','account_name','account_number','is_active'].includes(k)))throw Error('Only posting-rule settings may be supplied.');
 const form={is_active:true,...existing,...input},key=String(form.rule_key||'');
 if(!/^[a-z][a-z0-9_]{2,100}$/.test(key)||existing&&key!==existing.rule_key)throw Error('Keep the original posting-rule key.');
 if((await readRecords(stores.PostingRule,{rule_key:key})).some(r=>r.id!==existing?.id))throw Error('Each posting-rule key must be unique.');
 const account=await stores.Account.get(form.account_id);
 if(!validPostingRuleAccount(account,key))throw Error('Choose an active account with the correct type and normal balance for this posting rule.');
 if(typeof form.is_active!=='boolean'||String(form.label||'').length>160||String(form.description||'').length>1000)throw Error('Enter valid posting-rule settings.');
 return {rule_key:key,label:String(form.label||key),description:String(form.description||''),account_id:account.id,account_number:account.account_number,account_name:account.name,is_active:form.is_active};
}
