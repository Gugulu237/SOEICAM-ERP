-- Generated from all Base44 entity definitions. Original IDs and fields are preserved.

-- Business tables are accessible only through authenticated Next.js API routes.

create schema if not exists erp_private;

revoke all on schema erp_private from public, anon, authenticated;

create table if not exists public."account" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "account_number" text,
  "name" text,
  "account_type" text,
  "subtype" text,
  "financial_statement" text,
  "cash_flow_category" text,
  "parent_id" text,
  "normal_balance" text,
  "is_posting" boolean,
  "is_control_account" boolean,
  "allow_manual_journal" boolean,
  "is_treasury" boolean,
  "reconciliation_required" boolean,
  "branch_restriction" text,
  "currency" text,
  "currency_restriction" text,
  "is_active" boolean,
  "is_system" boolean,
  "is_sample" boolean,
  "description" text,
  "balance" numeric,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."account" enable row level security;

revoke all on public."account" from anon, authenticated;

grant all on public."account" to service_role;

create index if not exists "account_created_date_idx" on public."account" ("created_date");

create index if not exists "account_parent_id_idx" on public."account" ("parent_id");

create table if not exists public."accounting_period" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "name" text,
  "fiscal_year" text,
  "period_number" numeric,
  "start_date" text,
  "end_date" text,
  "status" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."accounting_period" enable row level security;

revoke all on public."accounting_period" from anon, authenticated;

grant all on public."accounting_period" to service_role;

create index if not exists "accounting_period_created_date_idx" on public."accounting_period" ("created_date");

create index if not exists "accounting_period_status_idx" on public."accounting_period" ("status");

create table if not exists public."audit_log" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "user_id" text,
  "user_name" text,
  "action" text,
  "module" text,
  "entity_type" text,
  "entity_id" text,
  "description" text,
  "previous_value" text,
  "new_value" text,
  "reason" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."audit_log" enable row level security;

revoke all on public."audit_log" from anon, authenticated;

grant all on public."audit_log" to service_role;

create index if not exists "audit_log_created_date_idx" on public."audit_log" ("created_date");

create index if not exists "audit_log_user_id_idx" on public."audit_log" ("user_id");

create index if not exists "audit_log_entity_id_idx" on public."audit_log" ("entity_id");

create table if not exists public."bill" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "bill_number" text,
  "supplier_id" text,
  "supplier_name" text,
  "po_id" text,
  "po_number" text,
  "bill_date" text,
  "due_date" text,
  "total" numeric,
  "amount_paid" numeric,
  "balance" numeric,
  "status" text,
  "journal_id" text,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."bill" enable row level security;

revoke all on public."bill" from anon, authenticated;

grant all on public."bill" to service_role;

create index if not exists "bill_created_date_idx" on public."bill" ("created_date");

create index if not exists "bill_supplier_id_idx" on public."bill" ("supplier_id");

create index if not exists "bill_po_id_idx" on public."bill" ("po_id");

create index if not exists "bill_status_idx" on public."bill" ("status");

create index if not exists "bill_journal_id_idx" on public."bill" ("journal_id");

create table if not exists public."branch" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "name" text,
  "code" text,
  "address" text,
  "city" text,
  "phone" text,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."branch" enable row level security;

revoke all on public."branch" from anon, authenticated;

grant all on public."branch" to service_role;

create index if not exists "branch_created_date_idx" on public."branch" ("created_date");

create table if not exists public."budget" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "department_id" text,
  "department_name" text,
  "period_id" text,
  "period_name" text,
  "budget_amount" numeric,
  "actual_spent" numeric,
  "remaining_amount" numeric,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."budget" enable row level security;

revoke all on public."budget" from anon, authenticated;

grant all on public."budget" to service_role;

create index if not exists "budget_created_date_idx" on public."budget" ("created_date");

create index if not exists "budget_department_id_idx" on public."budget" ("department_id");

create index if not exists "budget_period_id_idx" on public."budget" ("period_id");

create table if not exists public."cash_collection" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "collection_number" text,
  "field_sale_id" text,
  "sale_number" text,
  "invoice_id" text,
  "invoice_number" text,
  "customer_id" text,
  "customer_name" text,
  "commercial_id" text,
  "commercial_name" text,
  "driver_name" text,
  "vehicle_name" text,
  "payment_type" text,
  "amount_due" numeric,
  "amount_collected" numeric,
  "collection_date" text,
  "method" text,
  "reference" text,
  "receipt_reference" text,
  "receipt_file_uris" jsonb,
  "status" text,
  "handed_over_amount" numeric,
  "received_amount" numeric,
  "outstanding_amount" numeric,
  "handover_id" text,
  "handover_number" text,
  "treasury_account_id" text,
  "treasury_account_name" text,
  "received_by" text,
  "received_at" text,
  "acknowledgement_reference" text,
  "journal_id" text,
  "notes" text,
  "idempotency_key" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."cash_collection" enable row level security;

revoke all on public."cash_collection" from anon, authenticated;

grant all on public."cash_collection" to service_role;

create index if not exists "cash_collection_created_date_idx" on public."cash_collection" ("created_date");

create index if not exists "cash_collection_field_sale_id_idx" on public."cash_collection" ("field_sale_id");

create index if not exists "cash_collection_invoice_id_idx" on public."cash_collection" ("invoice_id");

create index if not exists "cash_collection_customer_id_idx" on public."cash_collection" ("customer_id");

create index if not exists "cash_collection_commercial_id_idx" on public."cash_collection" ("commercial_id");

create index if not exists "cash_collection_status_idx" on public."cash_collection" ("status");

create index if not exists "cash_collection_handover_id_idx" on public."cash_collection" ("handover_id");

create index if not exists "cash_collection_treasury_account_id_idx" on public."cash_collection" ("treasury_account_id");

create index if not exists "cash_collection_journal_id_idx" on public."cash_collection" ("journal_id");

create table if not exists public."cash_handover" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "handover_number" text,
  "commercial_id" text,
  "commercial_name" text,
  "cashier_id" text,
  "cashier_name" text,
  "handover_date" text,
  "expected_amount" numeric,
  "offered_amount" numeric,
  "received_amount" numeric,
  "variance" numeric,
  "variance_reason" text,
  "status" text,
  "submitted_at" text,
  "confirmed_at" text,
  "acknowledgement_reference" text,
  "treasury_account_id" text,
  "treasury_account_name" text,
  "journal_id" text,
  "journal_number" text,
  "notes" text,
  "idempotency_key" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."cash_handover" enable row level security;

revoke all on public."cash_handover" from anon, authenticated;

grant all on public."cash_handover" to service_role;

create index if not exists "cash_handover_created_date_idx" on public."cash_handover" ("created_date");

create index if not exists "cash_handover_commercial_id_idx" on public."cash_handover" ("commercial_id");

create index if not exists "cash_handover_cashier_id_idx" on public."cash_handover" ("cashier_id");

create index if not exists "cash_handover_status_idx" on public."cash_handover" ("status");

create index if not exists "cash_handover_treasury_account_id_idx" on public."cash_handover" ("treasury_account_id");

create index if not exists "cash_handover_journal_id_idx" on public."cash_handover" ("journal_id");

create table if not exists public."cash_handover_allocation" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "handover_id" text,
  "handover_number" text,
  "collection_id" text,
  "collection_number" text,
  "sale_number" text,
  "customer_name" text,
  "amount_allocated" numeric,
  "allocation_date" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."cash_handover_allocation" enable row level security;

