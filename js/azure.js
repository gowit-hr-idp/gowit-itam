/* ===================================================
   azure.js  –  Azure 리소스/라이선스/비용 관리 + 관리자 콘솔
   =================================================== */
'use strict';

const AZ_RES_TBL  = 'azure_resources';
const AZ_LIC_TBL  = 'azure_licenses';
const AZ_COST_TBL = 'azure_costs';
const AZ_USERS_TBL  = 'users';

let allAzureResources  = [];
let filteredAzureRes   = [];
let allAzureLicenses   = [];
let allAzureCosts      = [];
let filteredAzureCosts = [];

let azCostByServiceChart  = null;
let azResourceTypeChart   = null;
let azLicTypeChart        = null;
let dashAzCostChartInst    = null;
let dashAzResTypeChartInst = null;
let dashAiLicTypeChartInst = null;

// ============================================================
// 공통 API 헬퍼 (supabase.js의 azApiFetch 사용)
// ============================================================

// ============================================================
// 초기화: admin 메뉴 표시 제어
// ============================================================
function initAzureAdminMenu() {
  const isAdmin = AuthManager.isAdmin();
  document.querySelectorAll('.admin-only').forEach(el => {
    if (isAdmin) el.classList.remove('hidden');
    else         el.classList.add('hidden');
  });
}

// ============================================================
// Azure 비용 대시보드
// ============================================================
async function renderAzureDashboard() {
  try {
    const [resData, licData, costData] = await Promise.all([
      azApiFetch(`${AZ_RES_TBL}?limit=1000`),
      azApiFetch(`${AZ_LIC_TBL}?limit=1000`),
      azApiFetch(`${AZ_COST_TBL}?limit=1000`),
    ]);

    allAzureResources = resData?.data || [];
    allAzureLicenses  = licData?.data  || [];
    allAzureCosts     = costData?.data  || [];

    // ── 요약 카드 ──
    const periods = [...new Set(allAzureCosts.map(c => c.period).filter(Boolean))].sort();
    const latestPeriod = periods[periods.length - 1];
    const prevPeriod    = periods[periods.length - 2];
    const totalCostKrw  = allAzureCosts.reduce((s, c) => s + (Number(c.actual_cost_krw) || 0), 0);
    const latestCostKrw = latestPeriod ? allAzureCosts.filter(c => c.period === latestPeriod).reduce((s,c)=>s+(Number(c.actual_cost_krw)||0),0) : 0;
    const prevCostKrw   = prevPeriod   ? allAzureCosts.filter(c => c.period === prevPeriod).reduce((s,c)=>s+(Number(c.actual_cost_krw)||0),0) : 0;
    const momDiff       = latestCostKrw - prevCostKrw;
    const runningCount  = allAzureResources.filter(r => r.status === 'Running').length;

    setEl('az-stat-total-cost',   '₩' + totalCostKrw.toLocaleString());
    setEl('az-stat-total-period', latestPeriod ? `최근월(${latestPeriod}) ₩${latestCostKrw.toLocaleString()}` : '데이터 없음');
    setEl('az-stat-resources',    allAzureResources.length);
    setEl('az-stat-resources-running', `Running ${runningCount}개`);

    if (periods.length >= 2) {
      const sign = momDiff > 0 ? '+' : '';
      setEl('az-stat-mom-change', `${sign}₩${momDiff.toLocaleString()}`);
      setEl('az-stat-mom-label', `${prevPeriod} → ${latestPeriod}`);
    } else {
      setEl('az-stat-mom-change', '-');
      setEl('az-stat-mom-label', '비교할 이전 월 데이터 없음');
    }

    // ── 서비스별 비용 차트 ──
    renderAzCostByServiceChart();
    renderAzCostServiceMomTable();
    renderAzResourceTypeChart();

    // ── 최근 비용 내역 ──
    const tbody = document.getElementById('azureRecentCostBody');
    if (tbody) {
      const recent = [...allAzureCosts]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 8);
      if (!recent.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-400">데이터가 없습니다.</td></tr>`;
      } else {
        tbody.innerHTML = recent.map(c => `
          <tr class="hover:bg-blue-50/30 border-b border-gray-50">
            <td class="px-4 py-2.5 text-xs text-gray-500">${c.period || '-'}</td>
            <td class="px-4 py-2.5 text-sm text-gray-700">${c.department || '-'}</td>
            <td class="px-4 py-2.5 font-medium text-gray-800 text-sm">${c.service_name || '-'}</td>
            <td class="px-4 py-2.5 text-right text-sm font-semibold text-blue-700">₩${Number(c.actual_cost_krw||0).toLocaleString()}</td>
          </tr>`).join('');
      }
    }
  } catch (e) {
    showToast('Azure 대시보드 로드 실패: ' + e.message, 'error');
  }
}

function renderAzCostByServiceChart() {
  const ctx = document.getElementById('azureCostByServiceChart');
  if (!ctx) return;
  if (azCostByServiceChart) { azCostByServiceChart.destroy(); azCostByServiceChart = null; }

  // 서비스별 KRW 합산
  const map = {};
  allAzureCosts.forEach(c => {
    const key = c.service_name || '기타';
    map[key] = (map[key] || 0) + (Number(c.actual_cost_krw) || 0);
  });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!sorted.length) return;

  const colors = ['#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f59e0b','#10b981','#06b6d4'];
  azCostByServiceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors, borderRadius: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: ctx => '₩' + ctx.raw.toLocaleString() } } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { callback: v => '₩' + (v/1000).toFixed(0) + 'K', font: { size: 10 } } },
      },
    },
  });
}

// 서비스(품의서)별 당월-전월 증감 표 (월별 비용대장 피벗과 동일한 집계 기준 사용)
function renderAzCostServiceMomTable() {
  const tbody = document.getElementById('azCostServiceMomBody');
  if (!tbody) return;

  const periods = [...new Set(allAzureCosts.map(c => c.period).filter(Boolean))].sort();
  if (periods.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-300">데이터 없음</td></tr>`;
    return;
  }
  const latest = periods[periods.length - 1];
  const prev   = periods[periods.length - 2];

  // 서비스별 당월/전월 합계 (allAzureCosts 기준 = 월별 비용대장과 동일 데이터)
  const latestMap = {};
  const prevMap   = {};
  allAzureCosts.forEach(c => {
    const key = c.service_name || '기타';
    if (c.period === latest) latestMap[key] = (latestMap[key] || 0) + (Number(c.actual_cost_krw) || 0);
    if (prev && c.period === prev) prevMap[key] = (prevMap[key] || 0) + (Number(c.actual_cost_krw) || 0);
  });

  const services = [...new Set([...Object.keys(latestMap), ...Object.keys(prevMap)])]
    .sort((a, b) => (latestMap[b] || 0) - (latestMap[a] || 0));

  if (!services.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-300">${latest} 데이터 없음</td></tr>`;
    return;
  }

  tbody.innerHTML = services.map(svc => {
    const cur  = latestMap[svc] || 0;
    const pv   = prevMap[svc]   || 0;
    const diff = cur - pv;
    const diffCls = diff > 0 ? 'text-red-600' : diff < 0 ? 'text-blue-600' : 'text-gray-400';
    const diffTxt = prev ? `${diff > 0 ? '+' : ''}₩${diff.toLocaleString()}` : '-';
    return `
      <tr class="border-b border-gray-50">
        <td class="py-1.5 text-gray-700">${svc}</td>
        <td class="py-1.5 text-right font-semibold text-gray-800">₩${cur.toLocaleString()}</td>
        <td class="py-1.5 text-right text-gray-400">${prev ? '₩'+pv.toLocaleString() : '-'}</td>
        <td class="py-1.5 text-right ${diffCls}">${diffTxt}</td>
      </tr>`;
  }).join('');
}

