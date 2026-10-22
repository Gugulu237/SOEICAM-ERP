export const TOAST_LIMIT = 3;
export const TOAST_REMOVE_DELAY = 200;
const EMPTY = { toasts: [] };
const durationFor = toast => {
  const requested = Number(toast.duration ?? (toast.variant === 'destructive' ? 8000 : 4500));
  return Number.isFinite(requested) ? Math.min(30000, Math.max(1000, requested)) : 8000;
};

export function createToastStore({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  let state = EMPTY, count = 0;
  const listeners = new Set(), expiry = new Map(), removal = new Map();
  const emit = toasts => { state = { toasts }; listeners.forEach(listener => listener()); };
  const clear = (timers, id) => { if (timers.has(id)) { cancel(timers.get(id)); timers.delete(id); } };
  const remove = id => { clear(expiry, id); clear(removal, id); emit(state.toasts.filter(toast => toast.id !== id)); };
  const dismiss = id => {
    const closing = state.toasts.filter(toast => toast.open && (id === undefined || toast.id === id));
    if (!closing.length) return;
    for (const toast of closing) {
      clear(expiry, toast.id);
      removal.set(toast.id, schedule(() => remove(toast.id), TOAST_REMOVE_DELAY));
    }
    const ids = new Set(closing.map(toast => toast.id));
    emit(state.toasts.map(toast => ids.has(toast.id) ? { ...toast, open: false } : toast));
  };
  const expire = toast => {
    clear(expiry, toast.id);
    expiry.set(toast.id, schedule(() => dismiss(toast.id), durationFor(toast)));
  };
  const toast = input => {
    const id = String(++count);
    const message = { ...input, duration: durationFor(input), id, open: true, onOpenChange: open => { if (!open) dismiss(id); } };
    const kept = [message, ...state.toasts.filter(row => row.open)].slice(0, TOAST_LIMIT);
    for (const row of state.toasts) if (!kept.some(value => value.id === row.id)) { clear(expiry, row.id); clear(removal, row.id); }
    emit(kept); expire(message);
    return { id, dismiss: () => dismiss(id), update: changes => {
      const row = state.toasts.find(value => value.id === id);
      if (!row?.open) return;
      const next = { ...row, ...changes, duration: durationFor({ ...row, ...changes }), id, open: true, onOpenChange: row.onOpenChange };
      emit(state.toasts.map(value => value.id === id ? next : value)); expire(next);
    } };
  };
  return { toast, dismiss, getSnapshot: () => state, getServerSnapshot: () => EMPTY,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
export const toastStore = createToastStore();
