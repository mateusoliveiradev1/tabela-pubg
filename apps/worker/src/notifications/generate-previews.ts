import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderNotificationTemplate } from "./templates.js";

const createdAt = new Date("2026-08-24T03:48:00.000Z");
const appBaseUrl = "https://preview.invalid";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export function buildNotificationPreviewFixtures() {
  return {
    otp: renderNotificationTemplate({
      template: "otp",
      payload: {
        recipient: "operador@preview.invalid",
        code: "48291637",
        expiresAt: "2026-08-24T04:00:00.000Z",
      },
      createdAt,
      appBaseUrl,
    }),
    invitation: renderNotificationTemplate({
      template: "invitation",
      payload: {
        recipient: "capitao@preview.invalid",
        invitationToken: "preview-only-invitation-token",
        organizationName: "Arena Sul Comunitária",
        expiresAt: "2026-08-31T03:48:00.000Z",
      },
      createdAt,
      appBaseUrl,
    }),
    "new-device": renderNotificationTemplate({
      template: "new-device",
      payload: {
        recipient: "operador@preview.invalid",
        alertToken: "preview-only-alert-context",
        sessionId: "preview-internal-session",
        device: {
          label: "Notebook de transmissão",
          browser: "Firefox",
          operatingSystem: "Windows 11",
          approximateLocation: "São Paulo, BR",
          summarizedUserAgent: "Preview fixture without network data",
        },
      },
      createdAt,
      appBaseUrl,
    }),
  } as const;
}

export async function writeNotificationPreviews(outputDirectory: string): Promise<string[]> {
  const previews = buildNotificationPreviewFixtures();
  await mkdir(outputDirectory, { recursive: true });
  const written: string[] = [];
  for (const [name, message] of Object.entries(previews)) {
    const path = resolve(outputDirectory, `${name}.html`);
    await writeFile(path, message.html, "utf8");
    written.push(path);
  }
  return written;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const outputDirectory = resolve(
    process.argv[2] ?? resolve(moduleDirectory, "../../previews/notifications"),
  );
  const paths = await writeNotificationPreviews(outputDirectory);
  process.stdout.write(`${paths.join("\n")}\n`);
}
