"use client";

import { CircleAlert } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, useId } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, helperText, id: providedId, label, required, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? `input-${generatedId}`;
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [props["aria-describedby"], helperId, errorId].filter(Boolean).join(" ");

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label className="ui-label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        {...props}
        ref={ref}
        id={id}
        required={required}
        className="ui-input"
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
      />
      {helperText ? (
        <span className="ui-field__help" id={helperId}>
          {helperText}
        </span>
      ) : null}
      {error ? (
        <span className="ui-field__error" id={errorId} role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          {error}
        </span>
      ) : null}
    </div>
  );
});