revoke all on public."cash_handover_allocation" from anon, authenticated;

grant all on public."cash_handover_allocation" to service_role;

create index if not exists "cash_handover_allocation_created_date_idx" on public."cash_handover_allocation" ("created_date");

create index if not exists "cash_handover_allocation_handover_id_idx" on public."cash_handover_allocation" ("handover_id");

create index if not exists "cash_handover_allocation_collection_id_idx" on public."cash_handover_allocation" ("collection_id");

create table if not exists public."company_settings" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "company_name" text,
  "brand_name" text,
  "currency" text,
  "timezone" text,
  "fiscal_year_start_month" numeric,
  "current_fiscal_year" text,
  "address" text,
  "city" text,
  "country" text,
  "phone" text,
  "email" text,
  "tax_id" text,
  "logo_url" text,
  "default_language" text,
  "allow_negative_stock" boolean,
  "next_journal_number" numeric,
  "next_invoice_number" numeric,
  "next_po_number" numeric,
  "next_production_number" numeric,
  "next_delivery_number" numeric,
  "next_field_sale_number" numeric,
  "next_collection_number" numeric,
  "next_handover_number" numeric,
  "gps_max_accuracy_m" numeric,
  "gps_max_age_seconds" numeric,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."company_settings" enable row level security;

revoke all on public."company_settings" from anon, authenticated;

grant all on public."company_settings" to service_role;

create index if not exists "company_settings_created_date_idx" on public."company_settings" ("created_date");

create index if not exists "company_settings_email_idx" on public."company_settings" ("email");

create index if not exists "company_settings_tax_id_idx" on public."company_settings" ("tax_id");

create table if not exists public."customer" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "customer_number" text,
  "business_name" text,
  "parent_id" text,
  "parent_name" text,
  "contact_person" text,
  "phone" text,
  "whatsapp" text,
  "email" text,
  "tax_id" text,
  "category" text,
  "financial_centralization_mode" text,
  "address" text,
  "town" text,
  "neighbourhood" text,
  "gps_lat" numeric,
  "gps_lng" numeric,
  "gps_accuracy_m" numeric,
  "gps_captured_at" text,
  "delivery_instructions" text,
  "salesperson_id" text,
  "route_id" text,
  "delivery_days" text,
  "credit_limit" numeric,
  "max_overdue_days" numeric,
  "payment_terms_days" numeric,
  "price_list" text,
  "balance" numeric,
  "credit_status" text,
  "is_active" boolean,
  "notes" text,
  "acquired_by_id" text,
  "acquired_by_name" text,
  "acquisition_date" text,
  "acquisition_source" text,
  "acquisition_verified" text,
  "acquisition_verified_by" text,
  "acquisition_verified_at" text,
  "acquisition_notes" text,
  "registered_by_id" text,
  "registered_at" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."customer" enable row level security;

revoke all on public."customer" from anon, authenticated;

grant all on public."customer" to service_role;

create index if not exists "customer_created_date_idx" on public."customer" ("created_date");

create index if not exists "customer_parent_id_idx" on public."customer" ("parent_id");

create index if not exists "customer_email_idx" on public."customer" ("email");

create index if not exists "customer_tax_id_idx" on public."customer" ("tax_id");

create index if not exists "customer_salesperson_id_idx" on public."customer" ("salesperson_id");

create index if not exists "customer_route_id_idx" on public."customer" ("route_id");

create index if not exists "customer_acquired_by_id_idx" on public."customer" ("acquired_by_id");

create index if not exists "customer_registered_by_id_idx" on public."customer" ("registered_by_id");

create table if not exists public."customer_location" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "customer_id" text,
  "customer_name" text,
  "name" text,
  "code" text,
  "is_headquarters" boolean,
  "contact_person" text,
  "phone" text,
  "address" text,
  "town" text,
  "neighbourhood" text,
  "gps_lat" numeric,
  "gps_lng" numeric,
  "gps_accuracy_m" numeric,
  "gps_captured_at" text,
  "delivery_instructions" text,
  "assigned_commercial_id" text,
  "assigned_commercial_name" text,
  "assigned_hotesse_ids" jsonb,
  "route_id" text,
  "route_name" text,
  "delivery_days" text,
  "is_active" boolean,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."customer_location" enable row level security;

revoke all on public."customer_location" from anon, authenticated;

grant all on public."customer_location" to service_role;

create index if not exists "customer_location_created_date_idx" on public."customer_location" ("created_date");

create index if not exists "customer_location_customer_id_idx" on public."customer_location" ("customer_id");

create index if not exists "customer_location_assigned_commercial_id_idx" on public."customer_location" ("assigned_commercial_id");

create index if not exists "customer_location_route_id_idx" on public."customer_location" ("route_id");

create table if not exists public."department" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "name" text,
  "code" text,
  "branch_id" text,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."department" enable row level security;

revoke all on public."department" from anon, authenticated;

grant all on public."department" to service_role;

create index if not exists "department_created_date_idx" on public."department" ("created_date");

create index if not exists "department_branch_id_idx" on public."department" ("branch_id");

create table if not exists public."depreciation_entry" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "asset_id" text,
  "asset_number" text,
  "asset_name" text,
  "period_label" text,
  "depreciation_date" text,
  "amount" numeric,
  "accumulated_after" numeric,
  "net_book_value_after" numeric,
  "journal_id" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."depreciation_entry" enable row level security;

revoke all on public."depreciation_entry" from anon, authenticated;

grant all on public."depreciation_entry" to service_role;

create index if not exists "depreciation_entry_created_date_idx" on public."depreciation_entry" ("created_date");

create index if not exists "depreciation_entry_asset_id_idx" on public."depreciation_entry" ("asset_id");

create index if not exists "depreciation_entry_journal_id_idx" on public."depreciation_entry" ("journal_id");

create table if not exists public."dispatch" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "dispatch_number" text,
  "dispatch_date" text,
  "source" text,
  "request_id" text,
  "route_id" text,
  "route_name" text,
  "vehicle_id" text,
  "vehicle_name" text,
  "vehicle_warehouse_id" text,
  "driver_id" text,
  "driver_name" text,
  "salesperson_id" text,
  "salesperson_name" text,
  "warehouse_id" text,
  "warehouse_name" text,
  "departure_date" text,
  "return_date" text,
  "status" text,
  "approved_by" text,
  "approved_at" text,
  "loaded_by" text,
  "loaded_at" text,
  "closed_by" text,
  "closed_at" text,
  "total_loaded_value" numeric,
  "total_delivered_value" numeric,
  "total_returned_value" numeric,
  "total_cash_collected" numeric,
  "total_credit_sales" numeric,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."dispatch" enable row level security;

revoke all on public."dispatch" from anon, authenticated;

grant all on public."dispatch" to service_role;

create index if not exists "dispatch_created_date_idx" on public."dispatch" ("created_date");

create index if not exists "dispatch_request_id_idx" on public."dispatch" ("request_id");

create index if not exists "dispatch_route_id_idx" on public."dispatch" ("route_id");

create index if not exists "dispatch_vehicle_id_idx" on public."dispatch" ("vehicle_id");

create index if not exists "dispatch_vehicle_warehouse_id_idx" on public."dispatch" ("vehicle_warehouse_id");

create index if not exists "dispatch_driver_id_idx" on public."dispatch" ("driver_id");

create index if not exists "dispatch_salesperson_id_idx" on public."dispatch" ("salesperson_id");

create index if not exists "dispatch_warehouse_id_idx" on public."dispatch" ("warehouse_id");

