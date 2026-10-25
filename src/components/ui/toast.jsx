
import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitive.Provider;
const ToastViewport = React.forwardRef(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport ref={ref} className={cn("pointer-events-none fixed right-3 top-16 z-[100] flex max-h-[calc(100dvh_-_6rem)] w-[calc(100%_-_1.5rem)] max-w-sm flex-col gap-2 overflow-y-auto p-1 outline-none sm:right-5", className)} {...props} />
));
ToastViewport.displayName = "ToastViewport";
const Toast = React.forwardRef(({ className, variant, ...props }, ref) => (
  <ToastPrimitive.Root ref={ref} className={cn("group pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border bg-white p-4 pr-12 text-slate-900 shadow-lg data-[state=closed]:pointer-events-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full", variant === "destructive" && "border-red-200 bg-red-50 text-red-950", className)} {...props} />
));
Toast.displayName = "Toast";
const ToastClose = React.forwardRef(({ className, ...props }, ref) => (
  <ToastPrimitive.Close ref={ref} type="button" aria-label="Dismiss notification" className={cn("absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-current opacity-80 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", className)} {...props}><X className="h-4 w-4" /></ToastPrimitive.Close>
));
ToastClose.displayName = "ToastClose";
const ToastTitle = React.forwardRef(({ className, ...props }, ref) => <ToastPrimitive.Title ref={ref} className={cn("text-sm font-semibold", className)} {...props} />);
ToastTitle.displayName = "ToastTitle";
const ToastDescription = React.forwardRef(({ className, ...props }, ref) => <ToastPrimitive.Description ref={ref} className={cn("mt-1 max-h-28 overflow-y-auto break-words text-sm opacity-90", className)} {...props} />);
ToastDescription.displayName = "ToastDescription";
const ToastAction = React.forwardRef(({ className, ...props }, ref) => <ToastPrimitive.Action ref={ref} className={cn("rounded-md border px-3 py-2 text-sm font-medium", className)} {...props} />);
ToastAction.displayName = "ToastAction";
export { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose, ToastAction };
