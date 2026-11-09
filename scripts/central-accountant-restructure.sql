-- Requested organization change and one-time legacy promotional custody handoff.
-- Runs atomically; original roles, employee details and stock are retained in audit.
-- No journal, account balance, saleable quantity or physical return is created.
BEGIN;
DO $maintenance$
DECLARE
 cfg public.company_settings%rowtype;
 oldcat jsonb; nextcat jsonb; profiles jsonb; layout jsonb; pair record;
 actor public."user"%rowtype;
 role_profile jsonb := '{"key":"warehouse_manager","label":"Accountant","category":"Finance","template_role":"warehouse_manager","summary":"Manages centralized inventory and company accounting.","duties":["Controls company stock, receiving, counts and inventory adjustments","Follows goods taken for delivery manually outside the ERP","Records journals and maintains the chart of accounts","Reconciles receivables, payables, expenses and assets","Prepares financial statements and accounting reports"],"modules":["purchases","inventory","inventory_adjustments","manufacturing","quality","accounting","sales","sales_reports","customers","expenses","approvals","payroll"],"module_permissions_version":5}';
 source public.warehouse%rowtype; run public.dispatch%rowtype; lot public.stock_balance%rowtype;
 handoff_id text; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 qty numeric; original_cost numeric; originals jsonb; proof jsonb; before_staff jsonb;
 BEGIN
 SELECT * INTO STRICT actor FROM public."user" WHERE id='6a5164151d12cb92ecfede17' AND role='admin';
 SELECT * INTO STRICT cfg FROM public.company_settings FOR UPDATE;
 IF cfg.extra_data->'centralized_inventory'->>'enabled' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Centralized inventory must be active'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE id=cfg.extra_data->'centralized_inventory'->>'activation_id' AND action='activate_central_inventory') THEN RAISE EXCEPTION 'Missing activation evidence'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE id='ORG-CENTRAL-ACCOUNTANT-V1') THEN
  oldcat:=cfg.extra_data->'staff_role_catalogue';
  SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') INTO before_staff FROM public.employee e WHERE e.role IN ('warehouse_manager','driver');
  profiles:='{}';
  FOR pair IN SELECT key,value FROM jsonb_each(oldcat->'roles') LOOP
   IF pair.key='driver' THEN CONTINUE; END IF;
   profiles:=profiles||jsonb_build_object(pair.key,pair.value||jsonb_build_object('modules',coalesce((SELECT jsonb_agg(m) FROM jsonb_array_elements(pair.value->'modules') m WHERE m<>'"distribution"'::jsonb),'[]'::jsonb)));
  END LOOP;
  profiles:=profiles||jsonb_build_object('warehouse_manager',role_profile);
  profiles:=jsonb_set(profiles,'{commercial,summary}',to_jsonb('Records sales against centralized company stock.'::text));
  profiles:=jsonb_set(profiles,'{commercial,duties}','["Records customer sales against company stock","Records Degustation separately when given away","Collects cash and hands it over to the Cashier","Registers customers for acquisition and commission reporting"]');
  layout:='{}';
  FOR pair IN SELECT key,value FROM jsonb_each(oldcat->'layout') LOOP
   layout:=layout||jsonb_build_object(pair.key,coalesce((SELECT jsonb_agg(m) FROM jsonb_array_elements(pair.value) m WHERE m NOT IN ('"driver"'::jsonb,'"warehouse_manager"'::jsonb)),'[]'::jsonb));
  END LOOP;
  layout:=jsonb_set(layout,'{finance}',coalesce(layout->'finance','[]')||'"warehouse_manager"'::jsonb);
  nextcat:=oldcat||jsonb_build_object('roles',profiles,'layout',layout,'revision',coalesce((oldcat->>'revision')::int,0)+1,'organization_model','centralized-accountant-v1','deleted_roles',coalesce(oldcat->'deleted_roles','[]')||'"driver"'::jsonb,'deleted_role_profiles',coalesce(oldcat->'deleted_role_profiles','{}')||jsonb_build_object('driver',coalesce(oldcat->'roles'->'driver','{}')||jsonb_build_object('deleted_at',stamp,'deleted_by',actor.id,'reason','Delivery stock is followed manually by the Accountant; Driver position retired.')));
  UPDATE public.company_settings SET extra_data=jsonb_set(extra_data,'{staff_role_catalogue}',nextcat),updated_date=stamp WHERE id=cfg.id;
  UPDATE public.employee SET job_title='Accountant',responsibilities=(SELECT string_agg(d,E'\n') FROM jsonb_array_elements_text(role_profile->'duties') d),updated_date=stamp WHERE role='warehouse_manager' AND status='active';
  INSERT INTO public.audit_log(id,created_date,updated_date,user_id,user_name,action,module,entity_type,entity_id,description,extra_data)
   VALUES('ORG-CENTRAL-ACCOUNTANT-V1',stamp,stamp,actor.id,actor.full_name,'restructure_central_accounting','employees','CompanySettings',cfg.id,'Replaced Warehouse Keeper with Accountant; retired Driver and Distribution; retained employee identities and historic transactions.',jsonb_build_object('audit_source','server_verified','requested_via','ChatGPT','previous_catalogue',oldcat,'new_catalogue',nextcat,'previous_employees',before_staff));
 END IF;

 SELECT w.* INTO STRICT source FROM public.warehouse w JOIN public.employee e ON e.id=w.custodian_employee_id
  WHERE e.full_name='Mr. Jovaln Tsongang' AND e.status='active' AND w.warehouse_type='commercial_custody' AND w.extra_data->>'employee_delivery_custody'='true' FOR UPDATE OF w;
 SELECT * INTO STRICT run FROM public.dispatch WHERE vehicle_warehouse_id=source.id AND extra_data->'degustation_appropriation'->>'id' IS NOT NULL FOR UPDATE;
 handoff_id:='CPH-'||md5(run.id||':central-promotional-manual-v1');
 IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE id=handoff_id) THEN
  IF run.status NOT IN ('loaded','in_transit') THEN RAISE EXCEPTION 'Legacy load changed'; END IF;
  PERFORM 1 FROM public.stock_balance WHERE warehouse_id=source.id FOR UPDATE;
  SELECT sum(quantity),sum((extra_data->>'degustation_appropriation_value')::numeric),jsonb_agg((to_jsonb(b)-'extra_data')||b.extra_data ORDER BY b.id)
   INTO qty,original_cost,originals FROM public.stock_balance b WHERE warehouse_id=source.id AND quantity>0;
  IF qty IS DISTINCT FROM 13 OR original_cost IS DISTINCT FROM 3848.87 OR jsonb_array_length(originals)<>5 THEN RAISE EXCEPTION 'Review changed promotional quantities and original cost'; END IF;
  IF EXISTS(SELECT 1 FROM public.stock_balance WHERE warehouse_id=source.id AND (quantity<0 OR total_value<>0 OR quantity>0 AND (unit_cost<>0 OR extra_data->>'degustation_appropriation_id' IS DISTINCT FROM run.extra_data->'degustation_appropriation'->>'id' OR (extra_data->>'degustation_appropriation_quantity')::numeric IS DISTINCT FROM quantity))) THEN RAISE EXCEPTION 'Only verified, previously expensed promotional balances may be handed off'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.journal_entry WHERE id=run.extra_data->'degustation_appropriation'->>'journal_id' AND status='posted' AND total_debit=original_cost AND total_credit=original_cost) THEN RAISE EXCEPTION 'Original marketing expense must remain posted'; END IF;
  proof:=jsonb_build_object('policy','central-promotional-manual-v1','date','2026-11-10','activation_id',cfg.extra_data->'centralized_inventory'->>'activation_id','dispatch_id',run.id,'source_warehouse_id',source.id,'appropriation_id',run.extra_data->'degustation_appropriation'->>'id','total_quantity',qty,'original_cost',original_cost,'balances',originals);
  INSERT INTO public.audit_log(id,created_date,updated_date,user_id,user_name,action,module,entity_type,entity_id,description,extra_data)
   VALUES(handoff_id,stamp,stamp,actor.id,actor.full_name,'handoff_expensed_degustation','inventory','Dispatch',run.id,'Closed legacy employee stock assignment for manual Accountant follow-up. No customer giveaway, physical return, saleable stock addition or new expense is asserted.',jsonb_build_object('audit_source','server_verified','requested_via','ChatGPT','central_promotional_handoff',proof,'previous_dispatch',to_jsonb(run),'previous_warehouse',to_jsonb(source)));
  FOR lot IN SELECT * FROM public.stock_balance WHERE warehouse_id=source.id AND quantity>0 LOOP
   INSERT INTO public.stock_movement(id,created_date,updated_date,created_by,product_id,product_name,quantity,movement_type,source_warehouse_id,lot_number,expiry_date,unit_cost,total_value,document_type,document_id,reason,status,movement_date,extra_data)
    VALUES('CPHM-'||md5(handoff_id||lot.id),stamp,stamp,actor.id,lot.product_id,lot.product_name,lot.quantity,'promotional_issue',source.id,lot.lot_number,lot.expiry_date,0,0,'CentralPromotionalHandoff',handoff_id,'Legacy expensed promotional goods moved to manual tracking; no new consumption or expense.','approved','2026-11-10',jsonb_build_object('central_promotional_handoff_id',handoff_id,'central_promotional_source_balance_id',lot.id,'central_promotional_original_cost',(lot.extra_data->>'degustation_appropriation_value')::numeric,'dispatch_id',run.id,'recorded_by',actor.id,'production_order_id',lot.production_order_id,'batch_number',lot.extra_data->>'batch_number'));
   UPDATE public.stock_balance SET quantity=0,updated_date=stamp,extra_data=coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(lot.extra_data) WHERE key NOT LIKE 'degustation_appropriation_%'),'{}')||jsonb_build_object('central_promotional_handoff_id',handoff_id) WHERE id=lot.id;
  END LOOP;
  UPDATE public.warehouse SET is_active=false,updated_date=stamp,extra_data=extra_data||jsonb_build_object('central_promotional_handoff_id',handoff_id) WHERE id=source.id;
  UPDATE public.dispatch SET status='completed',closed_by=actor.id,closed_at=stamp,updated_date=stamp,extra_data=extra_data||jsonb_build_object('central_promotional_handoff_id',handoff_id,'central_promotional_manual_tracking',true) WHERE id=run.id;
 END IF;
END;
$maintenance$;
COMMIT;
