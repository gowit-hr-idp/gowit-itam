// ============================================================
// ported.js — 이 대화에서 만든 기능 모음 (live 위에 얹기용)
//   * ARU 리소스 비용 명세 업로드 + 대시보드(분류) 연동
//   * AI 월비용대장 월별 보고 피벗 (인쇄/Excel)
//   * Azure 개별 비용목록 접기/펼치기
// azure.js 뒤에 로드됩니다. 모든 함수는 전역.
// ============================================================

// ---------- AI 월비용대장 월별 보고 피벗 ----------
const _aiCostFmtUsd = v => '$' + (Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const _aiCostRowTotal = c => (Number(c.seat_cost_usd)||0) + (Number(c.additional_cost_usd)||0);
const _aiCostPeriodFmt = p => (p||'').replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}년 ${parseInt(m)}월`);

// filteredAiLicenseCosts -> { licenses:[], periods:[], matrix:{period:{license:합계}} }
function _buildAiCostPivot() {
  const licenses = [];
  filteredAiLicenseCosts.forEach(c => {
    const l = c.license_name || '기타';
    if (!licenses.includes(l)) licenses.push(l);
  });
  const periods = [...new Set(filteredAiLicenseCosts.map(c => c.period).filter(Boolean))].sort();
  const matrix = {};
  periods.forEach(p => { matrix[p] = {}; licenses.forEach(l => matrix[p][l] = 0); });
  filteredAiLicenseCosts.forEach(c => {
    const p = c.period; if (!p || !matrix[p]) return;
    const l = c.license_name || '기타';
    matrix[p][l] = (matrix[p][l] || 0) + _aiCostRowTotal(c);
  });
  return { licenses, periods, matrix };
}

function renderAiCostPivot() {
  const head = document.getElementById('aiCostPivotHead');
  const body = document.getElementById('aiCostPivotBody');
  const foot = document.getElementById('aiCostPivotFoot');
  if (!head || !body || !foot) return;

  if (!filteredAiLicenseCosts.length) {
    head.innerHTML = '';
    body.innerHTML = `<tr><td class="text-center py-16 text-gray-400">비용 데이터가 없습니다.</td></tr>`;
    foot.innerHTML = '';
    return;
  }

  const { licenses, periods, matrix } = _buildAiCostPivot();

  // 헤더 (기간 | 라이선스... | 월계)
  let headRow = '<tr><th class="px-3 py-2 text-left border-b border-gray-100">기간</th>';
  licenses.forEach(l => { headRow += `<th class="px-3 py-2 text-right border-b border-gray-100 whitespace-nowrap">${l}</th>`; });
  headRow += '<th class="px-3 py-2 text-center border-b border-gray-100">월계</th></tr>';
  head.innerHTML = headRow;

  // 바디
  body.innerHTML = periods.map(p => {
    let total = 0;
    const cells = licenses.map(l => {
      const v = matrix[p][l] || 0; total += v;
      return `<td class="px-3 py-2 text-right">${v ? _aiCostFmtUsd(v) : '<span class="text-gray-300">-</span>'}</td>`;
    }).join('');
    return `<tr class="border-b border-gray-50 hover:bg-violet-50/20">
      <td class="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">${_aiCostPeriodFmt(p)}</td>
      ${cells}
      <td class="px-3 py-2 text-right font-bold text-violet-700">${_aiCostFmtUsd(total)}</td>
    </tr>`;
  }).join('');

  // 당월 - 전월 증감 (마지막 두 기간 비교)
  if (periods.length >= 2) {
    const last = periods[periods.length - 1];
    const prev = periods[periods.length - 2];
    let totalDiff = 0;
    const diffCells = licenses.map(l => {
      const diff = (matrix[last][l] || 0) - (matrix[prev][l] || 0);
      totalDiff += diff;
      const cls = diff > 0 ? 'text-red-600' : diff < 0 ? 'text-blue-600' : 'text-gray-400';
      return `<td class="px-3 py-2 text-right ${cls}">${diff ? (diff>0?'+':'') + _aiCostFmtUsd(diff) : '-'}</td>`;
    }).join('');
    foot.innerHTML = `<tr>
      <td class="px-3 py-2">당월 - 전월</td>
      ${diffCells}
      <td class="px-3 py-2 text-right">${totalDiff ? (totalDiff>0?'+':'') + _aiCostFmtUsd(totalDiff) : '-'}</td>
    </tr>`;
  } else {
    foot.innerHTML = '';
  }
}

// 월별 비용대장 - 보고용 인쇄 (부사장 보고 등 깔끔한 인쇄 화면)
function printAiCostReport() {
  if (!filteredAiLicenseCosts.length) { showToast('인쇄할 데이터가 없습니다.', 'warning'); return; }

  const { licenses, periods, matrix } = _buildAiCostPivot();

  const licHeaderCells = licenses.map(l => `<th>${l}</th>`).join('');

  let bodyRows = '';
  periods.forEach(p => {
    let total = 0;
    const cells = licenses.map(l => {
      const v = matrix[p][l] || 0; total += v;
      return `<td class="num">${v ? _aiCostFmtUsd(v) : '-'}</td>`;
    }).join('');
    bodyRows += `<tr><td class="period">${_aiCostPeriodFmt(p)}</td>${cells}<td class="num total">${_aiCostFmtUsd(total)}</td></tr>`;
  });

  let momRow = '';
  if (periods.length >= 2) {
    const last = periods[periods.length - 1];
    const prev = periods[periods.length - 2];
    let totalDiff = 0;
    const diffCells = licenses.map(l => {
      const diff = (matrix[last][l] || 0) - (matrix[prev][l] || 0);
      totalDiff += diff;
      return `<td class="num">${diff ? (diff>0?'+':'') + _aiCostFmtUsd(diff) : '-'}</td>`;
    }).join('');
    momRow = `<tr class="mom-row"><td class="period">당월 - 전월</td>${diffCells}<td class="num total">${totalDiff>0?'+':''}${_aiCostFmtUsd(totalDiff)}</td></tr>`;
  }

  const fromEl = document.getElementById('aiCostFilterFrom');
  const toEl   = document.getElementById('aiCostFilterTo');
  const rangeText = (fromEl?.value || periods[0]) + ' ~ ' + (toEl?.value || periods[periods.length-1]);
  const now = new Date();
  const generatedText = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<title>AI 라이선스 월별 비용대장 보고</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; padding: 32px; color: #1f2937; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: center; }
  thead th { background: #f3f4f6; font-weight: 700; }
  td.period { text-align: left; font-weight: 600; white-space: nowrap; }
  td.num { text-align: right; }
  td.total { font-weight: 700; background: #f5f3ff; }
  tr.mom-row td { background: #fffbeb; font-weight: 700; }
  .footer-note { margin-top: 16px; font-size: 11px; color: #9ca3af; }
  @media print {
    body { padding: 10mm; }
    @page { size: landscape; margin: 10mm; }
  }
</style>
</head>
<body>
  <h1>AI 라이선스 월별 비용 보고</h1>
  <div class="meta">조회 기간: ${rangeText} &nbsp;|&nbsp; 출력일시: ${generatedText} &nbsp;|&nbsp; 통화: USD</div>
  <table>
    <thead>
      <tr><th>기간</th>${licHeaderCells}<th>월계</th></tr>
    </thead>
    <tbody>
      ${bodyRows}
      ${momRow}
    </tbody>
  </table>
  <div class="footer-note">※ 본 보고서는 IT 통합 자산관리 시스템에서 자동 생성되었습니다.</div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;

  const printWin = window.open('', '_blank');
  if (!printWin) {
    showToast('팝업이 차단되어 인쇄 화면을 열 수 없습니다. 팝업 차단을 해제해주세요.', 'error');
    return;
  }
  printWin.document.write(html);
  printWin.document.close();
}

// 월별 보고 피벗 – Excel 내보내기 (원본 엑셀과 동일 레이아웃)
function exportAiCostPivotExcel() {
  if (!filteredAiLicenseCosts.length) { showToast('내보낼 데이터가 없습니다.', 'warning'); return; }
  if (typeof XLSX === 'undefined') { showToast('Excel 내보내기를 사용할 수 없습니다.', 'error'); return; }

  const { licenses, periods, matrix } = _buildAiCostPivot();

  const headerRow = ['기간', ...licenses, '월계'];
  const dataRows = periods.map(p => {
    const vals = licenses.map(l => matrix[p][l] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    return [_aiCostPeriodFmt(p), ...vals, total];
  });

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '월별 보고');
  XLSX.writeFile(wb, `AI라이선스월별비용보고_${Date.now()}.xlsx`);
  showToast('Excel 파일이 다운로드되었습니다.', 'success');
}

// ---------- Azure 개별 비용목록 접기 ----------
function toggleAzCostList() {
  const wrap = document.getElementById('azCostListWrap');
  const caret = document.getElementById('azCostListCaret');
  if (!wrap) return;
  const collapsed = wrap.classList.toggle('hidden');
  if (caret) caret.className = `fas ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'} text-xs text-blue-500 transition-transform`;
}

