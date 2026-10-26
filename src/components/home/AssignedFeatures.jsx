'use client';
import React from 'react';
import {ui} from '@/lib/i18n';
import {modulesForRole} from '@/lib/appModules';
import {moduleForPath} from '@/server/domain/role-catalogue';
import {WorkspaceAccess} from './WorkspaceAccess';
import {WorkspaceActions} from './WorkspaceParts';
const nativeModules={cashier:['cashier','accounting','purchases','expenses'],commercial:['commercial','customers','cashier'],driver:['distribution'],hotesse:['outlets']};
export default function AssignedFeatures({role,modules,preview=false}){
 if(!nativeModules[role]||!Array.isArray(modules))return null;
 const extras=modulesForRole(role,modules).filter(m=>!nativeModules[role].includes(moduleForPath(m.path)));
 if(!extras.length)return null;
 return <WorkspaceAccess modules={modules}><section className="mt-5 space-y-3" aria-label={ui('Assigned features')}><h2 className="text-sm font-semibold text-slate-700">{ui('Assigned features')}</h2><WorkspaceActions preview={preview} actions={extras.map(m=>({title:m.label,path:m.path,detail:m.description,icon:m.icon}))}/></section></WorkspaceAccess>;
}
