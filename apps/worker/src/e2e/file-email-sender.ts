import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  EmailSender,
  EmailSendRequest,
  EmailSendResult,
} from "../notifications/email-sender.js";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const BROAD_RUN_ID = /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;
const E2E_ROOT_PREFIX = "pubg-camp-phase2-e2e-";

export interface WorkerProviderEnvironment {
  NODE_ENV?: string | undefined;
  E2E_PROVIDER_MODE?: string | undefined;
  E2E_RUN_ID?: string | undefined;
  E2E_OBJECT_ROOT?: string | undefined;
}

export type WorkerProviderMode =
  | { mode: "production"; queuePrefix: "bull" }
  | {
      mode: "fake";
      runId: string;
      root: string;
      runRoot: string;
      mailRoot: string;
      objectRoot: string;
      queuePrefix: string;
    };

export async function resolveWorkerProviderMode(
  environment: WorkerProviderEnvironment,
): Promise<WorkerProviderMode> {
  const fakeFieldsPresent =
    environment.E2E_PROVIDER_MODE !== undefined ||
    environment.E2E_RUN_ID !== undefined ||
    environment.E2E_OBJECT_ROOT !== undefined;
  if (!fakeFieldsPresent) return { mode: "production", queuePrefix: "bull" };

  if (
    environment.NODE_ENV !== "test" ||
    environment.E2E_PROVIDER_MODE !== "fake" ||
    !environment.E2E_RUN_ID ||
    !environment.E2E_OBJECT_ROOT
  ) {
    throw new Error("E2E fake providers require the complete test-only provider conjunction");
  }
  if (!RUN_ID.test(environment.E2E_RUN_ID) || BROAD_RUN_ID.test(environment.E2E_RUN_ID)) {
    throw new Error("E2E run scope is invalid");
  }

  const root = await resolveOwnedE2ERoot(environment.E2E_OBJECT_ROOT);
  const runRoot = resolveInside(root, environment.E2E_RUN_ID);
  return {
    mode: "fake",
    runId: environment.E2E_RUN_ID,
    root,
    runRoot,
    mailRoot: resolveInside(runRoot, "mail"),
    objectRoot: runRoot,
    queuePrefix: `pubg-camp:${environment.E2E_RUN_ID}:bullmq`,
  };
}

export class FileEmailSender implements EmailSender {
  private constructor(
    private readonly mailRoot: string,
    private readonly runId: string,
  ) {}

  static async create(options: { root: string; runId: string }): Promise<FileEmailSender> {
    const scope = await resolveWorkerProviderMode({
      NODE_ENV: "test",
      E2E_PROVIDER_MODE: "fake",
      E2E_RUN_ID: options.runId,
      E2E_OBJECT_ROOT: options.root,
    });
    if (scope.mode !== "fake") throw new Error("E2E mailbox scope is unavailable");
    await mkdir(scope.mailRoot, { recursive: true, mode: 0o700 });
    await chmod(scope.runRoot, 0o700);
    await chmod(scope.mailRoot, 0o700);
    return new FileEmailSender(scope.mailRoot, scope.runId);
  }

  async send(request: EmailSendRequest): Promise<EmailSendResult> {
    const digest = createHash("sha256")
      .update(this.runId, "utf8")
      .update("\0", "utf8")
      .update(request.idempotencyKey, "utf8")
      .digest("hex");
    const mailboxPath = resolveInside(this.mailRoot, `${digest}.json`);
    const payload = JSON.stringify({
      idempotencyKey: request.idempotencyKey,
      message: request.message,
    });
    try {
      await writeFile(mailboxPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(mailboxPath, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new Error("E2E mailbox write failed");
      }
      if ((await readFile(mailboxPath, "utf8")) !== payload) {
        throw new Error("E2E mailbox idempotency conflict");
      }
    }
    return { providerMessageId: `file-${digest}` };
  }
}

async function resolveOwnedE2ERoot(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new Error("E2E object root must be absolute");
  let root: string;
  let systemTemp: string;
  try {
    [root, systemTemp] = await Promise.all([realpath(candidate), realpath(tmpdir())]);
  } catch {
    throw new Error("E2E object root must be an existing mkdtemp directory");
  }
  const rootStat = await stat(root);
  const relative = path.relative(systemTemp, root);
  if (
    !rootStat.isDirectory() ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(root).startsWith(E2E_ROOT_PREFIX) ||
    path.basename(root).length <= E2E_ROOT_PREFIX.length
  ) {
    throw new Error("E2E object root is outside the owned mkdtemp scope");
  }
  return root;
}

export function resolveInside(root: string, ...segments: string[]): string {
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("E2E path escapes its run root");
  }
  return target;
}