create index if not exists "dispatch_status_idx" on public."dispatch" ("status");

create table if not exists public."dispatch_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "dispatch_id" text,
  "product_id" text,
  "product_name" text,
  "unit" text,
  "requested_quantity" numeric,
  "loaded_quantity" numeric,
  "returned_quantity" numeric,
  "unit_cost" numeric,
  "loaded_value" numeric,
  "unit_price" numeric,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."dispatch_line" enable row level security;

revoke all on public."dispatch_line" from anon, authenticated;

grant all on public."dispatch_line" to service_role;

create index if not exists "dispatch_line_created_date_idx" on public."dispatch_line" ("created_date");

create index if not exists "dispatch_line_dispatch_id_idx" on public."dispatch_line" ("dispatch_id");

create index if not exists "dispatch_line_product_id_idx" on public."dispatch_line" ("product_id");

create table if not exists public."dispatch_request" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "request_number" text,
  "driver_id" text,
  "driver_name" text,
  "vehicle_id" text,
  "vehicle_name" text,
  "route_id" text,
  "route_name" text,
  "source_warehouse_id" text,
  "source_warehouse_name" text,
  "request_date" text,
  "status" text,
  "notes" text,
  "items" jsonb,
  "dispatch_id" text,
  "approved_by" text,
  "approved_at" text,
  "rejected_by" text,
  "rejected_at" text,
  "rejection_reason" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."dispatch_request" enable row level security;

revoke all on public."dispatch_request" from anon, authenticated;

grant all on public."dispatch_request" to service_role;

create index if not exists "dispatch_request_created_date_idx" on public."dispatch_request" ("created_date");

create index if not exists "dispatch_request_driver_id_idx" on public."dispatch_request" ("driver_id");

create index if not exists "dispatch_request_vehicle_id_idx" on public."dispatch_request" ("vehicle_id");

create index if not exists "dispatch_request_route_id_idx" on public."dispatch_request" ("route_id");

create index if not exists "dispatch_request_source_warehouse_id_idx" on public."dispatch_request" ("source_warehouse_id");

create index if not exists "dispatch_request_status_idx" on public."dispatch_request" ("status");

create index if not exists "dispatch_request_dispatch_id_idx" on public."dispatch_request" ("dispatch_id");

create table if not exists public."driver_activity" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "request_key" text,
  "dispatch_id" text,
  "dispatch_number" text,
  "driver_id" text,
  "driver_name" text,
  "recorded_by" text,
  "recorded_at" text,
  "order_id" text,
  "customer_name" text,
  "receiver" text,
  "notes" text,
  "receipt_reference" text,
  "type" text,
  "proof_file_uris" jsonb,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."driver_activity" enable row level security;

revoke all on public."driver_activity" from anon, authenticated;

grant all on public."driver_activity" to service_role;

create index if not exists "driver_activity_created_date_idx" on public."driver_activity" ("created_date");

create index if not exists "driver_activity_dispatch_id_idx" on public."driver_activity" ("dispatch_id");

create index if not exists "driver_activity_driver_id_idx" on public."driver_activity" ("driver_id");

create index if not exists "driver_activity_order_id_idx" on public."driver_activity" ("order_id");

create table if not exists public."employee" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "employee_number" text,
  "full_name" text,
  "phone" text,
  "email" text,
  "job_title" text,
  "role" text,
  "responsibilities" text,
  "department_id" text,
  "branch_id" text,
  "contract_type" text,
  "start_date" text,
  "status" text,
  "base_salary" numeric,
  "payment_method" text,
  "bank_name" text,
  "bank_account" text,
  "mobile_money_number" text,
  "bonus_plan" text,
  "user_id" text,
  "user_email" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."employee" enable row level security;

revoke all on public."employee" from anon, authenticated;

grant all on public."employee" to service_role;

create index if not exists "employee_created_date_idx" on public."employee" ("created_date");

create index if not exists "employee_email_idx" on public."employee" ("email");

create index if not exists "employee_role_idx" on public."employee" ("role");

create index if not exists "employee_department_id_idx" on public."employee" ("department_id");

create index if not exists "employee_branch_id_idx" on public."employee" ("branch_id");

create index if not exists "employee_status_idx" on public."employee" ("status");

create index if not exists "employee_user_id_idx" on public."employee" ("user_id");

create table if not exists public."expense_request" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "request_number" text,
  "title" text,
  "requester_id" text,
  "requester_name" text,
  "payee" text,
  "petty_cash" boolean,
  "department_id" text,
  "department_name" text,
  "request_date" text,
  "amount" numeric,
  "category" text,
  "status" text,
  "justification" text,
  "receipt_url" text,
  "receipt_collected_at" text,
  "expense_account_id" text,
  "expense_account_number" text,
  "expense_account_name" text,
  "approved_by" text,
  "approved_at" text,
  "rejected_by" text,
  "rejected_at" text,
  "rejection_reason" text,
  "treasury_account_id" text,
  "treasury_account_name" text,
  "paid_by" text,
  "paid_at" text,
  "treasury_transaction_id" text,
  "journal_id" text,
  "budget_id" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."expense_request" enable row level security;

revoke all on public."expense_request" from anon, authenticated;

grant all on public."expense_request" to service_role;

create index if not exists "expense_request_created_date_idx" on public."expense_request" ("created_date");

create index if not exists "expense_request_requester_id_idx" on public."expense_request" ("requester_id");

create index if not exists "expense_request_department_id_idx" on public."expense_request" ("department_id");

create index if not exists "expense_request_status_idx" on public."expense_request" ("status");

create index if not exists "expense_request_expense_account_id_idx" on public."expense_request" ("expense_account_id");

create index if not exists "expense_request_treasury_account_id_idx" on public."expense_request" ("treasury_account_id");

create index if not exists "expense_request_treasury_transaction_id_idx" on public."expense_request" ("treasury_transaction_id");

create index if not exists "expense_request_journal_id_idx" on public."expense_request" ("journal_id");

create index if not exists "expense_request_budget_id_idx" on public."expense_request" ("budget_id");

create table if not exists public."field_sale" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "sale_number" text,
  "commercial_id" text,
  "commercial_name" text,
  "customer_id" text,
  "customer_name" text,
  "location_id" text,
  "location_name" text,
  "route_id" text,
  "transaction_date" text,
  "submitted_at" text,
  "status" text,
  "payment_type" text,
  "subtotal" numeric,
  "discount_total" numeric,
  "tax_total" numeric,
  "total" numeric,
  "cost_of_goods" numeric,
  "amount_collected" numeric,
  "collection_date" text,
  "amount_due" numeric,
  "due_date" text,
  "payment_terms_days" numeric,
  "receipt_reference" text,
  "receipt_file_uris" jsonb,
  "receipt_review_notes" text,
  "notes" text,
  "custodian_warehouse_id" text,
  "custody_issue_id" text,
  "stock_moved_at" text,
  "pending_warehouse_id" text,
  "journal_id" text,
  "journal_number" text,
  "posting_error" text,
  "approved_by" text,
  "approved_at" text,
  "decided_by" text,
  "decided_at" text,
  "decision_reason" text,
  "duplicate_flag" boolean,
  "duplicate_note" text,
  "idempotency_key" text,
  "credit_override_by" text,
  "credit_override_reason" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."field_sale" enable row level security;

revoke all on public."field_sale" from anon, authenticated;

grant all on public."field_sale" to service_role;

create index if not exists "field_sale_created_date_idx" on public."field_sale" ("created_date");

