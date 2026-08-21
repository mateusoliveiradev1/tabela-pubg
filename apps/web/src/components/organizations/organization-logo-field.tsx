"use client";

import { ImagePlus, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ShellOrganization } from "../layout/app-shell";
import { Button } from "../ui/button";
import { InlineAlert } from "../ui/feedback";
import { Input } from "../ui/input";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface OrganizationLogoFieldProps {
  value: File | null;
  onChange: (file: File | null) => void;
  currentLogoUrl?: string | null;
  organizationName?: string;
  error?: string;
  disabled?: boolean;
}

export function OrganizationLogoField({
  value,
  onChange,
  currentLogoUrl = null,
  organizationName,
  error,
  disabled = false,
}: OrganizationLogoFieldProps) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string>();

  useEffect(() => {
    if (!value || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const nextPreview = URL.createObjectURL(value);
    setPreviewUrl(nextPreview);
    return () => URL.revokeObjectURL(nextPreview);
  }, [value]);

  const visibleError = clientError ?? error;
  const imageUrl = previewUrl ?? currentLogoUrl;
  const imageAlt = previewUrl
    ? "Prévia do logo selecionado"
    : `Logo atual de ${organizationName ?? "organização"}`;

  function selectFile(file: File | undefined) {
    setClientError(undefined);
    if (!file) return;
    if (!LOGO_TYPES.has(file.type)) {
      setClientError("Selecione uma imagem PNG, JPEG ou WebP.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setClientError("O logo deve ter até 2 MiB.");
      return;
    }
    onChange(file);
  }

  function removeFile() {
    setClientError(undefined);
    onChange(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <fieldset className="organization-logo-field" disabled={disabled}>
      <legend>Logo opcional</legend>
      <input
        ref={fileInput}
        className="sr-only"
        id={inputId}
        type="file"
        aria-label="Selecionar logo"
        accept="image/png,image/jpeg,image/webp"
        aria-describedby={`${inputId}-help${visibleError ? ` ${inputId}-error` : ""}`}
        aria-invalid={visibleError ? true : undefined}
        onChange={(event) => selectFile(event.currentTarget.files?.[0])}
      />
      <label
        className="organization-logo-dropzone"
        data-testid="organization-logo-dropzone"
        htmlFor={inputId}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          selectFile(event.dataTransfer.files[0]);
        }}
      >
        {imageUrl ? (
          // biome-ignore lint/performance/noImgElement: blob/signed URLs are short-lived and dynamic.
          <img src={imageUrl} alt={imageAlt} referrerPolicy="no-referrer" />
        ) : (
          <ImagePlus aria-hidden="true" size={30} />
        )}
        <span>
          <strong>Selecionar logo</strong>
          <small id={`${inputId}-help`}>
            PNG, JPEG ou WebP, até 2 MiB. O servidor confirma o conteúdo antes de salvar.
          </small>
        </span>
        <Upload aria-hidden="true" size={20} />
      </label>
      <div className="organization-logo-drop-target">
        {value ? <span>{value.name}</span> : <span>Nenhum novo arquivo selecionado</span>}
        {value ? (
          <Button variant="ghost" onClick={removeFile}>
            <Trash2 aria-hidden="true" size={17} />
            Remover logo
          </Button>
        ) : null}
      </div>
      {visibleError ? (
        <p className="ui-field__error" id={`${inputId}-error`} role="alert" aria-live="assertive">
          {visibleError}
        </p>
      ) : null}
    </fieldset>
  );
}

interface OrganizationLogoSettingsFormProps {
  organization: ShellOrganization;
  onRefresh?: () => void;
}

export function OrganizationLogoSettingsForm({
  organization,
  onRefresh,
}: OrganizationLogoSettingsFormProps) {
  const [logo, setLogo] = useState<File | null>(null);
  const [authoritativeLogoUrl, setAuthoritativeLogoUrl] = useState(organization.logoUrl);
  const [logoError, setLogoError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function saveLogo(event: React.FormEvent) {
    event.preventDefault();
    if (!logo || submitting) return;
    setSubmitting(true);
    setLogoError(undefined);
    setFormError(undefined);
    setSuccess(undefined);
    try {
      const csrf = await acquireCsrf();
      const formData = new FormData();
      formData.set("logo", logo, logo.name);
      const response = await fetch(
        `/api/platform/organizations/${encodeURIComponent(organization.id)}/logo`,
        {
          method: "PUT",
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json", "x-csrf-token": csrf },
          body: formData,
        },
      );
      if (response.status === 413 || response.status === 415 || response.status === 400) {
        setLogoError("O servidor recusou este logo. Confira formato e tamanho.");
        return;
      }
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        setFormError(
          "Não foi possível abrir esta área. Volte para uma organização à qual você tenha acesso.",
        );
        return;
      }
      if (!response.ok) {
        setFormError("Não foi possível atualizar o logo. Tente novamente.");
        return;
      }
      const payload = (await response.json()) as Record<string, unknown>;
      if (typeof payload.url !== "string" || !isSafeLogoUrl(payload.url)) {
        setFormError("O logo foi salvo, mas a resposta não pôde ser exibida com segurança.");
        return;
      }
      setAuthoritativeLogoUrl(payload.url);
      setLogo(null);
      setSuccess("Logo atualizado com confirmação do servidor.");
      if (onRefresh) onRefresh();
      else window.location.reload();
    } catch {
      setFormError("Sem conexão. Nenhuma alteração foi enviada.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="organization-form" onSubmit={saveLogo} noValidate>
      <Input label="Nome da organização" value={organization.name} readOnly />
      <OrganizationLogoField
        value={logo}
        onChange={(nextLogo) => {
          setLogo(nextLogo);
          setLogoError(undefined);
          setSuccess(undefined);
        }}
        currentLogoUrl={authoritativeLogoUrl}
        organizationName={organization.name}
        error={logoError}
        disabled={submitting}
      />
      {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
      {success ? <p role="status">{success}</p> : null}
      <Button
        type="submit"
        variant="primary"
        loading={submitting}
        loadingLabel="Salvando…"
        disabled={!logo}
      >
        Salvar logo
      </Button>
    </form>
  );
}

async function acquireCsrf(): Promise<string> {
  const response = await fetch("/api/platform/security/csrf", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const token = response.headers.get("x-csrf-token");
  if (!response.ok || !token) throw new Error();
  return token;
}

function isSafeLogoUrl(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
