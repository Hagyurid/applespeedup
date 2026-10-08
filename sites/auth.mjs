/** Sites dispatch is the authentication boundary. No app-managed tokens or client IDs. */
export function readSitesPrincipal(request) {
  const id = request.headers.get('oai-authenticated-user-id')?.trim();
  const email = request.headers.get('oai-authenticated-user-email')?.trim();
  if (!id || !email || id.length > 200 || email.length > 320) return null;
  let name = null;
  if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(request.headers.get('oai-authenticated-user-full-name') || '').trim().slice(0, 200) || null; }
    catch { /* An optional display name must not break a verified sign-in. */ }
  }
  return { id, email, displayName: name || email };
}

export async function registerSitesUser(db, principal) {
  // Migrations own the schema. Never create tables during a user request.
  await db.prepare(`INSERT INTO users(id,email,display_name) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name
    WHERE users.email<>excluded.email OR users.display_name IS NOT excluded.display_name`)
    .bind(principal.id, principal.email, principal.displayName).run();
}
