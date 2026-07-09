/* ===================================================
   IT 정기결제 관리 - subscription.js
   =================================================== */

'use strict';

const SUB_TABLE = 'it_subscriptions';

let allSubs = [];
let filteredSubs = [];
let subCurrentPage = 1;
const SUB_PAGE_SIZE = 15;

let subCatChartInst  = null;
let subCycleChartInst = null;
let costCatChartInst  = null;
let costCycleChartInst = null;

// ============================================================
// 초기화 (app.js navigateTo 에서 호출)
// ============================================================
async function loadAllSubs() {
  try {
    const data = await apiFetch(`${SUB_TABLE}?limit=1000`);
    allSubs = data.data || [];
    filteredSubs = [...allSubs];
    updateRenewalBadge();
    return allSubs;
  } catch (e) {
    showToast('구독 데이터 로드 실패: ' + e.message, 'error');
    return [];
  }
}

// ============================================================
// 갱신 배지 업데이트 (사이드바)
// ============================================================
function updateRenewalBadge() {
  const today = new Date();
  const cnt = allSubs.filter(s => {
    if (!s.contract_end || s.status === '해지') return false;
    const days = Math.ceil((new Date(s.contract_end) - today) / 86400000);
    return days <= 30;
  }).length;

  const badge = document.getElementById('renewalBadge');
  if (!badge) return;
  if (cnt > 0) {
    badge.textContent = cnt;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ============================================================
// 대시보드 - 정기결제 탭
// ============================================================
async function renderSubDashboard() {
  await loadAllSubs();
  const active = allSubs.filter(s => s.status === '활성');

  const totalMonthly = active.reduce((sum, s) => sum + (Number(s.monthly_krw) || 0), 0);
  const totalAnnual  = active.reduce((sum, s) => sum + (Number(s.annual_krw) || 0), 0);

  const today = new Date();
  const renewal30 = allSubs.filter(s => {
    if (!s.contract_end || s.status === '해지') return false;
    const d = Math.ceil((new Date(s.contract_end) - today) / 86400000);
    return d >= 0 && d <= 30;
  }).length;

  document.getElementById('sub-stat-total').textContent   = allSubs.length;
  document.getElementById('sub-stat-monthly').textContent = fmtKRW(totalMonthly);
  document.getElementById('sub-stat-annual').textContent  = fmtKRW(totalAnnual);
  document.getElementById('sub-stat-renewal').textContent = renewal30;

  renderSubCategoryChart(active);
  renderSubCycleChart(active);
  renderDashRenewalList();
  renderDashRecentSubs();
}

function renderSubCategoryChart(subs) {
  const ctx = document.getElementById('subCategoryChart')?.getContext('2d');
  if (!ctx) return;
  const catMap = {};
  subs.forEach(s => {
    const cat = s.category || '기타';
    catMap[cat] = (catMap[cat] || 0) + (Number(s.monthly_krw) || 0);
  });
  const labels = Object.keys(catMap);
  const data   = Object.values(catMap).map(v => Math.round(v));
  const colors = ['#818cf8','#34d399','#f87171','#60a5fa','#fbbf24','#c084fc','#22d3ee','#94a3b8'];

  if (subCatChartInst) subCatChartInst.destroy();
  subCatChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0,labels.length), borderWidth: 2, borderColor:'#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position:'right', labels: { font:{size:10}, padding:8 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtKRW(c.raw)}/월` } }
      },
      cutout: '62%'
    }
  });
}

function renderSubCycleChart(subs) {
  const ctx = document.getElementById('subCycleChart')?.getContext('2d');
  if (!ctx) return;
  const cycleMap = {};
  subs.forEach(s => {
    const c = s.billing_cycle || '기타';
    cycleMap[c] = (cycleMap[c] || 0) + 1;
  });
  const labels = Object.keys(cycleMap);
  const data   = Object.values(cycleMap);

  if (subCycleChartInst) subCycleChartInst.destroy();
  subCycleChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label:'구독 수', data, backgroundColor:'rgba(139,92,246,0.7)', borderColor:'#7c3aed', borderWidth:1, borderRadius:6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display:false } },
      scales: { y: { beginAtZero:true, ticks:{stepSize:1,font:{size:10}} }, x: { ticks:{font:{size:10}} } }
    }
  });
}

