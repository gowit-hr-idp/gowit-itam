/* ===================================================
   IT 통합 자산관리 시스템 - app.js
   =================================================== */

'use strict';

// ============================================================
// 전역 상태
// ============================================================
const API = 'tables';
const TABLE  = 'fixed_assets';
const HTABLE = 'asset_history';

let allAssets   = [];
let filteredAssets = [];
let currentPage = 1;
const PAGE_SIZE = 15;

let statusChartInstance   = null;
let categoryChartInstance = null;

// ============================================================
// 범용 테이블 정렬 (헤더 클릭 정렬) - 여러 메뉴의 목록 테이블에서 공통 사용
// ============================================================
const _tableSortRegistry = {};
const _tableSortState = {};

function registerSortableTable(key, getArray, setArray, renderFn) {
  _tableSortRegistry[key] = { getArray, setArray, renderFn };
}

function sortTableHeader(key, field, type) {
  const reg = _tableSortRegistry[key];
  if (!reg) return;
  const state = _tableSortState[key] || {};
  const dir = (state.field === field && state.dir === 'asc') ? 'desc' : 'asc';
  _tableSortState[key] = { field, dir };

  const arr = reg.getArray();
  const sorted = [...arr].sort((a, b) => {
    let va = a ? a[field] : null;
    let vb = b ? b[field] : null;
    if (type === 'number') {
      va = Number(va) || 0; vb = Number(vb) || 0;
    } else {
      va = (va ?? '').toString().toLowerCase();
      vb = (vb ?? '').toString().toLowerCase();
    }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  reg.setArray(sorted);
  reg.renderFn();
  updateSortIcons(key, field, dir);
}

function updateSortIcons(key, activeField, dir) {
  document.querySelectorAll(`th[data-sort-table="${key}"]`).forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    const f = th.getAttribute('data-sort-field');
    icon.className = (f === activeField)
      ? `sort-icon fas fa-sort-${dir === 'asc' ? 'up' : 'down'} text-blue-500 ml-1`
      : 'sort-icon fas fa-sort text-gray-300 ml-1';
  });
}

// ============================================================
// 메뉴별 접근 권한 (관리자 콘솔 > 계정 관리에서 설정한 값 반영)
// ============================================================
const PAGE_PERMISSION_GROUP = {
  assets: 'assets', register: 'assets', checkout: 'assets', return: 'assets',
  repair: 'assets', dispose: 'assets', history: 'assets', lifecycle: 'assets',
  'sub-list': 'sub', 'sub-register': 'sub', 'sub-renewal': 'sub', 'sub-cost': 'sub',
  'promo-stock': 'promo', 'promo-in': 'promo', 'promo-out': 'promo', 'promo-history': 'promo',
  'azure-dashboard': 'azure', 'azure-resources': 'azure', 'azure-costs': 'azure',
  'ai-licenses': 'ai', 'ai-costs': 'ai', 'ai-keys': 'ai',
};

// 사이드바에서 열람 권한이 없는 메뉴 그룹을 숨긴다
function applyMenuPermissions() {
  ['assets', 'sub', 'promo', 'azure', 'ai_license'].forEach(group => {
    const navGroup = document.querySelector(`.nav-group[data-group="${group}"]`);
    if (!navGroup) return;
    const permKey = group === 'ai_license' ? 'ai' : group;
    if (!AuthManager.hasPermission(permKey, 'view')) {
      navGroup.classList.add('hidden');
    } else {
      navGroup.classList.remove('hidden');
    }
  });

  // 상단 빠른등록 버튼도 입력/수정 권한 없으면 숨김
  const assetBtn = document.getElementById('headerBtnAssetRegister');
  if (assetBtn) assetBtn.classList.toggle('hidden', !AuthManager.hasPermission('assets', 'write'));
  const subBtn = document.getElementById('headerBtnSubRegister');
  if (subBtn) subBtn.classList.toggle('hidden', !AuthManager.hasPermission('sub', 'write'));
}

// 관리자가 방금 바꾼 권한을, 이미 로그인해 있는 사용자의 화면에도 반영되도록
// 주기적으로 최신 role/permissions를 서버에서 다시 받아온다.
async function refreshSessionPermissions() {
  const session = AuthManager.getCurrentUser();
  if (!session || !session.id) return;
  try {
    const rows = await callUsersRpc('admin_get_user', { p_id: session.id });
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u || u.active === false) {
      // 계정이 비활성화/삭제된 경우 강제 로그아웃
      AuthManager.logout();
      return;
    }
    const updated = {
      ...session,
      role:        u.role,
      department:  u.department || '',
      is_admin:    u.is_admin === true,
      permissions: u.permissions || null,
    };
    sessionStorage.setItem('ams_session', JSON.stringify(updated));
    applyMenuPermissions();
    if (typeof initAzureAdminMenu === 'function') initAzureAdminMenu();
  } catch (e) {
    console.warn('권한 새로고침 실패:', e);
  }
}

// ============================================================
// 초기화
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 로그인 인증 확인
  if (!AuthManager.requireAuth()) return;

  // 사용자 정보 헤더/사이드바에 표시
  const user = AuthManager.getCurrentUser();
  if (user) {
    const roleColors = { '팀장': 'bg-yellow-100 text-yellow-800', '파트장': 'bg-blue-100 text-blue-800', '팀원': 'bg-green-100 text-green-800' };
    const rc = roleColors[user.role] || 'bg-gray-100 text-gray-700';
    const nameEl = document.getElementById('headerUserName');
    const roleEl = document.getElementById('headerUserRole');
    const displayName = user.full_name || user.email || user.username || '-';
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) { roleEl.textContent = user.role; roleEl.className = `text-xs px-2 py-0.5 rounded-full font-semibold role-chip ${rc}`; }
    const sbName = document.getElementById('sidebarUserName');
    const sbRole = document.getElementById('sidebarUserRole');
    if (sbName) sbName.textContent = displayName;
    if (sbRole) sbRole.textContent = `${user.email || ''} · ${user.role}`;
  }

  applyMenuPermissions();

  await loadAllAssets();
  initNavigation();
  initSidebarToggle();
  initSearch();
  initAzureAdminMenu();   // admin 메뉴 표시/숨기기
  await refreshSessionPermissions();     // 로그인 이후 관리자가 바꾼 권한 즉시 반영
  setInterval(refreshSessionPermissions, 60000); // 이후 1분마다 자동 최신화
  navigateTo('dashboard');
});

// ============================================================
// API 헬퍼 (supabase.js의 apiFetch 사용)
// ============================================================

async function loadAllAssets() {
  try {
    const data = await apiFetch(`${TABLE}?limit=1000`);
    allAssets = data.data || [];
    filteredAssets = [...allAssets];
    populateDeptFilter();
    return allAssets;
  } catch (e) {
    showToast('자산 데이터 로드 실패: ' + e.message, 'error');
    return [];
  }
}

// ============================================================
// 네비게이션
// ============================================================
// ============================================================
// 사이드바 아코디언
// ============================================================

// 각 페이지가 속한 그룹 매핑
const PAGE_GROUP_MAP = {
  assets: 'assets', register: 'assets', checkout: 'assets', return: 'assets',
  repair: 'assets', dispose: 'assets', history: 'assets', lifecycle: 'assets', 'assets-settings': 'assets',
  'sub-list': 'sub', 'sub-register': 'sub', 'sub-renewal': 'sub', 'sub-cost': 'sub', 'sub-settings': 'sub',
  'promo-stock': 'promo', 'promo-in': 'promo', 'promo-out': 'promo', 'promo-history': 'promo', 'promo-settings': 'promo',
  'azure-dashboard': 'azure', 'azure-resources': 'azure', 'azure-costs': 'azure', 'azure-settings': 'azure',
  'ai-licenses': 'ai_license', 'ai-costs': 'ai_license', 'ai-keys': 'ai_license', 'ai-settings': 'ai_license',
  'admin-users': 'admin', 'admin-categories': 'admin', 'admin-logs': 'admin',
};