// 메뉴 진입 시 항상 접힌 상태로 초기화
function collapseAzCostList() {
  const wrap = document.getElementById('azCostListWrap');
  const caret = document.getElementById('azCostListCaret');
  if (wrap) wrap.classList.add('hidden');
  if (caret) caret.className = 'fas fa-chevron-right text-xs text-blue-500 transition-transform';
}

// ---------- ARU 리소스 비용 명세 + 대시보드(분류) 연동 ----------
const ARU_TBL = 'azure_resource_usage';
let allAru = [];            // 현재 기준월의 리소스 사용 명세
const aruExpanded = {};     // { 서비스명: true(펼침)/false(접힘) } — 기본 접힘

function _aruCurrentPeriod() {
  const el = document.getElementById('aruPeriod');
  if (el && el.value) return el.value;
  const now = new Date();
  const p = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if (el) el.value = p;
  return p;
}

// 숫자 파싱 (콤마/공백 제거). 숫자가 아니면 null
function _aruNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? null : n;
}

// period 필터 + 페이지네이션 조회 (대용량 대비)
async function _aruFetchByPeriod(period) {
  const all = [];
  const pageSize = 1000;
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${ARU_TBL}?period=eq.${encodeURIComponent(period)}&order=service_name.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) throw new Error(`조회 실패 ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function _aruDeleteByPeriod(period) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${ARU_TBL}?period=eq.${encodeURIComponent(period)}`, {
    method: 'DELETE', headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
  });
  if (!res.ok) throw new Error(`삭제 실패 ${res.status}: ${await res.text()}`);
}

