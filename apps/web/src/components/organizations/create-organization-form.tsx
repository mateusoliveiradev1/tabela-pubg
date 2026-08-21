"use client";

import { ImagePlus, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import { InlineAlert } from "../ui/feedback";
import { Input } from "../ui/input";

const ORGANIZATION_PATH = "/api/platform/organizations";
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface CreateOrganizationFormProps {
  onNavigate?: (path: string) => void;
}

export function CreateOrganizationForm({ onNavigate }: CreateOrganizationFormProps) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string>();
  const [logoError, setLogoError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!logo || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const nextPreview = URL.createObjectURL(logo);
    setPreviewUrl(nextPreview);
    return () => URL.revokeObjectURL(nextPreview);
  }, [logo]);

  function selectLogo(file: File | undefined) {
    setLogoError(undefined);
    if (!file) return;
    if (!LOGO_TYPES.has(file.type)) {
      setLogo(null);
      setLogoError("Selecione uma imagem PNG, JPEG ou WebP.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogo(null);
      setLogoError("O logo deve ter até 2 MiB.");
      return;
    }
    setLogo(file);
  }

  function removeLogo() {
    setLogo(null);
    setLogoError(undefined);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      setNameError("Use entre 2 e 120 caracteres.");
      return;
    }
    setSubmitting(true);
    setNameError(undefined);
    setFormError(undefined);
    try {
      const csrf = await acquireCsrf();
      const formData = new FormData();
      formData.set("name", normalizedName);
      if (logo) formData.set("logo", logo, logo.name);
      const response = await fetch(ORGANIZATION_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "x-csrf-token": csrf },
        body: formData,
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 409) {
          setNameError("Este nome não está disponível ou é inválido.");
        } else if (response.status === 413 || response.status === 415) {
          setLogoError("O servidor recusou este logo. Confira formato e tamanho.");
        } else {
          setFormError("Não foi possível criar a organização. Tente novamente.");
        }
        return;
      }
      const payload = (await response.json()) as { organization?: { slug?: unknown } };
      const slug = payload.organization?.slug;
      if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        setFormError("A organização foi criada, mas não foi possível abrir o destino.");
        return;
      }
      const path = `/o/${slug}/membros`;
      if (onNavigate) onNavigate(path);
      else window.location.assign(path);
    } catch {
      setFormError("Sem conexão. Nenhuma alteração foi enviada.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="organization-form" onSubmit={createOrganization} noValidate>
      <Input
        label="Nome da organização"
        name="name"
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        helperText={`${name.length}/120 · identificador sugerido: ${slugPreview(name)}`}
        {...(nameError ? { error: nameError } : {})}
        required
      />
      <fieldset className="organization-logo-field">
        <legend>Logo opcional</legend>
        <input
          ref={fileInput}
          className="sr-only"
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby={`${inputId}-help${logoError ? ` ${inputId}-error` : ""}`}
          onChange={(event) => selectLogo(event.currentTarget.files?.[0])}
        />
        <label
          className="organization-logo-dropzone"
          htmlFor={inputId}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            selectLogo(event.dataTransfer.files[0]);
          }}
        >
          {previewUrl ? (
            // biome-ignore lint/performance/noImgElement: local object URLs are not supported by next/image.
            <img src={previewUrl} alt="Prévia do logo selecionado" />
          ) : (
            <ImagePlus aria-hidden="true" size={30} />
          )}
          <span>
            <strong>Selecionar logo</strong>
            <small id={`${inputId}-help`}>
              PNG, JPEG ou WebP, até 2 MiB. Também aceita arrastar.
            </small>
          </span>
          <Upload aria-hidden="true" size={20} />
        </label>
        <div className="organization-logo-drop-target">
          {logo ? <span>{logo.name}</span> : <span>Nenhum arquivo selecionado</span>}
          {logo ? (
            <Button variant="ghost" onClick={removeLogo}>
              <Trash2 aria-hidden="true" size={17} />
              Remover logo
            </Button>
          ) : null}
        </div>
        {logoError ? (
          <p className="ui-field__error" id={`${inputId}-error`} role="alert">
            {logoError}
          </p>
        ) : null}
      </fieldset>
      <InlineAlert title="Proprietário inicial">
        Você será o proprietário inicial e poderá convidar outras pessoas depois.
      </InlineAlert>
      {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
      <Button type="submit" variant="primary" loading={submitting} loadingLabel="Criando…">
        Criar organização
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

function slugPreview(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "sua-organizacao";
}