function toggleNavGroup(groupId) {
  const group = document.querySelector(`.nav-group[data-group="${groupId}"]`);
  if (!group) return;

  const isOpen = group.classList.contains('open');

  // 다른 그룹 모두 닫기 (accordion 동작)
  document.querySelectorAll('.nav-group.open').forEach(g => {
    if (g !== group) closeNavGroup(g);
  });

  if (isOpen) {
    closeNavGroup(group);
  } else {
    openNavGroup(group);
  }
}

function openNavGroup(group) {
  const menu = group.querySelector('.nav-group-menu');
  if (!menu) return;
  group.classList.add('open');
  // 실제 콘텐츠 높이로 max-height 지정
  menu.style.maxHeight = menu.scrollHeight + 'px';
}

function closeNavGroup(group) {
  const menu = group.querySelector('.nav-group-menu');
  if (!menu) return;
  group.classList.remove('open');
  menu.style.maxHeight = '0';
}

// 특정 페이지가 속한 그룹을 자동으로 열기
function expandGroupForPage(page) {
  const groupId = PAGE_GROUP_MAP[page];
  if (!groupId) return;
  const group = document.querySelector(`.nav-group[data-group="${groupId}"]`);
  if (group && !group.classList.contains('open')) {
    // 다른 그룹 닫기
    document.querySelectorAll('.nav-group.open').forEach(g => {
      if (g !== group) closeNavGroup(g);
    });
    openNavGroup(group);
  }
}

function initNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
    });
  });
}

async function navigateTo(page) {
  // 열람 권한 확인 (사이드바에서 숨겨도 URL/콘솔 등으로 직접 이동을 시도할 수 있으므로 이중 확인)
  const permGroup = PAGE_PERMISSION_GROUP[page];
  if (permGroup && !AuthManager.hasPermission(permGroup, 'view')) {
    showToast('이 메뉴에 대한 열람 권한이 없습니다.', 'error');
    if (page !== 'dashboard') navigateTo('dashboard');
    return;
  }

  // 모든 섹션 숨김
  document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.remove('active-nav');
    l.classList.add('text-blue-200');
  });

  // 메뉴별 "설정"(구 카테고리 관리) 페이지들은 전부 같은 섹션을 공유한다
  const SETTINGS_PAGES = ['assets-settings', 'sub-settings', 'promo-settings', 'azure-settings', 'ai-settings'];
  const sectionKey = SETTINGS_PAGES.includes(page) ? 'admin-categories' : page;

  const section = document.getElementById(`page-${sectionKey}`);
  if (section) section.classList.remove('hidden');

  const activeLink = document.querySelector(`[data-page="${page}"]`);
  if (activeLink) {
    activeLink.classList.add('active-nav');
    activeLink.classList.remove('text-blue-200');
  }

  // 해당 페이지의 그룹 자동 펼치기
  expandGroupForPage(page);

  const titles = {
    dashboard:   ['대시보드', '홈 / 대시보드'],
    assets:      ['자산 대장', '홈 / 고정자산 / 자산 대장'],
    register:    ['자산 입고 등록', '홈 / 고정자산 / 자산 입고 등록'],
    checkout:    ['반출 관리', '홈 / 고정자산 / 반출 관리'],
    return:      ['반납 관리', '홈 / 고정자산 / 반납 관리'],
    repair:      ['수리 관리', '홈 / 고정자산 / 수리 관리'],
    dispose:     ['폐기/매각 처리', '홈 / 고정자산 / 폐기/매각'],
    history:     ['변경 이력', '홈 / 고정자산 / 변경 이력'],
    lifecycle:   ['교체주기 관리', '홈 / 고정자산 / 교체주기 관리'],
    'sub-list':    ['IT 정기결제 목록', '홈 / IT 정기결제 / 구독 목록'],
    'sub-register':['IT 정기결제 등록', '홈 / IT 정기결제 / 구독 등록'],
    'sub-renewal': ['갱신 알림', '홈 / IT 정기결제 / 갱신 알림'],
    'sub-cost':    ['비용 분석', '홈 / IT 정기결제 / 비용 분석'],
    'promo-stock':    ['판촉물 재고 현황', '홈 / 판촉물 / 재고 현황'],
    'promo-in':       ['판촉물 입고 처리', '홈 / 판촉물 / 입고 처리'],
    'promo-out':      ['판촉물 출고 처리', '홈 / 판촉물 / 출고 처리'],
    'promo-history':  ['판촉물 입출고 이력', '홈 / 판촉물 / 입출고 이력'],
    'azure-dashboard': ['Azure 비용 대시보드', '홈 / Azure / 비용 대시보드'],
    'azure-resources': ['Azure 리소스 대장',   '홈 / Azure / 리소스 대장'],
    'azure-costs':     ['Azure 월별 비용대장', '홈 / Azure / 월별 비용대장'],
    'ai-licenses':     ['AI 라이선스 관리',    '홈 / AI 라이선스 / 라이선스 현황'],
    'ai-costs':        ['AI 라이선스 월 비용대장', '홈 / AI 라이선스 / 월 비용대장'],
    'ai-keys':         ['API 키 관리',         '홈 / AI 라이선스 / API 키 관리'],
    'assets-settings': ['고정자산 관리 설정',  '홈 / 고정자산 관리 / 설정'],
    'sub-settings':    ['IT정기결제 설정',     '홈 / IT 정기결제 / 설정'],
    'promo-settings':  ['판촉물 관리 설정',    '홈 / 판촉물 관리 / 설정'],
    'azure-settings':  ['Azure 관리 설정',     '홈 / Azure 관리 / 설정'],
    'ai-settings':     ['AI 라이선스 설정',    '홈 / AI 라이선스 / 설정'],
    'admin-users':     ['계정 관리',            '홈 / 관리자 콘솔 / 계정 관리'],
    'admin-categories':['카테고리 관리',        '홈 / 관리자 콘솔 / 카테고리 관리'],
    'admin-logs':      ['접속 로그',            '홈 / 관리자 콘솔 / 접속 로그'],
  };

  const [title, breadcrumb] = titles[page] || ['', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageBreadcrumb').textContent = breadcrumb;

  // 페이지별 데이터 로드
  switch (page) {
    case 'dashboard':    await renderDashboard(); break;
    case 'assets':       await loadAllAssets(); renderAssetTable(); break;
    case 'register':     openModal('registerModal'); navigateTo('assets'); break;
    case 'checkout':     await loadAllAssets(); renderCheckoutPage(); break;
    case 'return':       await loadAllAssets(); renderReturnPage(); break;
    case 'repair':       await loadAllAssets(); renderRepairPage(); break;
    case 'dispose':      await loadAllAssets(); renderDisposePage(); break;
    case 'history':      loadHistory(); break;
    case 'lifecycle':    await loadAllAssets(); renderLifecyclePage(); break;
    case 'sub-list':     await renderSubList(); break;
    case 'sub-register': openModal('subRegisterModal'); navigateTo('sub-list'); break;
    case 'sub-renewal':  await renderRenewalPage(); break;
    case 'sub-cost':     await renderCostAnalysis(); break;
    case 'promo-stock':    await renderPromoStock(); break;
    case 'promo-in':
      await loadAllPromoItems();
      populatePromoInItemList();
      initPromoInOutDefaults();
      refreshAllCategoryDropdowns();
      switchPromoInTab('existing');
      break;
    case 'promo-out':
      await loadAllPromoItems(); populatePromoSelects(); initPromoInOutDefaults(); break;
    case 'promo-history':  loadPromoHistory(); break;
    case 'azure-dashboard': await renderAzureDashboard(); break;
    case 'azure-resources': await renderAzureResources(); break;
    case 'azure-costs':     refreshAllCategoryDropdowns(); await loadAzureCosts(); break;
    case 'ai-licenses':     await renderAzureLicenses(); break;
    case 'ai-costs':        await loadAiLicenseCosts(); break;
    case 'ai-keys':         await loadAiLicenseKeys(); break;
    case 'admin-users':
      if (!AuthManager.isAdmin()) { showToast('관리자 권한이 필요합니다.', 'error'); navigateTo('dashboard'); return; }
      await loadAdminUsers(); break;
    case 'admin-categories':
      if (!AuthManager.isAdmin()) { showToast('관리자 권한이 필요합니다.', 'error'); navigateTo('dashboard'); return; }
      await loadCategoryPage(); break;
    case 'assets-settings':
    case 'sub-settings':
    case 'promo-settings':
    case 'azure-settings':
    case 'ai-settings':
      if (!AuthManager.isAdmin()) { showToast('관리자 권한이 필요합니다.', 'error'); navigateTo('dashboard'); return; }
      openCategorySettings(page); break;
    case 'admin-logs':
      if (!AuthManager.isAdmin()) { showToast('관리자 권한이 필요합니다.', 'error'); navigateTo('dashboard'); return; }
      renderAdminLogs(); break;
  }
}

