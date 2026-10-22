
import { useToast } from "@/components/ui/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
export function Toaster() {
  const { toasts, dismiss } = useToast();
  const visible = toasts.filter(toast => toast.open);
  return <ToastProvider duration={4500} swipeDirection="right">
    {toasts.map(({ id, title, description, action, ...props }) => <Toast key={id} {...props}>
      <div className="min-w-0 flex-1">{title && <ToastTitle>{title}</ToastTitle>}{description && <ToastDescription>{description}</ToastDescription>}{action}</div><ToastClose />
    </Toast>)}
    {visible.length > 1 && <button type="button" onClick={() => dismiss()} className="fixed right-5 top-16 z-[101] rounded-md border bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">Clear notifications</button>}
    <ToastViewport label="Notifications" className={visible.length > 1 ? 'top-24' : ''} />
  </ToastProvider>;
}
