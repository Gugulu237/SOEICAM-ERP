import { authenticateRequest, apiError } from '@/server/auth';
import { entityStore } from '@/server/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  try {
    const context = await authenticateRequest('employees');
    if (context.role !== 'admin') throw Object.assign(new Error('Only the General Manager can view employee reports.'), { status: 403 });
    const { id } = await params;
    if (!id || typeof id !== 'string' || id.length > 100) throw Object.assign(new Error('Invalid employee ID.'), { status: 400 });
    const employee = await entityStore('Employee').get(id);
    if (!employee) throw Object.assign(new Error('Employee not found.'), { status: 404 });
    const queries = [
      ['requests', 'ExpenseRequest', { requester_id: id }, '-request_date'],
      ['sales', 'FieldSale', { commercial_id: id }, '-transaction_date'],
      ['deliveries', 'Dispatch', { $or: [{ driver_id: id }, { salesperson_id: id }] }, '-dispatch_date'],
      ['driverReports', 'DriverActivity', { driver_id: id }, '-recorded_at'],
      ['outletReports', 'OutletVisit', { employee_id: id }, '-visit_date'],
    ];
    const results = await Promise.allSettled(queries.map(([, entity, filter, sort]) => entityStore(entity).filter(filter, sort, 50)));
    const records = Object.fromEntries(queries.map(([key], index) => [key, results[index].status === 'fulfilled' ? results[index].value : []]));
    return Response.json({ employee, role: context.roleCatalogue?.roles?.[employee.role] || null, records, reportsIncomplete: results.some(result => result.status === 'rejected') }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
