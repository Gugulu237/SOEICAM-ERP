-- Checked supplier operations store retry keys and receipt links in extra_data.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_save_request_unique ON public.supplier ((extra_data->>'supplier_request_key')) WHERE coalesce(extra_data->>'supplier_request_key','') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS supplier_order_request_unique ON public.purchase_order ((extra_data->>'supplier_request_key')) WHERE coalesce(extra_data->>'supplier_request_key','') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS supplier_receipt_request_unique ON public.goods_receipt ((extra_data->>'supplier_request_key')) WHERE coalesce(extra_data->>'supplier_request_key','') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS supplier_receipt_bill_unique ON public.bill ((extra_data->>'receipt_id')) WHERE coalesce(extra_data->>'receipt_id','') <> '' AND status <> 'cancelled';
