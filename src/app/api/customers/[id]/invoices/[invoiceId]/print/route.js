import {apiError} from '@/server/auth';
import {createClientFromRequest} from '@/server/request-client';
import {customerInvoicePrintDocument} from '@/server/domain/customer-invoice-print';
import {invoiceHtml} from '@/lib/invoice-documents';
import {translate} from '@/lib/i18n';
import {escapeReportText} from '@/lib/report-document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only the invoice toolbar's window.print() event may run in this document.
const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-hashes' 'sha256-MguIPR6qNR8D3B+eAlK+bIRTZe8t3wkOY4B/56Me9FU='; script-src-elem 'none'; style-src 'unsafe-inline'; img-src 'self' https: http:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(request, {params}) {
  let language = request.headers.get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  try {
    const client = await createClientFromRequest(request);
    const user = await client.auth.me();
    if (['fr','en'].includes(user?.preferred_language)) language = user.preferred_language;
    const {id, invoiceId} = await params;
    const document = await customerInvoicePrintDocument(client, id, invoiceId);
    return new Response(invoiceHtml(document), {headers});
  } catch (error) {
    const response = apiError(error);
    const {error: message} = await response.json();
    const title = escapeReportText(translate('Customer invoice', language));
    const detail = escapeReportText(translate(message, language));
    return new Response(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`, {status: response.status, headers});
  }
}
