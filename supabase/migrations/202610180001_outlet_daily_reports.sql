-- Legacy shelf observations remain unchanged. Daily reports are unique per
-- outlet and Cameroon business date, even with multiple assigned staff/retries.
CREATE UNIQUE INDEX IF NOT EXISTS outlet_visit_one_daily_report
  ON public.outlet_visit (location_id, visit_date)
  WHERE extra_data ->> 'report_type' = 'daily_sales';
