-- Keep printed finished-production identities distinct. Existing labels remain unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS production_order_unique_batch
ON public.production_order (lower(btrim(batch_number)))
WHERE coalesce(btrim(batch_number), '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS production_order_request_key_unique
ON public.production_order ((extra_data->>'production_request_key'))
WHERE coalesce(extra_data->>'production_request_key', '') <> '';
CREATE INDEX IF NOT EXISTS stock_movement_batch_product
ON public.stock_movement (lot_number, product_id);