// 데이터가 존재하는 가장 최근 기준월 (비용 대시보드 연동용)
async function _aruLatestPeriod() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${ARU_TBL}?select=period&order=period.desc&limit=1`;
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows[0].period : null;
  } catch { return null; }
}

// 데이터가 존재하는 기준월 목록 (오름차순) — 대시보드 당월/전월 비교용
async function _aruDistinctPeriods() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${ARU_TBL}?select=period&order=period.asc&limit=100000`;
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) return [];
    const rows = await res.json();
    return [...new Set(rows.map(r => r.period).filter(Boolean))].sort();
  } catch { return []; }
}

// 비용 대시보드 연동용 상태 (업로드된 리소스 비용)
let dashAruLatest = [];        // 최근 기준월 행
let dashAruPrev = [];          // 직전 기준월 행
let dashAruLatestPeriod = null;
let dashAruPrevPeriod = null;

const _aruCostOf = r => Number(r.cost_krw) || 0;

// [분류(서비스구분) 기준] 서비스구분별 리소스 비용 패널 — 분류 > 서비스명 계층
function renderAruCategorySummary() {
  const box = document.getElementById('azResGroupSummary');
  if (!box) return;
  const rows = dashAruLatest;
  if (!rows || !rows.length) {
    box.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">업로드된 리소스 비용 명세가 없습니다.<br><span class="text-xs text-gray-300">월별 비용대장 하단에서 Excel을 업로드하세요.</span></div>`;
    return;
  }
  // 분류 > 서비스명 계층 집계
  const cats = {}; // { 분류: { total, count, services: { 서비스명: { total, count } } } }
  rows.forEach(r => {
    const c = r.category || '미분류';
    const s = r.service_name || '기타';
    const cost = _aruCostOf(r);
    if (!cats[c]) cats[c] = { total: 0, count: 0, services: {} };
    cats[c].total += cost; cats[c].count += 1;
    if (!cats[c].services[s]) cats[c].services[s] = { total: 0, count: 0 };
    cats[c].services[s].total += cost; cats[c].services[s].count += 1;
  });
  const catOrder = Object.keys(cats).sort((a, b) => cats[b].total - cats[a].total);
  const won = v => '₩' + Math.round(v).toLocaleString();

  box.innerHTML = catOrder.map(c => {
    const g = cats[c];
    const svcOrder = Object.keys(g.services).sort((a, b) => g.services[b].total - g.services[a].total);
    const svcRows = svcOrder.map(s => {
      const sd = g.services[s];
      return `
        <div class="flex items-center justify-between py-1 pl-6 text-xs border-b border-gray-50 last:border-0">
          <span class="text-gray-500"><i class="fas fa-level-up-alt fa-rotate-90 text-gray-300 mr-1.5"></i>${s} <span class="text-gray-300">(${sd.count}개)</span></span>
          <span class="font-medium text-gray-600">${won(sd.total)}</span>
        </div>`;
    }).join('');
    return `
      <div class="mb-2">
        <div class="flex items-center justify-between py-1.5 bg-indigo-50/60 rounded-lg px-2">
          <span class="text-sm font-bold text-indigo-700">${c} <span class="text-xs font-normal text-indigo-400">(리소스 ${g.count}개)</span></span>
          <span class="text-sm font-bold text-indigo-700">${won(g.total)}</span>
        </div>
        ${svcRows}
      </div>`;
  }).join('');
}

