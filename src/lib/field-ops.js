
/* localized-interface */
import { ui } from './i18n.js';
import { erp } from "@/api/erpClient";

export const invokeFieldOps = (payload) => erp.functions.invoke("fieldOps", payload);

export const SALE_STATUS = {
  draft: { get label(){return ui("Draft");}, tone: "bg-slate-100 text-slate-700 border-slate-200" },
  submitted: { get label(){return ui("Submitted");}, tone: "bg-blue-50 text-blue-700 border-blue-200" },
  under_review: { get label(){return ui("Under review");}, tone: "bg-amber-50 text-amber-700 border-amber-200" },
  approved_posted: { get label(){return ui("Recorded");}, tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  returned: { get label(){return ui("Returned for correction");}, tone: "bg-orange-50 text-orange-700 border-orange-200" },
  rejected: { get label(){return ui("Rejected");}, tone: "bg-red-50 text-red-700 border-red-200" },
  posting_failed: { get label(){return ui("Posting failed");}, tone: "bg-red-50 text-red-700 border-red-200" },
};

export const COLLECTION_STATUS = {
  held_by_commercial: { get label(){return ui("Held by Commercial");}, tone: "bg-amber-50 text-amber-700 border-amber-200" },
  handover_submitted: { get label(){return ui("Handover submitted");}, tone: "bg-blue-50 text-blue-700 border-blue-200" },
  partially_received: { get label(){return ui("Partly received");}, tone: "bg-orange-50 text-orange-700 border-orange-200" },
  received: { get label(){return ui("Settled");}, tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  disputed: { get label(){return ui("Disputed");}, tone: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { get label(){return ui("Cancelled");}, tone: "bg-slate-100 text-slate-700 border-slate-200" },
};

export const HANDOVER_STATUS = {
  draft: { get label(){return ui("Draft");}, tone: "bg-slate-100 text-slate-700 border-slate-200" },
  submitted: { get label(){return ui("Awaiting receipt");}, tone: "bg-blue-50 text-blue-700 border-blue-200" },
  partially_received: { get label(){return ui("Partly received");}, tone: "bg-orange-50 text-orange-700 border-orange-200" },
  received: { get label(){return ui("Settled");}, tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  disputed: { get label(){return ui("Disputed");}, tone: "bg-red-50 text-red-700 border-red-200" },
};

export const PAYMENT_LABEL = { cash: "Cash", credit: "Credit" };

export async function uploadReceipt(file) {
  const { file_uri } = await erp.integrations.Core.UploadPrivateFile({ file });
  return file_uri;
}

export async function receiptUrl(fileUri) {
  const { signed_url } = await erp.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: 900 });
  return signed_url;
}

export function errorMessage(e) {
  return e?.response?.data?.error || e?.message || ui("Something went wrong — please try again");
}

export function newIdempotencyKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