function renderDashRenewalList() {
  const today = new Date();
  const el = document.getElementById('dashRenewalList');
  if (!el) return;
  const items = allSubs
    .filter(s => s.contract_end && s.status !== '해지')
    .map(s => ({ ...s, diffDays: Math.ceil((new Date(s.contract_end) - today) / 86400000) }))
    .filter(s => s.diffDays <= 30 && s.diffDays >= 0)
    .sort((a, b) => a.diffDays - b.diffDays)
    .slice(0, 6);

  if (!items.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">30일 이내 갱신 예정 없음</p>';
    return;
  }
  el.innerHTML = items.map(s => `
    <div class="flex items-center gap-3 p-2.5 bg-orange-50 border border-orange-100 rounded-xl">
      <span class="text-orange-500 text-lg">${getCatIcon(s.category)}</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-semibold text-gray-800 truncate">${s.service_name}</p>
        <p class="text-xs text-gray-500">${s.manager || '-'} · ${fmtKRW(s.annual_krw)}/년</p>
      </div>
      <span class="text-xs font-bold text-orange-600 whitespace-nowrap">${s.diffDays}일 후</span>
    </div>
  `).join('');
}

function renderDashRecentSubs() {
  const el = document.getElementById('dashRecentSubs');
  if (!el) return;
  const items = [...allSubs].sort((a,b) => (b.created_at||0) - (a.created_at||0)).slice(0, 6);
  if (!items.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">등록된 구독 없음</p>';
    return;
  }
  el.innerHTML = items.map(s => `
    <div class="flex items-center gap-3 p-2.5 bg-gray-50 rounded-xl">
      <span class="text-lg">${getCatIcon(s.category)}</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-semibold text-gray-800 truncate">${s.service_name}</p>
        <p class="text-xs text-gray-500">${s.category || '-'} · ${s.billing_cycle || '-'}</p>
      </div>
      <span class="sub-badge sub-badge-${s.status}">${s.status}</span>
    </div>
  `).join('');
}

// ============================================================
// 구독 목록
// ============================================================
async function renderSubList() {
  await loadAllSubs();
  renderSubCostSummary();
  renderSubTable();
}

function renderSubCostSummary() {
  const active = filteredSubs.filter(s => s.status === '활성');
  const totalM = active.reduce((sum, s) => sum + (Number(s.monthly_krw) || 0), 0);
  const totalA = active.reduce((sum, s) => sum + (Number(s.annual_krw)  || 0), 0);
  const el = document.getElementById('subCostSummary');
  if (!el) return;
  el.innerHTML = `
    <div class="bg-purple-50 border border-purple-100 rounded-xl p-4 flex items-center gap-3">
      <i class="fas fa-calendar-day text-purple-500 text-xl"></i>
      <div><p class="text-xs text-purple-500 font-medium">월 총 비용 (활성)</p><p class="text-base font-bold text-purple-700">${fmtKRW(totalM)}</p></div>
    </div>
    <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3">
      <i class="fas fa-calendar-check text-blue-500 text-xl"></i>
      <div><p class="text-xs text-blue-500 font-medium">연 총 비용 (활성)</p><p class="text-base font-bold text-blue-700">${fmtKRW(totalA)}</p></div>
    </div>
    <div class="bg-green-50 border border-green-100 rounded-xl p-4 flex items-center gap-3">
      <i class="fas fa-check-circle text-green-500 text-xl"></i>
      <div><p class="text-xs text-green-500 font-medium">활성 서비스</p><p class="text-base font-bold text-green-700">${active.length}개</p></div>
    </div>
    <div class="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3">
      <i class="fas fa-bell text-red-500 text-xl"></i>
      <div><p class="text-xs text-red-500 font-medium">30일내 갱신</p><p class="text-base font-bold text-red-700">${getUpcomingRenewalCount(30)}건</p></div>
    </div>
  `;
}

function getUpcomingRenewalCount(days) {
  const today = new Date();
  return allSubs.filter(s => {
    if (!s.contract_end || s.status === '해지') return false;
    const d = Math.ceil((new Date(s.contract_end) - today) / 86400000);
    return d >= 0 && d <= days;
  }).length;
}