// 배열 청크 단위 대량 insert
async function _aruInsertBatch(rows) {
  const CHUNK = 500;
  const statusEl = document.getElementById('aruUploadStatus');
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${ARU_TBL}`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`업로드 실패 ${res.status}: ${await res.text()}`);
    if (statusEl) statusEl.textContent = `업로드 중… ${Math.min(i + CHUNK, rows.length)} / ${rows.length}`;
  }
}

async function loadAzureResourceUsage() {
  const period = _aruCurrentPeriod();
  try {
    allAru = await _aruFetchByPeriod(period);

    // 서비스 필터 옵션 채우기
    const services = [...new Set(allAru.map(r => r.service_name || '기타'))].sort((a, b) => a.localeCompare(b));
    const sel = document.getElementById('aruServiceFilter');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">전체 서비스</option>' +
        services.map(s => `<option value="${s.replace(/"/g, '&quot;')}">${s}</option>`).join('');
      if (services.includes(cur)) sel.value = cur;
    }
    renderAruGroups();
  } catch (e) {
    showToast('리소스 사용 명세 조회 실패: ' + e.message, 'error');
  }
}

function toggleAruGroup(svc) {
  aruExpanded[svc] = !(aruExpanded[svc] === true);
  renderAruGroups();
}

function expandAllAruGroups(expand) {
  const services = [...new Set(allAru.map(r => r.service_name || '기타'))];
  services.forEach(s => { aruExpanded[s] = !!expand; });
  renderAruGroups();
}

function renderAruGroups() {
  const tbody = document.getElementById('aruTableBody');
  if (!tbody) return;

  const q = (document.getElementById('aruSearch')?.value || '').trim().toLowerCase();
  const svcFilter = document.getElementById('aruServiceFilter')?.value || '';

  let rows = allAru.slice();
  if (svcFilter) rows = rows.filter(r => (r.service_name || '기타') === svcFilter);
  if (q) rows = rows.filter(r =>
    (r.resource_name || '').toLowerCase().includes(q) ||
    (r.resource_desc || '').toLowerCase().includes(q));

  setEl('aruCount', `${rows.length}건`);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-16 text-gray-400"><i class="fas fa-layer-group text-4xl block mb-3 opacity-20"></i>표시할 리소스 비용 명세가 없습니다.</td></tr>`;
    return;
  }

  // 서비스명 기준 그룹핑
  const groups = {};
  rows.forEach(r => {
    const s = r.service_name || '기타';
    (groups[s] = groups[s] || []).push(r);
  });
  const order = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  const esc = v => String(v ?? '').replace(/"/g, '&quot;');
  const won = v => '₩' + (Number(v) || 0).toLocaleString();

  let html = '';
  order.forEach(svc => {
    const list = groups[svc];
    const cats = [...new Set(list.map(r => r.category).filter(Boolean))];
    const costSum = list.reduce((s, r) => s + (Number(r.cost_krw) || 0), 0);
    const expanded = aruExpanded[svc] === true; // 기본 접힘 (대용량 대비)
    const caret = expanded ? 'fa-chevron-down' : 'fa-chevron-right';
    const svcJs = svc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    html += `<tr class="bg-blue-50/50 border-y border-blue-100 cursor-pointer hover:bg-blue-100/50" onclick="toggleAruGroup('${svcJs}')">
      <td class="px-4 py-2.5 font-bold text-gray-800"><i class="fas ${caret} text-xs text-blue-500 mr-2"></i>${svc} <span class="text-xs font-normal text-gray-400 ml-1">${list.length}개 리소스</span></td>
      <td class="px-4 py-2.5 text-xs text-gray-500">${cats.length ? cats.join(', ') : '-'}</td>
      <td class="px-4 py-2.5"></td>
      <td class="px-4 py-2.5"></td>
      <td class="px-4 py-2.5 text-right font-bold text-blue-700">${won(costSum)}</td>
    </tr>`;

    if (expanded) {
      html += list.map(r => `<tr class="border-b border-gray-50 hover:bg-gray-50">
        <td class="px-4 py-2 pl-10 text-gray-700">${r.resource_name || '-'}</td>
        <td class="px-4 py-2 text-xs text-gray-500">${r.category || '-'}</td>
        <td class="px-4 py-2 text-xs text-gray-500">${r.department || '-'}</td>
        <td class="px-4 py-2 text-xs text-gray-500 max-w-md truncate" title="${esc(r.resource_desc)}">${r.resource_desc || '-'}</td>
        <td class="px-4 py-2 text-right text-gray-600">${won(r.cost_krw)}</td>
      </tr>`).join('');
    }
  });

  tbody.innerHTML = html;
}

