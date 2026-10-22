import {redirect} from 'next/navigation';
export default async function PayrollPage({searchParams}){
 const params=await searchParams,query=new URLSearchParams({section:'payroll'});
 if(typeof params?.run==='string')query.set('run',params.run);
 redirect('/team-workspaces?'+query);
}
