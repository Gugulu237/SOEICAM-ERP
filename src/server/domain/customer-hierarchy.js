export async function prepareCustomerParent(stores,input,existing=null,context={}){
 if(!Object.hasOwn(input,'parent_id')&&!Object.hasOwn(input,'parent_name'))return input;
 const id=Object.hasOwn(input,'parent_id')?input.parent_id:existing?.parent_id||'';
 if(typeof id!=='string'||id.length>100)throw Error('Choose a valid parent customer.');
 if(!id)return {...input,parent_id:'',parent_name:''};
 if(id===existing?.id)throw Error('A customer cannot be its own parent.');
 const parent=await stores.Customer.get(id);
 if(!parent||parent.parent_id||parent.customer_removed_at||(parent.is_active===false&&id!==existing?.parent_id))throw Error('Choose an active main customer as the parent branch.');
 if(context.role==='commercial'&&parent.acquired_by_id!==context.employee?.id&&parent.salesperson_id!==context.employee?.id)throw Object.assign(Error('Choose a main customer registered by or assigned to you.'),{status:403});
 if(existing?.id&&id!==existing.parent_id){const children=await stores.Customer.filter({parent_id:existing.id},'id',1);if(children.length)throw Error('A main customer with branches cannot become a branch. Reassign its branches first.');}
 return {...input,parent_id:id,parent_name:parent.business_name||''};
}
