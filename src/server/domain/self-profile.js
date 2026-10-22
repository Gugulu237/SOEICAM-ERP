import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {audit} from './field-ops.js';

const revisionOf=(user,employee)=>createHash('sha256').update(JSON.stringify([user.id,user.full_name || '',employee?.id || null,employee?.phone || ''])).digest('hex');

async function ownRecords(stores,context){
  requireActiveContext(context);
  const user=await stores.User.get(context.user.id);
  const employee=context.employee?.id ? await stores.Employee.get(context.employee.id) : null;
  if (!user || (context.employee && !employee) || (employee?.user_id && employee.user_id !== user.id)) throw forbidden('Your staff link changed. Reload your profile.');
  requireActiveContext({...context,user,employee});
  return {user,employee};
}

function projection(user,employee,context){
  return {
    id:user.id,employee_id:employee?.id || null,
    display_name:user.full_name || '',email:user.email || '',phone:employee?.phone || '',
    employee_name:employee?.full_name || '',employee_number:employee?.employee_number || '',
    job_title:employee?.job_title || '',role_label:context.employee?.role_label || context.roleCatalogue?.roles?.[context.role]?.label || (context.role==='admin' ? 'General Manager' : context.role || ''),
    can_edit_phone:Boolean(employee),profile_revision:revisionOf(user,employee),
  };
}

export async function readSelfProfile(stores,context){
  const {user,employee}=await ownRecords(stores,context);
  return projection(user,employee,context);
}

export async function saveSelfProfile(stores,context,input){
  const {user,employee}=await ownRecords(stores,context);
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['display_name','phone','profile_revision'].includes(key))) throw Error('Only your display name and contact phone may be changed here.');
  if (typeof input.display_name!=='string' || !input.display_name.trim() || input.display_name.trim().length>120 || /[\x00-\x1f\x7f]/.test(input.display_name)) throw Error('Enter a display name of 1 to 120 characters.');
  if (typeof input.phone!=='string' || input.phone.length>40 || (input.phone.trim() && (!/^[+()\d .-]+$/.test(input.phone.trim()) || input.phone.replace(/\D/g,'').length<3))) throw Error('Enter a valid contact phone number, or leave it blank.');
  if (typeof input.profile_revision!=='string' || !/^[a-f0-9]{64}$/.test(input.profile_revision)) throw Error('Reload your profile before saving.');
  const displayName=input.display_name.trim(),phone=input.phone.trim();
  if (!employee && phone) throw Error('A linked employee record is required to save a contact phone.');
  const changed=[];
  if (displayName !== (user.full_name || '')) changed.push('display_name');
  if (phone !== (employee?.phone || '')) changed.push('phone');
  // A retry of the same completed save is harmless. A stale edit of different
  // contact details must be reviewed instead of overwriting another window.
  if (changed.length && input.profile_revision !== revisionOf(user,employee)) throw Object.assign(Error('Your profile changed in another window. Reload it before saving.'),{status:409});
  let savedUser=user,savedEmployee=employee;
  if (changed.includes('display_name')) savedUser=await stores.User.update(user.id,{full_name:displayName});
  if (changed.includes('phone')) savedEmployee=await stores.Employee.update(employee.id,{phone});
  if (changed.length) await audit({entities:stores},{action:'update_own_profile',module:'profile',entityType:'User',entityId:user.id,userId:user.id,description:'Updated personal profile settings: '+changed.join(', ')});
  return projection(savedUser,savedEmployee,context);
}
