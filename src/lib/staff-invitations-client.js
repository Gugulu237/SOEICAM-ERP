async function responseData(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The staff invitation request failed.');
  return data;
}

export const staffInvitationStatuses = () => fetch('/api/admin/staff-invitations', { cache: 'no-store' }).then(responseData);
export const inviteEmployee = employeeId => fetch('/api/admin/staff-invitations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
  body: JSON.stringify({ employeeId }),
}).then(responseData);