function renderAzResourceTypeChart() {
  const ctx = document.getElementById('azureResourceTypeChart');
  if (!ctx) return;
  if (azResourceTypeChart) { azResourceTypeChart.destroy(); azResourceTypeChart = null; }

  const map = {};
  allAzureResources.forEach(r => { const k = r.resource_type || '기타'; map[k] = (map[k]||0)+1; });
  const entries = Object.entries(map).sort((a,b) => b[1]-a[1]);
  if (!entries.length) return;

  const colors = ['#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f59e0b','#10b981','#06b6d4','#ef4444','#84cc16'];
  azResourceTypeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{ data: entries.map(e => e[1]), backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } },
      cutout: '60%',
    },
  });
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ============================================================
// 메인 대시보드 - Azure 탭
// (사이드바 메뉴 구성과 동일하게 메인 홈 대시보드에도 노출)
// ============================================================
async function renderAzureMainDashTab() {
  try {
    const [resData, costData] = await Promise.all([
      azApiFetch(`${AZ_RES_TBL}?limit=1000`),
      azApiFetch(`${AZ_COST_TBL}?limit=1000`),
    ]);
    const resources = resData?.data || [];
    const costs     = costData?.data || [];

    const totalCostKrw = costs.reduce((s, c) => s + (Number(c.actual_cost_krw) || 0), 0);
    const periods = [...new Set(costs.map(c => c.period).filter(Boolean))].sort();
    const latestPeriod = periods[periods.length - 1];
    const prevPeriod   = periods[periods.length - 2];
    const latestCostKrw = latestPeriod ? costs.filter(c=>c.period===latestPeriod).reduce((s,c)=>s+(Number(c.actual_cost_krw)||0),0) : 0;
    const prevCostKrw   = prevPeriod   ? costs.filter(c=>c.period===prevPeriod).reduce((s,c)=>s+(Number(c.actual_cost_krw)||0),0)   : 0;
    const momDiff = latestCostKrw - prevCostKrw;

    setEl('dashaz-stat-cost',      '₩' + totalCostKrw.toLocaleString());
    setEl('dashaz-stat-resources', resources.length);
    setEl('dashaz-stat-mom', periods.length >= 2 ? `${momDiff>0?'+':''}₩${momDiff.toLocaleString()}` : '-');

    // 서비스별 비용 (막대)
    const costCtx = document.getElementById('dashAzCostChart');
    if (costCtx) {
      if (dashAzCostChartInst) { dashAzCostChartInst.destroy(); dashAzCostChartInst = null; }
      const map = {};
      costs.forEach(c => { const k = c.service_name || '기타'; map[k] = (map[k]||0) + (Number(c.actual_cost_krw)||0); });
      const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, 8);
      if (sorted.length) {
        dashAzCostChartInst = new Chart(costCtx, {
          type: 'bar',
          data: { labels: sorted.map(s=>s[0]), datasets: [{ data: sorted.map(s=>s[1]), backgroundColor: '#3b82f6', borderRadius: 6 }] },
          options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: c => '₩'+c.raw.toLocaleString() } } } },
        });
      }
    }

    // 리소스 타입별 (도넛)
    const resCtx = document.getElementById('dashAzResTypeChart');
    if (resCtx) {
      if (dashAzResTypeChartInst) { dashAzResTypeChartInst.destroy(); dashAzResTypeChartInst = null; }
      const map = {};
      resources.forEach(r => { const k = r.resource_type || '기타'; map[k] = (map[k]||0)+1; });
      const entries = Object.entries(map).sort((a,b) => b[1]-a[1]);
      if (entries.length) {
        const colors = ['#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f59e0b','#10b981','#06b6d4'];
        dashAzResTypeChartInst = new Chart(resCtx, {
          type: 'doughnut',
          data: { labels: entries.map(e=>e[0]), datasets: [{ data: entries.map(e=>e[1]), backgroundColor: colors, borderWidth:2, borderColor:'#fff' }] },
          options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ font:{size:11}, boxWidth:12 } } }, cutout:'60%' },
        });
      }
    }
  } catch (e) {
    console.warn('Azure 대시보드 탭 로드 실패:', e);
  }
}

// ============================================================
// 메인 대시보드 - AI 라이선스 탭
// ============================================================
async function renderAiLicMainDashTab() {
  try {
    const data = await azApiFetch(`${AZ_LIC_TBL}?limit=1000`);
    const licenses = data?.data || [];

    const totalSeats = licenses.reduce((s,l) => s + (Number(l.total_seats)||0), 0);
    const usedSeats  = licenses.reduce((s,l) => s + (Number(l.used_seats)||0), 0);
    const monthlyCost = licenses.reduce((s,l) => s + licenseMonthlyCostKrw(l), 0);
    const expiring = licenses
      .filter(l => l.contract_end)
      .map(l => ({ ...l, days: Math.ceil((new Date(l.contract_end) - new Date()) / 86400000) }))
      .filter(l => l.days >= 0 && l.days <= 60)
      .sort((a,b) => a.days - b.days);

    setEl('dashai-stat-total',    licenses.length + '종');
    setEl('dashai-stat-seats',    `${usedSeats.toLocaleString()} / ${totalSeats.toLocaleString()}`);
    setEl('dashai-stat-cost',     '₩' + monthlyCost.toLocaleString());
    setEl('dashai-stat-expiring', expiring.length);

    const ctx = document.getElementById('dashAiLicTypeChart');
    if (ctx) {
      if (dashAiLicTypeChartInst) { dashAiLicTypeChartInst.destroy(); dashAiLicTypeChartInst = null; }
      const map = {};
      licenses.forEach(l => {
        const key = l.license_type || '기타';
        map[key] = (map[key]||0) + licenseMonthlyCostKrw(l);
      });
      const entries = Object.entries(map).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
      if (entries.length) {
        const colors = ['#8b5cf6','#3b82f6','#ec4899','#f59e0b','#10b981','#06b6d4','#ef4444','#84cc16'];
        dashAiLicTypeChartInst = new Chart(ctx, {
          type: 'doughnut',
          data: { labels: entries.map(e=>e[0]), datasets: [{ data: entries.map(e=>e[1]), backgroundColor: colors, borderWidth:2, borderColor:'#fff' }] },
          options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ font:{size:11}, boxWidth:12 } }, tooltip:{ callbacks:{ label: c => `${c.label}: ₩${c.raw.toLocaleString()}` } } }, cutout:'60%' },
        });
      }
    }

    const box = document.getElementById('dashAiLicExpiring');
    if (box) {
      if (!expiring.length) {
        box.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">만료 임박 라이선스가 없습니다.</div>`;
      } else {
        box.innerHTML = expiring.map(l => `
          <div class="flex items-center justify-between px-3 py-2 rounded-lg ${l.days <= 14 ? 'bg-red-50' : 'bg-orange-50'}">
            <div>
              <div class="text-sm font-semibold text-gray-800">${l.license_name || '-'}</div>
              <div class="text-xs text-gray-500">${l.license_type || ''} · 만료 ${l.contract_end}</div>
            </div>
            <span class="text-xs font-bold ${l.days <= 14 ? 'text-red-600' : 'text-orange-600'}">D-${l.days}</span>
          </div>`).join('');
      }
    }
  } catch (e) {
    console.warn('AI 라이선스 대시보드 탭 로드 실패:', e);
  }
}

function getAzCatBadge(cat) {
  const map = {
    'Compute': 'bg-blue-100 text-blue-700', 'Storage': 'bg-yellow-100 text-yellow-700',
    'Network': 'bg-green-100 text-green-700', 'Database': 'bg-indigo-100 text-indigo-700',
    'AI/ML': 'bg-purple-100 text-purple-700', 'Security': 'bg-red-100 text-red-700',
    'License': 'bg-pink-100 text-pink-700',
  };
  const cls = map[cat] || 'bg-gray-100 text-gray-600';
  return `<span class="text-xs px-2 py-0.5 rounded-full font-medium ${cls}">${cat || '기타'}</span>`;
}

// ============================================================
// Azure 리소스 대장
// ============================================================
async function renderAzureResources() {
  try {
    const data = await azApiFetch(`${AZ_RES_TBL}?limit=1000`);
    allAzureResources = data?.data || [];
    filteredAzureRes  = [...allAzureResources];
    renderAzureResTable();
  } catch (e) {
    showToast('리소스 데이터 로드 실패: ' + e.message, 'error');
  }
}

function applyAzureResFilter() {
  const q      = (document.getElementById('azResSearch')?.value || '').toLowerCase();
  const svc    = document.getElementById('azResFilterService')?.value || '';
  const type   = document.getElementById('azResFilterType')?.value   || '';
  const env    = document.getElementById('azResFilterEnv')?.value    || '';
  const stat   = document.getElementById('azResFilterStatus')?.value || '';

  filteredAzureRes = allAzureResources.filter(r => {
    const mQ   = !q   || [r.resource_name, r.resource_group, r.owner, r.purpose]
      .some(v => (v||'').toLowerCase().includes(q));
    const mSvc = !svc  || r.service_group === svc;
    const mT   = !type || r.resource_type === type;
    const mE   = !env  || r.environment   === env;
    const mS   = !stat || r.status        === stat;
    return mQ && mSvc && mT && mE && mS;
  });
  renderAzureResTable();
}

function resetAzureResFilter() {
  ['azResSearch','azResFilterService','azResFilterType','azResFilterEnv','azResFilterStatus']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  filteredAzureRes = [...allAzureResources];
  renderAzureResTable();
}

