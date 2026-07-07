/* ===================================================
   auth.js  –  로그인 / 세션 관리
   이메일(gowit.co.kr) = 로그인 ID
   =================================================== */
'use strict';

const ALLOWED_DOMAIN = 'gowit.co.kr';

const AuthManager = (() => {
  const SESSION_KEY  = 'ams_session';
  const USERS_TABLE  = 'users';

  /* ── 현재 세션 읽기 ── */
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
  }

  /* ── 로그인 여부 ── */
  function isLoggedIn() {
    const s = getSession();
    return !!(s && s.email && s.role);
  }

  /* ── 현재 사용자 정보 ── */
  function getCurrentUser() {
    return getSession();
  }

  /* ── 로그아웃 ── */
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    // Cloudflare Access 세션(30일)은 그대로 살아있으므로,
    // login.html의 자동 로그인이 즉시 다시 로그인시키지 않도록
    // "방금 로그아웃했다"는 표시만 남기고 이동한다.
    sessionStorage.setItem('just_logged_out', '1');
    window.location.replace('login.html');
  }

  /* ── 인증 가드 ── */
  function requireAuth() {
    if (!isLoggedIn()) {
      window.location.replace('login.html');
      return false;
    }
    return true;
  }

  /* ── 로그인 처리 (email + password) ──
     주의: 비밀번호는 절대 브라우저로 내려받지 않는다.
     Supabase RPC(verify_login)가 서버(DB) 측에서 비교하고
     안전한 필드(id/email/full_name/role/department)만 돌려준다. */
  async function login(email, password) {
    if (!email || !password) throw new Error('이메일과 비밀번호를 입력해주세요.');

    // 도메인 검사
    const emailLower = email.trim().toLowerCase();
    if (!emailLower.endsWith('@' + ALLOWED_DOMAIN)) {
      throw new Error(`@${ALLOWED_DOMAIN} 이메일만 로그인 가능합니다.`);
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_login`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ p_email: emailLower, p_password: password }),
    });
    if (!res.ok) throw new Error('서버 오류가 발생했습니다.');
    const rows = await res.json();
    const user = Array.isArray(rows) ? rows[0] : null;

    if (!user) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');

    // 허용 역할 확인
    const allowed = ['admin', '팀장', '파트장', '팀원'];
    if (!allowed.includes(user.role)) {
      throw new Error('접근 권한이 없습니다. 관리자에게 문의하세요.');
    }

    // 세션 저장
    const session = {
      id:          user.id,
      email:       user.email,
      username:    user.email,          // 하위 호환 (app.js 에서 username 참조)
      full_name:   user.full_name,
      role:        user.role,
      department:  user.department || '',
      is_admin:    user.is_admin === true,
      permissions: user.permissions || null,
      loginAt:     Date.now(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  /* ── admin 여부 (role이 admin이거나, 별도로 is_admin 권한을 부여받은 경우) ── */
  function isAdmin() {
    const s = getSession();
    return !!(s && (s.role === 'admin' || s.is_admin === true));
  }

  /* ── 메뉴별 접근 권한 확인 ──
     group: 'assets' | 'sub' | 'promo' | 'azure'
     type:  'view' | 'write'
     admin은 항상 전체 허용. permissions가 없으면(구버전 계정 등) 안전하게 열람은 허용,
     입력/수정은 막지 않고 그대로 허용한다(기존 동작 유지, 하위호환). */
  function hasPermission(group, type) {
    if (isAdmin()) return true;
    const s = getSession();
    if (!s) return false;
    if (!s.permissions) return true; // permissions 미설정 계정은 기존처럼 전체 허용
    let perms;
    try { perms = typeof s.permissions === 'string' ? JSON.parse(s.permissions) : s.permissions; }
    catch { return true; }
    if (!perms || !perms[group]) return true;
    return perms[group][type] !== false;
  }

  return { isLoggedIn, getCurrentUser, logout, requireAuth, login, isAdmin, hasPermission };
})();