// 업로드 헤더명 → DB 컬럼 매핑 (공백/대소문자 무시, 약간의 변형 허용)
function _aruMapHeader(h) {
  const k = String(h || '').replace(/\s/g, '').toLowerCase();
  if (['분류', '카테고리', 'category', 'group', 'servicegroup', '서비스구분'].includes(k)) return 'category';
  if (['부서', 'department', 'dept'].includes(k)) return 'department';
  if (['서비스명', '서비스', 'service', 'servicename'].includes(k)) return 'service_name';
  if (['리소스명', '리소스', 'resource', 'resourcename'].includes(k)) return 'resource_name';
  if (['리소스설명', '설명', 'resourcedesc', 'description', 'desc'].includes(k)) return 'resource_desc';
  if (['리소스비용(원화)', '리소스비용', '비용(원화)', '비용', '비용원화', 'cost', 'costkrw', 'amount', '금액'].includes(k)) return 'cost_krw';
  return null;
}

async function handleAruUpload(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // 같은 파일 재선택 허용
  if (!file) return;

  if (typeof AuthManager !== 'undefined' && AuthManager.hasPermission && !AuthManager.hasPermission('azure', 'write')) {
    showToast('업로드 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  if (typeof XLSX === 'undefined') { showToast('Excel 파서를 사용할 수 없습니다.', 'error'); return; }

  const period = _aruCurrentPeriod();
  const statusEl = document.getElementById('aruUploadStatus');
  if (statusEl) statusEl.textContent = '파일 읽는 중…';

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) { showToast('빈 파일입니다.', 'warning'); if (statusEl) statusEl.textContent = ''; return; }

    // 헤더 행 탐색 (상단 10행 내에서 '서비스명' 열이 있는 첫 행)
    let headerRowIdx = -1, colMap = null;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      const map = {};
      aoa[i].forEach((cell, idx) => { const f = _aruMapHeader(cell); if (f && map[f] === undefined) map[f] = idx; });
      if (map.service_name !== undefined) { headerRowIdx = i; colMap = map; break; }
    }
    if (headerRowIdx < 0 || !colMap) {
      showToast('헤더에서 "서비스명" 열을 찾지 못했습니다. 양식(분류·부서·서비스명·리소스명·리소스 설명·리소스 비용(원화))을 확인해주세요.', 'error');
      if (statusEl) statusEl.textContent = '';
      return;
    }

    const now = Date.now();
    const parsed = [];
    let skipped = 0;
    for (let i = headerRowIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const svc = String(row[colMap.service_name] ?? '').trim();
      if (!svc) { skipped++; continue; } // 서비스명 없는 행 제외 (서비스명으로 맵핑)
      parsed.push({
        period,
        category:      colMap.category      !== undefined ? (String(row[colMap.category] ?? '').trim() || '미분류') : '미분류',
        department:    colMap.department     !== undefined ? String(row[colMap.department] ?? '').trim() : '',
        service_name:  svc,
        resource_name: colMap.resource_name  !== undefined ? String(row[colMap.resource_name] ?? '').trim() : '',
        resource_desc: colMap.resource_desc  !== undefined ? String(row[colMap.resource_desc] ?? '').trim() : '',
        cost_krw:      colMap.cost_krw       !== undefined ? (_aruNum(row[colMap.cost_krw]) ?? 0) : 0,
        created_at: now,
      });
    }

    if (!parsed.length) { showToast('가져올 데이터가 없습니다 (서비스명이 있는 행 없음).', 'warning'); if (statusEl) statusEl.textContent = ''; return; }

    // 기존 월 데이터 처리: 교체 vs 추가
    const existing = await _aruFetchByPeriod(period);
    if (existing.length) {
      const replace = confirm(`${period} 기준월에 이미 ${existing.length}건이 있습니다.\n\n[확인] 기존 데이터를 삭제하고 새로 업로드\n[취소] 기존 데이터에 이어서 추가`);
      if (replace) {
        if (statusEl) statusEl.textContent = '기존 데이터 삭제 중…';
        await _aruDeleteByPeriod(period);
      }
    }

    if (statusEl) statusEl.textContent = `업로드 중… 0 / ${parsed.length}`;
    await _aruInsertBatch(parsed);

    const msg = `${parsed.length.toLocaleString()}건 업로드 완료` + (skipped ? ` (서비스명 없는 ${skipped}건 제외)` : '');
    showToast(msg, 'success');
    if (statusEl) statusEl.textContent = msg;
    await loadAzureResourceUsage();
  } catch (e) {
    showToast('업로드 실패: ' + e.message, 'error');
    if (statusEl) statusEl.textContent = '';
  }
}

