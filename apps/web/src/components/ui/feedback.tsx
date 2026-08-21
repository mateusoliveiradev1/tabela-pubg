import {
  CheckCircle2,
  CircleAlert,
  Info,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

type FeedbackStateName =
  | "loading"
  | "error"
  | "offline"
  | "empty"
  | "permission"
  | "session-expired";

const feedbackCopy: Record<
  FeedbackStateName,
  { title: string; description: string; tone: "info" | "danger" }
> = {
  loading: {
    title: "Carregando",
    description: "Aguarde enquanto buscamos os dados.",
    tone: "info",
  },
  error: {
    title: "Não foi possível concluir esta ação",
    description: "Tente novamente; se o problema continuar, use o código de suporte exibido.",
    tone: "danger",
  },
  offline: {
    title: "Sem conexão",
    description: "Sem conexão. Nenhuma alteração foi enviada.",
    tone: "danger",
  },
  empty: {
    title: "Você ainda não participa de uma organização",
    description: "Crie uma organização para sua comunidade ou aceite um convite para colaborar.",
    tone: "info",
  },
  permission: {
    title: "Área indisponível",
    description:
      "Não foi possível abrir esta área. Volte para uma organização à qual você tenha acesso.",
    tone: "danger",
  },
  "session-expired": {
    title: "Sua sessão expirou",
    description: "Entre novamente para continuar de forma segura.",
    tone: "info",
  },
};

const stateIcons: Record<FeedbackStateName, typeof Info> = {
  loading: Info,
  error: CircleAlert,
  offline: WifiOff,
  empty: Info,
  permission: ShieldAlert,
  "session-expired": KeyRound,
};

interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "accent" | "destructive";
}

export function StatusBadge({ children, tone = "neutral" }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${tone}`}>
      <CheckCircle2 aria-hidden="true" size={16} />
      {children}
    </span>
  );
}

export function RoleBadge({ children, tone = "neutral" }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${tone}`}>
      <ShieldCheck aria-hidden="true" size={16} />
      {children}
    </span>
  );
}

interface InlineAlertProps {
  children: ReactNode;
  title?: string;
  tone?: "info" | "danger";
  action?: ReactNode;
}

export function InlineAlert({ children, title, tone = "info", action }: InlineAlertProps) {
  const Icon = tone === "danger" ? CircleAlert : Info;
  return (
    <div className={`ui-alert ui-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon aria-hidden="true" size={20} />
      <div className="ui-alert-content">
        {title ? <strong>{title}</strong> : null}
        <span>{children}</span>
        {action ? <div className="ui-alert-action">{action}</div> : null}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="ui-empty-state" aria-label={title}>
      <Info aria-hidden="true" size={24} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </section>
  );
}

interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
}

export function Skeleton({ width = "100%", height = 16, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={["ui-skeleton", className].filter(Boolean).join(" ")}
      style={{ width, height }}
    />
  );
}

interface FeedbackStateProps {
  state: FeedbackStateName;
  action?: ReactNode;
}

export function FeedbackState({ state, action }: FeedbackStateProps) {
  const copy = feedbackCopy[state];
  const Icon = stateIcons[state];
  const role =
    state === "error" || state === "offline" || state === "permission" ? "alert" : "status";

  return (
    <section className={`ui-feedback-state ui-feedback-state--${copy.tone}`} role={role}>
      <Icon aria-hidden="true" size={24} />
      <div>
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
        {action ? <div className="ui-feedback-action">{action}</div> : null}
      </div>
    </section>
  );
}
