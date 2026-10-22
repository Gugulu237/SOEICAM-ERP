export function hasCustomerLocation(value) {
  return value?.gps_lat !== '' && value?.gps_lat != null && value?.gps_lng !== '' && value?.gps_lng != null
    && Number.isFinite(Number(value.gps_lat)) && Math.abs(Number(value.gps_lat)) <= 90
    && Number.isFinite(Number(value.gps_lng)) && Math.abs(Number(value.gps_lng)) <= 180;
}

export function customerMapUrl(value, directions = false) {
  if (!hasCustomerLocation(value)) return '';
  const point = encodeURIComponent(`${Number(value.gps_lat)},${Number(value.gps_lng)}`);
  return directions ? `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`
    : `https://www.google.com/maps/search/?api=1&query=${point}`;
}

export function customerRouteUrl(customers) {
  if (!Array.isArray(customers) || !customers.length || customers.length > 3 || customers.some(customer => !hasCustomerLocation(customer))) return '';
  const points = customers.map(customer => `${Number(customer.gps_lat)},${Number(customer.gps_lng)}`);
  const query = new URLSearchParams({ api: '1', destination: points.at(-1), travelmode: 'driving' });
  if (points.length > 1) query.set('waypoints', points.slice(0, -1).join('|'));
  return 'https://www.google.com/maps/dir/?' + query;
}