create index if not exists "field_sale_commercial_id_idx" on public."field_sale" ("commercial_id");

create index if not exists "field_sale_customer_id_idx" on public."field_sale" ("customer_id");

create index if not exists "field_sale_location_id_idx" on public."field_sale" ("location_id");

create index if not exists "field_sale_route_id_idx" on public."field_sale" ("route_id");

create index if not exists "field_sale_status_idx" on public."field_sale" ("status");

create index if not exists "field_sale_custodian_warehouse_id_idx" on public."field_sale" ("custodian_warehouse_id");

create index if not exists "field_sale_custody_issue_id_idx" on public."field_sale" ("custody_issue_id");

create index if not exists "field_sale_pending_warehouse_id_idx" on public."field_sale" ("pending_warehouse_id");

create index if not exists "field_sale_journal_id_idx" on public."field_sale" ("journal_id");

create table if not exists public."field_sale_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "field_sale_id" text,
  "product_id" text,
  "product_name" text,
  "unit" text,
  "quantity" numeric,
  "unit_price" numeric,
  "list_price" numeric,
  "discount" numeric,
  "tax_rate" numeric,
  "tax_amount" numeric,
  "line_total" numeric,
  "unit_cost" numeric,
  "line_cost" numeric,
  "lot_number" text,
  "expiry_date" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."field_sale_line" enable row level security;

revoke all on public."field_sale_line" from anon, authenticated;

grant all on public."field_sale_line" to service_role;

create index if not exists "field_sale_line_created_date_idx" on public."field_sale_line" ("created_date");

create index if not exists "field_sale_line_field_sale_id_idx" on public."field_sale_line" ("field_sale_id");

create index if not exists "field_sale_line_product_id_idx" on public."field_sale_line" ("product_id");

create table if not exists public."fixed_asset" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "asset_number" text,
  "name" text,
  "category" text,
  "description" text,
  "serial_number" text,
  "location" text,
  "branch_id" text,
  "supplier_id" text,
  "acquisition_date" text,
  "acquisition_cost" numeric,
  "salvage_value" numeric,
  "useful_life_months" numeric,
  "depreciation_method" text,
  "accumulated_depreciation" numeric,
  "net_book_value" numeric,
  "last_depreciation_date" text,
  "asset_account_id" text,
  "asset_account_number" text,
  "asset_account_name" text,
  "accum_dep_account_id" text,
  "accum_dep_account_number" text,
  "accum_dep_account_name" text,
  "expense_account_id" text,
  "expense_account_number" text,
  "expense_account_name" text,
  "status" text,
  "disposal_date" text,
  "disposal_proceeds" numeric,
  "disposal_gain_loss" numeric,
  "journal_id" text,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."fixed_asset" enable row level security;

revoke all on public."fixed_asset" from anon, authenticated;

grant all on public."fixed_asset" to service_role;

create index if not exists "fixed_asset_created_date_idx" on public."fixed_asset" ("created_date");

create index if not exists "fixed_asset_branch_id_idx" on public."fixed_asset" ("branch_id");

create index if not exists "fixed_asset_supplier_id_idx" on public."fixed_asset" ("supplier_id");

create index if not exists "fixed_asset_asset_account_id_idx" on public."fixed_asset" ("asset_account_id");

create index if not exists "fixed_asset_accum_dep_account_id_idx" on public."fixed_asset" ("accum_dep_account_id");

create index if not exists "fixed_asset_expense_account_id_idx" on public."fixed_asset" ("expense_account_id");

create index if not exists "fixed_asset_status_idx" on public."fixed_asset" ("status");

create index if not exists "fixed_asset_journal_id_idx" on public."fixed_asset" ("journal_id");

create table if not exists public."goods_receipt" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "receipt_number" text,
  "po_id" text,
  "supplier_id" text,
  "supplier_name" text,
  "warehouse_id" text,
  "receipt_date" text,
  "status" text,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."goods_receipt" enable row level security;

revoke all on public."goods_receipt" from anon, authenticated;

grant all on public."goods_receipt" to service_role;

create index if not exists "goods_receipt_created_date_idx" on public."goods_receipt" ("created_date");

create index if not exists "goods_receipt_po_id_idx" on public."goods_receipt" ("po_id");

create index if not exists "goods_receipt_supplier_id_idx" on public."goods_receipt" ("supplier_id");

create index if not exists "goods_receipt_warehouse_id_idx" on public."goods_receipt" ("warehouse_id");

create index if not exists "goods_receipt_status_idx" on public."goods_receipt" ("status");

create table if not exists public."goods_receipt_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "receipt_id" text,
  "po_line_id" text,
  "product_id" text,
  "product_name" text,
  "ordered_quantity" numeric,
  "received_quantity" numeric,
  "rejected_quantity" numeric,
  "damaged_quantity" numeric,
  "unit_cost" numeric,
  "lot_number" text,
  "expiry_date" text,
  "quality_status" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."goods_receipt_line" enable row level security;

revoke all on public."goods_receipt_line" from anon, authenticated;

grant all on public."goods_receipt_line" to service_role;

create index if not exists "goods_receipt_line_created_date_idx" on public."goods_receipt_line" ("created_date");

create index if not exists "goods_receipt_line_receipt_id_idx" on public."goods_receipt_line" ("receipt_id");

create index if not exists "goods_receipt_line_po_line_id_idx" on public."goods_receipt_line" ("po_line_id");

create index if not exists "goods_receipt_line_product_id_idx" on public."goods_receipt_line" ("product_id");

create table if not exists public."invoice" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "invoice_number" text,
  "customer_id" text,
  "customer_name" text,
  "location_id" text,
  "location_name" text,
  "bill_to_location_id" text,
  "bill_to_location_name" text,
  "billing_mode" text,
  "sales_order_id" text,
  "invoice_date" text,
  "due_date" text,
  "payment_type" text,
  "cash_deposited" boolean,
  "deposit_treasury_account_id" text,
  "deposit_treasury_account_name" text,
  "deposited_at" text,
  "deposited_by" text,
  "deposit_journal_id" text,
  "status" text,
  "subtotal" numeric,
  "tax_total" numeric,
  "total" numeric,
  "amount_paid" numeric,
  "balance" numeric,
  "journal_id" text,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."invoice" enable row level security;

revoke all on public."invoice" from anon, authenticated;

grant all on public."invoice" to service_role;

create index if not exists "invoice_created_date_idx" on public."invoice" ("created_date");

create index if not exists "invoice_customer_id_idx" on public."invoice" ("customer_id");

create index if not exists "invoice_location_id_idx" on public."invoice" ("location_id");

create index if not exists "invoice_bill_to_location_id_idx" on public."invoice" ("bill_to_location_id");

create index if not exists "invoice_sales_order_id_idx" on public."invoice" ("sales_order_id");

create index if not exists "invoice_deposit_treasury_account_id_idx" on public."invoice" ("deposit_treasury_account_id");

create index if not exists "invoice_deposit_journal_id_idx" on public."invoice" ("deposit_journal_id");

create index if not exists "invoice_status_idx" on public."invoice" ("status");

create index if not exists "invoice_journal_id_idx" on public."invoice" ("journal_id");

create table if not exists public."invoice_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "invoice_id" text,
  "product_id" text,
  "product_name" text,
  "quantity" numeric,
  "unit" text,
  "unit_price" numeric,
  "discount_amount" numeric,
  "tax_amount" numeric,
  "total" numeric,
  "unit_cost" numeric,
  "cogs_total" numeric,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."invoice_line" enable row level security;

