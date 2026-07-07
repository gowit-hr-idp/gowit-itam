export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ============================================================
    // /api/auto-login
    // Cloudflare Access가 이미 확인해서 넣어주는
    // 'Cf-Access-Authenticated-User-Email' 헤더를 읽어,
    // service_role 키로 (브라우저 노출 없이) 계정을 조회해 돌려준다.
    // 비밀번호는 필요 없음 — Access가 이미 신원을 증명했기 때문.
    // ============================================================
    if (url.pathname === '/api/auto-login') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');

      if (!email) {
        return json({ error: 'no-access-email' }, 401);
      }

      const emailLower = email.trim().toLowerCase();
      const SUPABASE_URL = 'https://lbcydtbbqasiyvqlfivc.supabase.co';

      const sbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?select=id,email,full_name,role,department,active,is_admin,permissions&email=eq.${encodeURIComponent(emailLower)}`,
        {
          headers: {
            'apikey':        env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          },
        }
      );

      if (!sbRes.ok) {
        return json({ error: 'lookup-failed' }, 502);
      }

      const rows = await sbRes.json();
      const user = rows[0];
      const allowedRoles = ['admin', '팀장', '파트장', '팀원'];

      if (!user || user.active === false || !allowedRoles.includes(user.role)) {
        return json({ error: 'no-matching-account', email: emailLower }, 404);
      }

      return json({
        id:          user.id,
        email:       user.email,
        full_name:   user.full_name,
        role:        user.role,
        department:  user.department || '',
        is_admin:    user.is_admin === true,
        permissions: user.permissions || null,
      }, 200);
    }

    // ============================================================
    // 그 외 요청은 기존처럼 GitHub Pages 사이트로 그대로 중계
    // ============================================================
    const upstream = new URL('https://gowit-hr-idp.github.io');
    upstream.pathname = '/gowit-itam' + url.pathname;
    upstream.search = url.search;

    const upstreamRequest = new Request(upstream.toString(), request);
    const response = await fetch(upstreamRequest);
    return new Response(response.body, response);
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
