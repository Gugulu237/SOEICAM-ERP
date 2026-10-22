import { redirect } from 'next/navigation';
import { authenticateRequest } from '@/server/auth';
import TeamWorkspaceScreen from '@/components/employees/TeamWorkspaceScreen';

export default async function Page() {
  let context;
  try { context = await authenticateRequest(); }
  catch (error) { if (error.status === 401) redirect('/login'); throw error; }
  if (context.role !== 'warehouse_manager' || context.employee?.assigned_role !== 'supply_chain_manager') redirect('/');
  return <TeamWorkspaceScreen />;
}