revoke all on public."invoice_line" from anon, authenticated;

grant all on public."invoice_line" to service_role;

create index if not exists "invoice_line_created_date_idx" on public."invoice_line" ("created_date");

create index if not exists "invoice_line_invoice_id_idx" on public."invoice_line" ("invoice_id");

create index if not exists "invoice_line_product_id_idx" on public."invoice_line" ("product_id");

create table if not exists public."journal_entry" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "journal_number" text,
  "entry_date" text,
  "description" text,
  "source_module" text,
  "source_document_type" text,
  "source_document_id" text,
  "branch_id" text,
  "status" text,
  "total_debit" numeric,
  "total_credit" numeric,
  "posted_by" text,
  "posted_at" text,
  "reversal_of" text,
  "reversed_by_journal" text,
  "period_id" text,
  "is_immutable" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."journal_entry" enable row level security;

revoke all on public."journal_entry" from anon, authenticated;

grant all on public."journal_entry" to service_role;

create index if not exists "journal_entry_created_date_idx" on public."journal_entry" ("created_date");

create index if not exists "journal_entry_source_document_id_idx" on public."journal_entry" ("source_document_id");

create index if not exists "journal_entry_branch_id_idx" on public."journal_entry" ("branch_id");

create index if not exists "journal_entry_status_idx" on public."journal_entry" ("status");

create index if not exists "journal_entry_period_id_idx" on public."journal_entry" ("period_id");

create table if not exists public."journal_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "journal_id" text,
  "status" text,
  "account_id" text,
  "account_number" text,
  "account_name" text,
  "debit" numeric,
  "credit" numeric,
  "description" text,
  "branch_id" text,
  "department_id" text,
  "party_type" text,
  "party_id" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."journal_line" enable row level security;

revoke all on public."journal_line" from anon, authenticated;

grant all on public."journal_line" to service_role;

create index if not exists "journal_line_created_date_idx" on public."journal_line" ("created_date");

create index if not exists "journal_line_journal_id_idx" on public."journal_line" ("journal_id");

create index if not exists "journal_line_status_idx" on public."journal_line" ("status");

create index if not exists "journal_line_account_id_idx" on public."journal_line" ("account_id");

create index if not exists "journal_line_branch_id_idx" on public."journal_line" ("branch_id");

create index if not exists "journal_line_department_id_idx" on public."journal_line" ("department_id");

create index if not exists "journal_line_party_id_idx" on public."journal_line" ("party_id");

create table if not exists public."outlet_visit" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "request_key" text,
  "employee_id" text,
  "employee_name" text,
  "location_id" text,
  "location_name" text,
  "customer_id" text,
  "customer_name" text,
  "recorded_by" text,
  "recorded_at" text,
  "visit_date" text,
  "notes" text,
  "reviewed_by" text,
  "reviewed_at" text,
  "review_notes" text,
  "status" text,
  "has_concerns" boolean,
  "proof_file_uris" jsonb,
  "lines" jsonb,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."outlet_visit" enable row level security;

revoke all on public."outlet_visit" from anon, authenticated;

grant all on public."outlet_visit" to service_role;

create index if not exists "outlet_visit_created_date_idx" on public."outlet_visit" ("created_date");

create index if not exists "outlet_visit_employee_id_idx" on public."outlet_visit" ("employee_id");

create index if not exists "outlet_visit_location_id_idx" on public."outlet_visit" ("location_id");

create index if not exists "outlet_visit_customer_id_idx" on public."outlet_visit" ("customer_id");

create index if not exists "outlet_visit_status_idx" on public."outlet_visit" ("status");

create table if not exists public."payment" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "payment_number" text,
  "payment_type" text,
  "party_type" text,
  "party_id" text,
  "party_name" text,
  "payment_date" text,
  "amount" numeric,
  "payment_method" text,
  "reference" text,
  "account_id" text,
  "treasury_account_id" text,
  "treasury_account_name" text,
  "status" text,
  "journal_id" text,
  "po_id" text,
  "prepared_by" text,
  "prepared_at" text,
  "approved_by" text,
  "approved_at" text,
  "rejected_by" text,
  "rejected_at" text,
  "rejection_reason" text,
  "disbursed_by" text,
  "disbursed_at" text,
  "cheque_gm_signed_by" text,
  "cheque_gm_signed_at" text,
  "cheque_pm_signed_by" text,
  "cheque_pm_signed_at" text,
  "notes" text,
  "allocated_to_invoices" text,
  "invoice_numbers" text,
  "cashier_confirmed_by" text,
  "cashier_confirmed_name" text,
  "cashier_confirmed_at" text,
  "collection_id" text,
  "receipt_request_key" text,
  "receipt_posting_token" text,
  "receipt_posting_error" text,
  "receipt_posting_snapshot" jsonb,
  "receipt_allocations" jsonb,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."payment" enable row level security;

revoke all on public."payment" from anon, authenticated;

grant all on public."payment" to service_role;

create index if not exists "payment_created_date_idx" on public."payment" ("created_date");

create index if not exists "payment_party_id_idx" on public."payment" ("party_id");

create index if not exists "payment_account_id_idx" on public."payment" ("account_id");

create index if not exists "payment_treasury_account_id_idx" on public."payment" ("treasury_account_id");

create index if not exists "payment_status_idx" on public."payment" ("status");

create index if not exists "payment_journal_id_idx" on public."payment" ("journal_id");

create index if not exists "payment_po_id_idx" on public."payment" ("po_id");

create index if not exists "payment_collection_id_idx" on public."payment" ("collection_id");

create table if not exists public."payment_allocation" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "payment_id" text,
  "payment_number" text,
  "document_type" text,
  "document_id" text,
  "document_number" text,
  "party_type" text,
  "party_id" text,
  "party_name" text,
  "amount" numeric,
  "allocation_date" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."payment_allocation" enable row level security;

revoke all on public."payment_allocation" from anon, authenticated;

grant all on public."payment_allocation" to service_role;

create index if not exists "payment_allocation_created_date_idx" on public."payment_allocation" ("created_date");

create index if not exists "payment_allocation_payment_id_idx" on public."payment_allocation" ("payment_id");

create index if not exists "payment_allocation_document_id_idx" on public."payment_allocation" ("document_id");

create index if not exists "payment_allocation_party_id_idx" on public."payment_allocation" ("party_id");

create table if not exists public."payroll_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "payroll_id" text,
  "employee_id" text,
  "employee_name" text,
  "base_salary" numeric,
  "allowances" numeric,
  "overtime" numeric,
  "bonus" numeric,
  "commission" numeric,
  "gross_pay" numeric,
  "statutory_deductions" numeric,
  "other_deductions" numeric,
  "loan_repayment" numeric,
  "salary_advance" numeric,
  "net_pay" numeric,
  "status" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."payroll_line" enable row level security;

revoke all on public."payroll_line" from anon, authenticated;

grant all on public."payroll_line" to service_role;

create index if not exists "payroll_line_created_date_idx" on public."payroll_line" ("created_date");

create index if not exists "payroll_line_payroll_id_idx" on public."payroll_line" ("payroll_id");

create index if not exists "payroll_line_employee_id_idx" on public."payroll_line" ("employee_id");

create index if not exists "payroll_line_status_idx" on public."payroll_line" ("status");

