"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function ToastProvider({ children }: { children: ReactNode }) {
  return <ToastPrimitive.Provider swipeDirection="right">{children}</ToastPrimitive.Provider>;
}

interface ToastProps extends Omit<ComponentPropsWithoutRef<typeof ToastPrimitive.Root>, "title"> {
  title: string;
  description?: string;
}

export function Toast({ title, description, ...props }: ToastProps) {
  return (
    <ToastPrimitive.Root
      className="ui-toast"
      defaultOpen
      role="status"
      aria-live="polite"
      {...props}
    >
      <div>
        <ToastPrimitive.Title className="ui-toast-title">{title}</ToastPrimitive.Title>
        {description ? (
          <ToastPrimitive.Description className="ui-toast-description">
            {description}
          </ToastPrimitive.Description>
        ) : null}
      </div>
      <ToastPrimitive.Close className="ui-toast-close" aria-label="Fechar notificação">
        <X aria-hidden="true" size={18} />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export function ToastViewport({ label = "Notificações" }: { label?: string }) {
  return <ToastPrimitive.Viewport className="ui-toast-viewport" aria-label={label} />;
}
