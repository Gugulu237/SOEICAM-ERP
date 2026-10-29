import { apiError, checkOrigin } from '@/server/auth';
import { transaction } from '@/server/db';
import fieldOps from '@/server/functions/fieldOps';
import customerReceipts from '@/server/functions/customerReceipts';
import { isReadOnlyFunction } from '@/lib/function-actions';
import { requestTiming, attachRequestTiming } from '@/server/request-timing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = { fieldOps, customerReceipts };
export async function POST(request,{ params }) {
  const timing = requestTiming();
  attachRequestTiming(request,timing);
  const respond = response => { response.headers.set('Cache-Control','private, no-store'); return timing.respond(response); };
  try {
    checkOrigin(request);
    const { name } = await params;
    if (!Object.hasOwn(handlers,name)) return respond(Response.json({ error:'Function not found' },{ status:404 }));
    const text = await request.clone().text();
    if (text.length > 2 * 1024 * 1024) return respond(Response.json({ error:'Request is too large.' },{ status:413 }));
    const body = JSON.parse(text);
    // Each retry needs an unread body and its own timing attachment. Keep the
    // original Request unconsumed so handlers can parse the complete payload.
    const invoke = () => {
      const attempt = request.clone();
      attachRequestTiming(attempt,timing);
      return handlers[name](attempt);
    };
    if (isReadOnlyFunction(name,body.action)) {
      const load = invoke;
      // Multi-page reports and stock comparisons need one consistent snapshot. Other dashboard
      // reads retain their existing transaction-free path.
      return respond(await timing.measure('handler',() => name === 'fieldOps' && ['assemblyBuildWorkspace','previewAssemblyBuild','yogurtWorkspace', 'warehouseAdjustmentWorkspace', 'existingStockWorkspace', 'cashFlowReport', 'inventoryAuditWorkspace', 'inventoryAuditDetail', 'fieldStockInventory', 'driverReturnsWorkspace', 'checkProductionMaterials', 'productionPurchaseOptions'].includes(body.action) ? transaction(load) : load()));
    }
    try {
      return respond(await timing.measure('transaction',() => transaction(async () => {
        const response = await invoke();
        if (response.status >= 400) throw Object.assign(new Error('Transaction rolled back'),{ response });
        return response;
      })));
    } catch(error) { if (error.response) return respond(error.response); throw error; }
  } catch(error) { return respond(apiError(error)); }
}