create table if not exists public."payroll_run" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "period_name" text,
  "month" numeric,
  "year" numeric,
  "status" text,
  "total_gross" numeric,
  "total_deductions" numeric,
  "total_net" numeric,
  "employee_count" numeric,
  "journal_id" text,
  "approved_by" text,
  "approved_at" text,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."payroll_run" enable row level security;

revoke all on public."payroll_run" from anon, authenticated;

grant all on public."payroll_run" to service_role;

create index if not exists "payroll_run_created_date_idx" on public."payroll_run" ("created_date");

create index if not exists "payroll_run_status_idx" on public."payroll_run" ("status");

create index if not exists "payroll_run_journal_id_idx" on public."payroll_run" ("journal_id");

create table if not exists public."posting_rule" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "rule_key" text,
  "label" text,
  "account_id" text,
  "account_number" text,
  "account_name" text,
  "description" text,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."posting_rule" enable row level security;

revoke all on public."posting_rule" from anon, authenticated;

grant all on public."posting_rule" to service_role;

create index if not exists "posting_rule_created_date_idx" on public."posting_rule" ("created_date");

create index if not exists "posting_rule_account_id_idx" on public."posting_rule" ("account_id");

create table if not exists public."product" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "sku" text,
  "name" text,
  "description" text,
  "image_url" text,
  "category" text,
  "flavor" text,
  "size" text,
  "inventory_type" text,
  "components" jsonb,
  "purchase_unit" text,
  "storage_unit" text,
  "production_unit" text,
  "sales_unit" text,
  "purchase_to_storage_factor" numeric,
  "storage_to_production_factor" numeric,
  "storage_to_sales_factor" numeric,
  "costing_method" text,
  "current_cost" numeric,
  "standard_cost" numeric,
  "selling_price" numeric,
  "reorder_level" numeric,
  "min_stock" numeric,
  "max_stock" numeric,
  "preferred_supplier_id" text,
  "lot_tracking" boolean,
  "expiry_tracking" boolean,
  "shelf_life_days" numeric,
  "is_active" boolean,
  "tax_rate" numeric,
  "inventory_account_id" text,
  "cogs_account_id" text,
  "revenue_account_id" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."product" enable row level security;

revoke all on public."product" from anon, authenticated;

grant all on public."product" to service_role;

create index if not exists "product_created_date_idx" on public."product" ("created_date");

create index if not exists "product_preferred_supplier_id_idx" on public."product" ("preferred_supplier_id");

create index if not exists "product_inventory_account_id_idx" on public."product" ("inventory_account_id");

create index if not exists "product_cogs_account_id_idx" on public."product" ("cogs_account_id");

create index if not exists "product_revenue_account_id_idx" on public."product" ("revenue_account_id");

create table if not exists public."production_material" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "production_order_id" text,
  "material_id" text,
  "material_name" text,
  "standard_quantity" numeric,
  "issued_quantity" numeric,
  "returned_quantity" numeric,
  "consumed_quantity" numeric,
  "wastage_quantity" numeric,
  "unit" text,
  "unit_cost" numeric,
  "total_cost" numeric,
  "lot_number" text,
  "expiry_date" text,
  "is_substitute" boolean,
  "original_material_id" text,
  "substitution_reason" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."production_material" enable row level security;

revoke all on public."production_material" from anon, authenticated;

grant all on public."production_material" to service_role;

create index if not exists "production_material_created_date_idx" on public."production_material" ("created_date");

create index if not exists "production_material_production_order_id_idx" on public."production_material" ("production_order_id");

create index if not exists "production_material_material_id_idx" on public."production_material" ("material_id");

create index if not exists "production_material_original_material_id_idx" on public."production_material" ("original_material_id");

create table if not exists public."production_order" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "order_number" text,
  "product_id" text,
  "product_name" text,
  "recipe_id" text,
  "planned_output" numeric,
  "actual_output" numeric,
  "rejected_output" numeric,
  "production_date" text,
  "warehouse_id" text,
  "batch_number" text,
  "expiry_date" text,
  "status" text,
  "standard_cost_per_unit" numeric,
  "actual_cost_per_unit" numeric,
  "total_material_cost" numeric,
  "notes" text,
  "approved_by" text,
  "approved_at" text,
  "materials_issued_by" text,
  "materials_issued_at" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."production_order" enable row level security;

revoke all on public."production_order" from anon, authenticated;

grant all on public."production_order" to service_role;

create index if not exists "production_order_created_date_idx" on public."production_order" ("created_date");

create index if not exists "production_order_product_id_idx" on public."production_order" ("product_id");

create index if not exists "production_order_recipe_id_idx" on public."production_order" ("recipe_id");

create index if not exists "production_order_warehouse_id_idx" on public."production_order" ("warehouse_id");

create index if not exists "production_order_status_idx" on public."production_order" ("status");

create table if not exists public."purchase_item" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "item_code" text,
  "name" text,
  "category" text,
  "category_label" text,
  "description" text,
  "unit" text,
  "estimated_cost" numeric,
  "default_supplier_id" text,
  "default_supplier_name" text,
  "default_account_id" text,
  "default_account_number" text,
  "default_account_name" text,
  "is_asset" boolean,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."purchase_item" enable row level security;

revoke all on public."purchase_item" from anon, authenticated;

grant all on public."purchase_item" to service_role;

create index if not exists "purchase_item_created_date_idx" on public."purchase_item" ("created_date");

create index if not exists "purchase_item_default_supplier_id_idx" on public."purchase_item" ("default_supplier_id");

create index if not exists "purchase_item_default_account_id_idx" on public."purchase_item" ("default_account_id");

create table if not exists public."purchase_order" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "po_number" text,
  "supplier_id" text,
  "supplier_name" text,
  "warehouse_id" text,
  "requested_department_id" text,
  "requested_department_name" text,
  "requested_by_id" text,
  "requested_by_name" text,
  "requested_by_title" text,
  "request_date" text,
  "order_date" text,
  "expected_date" text,
  "payment_terms" text,
  "cash_disbursed" boolean,
  "cash_treasury_account_id" text,
  "cash_treasury_account_name" text,
  "cash_disbursed_at" text,
  "cash_disbursed_by" text,
  "cash_journal_id" text,
  "status" text,
  "subtotal" numeric,
  "tax_total" numeric,
  "total" numeric,
  "notes" text,
  "approved_by" text,
  "approved_at" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."purchase_order" enable row level security;

revoke all on public."purchase_order" from anon, authenticated;

grant all on public."purchase_order" to service_role;

create index if not exists "purchase_order_created_date_idx" on public."purchase_order" ("created_date");

create index if not exists "purchase_order_supplier_id_idx" on public."purchase_order" ("supplier_id");

create index if not exists "purchase_order_warehouse_id_idx" on public."purchase_order" ("warehouse_id");

create index if not exists "purchase_order_requested_department_id_idx" on public."purchase_order" ("requested_department_id");

create index if not exists "purchase_order_requested_by_id_idx" on public."purchase_order" ("requested_by_id");

create index if not exists "purchase_order_cash_treasury_account_id_idx" on public."purchase_order" ("cash_treasury_account_id");

create index if not exists "purchase_order_cash_journal_id_idx" on public."purchase_order" ("cash_journal_id");

create index if not exists "purchase_order_status_idx" on public."purchase_order" ("status");

create table if not exists public."purchase_order_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "po_id" text,
  "supplier_id" text,
  "supplier_name" text,
  "product_id" text,
  "product_name" text,
  "quantity" numeric,
  "unit" text,
  "unit_price" numeric,
  "tax_rate" numeric,
  "tax_amount" numeric,
  "total" numeric,
  "received_quantity" numeric,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."purchase_order_line" enable row level security;