function renderAzureResTable() {
  registerSortableTable('azres', () => filteredAzureRes, (a) => { filteredAzureRes = a; }, renderAzureResTable);
  const tbody = document.getElementById('azResTableBody');
  const count = document.getElementById('azResCount');
  if (count) count.textContent = `전체 ${filteredAzureRes.length}건`;
  if (!tbody) return;
  if (!filteredAzureRes.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-16 text-gray-400">
      <i class="fab fa-microsoft text-4xl block mb-3 opacity-20"></i>등록된 리소스가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredAzureRes.map(r => {
    const statusBadge = getAzResStatusBadge(r.status);
    const envBadge    = getAzEnvBadge(r.environment);
    const costKrw = Number(r.monthly_cost_krw || 0);
    const costUsd = Number(r.monthly_cost     || 0);
    return `
      <tr class="hover:bg-blue-50/30 border-b border-gray-50 transition-colors">
        <td class="px-4 py-2.5">
          <div class="font-medium text-gray-800 text-sm">${r.resource_name || '-'}</div>
          <div class="text-xs text-gray-400">${r.resource_group || ''}</div>
        </td>
        <td class="px-4 py-2.5">${getAzServiceGroupBadge(r.service_group)}</td>
        <td class="px-4 py-2.5"><span class="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md">${r.resource_type || '-'}</span></td>
        <td class="px-4 py-2.5">${envBadge}</td>
        <td class="px-4 py-2.5 text-xs text-gray-500">${r.region || '-'}</td>
        <td class="px-4 py-2.5 text-xs text-gray-500 font-mono">${r.resource_group || '-'}</td>
        <td class="px-4 py-2.5 text-xs text-gray-500">${r.sku || '-'}</td>
        <td class="px-4 py-2.5 text-right text-sm text-gray-600">$${costUsd.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
        <td class="px-4 py-2.5 text-right text-sm font-semibold text-blue-700">${costKrw ? '₩'+costKrw.toLocaleString() : '-'}</td>
        <td class="px-4 py-2.5 text-xs text-gray-600">${r.owner || '-'}</td>
        <td class="px-4 py-2.5 text-center">${statusBadge}</td>
        <td class="px-4 py-2.5 text-center">
          <div class="flex gap-1 justify-center">
            <button onclick="openAzureResModal('${r.id}')" class="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"><i class="fas fa-edit"></i></button>
            <button onclick="deleteAzureResource('${r.id}','${(r.resource_name||'').replace(/'/g,"\\'")}')">
              <span class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 cursor-pointer"><i class="fas fa-trash"></i></span></button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function getAzServiceGroupBadge(sg) {
  const m = {
    'Azure':       '<span class="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-semibold border border-blue-200">\u2601\ufe0f Azure</span>',
    'Claude':      '<span class="text-xs px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full font-semibold border border-orange-200">\ud83e\udd16 Claude</span>',
    'GoWorks':     '<span class="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-semibold border border-green-200">\u2699\ufe0f GoWorks</span>',
    'SendGrid':    '<span class="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-semibold border border-indigo-200">\ud83d\udce7 SendGrid</span>',
    'AzureFabric': '<span class="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full font-semibold border border-purple-200">\ud83d\udd37 Az.Fabric</span>',
    'DataPortal':  '<span class="text-xs px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full font-semibold border border-teal-200">\ud83d\udcca DataPortal</span>',
  };
  return m[sg] || `<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">${sg||'-'}</span>`;
}

function getAzResStatusBadge(s) {
  const m = {
    'Running':      '<span class="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold">Running</span>',
    'Stopped':      '<span class="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-semibold">Stopped</span>',
    'Deallocated':  '<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-semibold">Deallocated</span>',
    'Deleted':      '<span class="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold">Deleted</span>',
    'Provisioning': '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full font-semibold">Provisioning</span>',
  };
  return m[s] || `<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">${s||'-'}</span>`;
}

function getAzEnvBadge(env) {
  const m = {
    'Production': '<span class="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded font-semibold border border-red-200">Prod</span>',
    'Staging':    '<span class="text-xs px-2 py-0.5 bg-orange-50 text-orange-600 rounded font-semibold border border-orange-200">Staging</span>',
    'Development':'<span class="text-xs px-2 py-0.5 bg-green-50 text-green-600 rounded font-semibold border border-green-200">Dev</span>',
    'Test':       '<span class="text-xs px-2 py-0.5 bg-gray-50 text-gray-500 rounded font-semibold border border-gray-200">Test</span>',
  };
  return m[env] || `<span class="text-xs px-2 py-0.5 bg-gray-50 text-gray-400 rounded">${env||'-'}</span>`;
}

// 리소스 모달 열기
function openAzureResModal(id) {
  const isEdit = !!id;
  document.getElementById('azureResModalTitle').innerHTML =
    `<i class="fab fa-microsoft text-blue-500"></i>${isEdit ? 'Azure 리소스 수정' : 'Azure 리소스 등록'}`;
  document.getElementById('azResEditId').value = id || '';

  const fields = ['resource_name','service_group','resource_type','environment','subscription','resource_group',
    'region','sku','status','monthly_cost','monthly_cost_krw','owner','department',
    'created_date','last_reviewed','purpose','tags','note'];

  if (isEdit) {
    const item = allAzureResources.find(r => r.id === id);
    if (!item) return;
    fields.forEach(f => {
      const el = document.getElementById(`azr_${f}`);
      if (el) el.value = item[f] !== undefined ? item[f] : '';
    });
  } else {
    fields.forEach(f => {
      const el = document.getElementById(`azr_${f}`);
      if (el) el.value = '';
    });
    const statusEl = document.getElementById('azr_status');
    if (statusEl) statusEl.value = 'Running';
    const dateEl = document.getElementById('azr_created_date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    const ownerEl = document.getElementById('azr_owner');
    if (ownerEl) ownerEl.value = getAzLoginUser();
  }
  openModal('azureResModal');
}

async function saveAzureResource() {
  if (!AuthManager.hasPermission('azure', 'write')) {
    showToast('입력/수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  const editId = document.getElementById('azResEditId')?.value;
  const payload = {
    resource_name:    document.getElementById('azr_resource_name')?.value?.trim(),
    service_group:    document.getElementById('azr_service_group')?.value,
    resource_type:    document.getElementById('azr_resource_type')?.value,
    environment:      document.getElementById('azr_environment')?.value,
    subscription:     document.getElementById('azr_subscription')?.value?.trim(),
    resource_group:   document.getElementById('azr_resource_group')?.value?.trim(),
    region:           document.getElementById('azr_region')?.value,
    sku:              document.getElementById('azr_sku')?.value?.trim(),
    status:           document.getElementById('azr_status')?.value || 'Running',
    monthly_cost:     Number(document.getElementById('azr_monthly_cost')?.value) || 0,
    monthly_cost_krw: Number(document.getElementById('azr_monthly_cost_krw')?.value) || 0,
    owner:            document.getElementById('azr_owner')?.value?.trim(),
    department:       document.getElementById('azr_department')?.value?.trim(),
    created_date:     document.getElementById('azr_created_date')?.value,
    last_reviewed:    document.getElementById('azr_last_reviewed')?.value,
    purpose:          document.getElementById('azr_purpose')?.value?.trim(),
    tags:             document.getElementById('azr_tags')?.value?.trim(),
    note:             document.getElementById('azr_note')?.value?.trim(),
  };

  if (!payload.resource_name)  { showToast('리소스 이름을 입력해주세요.', 'warning'); return; }
  if (!payload.service_group)  { showToast('서비스 구분을 선택해주세요.', 'warning'); return; }
  if (!payload.resource_type)  { showToast('리소스 타입을 선택해주세요.', 'warning'); return; }

  try {
    if (editId) {
      await azApiFetch(`${AZ_RES_TBL}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('리소스 정보가 수정되었습니다.', 'success');
    } else {
      await azApiFetch(AZ_RES_TBL, { method: 'POST', body: JSON.stringify(payload) });
      showToast(`리소스 '${payload.resource_name}' 등록 완료`, 'success');
    }
    closeModal('azureResModal');
    await renderAzureResources();
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

async function deleteAzureResource(id, name) {
  if (!confirm(`'${name}' 리소스를 삭제하시겠습니까?`)) return;
  try {
    await azApiFetch(`${AZ_RES_TBL}/${id}`, { method: 'DELETE' });
    showToast('리소스가 삭제되었습니다.', 'success');
    await renderAzureResources();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

function exportAzureResExcel() {
  try {
    const rows = filteredAzureRes.map(r => ({
      '리소스명': r.resource_name, '타입': r.resource_type, '환경': r.environment,
      '구독': r.subscription, '리소스그룹': r.resource_group, '리전': r.region,
      'SKU': r.sku, '상태': r.status,
      '월비용USD': r.monthly_cost, '월비용KRW': r.monthly_cost_krw,
      '담당자': r.owner, '담당부서': r.department, '용도': r.purpose,
      '생성일': r.created_date, '검토일': r.last_reviewed,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Azure리소스');
    XLSX.writeFile(wb, `Azure리소스대장_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('Excel 파일 다운로드 완료', 'success');
  } catch (e) {
    showToast('Excel 내보내기 실패: ' + e.message, 'error');
  }
}

// ============================================================
// Azure 라이선스 관리
// ============================================================
async function renderAzureLicenses() {
  try {
    const data = await azApiFetch(`${AZ_LIC_TBL}?limit=1000`);
    allAzureLicenses = data?.data || [];
    renderAzureLicSummary();
    renderAzureLicTable();
    renderAzLicTypeChart();
    renderAzLicExpiringList();
  } catch (e) {
    showToast('라이선스 데이터 로드 실패: ' + e.message, 'error');
  }
}

// USD 단가 입력 시, 계산에 실제로 쓰이는 KRW 단가를 자동으로 채워준다
// (KRW를 비워두면 대시보드/차트 집계에서 0으로 처리되기 때문)
const AZL_APPROX_USD_KRW_RATE = 1400;
function suggestKrwFromUsd() {
  const usdEl = document.getElementById('azl_unit_price_usd');
  const krwEl = document.getElementById('azl_unit_price_krw');
  if (!usdEl || !krwEl) return;
  const usd = Number(usdEl.value) || 0;
  // 이미 KRW 값을 직접 입력해둔 경우엔 덮어쓰지 않는다
  if (usd > 0 && !krwEl.value) {
    krwEl.value = Math.round(usd * AZL_APPROX_USD_KRW_RATE);
  }
}

// 라이선스 1건의 월 비용 계산 (시트기반 + 시트무관 추가사용료를 합산 → 어떤 과금방식이든 대응)
function licenseMonthlyCostKrw(l) {
  const seatCost = (Number(l.unit_price_krw) || 0) * (Number(l.total_seats) || 0);
  const extraCost = Number(l.additional_cost_krw) || 0;
  return seatCost + extraCost;
}

function renderAzureLicSummary() {
  const summary = document.getElementById('azLicSummary');
  if (!summary) return;

  const totalSeats = allAzureLicenses.reduce((s, l) => s + (Number(l.total_seats)||0), 0);
  const usedSeats  = allAzureLicenses.reduce((s, l) => s + (Number(l.used_seats)||0), 0);
  const totalMonthlyCost = allAzureLicenses.reduce((s, l) => s + licenseMonthlyCostKrw(l), 0);
  const expiringSoon = allAzureLicenses.filter(l => {
    if (!l.contract_end) return false;
    const days = Math.ceil((new Date(l.contract_end) - new Date()) / 86400000);
    return days >= 0 && days <= 60;
  }).length;

  summary.innerHTML = `
    <div class="bg-purple-50 border border-purple-100 rounded-xl p-4">
      <div class="text-xs font-semibold text-purple-600 mb-1">총 라이선스 종류</div>
      <div class="text-2xl font-bold text-purple-800">${allAzureLicenses.length}종</div>
    </div>
    <div class="bg-blue-50 border border-blue-100 rounded-xl p-4">
      <div class="text-xs font-semibold text-blue-600 mb-1">총 시트 / 사용 시트</div>
      <div class="text-2xl font-bold text-blue-800">${usedSeats.toLocaleString()} <span class="text-lg text-blue-400">/ ${totalSeats.toLocaleString()}</span></div>
    </div>
    <div class="bg-green-50 border border-green-100 rounded-xl p-4">
      <div class="text-xs font-semibold text-green-600 mb-1">월 총 라이선스 비용</div>
      <div class="text-2xl font-bold text-green-800">₩${totalMonthlyCost.toLocaleString()}</div>
    </div>
    ${expiringSoon > 0 ? `
    <div class="bg-red-50 border border-red-100 rounded-xl p-4 md:col-span-1">
      <div class="text-xs font-semibold text-red-600 mb-1">60일 내 만료 예정</div>
      <div class="text-2xl font-bold text-red-700">${expiringSoon}건 <i class="fas fa-exclamation-triangle text-base"></i></div>
    </div>` : ''}
  `;
}

// AI 서비스(license_type)별 월 비용 분포 도넛차트
function renderAzLicTypeChart() {
  const ctx = document.getElementById('azLicTypeChart');
  if (!ctx) return;
  if (azLicTypeChart) { azLicTypeChart.destroy(); azLicTypeChart = null; }

  const map = {};
  allAzureLicenses.forEach(l => {
    const key = l.license_type || '기타';
    const cost = licenseMonthlyCostKrw(l);
    map[key] = (map[key] || 0) + cost;
  });
  const entries = Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;

  const colors = ['#8b5cf6','#3b82f6','#ec4899','#f59e0b','#10b981','#06b6d4','#ef4444','#84cc16'];
  azLicTypeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{ data: entries.map(e => e[1]), backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: c => `${c.label}: ₩${c.raw.toLocaleString()}` } },
      },
      cutout: '60%',
    },
  });
}

// 60일 이내 계약 만료 예정 라이선스 목록
function renderAzLicExpiringList() {
  const box = document.getElementById('azLicExpiringList');
  if (!box) return;

  const items = allAzureLicenses
    .filter(l => l.contract_end)
    .map(l => ({ ...l, days: Math.ceil((new Date(l.contract_end) - new Date()) / 86400000) }))
    .filter(l => l.days >= 0 && l.days <= 60)
    .sort((a, b) => a.days - b.days);

  if (!items.length) {
    box.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">만료 임박 라이선스가 없습니다.</div>`;
    return;
  }

  box.innerHTML = items.map(l => `
    <div class="flex items-center justify-between px-3 py-2 rounded-lg ${l.days <= 14 ? 'bg-red-50' : 'bg-orange-50'}">
      <div>
        <div class="text-sm font-semibold text-gray-800">${l.license_name || '-'}</div>
        <div class="text-xs text-gray-500">${l.license_type || ''} · 만료 ${l.contract_end}</div>
      </div>
      <span class="text-xs font-bold ${l.days <= 14 ? 'text-red-600' : 'text-orange-600'}">D-${l.days}</span>
    </div>`).join('');
}

function renderAzureLicTable() {
  registerSortableTable('azlic', () => allAzureLicenses, (a) => { allAzureLicenses = a; }, renderAzureLicTable);
  const tbody = document.getElementById('azLicTableBody');
  const count = document.getElementById('azLicCount');
  if (count) count.textContent = `전체 ${allAzureLicenses.length}건`;
  if (!tbody) return;

  if (!allAzureLicenses.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-16 text-gray-400">
      <i class="fas fa-id-card text-4xl block mb-3 opacity-20"></i>등록된 라이선스가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = allAzureLicenses.map(l => {
    const total     = Number(l.total_seats)    || 0;
    const used      = Number(l.used_seats)     || 0;
    const remaining = total - used;
    const usePct    = total > 0 ? Math.round((used / total) * 100) : 0;
    const unitKrw   = Number(l.unit_price_krw) || 0;
    const monthlyKrw = licenseMonthlyCostKrw(l);

    // 만료일 계산
    let expireInfo = '-';
    if (l.contract_end) {
      const days = Math.ceil((new Date(l.contract_end) - new Date()) / 86400000);
      if (days < 0)       expireInfo = `<span class="text-red-600 font-semibold">${l.contract_end} (만료됨)</span>`;
      else if (days <= 30) expireInfo = `<span class="text-red-500 font-semibold">${l.contract_end} (D-${days})</span>`;
      else if (days <= 60) expireInfo = `<span class="text-orange-500 font-semibold">${l.contract_end} (D-${days})</span>`;
      else                 expireInfo = `<span class="text-gray-600">${l.contract_end}</span>`;
    }

    const statusBadge = { '활성': 'bg-green-100 text-green-700', '만료': 'bg-red-100 text-red-600',
      '중단': 'bg-gray-100 text-gray-500', '검토중': 'bg-yellow-100 text-yellow-700' };
    const sbCls = statusBadge[l.status] || 'bg-gray-100 text-gray-500';

    return `
      <tr class="hover:bg-violet-50/30 border-b border-gray-50">
        <td class="px-4 py-2.5">
          <div class="font-medium text-gray-800 text-sm">${l.license_name || '-'}</div>
        </td>
        <td class="px-4 py-2.5">${getAiLicTypeBadge(l.license_type)}</td>
        <td class="px-4 py-2.5 text-xs text-gray-500">${l.plan || '-'}</td>
        <td class="px-4 py-2.5 text-center font-semibold text-gray-700">${total.toLocaleString()}</td>
        <td class="px-4 py-2.5 text-center">
          <div class="font-semibold text-gray-700">${used.toLocaleString()}</div>
          <div class="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div class="bg-violet-500 h-1.5 rounded-full" style="width:${Math.min(usePct,100)}%"></div></div>
          <div class="text-xs text-gray-400">${usePct}%</div>
        </td>
        <td class="px-4 py-2.5 text-center ${remaining < 0 ? 'text-red-600 font-bold' : remaining === 0 ? 'text-orange-500 font-semibold' : 'text-green-600 font-semibold'}">${remaining}</td>
        <td class="px-4 py-2.5 text-right text-xs text-gray-500">${unitKrw ? '₩'+unitKrw.toLocaleString() : '-'}</td>
        <td class="px-4 py-2.5 text-right text-sm font-semibold text-violet-700">${monthlyKrw ? '₩'+monthlyKrw.toLocaleString() : '-'}</td>
        <td class="px-4 py-2.5 text-xs">${expireInfo}</td>
        <td class="px-4 py-2.5 text-xs text-gray-500">${l.owner || '-'}</td>
        <td class="px-4 py-2.5 text-center"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${sbCls}">${l.status || '-'}</span></td>
        <td class="px-4 py-2.5 text-center">
          <div class="flex gap-1 justify-center">
            <button onclick="openAzureLicModal('${l.id}')" class="text-xs px-2 py-1 bg-violet-50 text-violet-600 rounded hover:bg-violet-100"><i class="fas fa-edit"></i></button>
            <button onclick="deleteAzureLicense('${l.id}','${(l.license_name||'').replace(/'/g,"\\'")}')">
              <span class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 cursor-pointer"><i class="fas fa-trash"></i></span></button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function openAzureLicModal(id) {
  const isEdit = !!id;
  document.getElementById('azureLicModalTitle').innerHTML =
    `<i class="fas fa-id-card text-purple-500"></i>${isEdit ? '라이선스 수정' : '라이선스 등록'}`;
  document.getElementById('azLicEditId').value = id || '';

  const fields = ['license_name','license_type','plan','total_seats','used_seats',
    'unit_price_usd','unit_price_krw','additional_cost_krw','billing_cycle','status',
    'contract_start','contract_end','auto_renew','owner','department','note'];

  if (isEdit) {
    const item = allAzureLicenses.find(l => l.id === id);
    if (!item) return;
    fields.forEach(f => {
      const el = document.getElementById(`azl_${f}`);
      if (el) el.value = item[f] !== undefined ? item[f] : '';
    });
  } else {
    fields.forEach(f => {
      const el = document.getElementById(`azl_${f}`);
      if (el) el.value = '';
    });
    const el = document.getElementById('azl_status');
    if (el) el.value = '활성';
    const bc = document.getElementById('azl_billing_cycle');
    if (bc) bc.value = '월간';
    const ar = document.getElementById('azl_auto_renew');
    if (ar) ar.value = 'true';
    const ow = document.getElementById('azl_owner');
    if (ow) ow.value = getAzLoginUser();
  }
  openModal('azureLicModal');
}

async function saveAzureLicense() {
  if (!AuthManager.hasPermission('ai', 'write')) {
    showToast('입력/수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  const editId = document.getElementById('azLicEditId')?.value;
  const payload = {
    license_name:        document.getElementById('azl_license_name')?.value?.trim(),
    license_type:        document.getElementById('azl_license_type')?.value,
    plan:                document.getElementById('azl_plan')?.value?.trim(),
    total_seats:         Number(document.getElementById('azl_total_seats')?.value)         || 0,
    used_seats:          Number(document.getElementById('azl_used_seats')?.value)          || 0,
    unit_price_usd:      Number(document.getElementById('azl_unit_price_usd')?.value)      || 0,
    unit_price_krw:      Number(document.getElementById('azl_unit_price_krw')?.value)      || 0,
    additional_cost_krw: Number(document.getElementById('azl_additional_cost_krw')?.value) || 0,
    billing_cycle:       document.getElementById('azl_billing_cycle')?.value || '월간',
    status:              document.getElementById('azl_status')?.value       || '활성',
    contract_start:      document.getElementById('azl_contract_start')?.value,
    contract_end:        document.getElementById('azl_contract_end')?.value,
    auto_renew:          document.getElementById('azl_auto_renew')?.value === 'true',
    owner:               document.getElementById('azl_owner')?.value?.trim(),
    department:          document.getElementById('azl_department')?.value?.trim(),
    note:                document.getElementById('azl_note')?.value?.trim(),
  };

  if (!payload.license_name) { showToast('제품명을 입력해주세요.', 'warning'); return; }
  // 총 시트 수는 더 이상 필수가 아님 (사용량 기반/정액제 서비스는 시트 개념이 없을 수 있음)
  if (!payload.total_seats && !payload.unit_price_krw && !payload.additional_cost_krw) {
    showToast('시트 단가 또는 추가 사용료 중 최소 하나는 입력해주세요.', 'warning');
    return;
  }

  try {
    if (editId) {
      await azApiFetch(`${AZ_LIC_TBL}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('라이선스 정보가 수정되었습니다.', 'success');
    } else {
      await azApiFetch(AZ_LIC_TBL, { method: 'POST', body: JSON.stringify(payload) });
      showToast(`라이선스 '${payload.license_name}' 등록 완료`, 'success');
    }
    closeModal('azureLicModal');
    await renderAzureLicenses();
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

async function deleteAzureLicense(id, name) {
  if (!confirm(`'${name}' 라이선스를 삭제하시겠습니까?`)) return;
  try {
    await azApiFetch(`${AZ_LIC_TBL}/${id}`, { method: 'DELETE' });
    showToast('라이선스가 삭제되었습니다.', 'success');
    await renderAzureLicenses();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

// ============================================================
// Azure 비용 입력
// ============================================================
async function loadAzureCosts() {
  try {
    const from = document.getElementById('azCostFilterFrom')?.value || '';
    const to   = document.getElementById('azCostFilterTo')?.value   || '';
    const dept = document.getElementById('azCostFilterDept')?.value || '';

    const data = await azApiFetch(`${AZ_COST_TBL}?limit=1000`);
    allAzureCosts = data?.data || [];

    filteredAzureCosts = allAzureCosts.filter(c => {
      const mFrom = !from || (c.period || '') >= from;
      const mTo   = !to   || (c.period || '') <= to;
      const mDept = !dept || c.department === dept;
      return mFrom && mTo && mDept;
    });

    filteredAzureCosts.sort((a, b) => (a.period || '').localeCompare(b.period || ''));
    renderAzureCostTable();
    renderAzureCostPivot();
  } catch (e) {
    showToast('비용 데이터 로드 실패: ' + e.message, 'error');
  }
}

function resetAzureCostFilter() {
  ['azCostFilterFrom', 'azCostFilterTo', 'azCostFilterDept'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadAzureCosts();
}

function renderAzureCostTable() {
  registerSortableTable('azcost', () => filteredAzureCosts, (a) => { filteredAzureCosts = a; }, renderAzureCostTable);
  const tbody = document.getElementById('azCostTableBody');
  if (!tbody) return;

  setEl('azCostCount', `전체 ${filteredAzureCosts.length}건`);

  if (!filteredAzureCosts.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-16 text-gray-400">
      <i class="fas fa-file-invoice-dollar text-4xl block mb-3 opacity-20"></i>비용 데이터가 없습니다.</td></tr>`;
    return;
  }

  const sortState = _tableSortState['azcost'];
  const rows = sortState ? filteredAzureCosts : [...filteredAzureCosts].sort((a, b) => (b.period || '').localeCompare(a.period || ''));

  tbody.innerHTML = rows.map(c => {
    const periodFmt = (c.period || '-').replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}년 ${parseInt(m)}월`);
    return `
      <tr class="hover:bg-blue-50/30 border-b border-gray-50 transition-colors">
        <td class="px-4 py-2.5 text-xs text-gray-600 font-semibold whitespace-nowrap">${periodFmt}</td>
        <td class="px-4 py-2.5 text-sm text-gray-700">${c.department || '-'}</td>
        <td class="px-4 py-2.5 font-medium text-gray-800 text-sm">${c.service_name || '-'}</td>
        <td class="px-4 py-2.5 text-right text-sm font-bold text-blue-700">₩${(Number(c.actual_cost_krw)||0).toLocaleString()}</td>
        <td class="px-4 py-2.5 text-xs text-gray-400">${c.approval_no || '-'}</td>
        <td class="px-4 py-2.5 text-xs text-gray-400 max-w-28 truncate" title="${c.note||''}">${c.note || '-'}</td>
        <td class="px-4 py-2.5 text-center">
          <div class="flex gap-1 justify-center">
            <button onclick="openAzureCostModal('${c.id}')" class="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"><i class="fas fa-edit"></i></button>
            <button onclick="deleteAzureCost('${c.id}','${(c.service_name||'').replace(/'/g,"\\'")}')">
              <span class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 cursor-pointer"><i class="fas fa-trash"></i></span>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ============================================================
// 월별 보고 피벗 (부서 > 서비스(품의서)별 그룹, 원본 엑셀 '매월 보고' 시트와 동일 구조)
// ============================================================
function renderAzureCostPivot() {
  const head = document.getElementById('azCostPivotHead');
  const body = document.getElementById('azCostPivotBody');
  const foot = document.getElementById('azCostPivotFoot');
  if (!head || !body || !foot) return;

  if (!filteredAzureCosts.length) {
    head.innerHTML = '';
    body.innerHTML = `<tr><td class="text-center py-16 text-gray-400">비용 데이터가 없습니다.</td></tr>`;
    foot.innerHTML = '';
    return;
  }

  // 부서별로 등장한 서비스(품의서)를 순서대로 수집
  const deptOrder = [];
  const deptServices = {}; // { 부서: [서비스명, ...] }
  filteredAzureCosts.forEach(c => {
    const dept = c.department || '기타';
    const svc  = c.service_name || '기타';
    if (!deptServices[dept]) { deptServices[dept] = []; deptOrder.push(dept); }
    if (!deptServices[dept].includes(svc)) deptServices[dept].push(svc);
  });

  // 컬럼 목록: [{dept, svc}, ...] 부서 순서 -> 서비스 순서
  const columns = [];
  deptOrder.forEach(dept => deptServices[dept].forEach(svc => columns.push({ dept, svc })));

  // 기간(월) 목록
  const periods = [...new Set(filteredAzureCosts.map(c => c.period).filter(Boolean))].sort();

  // 값 매트릭스: matrix[period][dept|svc] = 합계
  const matrix = {};
  periods.forEach(p => { matrix[p] = {}; columns.forEach(col => matrix[p][`${col.dept}|${col.svc}`] = 0); });
  filteredAzureCosts.forEach(c => {
    const p = c.period; if (!p || !matrix[p]) return;
    const key = `${c.department||'기타'}|${c.service_name||'기타'}`;
    matrix[p][key] = (matrix[p][key] || 0) + (Number(c.actual_cost_krw) || 0);
  });

  // 헤더 렌더 (1행: 부서, colspan / 2행: 서비스명)
  let deptRow = '<tr><th class="px-3 py-2 text-left border-b border-gray-100">기간</th>';
  deptOrder.forEach(dept => {
    deptRow += `<th class="px-3 py-2 text-center border-b border-gray-100 bg-blue-50/60" colspan="${deptServices[dept].length}">${dept}</th>`;
  });
  deptRow += '<th class="px-3 py-2 text-center border-b border-gray-100">월계</th></tr>';

  let svcRow = '<tr><th class="px-3 py-2"></th>';
  columns.forEach(col => { svcRow += `<th class="px-3 py-2 text-right font-normal whitespace-nowrap">${col.svc}</th>`; });
  svcRow += '<th class="px-3 py-2"></th></tr>';

  head.innerHTML = deptRow + svcRow;

  // 바디 렌더
  body.innerHTML = periods.map(p => {
    const periodFmt = p.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}년 ${parseInt(m)}월`);
    let total = 0;
    const cells = columns.map(col => {
      const v = matrix[p][`${col.dept}|${col.svc}`] || 0;
      total += v;
      return `<td class="px-3 py-2 text-right">${v ? '₩'+v.toLocaleString() : '<span class="text-gray-300">-</span>'}</td>`;
    }).join('');
    return `<tr class="border-b border-gray-50 hover:bg-blue-50/20">
      <td class="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">${periodFmt}</td>
      ${cells}
      <td class="px-3 py-2 text-right font-bold text-blue-700">₩${total.toLocaleString()}</td>
    </tr>`;
  }).join('');

  // 당월 - 전월 증감 (마지막 두 기간 비교)
  if (periods.length >= 2) {
    const last = periods[periods.length - 1];
    const prev = periods[periods.length - 2];
    let totalDiff = 0;
    const diffCells = columns.map(col => {
      const key = `${col.dept}|${col.svc}`;
      const diff = (matrix[last][key] || 0) - (matrix[prev][key] || 0);
      totalDiff += diff;
      const cls = diff > 0 ? 'text-red-600' : diff < 0 ? 'text-blue-600' : 'text-gray-400';
      return `<td class="px-3 py-2 text-right ${cls}">${diff ? (diff>0?'+':'') + '₩'+diff.toLocaleString() : '-'}</td>`;
    }).join('');
    foot.innerHTML = `<tr>
      <td class="px-3 py-2">당월 - 전월</td>
      ${diffCells}
      <td class="px-3 py-2 text-right">${totalDiff ? (totalDiff>0?'+':'') + '₩'+totalDiff.toLocaleString() : '-'}</td>
    </tr>`;
  } else {
    foot.innerHTML = '';
  }
}

function openAzureCostModal(id) {
  const isEdit = !!id;
  document.getElementById('azureCostModalTitle').innerHTML =
    `<i class="fas fa-file-invoice-dollar text-blue-500"></i>${isEdit ? '비용 수정' : '비용 등록'}`;
  document.getElementById('azCostEditId').value = id || '';

  const fields = ['period', 'department', 'service_name', 'actual_cost_krw', 'approval_no', 'note'];

  if (isEdit) {
    const item = allAzureCosts.find(c => c.id === id);
    if (!item) return;
    fields.forEach(f => {
      const el = document.getElementById(`azc_${f}`);
      if (el) el.value = item[f] !== undefined && item[f] !== null ? item[f] : '';
    });
  } else {
    fields.forEach(f => {
      const el = document.getElementById(`azc_${f}`);
      if (el) el.value = '';
    });
    const now = new Date();
    const periodEl = document.getElementById('azc_period');
    if (periodEl) periodEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  openModal('azureCostModal');
}

async function saveAzureCost() {
  if (!AuthManager.hasPermission('azure', 'write')) {
    showToast('입력/수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  const editId = document.getElementById('azCostEditId')?.value;
  const payload = {
    period:          document.getElementById('azc_period')?.value,
    department:      document.getElementById('azc_department')?.value,
    service_name:    document.getElementById('azc_service_name')?.value,
    actual_cost_krw: Number(document.getElementById('azc_actual_cost_krw')?.value) || 0,
    approval_no:     document.getElementById('azc_approval_no')?.value?.trim(),
    note:            document.getElementById('azc_note')?.value?.trim(),
  };

  if (!payload.period)       { showToast('기간을 선택해주세요.', 'warning'); return; }
  if (!payload.department)   { showToast('부서를 선택해주세요.', 'warning'); return; }
  if (!payload.service_name) { showToast('서비스(품의서)를 선택해주세요.', 'warning'); return; }

  try {
    if (editId) {
      await azApiFetch(`${AZ_COST_TBL}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('비용 정보가 수정되었습니다.', 'success');
    } else {
      await azApiFetch(AZ_COST_TBL, { method: 'POST', body: JSON.stringify(payload) });
      showToast('비용 데이터가 등록되었습니다.', 'success');
    }
    closeModal('azureCostModal');
    await loadAzureCosts();
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

async function deleteAzureCost(id, name) {
  if (!confirm(`'${name}' 비용 데이터를 삭제하시겠습니까?`)) return;
  try {
    await azApiFetch(`${AZ_COST_TBL}/${id}`, { method: 'DELETE' });
    showToast('삭제되었습니다.', 'success');
    await loadAzureCosts();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 월별 비용대장 – Excel 내보내기 (개별 항목 목록)
// ============================================================
function exportAzureCostExcel() {
  if (!filteredAzureCosts.length) {
    showToast('내보낼 데이터가 없습니다.', 'warning');
    return;
  }

  const headers = ['기간', '부서', '서비스(품의서)', '금액(원)', '승인번호', '비고'];
  const rows = filteredAzureCosts.map(c => {
    const period = (c.period || '').replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}년 ${parseInt(m)}월`);
    return [period, c.department || '-', c.service_name || '-', Number(c.actual_cost_krw) || 0, c.approval_no || '-', c.note || ''];
  });
  const sumKrw = rows.reduce((s, r) => s + r[3], 0);
  rows.push(['합계', '', '', sumKrw, '', '']);

  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '비용목록');
    XLSX.writeFile(wb, `Azure비용목록_${Date.now()}.xlsx`);
    showToast('Excel 파일이 다운로드되었습니다.', 'success');
  } else {
    showToast('Excel 내보내기를 사용할 수 없습니다.', 'error');
  }
}

// ============================================================
// 월별 보고 피벗 – Excel 내보내기 (부사장 보고용, 원본 엑셀과 동일 레이아웃)
// ============================================================
function exportAzureCostPivotExcel() {
  if (!filteredAzureCosts.length) {
    showToast('내보낼 데이터가 없습니다.', 'warning');
    return;
  }

  const deptOrder = [];
  const deptServices = {};
  filteredAzureCosts.forEach(c => {
    const dept = c.department || '기타';
    const svc  = c.service_name || '기타';
    if (!deptServices[dept]) { deptServices[dept] = []; deptOrder.push(dept); }
    if (!deptServices[dept].includes(svc)) deptServices[dept].push(svc);
  });
  const columns = [];
  deptOrder.forEach(dept => deptServices[dept].forEach(svc => columns.push({ dept, svc })));
  const periods = [...new Set(filteredAzureCosts.map(c => c.period).filter(Boolean))].sort();

  const matrix = {};
  periods.forEach(p => { matrix[p] = {}; columns.forEach(col => matrix[p][`${col.dept}|${col.svc}`] = 0); });
  filteredAzureCosts.forEach(c => {
    const p = c.period; if (!p || !matrix[p]) return;
    const key = `${c.department||'기타'}|${c.service_name||'기타'}`;
    matrix[p][key] = (matrix[p][key] || 0) + (Number(c.actual_cost_krw) || 0);
  });

  const headerRow1 = ['부서'].concat(deptOrder.flatMap(d => Array(deptServices[d].length).fill(d))).concat(['']);
  const headerRow2 = ['기간'].concat(columns.map(c => c.svc)).concat(['월계']);
  const dataRows = periods.map(p => {
    const periodFmt = p.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}년 ${parseInt(m)}월`);
    const vals = columns.map(col => matrix[p][`${col.dept}|${col.svc}`] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    return [periodFmt, ...vals, total];
  });

  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.aoa_to_sheet([headerRow1, headerRow2, ...dataRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '월별 보고');
    XLSX.writeFile(wb, `Azure월별비용보고_${Date.now()}.xlsx`);
    showToast('Excel 파일이 다운로드되었습니다.', 'success');
  } else {
    showToast('Excel 내보내기를 사용할 수 없습니다.', 'error');
  }
}

// ============================================================
// 관리자 콘솔 – 계정 관리
// ============================================================
async function loadAdminUsers() {
  if (!AuthManager.isAdmin()) {
    showToast('관리자 권한이 필요합니다.', 'error');
    return;
  }
  const tbody = document.getElementById('adminUsersTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400">로딩 중...</td></tr>`;

  try {
    const rows = await callUsersRpc('admin_list_users', {});
    const users = (rows || []).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));

    if (!tbody) return;
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-400">사용자가 없습니다.</td></tr>`;
      return;
    }

    const roleBadge = {
      'admin': '<span class="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full font-bold border border-yellow-300">🛡 admin</span>',
      '팀장':  '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold">팀장</span>',
      '파트장':'<span class="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-semibold">파트장</span>',
      '팀원':  '<span class="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold">팀원</span>',
    };

    tbody.innerHTML = users.map(u => {
      const isActive = u.active !== false;
      const activeBadge = isActive
        ? '<span class="text-xs px-2 py-0.5 bg-green-100 text-green-600 rounded-full font-semibold">활성</span>'
        : '<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-semibold">비활성</span>';
      const rb = roleBadge[u.role] || `<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">${u.role||'-'}</span>`;
      const joinDate = u.created_at ? new Date(Number(u.created_at)).toLocaleDateString('ko-KR') : '-';
      const currentUser = AuthManager.getCurrentUser();
      const isSelf = currentUser?.id === u.id;

      return `
        <tr class="hover:bg-yellow-50/30 border-b border-gray-50 ${!isActive ? 'opacity-60' : ''}">
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 ${u.role==='admin' ? 'bg-yellow-400' : 'bg-blue-500'} rounded-full flex items-center justify-center flex-shrink-0">
                <i class="fas ${u.role==='admin' ? 'fa-user-shield' : 'fa-user'} text-white text-xs"></i>
              </div>
              <span class="font-medium text-gray-800 text-sm">${u.full_name || '-'}${isSelf ? ' <span class="text-xs text-blue-400">(나)</span>' : ''}</span>
            </div>
          </td>
          <td class="px-4 py-3 text-xs text-gray-500">${u.email || u.username || '-'}</td>
          <td class="px-4 py-3 text-center">${rb}</td>
          <td class="px-4 py-3 text-xs text-gray-500">${u.department || '-'}</td>
          <td class="px-4 py-3 text-center">${activeBadge}</td>
          <td class="px-4 py-3 text-xs text-gray-400">${joinDate}</td>
          <td class="px-4 py-3 text-center">
            <div class="flex gap-1.5 justify-center">
              <button onclick="openAdminUserModal('${u.id}')" class="text-xs px-3 py-1 bg-yellow-50 text-yellow-700 rounded-lg hover:bg-yellow-100 border border-yellow-200">
                <i class="fas fa-edit mr-1"></i>수정
              </button>
              ${!isSelf ? `<button onclick="deleteAdminUser('${u.id}','${(u.full_name||'').replace(/'/g,"\\'")}')"
                class="text-xs px-2.5 py-1 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 border border-red-200">
                <i class="fas fa-trash"></i>
              </button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    showToast('사용자 목록 로드 실패: ' + e.message, 'error');
  }
}

// 기본 permissions 구조 반환
function defaultPermissions() {
  return { assets:{view:true,write:false}, sub:{view:true,write:false}, promo:{view:true,write:false}, azure:{view:false,write:false}, ai:{view:false,write:false} };
}

// permissions 객체를 토글 UI에 반영 (prefix: '' = 수정모달, 'n' = 신규모달)
function applyPermToggles(perms, prefix) {
  const p = (perms && typeof perms === 'object') ? perms : defaultPermissions();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  set(`${prefix}perm_assets_view`,  p.assets?.view);
  set(`${prefix}perm_assets_write`, p.assets?.write);
  set(`${prefix}perm_sub_view`,     p.sub?.view);
  set(`${prefix}perm_sub_write`,    p.sub?.write);
  set(`${prefix}perm_promo_view`,   p.promo?.view);
  set(`${prefix}perm_promo_write`,  p.promo?.write);
  set(`${prefix}perm_azure_view`,   p.azure?.view);
  set(`${prefix}perm_azure_write`,  p.azure?.write);
  set(`${prefix}perm_ai_view`,      p.ai?.view);
  set(`${prefix}perm_ai_write`,     p.ai?.write);
}

// 토글 UI에서 permissions 객체 수집 (prefix: '' = 수정모달, 'n' = 신규모달)
function collectPermFromToggles(prefix) {
  const get = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  return {
    assets: { view: get(`${prefix}perm_assets_view`),  write: get(`${prefix}perm_assets_write`) },
    sub:    { view: get(`${prefix}perm_sub_view`),     write: get(`${prefix}perm_sub_write`) },
    promo:  { view: get(`${prefix}perm_promo_view`),   write: get(`${prefix}perm_promo_write`) },
    azure:  { view: get(`${prefix}perm_azure_view`),   write: get(`${prefix}perm_azure_write`) },
    ai:     { view: get(`${prefix}perm_ai_view`),      write: get(`${prefix}perm_ai_write`) },
  };
}

function openAdminUserModal(userId) {
  callUsersRpc('admin_get_user', { p_id: userId }).then(rows => {
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u) { showToast('사용자 정보를 찾을 수 없습니다.', 'error'); return; }
    document.getElementById('adminEditUserId').value = userId;
    document.getElementById('adm_full_name').value   = u.full_name || '';
    document.getElementById('adm_email').value       = u.email || u.username || '';
    document.getElementById('adm_role').value        = u.role || '팀원';
    document.getElementById('adm_department').value  = u.department || '';
    document.getElementById('adm_active').value      = u.active !== false ? 'true' : 'false';

    // permissions 토글 반영 (admin 이면 전체 ON)
    let perms;
    if (u.role === 'admin') {
      perms = { assets:{view:true,write:true}, sub:{view:true,write:true}, promo:{view:true,write:true}, azure:{view:true,write:true}, ai:{view:true,write:true} };
    } else {
      try { perms = u.permissions ? JSON.parse(u.permissions) : null; } catch { perms = null; }
    }
    applyPermToggles(perms, '');
    openModal('adminUserModal');
  }).catch(e => showToast('사용자 정보 로드 실패: ' + e.message, 'error'));
}

async function saveAdminUser() {
  const userId = document.getElementById('adminEditUserId')?.value;
  if (!userId) return;

  const role = document.getElementById('adm_role')?.value;

  // admin 역할이면 전체 권한, 그 외엔 토글에서 수집
  let perms;
  if (role === 'admin') {
    perms = { assets:{view:true,write:true}, sub:{view:true,write:true}, promo:{view:true,write:true}, azure:{view:true,write:true}, ai:{view:true,write:true} };
  } else {
    perms = collectPermFromToggles('');
  }

  const payload = {
    p_id:          userId,
    p_role:        role,
    p_department:  document.getElementById('adm_department')?.value?.trim(),
    p_active:      document.getElementById('adm_active')?.value === 'true',
    p_permissions: JSON.stringify(perms),
  };

  try {
    await callUsersRpc('admin_update_user', payload);
    showToast('계정 정보가 수정되었습니다.', 'success');
    closeModal('adminUserModal');
    await loadAdminUsers();
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

// users 테이블 관련 관리자 전용 RPC 호출 공통 헬퍼
// (비밀번호는 절대 건드리지 않는 안전한 함수들만 호출한다)
async function callUsersRpc(fnName, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`서버 오류 ${res.status}: ${errText}`);
  }
  try { return await res.json(); } catch { return null; }
}

async function deleteAdminUser(userId, name) {
  if (!userId) return;
  const currentUser = AuthManager.getCurrentUser();
  if (currentUser?.id === userId) {
    showToast('자기 자신은 삭제할 수 없습니다.', 'warning');
    return;
  }
  if (!confirm(`'${name}' 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    await callUsersRpc('admin_delete_user', { p_id: userId });
    showToast(`'${name}' 계정이 삭제되었습니다.`, 'success');
    closeModal('adminUserModal');
    await loadAdminUsers();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

function openCreateUserModal() {
  // 폼 초기화
  ['new_full_name','new_email','new_username','new_password','new_department'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const roleEl = document.getElementById('new_role');
  if (roleEl) roleEl.value = '팀원';
  // 권한 토글 기본값 (열람만 ON)
  applyPermToggles(defaultPermissions(), 'n');
  openModal('createUserModal');
}

async function saveNewUser() {
  const full_name  = document.getElementById('new_full_name')?.value?.trim();
  const email      = document.getElementById('new_email')?.value?.trim();
  const username   = document.getElementById('new_username')?.value?.trim() || email;
  const password   = document.getElementById('new_password')?.value;
  const role       = document.getElementById('new_role')?.value || '팀원';
  const department = document.getElementById('new_department')?.value?.trim();

  if (!full_name) { showToast('이름을 입력해주세요.', 'warning'); return; }
  if (!email)     { showToast('이메일을 입력해주세요.', 'warning'); return; }
  if (!password)  { showToast('초기 비밀번호를 입력해주세요.', 'warning'); return; }

  let perms;
  if (role === 'admin') {
    perms = { assets:{view:true,write:true}, sub:{view:true,write:true}, promo:{view:true,write:true}, azure:{view:true,write:true}, ai:{view:true,write:true} };
  } else {
    perms = collectPermFromToggles('n');
  }

  const payload = {
    p_full_name:   full_name,
    p_email:       email,
    p_username:    username,
    p_password:    password,
    p_role:        role,
    p_department:  department,
    p_permissions: JSON.stringify(perms),
  };

  try {
    await callUsersRpc('admin_create_user', payload);
    showToast(`'${full_name}' 계정이 추가되었습니다.`, 'success');
    closeModal('createUserModal');
    await loadAdminUsers();
  } catch (e) {
    showToast('계정 추가 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 관리자 콘솔 – 세션 정보
// ============================================================
function renderAdminLogs() {
  const container = document.getElementById('adminLogsContent');
  if (!container) return;

  const user = AuthManager.getCurrentUser();
  if (!user) return;

  const loginAt = user.loginAt ? new Date(user.loginAt).toLocaleString('ko-KR') : '-';
  const sessionAge = user.loginAt
    ? Math.floor((Date.now() - user.loginAt) / 60000) + '분 전'
    : '-';

  container.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="bg-yellow-50 border border-yellow-100 rounded-xl p-4 space-y-2">
        <h4 class="text-xs font-bold text-yellow-700 uppercase tracking-wide">현재 로그인 세션</h4>
        <div class="flex justify-between text-sm"><span class="text-gray-500">이름</span><span class="font-semibold">${user.full_name || '-'}</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">이메일</span><span class="font-semibold text-blue-600">${user.email || '-'}</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">역할</span><span class="font-semibold text-yellow-700">🛡 ${user.role}</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">부서</span><span class="font-semibold">${user.department || '-'}</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">로그인 시각</span><span class="font-semibold">${loginAt}</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">세션 경과</span><span class="font-semibold text-green-600">${sessionAge}</span></div>
      </div>
      <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
        <h4 class="text-xs font-bold text-blue-700 uppercase tracking-wide">시스템 정보</h4>
        <div class="flex justify-between text-sm"><span class="text-gray-500">시스템명</span><span class="font-semibold">IT 통합 자산관리</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">버전</span><span class="font-semibold">v2.2</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">브라우저</span><span class="font-semibold text-xs max-w-48 truncate">${navigator.userAgent.split(' ').pop()}</span></div>
        <div class="flex justify-between text-sm"><span class="text-gray-500">현재 시각</span><span id="adminCurrentTime" class="font-semibold">${new Date().toLocaleString('ko-KR')}</span></div>
      </div>
    </div>
    <div class="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
      <p class="text-xs text-gray-500 flex items-center gap-2">
        <i class="fas fa-info-circle text-blue-400"></i>
        접속 로그는 현재 브라우저 세션을 기반으로 표시됩니다. 영구 로그 저장은 별도 백엔드 연동이 필요합니다.
      </p>
    </div>`;

  // 실시간 시계
  setInterval(() => {
    const timeEl = document.getElementById('adminCurrentTime');
    if (timeEl) timeEl.textContent = new Date().toLocaleString('ko-KR');
  }, 1000);
}

// ============================================================
// 유틸
// ============================================================
function getAzLoginUser() {
  const u = AuthManager.getCurrentUser();
  return u?.full_name || u?.email || 'IT관리자';
}

// ============================================================
// AI 라이선스 타입 뱃지
// ============================================================
function getAiLicTypeBadge(t) {
  const m = {
    'ChatGPT':      '<span class="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-semibold border border-green-200">ChatGPT</span>',
    'Claude':       '<span class="text-xs px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full font-semibold border border-orange-200">Claude</span>',
    'GithubCopilot':'<span class="text-xs px-2 py-0.5 bg-gray-800 text-white rounded-full font-semibold">GitHub Copilot</span>',
    'M365Copilot':  '<span class="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-semibold border border-blue-200">M365 Copilot</span>',
    'AzureOpenAI':  '<span class="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-semibold border border-indigo-200">Azure OpenAI</span>',
    'Gemini':       '<span class="text-xs px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full font-semibold border border-yellow-200">Gemini</span>',
  };
  return m[t] || `<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">${t||'-'}</span>`;
}

// ============================================================
// 카테고리 관리 (관리자 콘솔)
// ============================================================
const CAT_TBL = 'categories';
let allCategories = [];
let currentCatGroup = 'assets';

const CAT_GROUP_LABELS = {
  assets:              '고정자산 분류',
  sub:                 'IT정기결제 카테고리',
  promo:               '판촉물 품목 분류',
  azure:               'Azure 서비스 구분',
  azure_restype:       'Azure 리소스 타입',
  azure_cost_dept:     'Azure 비용 - 부서',
  azure_cost_service:  'Azure 비용 - 서비스(품의서)',
  ai_license:          'AI 라이선스 서비스',
};

// 각 메뉴별 "설정" 페이지에서 노출할 카테고리 탭 목록
const SETTINGS_PAGE_GROUPS = {
  'assets-settings': ['assets'],
  'sub-settings':    ['sub'],
  'promo-settings':  ['promo'],
  'azure-settings':  ['azure', 'azure_restype', 'azure_cost_dept', 'azure_cost_service'],
  'ai-settings':     ['ai_license'],
};

const SETTINGS_PAGE_TITLES = {
  'assets-settings': '고정자산 관리 설정',
  'sub-settings':    'IT정기결제 설정',
  'promo-settings':  '판촉물 관리 설정',
  'azure-settings':  'Azure 관리 설정',
  'ai-settings':     'AI 라이선스 설정',
};

// settings 페이지 진입 시, 관련 있는 카테고리 탭만 보여주고 나머지는 숨긴다
function openCategorySettings(pageKey) {
  const groups = SETTINGS_PAGE_GROUPS[pageKey] || Object.keys(CAT_GROUP_LABELS);
  document.querySelectorAll('.cat-tab').forEach(btn => {
    const group = btn.id.replace('catTab-', '');
    btn.classList.toggle('hidden', !groups.includes(group));
  });
  const titleEl = document.getElementById('catPageTitle');
  if (titleEl) titleEl.textContent = SETTINGS_PAGE_TITLES[pageKey] || '메뉴 설정';
  currentCatGroup = groups[0];
  switchCatTab(groups[0]);
}

async function loadCategoryPage() {
  currentCatGroup = 'assets';
  switchCatTab('assets');
  await loadCategoriesByGroup('assets');
}

function switchCatTab(group) {
  currentCatGroup = group;
  // 탭 스타일 교체
  document.querySelectorAll('.cat-tab').forEach(btn => {
    btn.classList.remove('active-cat-tab');
  });
  const activeBtn = document.getElementById(`catTab-${group}`);
  if (activeBtn) activeBtn.classList.add('active-cat-tab');
  // 헤더 라벨
  const label = document.getElementById('catGroupLabel');
  if (label) label.textContent = CAT_GROUP_LABELS[group] || group;
  // 데이터 로드
  loadCategoriesByGroup(group);
}

async function loadCategoriesByGroup(group) {
  const tbody = document.getElementById('catTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-400">로딩 중...</td></tr>`;

  try {
    const data = await azApiFetch(`${CAT_TBL}?limit=500`);
    allCategories = (data?.data || []).filter(c => c.menu_group === group)
      .sort((a, b) => (Number(a.sort_order)||99) - (Number(b.sort_order)||99));

    renderCatTable();
  } catch (e) {
    showToast('카테고리 로드 실패: ' + e.message, 'error');
  }
}

function renderCatTable() {
  const tbody = document.getElementById('catTableBody');
  if (!tbody) return;

  if (!allCategories.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">
      <i class="fas fa-tags text-3xl block mb-2 opacity-20"></i>등록된 항목이 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = allCategories.map(c => {
    const activeBadge = c.active !== false
      ? '<span class="text-xs px-2 py-0.5 bg-green-100 text-green-600 rounded-full font-semibold">활성</span>'
      : '<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-400 rounded-full font-semibold">비활성</span>';
    return `
      <tr class="hover:bg-amber-50/30 border-b border-gray-50 ${c.active === false ? 'opacity-50' : ''}">
        <td class="px-4 py-2.5 text-center text-xs text-gray-400 font-mono">${c.sort_order || '-'}</td>
        <td class="px-4 py-2.5 font-medium text-gray-800 text-sm">${c.name || '-'}</td>
        <td class="px-4 py-2.5 text-xs text-gray-500 font-mono">${c.value || '-'}</td>
        <td class="px-4 py-2.5 text-xs text-gray-400">${c.note || '-'}</td>
        <td class="px-4 py-2.5 text-center">${activeBadge}</td>
        <td class="px-4 py-2.5 text-center">
          <div class="flex gap-1.5 justify-center">
            <button onclick="openCatModal('${c.id}')" class="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 border border-amber-200"><i class="fas fa-edit"></i></button>
            <button onclick="deleteCategoryItem('${c.id}','${(c.name||'').replace(/'/g,"\\'")}')">
              <span class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 cursor-pointer border border-red-200"><i class="fas fa-trash"></i></span>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function openCatModal(id) {
  const isEdit = !!id;
  document.getElementById('catModalTitle').innerHTML =
    `<i class="fas fa-tag text-amber-500"></i>${isEdit ? '항목 수정' : '항목 추가'}`;
  document.getElementById('catEditId').value  = id || '';
  document.getElementById('catEditGroup').value = currentCatGroup;

  if (isEdit) {
    const item = allCategories.find(c => c.id === id);
    if (!item) return;
    document.getElementById('cat_name').value   = item.name   || '';
    document.getElementById('cat_value').value  = item.value  || '';
    document.getElementById('cat_sort').value   = item.sort_order || '';
    document.getElementById('cat_note').value   = item.note   || '';
    const activeEl = document.getElementById('cat_active');
    if (activeEl) activeEl.checked = item.active !== false;
  } else {
    // 신규: 마지막 sort_order + 1
    const maxSort = allCategories.reduce((m, c) => Math.max(m, Number(c.sort_order)||0), 0);
    document.getElementById('cat_name').value  = '';
    document.getElementById('cat_value').value = '';
    document.getElementById('cat_sort').value  = maxSort + 1;
    document.getElementById('cat_note').value  = '';
    const activeEl = document.getElementById('cat_active');
    if (activeEl) activeEl.checked = true;
  }
  openModal('catModal');
}

async function saveCategoryItem() {
  const editId = document.getElementById('catEditId')?.value;
  const group  = document.getElementById('catEditGroup')?.value || currentCatGroup;
  const name   = document.getElementById('cat_name')?.value?.trim();
  const value  = document.getElementById('cat_value')?.value?.trim();
  const sort   = Number(document.getElementById('cat_sort')?.value) || 1;
  const note   = document.getElementById('cat_note')?.value?.trim();
  const active = document.getElementById('cat_active')?.checked !== false;

  if (!name)  { showToast('표시명을 입력해주세요.', 'warning'); return; }
  if (!value) { showToast('값(value)을 입력해주세요.', 'warning'); return; }

  const payload = { menu_group: group, name, value, sort_order: sort, note, active };

  try {
    if (editId) {
      await azApiFetch(`${CAT_TBL}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('항목이 수정되었습니다.', 'success');
    } else {
      await azApiFetch(CAT_TBL, { method: 'POST', body: JSON.stringify(payload) });
      showToast(`'${name}' 항목이 추가되었습니다.`, 'success');
    }
    closeModal('catModal');
    await loadCategoriesByGroup(group);
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

async function deleteCategoryItem(id, name) {
  if (!confirm(`'${name}' 항목을 삭제하시겠습니까?`)) return;
  try {
    await azApiFetch(`${CAT_TBL}/${id}`, { method: 'DELETE' });
    showToast(`'${name}' 항목이 삭제되었습니다.`, 'success');
    await loadCategoriesByGroup(currentCatGroup);
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}
