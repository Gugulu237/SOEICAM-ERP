-- Preserve imported documents; checked issuance allocates once per source.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_checked_order_source
ON public.invoice (sales_order_id)
WHERE extra_data->>'accounting_source' = 'sales_order' AND status NOT IN ('cancelled','credited');
CREATE UNIQUE INDEX IF NOT EXISTS invoice_checked_field_source
ON public.invoice ((extra_data->>'field_sale_id'))
WHERE extra_data->>'accounting_source' = 'field_sale' AND status NOT IN ('cancelled','credited');
CREATE UNIQUE INDEX IF NOT EXISTS invoice_checked_number
ON public.invoice (invoice_number)
WHERE extra_data->>'accounting_source' IN ('sales_order','field_sale');