function applySubFilter() {
  const q    = (document.getElementById('subSearchInput')?.value || '').toLowerCase();
  const cat  = document.getElementById('subFilterCategory')?.value || '';
  const cycle = document.getElementById('subFilterCycle')?.value || '';
  const stat = document.getElementById('subFilterStatus')?.value || '';

  filteredSubs = allSubs.filter(s => {
    const matchQ = !q || [s.service_name, s.vendor, s.manager, s.department, s.description]
      .some(v => (v||'').toLowerCase().includes(q));
    const matchCat   = !cat   || s.category === cat;
    const matchCycle = !cycle || s.billing_cycle === cycle;
    const matchStat  = !stat  || s.status === stat;
    return matchQ && matchCat && matchCycle && matchStat;
  });
  subCurrentPage = 1;
  renderSubCostSummary();
  renderSubTable();
}

function resetSubFilter() {
  document.getElementById('subSearchInput').value = '';
  document.getElementById('subFilterCategory').value = '';
  document.getElementById('subFilterCycle').value = '';
  document.getElementById('subFilterStatus').value = '';
  filteredSubs = [...allSubs];
  subCurrentPage = 1;
  renderSubCostSummary();
  renderSubTable();
}

function renderSubTable() {
  registerSortableTable('sub', () => filteredSubs, (a) => { filteredSubs = a; }, renderSubTable);
  const tbody = document.getElementById('subTableBody');
  const total = filteredSubs.length;
  document.getElementById('subCount').textContent = `전체 ${total}건`;

  const totalPages = Math.max(1, Math.ceil(total / SUB_PAGE_SIZE));
  if (subCurrentPage > totalPages) subCurrentPage = totalPages;

  const start = (subCurrentPage - 1) * SUB_PAGE_SIZE;
  const pageData = filteredSubs.slice(start, start + SUB_PAGE_SIZE);

  const today = new Date();

  if (!pageData.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-16 text-gray-400">
      <i class="fas fa-credit-card text-4xl block mb-3 opacity-20"></i>
      검색 결과가 없습니다.
    </td></tr>`;
    renderSubPagination(0, 1);
    return;
  }

  tbody.innerHTML = pageData.map(s => {
    const renewalAlert = getRenewalAlert(s, today);
    const rowCls = renewalAlert === 'expired' ? 'renewal-expired' : renewalAlert === '30d' ? 'renewal-30d' : renewalAlert === '90d' ? 'renewal-90d' : '';
    return `
    <tr class="${rowCls} hover:brightness-95 transition-all cursor-pointer" onclick="showSubDetail('${s.id}')">
      <td onclick="event.stopPropagation()">
        <button class="text-left font-semibold text-gray-800 hover:text-purple-600 transition-colors text-sm" onclick="showSubDetail('${s.id}')">${s.service_name}</button>
        ${s.description ? `<p class="text-xs text-gray-400 mt-0.5 truncate max-w-32">${s.description}</p>` : ''}
      </td>
      <td><span class="cat-badge ${getCatClass(s.category)}">${getCatIcon(s.category)} ${s.category || '-'}</span></td>
      <td class="text-xs text-gray-500">${s.vendor || '-'}</td>
      <td class="text-xs"><span class="badge badge-${s.billing_cycle === '월간' ? '입고' : s.billing_cycle === '연간' ? '사용중' : '반납'}">${s.billing_cycle || '-'}</span></td>
      <td class="text-right text-xs">
        <span class="font-semibold">${fmtPrice(s.unit_price, s.currency)}</span>
        ${s.quantity > 1 ? `<span class="text-gray-400"> × ${s.quantity}</span>` : ''}
      </td>
      <td class="text-right font-semibold text-purple-700 text-sm">${s.monthly_krw ? fmtKRW(s.monthly_krw) : '-'}</td>
      <td class="text-xs text-gray-500">${s.payment_method || '-'}</td>
      <td class="text-xs text-gray-600">${s.manager || '-'}</td>
      <td class="text-xs">
        ${s.contract_end ? `<span class="${getRenewalTextClass(s, today)}">${s.contract_end}</span>` : '-'}
        ${getRenewalDayBadge(s, today)}
      </td>
      <td><span class="sub-badge sub-badge-${s.status}">${s.status}</span></td>
      <td class="text-center" onclick="event.stopPropagation()">
        <div class="flex gap-1 justify-center">
          <button class="action-btn btn-view" onclick="showSubDetail('${s.id}')"><i class="fas fa-eye"></i></button>
          <button class="action-btn btn-edit" onclick="openSubEditModal('${s.id}')"><i class="fas fa-edit"></i></button>
          <button class="action-btn btn-dispose" onclick="deleteSub('${s.id}','${s.service_name}')"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `}).join('');

  renderSubPagination(total, totalPages);
}

function getRenewalAlert(s, today) {
  if (!s.contract_end || s.status === '해지') return 'none';
  const d = Math.ceil((new Date(s.contract_end) - today) / 86400000);
  if (d < 0) return 'expired';
  if (d <= 30) return '30d';
  if (d <= 90) return '90d';
  return 'none';
}

function getRenewalTextClass(s, today) {
  const alert = getRenewalAlert(s, today);
  if (alert === 'expired') return 'text-red-600 font-bold';
  if (alert === '30d') return 'text-orange-600 font-semibold';
  if (alert === '90d') return 'text-yellow-600';
  return 'text-gray-500';
}

function getRenewalDayBadge(s, today) {
  if (!s.contract_end || s.status === '해지') return '';
  const d = Math.ceil((new Date(s.contract_end) - today) / 86400000);
  if (d < 0)    return `<span class="renewal-badge renewal-expired-badge block mt-0.5">만료 ${Math.abs(d)}일</span>`;
  if (d <= 30)  return `<span class="renewal-badge renewal-30d-badge block mt-0.5">${d}일 후</span>`;
  if (d <= 90)  return `<span class="renewal-badge renewal-90d-badge block mt-0.5">${d}일 후</span>`;
  return '';
}

function renderSubPagination(total, totalPages) {
  document.getElementById('subPageInfo').textContent = `${subCurrentPage} / ${totalPages} 페이지`;
  const pg = document.getElementById('subPagination');
  const btns = [];
  btns.push(`<button class="page-btn" onclick="goSubPage(${subCurrentPage-1})" ${subCurrentPage<=1?'disabled style="opacity:0.4;"':''}>‹</button>`);
  let s = Math.max(1, subCurrentPage-2), e = Math.min(totalPages, s+4);
  if (e-s<4) s = Math.max(1,e-4);
  for(let i=s;i<=e;i++) btns.push(`<button class="page-btn ${i===subCurrentPage?'active':''}" onclick="goSubPage(${i})">${i}</button>`);
  btns.push(`<button class="page-btn" onclick="goSubPage(${subCurrentPage+1})" ${subCurrentPage>=totalPages?'disabled style="opacity:0.4;"':''}>›</button>`);
  pg.innerHTML = btns.join('');
}

function goSubPage(p) {
  const tp = Math.ceil(filteredSubs.length / SUB_PAGE_SIZE);
  if (p < 1 || p > tp) return;
  subCurrentPage = p;
  renderSubTable();
  window.scrollTo({top:0,behavior:'smooth'});
}

// ============================================================
// 구독 상세
// ============================================================
function showSubDetail(id) {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;
  const today = new Date();

  const el = document.getElementById('subDetailContent');
  el.innerHTML = `
    <div class="sub-detail-header">
      <div class="flex items-center gap-3 mb-3">
        <span class="text-3xl">${getCatIcon(s.category)}</span>
        <div>
          <h3 class="text-lg font-bold">${s.service_name}</h3>
          <p class="text-sm text-purple-200">${s.vendor || ''} · ${s.category || ''}</p>
        </div>
        <span class="ml-auto sub-badge sub-badge-${s.status}">${s.status}</span>
      </div>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div><p class="text-purple-300 text-xs">월 비용</p><p class="font-bold text-xl">${fmtKRW(s.monthly_krw)}</p></div>
        <div><p class="text-purple-300 text-xs">연간 비용</p><p class="font-bold text-xl">${fmtKRW(s.annual_krw)}</p></div>
      </div>
    </div>

    <div class="detail-section">
      <h4><i class="fas fa-info-circle mr-1"></i>서비스 정보</h4>
      <div class="grid grid-cols-2 gap-x-4">
        <div class="detail-row"><span class="detail-label">서비스명</span><span class="detail-value font-bold">${s.service_name}</span></div>
        <div class="detail-row"><span class="detail-label">카테고리</span><span class="detail-value">${getCatIcon(s.category)} ${s.category||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">벤더</span><span class="detail-value">${s.vendor||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">설명</span><span class="detail-value text-xs">${s.description||'-'}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h4><i class="fas fa-credit-card mr-1"></i>결제 정보</h4>
      <div class="grid grid-cols-2 gap-x-4">
        <div class="detail-row"><span class="detail-label">결제 주기</span><span class="detail-value">${s.billing_cycle||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">통화</span><span class="detail-value">${s.currency||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">단가</span><span class="detail-value font-bold">${fmtPrice(s.unit_price,s.currency)}</span></div>
        <div class="detail-row"><span class="detail-label">수량</span><span class="detail-value">${s.quantity||1}</span></div>
        <div class="detail-row"><span class="detail-label">월 환산(원)</span><span class="detail-value font-bold text-purple-700">${fmtKRW(s.monthly_krw)}</span></div>
        <div class="detail-row"><span class="detail-label">연 환산(원)</span><span class="detail-value font-bold text-blue-700">${fmtKRW(s.annual_krw)}</span></div>
        <div class="detail-row"><span class="detail-label">결제 수단</span><span class="detail-value">${s.payment_method||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">결제 계정</span><span class="detail-value text-xs">${s.payment_account||'-'}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h4><i class="fas fa-calendar-alt mr-1"></i>계약 / 갱신 정보</h4>
      <div class="grid grid-cols-2 gap-x-4">
        <div class="detail-row"><span class="detail-label">계약 시작</span><span class="detail-value">${s.contract_start||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">갱신/만료일</span><span class="detail-value ${getRenewalTextClass(s,today)}">${s.contract_end||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">자동 갱신</span><span class="detail-value">${s.auto_renew===true||s.auto_renew==='true'?'✅ 자동갱신':'❌ 수동갱신'}</span></div>
        <div class="detail-row"><span class="detail-label">담당자</span><span class="detail-value">${s.manager||'-'}</span></div>
        <div class="detail-row"><span class="detail-label">사용 부서</span><span class="detail-value">${s.department||'-'}</span></div>
        <div class="detail-row md:col-span-2"><span class="detail-label">비고</span><span class="detail-value">${s.note||'-'}</span></div>
      </div>
    </div>
  `;

  document.getElementById('subDetailEditBtn').onclick = () => { closeModal('subDetailModal'); openSubEditModal(id); };
  document.getElementById('subDetailDeleteBtn').onclick = () => { closeModal('subDetailModal'); deleteSub(id, s.service_name); };
  openModal('subDetailModal');
}

// ============================================================
// 구독 등록 / 수정
// ============================================================
function openSubEditModal(id) {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;

  document.getElementById('subRegisterModalTitle').innerHTML = '<i class="fas fa-edit text-green-500 mr-2"></i>구독 정보 수정';
  document.getElementById('editSubId').value = id;

  const fields = ['service_name','category','vendor','description','billing_cycle','currency',
                  'unit_price','quantity','monthly_krw','annual_krw','payment_method',
                  'payment_account','contract_start','contract_end','manager','department','status','note'];
  fields.forEach(f => {
    const el = document.getElementById(`sf_${f}`);
    if (el) el.value = s[f] ?? '';
  });
  const arEl = document.getElementById('sf_auto_renew');
  if (arEl) arEl.value = (s.auto_renew === true || s.auto_renew === 'true') ? 'true' : 'false';
  openModal('subRegisterModal');
}

async function saveSubscription() {
  if (!AuthManager.hasPermission('sub', 'write')) {
    showToast('입력/수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  const editId = document.getElementById('editSubId').value;

  const fields = ['service_name','category','vendor','description','billing_cycle','currency',
                  'unit_price','quantity','monthly_krw','annual_krw','payment_method',
                  'payment_account','contract_start','contract_end','manager','department','status','note'];

  const payload = {};
  fields.forEach(f => {
    const el = document.getElementById(`sf_${f}`);
    if (!el) return;
    const numFields = ['unit_price','quantity','monthly_krw','annual_krw'];
    payload[f] = numFields.includes(f) ? (Number(el.value) || 0) : el.value.trim();
  });
  payload.auto_renew = document.getElementById('sf_auto_renew').value === 'true';

  // 필수값 검증
  if (!payload.service_name) { showToast('서비스명을 입력해주세요.', 'warning'); return; }
  if (!payload.category)     { showToast('카테고리를 선택해주세요.', 'warning'); return; }
  if (!payload.billing_cycle){ showToast('결제 주기를 선택해주세요.', 'warning'); return; }
  if (!payload.unit_price)   { showToast('단가를 입력해주세요.', 'warning'); return; }

  // 월/연 환산 금액이 비어있으면 0으로 설정 (수기 입력 필수)
  if (!payload.monthly_krw) payload.monthly_krw = 0;
  if (!payload.annual_krw)  payload.annual_krw = 0;

  // 갱신 임박 상태 자동 업데이트
  if (payload.contract_end && payload.status === '활성') {
    const days = Math.ceil((new Date(payload.contract_end) - new Date()) / 86400000);
    if (days >= 0 && days <= 30) payload.status = '만료임박';
  }

  try {
    if (editId) {
      await apiFetch(`${SUB_TABLE}/${editId}`, { method:'PUT', body: JSON.stringify(payload) });
      showToast('구독 정보가 수정되었습니다.', 'success');
    } else {
      await apiFetch(SUB_TABLE, { method:'POST', body: JSON.stringify(payload) });
      showToast('구독 서비스가 등록되었습니다.', 'success');
    }

    closeModal('subRegisterModal');
    resetSubForm();
    await loadAllSubs();

    // 현재 페이지 새로고침
    const cur = document.querySelector('.page-section:not(.hidden)')?.id;
    if (cur === 'page-sub-list')    renderSubTable();
    if (cur === 'page-sub-renewal') renderRenewalPage();
    if (cur === 'page-sub-cost')    renderCostAnalysis();
    if (cur === 'page-dashboard')   renderSubDashboard();
    document.getElementById('editSubId').value = '';
    document.getElementById('subRegisterModalTitle').innerHTML = '<i class="fas fa-credit-card text-purple-500 mr-2"></i>구독 서비스 등록';
  } catch(e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

function resetSubForm() {
  ['sf_service_name','sf_category','sf_vendor','sf_description','sf_billing_cycle',
   'sf_unit_price','sf_quantity','sf_monthly_krw','sf_annual_krw','sf_payment_method',
   'sf_payment_account','sf_contract_start','sf_contract_end','sf_manager','sf_department','sf_note']
  .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  const cur = document.getElementById('sf_currency'); if(cur) cur.value = 'KRW';
  const ar = document.getElementById('sf_auto_renew'); if(ar) ar.value = 'true';
  const qty = document.getElementById('sf_quantity'); if(qty) qty.value = '1';
  const st = document.getElementById('sf_status'); if(st) st.value = '활성';
}

// ============================================================
// 구독 삭제
// ============================================================
async function deleteSub(id, name) {
  if (!confirm(`"${name}" 구독을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    await apiFetch(`${SUB_TABLE}/${id}`, { method:'DELETE' });
    showToast(`"${name}" 구독이 삭제되었습니다.`, 'success');
    await loadAllSubs();
    renderSubTable();
    renderSubCostSummary();
    updateRenewalBadge();
  } catch(e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 갱신 알림 페이지
// ============================================================
async function renderRenewalPage() {
  await loadAllSubs();
  const today = new Date();

  const subs = allSubs
    .filter(s => s.contract_end && s.status !== '해지')
    .map(s => ({ ...s, diffDays: Math.ceil((new Date(s.contract_end) - today) / 86400000) }))
    .sort((a, b) => a.diffDays - b.diffDays);

  const expired = subs.filter(s => s.diffDays < 0).length;
  const d30     = subs.filter(s => s.diffDays >= 0 && s.diffDays <= 30).length;
  const d90     = subs.filter(s => s.diffDays > 30 && s.diffDays <= 90).length;

  document.getElementById('renewal-expired-count').textContent = expired;
  document.getElementById('renewal-30d-count').textContent     = d30;
  document.getElementById('renewal-90d-count').textContent     = d90;

  const tbody = document.getElementById('renewalTableBody');

  const displaySubs = subs.filter(s => s.diffDays <= 90);
  if (!displaySubs.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-10 text-gray-400">90일 이내 갱신 예정 서비스 없음</td></tr>';
    return;
  }

  tbody.innerHTML = displaySubs.map(s => {
    const rowCls = s.diffDays < 0 ? 'renewal-expired' : s.diffDays <= 30 ? 'renewal-30d' : 'renewal-90d';
    const dayText = s.diffDays < 0
      ? `<span class="font-bold text-red-600">만료 ${Math.abs(s.diffDays)}일 경과</span>`
      : `<span class="${s.diffDays<=30?'font-bold text-orange-600':'text-yellow-600'}">${s.diffDays}일 후</span>`;
    return `
      <tr class="${rowCls}">
        <td class="font-semibold text-gray-800">${getCatIcon(s.category)} ${s.service_name}</td>
        <td><span class="cat-badge ${getCatClass(s.category)}">${s.category||'-'}</span></td>
        <td class="text-sm text-gray-600">${s.manager||'-'}</td>
        <td class="text-right font-semibold text-blue-700">${fmtKRW(s.annual_krw)}</td>
        <td class="${s.diffDays<0?'text-red-600 font-bold':s.diffDays<=30?'text-orange-600 font-semibold':'text-gray-600'}">${s.contract_end}</td>
        <td>${dayText}</td>
        <td>${s.auto_renew===true||s.auto_renew==='true' ? '<span class="text-xs text-green-600 font-semibold">✅ 자동</span>' : '<span class="text-xs text-orange-600 font-semibold">⚠️ 수동</span>'}</td>
        <td class="text-center">
          <div class="flex gap-1.5 justify-center">
            <button class="action-btn btn-edit" onclick="openSubEditModal('${s.id}')"><i class="fas fa-edit mr-1"></i>수정</button>
            <button class="action-btn btn-view" onclick="showSubDetail('${s.id}')"><i class="fas fa-eye mr-1"></i>보기</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
// 비용 분석
// ============================================================
async function renderCostAnalysis() {
  await loadAllSubs();
  const active = allSubs.filter(s => s.status === '활성');

  const totalM = active.reduce((sum,s) => sum + (Number(s.monthly_krw)||0), 0);
  const totalA = active.reduce((sum,s) => sum + (Number(s.annual_krw)||0), 0);

  document.getElementById('cost-monthly').textContent = fmtKRW(totalM);
  document.getElementById('cost-annual').textContent  = fmtKRW(totalA);
  document.getElementById('cost-count').textContent   = `${active.length}개`;

  renderCostCategoryChart(active);
  renderCostCycleChart(active);
  renderCostTopList(active);
}

function renderCostCategoryChart(subs) {
  const ctx = document.getElementById('costCategoryChart')?.getContext('2d');
  if (!ctx) return;
  const catMap = {};
  subs.forEach(s => {
    const cat = s.category || '기타';
    catMap[cat] = (catMap[cat]||0) + (Number(s.monthly_krw)||0);
  });
  const labels = Object.keys(catMap).sort((a,b) => catMap[b]-catMap[a]);
  const data   = labels.map(l => Math.round(catMap[l]));
  const colors = ['#7c3aed','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16'];

  if (costCatChartInst) costCatChartInst.destroy();
  costCatChartInst = new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor: colors.slice(0,labels.length), borderWidth:2, borderColor:'#fff' }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ position:'right', labels:{font:{size:11}, padding:10} },
        tooltip:{ callbacks:{ label: c => ` ${c.label}: ${fmtKRW(c.raw)}/월` } }
      },
      cutout:'60%'
    }
  });
}

function renderCostCycleChart(subs) {
  const ctx = document.getElementById('costCycleChart')?.getContext('2d');
  if (!ctx) return;
  const cycleMap = {};
  subs.forEach(s => {
    const c = s.billing_cycle||'기타';
    cycleMap[c] = (cycleMap[c]||0) + (Number(s.annual_krw)||0);
  });
  const labels = Object.keys(cycleMap);
  const data   = labels.map(l => Math.round(cycleMap[l]));

  if (costCycleChartInst) costCycleChartInst.destroy();
  costCycleChartInst = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets:[{ label:'연간 비용', data, backgroundColor:['rgba(124,58,237,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)','rgba(245,158,11,0.7)'], borderWidth:1, borderRadius:6 }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: c => ` ${fmtKRW(c.raw)}/년` } } },
      scales:{ y:{ beginAtZero:true, ticks:{callback:v=>fmtKRW(v), font:{size:9}} }, x:{ticks:{font:{size:10}}} }
    }
  });
}

function renderCostTopList(subs) {
  const el = document.getElementById('costTopList');
  if (!el) return;
  const sorted = [...subs]
    .filter(s => s.annual_krw > 0)
    .sort((a,b) => (Number(b.annual_krw)||0) - (Number(a.annual_krw)||0))
    .slice(0, 10);

  if (!sorted.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">데이터 없음</p>';
    return;
  }

  const maxVal = Number(sorted[0].annual_krw) || 1;
  el.innerHTML = sorted.map((s, i) => {
    const pct = Math.round((Number(s.annual_krw) / maxVal) * 100);
    const barColors = ['#7c3aed','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f43f5e','#0ea5e9'];
    return `
      <div class="flex items-center gap-3">
        <span class="text-xs font-bold text-gray-400 w-5 text-right">${i+1}</span>
        <span class="text-base w-6 text-center">${getCatIcon(s.category)}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm font-semibold text-gray-700 truncate">${s.service_name}</span>
            <span class="text-sm font-bold text-gray-800 ml-2 whitespace-nowrap">${fmtKRW(s.annual_krw)}/년</span>
          </div>
          <div class="cost-bar-wrap">
            <div class="cost-bar" style="width:${pct}%;background:${barColors[i]};"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// Excel 내보내기 (구독)
// ============================================================
function exportSubExcel() {
  try {
    const data = filteredSubs.map(s => ({
      '서비스명': s.service_name,
      '카테고리': s.category,
      '벤더': s.vendor,
      '설명': s.description,
      '결제주기': s.billing_cycle,
      '통화': s.currency,
      '단가': s.unit_price,
      '수량': s.quantity,
      '월환산(원)': s.monthly_krw,
      '연환산(원)': s.annual_krw,
      '결제수단': s.payment_method,
      '결제계정': s.payment_account,
      '계약시작': s.contract_start,
      '갱신/만료일': s.contract_end,
      '자동갱신': s.auto_renew ? '예' : '아니오',
      '담당자': s.manager,
      '사용부서': s.department,
      '상태': s.status,
      '비고': s.note,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'IT정기결제목록');
    ws['!cols'] = Array(19).fill({wch:14});

    const now = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `IT정기결제리스트_${now}.xlsx`);
    showToast('Excel 파일이 다운로드되었습니다.', 'success');
  } catch(e) {
    showToast('Excel 내보내기 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 유틸 함수
// ============================================================
function fmtKRW(v) {
  if (!v && v !== 0) return '-';
  const n = Number(v);
  if (n >= 100000000) return `${(n/100000000).toFixed(1)}억원`;
  if (n >= 10000)     return `${Math.round(n/10000).toLocaleString()}만원`;
  return n.toLocaleString() + '원';
}

function fmtPrice(v, cur) {
  if (!v) return '-';
  const symbols = { KRW:'₩', USD:'$', EUR:'€', JPY:'¥' };
  const sym = symbols[cur] || '';
  return `${sym}${Number(v).toLocaleString()}`;
}

function getCatIcon(cat) {
  const icons = {
    '클라우드/인프라':'☁️','SaaS/협업':'💼','보안':'🔒',
    '개발도구':'⚙️','도메인/DNS':'🌐','라이선스/OS':'🪟',
    'AI/데이터':'🤖','기타':'📦'
  };
  return icons[cat] || '📦';
}

function getCatClass(cat) {
  const map = {
    '클라우드/인프라':'cat-클라우드','SaaS/협업':'cat-SaaS','보안':'cat-보안',
    '개발도구':'cat-개발도구','도메인/DNS':'cat-도메인','라이선스/OS':'cat-라이선스',
    'AI/데이터':'cat-AI','기타':'cat-기타'
  };
  return map[cat] || 'cat-기타';
}
