import { createHttpHandler } from './http.mjs';
import { readSitesPrincipal, registerSitesUser } from './auth.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** The same entrypoint is exercised by Worker tests and the published Sites Worker. */
export async function handleSitesRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return json({ service: 'aplus-accelerator', status: 'running' });
  const principal = readSitesPrincipal(request);
  if (!principal) return json({ error: 'ChatGPT 로그인이 필요합니다.' }, 401);
  if (request.headers.get('sec-fetch-site') === 'cross-site' ||
      (request.headers.get('origin') && request.headers.get('origin') !== url.origin)) {
    return json({ error: '다른 사이트에서 보낸 요청은 허용되지 않습니다.' }, 403);
  }
  if (!env?.DB?.prepare || !env.DB.batch || !env?.BUCKET?.put || !env.BUCKET.get || !env.BUCKET.delete) {
    return json({ error: '자료 저장소를 연결하지 못했습니다. 잠시 후 다시 시도하세요.' }, 503);
  }
  try {
    const writesEnabled=env.APLUS_WRITES_ENABLED==='true';
    if(url.pathname.startsWith('/api/')&&request.method!=='GET'&&!writesEnabled) {
      return json({ error: '실제 로그인 검증이 끝날 때까지 자료 변경이 잠겨 있습니다.', code: 'WRITES_LOCKED' }, 423);
    }
    if(writesEnabled)await registerSitesUser(env.DB, principal);
    else await env.DB.prepare('SELECT id FROM users LIMIT 1').bind().first();
    if (url.pathname === '/api/session' && request.method === 'GET') {
      return json({ display_name: principal.displayName, mutations_enabled: writesEnabled });
    }
    // The existing MCP core remains covered by tests. Its Sites plugin is a later milestone.
    if (url.pathname === '/mcp') return json({ error: 'ChatGPT 플러그인 연결은 준비 중입니다.' }, 503);
    const handle = createHttpHandler({ db: env.DB, bucket: env.BUCKET,
      authenticate: async () => principal, allowedOrigin: url.origin });
    return await handle(request);
  } catch {
    console.error('A+ storage request failed', { path: url.pathname });
    return json({ error: '자료 저장소를 사용할 수 없습니다. 작성 내용을 유지하고 다시 시도하세요.' }, 503);
  }
}