// ============================================================
// 사이드바 토글
// ============================================================
function initSidebarToggle() {
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    const mc = document.getElementById('mainContent');
    const isCollapsing = !sb.classList.contains('collapsed');

    sb.classList.toggle('collapsed');
    mc.classList.toggle('collapsed');

    // 사이드바 접을 때 모든 아코디언 그룹 닫기
    if (isCollapsing) {
      document.querySelectorAll('.nav-group.open').forEach(g => closeNavGroup(g));
    }
  });
}

// ============================================================
// 대시보드
// ============================================================
// ============================================================
// 대시보드 탭 전환
// ============================================================
function switchDashTab(tab) {
  const assetDiv = document.getElementById('dash-asset');
  const subDiv   = document.getElementById('dash-sub');
  const promoDiv = document.getElementById('dash-promo');
  const azureDiv = document.getElementById('dash-azure');
  const aiDiv    = document.getElementById('dash-ai');
  const tabAsset = document.getElementById('dashTab-asset');
  const tabSub   = document.getElementById('dashTab-sub');
  const tabPromo = document.getElementById('dashTab-promo');
  const tabAzure = document.getElementById('dashTab-azure');
  const tabAi    = document.getElementById('dashTab-ai');

  // 전체 숨김
  [assetDiv, subDiv, promoDiv, azureDiv, aiDiv].forEach(d => d && d.classList.add('hidden'));
  [tabAsset, tabSub, tabPromo, tabAzure, tabAi].forEach(t => t && t.classList.remove('active-tab'));

  if (tab === 'asset') {
    assetDiv && assetDiv.classList.remove('hidden');
    tabAsset && tabAsset.classList.add('active-tab');
  } else if (tab === 'sub') {
    subDiv && subDiv.classList.remove('hidden');
    tabSub && tabSub.classList.add('active-tab');
    renderSubDashboard();
  } else if (tab === 'promo') {
    promoDiv && promoDiv.classList.remove('hidden');
    tabPromo && tabPromo.classList.add('active-tab');
    if (typeof renderPromoDashboardTab === 'function') renderPromoDashboardTab();
  } else if (tab === 'azure') {
    azureDiv && azureDiv.classList.remove('hidden');
    tabAzure && tabAzure.classList.add('active-tab');
    if (typeof renderAzureMainDashTab === 'function') renderAzureMainDashTab();
  } else if (tab === 'ai') {
    aiDiv && aiDiv.classList.remove('hidden');
    tabAi && tabAi.classList.add('active-tab');
    if (typeof renderAiLicMainDashTab === 'function') renderAiLicMainDashTab();
  }
}

async function renderDashboard() {
  const assets = await loadAllAssets();

  const total    = assets.length;
  const active   = assets.filter(a => a.status === '사용중').length;
  const outCount = assets.filter(a => ['반출','수리중'].includes(a.status)).length;
  const disposed = assets.filter(a => ['폐기','매각'].includes(a.status)).length;

  document.getElementById('stat-total').textContent    = total;
  document.getElementById('stat-active').textContent   = active;
  document.getElementById('stat-out').textContent      = outCount;
  document.getElementById('stat-disposed').textContent = disposed;

  renderStatusChart(assets);
  renderCategoryChart(assets);
  renderRecentHistory();
  renderWarrantyAlerts(assets);
}

function renderStatusChart(assets) {
  const ctx = document.getElementById('statusChart').getContext('2d');
  const statusMap = {};
  assets.forEach(a => { statusMap[a.status] = (statusMap[a.status] || 0) + 1; });

  const colorMap = {
    '입고':  '#60a5fa',
    '사용중': '#34d399',
    '보관':  '#94a3b8',
    '반출':  '#fb923c',
    '반납':  '#818cf8',
    '수리중': '#fbbf24',
    '폐기':  '#f87171',
    '매각':  '#c084fc',
    '분실':  '#f472b6',
  };

  const labels = Object.keys(statusMap);
  const data   = Object.values(statusMap);
  const colors = labels.map(l => colorMap[l] || '#94a3b8');

  if (statusChartInstance) statusChartInstance.destroy();
  statusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, padding: 12 } },
      },
      cutout: '65%',
    },
  });
}

function renderCategoryChart(assets) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  const catMap = {};
  assets.forEach(a => {
    const cat = a.asset_category || '기타';
    catMap[cat] = (catMap[cat] || 0) + 1;
  });

  const labels = Object.keys(catMap);
  const data   = Object.values(catMap);

  if (categoryChartInstance) categoryChartInstance.destroy();
  categoryChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '자산 수',
        data,
        backgroundColor: 'rgba(59,130,246,0.7)',
        borderColor: '#3b82f6',
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

async function renderRecentHistory() {
  try {
    const data = await apiFetch(`${HTABLE}?limit=6&sort=created_at`);
    const histories = (data.data || []).reverse().slice(0, 6);
    const el = document.getElementById('recentHistory');
    if (!histories.length) {
      el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">이력 없음</p>';
      return;
    }
    el.innerHTML = histories.map(h => `
      <div class="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
        <span class="history-badge hbadge-${h.action_type} mt-0.5 flex-shrink-0">${h.action_type}</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-gray-700 truncate">${h.asset_no} · ${h.description || ''}</p>
          <p class="text-xs text-gray-400 mt-0.5">${h.action_date} · ${h.handler || ''}</p>
        </div>
      </div>
    `).join('');
  } catch(e) {
    document.getElementById('recentHistory').innerHTML = '<p class="text-xs text-gray-400 text-center py-4">데이터 없음</p>';
  }
}

function renderWarrantyAlerts(assets) {
  const today = new Date();
  const el = document.getElementById('warrantyAlert');
  const alertAssets = assets
    .filter(a => a.warranty_end && a.status === '사용중')
    .map(a => {
      const exp = new Date(a.warranty_end);
      const diffDays = Math.ceil((exp - today) / 86400000);
      return { ...a, diffDays };
    })
    .filter(a => a.diffDays <= 90)
    .sort((a, b) => a.diffDays - b.diffDays)
    .slice(0, 6);

  if (!alertAssets.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">90일 이내 만료 예정 없음</p>';
    return;
  }

  el.innerHTML = alertAssets.map(a => {
    const cls = a.diffDays <= 0 ? 'bg-red-50 border-red-200' :
                a.diffDays <= 30 ? 'bg-orange-50 border-orange-200' : 'bg-yellow-50 border-yellow-200';
    const textCls = a.diffDays <= 0 ? 'text-red-700' :
                    a.diffDays <= 30 ? 'text-orange-700' : 'text-yellow-700';
    const label = a.diffDays <= 0 ? `만료 ${Math.abs(a.diffDays)}일 경과` : `${a.diffDays}일 후 만료`;
    return `
      <div class="flex items-center gap-3 p-2.5 ${cls} border rounded-xl">
        <i class="fas fa-shield-alt ${textCls}"></i>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-gray-700 truncate">${a.asset_no} · ${a.asset_name}</p>
          <p class="text-xs text-gray-500">${a.user_name || '-'} / ${a.department || '-'}</p>
        </div>
        <span class="text-xs font-bold ${textCls} whitespace-nowrap">${label}</span>
      </div>
    `;
  }).join('');
}

