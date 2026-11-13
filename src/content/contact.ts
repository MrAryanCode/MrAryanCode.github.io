// Contact addresses: the one source for the header, the footer and the working-with-me section (DS-01, DS-06).
// Changing a value here moves every page. The profile README must carry the same email and Telegram (AT-12).
export interface Contact {
  email: string;
  emailUrl: string;
  telegramUrl: string;
  telegramHandle: string;
  githubUrl: string;
  githubHandle: string;
  channelUrl: string;
  channelHandle: string;
  /** The CV slot (D-013). `null` until a CV exists: while it is null no CV link and no CV route render. */
  cv: string | null;
}

export const contact: Contact = {
  email: "mraryanmiri@gmail.com",
  emailUrl: "mailto:mraryanmiri@gmail.com",
  telegramUrl: "https://t.me/aryan_61_04",
  telegramHandle: "@aryan_61_04",
  githubUrl: "https://github.com/MrAryanCode",
  githubHandle: "@MrAryanCode",
  channelUrl: "https://t.me/MrAryanCode",
  channelHandle: "@MrAryanCode",
  cv: null,
};