revoke all on public."purchase_order_line" from anon, authenticated;

grant all on public."purchase_order_line" to service_role;

create index if not exists "purchase_order_line_created_date_idx" on public."purchase_order_line" ("created_date");

create index if not exists "purchase_order_line_po_id_idx" on public."purchase_order_line" ("po_id");

create index if not exists "purchase_order_line_supplier_id_idx" on public."purchase_order_line" ("supplier_id");

create index if not exists "purchase_order_line_product_id_idx" on public."purchase_order_line" ("product_id");

create table if not exists public."quality_check" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "production_order_id" text,
  "batch_number" text,
  "check_date" text,
  "inspector_id" text,
  "inspector_name" text,
  "temperature" numeric,
  "ph_level" numeric,
  "taste" text,
  "texture" text,
  "appearance" text,
  "smell" text,
  "seal_quality" text,
  "packaging_integrity" text,
  "overall_status" text,
  "comments" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."quality_check" enable row level security;

revoke all on public."quality_check" from anon, authenticated;

grant all on public."quality_check" to service_role;

create index if not exists "quality_check_created_date_idx" on public."quality_check" ("created_date");

create index if not exists "quality_check_production_order_id_idx" on public."quality_check" ("production_order_id");

create index if not exists "quality_check_inspector_id_idx" on public."quality_check" ("inspector_id");

create table if not exists public."recipe" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "product_id" text,
  "product_name" text,
  "recipe_name" text,
  "version" numeric,
  "effective_date" text,
  "expiry_date" text,
  "batch_output" numeric,
  "output_unit" text,
  "expected_yield_pct" numeric,
  "wastage_limit_pct" numeric,
  "status" text,
  "approved_by" text,
  "approved_at" text,
  "notes" text,
  "change_reason" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."recipe" enable row level security;

revoke all on public."recipe" from anon, authenticated;

grant all on public."recipe" to service_role;

create index if not exists "recipe_created_date_idx" on public."recipe" ("created_date");

create index if not exists "recipe_product_id_idx" on public."recipe" ("product_id");

create index if not exists "recipe_status_idx" on public."recipe" ("status");

create table if not exists public."recipe_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "recipe_id" text,
  "material_id" text,
  "material_name" text,
  "material_type" text,
  "quantity" numeric,
  "unit" text,
  "expected_wastage_pct" numeric,
  "allow_substitution" boolean,
  "substitute_material_id" text,
  "sequence" numeric,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."recipe_line" enable row level security;

revoke all on public."recipe_line" from anon, authenticated;

grant all on public."recipe_line" to service_role;

create index if not exists "recipe_line_created_date_idx" on public."recipe_line" ("created_date");

create index if not exists "recipe_line_recipe_id_idx" on public."recipe_line" ("recipe_id");

create index if not exists "recipe_line_material_id_idx" on public."recipe_line" ("material_id");

create index if not exists "recipe_line_substitute_material_id_idx" on public."recipe_line" ("substitute_material_id");

create table if not exists public."route" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "name" text,
  "code" text,
  "branch_id" text,
  "default_vehicle_id" text,
  "default_driver_id" text,
  "default_salesperson_id" text,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."route" enable row level security;

revoke all on public."route" from anon, authenticated;

grant all on public."route" to service_role;

create index if not exists "route_created_date_idx" on public."route" ("created_date");

create index if not exists "route_branch_id_idx" on public."route" ("branch_id");

create index if not exists "route_default_vehicle_id_idx" on public."route" ("default_vehicle_id");

create index if not exists "route_default_driver_id_idx" on public."route" ("default_driver_id");

create index if not exists "route_default_salesperson_id_idx" on public."route" ("default_salesperson_id");

create table if not exists public."sales_order" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "order_number" text,
  "customer_id" text,
  "customer_name" text,
  "location_id" text,
  "location_name" text,
  "branch_id" text,
  "warehouse_id" text,
  "vehicle_id" text,
  "vehicle_name" text,
  "driver_id" text,
  "driver_name" text,
  "salesperson_id" text,
  "salesperson_name" text,
  "route_id" text,
  "dispatch_id" text,
  "order_date" text,
  "delivery_date" text,
  "payment_type" text,
  "payment_terms_days" numeric,
  "status" text,
  "subtotal" numeric,
  "discount_total" numeric,
  "tax_total" numeric,
  "total" numeric,
  "notes" text,
  "credit_override_by" text,
  "credit_override_reason" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."sales_order" enable row level security;

revoke all on public."sales_order" from anon, authenticated;

grant all on public."sales_order" to service_role;

create index if not exists "sales_order_created_date_idx" on public."sales_order" ("created_date");

create index if not exists "sales_order_customer_id_idx" on public."sales_order" ("customer_id");

create index if not exists "sales_order_location_id_idx" on public."sales_order" ("location_id");

create index if not exists "sales_order_branch_id_idx" on public."sales_order" ("branch_id");

create index if not exists "sales_order_warehouse_id_idx" on public."sales_order" ("warehouse_id");

create index if not exists "sales_order_vehicle_id_idx" on public."sales_order" ("vehicle_id");

create index if not exists "sales_order_driver_id_idx" on public."sales_order" ("driver_id");

create index if not exists "sales_order_salesperson_id_idx" on public."sales_order" ("salesperson_id");

create index if not exists "sales_order_route_id_idx" on public."sales_order" ("route_id");

create index if not exists "sales_order_dispatch_id_idx" on public."sales_order" ("dispatch_id");

create index if not exists "sales_order_status_idx" on public."sales_order" ("status");

create table if not exists public."sales_order_line" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "order_id" text,
  "product_id" text,
  "product_name" text,
  "quantity" numeric,
  "unit" text,
  "unit_price" numeric,
  "discount_pct" numeric,
  "discount_amount" numeric,
  "tax_rate" numeric,
  "tax_amount" numeric,
  "total" numeric,
  "delivered_quantity" numeric,
  "lot_number" text,
  "unit_cost" numeric,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."sales_order_line" enable row level security;

revoke all on public."sales_order_line" from anon, authenticated;

grant all on public."sales_order_line" to service_role;

create index if not exists "sales_order_line_created_date_idx" on public."sales_order_line" ("created_date");

create index if not exists "sales_order_line_order_id_idx" on public."sales_order_line" ("order_id");

create index if not exists "sales_order_line_product_id_idx" on public."sales_order_line" ("product_id");

create table if not exists public."spoilage_record" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "record_number" text,
  "customer_id" text,
  "customer_name" text,
  "location_id" text,
  "location_name" text,
  "product_id" text,
  "product_name" text,
  "quantity" numeric,
  "unit" text,
  "unit_cost" numeric,
  "total_value" numeric,
  "reported_date" text,
  "dispatch_id" text,
  "reason" text,
  "status" text,
  "replaced_by" text,
  "replaced_at" text,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."spoilage_record" enable row level security;

revoke all on public."spoilage_record" from anon, authenticated;

grant all on public."spoilage_record" to service_role;

create index if not exists "spoilage_record_created_date_idx" on public."spoilage_record" ("created_date");

create index if not exists "spoilage_record_customer_id_idx" on public."spoilage_record" ("customer_id");

create index if not exists "spoilage_record_location_id_idx" on public."spoilage_record" ("location_id");

create index if not exists "spoilage_record_product_id_idx" on public."spoilage_record" ("product_id");

create index if not exists "spoilage_record_dispatch_id_idx" on public."spoilage_record" ("dispatch_id");

