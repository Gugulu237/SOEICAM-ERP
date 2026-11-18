// Preserve actionable business validation; replace infrastructure details only.
export function readableError(message,status){
  if(status===401)return 'Your session has expired. Sign in again, then return to this form.';
  const text=String(message||'');
  if(/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(text))return 'The connection failed. Check your internet connection and try again. Your input is kept.';
  if(/SQLSTATE|PostgresError|stack trace|\bat\s+\S+\s*\([^)]*:\d+:\d+\)|ECONNREFUSED|ENOTFOUND|relation .+ does not exist|violates .+ constraint|invalid input syntax for type|\b(?:select|insert into|update)\s.+\b(?:from|values|where)\b/i.test(text))return 'This operation could not be completed. Your input is kept. Try again or contact your administrator.';
  return text||'Something went wrong. Please try again.';
}
