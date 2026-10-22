-- A delivery shelf check is an informational observation, separate from the
-- unique end-of-day report. No financial or warehouse table is changed.
CREATE UNIQUE INDEX IF NOT EXISTS outlet_visit_one_delivery_shelf_check
  ON public.outlet_visit (location_id, (extra_data ->> 'delivery_key'))
  WHERE extra_data ->> 'report_type' = 'delivery_shelf_check';
