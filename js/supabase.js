/* ===================================================
   supabase.js  –  Supabase REST API 공통 헬퍼
   기존 tables/ API를 Supabase PostgREST API로 교체
   =================================================== */
'use strict';

// ============================================================
// Supabase 설정
// ============================================================
const SUPABASE_URL = 'https://lbcydtbbqasiyvqlfivc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Jsx4rjVreEcfB9hmC7q3hg_zhJRZp-P';

const SB_HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer':        'return=representation',
};

// ============================================================
// 공통 Supabase fetch 헬퍼
// ============================================================
// 기존 tables/{table}?limit=100&search=xxx 형태의 호출을
// Supabase PostgREST 형식으로 변환합니다.
//
// 지원 파라미터:
//   limit, page, search (전체 텍스트 검색), sort
//   → Supabase: limit, offset, ilike, order
// ============================================================
async function sbFetch(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();

  // ── path 파싱: "table_name?limit=100&search=xxx" 형태 처리 ──
  const [tablePart, queryStr] = path.split('?');

  // 레코드 단건 접근 여부 확인: "table_name/record_id"
  const slashIdx  = tablePart.indexOf('/');
  const tableName = slashIdx >= 0 ? tablePart.slice(0, slashIdx) : tablePart;
  const recordId  = slashIdx >= 0 ? tablePart.slice(slashIdx + 1) : null;

  // ── 쿼리 파라미터 파싱 ──
  const params  = new URLSearchParams(queryStr || '');
  const limit   = parseInt(params.get('limit') || '1000');
  const page    = parseInt(params.get('page')  || '1');
  const search  = params.get('search') || '';
  const sort    = params.get('sort')   || 'created_at';
  const offset  = (page - 1) * limit;

  // ── Supabase URL 조립 ──
  let url = `${SUPABASE_URL}/rest/v1/${tableName}`;

  if (recordId) {
    // 단건 조회/수정/삭제: /rest/v1/table?id=eq.{id}
    url += `?id=eq.${recordId}`;
  } else if (method === 'GET') {
    const qp = new URLSearchParams();
    // soft delete 제외 (deleted 필드가 있을 경우)
    // qp.set('deleted', 'is.false');  // 필요 시 활성화
    if (search) {
      // 주요 텍스트 컬럼에서 검색 (테이블별로 다를 수 있으나 범용으로 처리)
      // Supabase는 or 필터 지원
      qp.set('or', `(name.ilike.*${search}*,asset_name.ilike.*${search}*,email.ilike.*${search}*,resource_name.ilike.*${search}*,license_name.ilike.*${search}*,item_name.ilike.*${search}*,service_name.ilike.*${search}*)`);
    }
    qp.set('order',  `${sort}.asc.nullslast`);
    qp.set('limit',  limit);
    qp.set('offset', offset);
    url += '?' + qp.toString();
  }

  // ── fetch 실행 ──
  const headers = { ...SB_HEADERS };

  // GET 전체 목록: 총 개수 포함 요청
  if (method === 'GET' && !recordId) {
    headers['Prefer'] = 'count=exact';
  }

  // DELETE: 응답 본문 없음
  if (method === 'DELETE') {
    headers['Prefer'] = '';
  }

  const fetchOpts = {
    method,
    headers,
  };
  if (opts.body) fetchOpts.body = opts.body;

  const res = await fetch(url, fetchOpts);

  // 204 No Content (DELETE 등)
  if (res.status === 204) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase 오류 ${res.status}: ${errText}`);
  }

  const json = await res.json();

  // ── 응답 형식 변환 (기존 tables/ API 호환) ──
  // 기존: { data: [...], total: N, page: N, limit: N }
  // Supabase GET 전체: 배열 반환
  if (method === 'GET' && Array.isArray(json)) {
    // Content-Range 헤더에서 총 개수 파싱
    const contentRange = res.headers.get('Content-Range') || '';
    const totalMatch   = contentRange.match(/\/(\d+)$/);
    const total        = totalMatch ? parseInt(totalMatch[1]) : json.length;
    return { data: json, total, page, limit };
  }

  // 단건 조회 (GET /table?id=eq.xxx) → 배열의 첫 번째 항목
  if (method === 'GET' && recordId && Array.isArray(json)) {
    return json[0] || null;
  }

  // POST/PUT/PATCH → 배열의 첫 번째 항목 (Prefer: return=representation)
  if (Array.isArray(json)) return json[0] || json;

  return json;
}

// ============================================================
// 전역 교체: 기존 tables/ fetch 함수들을 sbFetch로 대체
// ============================================================

// app.js의 apiFetch 교체
async function apiFetch(path, opts = {}) {
  return sbFetch(path, opts);
}

// azure.js의 azApiFetch 교체
async function azApiFetch(path, opts = {}) {
  return sbFetch(path, opts);
}

// promotions.js의 promoApiFetch 교체
async function promoApiFetch(path, opts = {}) {
  return sbFetch(path, opts);
}