function downloadAruTemplate() {
  if (typeof XLSX === 'undefined') { showToast('Excel 기능을 사용할 수 없습니다.', 'error'); return; }
  const headers = ['분류', '부서', '서비스명', '리소스명', '리소스 설명', '리소스 비용(원화)'];
  const example = ['Goworks', '경영지원팀', 'AI Framework', 'gowit-web-prod', '프로덕션 웹앱 인스턴스', 20000];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 32 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '리소스사용량');
  XLSX.writeFile(wb, 'Azure_리소스사용량_업로드양식.xlsx');
  showToast('업로드 양식을 다운로드했습니다.', 'success');
}

function exportAruExcel() {
  if (!allAru.length) { showToast('내보낼 데이터가 없습니다.', 'warning'); return; }
  if (typeof XLSX === 'undefined') { showToast('Excel 기능을 사용할 수 없습니다.', 'error'); return; }
  const headers = ['분류', '부서', '서비스명', '리소스명', '리소스 설명', '리소스 비용(원화)'];
  const sorted = [...allAru].sort((a, b) =>
    (a.category || '').localeCompare(b.category || '') || (a.service_name || '').localeCompare(b.service_name || ''));
  const rows = sorted.map(r => [r.category || '', r.department || '', r.service_name || '', r.resource_name || '', r.resource_desc || '', Number(r.cost_krw) || 0]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 32 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '리소스비용명세');
  XLSX.writeFile(wb, `Azure리소스비용명세_${_aruCurrentPeriod()}_${Date.now()}.xlsx`);
  showToast('Excel 파일이 다운로드되었습니다.', 'success');
}

async function deleteAruPeriod() {
  const period = _aruCurrentPeriod();
  if (typeof AuthManager !== 'undefined' && AuthManager.hasPermission && !AuthManager.hasPermission('azure', 'write')) {
    showToast('삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  if (!allAru.length) { showToast('삭제할 데이터가 없습니다.', 'warning'); return; }
  if (!confirm(`${period} 기준월의 리소스 사용 명세 ${allAru.length.toLocaleString()}건을 모두 삭제하시겠습니까?`)) return;
  try {
    await _aruDeleteByPeriod(period);
    showToast('삭제되었습니다.', 'success');
    await loadAzureResourceUsage();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

// ---------- 대시보드용 ARU 로드 래퍼 ----------
async function loadDashAruAndRender() {
  try {
    const periods = await _aruDistinctPeriods();
    dashAruLatestPeriod = periods[periods.length - 1] || null;
    dashAruPrevPeriod   = periods[periods.length - 2] || null;
    dashAruLatest = dashAruLatestPeriod ? await _aruFetchByPeriod(dashAruLatestPeriod) : [];
    dashAruPrev   = dashAruPrevPeriod   ? await _aruFetchByPeriod(dashAruPrevPeriod)   : [];
    const svcCount  = new Set(dashAruLatest.map(r => r.service_name || '기타')).size;
    const costTotal = dashAruLatest.reduce((s, r) => s + (Number(r.cost_krw) || 0), 0);
    if (typeof setEl === 'function') {
      setEl('az-stat-resources', dashAruLatest.length);
      setEl('az-stat-resources-running', dashAruLatestPeriod
        ? `${dashAruLatestPeriod} · ${svcCount}개 서비스 · ₩${Math.round(costTotal).toLocaleString()}`
        : '업로드 데이터 없음');
    }
    renderAruCategorySummary();
  } catch (e) { /* 대시보드 로드 실패해도 다른 위젯에 영향 없게 무시 */ }
}
