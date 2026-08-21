"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

interface OtpInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "autoComplete" | "inputMode" | "maxLength" | "onChange" | "type" | "value"
  > {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const OTP_POSITIONS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { error, id = "otp-code", onChange, value, ...props },
  ref,
) {
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="otp-field">
      <label className="ui-label" htmlFor={id}>
        Código de 8 dígitos
      </label>
      <div className="otp-control">
        <input
          {...props}
          ref={ref}
          id={id}
          className="otp-control__input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          pattern="[0-9]{8}"
          value={value}
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(digitsOnly(event.currentTarget.value))}
          onPaste={(event) => {
            event.preventDefault();
            onChange(digitsOnly(event.clipboardData.getData("text")));
          }}
        />
        <div className="otp-control__segments" aria-hidden="true">
          {OTP_POSITIONS.map((position, index) => (
            <span key={position}>{value[index] ?? ""}</span>
          ))}
        </div>
      </div>
      {error ? (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}