// ============================================================
// 자산 대장
// ============================================================
function initSearch() {
  const inp = document.getElementById('searchInput');
  if (inp) {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });
  }
}

function populateDeptFilter() {
  const depts = [...new Set(allAssets.map(a => a.department).filter(Boolean))].sort();
  const sel = document.getElementById('filterDept');
  if (!sel) return;
  sel.innerHTML = '<option value="">전체</option>' +
    depts.map(d => `<option>${d}</option>`).join('');
}

function applyFilter() {
  const q    = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const cat  = document.getElementById('filterCategory')?.value || '';
  const stat = document.getElementById('filterStatus')?.value || '';
  const dept = document.getElementById('filterDept')?.value || '';

  filteredAssets = allAssets.filter(a => {
    const matchQ = !q || [a.asset_no, a.asset_name, a.serial_no, a.user_name, a.manufacturer, a.model_name, a.cpu, a.mem, a.ssd]
      .some(v => (v || '').toLowerCase().includes(q));
    const matchCat  = !cat  || a.asset_category === cat;
    const matchStat = !stat || a.status === stat;
    const matchDept = !dept || a.department === dept;
    return matchQ && matchCat && matchStat && matchDept;
  });

  currentPage = 1;
  renderAssetTable();
}

function resetFilter() {
  document.getElementById('searchInput').value  = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterStatus').value   = '';
  document.getElementById('filterDept').value     = '';
  filteredAssets = [...allAssets];
  currentPage = 1;
  renderAssetTable();
}

