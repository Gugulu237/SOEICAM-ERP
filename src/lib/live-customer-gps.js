export function startCustomerGps({ geolocation, onPosition, onError, onStop, duration = 120000, timers = globalThis, targetAccuracy, maxAgeSeconds = 120 }) {
  let active = true, watchId, timer, bestAccuracy = Infinity;
  const stop = () => {
    if (!active) return;
    active = false;
    if (watchId != null) geolocation.clearWatch(watchId);
    if (timer != null) timers.clearTimeout(timer);
    onStop?.();
  };
  try {
    watchId = geolocation.watchPosition(position => {
      if (!active) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (![latitude, longitude, accuracy, position.timestamp].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) return;
      const captured = new Date(position.timestamp);
      if (!Number.isFinite(captured.getTime())) return;
      if (targetAccuracy != null) {
        const age = Date.now() - position.timestamp;
        if (age > maxAgeSeconds * 1000 || age < -30000 || accuracy > bestAccuracy) return;
        bestAccuracy = accuracy;
      }
      onPosition({ gps_lat: latitude, gps_lng: longitude, gps_accuracy_m: accuracy, gps_captured_at: captured.toISOString() });
      if (targetAccuracy != null && accuracy <= targetAccuracy) stop();
    }, error => { if (active) { onError(error); stop(); } }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    if (!active && watchId != null) geolocation.clearWatch(watchId);
    if (active) timer = timers.setTimeout(() => {
      if (targetAccuracy != null && bestAccuracy === Infinity) onError({ code: 3 });
      stop();
    }, duration);
  } catch (error) { onError(error); stop(); }
  return stop;
}
