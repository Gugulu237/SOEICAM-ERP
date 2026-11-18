// Guards exist only while an edited form is mounted; no business data is persisted.
const guards=new Set();
export function registerFormGuard(guard){guards.add(guard);return()=>guards.delete(guard);}
export function canLeaveForms(){for(const guard of guards)if(!guard())return false;return true;}
