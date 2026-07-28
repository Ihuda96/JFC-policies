/** Department employees and the executive account register with a username
 *  rather than an email, so the login address is derived from it. Kept in one
 *  place so registration, the admin console and sign-in always agree. */
export const INTERNAL_EMAIL_DOMAIN = "jfc-policies.local";

export function loginEmailForUsername(username: string) {
  return `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}
