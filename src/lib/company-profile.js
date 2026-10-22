
/* localized-interface */
import { ui } from './i18n.js';
export const COMPANY_PROFILE_GROUPS = [
  { get title(){return ui("Legal identity");}, fields:[['company_name','Registered company name',true],['brand_name','Trading name / brand'],['legal_form','Legal form'],['registration_number','Trade register / RCCM'],['registration_date','RCCM registration date','date'],['registration_city','RCCM registry / city'],['share_capital','Share capital (XAF)'],['business_activity','Main business activity'],['business_start_date','Business start date','date'],['legal_representative_name','Legal representative'],['legal_representative_title','Representative capacity / title']] },
  { get title(){return ui("Fiscal and social registrations");}, fields:[['tax_id','Unique taxpayer ID / NIU'],['tax_regime','Tax regime'],['tax_office','Tax office / centre de rattachement'],['vat_registration_number','VAT registration reference'],['vat_status','VAT registration status'],['corporate_tax_reference','Corporate tax file reference'],['cnps_number','CNPS employer registration'],['business_licence_number','Business licence / patente reference'],['business_licence_expiry','Business licence expiry','date']] },
  { get title(){return ui("Registered office and contacts");}, fields:[['address','Registered office address'],['city','City'],['region','Region'],['postal_box','P.O. box'],['country','Country'],['phone','Main telephone'],['alternate_phone','Alternative telephone'],['email','Company email','email'],['website','Company website','url'],['logo_url','Company logo URL','url']] },
  { get title(){return ui("Document details");}, fields:[['legal_mentions','Legal notices'],['invoice_terms','Default invoice terms'],['invoice_payment_instructions','Payment instructions'],['invoice_footer','Invoice footer'],['legal_mentions_fr','Legal notices in French'],['invoice_terms_fr','Invoice terms in French'],['invoice_payment_instructions_fr','Payment instructions in French'],['invoice_footer_fr','Invoice footer in French']] },
];
export const COMPANY_PROFILE_TEXT_FIELDS = [...new Set(COMPANY_PROFILE_GROUPS.flatMap(g=>g.fields.map(([key])=>key)))];
export const COMPANY_PROFILE_FIELDS = [...COMPANY_PROFILE_TEXT_FIELDS,'currency','timezone','fiscal_year_start_month','default_language','document_language','additional_registrations'];
export function companyProfile(settings={}) {
  return { ...Object.fromEntries(COMPANY_PROFILE_TEXT_FIELDS.map(k=>[k,String(settings[k] ?? '')])),
    currency:settings.currency || 'XAF',timezone:settings.timezone || 'Africa/Douala',fiscal_year_start_month:settings.fiscal_year_start_month ?? 1,
    default_language:settings.default_language || 'fr',document_language:settings.document_language || settings.default_language || 'fr',
    additional_registrations:Array.isArray(settings.additional_registrations)?settings.additional_registrations:[],revision:Number(settings.revision ?? settings.company_profile_revision ?? 0) };
}
export function cleanCompanyProfile(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!COMPANY_PROFILE_FIELDS.includes(k)))throw Error(ui("Enter valid company profile fields."));
  const data={};
  for(const key of COMPANY_PROFILE_TEXT_FIELDS) {
    const value=input[key] ?? '';
    if(typeof value!=='string' || value.length>(/mentions|terms|instructions|footer/.test(key)?4000:300))throw Error('A company profile field is invalid or too long.');
    data[key]=value.trim();
  }
  if(!data.company_name)throw Error(ui("Enter the registered company name."));
  if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw Error(ui("Enter a valid company email."));
  for(const key of ['website','logo_url'])if(data[key]) { let u;try{u=new URL(data[key]);}catch{throw Error(ui("Use a complete http or https website or logo URL."));}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error(ui("Use a complete http or https website or logo URL.")); }
  for(const key of ['registration_date','business_start_date','business_licence_expiry'])if(data[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(data[key])||new Date(data[key]+'T12:00:00Z').toISOString().slice(0,10)!==data[key]))throw Error(ui("Enter a valid registration or licence date."));
  if(typeof input.currency!=='string'||!/^[A-Z]{3}$/.test(input.currency))throw Error(ui("Use a three-letter currency code."));
  data.currency=input.currency;
  try{new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format();}catch{throw Error(ui("Choose a valid timezone."));}
  if(typeof input.timezone!=='string'||!input.timezone)throw Error(ui("Choose a valid timezone."));
  data.timezone=input.timezone;
  if(!Number.isInteger(input.fiscal_year_start_month)||input.fiscal_year_start_month<1||input.fiscal_year_start_month>12)throw Error(ui("Fiscal year start month must be between 1 and 12."));
  data.fiscal_year_start_month=input.fiscal_year_start_month;
  for(const key of ['default_language','document_language']){if(!['fr','en'].includes(input[key]))throw Error(ui("Choose French or English."));data[key]=input[key];}
  if(!Array.isArray(input.additional_registrations)||input.additional_registrations.length>30)throw Error(ui("Add up to 30 additional registrations."));
  data.additional_registrations=input.additional_registrations.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['label','number','issuer','issued_on','expires_on'].includes(k)))throw Error(ui("Enter valid additional registration details."));
    const out={};for(const key of ['label','number','issuer','issued_on','expires_on']){if(typeof(row[key]??'')!=='string'||(row[key]||'').length>300)throw Error(ui("Enter valid additional registration details."));out[key]=(row[key]||'').trim();}
    if(!out.label||!out.number)throw Error(ui("Each additional registration needs a name and reference."));
    for(const key of ['issued_on','expires_on'])if(out[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(out[key])||new Date(out[key]+'T12:00:00Z').toISOString().slice(0,10)!==out[key]))throw Error(ui("Enter a valid registration or licence date."));
    if(out.issued_on&&out.expires_on&&out.expires_on<out.issued_on)throw Error(ui("Registration expiry cannot precede its issue date."));return out;
  });
  return data;
}