function renderAssetTable() {
  registerSortableTable('assets', () => filteredAssets, (a) => { filteredAssets = a; }, renderAssetTable);
  const tbody = document.getElementById('assetTableBody');
  const total = filteredAssets.length;
  document.getElementById('assetCount').textContent = `전체 ${total}건`;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = filteredAssets.slice(start, start + PAGE_SIZE);

  if (!pageData.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 text-gray-400">
      <i class="fas fa-search text-3xl block mb-2 opacity-30"></i>
      검색 결과가 없습니다.
    </td></tr>`;
    renderPagination(0, 1);
    return;
  }

  tbody.innerHTML = pageData.map(a => {
    const specText = buildSpecText(a);
    return `
    <tr class="hover:bg-blue-50/30 transition-colors cursor-pointer" onclick="showAssetDetail('${a.id}')">
      <td class="px-3 py-2 font-mono font-semibold text-blue-700 text-xs whitespace-nowrap">${a.asset_no}</td>
      <td class="px-3 py-2">
        <span class="inline-flex items-center gap-1 text-xs px-2 py-1 bg-gray-100 rounded-md font-medium text-gray-600">
          ${getCategoryIcon(a.asset_category)} ${a.asset_category || '-'}
        </span>
      </td>
      <td class="px-3 py-2 font-medium text-gray-800">${a.asset_name || '-'}<br><span class="text-xs text-gray-400">${a.manufacturer||''} ${a.model_name||''}</span></td>
      <td class="px-3 py-2 text-xs text-gray-500">${a.cpu || '<span class="text-gray-300">-</span>'}</td>
      <td class="px-3 py-2 text-xs text-gray-500">${a.mem || '<span class="text-gray-300">-</span>'}</td>
      <td class="px-3 py-2 text-xs text-gray-500">${a.ssd || '<span class="text-gray-300">-</span>'}</td>
      <td class="px-3 py-2 font-mono text-xs text-gray-500">${a.serial_no || '-'}</td>
      <td class="px-3 py-2">${a.user_name ? `<span class="font-medium">${a.user_name}</span><br><span class="text-xs text-gray-400">${a.department||''}</span>` : '<span class="text-gray-300">-</span>'}</td>
      <td class="px-3 py-2"><span class="badge badge-${a.status}">${a.status}</span></td>
      <td class="px-3 py-2 text-xs text-gray-500">${a.purchase_date || '-'}</td>
      <td class="px-3 py-2 text-center" onclick="event.stopPropagation()">
        <div class="flex gap-1 justify-center flex-wrap">
          <button class="action-btn btn-view" onclick="showAssetDetail('${a.id}')"><i class="fas fa-eye"></i></button>
          <button class="action-btn btn-edit" onclick="openEditModal('${a.id}')"><i class="fas fa-edit"></i></button>
          ${getActionButtons(a)}
        </div>
      </td>
    </tr>
  `}).join('');

  renderPagination(total, totalPages);
}

// CPU/MEM/SSD 단요 표시 텍스트 빌드
function buildSpecText(a) {
  const parts = [];
  if (a.cpu) parts.push(a.cpu);
  if (a.mem) parts.push(a.mem);
  if (a.ssd) parts.push(a.ssd);
  return parts.join(' / ') || '-';
}

// PC/서버 분류 선택 시 사양 필드 토글
function toggleSpecFields() {
  const cat       = document.getElementById('f_asset_category')?.value || '';
  const pcFields  = document.getElementById('pcSpecFields');
  const genFields = document.getElementById('generalSpecFields');
  const isPc = ['PC/노트북', '서버'].includes(cat);
  if (pcFields)  pcFields.classList.toggle('hidden', !isPc);
  if (genFields) genFields.classList.toggle('hidden', isPc);
}

function getCategoryIcon(cat) {
  const icons = {
    'PC/노트북': '💻',
    '모니터': '🖥️',
    '서버': '🖧',
    '네트워크장비': '🔌',
    '프린터/복합기': '🖨️',
    '저장장치': '💾',
    '주변기기': '⌨️',
    '기타': '📦',
  };
  return icons[cat] || '📦';
}

function getActionButtons(a) {
  const btns = [];
  if (['사용중', '입고', '보관'].includes(a.status)) {
    btns.push(`<button class="action-btn btn-checkout" onclick="openActionModal('${a.id}','반출','반출 처리')"><i class="fas fa-sign-out-alt"></i></button>`);
    btns.push(`<button class="action-btn btn-repair" onclick="openActionModal('${a.id}','수리의뢰','수리 의뢰')"><i class="fas fa-tools"></i></button>`);
    btns.push(`<button class="action-btn btn-dispose" onclick="openActionModal('${a.id}','폐기','폐기 처리')"><i class="fas fa-trash-alt"></i></button>`);
    btns.push(`<button class="action-btn btn-sell" onclick="openActionModal('${a.id}','매각','매각 처리')"><i class="fas fa-tag"></i></button>`);
  }
  if (a.status === '반출') {
    btns.push(`<button class="action-btn btn-return" onclick="openActionModal('${a.id}','반납','반납 처리')"><i class="fas fa-sign-in-alt"></i></button>`);
  }
  if (a.status === '수리중') {
    btns.push(`<button class="action-btn btn-restore" onclick="openActionModal('${a.id}','수리완료','수리 완료 처리')"><i class="fas fa-check-circle"></i></button>`);
  }
  if (a.status === '반납') {
    btns.push(`<button class="action-btn btn-checkout" onclick="openActionModal('${a.id}','반출','재반출 처리')"><i class="fas fa-redo"></i></button>`);
    btns.push(`<button class="action-btn btn-dispose" onclick="openActionModal('${a.id}','폐기','폐기 처리')"><i class="fas fa-trash-alt"></i></button>`);
    btns.push(`<button class="action-btn btn-sell" onclick="openActionModal('${a.id}','매각','매각 처리')"><i class="fas fa-tag"></i></button>`);
  }
  return btns.join('');
}

function renderPagination(total, totalPages) {
  const info = document.getElementById('pageInfo');
  const pg   = document.getElementById('pagination');
  info.textContent = `${currentPage} / ${totalPages} 페이지`;

  const btns = [];
  btns.push(`<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage<=1?'disabled style="opacity:0.4;cursor:not-allowed;"':''}>‹</button>`);

  let start = Math.max(1, currentPage - 2);
  let end   = Math.min(totalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);

  for (let i = start; i <= end; i++) {
    btns.push(`<button class="page-btn ${i===currentPage?'active':''}" onclick="goPage(${i})">${i}</button>`);
  }
  btns.push(`<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage>=totalPages?'disabled style="opacity:0.4;cursor:not-allowed;"':''}>›</button>`);
  pg.innerHTML = btns.join('');
}

function goPage(p) {
  const totalPages = Math.ceil(filteredAssets.length / PAGE_SIZE);
  if (p < 1 || p > totalPages) return;
  currentPage = p;
  renderAssetTable();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// 자산 상세 보기
// ============================================================
async function showAssetDetail(id) {
  const asset = allAssets.find(a => a.id === id);
  if (!asset) return;

  const priceStr = asset.purchase_price
    ? Number(asset.purchase_price).toLocaleString() + ' 원'
    : '-';

  const warrantyInfo = asset.warranty_end
    ? (() => {
        const days = Math.ceil((new Date(asset.warranty_end) - new Date()) / 86400000);
        if (days < 0) return `<span class="text-red-600 font-bold">${asset.warranty_end} (만료됨)</span>`;
        if (days <= 30) return `<span class="text-orange-600 font-bold">${asset.warranty_end} (${days}일 남음)</span>`;
        return `${asset.warranty_end} (${days}일 남음)`;
      })()
    : '-';

  const isPcCategory = ['PC/노트북','서버'].includes(asset.asset_category);
  const pcSpecHtml = (asset.cpu || asset.mem || asset.ssd) ? `
    <div class="detail-section" style="border-color:#bfdbfe">
      <h4 style="color:#2563eb"><i class="fas fa-microchip mr-1"></i>PC/서버 사양</h4>
      <div class="grid grid-cols-2 gap-x-4">
        <div class="detail-row"><span class="detail-label">CPU</span><span class="detail-value font-mono text-xs">${asset.cpu || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">MEM (메모리)</span><span class="detail-value font-mono text-xs">${asset.mem || '-'}</span></div>
        <div class="detail-row md:col-span-2"><span class="detail-label">SSD/HDD (저장장치)</span><span class="detail-value font-mono text-xs">${asset.ssd || '-'}</span></div>
        ${asset.spec ? `<div class="detail-row md:col-span-2"><span class="detail-label">기타 사양</span><span class="detail-value text-xs">${asset.spec}</span></div>` : ''}
      </div>
    </div>` : (asset.spec ? `
    <div class="detail-section">
      <h4><i class="fas fa-list mr-1"></i>사양</h4>
      <div class="detail-row"><span class="detail-label">사양/규격</span><span class="detail-value text-xs">${asset.spec}</span></div>
    </div>` : '');

  document.getElementById('assetDetailContent').innerHTML = `
    <div class="detail-section">
      <h4><i class="fas fa-tag mr-1"></i>기본 정보</h4>
      <div class="grid grid-cols-2 gap-x-4">
        <div class="detail-row"><span class="detail-label">자산번호</span><span class="detail-value font-mono text-blue-600">${asset.asset_no}</span></div>
        <div class="detail-row"><span class="detail-label">자산 분류</span><span class="detail-value">${getCategoryIcon(asset.asset_category)} ${asset.asset_category || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">장비명</span><span class="detail-value font-semibold">${asset.asset_name || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">현재 상태</span><span class="detail-value"><span class="badge badge-${asset.status}">${asset.status}</span></span></div>
        <div class="detail-row"><span class="detail-label">제조사</span><span class="detail-value">${asset.manufacturer || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">모델명</span><span class="detail-value">${asset.model_name || '-'}</span></div>
        <div class="detail-row md:col-span-2"><span class="detail-label">시리얼번호</span><span class="detail-value font-mono text-xs">${asset.serial_no || '-'}</span></div>
      </div>
    </div>
    ${pcSpecHtml}
    <div class="detail-section">
      <h4><i class="fas fa-shopping-cart mr-1"></i>구매 정보</h4>
      <div class="grid grid-cols-2 gap-x-4">
        <div class="detail-row"><span class="detail-label">구매일자</span><span class="detail-value">${asset.purchase_date || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">구매금액</span><span class="detail-value font-semibold text-blue-700">${priceStr}</span></div>
        <div class="detail-row"><span class="detail-label">구매처</span><span class="detail-value">${asset.vendor || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">보증만료</span><span class="detail-value">${warrantyInfo}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4><i class="fas fa-user mr-1"></i>사용자 & 위치 정보</h4>
      <div class="grid grid-cols-2 gap-x-4">
        <div class="detail-row"><span class="detail-label">사용자</span><span class="detail-value">${asset.user_name || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">사용 시작일</span><span class="detail-value">${asset.usage_start_date || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">사용 부서</span><span class="detail-value">${asset.department || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">위치</span><span class="detail-value">${asset.location || '-'}</span></div>
        <div class="detail-row md:col-span-2"><span class="detail-label">비고</span><span class="detail-value">${asset.note || '-'}</span></div>
      </div>
    </div>
  `;

  document.getElementById('detailEditBtn').onclick = () => {
    closeModal('assetDetailModal');
    openEditModal(id);
  };

  openModal('assetDetailModal');
}

// ============================================================
// 자산 등록 / 수정
// ============================================================
function openEditModal(id) {
  const asset = allAssets.find(a => a.id === id);
  if (!asset) return;

  document.getElementById('registerModalTitle').innerHTML = '<i class="fas fa-edit text-green-500 mr-2"></i>자산 정보 수정';
  document.getElementById('editAssetId').value = id;

  const fields = ['asset_no','asset_category','asset_name','manufacturer','model_name',
                  'serial_no','cpu','mem','ssd','spec','purchase_date','purchase_price','vendor',
                  'warranty_end','user_name','usage_start_date','department','location','status','note'];
  fields.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    if (el) el.value = asset[f] || '';
  });
  // PC사양 필드 토글
  toggleSpecFields();
  toggleUsageStartDate();
  openModal('registerModal');
}

// 상태가 '사용중'일 때만 사용 시작일 입력란을 노출
function toggleUsageStartDate() {
  const status = document.getElementById('f_status')?.value;
  const wrap = document.getElementById('usageStartDateWrap');
  if (!wrap) return;
  if (status === '사용중') wrap.classList.remove('hidden');
  else wrap.classList.add('hidden');
}

async function saveAsset() {
  if (!AuthManager.hasPermission('assets', 'write')) {
    showToast('입력/수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  const editId = document.getElementById('editAssetId').value;

  const fields = ['asset_no','asset_category','asset_name','manufacturer','model_name',
                  'serial_no','cpu','mem','ssd','spec','purchase_date','purchase_price','vendor',
                  'warranty_end','user_name','usage_start_date','department','location','status','note'];

  const payload = {};
  fields.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    if (!el) return;
    payload[f] = f === 'purchase_price' ? (Number(el.value) || 0) : el.value.trim();
  });

  // 필수값 검증
  if (!payload.asset_no) { showToast('자산번호를 입력해주세요.', 'warning'); return; }
  if (!payload.asset_category) { showToast('자산 분류를 선택해주세요.', 'warning'); return; }
  if (!payload.asset_name) { showToast('장비명을 입력해주세요.', 'warning'); return; }
  if (!payload.purchase_date) { showToast('구매일자를 입력해주세요.', 'warning'); return; }

  try {
    if (editId) {
      await apiFetch(`${TABLE}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('자산 정보가 수정되었습니다.', 'success');
      addHistory({
        asset_no: payload.asset_no,
        action_type: '상태변경',
        action_date: new Date().toISOString().split('T')[0],
        description: '자산 정보 수정',
        handler: '관리자',
      });
    } else {
      // 자산번호 중복 체크
      if (allAssets.some(a => a.asset_no === payload.asset_no)) {
        showToast('이미 존재하는 자산번호입니다.', 'error');
        return;
      }
      await apiFetch(TABLE, { method: 'POST', body: JSON.stringify(payload) });
      showToast('신규 자산이 등록되었습니다.', 'success');
      addHistory({
        asset_no: payload.asset_no,
        action_type: '입고',
        action_date: payload.purchase_date || new Date().toISOString().split('T')[0],
        description: '신규 자산 입고 등록',
        handler: '관리자',
        new_status: payload.status,
        department: payload.department,
        user_name: payload.user_name,
      });
    }

    closeModal('registerModal');
    resetRegisterForm();
    await loadAllAssets();
    renderAssetTable();
    document.getElementById('editAssetId').value = '';
    document.getElementById('registerModalTitle').innerHTML = '<i class="fas fa-plus-circle text-blue-500 mr-2"></i>신규 자산 입고 등록';
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

function resetRegisterForm() {
  const fields = ['f_asset_no','f_asset_category','f_asset_name','f_manufacturer','f_model_name',
                  'f_serial_no','f_cpu','f_mem','f_ssd','f_spec','f_purchase_date','f_purchase_price','f_vendor',
                  'f_warranty_end','f_user_name','f_usage_start_date','f_department','f_location','f_note'];
  fields.forEach(f => { const el = document.getElementById(f); if (el) el.value = ''; });
  const statusEl = document.getElementById('f_status');
  if (statusEl) statusEl.value = '사용중';
  toggleUsageStartDate();
  // 사양 필드 초기화
  const pcSpec = document.getElementById('pcSpecFields');
  const genSpec = document.getElementById('generalSpecFields');
  if (pcSpec) pcSpec.classList.add('hidden');
  if (genSpec) genSpec.classList.remove('hidden');
}

// ============================================================
// 상태 변경 액션 모달
// ============================================================
function openActionModal(assetId, actionType, title) {
  const asset = allAssets.find(a => a.id === assetId);
  if (!asset) return;

  document.getElementById('actionAssetId').value = assetId;
  document.getElementById('actionType').value    = actionType;
  document.getElementById('actionModalTitle').innerHTML =
    `<i class="fas fa-${getActionIcon(actionType)} text-blue-500 mr-2"></i>${title} - ${asset.asset_no}`;
  document.getElementById('actionDate').value    = new Date().toISOString().split('T')[0];
  document.getElementById('actionDescription').value = '';
  document.getElementById('actionNote').value   = '';
  // 처리자 자동 설정 (로그인 사용자)
  const cu = AuthManager.getCurrentUser();
  if (cu) {
    const hEl = document.getElementById('actionHandler');
    if (hEl) hEl.value = cu.full_name || cu.username;
  }

  // 추가 필드 (반출 시 사용자/부서, 매각 시 매각금액 등)
  const extra = document.getElementById('actionExtraFields');
  extra.innerHTML = '';

  if (actionType === '반출') {
    extra.innerHTML = `
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="form-label">반출 사용자</label>
          <input type="text" id="actionUser" class="form-input" value="${asset.user_name||''}" placeholder="사용자명" />
        </div>
        <div>
          <label class="form-label">반출 부서</label>
          <input type="text" id="actionDept" class="form-input" value="${asset.department||''}" placeholder="부서명" />
        </div>
        <div>
          <label class="form-label">위치/목적</label>
          <input type="text" id="actionLocation" class="form-input" placeholder="반출 위치 또는 목적" />
        </div>
        <div>
          <label class="form-label">반납 예정일</label>
          <input type="date" id="actionReturnDate" class="form-input" />
        </div>
      </div>
    `;
  } else if (actionType === '매각') {
    extra.innerHTML = `
      <div>
        <label class="form-label">매각 금액 (원)</label>
        <input type="number" id="actionSalePrice" class="form-input" placeholder="매각 금액 입력" />
      </div>
      <div>
        <label class="form-label">매각 대상</label>
        <input type="text" id="actionBuyer" class="form-input" placeholder="매각 대상자/업체명" />
      </div>
    `;
  } else if (actionType === '사용자변경') {
    extra.innerHTML = `
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="form-label">변경 사용자</label>
          <input type="text" id="actionUser" class="form-input" placeholder="새 사용자명" />
        </div>
        <div>
          <label class="form-label">변경 부서</label>
          <input type="text" id="actionDept" class="form-input" placeholder="새 부서명" />
        </div>
      </div>
    `;
  }

  openModal('actionModal');
}

function getActionIcon(type) {
  const map = { '반출':'sign-out-alt','반납':'sign-in-alt','폐기':'trash-alt','매각':'tag','수리의뢰':'tools','수리완료':'check-circle','사용자변경':'user-edit','위치변경':'map-marker-alt' };
  return map[type] || 'cog';
}

async function submitAction() {
  const assetId = document.getElementById('actionAssetId').value;
  const actionType = document.getElementById('actionType').value;
  const actionDate = document.getElementById('actionDate').value;
  const handler = document.getElementById('actionHandler').value;
  const description = document.getElementById('actionDescription').value.trim();
  const note = document.getElementById('actionNote').value.trim();

  if (!actionDate) { showToast('처리일자를 입력해주세요.', 'warning'); return; }
  if (!description) { showToast('처리 내용/사유를 입력해주세요.', 'warning'); return; }

  const asset = allAssets.find(a => a.id === assetId);
  if (!asset) return;

  const prevStatus = asset.status;

  // 상태 매핑
  const statusMap = {
    '반출':   '반출',
    '반납':   '반납',
    '폐기':   '폐기',
    '매각':   '매각',
    '수리의뢰': '수리중',
    '수리완료': '사용중',
  };

  const newStatus = statusMap[actionType] || prevStatus;
  const updatePayload = { ...asset, status: newStatus };

  // 추가 필드 처리
  if (actionType === '반출') {
    const user     = document.getElementById('actionUser')?.value?.trim();
    const dept     = document.getElementById('actionDept')?.value?.trim();
    const location = document.getElementById('actionLocation')?.value?.trim();
    const returnDate = document.getElementById('actionReturnDate')?.value;
    if (user) updatePayload.user_name = user;
    if (dept) updatePayload.department = dept;
    if (location) updatePayload.location = location;
    updatePayload.checkout_date   = actionDate;
    updatePayload.return_due_date = returnDate || '';
  }
  if (actionType === '매각') {
    const salePrice = document.getElementById('actionSalePrice')?.value;
    const buyer     = document.getElementById('actionBuyer')?.value?.trim();
    updatePayload.note = `매각가: ${Number(salePrice).toLocaleString()}원${buyer?' / 매각처: '+buyer:''}` + (note ? ' / ' + note : '');
    updatePayload.user_name = '';
    updatePayload.department = '';
  }
  if (actionType === '반납' || actionType === '폐기') {
    updatePayload.user_name = '';
    updatePayload.department = '';
  }
  if (actionType === '수리완료') {
    // 기존 사용자 유지
  }

  try {
    await apiFetch(`${TABLE}/${assetId}`, { method: 'PUT', body: JSON.stringify(updatePayload) });

    // 이력 저장
    await addHistory({
      asset_id:    assetId,
      asset_no:    asset.asset_no,
      action_type: actionType,
      action_date: actionDate,
      prev_status: prevStatus,
      new_status:  newStatus,
      department:  updatePayload.department || '',
      user_name:   updatePayload.user_name || '',
      handler,
      description,
      note,
    });

    showToast(`${actionType} 처리가 완료되었습니다.`, 'success');
    closeModal('actionModal');
    await loadAllAssets();
    renderAssetTable();

    // 현재 페이지 새로고침
    const currentPageId = document.querySelector('.page-section:not(.hidden)')?.id;
    if (currentPageId === 'page-checkout') renderCheckoutPage();
    else if (currentPageId === 'page-return') renderReturnPage();
    else if (currentPageId === 'page-repair') renderRepairPage();
    else if (currentPageId === 'page-dispose') renderDisposePage();
  } catch (e) {
    showToast('처리 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 이력 저장
// ============================================================
async function addHistory(data) {
  try {
    await apiFetch(HTABLE, { method: 'POST', body: JSON.stringify(data) });
  } catch (e) {
    console.warn('이력 저장 실패:', e);
  }
}

// ============================================================
// 반출/반납/수리 페이지
// ============================================================
function renderCheckoutPage() {
  const items = allAssets.filter(a => a.status === '반출');
  const tbody = document.getElementById('checkoutTableBody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-10 text-gray-400">현재 반출 중인 자산이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(a => `
    <tr class="hover:bg-orange-50/30">
      <td class="font-mono font-semibold text-blue-700 text-xs">${a.asset_no}</td>
      <td class="font-medium">${a.asset_name}<br><span class="text-xs text-gray-400">${a.manufacturer||''} ${a.model_name||''}</span></td>
      <td>${a.user_name||'-'}</td>
      <td>${a.department||'-'}</td>
      <td class="text-xs text-gray-600">${a.checkout_date||'-'}</td>
      <td class="text-xs ${a.return_due_date && new Date(a.return_due_date) < new Date() ? 'text-red-600 font-semibold' : 'text-gray-600'}">${a.return_due_date||'-'}</td>
      <td class="text-xs text-gray-500">${a.location||'-'}<br><span class="text-gray-400">${a.note||''}</span></td>
      <td class="text-center">
        <button class="action-btn btn-return" onclick="openActionModal('${a.id}','반납','반납 처리')">
          <i class="fas fa-sign-in-alt mr-1"></i>반납
        </button>
      </td>
    </tr>
  `).join('');
}

function renderReturnPage() {
  const items = allAssets.filter(a => a.status === '반납');
  const tbody = document.getElementById('returnTableBody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-400">창고 반납 자산이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(a => `
    <tr class="hover:bg-blue-50/30">
      <td class="font-mono font-semibold text-blue-700 text-xs">${a.asset_no}</td>
      <td class="font-medium">${a.asset_name}</td>
      <td class="text-xs text-gray-500">${a.manufacturer||''} ${a.model_name||''}</td>
      <td class="text-xs text-gray-500">${a.note||'-'}</td>
      <td class="text-center">
        <div class="flex gap-1.5 justify-center">
          <button class="action-btn btn-checkout" onclick="openActionModal('${a.id}','반출','재배출')"><i class="fas fa-redo mr-1"></i>재배출</button>
          <button class="action-btn btn-dispose" onclick="openActionModal('${a.id}','폐기','폐기')"><i class="fas fa-trash-alt mr-1"></i>폐기</button>
          <button class="action-btn btn-sell" onclick="openActionModal('${a.id}','매각','매각')"><i class="fas fa-tag mr-1"></i>매각</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderRepairPage() {
  const items = allAssets.filter(a => a.status === '수리중');
  const tbody = document.getElementById('repairTableBody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-400">수리 중인 자산이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(a => `
    <tr class="hover:bg-yellow-50/30">
      <td class="font-mono font-semibold text-blue-700 text-xs">${a.asset_no}</td>
      <td class="font-medium">${a.asset_name}</td>
      <td class="text-xs text-gray-500">${a.manufacturer||''} ${a.model_name||''}</td>
      <td class="text-xs text-gray-500">${a.note||'-'}</td>
      <td class="text-center">
        <button class="action-btn btn-restore" onclick="openActionModal('${a.id}','수리완료','수리 완료')">
          <i class="fas fa-check-circle mr-1"></i>수리완료
        </button>
      </td>
    </tr>
  `).join('');
}

function renderDisposePage() {
  // 폐기/매각 대상 (반납 자산)
  const candidates = allAssets.filter(a => a.status === '반납');
  const disposed   = allAssets.filter(a => ['폐기','매각'].includes(a.status));

  const tbody1 = document.getElementById('disposeTableBody');
  if (!candidates.length) {
    tbody1.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-400">폐기/매각 처리 대상 자산이 없습니다.</td></tr>';
  } else {
    tbody1.innerHTML = candidates.map(a => `
      <tr class="hover:bg-red-50/20">
        <td class="font-mono text-xs text-blue-700">${a.asset_no}</td>
        <td class="font-medium text-sm">${a.asset_name}<br><span class="text-xs text-gray-400">${a.manufacturer||''}</span></td>
        <td class="text-sm font-semibold text-blue-700">${a.purchase_price ? Number(a.purchase_price).toLocaleString()+'원' : '-'}</td>
        <td class="text-center">
          <div class="flex gap-1.5 justify-center">
            <button class="action-btn btn-dispose" onclick="openActionModal('${a.id}','폐기','폐기')"><i class="fas fa-trash-alt mr-1"></i>폐기</button>
            <button class="action-btn btn-sell" onclick="openActionModal('${a.id}','매각','매각')"><i class="fas fa-tag mr-1"></i>매각</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  const tbody2 = document.getElementById('disposedTableBody');
  if (!disposed.length) {
    tbody2.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-400">처리 완료 자산이 없습니다.</td></tr>';
  } else {
    tbody2.innerHTML = disposed.map(a => `
      <tr>
        <td class="font-mono text-xs text-gray-500">${a.asset_no}</td>
        <td class="text-sm text-gray-600">${a.asset_name}</td>
        <td><span class="badge badge-${a.status}">${a.status}</span></td>
        <td class="text-xs text-gray-400">${a.note||'-'}</td>
      </tr>
    `).join('');
  }
}

// ============================================================
// 변경 이력
// ============================================================
async function loadHistory() {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8"><div class="spinner"></div></td></tr>';

  try {
    const data = await apiFetch(`${HTABLE}?limit=500`);
    let histories = (data.data || []).reverse();

    const q    = document.getElementById('historySearch')?.value?.toLowerCase() || '';
    const aType = document.getElementById('historyActionFilter')?.value || '';

    if (q) histories = histories.filter(h =>
      (h.asset_no||'').toLowerCase().includes(q) ||
      (h.user_name||'').toLowerCase().includes(q) ||
      (h.description||'').toLowerCase().includes(q)
    );
    if (aType) histories = histories.filter(h => h.action_type === aType);

    if (!histories.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400">이력 데이터가 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = histories.map(h => `
      <tr class="hover:bg-gray-50">
        <td class="text-xs text-gray-500 whitespace-nowrap">${h.action_date||''}</td>
        <td class="font-mono text-xs text-blue-700">${h.asset_no||''}</td>
        <td><span class="history-badge hbadge-${h.action_type}">${h.action_type}</span></td>
        <td class="text-xs text-gray-500">${h.prev_status ? `<span class="badge badge-${h.prev_status}">${h.prev_status}</span>` : '-'}</td>
        <td class="text-xs">${h.new_status ? `<span class="badge badge-${h.new_status}">${h.new_status}</span>` : '-'}</td>
        <td class="text-xs text-gray-600">${h.department||''} ${h.user_name ? ' / '+h.user_name : ''}</td>
        <td class="text-xs text-gray-500">${h.handler||'-'}</td>
        <td class="text-xs text-gray-600 max-w-xs truncate">${h.description||'-'}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-red-400">${e.message}</td></tr>`;
  }
}

// 구매일 기준 5년 이상 경과한 PC/노트북 목록 (교체·폐기 검토 대상)
let lifecycleList = [];

function renderLifecyclePage() {
  const today = new Date();

  lifecycleList = allAssets
    .filter(a => a.purchase_date
      && a.asset_category === 'PC/노트북'
      && !['폐기', '매각'].includes(a.status))
    .map(a => {
      const purchased = new Date(a.purchase_date);
      const elapsedYears = (today - purchased) / (365.25 * 86400000);
      return { ...a, elapsedYears };
    })
    .filter(a => a.elapsedYears >= 5)
    .sort((a, b) => b.elapsedYears - a.elapsedYears); // 오래된 것부터

  registerSortableTable('lifecycle', () => lifecycleList, (a) => { lifecycleList = a; }, renderLifecycleTable);
  renderLifecycleTable();
}

function renderLifecycleTable() {
  const overdue = lifecycleList;
  const y5 = overdue.filter(a => a.elapsedYears >= 5 && a.elapsedYears < 6).length;
  const y6 = overdue.filter(a => a.elapsedYears >= 6).length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('lifecycle-5y-count', y5);
  set('lifecycle-6y-count', y6);
  set('lifecycle-total-count', overdue.length);

  const tbody = document.getElementById('lifecycleTableBody');
  if (!tbody) return;
  if (!overdue.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-10 text-gray-400">5년 이상 경과한 PC/노트북이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = overdue.map(a => {
    const years = a.elapsedYears.toFixed(1);
    const rowCls = a.elapsedYears >= 6 ? 'bg-red-50/60' : 'bg-yellow-50/60';
    const yearTxt = a.elapsedYears >= 6
      ? `<span class="text-red-600 font-bold">${years}년 경과</span>`
      : `<span class="text-yellow-700 font-semibold">${years}년 경과</span>`;
    return `
      <tr class="${rowCls}">
        <td class="px-4 py-2.5 font-mono text-xs text-blue-700">${a.asset_no}</td>
        <td class="px-4 py-2.5 font-medium text-sm">${a.asset_name}</td>
        <td class="px-4 py-2.5 text-xs text-gray-500">${a.cpu||''} ${a.mem||''} ${a.ssd||''}</td>
        <td class="px-4 py-2.5 text-xs">${a.user_name||'-'} / ${a.department||'-'}</td>
        <td class="px-4 py-2.5 text-sm">${a.purchase_date}</td>
        <td class="px-4 py-2.5">${yearTxt}</td>
        <td class="px-4 py-2.5"><span class="badge badge-${a.status}">${a.status}</span></td>
      </tr>`;
  }).join('');
}
function exportExcel() {
  try {
    const data = filteredAssets.map(a => ({
      '자산번호': a.asset_no,
      '분류': a.asset_category,
      '장비명': a.asset_name,
      '제조사': a.manufacturer,
      '모델명': a.model_name,
      '시리얼번호': a.serial_no,
      'CPU': a.cpu,
      'MEM(메모리)': a.mem,
      'SSD/HDD': a.ssd,
      '기타사양': a.spec,
      '구매일자': a.purchase_date,
      '구매금액': a.purchase_price,
      '구매처': a.vendor,
      '보증만료일': a.warranty_end,
      '사용자': a.user_name,
      '사용시작일': a.usage_start_date,
      '부서': a.department,
      '위치': a.location,
      '상태': a.status,
      '비고': a.note,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '고정자산 대장');

    // 열 너비 설정
    ws['!cols'] = [
      {wch:14},{wch:14},{wch:16},{wch:12},{wch:20},{wch:18},
      {wch:22},{wch:16},{wch:18},{wch:30},{wch:12},{wch:12},
      {wch:18},{wch:12},{wch:10},{wch:10},{wch:14},{wch:20},{wch:8},{wch:20}
    ];

    const now = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `고정자산대장_${now}.xlsx`);
    showToast('Excel 파일이 다운로드되었습니다.', 'success');
  } catch(e) {
    showToast('Excel 내보내기 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 카테고리(공통 코드) 동적 드롭다운 연동
// 관리자 콘솔 > 카테고리 관리에서 등록/수정한 값이
// 실제 등록 화면의 드롭다운에 그대로 반영되도록 한다.
// 해당 그룹에 등록된 카테고리가 하나도 없으면(관리자가 아직 안 건드렸으면)
// 기존 하드코딩 옵션을 그대로 유지한다(안전한 기본값).
// ============================================================
const CATEGORY_DROPDOWN_MAP = [
  { selectId: 'f_asset_category',   group: 'assets'           },
  { selectId: 'sf_category',        group: 'sub'              },
  { selectId: 'pf_category',        group: 'promo'            },
  { selectId: 'azr_service_group',  group: 'azure'            },
  { selectId: 'azr_resource_type',  group: 'azure_restype'    },
  { selectId: 'azc_department',     group: 'azure_cost_dept'  },
  { selectId: 'azc_service_name',   group: 'azure_cost_service' },
  { selectId: 'azCostFilterDept',   group: 'azure_cost_dept'  },
  { selectId: 'azl_license_type',   group: 'ai_license'       },
];

async function loadAllCategoryRows() {
  try {
    const data = await apiFetch(`categories?limit=500`);
    return data?.data || [];
  } catch (e) {
    console.warn('카테고리 목록 로드 실패:', e);
    return [];
  }
}

function fillSelectWithCategories(selectEl, rows, menuGroup) {
  if (!selectEl) return;
  const items = rows
    .filter(c => c.menu_group === menuGroup && c.active !== false)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  if (!items.length) return; // 등록된 카테고리 없으면 기존 옵션 유지

  const keepValue = selectEl.value;
  const firstOption = selectEl.querySelector('option');
  const placeholderText = (firstOption && firstOption.value === '') ? firstOption.textContent : '선택하세요';

  selectEl.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholderText;
  selectEl.appendChild(ph);

  items.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.value;
    opt.textContent = c.name;
    selectEl.appendChild(opt);
  });

  if (keepValue) selectEl.value = keepValue;
}

async function refreshAllCategoryDropdowns() {
  const rows = await loadAllCategoryRows();
  if (!rows.length) return;
  CATEGORY_DROPDOWN_MAP.forEach(({ selectId, group }) => {
    fillSelectWithCategories(document.getElementById(selectId), rows, group);
  });
}

// ============================================================
// 모달 유틸
// ============================================================
const CATEGORY_REFRESH_MODALS = ['registerModal', 'subRegisterModal', 'azureResModal', 'azureLicModal', 'azureCostModal'];

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
  if (CATEGORY_REFRESH_MODALS.includes(id)) {
    refreshAllCategoryDropdowns();
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// 모달 외부 클릭 닫기
let _modalMousedownOnOverlay = false;
document.addEventListener('mousedown', e => {
  _modalMousedownOnOverlay = e.target.classList.contains('modal-overlay');
});
document.addEventListener('click', e => {
  // 텍스트 드래그 선택 중 마우스가 배경까지 밀려나가 놓이는 경우를 방지:
  // 누른 시점과 뗀(클릭) 시점이 둘 다 배경(overlay) 자체였을 때만 모달을 닫는다.
  if (e.target.classList.contains('modal-overlay') && _modalMousedownOnOverlay) {
    closeModal(e.target.id);
  }
});

// ============================================================
// 토스트 알림
// ============================================================
function showToast(msg, type = 'info') {
  const icons = {
    success: 'fas fa-check-circle',
    error:   'fas fa-times-circle',
    warning: 'fas fa-exclamation-triangle',
    info:    'fas fa-info-circle',
  };
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="${icons[type]}"></i><span>${msg}</span>`;
  container.appendChild(toast);

  toast.addEventListener('click', () => removeToast(toast));

  setTimeout(() => removeToast(toast), 4000);
}

function removeToast(toast) {
  toast.classList.add('removing');
  setTimeout(() => toast.remove(), 300);
}

// ============================================================
// 기타 유틸
// ============================================================
function formatCurrency(v) {
  return v ? Number(v).toLocaleString() + ' 원' : '-';
}
