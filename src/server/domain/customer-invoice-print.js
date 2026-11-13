import {isPrintableCustomerInvoice} from '../../lib/customer-mobile-summary.js';
import {loadInvoiceDocument} from './sales-invoices.js';

const notFound = () => Object.assign(Error('Invoice not found.'), {status: 404});

export async function customerInvoicePrintDocument(client, customerId, invoiceId) {
  client.auth.assertModule('customers');

  // These reads use the same authenticated entity scope as the invoice history.
  const customer = await client.entities.Customer.get(customerId);
  if (!customer || customer.customer_removed_at) throw notFound();
  const invoice = await client.entities.Invoice.get(invoiceId);
  if (!isPrintableCustomerInvoice(invoice)) throw notFound();

  if (invoice.customer_id !== customer.id) {
    const billingCustomer = await client.entities.Customer.get(invoice.customer_id);
    if (!billingCustomer || billingCustomer.customer_removed_at) throw notFound();
    const billedThroughHeadquarters = customer.parent_id === billingCustomer.id
      && !billingCustomer.parent_id && invoice.location_id === customer.id;
    const billedToDirectBranch = !customer.parent_id && billingCustomer.parent_id === customer.id;
    if (!billedThroughHeadquarters && !billedToDirectBranch) throw notFound();
  }

  const document = await loadInvoiceDocument(client.asServiceRole.entities, invoiceId, invoice);
  if (!document.accounting_verified) {
    throw Object.assign(Error('The original invoice journal is missing, reversed or does not match this sale. Accounting review is required before printing or sharing an issued invoice.'), {status: 409});
  }
  return document;
}
