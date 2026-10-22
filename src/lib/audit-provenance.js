// Historical events keep their original provenance. A label must never infer
// verification from a familiar action, a user's name or a linked document.
export function auditProvenance(event) {
  if (event?.audit_source === 'server_verified') return {
    label: 'Verified workflow',
    description: 'Recorded by an authorized business workflow.',
    tone: 'verified',
  };
  if (event?.audit_source === 'client_reported') return {
    label: 'User reported',
    description: 'Verify this reported activity against its linked transaction.',
    tone: 'reported',
  };
  return {
    label: 'Source unrecorded',
    description: 'This entry has no recorded verification source.',
    tone: 'unknown',
  };
}
