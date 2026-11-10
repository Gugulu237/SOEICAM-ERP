import { redirect } from 'next/navigation';
import { authenticateRequest } from '@/server/auth';
import { requireActiveContext } from '@/server/access';
import { assertModule } from '@/server/domain/role-catalogue';
import TeamWorkspaceScreen from '@/components/employees/TeamWorkspaceScreen';
export default async function Page({searchParams}) {
  let context;
  try { context = await authenticateRequest(); }
  catch (error) { if (error.status === 401) redirect('/login'); throw error; }
  if (context.role !== 'admin') {
    const params=await searchParams;
    if (requireActiveContext(context) !== 'cashier' || params?.section !== 'payroll') redirect('/');
    try { assertModule(context,'payroll'); }
    catch (error) { if (error.status === 403) redirect('/'); throw error; }
  }
  return <TeamWorkspaceScreen />;
}
