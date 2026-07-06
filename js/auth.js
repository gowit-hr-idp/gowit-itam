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

  /* ── 로그인 처리 (email + password) ── */
  async function login(email, password) {
    if (!email || !password) throw new Error('이메일과 비밀번호를 입력해주세요.');

    // 도메인 검사
    const emailLower = email.trim().toLowerCase();
    if (!emailLower.endsWith('@' + ALLOWED_DOMAIN)) {
      throw new Error(`@${ALLOWED_DOMAIN} 이메일만 로그인 가능합니다.`);
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${USERS_TABLE}?limit=500&order=created_at.asc`, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    });
    if (!res.ok) throw new Error('서버 오류가 발생했습니다.');
    const users  = await res.json();

    const user = users.find(u =>
      (u.email || '').toLowerCase() === emailLower &&
      u.password === password &&
      u.active !== false
    );

    if (!user) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');

    // 허용 역할 확인
    const allowed = ['admin', '팀장', '파트장', '팀원'];
    if (!allowed.includes(user.role)) {
      throw new Error('접근 권한이 없습니다. 관리자에게 문의하세요.');
    }

    // 세션 저장
    const session = {
      id:         user.id,
      email:      user.email,
      username:   user.email,          // 하위 호환 (app.js 에서 username 참조)
      full_name:  user.full_name,
      role:       user.role,
      department: user.department || '',
      loginAt:    Date.now(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  /* ── admin 여부 ── */
  function isAdmin() {
    const s = getSession();
    return !!(s && s.role === 'admin');
  }

  return { isLoggedIn, getCurrentUser, logout, requireAuth, login, isAdmin };
})();
