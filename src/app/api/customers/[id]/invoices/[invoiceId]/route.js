import {apiError} from '@/server/auth';
import {createClientFromRequest} from '@/server/request-client';
import {customerInvoicePrintDocument} from '@/server/domain/customer-invoice-print';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, {params}) {
  try {
    const client = await createClientFromRequest(request);
    const {id, invoiceId} = await params;
    const original = new URL(request.url).searchParams.get('version') === 'original';
    const document = await customerInvoicePrintDocument(client, id, invoiceId, {original});
    return Response.json(document, {headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {
    return apiError(error);
  }
}
