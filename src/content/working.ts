// The signed step 3 copy of the working-with-me section (design.md DS-06, D-028). Each export carries the name of its
// DS-00 row. The link targets are read from contact.ts, so one change there moves every page.
import { contact } from "./contact.ts";

export const COPY_AT_STEP_3_WORKING_HEADING = "Working with me";

export const COPY_AT_STEP_3_WORKING_START =
  "Telegram is the fastest way to reach me. Send the role and what your team is building.";

/** The primary button, then the label `Email` with the address as link text. No availability sentences here (D-028). */
export const COPY_AT_STEP_3_WORKING_LINKS = {
  telegram: { label: "Message me on Telegram", url: contact.telegramUrl },
  email: { label: "Email", text: contact.email, url: contact.emailUrl },
} as const;
