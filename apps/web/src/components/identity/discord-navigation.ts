export type DiscordOAuthPurpose = "sign-in" | "link-identity" | "step-up";

interface DiscordNavigationInput {
  csrfToken: string;
  purpose: DiscordOAuthPurpose;
  returnPath?: string;
}

const DISCORD_START_PATH = "/api/platform/identity/oauth/discord/start";

export function submitDiscordNavigation(input: DiscordNavigationInput): void {
  const form = document.createElement("form");
  form.action = DISCORD_START_PATH;
  form.method = "post";
  form.hidden = true;

  appendField(form, "csrfToken", input.csrfToken);
  appendField(form, "purpose", input.purpose);
  if (input.returnPath) appendField(form, "returnPath", input.returnPath);

  document.body.append(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
}

function appendField(form: HTMLFormElement, name: string, value: string): void {
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = name;
  field.value = value;
  form.append(field);
}
