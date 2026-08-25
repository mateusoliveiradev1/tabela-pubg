"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";

interface DialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({ trigger, title, description, children, open, onOpenChange }: DialogProps) {
  return (
    <DialogPrimitive.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <DialogPrimitive.Trigger asChild>
        <Button>{trigger}</Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content className="ui-dialog-content">
          <DialogPrimitive.Close asChild>
            <Button className="ui-dialog-close" size="icon" variant="ghost" aria-label="Fechar">
              <X aria-hidden="true" size={20} />
            </Button>
          </DialogPrimitive.Close>
          <DialogPrimitive.Title className="ui-dialog-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="ui-dialog-description">
            {description}
          </DialogPrimitive.Description>
          <div className="ui-dialog-body">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface AlertDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

export function AlertDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
}: AlertDialogProps) {
  return (
    <AlertDialogPrimitive.Root>
      <AlertDialogPrimitive.Trigger asChild>
        <Button variant="destructive">{trigger}</Button>
      </AlertDialogPrimitive.Trigger>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="ui-dialog-overlay" />
        <AlertDialogPrimitive.Content className="ui-dialog-content">
          <AlertDialogPrimitive.Title className="ui-dialog-title">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="ui-dialog-description">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="ui-dialog-actions">
            <AlertDialogPrimitive.Cancel asChild>
              <Button>{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant="destructive" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