create index if not exists "spoilage_record_status_idx" on public."spoilage_record" ("status");

create table if not exists public."stock_balance" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "product_id" text,
  "product_name" text,
  "warehouse_id" text,
  "warehouse_name" text,
  "lot_number" text,
  "expiry_date" text,
  "quantity" numeric,
  "unit_cost" numeric,
  "total_value" numeric,
  "qc_status" text,
  "production_order_id" text,
  "qc_released_by" text,
  "qc_released_at" text,
  "qc_notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."stock_balance" enable row level security;

revoke all on public."stock_balance" from anon, authenticated;

grant all on public."stock_balance" to service_role;

create index if not exists "stock_balance_created_date_idx" on public."stock_balance" ("created_date");

create index if not exists "stock_balance_product_id_idx" on public."stock_balance" ("product_id");

create index if not exists "stock_balance_warehouse_id_idx" on public."stock_balance" ("warehouse_id");

create index if not exists "stock_balance_production_order_id_idx" on public."stock_balance" ("production_order_id");

create table if not exists public."stock_movement" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "product_id" text,
  "product_name" text,
  "quantity" numeric,
  "movement_type" text,
  "source_warehouse_id" text,
  "destination_warehouse_id" text,
  "lot_number" text,
  "expiry_date" text,
  "unit_cost" numeric,
  "total_value" numeric,
  "document_type" text,
  "document_id" text,
  "reason" text,
  "status" text,
  "movement_date" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."stock_movement" enable row level security;

revoke all on public."stock_movement" from anon, authenticated;

grant all on public."stock_movement" to service_role;

create index if not exists "stock_movement_created_date_idx" on public."stock_movement" ("created_date");

create index if not exists "stock_movement_product_id_idx" on public."stock_movement" ("product_id");

create index if not exists "stock_movement_source_warehouse_id_idx" on public."stock_movement" ("source_warehouse_id");

create index if not exists "stock_movement_destination_warehouse_id_idx" on public."stock_movement" ("destination_warehouse_id");

create index if not exists "stock_movement_document_id_idx" on public."stock_movement" ("document_id");

create index if not exists "stock_movement_status_idx" on public."stock_movement" ("status");

create table if not exists public."supplier" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "supplier_number" text,
  "name" text,
  "contact_person" text,
  "phone" text,
  "email" text,
  "address" text,
  "city" text,
  "tax_id" text,
  "category" text,
  "payment_terms_days" numeric,
  "balance" numeric,
  "is_active" boolean,
  "notes" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."supplier" enable row level security;

revoke all on public."supplier" from anon, authenticated;

grant all on public."supplier" to service_role;

create index if not exists "supplier_created_date_idx" on public."supplier" ("created_date");

create index if not exists "supplier_email_idx" on public."supplier" ("email");

create index if not exists "supplier_tax_id_idx" on public."supplier" ("tax_id");

create table if not exists public."treasury_account" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "name" text,
  "account_type" text,
  "gl_account_id" text,
  "gl_account_number" text,
  "gl_account_name" text,
  "balance" numeric,
  "float_limit" numeric,
  "custodian" text,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."treasury_account" enable row level security;

revoke all on public."treasury_account" from anon, authenticated;

grant all on public."treasury_account" to service_role;

create index if not exists "treasury_account_created_date_idx" on public."treasury_account" ("created_date");

create index if not exists "treasury_account_gl_account_id_idx" on public."treasury_account" ("gl_account_id");

create table if not exists public."treasury_transaction" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "transaction_number" text,
  "treasury_account_id" text,
  "treasury_account_name" text,
  "transaction_type" text,
  "counterparty_account_id" text,
  "counterparty_account_name" text,
  "expense_account_id" text,
  "expense_account_number" text,
  "expense_account_name" text,
  "category" text,
  "payee" text,
  "department_id" text,
  "department_name" text,
  "source" text,
  "source_document_id" text,
  "source_document_number" text,
  "amount" numeric,
  "transaction_date" text,
  "description" text,
  "reference" text,
  "journal_id" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."treasury_transaction" enable row level security;

revoke all on public."treasury_transaction" from anon, authenticated;

grant all on public."treasury_transaction" to service_role;

create index if not exists "treasury_transaction_created_date_idx" on public."treasury_transaction" ("created_date");

create index if not exists "treasury_transaction_treasury_account_id_idx" on public."treasury_transaction" ("treasury_account_id");

create index if not exists "treasury_transaction_counterparty_account_id_idx" on public."treasury_transaction" ("counterparty_account_id");

create index if not exists "treasury_transaction_expense_account_id_idx" on public."treasury_transaction" ("expense_account_id");

create index if not exists "treasury_transaction_department_id_idx" on public."treasury_transaction" ("department_id");

create index if not exists "treasury_transaction_source_document_id_idx" on public."treasury_transaction" ("source_document_id");

create index if not exists "treasury_transaction_journal_id_idx" on public."treasury_transaction" ("journal_id");

create table if not exists public."user" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "role" text,
  "full_name" text,
  "email" text,
  "auth_user_id" text,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."user" enable row level security;

revoke all on public."user" from anon, authenticated;

grant all on public."user" to service_role;

create index if not exists "user_created_date_idx" on public."user" ("created_date");

create index if not exists "user_role_idx" on public."user" ("role");

create index if not exists "user_email_idx" on public."user" ("email");

create index if not exists "user_auth_user_id_idx" on public."user" ("auth_user_id");

create table if not exists public."vehicle" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "registration" text,
  "name" text,
  "vehicle_type" text,
  "branch_id" text,
  "warehouse_id" text,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."vehicle" enable row level security;

revoke all on public."vehicle" from anon, authenticated;

grant all on public."vehicle" to service_role;

create index if not exists "vehicle_created_date_idx" on public."vehicle" ("created_date");

create index if not exists "vehicle_branch_id_idx" on public."vehicle" ("branch_id");

create index if not exists "vehicle_warehouse_id_idx" on public."vehicle" ("warehouse_id");

create table if not exists public."warehouse" (
  "id" text primary key,
  "created_date" text,
  "updated_date" text,
  "created_by" text,
  "name" text,
  "code" text,
  "branch_id" text,
  "warehouse_type" text,
  "custodian_employee_id" text,
  "custodian_name" text,
  "address" text,
  "is_active" boolean,
  extra_data jsonb not null default '{}'::jsonb
);

alter table public."warehouse" enable row level security;

revoke all on public."warehouse" from anon, authenticated;

grant all on public."warehouse" to service_role;

create index if not exists "warehouse_created_date_idx" on public."warehouse" ("created_date");

create index if not exists "warehouse_branch_id_idx" on public."warehouse" ("branch_id");

create index if not exists "warehouse_custodian_employee_id_idx" on public."warehouse" ("custodian_employee_id");

create unique index if not exists user_auth_identity_idx on public."user" (auth_user_id) where auth_user_id is not null and auth_user_id <> '';

create table if not exists erp_private.files (
  id text primary key, bucket text not null, object_key text not null unique,
  owner_id text not null, original_name text not null, content_type text not null,
  access_roles jsonb not null default '[]'::jsonb,
  size bigint not null, created_at timestamptz not null default now(), legacy_uri text unique
);

create table if not exists erp_private.migration_runs (
  id text primary key, started_at timestamptz not null default now(), completed_at timestamptz,
  manifest jsonb not null, report jsonb
);

grant usage on schema erp_private to service_role;
grant all on all tables in schema erp_private to service_role;
