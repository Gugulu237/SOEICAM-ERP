CREATE UNIQUE INDEX IF NOT EXISTS treasury_cashier_request_key_unique
ON public.treasury_transaction ((extra_data->>'cashier_request_key'))
WHERE coalesce(extra_data->>'cashier_request_key', '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS payment_cashier_request_key_unique
ON public.payment ((extra_data->>'cashier_request_key'))
WHERE coalesce(extra_data->>'cashier_request_key', '') <> '';
