// Site-admin gate. There's no roles table, so admin access is configured via
// the ADMIN_EMAILS env var (comma-separated). When unset, no one is an admin
// and admin-only surfaces deny everyone — safe by default.
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
