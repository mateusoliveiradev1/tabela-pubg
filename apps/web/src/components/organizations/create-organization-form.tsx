"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { InlineAlert } from "../ui/feedback";
import { Input } from "../ui/input";
import { OrganizationLogoField } from "./organization-logo-field";

const ORGANIZATION_PATH = "/api/platform/organizations";

interface CreateOrganizationFormProps {
  onNavigate?: (path: string) => void;
}

export function CreateOrganizationForm({ onNavigate }: CreateOrganizationFormProps) {
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [nameError, setNameError] = useState<string>();
  const [logoError, setLogoError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

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
      <OrganizationLogoField
        value={logo}
        onChange={(nextLogo) => {
          setLogo(nextLogo);
          setLogoError(undefined);
        }}
        error={logoError}
        disabled={submitting}
      />
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
