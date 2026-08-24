---
version: 1
slug: "apps-worker-src-notifications-templates-ts"
primary_target: "apps/worker/src/notifications/templates.ts"
related_targets: ["apps/worker/previews/notifications/otp.html","apps/worker/previews/notifications/invitation.html","apps/worker/previews/notifications/new-device.html"]
---

## Scope and mode

Transactional OTP, organization invitation, and new-device alert emails. Mode: Read, with one safe action when applicable.

## Audience and job

Organizers, invited collaborators, and account holders must identify the message type, verify the operational facts, and complete or reject the next action without ambiguity.

## Proof and constraints

The message exposes only the minimum required status, expiry, masked recipient, organization, device, time, and approximate location. It must remain accessible and legible in Gmail and Outlook using table-first markup, critical inline styles, a hybrid 640 px shell, MSO/VML fallbacks, defensive wrapping, and a 320 px responsive state. Never expose session identifiers, full IP addresses, credentials, or real preview recipients. Do not copy official PUBG branding or artwork.

## Chosen direction

DROP MANIFEST (seed `ca30eaa3`): a tournament operations manifest built from carbon, ivory, steel, signal orange, and security red. The signature moment is the immediate transition from transmission/status band to one dominant datum or action. Red is exclusive to security alerts; geometry and hierarchy carry the identity without remote fonts or imagery.

## Unresolved

Native Gmail and Outlook forced-dark-mode renders remain a non-blocking compatibility risk for a future provider screenshot matrix.
