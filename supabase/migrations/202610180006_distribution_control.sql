CREATE UNIQUE INDEX IF NOT EXISTS dispatch_distribution_request_unique
ON public.dispatch_request ((extra_data->>'distribution_request_key'))
WHERE coalesce(extra_data->>'distribution_request_key','') <> '';
