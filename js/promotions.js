/* ===================================================
   promotions.js  –  판촉물 입/출고 관리
   =================================================== */
'use strict';

const PROMO_TABLE  = 'promo_items';
const PROMO_TX_TBL = 'promo_transactions';

let allPromoItems = [];
let filteredPromoItems = [];
let promoCategoryChartInstance = null;

// ============================================================
// 초기화 헬퍼 (supabase.js의 promoApiFetch 사용)
// ============================================================

// ============================================================
// 판촉물 품목 전체 로드
// ============================================================
async function loadAllPromoItems() {
  try {
    const data = await promoApiFetch(`${PROMO_TABLE}?limit=1000`);
    allPromoItems = data.data || [];
    filteredPromoItems = [...allPromoItems];
    return allPromoItems;
  } catch (e) {
    showToast('판촉물 데이터 로드 실패: ' + e.message, 'error');
    return [];
  }
}

// ============================================================
// 재고 현황 페이지
// ============================================================
async function renderPromoStock() {
  await loadAllPromoItems();
  applyPromoFilter();
  populatePromoSelects();
}

function applyPromoFilter() {
  const q    = (document.getElementById('promoSearchInput')?.value || '').toLowerCase();
  const cat  = document.getElementById('promoFilterCategory')?.value || '';
  const stat = document.getElementById('promoFilterStatus')?.value || '';

  filteredPromoItems = allPromoItems.filter(p => {
    const matchQ = !q || [p.promo_code, p.promo_name, p.manager, p.department]
      .some(v => (v || '').toLowerCase().includes(q));
    const matchCat  = !cat  || p.category === cat;
    const matchStat = !stat || p.status === stat;
    return matchQ && matchCat && matchStat;
  });

  renderPromoStockTable();
}

function resetPromoFilter() {
  const qEl  = document.getElementById('promoSearchInput');
  const cEl  = document.getElementById('promoFilterCategory');
  const sEl  = document.getElementById('promoFilterStatus');
  if (qEl) qEl.value = '';
  if (cEl) cEl.value = '';
  if (sEl) sEl.value = '';
  filteredPromoItems = [...allPromoItems];
  renderPromoStockTable();
}

function renderPromoStockTable() {
  registerSortableTable('promo', () => filteredPromoItems, (a) => { filteredPromoItems = a; }, renderPromoStockTable);
  const tbody = document.getElementById('promoStockTableBody');
  if (!tbody) return;

  const count = document.getElementById('promoStockCount');
  if (count) count.textContent = `전체 ${filteredPromoItems.length}건`;

  if (!filteredPromoItems.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-16 text-gray-400">
      <i class="fas fa-gift text-4xl block mb-3 opacity-20"></i>
      등록된 판촉물이 없습니다.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filteredPromoItems.map(p => {
    const stock     = Number(p.current_stock) || 0;
    const minStock  = Number(p.stock_min) || 0;
    const isLow     = stock <= minStock && minStock > 0;
    const isEmpty   = stock === 0;
    const stockCls  = isEmpty  ? 'text-red-600 font-bold' :
                      isLow    ? 'text-orange-600 font-semibold' :
                                 'text-green-700 font-semibold';
    const statusBadge = getPromoStatusBadge(p.status, stock, minStock);

    return `
      <tr class="hover:bg-orange-50/30 transition-colors">
        <td class="px-4 py-2 font-mono text-xs text-blue-700 whitespace-nowrap">${p.promo_code || '-'}</td>
        <td class="px-4 py-2 font-medium text-gray-800">${p.promo_name || '-'}</td>
        <td class="px-4 py-2">
          <span class="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-md font-medium">${p.category || '-'}</span>
        </td>
        <td class="px-4 py-2 text-xs text-gray-500">${p.spec || '-'}</td>
        <td class="px-4 py-2 text-right text-xs text-gray-500">${Number(p.total_in || 0).toLocaleString()}</td>
        <td class="px-4 py-2 text-right text-xs text-gray-500">${Number(p.total_out || 0).toLocaleString()}</td>
        <td class="px-4 py-2 text-right ${stockCls}">${stock.toLocaleString()}</td>
        <td class="px-4 py-2 text-right text-xs text-gray-400">${minStock.toLocaleString()}</td>
        <td class="px-4 py-2 text-right text-xs text-gray-500">${p.unit_price ? Number(p.unit_price).toLocaleString() + '원' : '-'}</td>
        <td class="px-4 py-2 text-xs text-gray-500">${p.manager || '-'}</td>
        <td class="px-4 py-2">${statusBadge}</td>
        <td class="px-4 py-2 text-center">
          <div class="flex gap-1 justify-center">
            <button onclick="openPromoEditModal('${p.id}')" class="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100" title="수정"><i class="fas fa-edit"></i></button>
            <button onclick="quickPromoIn('${p.id}')" class="text-xs px-2 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100" title="입고"><i class="fas fa-arrow-down"></i></button>
            <button onclick="quickPromoOut('${p.id}')" class="text-xs px-2 py-1 bg-orange-50 text-orange-600 rounded hover:bg-orange-100" title="출고"><i class="fas fa-arrow-up"></i></button>
            <button onclick="deletePromoItem('${p.id}','${(p.promo_name||'').replace(/'/g,"\\'")}','${stock}')" class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100" title="삭제"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function getPromoStatusBadge(status, stock, minStock) {
  if (stock === 0) return '<span class="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-semibold">재고없음</span>';
  if (stock <= minStock && minStock > 0) return '<span class="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full font-semibold">재고부족</span>';
  const map = {
    '정상': '<span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-semibold">정상</span>',
    '재고부족': '<span class="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full font-semibold">재고부족</span>',
    '중단': '<span class="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full font-semibold">중단</span>',
  };
  return map[status] || '<span class="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded-full">' + (status||'-') + '</span>';
}

// ============================================================
// 판촉물 품목 신규 등록 + 입고 (입고 처리 페이지 인라인 폼)
// ============================================================
async function savePromoItem() {
  if (!AuthManager.hasPermission('promo', 'write')) {
    showToast('입력/수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return;
  }
  const editId = document.getElementById('editPromoId')?.value;

  const payload = {
    promo_code:  document.getElementById('pf_promo_code')?.value?.trim(),
    promo_name:  document.getElementById('pf_promo_name')?.value?.trim(),
    category:    document.getElementById('pf_category')?.value,
    spec:        document.getElementById('pf_spec')?.value?.trim(),
    unit_price:  Number(document.getElementById('pf_unit_price')?.value) || 0,
    stock_min:   Number(document.getElementById('pf_stock_min')?.value) || 10,
    location:    document.getElementById('pf_location')?.value?.trim(),
    department:  document.getElementById('pf_department')?.value?.trim(),
    manager:     document.getElementById('pf_manager')?.value?.trim(),
    status:      '정상',
    note:        document.getElementById('pf_note')?.value?.trim(),
  };

  if (!payload.promo_code) { showToast('품목 코드를 입력해주세요.', 'warning'); return; }
  if (!payload.promo_name) { showToast('판촉물명을 입력해주세요.', 'warning'); return; }
  if (!payload.category)   { showToast('분류를 선택해주세요.', 'warning'); return; }

  try {
    if (editId) {
      // 수정 시 재고 관련 필드는 유지
      const exist = allPromoItems.find(p => p.id === editId);
      if (exist) {
        payload.current_stock = exist.current_stock;
        payload.total_in      = exist.total_in;
        payload.total_out     = exist.total_out;
      }
      await promoApiFetch(`${PROMO_TABLE}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('판촉물 정보가 수정되었습니다.', 'success');
    } else {
      // 신규 등록: 코드 중복 체크
      if (allPromoItems.some(p => p.promo_code === payload.promo_code)) {
        showToast('이미 존재하는 품목 코드입니다.', 'error');
        return;
      }
      const initStock = Number(document.getElementById('pf_init_stock')?.value) || 0;
      const inDate    = document.getElementById('pf_in_date')?.value || new Date().toISOString().split('T')[0];
      const supplier  = document.getElementById('pf_supplier')?.value?.trim() || '';
      payload.current_stock = initStock;
      payload.total_in      = initStock;
      payload.total_out     = 0;
      const created = await promoApiFetch(PROMO_TABLE, { method: 'POST', body: JSON.stringify(payload) });

      // 입고 이력 등록 (수량 > 0인 경우)
      if (initStock > 0) {
        await addPromoTransaction({
          item_id:      created.id,
          promo_code:   payload.promo_code,
          promo_name:   payload.promo_name,
          tx_type:      '입고',
          quantity:     initStock,
          before_stock: 0,
          after_stock:  initStock,
          target:       supplier || '신규 등록',
          purpose:      '신규 품목 등록 입고',
          handler:      payload.manager || getLoginUserName(),
          tx_date:      inDate,
          note:         payload.note || '',
        });
      }
      showToast(`판촉물 '${payload.promo_name}' 등록 완료 (입고 ${initStock.toLocaleString()}개)`, 'success');
    }

    resetPromoItemForm();
    await loadAllPromoItems();
    renderPromoStockTable();
    populatePromoInItemList();
    // 등록 완료 후 기존 품목 입고 탭으로 전환
    switchPromoInTab('existing');
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

function openPromoEditModal(id) {
  // 수정은 입고 처리 페이지의 신규 탭 폼을 재활용
  const item = allPromoItems.find(p => p.id === id);
  if (!item) return;

  navigateTo('promo-in');
  setTimeout(() => {
    switchPromoInTab('new');

    document.getElementById('editPromoId').value = id;

    const fields = ['promo_code','promo_name','category','spec','unit_price','stock_min','location','department','manager','note'];
    fields.forEach(f => {
      const el = document.getElementById(`pf_${f}`);
      if (el) el.value = item[f] !== undefined ? item[f] : '';
    });

    // 수정 시 초기재고/입고일자/공급처 필드 숨기기
    ['pf_init_stock','pf_in_date','pf_supplier'].forEach(fId => {
      const row = document.getElementById(fId)?.closest('div');
      if (row) row.style.display = 'none';
    });

    // 버튼 텍스트 변경
    const saveBtn = document.querySelector('#promoInPanel-new button[onclick="savePromoItem()"]');
    if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> 품목 정보 저장';

    showToast(`'${item.promo_name}' 정보를 수정합니다.`, 'info');
  }, 150);
}

function resetPromoItemForm() {
  const editIdEl = document.getElementById('editPromoId');
  if (editIdEl) editIdEl.value = '';

  const fields = ['pf_promo_code','pf_promo_name','pf_category','pf_spec','pf_unit_price',
                  'pf_stock_min','pf_init_stock','pf_in_date','pf_location','pf_department',
                  'pf_manager','pf_supplier','pf_note'];
  fields.forEach(f => { const el = document.getElementById(f); if (el) el.value = ''; });

  const minStockEl = document.getElementById('pf_stock_min');
  if (minStockEl) minStockEl.value = '10';

  // 숨겨진 필드 다시 표시
  ['pf_init_stock','pf_in_date','pf_supplier'].forEach(fId => {
    const row = document.getElementById(fId)?.closest('div');
    if (row) row.style.display = '';
  });

  // 버튼 텍스트 원복
  const saveBtn = document.querySelector('#promoInPanel-new button[onclick="savePromoItem()"]');
  if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i>품목 등록 + 입고';

  // 오늘 날짜 기본값
  const inDateEl = document.getElementById('pf_in_date');
  if (inDateEl) inDateEl.value = new Date().toISOString().split('T')[0];

  // 담당자 자동 채우기
  const managerEl = document.getElementById('pf_manager');
  if (managerEl && !managerEl.value) managerEl.value = getLoginUserName();
}

async function deletePromoItem(id, name, stock) {
  if (Number(stock) > 0) {
    if (!confirm(`'${name}' 품목은 현재 재고(${stock}개)가 있습니다.\n정말 삭제하시겠습니까?`)) return;
  } else {
    if (!confirm(`'${name}' 품목을 삭제하시겠습니까?`)) return;
  }
  try {
    await promoApiFetch(`${PROMO_TABLE}/${id}`, { method: 'DELETE' });
    showToast('판촉물 품목이 삭제되었습니다.', 'success');
    await loadAllPromoItems();
    renderPromoStockTable();
    populatePromoSelects();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 입고 처리 페이지: 품목 목록 렌더링 (라디오 버튼 선택 방식)
// ============================================================
let _promoInFilteredItems = [];

function populatePromoInItemList() {
  _promoInFilteredItems = allPromoItems.filter(p => p.status !== '중단');
  renderPromoInItemList(_promoInFilteredItems);
}

function filterPromoInList() {
  const q = (document.getElementById('promoInSearchInput')?.value || '').toLowerCase();
  const filtered = allPromoItems.filter(p => {
    if (p.status === '중단') return false;
    if (!q) return true;
    return (p.promo_name || '').toLowerCase().includes(q) ||
           (p.promo_code || '').toLowerCase().includes(q);
  });
  renderPromoInItemList(filtered);
}

function renderPromoInItemList(items) {
  const container = document.getElementById('promoInItemList');
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm"><i class="fas fa-search block text-2xl mb-2 opacity-30"></i>검색 결과가 없습니다</div>`;
    return;
  }
  container.innerHTML = items.map(p => {
    const stock    = Number(p.current_stock) || 0;
    const minStock = Number(p.stock_min) || 0;
    const isEmpty  = stock === 0;
    const isLow    = !isEmpty && stock <= minStock && minStock > 0;
    const stockCls = isEmpty ? 'text-red-600 font-bold' : isLow ? 'text-orange-600 font-semibold' : 'text-green-700 font-semibold';
    const badge    = isEmpty
      ? '<span class="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">재고없음</span>'
      : isLow
      ? '<span class="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full">재고부족</span>'
      : '<span class="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">정상</span>';
    const safeName = (p.promo_name || '').replace(/"/g, '&quot;');
    return `
      <label class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-green-50 border-b border-gray-100 last:border-0 transition-colors">
        <input type="radio" name="promoInItemRadio" value="${p.id}"
          data-stock="${stock}" data-name="${safeName}" data-code="${p.promo_code||''}"
          onchange="onPromoInRadioChange(this)" class="accent-green-600 w-4 h-4 flex-shrink-0"/>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-gray-800 text-sm">${p.promo_name || '-'}</span>
            ${badge}
          </div>
          <div class="text-xs text-gray-400 mt-0.5">${p.promo_code || ''} · ${p.category || ''}${p.spec ? ' · ' + p.spec : ''}</div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="${stockCls} text-sm">${stock.toLocaleString()}개</div>
          <div class="text-xs text-gray-400">현재 재고</div>
        </div>
      </label>
    `;
  }).join('');
}

function onPromoInRadioChange(radio) {
  const stock    = Number(radio.dataset.stock) || 0;
  const name     = radio.dataset.name;
  const code     = radio.dataset.code;
  const infoEl   = document.getElementById('promoInCurrentStock');
  const textEl   = document.getElementById('promoInCurrentStockText');
  const hiddenEl = document.getElementById('promoInItem');
  if (hiddenEl) hiddenEl.value = radio.value;
  if (infoEl && textEl) {
    textEl.textContent = `선택: ${name} (${code}) — 현재 재고 ${stock.toLocaleString()}개`;
    infoEl.classList.remove('hidden');
  }
}

// ============================================================
// 출고 select 옵션 채우기 + 입고 목록 갱신
// ============================================================
function populatePromoSelects() {
  // 출고 처리 페이지 select 옵션 업데이트
  const outSel = document.getElementById('promoOutItem');
  const opts = '<option value="">-- 판촉물을 선택하세요 --</option>' +
    allPromoItems
      .filter(p => p.status !== '중단')
      .map(p => {
        const stock = Number(p.current_stock) || 0;
        const safeName = (p.promo_name || '').replace(/"/g, '&quot;');
        return `<option value="${p.id}" data-stock="${stock}" data-code="${p.promo_code||''}" data-name="${safeName}">${p.promo_name} (${p.promo_code||''}) · 재고: ${stock.toLocaleString()}개</option>`;
      })
      .join('');
  if (outSel) outSel.innerHTML = opts;

  // 입고 처리 페이지 목록도 갱신
  populatePromoInItemList();
}

// 레거시 호환
function onPromoInItemChange() {}

function onPromoOutItemChange() {
  const sel    = document.getElementById('promoOutItem');
  const infoEl = document.getElementById('promoOutCurrentStock');
  if (!sel || !infoEl) return;
  const opt = sel.options[sel.selectedIndex];
  if (sel.value && opt) {
    const stock = opt.dataset.stock || '0';
    infoEl.textContent = `현재 재고: ${Number(stock).toLocaleString()}개`;
    infoEl.classList.remove('hidden');
  } else {
    infoEl.classList.add('hidden');
  }
}

// ============================================================
// 입고 처리 페이지 탭 전환
// ============================================================
function switchPromoInTab(tab) {
  const existingPanel = document.getElementById('promoInPanel-existing');
  const newPanel      = document.getElementById('promoInPanel-new');
  const existingBtn   = document.getElementById('promoInTab-existing');
  const newBtn        = document.getElementById('promoInTab-new');

  if (tab === 'existing') {
    existingPanel?.classList.remove('hidden');
    newPanel?.classList.add('hidden');
    if (existingBtn) existingBtn.className = 'px-5 py-2 text-sm font-semibold rounded-lg bg-white text-green-700 shadow-sm transition-all';
    if (newBtn)      newBtn.className      = 'px-5 py-2 text-sm font-semibold rounded-lg text-gray-500 hover:text-gray-700 transition-all';
  } else {
    existingPanel?.classList.add('hidden');
    newPanel?.classList.remove('hidden');
    if (newBtn)      newBtn.className      = 'px-5 py-2 text-sm font-semibold rounded-lg bg-white text-orange-600 shadow-sm transition-all';
    if (existingBtn) existingBtn.className = 'px-5 py-2 text-sm font-semibold rounded-lg text-gray-500 hover:text-gray-700 transition-all';
    // 수정 중이 아닌 경우에만 폼 초기화
    const editId = document.getElementById('editPromoId')?.value;
    if (!editId) resetPromoItemForm();
  }
}

// ============================================================
// 입고 처리
// ============================================================
async function processPromoIn() {
  const itemId  = document.getElementById('promoInItem')?.value;
  const qty     = Number(document.getElementById('promoInQty')?.value);
  const txDate  = document.getElementById('promoInDate')?.value;
  const target  = document.getElementById('promoInTarget')?.value?.trim();
  const handler = document.getElementById('promoInHandler')?.value?.trim() || getLoginUserName();
  const note    = document.getElementById('promoInNote')?.value?.trim();

  if (!itemId)  { showToast('판촉물을 선택해주세요.', 'warning'); return; }
  if (!qty || qty <= 0) { showToast('입고 수량을 올바르게 입력해주세요.', 'warning'); return; }
  if (!txDate)  { showToast('입고 일자를 입력해주세요.', 'warning'); return; }

  const item = allPromoItems.find(p => p.id === itemId);
  if (!item) { showToast('품목을 찾을 수 없습니다.', 'error'); return; }

  const beforeStock = Number(item.current_stock) || 0;
  const afterStock  = beforeStock + qty;

  try {
    // 재고 업데이트
    await promoApiFetch(`${PROMO_TABLE}/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        current_stock: afterStock,
        total_in: (Number(item.total_in) || 0) + qty,
        status: afterStock > (Number(item.stock_min)||0) ? '정상' : (afterStock === 0 ? '중단' : item.status),
      }),
    });

    // 이력 등록
    await addPromoTransaction({
      item_id:      itemId,
      promo_code:   item.promo_code,
      promo_name:   item.promo_name,
      tx_type:      '입고',
      quantity:     qty,
      before_stock: beforeStock,
      after_stock:  afterStock,
      target:       target || '',
      purpose:      '',
      handler,
      tx_date:      txDate,
      note:         note || '',
    });

    showToast(`입고 처리 완료: ${item.promo_name} +${qty}개 (재고: ${afterStock.toLocaleString()}개)`, 'success');
    resetPromoInForm();
    await loadAllPromoItems();
    populatePromoSelects();
  } catch (e) {
    showToast('입고 처리 실패: ' + e.message, 'error');
  }
}

function resetPromoInForm() {
  ['promoInItem','promoInQty','promoInDate','promoInTarget','promoInHandler','promoInNote']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // 라디오 버튼 초기화
  document.querySelectorAll('input[name="promoInItemRadio"]').forEach(r => r.checked = false);
  const searchEl = document.getElementById('promoInSearchInput');
  if (searchEl) searchEl.value = '';

  const infoEl = document.getElementById('promoInCurrentStock');
  if (infoEl) infoEl.classList.add('hidden');
  // 오늘 날짜 기본값
  const dateEl = document.getElementById('promoInDate');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  // 처리자 자동 채우기
  const handlerEl = document.getElementById('promoInHandler');
  if (handlerEl) handlerEl.value = getLoginUserName();

  // 품목 목록 갱신
  populatePromoInItemList();
}

// ============================================================
// 출고 처리
// ============================================================
async function processPromoOut() {
  const itemId  = document.getElementById('promoOutItem')?.value;
  const qty     = Number(document.getElementById('promoOutQty')?.value);
  const txDate  = document.getElementById('promoOutDate')?.value;
  const target  = document.getElementById('promoOutTarget')?.value?.trim();
  const purpose = document.getElementById('promoOutPurpose')?.value?.trim();
  const handler = document.getElementById('promoOutHandler')?.value?.trim() || getLoginUserName();
  const note    = document.getElementById('promoOutNote')?.value?.trim();

  if (!itemId)  { showToast('판촉물을 선택해주세요.', 'warning'); return; }
  if (!qty || qty <= 0) { showToast('출고 수량을 올바르게 입력해주세요.', 'warning'); return; }
  if (!txDate)  { showToast('출고 일자를 입력해주세요.', 'warning'); return; }
  if (!target)  { showToast('출고 대상(고객사/행사명)을 입력해주세요.', 'warning'); return; }

  const item = allPromoItems.find(p => p.id === itemId);
  if (!item) { showToast('품목을 찾을 수 없습니다.', 'error'); return; }

  const beforeStock = Number(item.current_stock) || 0;
  if (qty > beforeStock) {
    showToast(`재고 부족: 현재 재고(${beforeStock.toLocaleString()}개)보다 많이 출고할 수 없습니다.`, 'error');
    return;
  }

  const afterStock = beforeStock - qty;
  const minStock   = Number(item.stock_min) || 0;
  const newStatus  = afterStock === 0 ? '재고부족' : afterStock <= minStock ? '재고부족' : '정상';

  try {
    // 재고 업데이트
    await promoApiFetch(`${PROMO_TABLE}/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        current_stock: afterStock,
        total_out: (Number(item.total_out) || 0) + qty,
        status: newStatus,
      }),
    });

    // 이력 등록
    await addPromoTransaction({
      item_id:      itemId,
      promo_code:   item.promo_code,
      promo_name:   item.promo_name,
      tx_type:      '출고',
      quantity:     qty,
      before_stock: beforeStock,
      after_stock:  afterStock,
      target,
      purpose:      purpose || '',
      handler,
      tx_date:      txDate,
      note:         note || '',
    });

    showToast(`출고 처리 완료: ${item.promo_name} -${qty}개 → ${target} (잔여: ${afterStock.toLocaleString()}개)`, 'success');
    resetPromoOutForm();
    await loadAllPromoItems();
    populatePromoSelects();
  } catch (e) {
    showToast('출고 처리 실패: ' + e.message, 'error');
  }
}

function resetPromoOutForm() {
  ['promoOutItem','promoOutQty','promoOutDate','promoOutTarget','promoOutPurpose','promoOutHandler','promoOutNote']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const infoEl = document.getElementById('promoOutCurrentStock');
  if (infoEl) infoEl.classList.add('hidden');
  // 오늘 날짜 기본값
  const dateEl = document.getElementById('promoOutDate');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  // 처리자 자동 채우기
  const handlerEl = document.getElementById('promoOutHandler');
  if (handlerEl) handlerEl.value = getLoginUserName();
}

// ============================================================
// 빠른 입고/출고 (재고현황에서 바로)
// ============================================================
function quickPromoIn(itemId) {
  // 입고 처리 페이지로 이동하고 해당 품목을 자동 선택
  navigateTo('promo-in');
  setTimeout(() => {
    switchPromoInTab('existing');
    // 라디오 버튼에서 해당 아이템 선택
    const radio = document.querySelector(`input[name="promoInItemRadio"][value="${itemId}"]`);
    if (radio) {
      radio.checked = true;
      onPromoInRadioChange(radio);
    } else {
      // 품목이 목록에 없으면 검색 초기화 후 다시 렌더링 후 선택
      const searchEl = document.getElementById('promoInSearchInput');
      if (searchEl) searchEl.value = '';
      populatePromoInItemList();
      setTimeout(() => {
        const r = document.querySelector(`input[name="promoInItemRadio"][value="${itemId}"]`);
        if (r) { r.checked = true; onPromoInRadioChange(r); }
      }, 100);
    }
    // 기본값 채우기
    const dateEl = document.getElementById('promoInDate');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
    const handlerEl = document.getElementById('promoInHandler');
    if (handlerEl && !handlerEl.value) handlerEl.value = getLoginUserName();
  }, 150);
}

function quickPromoOut(itemId) {
  const outSel = document.getElementById('promoOutItem');
  if (outSel) {
    outSel.value = itemId;
    onPromoOutItemChange();
  }
  const dateEl = document.getElementById('promoOutDate');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  const handlerEl = document.getElementById('promoOutHandler');
  if (handlerEl) handlerEl.value = getLoginUserName();
  navigateTo('promo-out');
}

// ============================================================
// 이력 추가
// ============================================================
async function addPromoTransaction(data) {
  try {
    await promoApiFetch(PROMO_TX_TBL, { method: 'POST', body: JSON.stringify(data) });
  } catch (e) {
    console.warn('판촉물 이력 저장 실패:', e);
  }
}

// ============================================================
// 입출고 이력 페이지
// ============================================================
async function loadPromoHistory() {
  const tbody = document.getElementById('promoHistTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin text-xl"></i></td></tr>`;

  try {
    const data = await promoApiFetch(`${PROMO_TX_TBL}?limit=1000`);
    let histories = (data.data || []).reverse();

    const q    = (document.getElementById('promoHistSearch')?.value || '').toLowerCase();
    const type = document.getElementById('promoHistType')?.value || '';

    if (q) {
      histories = histories.filter(h =>
        (h.promo_name||'').toLowerCase().includes(q) ||
        (h.promo_code||'').toLowerCase().includes(q) ||
        (h.target||'').toLowerCase().includes(q) ||
        (h.handler||'').toLowerCase().includes(q)
      );
    }
    if (type) {
      histories = histories.filter(h => h.tx_type === type);
    }

    if (!histories.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-10 text-gray-400">이력 데이터가 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = histories.map(h => {
      const typeCls = h.tx_type === '입고' ? 'bg-green-100 text-green-700' :
                      h.tx_type === '출고' ? 'bg-orange-100 text-orange-700' :
                      h.tx_type === '폐기' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600';
      const qtySign = h.tx_type === '입고' ? '+' : h.tx_type === '출고' ? '-' : '';
      const qtyCls  = h.tx_type === '입고' ? 'text-green-600 font-bold' :
                      h.tx_type === '출고' ? 'text-orange-600 font-bold' : 'text-gray-600 font-semibold';
      return `
        <tr class="hover:bg-gray-50">
          <td class="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">${h.tx_date || ''}</td>
          <td class="px-4 py-2 font-mono text-xs text-blue-700">${h.promo_code || '-'}</td>
          <td class="px-4 py-2 font-medium text-sm">${h.promo_name || '-'}</td>
          <td class="px-4 py-2"><span class="text-xs px-2 py-1 ${typeCls} rounded-full font-semibold">${h.tx_type||'-'}</span></td>
          <td class="px-4 py-2 text-right ${qtyCls}">${qtySign}${Number(h.quantity||0).toLocaleString()}</td>
          <td class="px-4 py-2 text-right text-xs text-gray-500">${Number(h.before_stock||0).toLocaleString()}</td>
          <td class="px-4 py-2 text-right text-xs font-semibold text-gray-700">${Number(h.after_stock||0).toLocaleString()}</td>
          <td class="px-4 py-2 text-xs text-gray-600">${h.target || '-'}</td>
          <td class="px-4 py-2 text-xs text-gray-500">${h.purpose || '-'}</td>
          <td class="px-4 py-2 text-xs text-gray-500">${h.handler || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-red-400">${e.message}</td></tr>`;
  }
}

// ============================================================
// 판촉물 등록 페이지 (레거시 - 현재는 promo-in 탭에서 처리)
// ============================================================
function renderPromoRegisterPage() {
  navigateTo('promo-in');
  setTimeout(() => switchPromoInTab('new'), 150);
}

// ============================================================
// 판촉물 대시보드
// ============================================================
async function renderPromoDashboard() {
  const items = await loadAllPromoItems();

  const total     = items.length;
  const lowItems  = items.filter(p => {
    const s = Number(p.current_stock)||0;
    const m = Number(p.stock_min)||0;
    return s <= m && m > 0;
  });
  const okItems   = items.filter(p => {
    const s = Number(p.current_stock)||0;
    const m = Number(p.stock_min)||0;
    return s > m || m === 0;
  });
  const totalValue = items.reduce((sum, p) => sum + (Number(p.current_stock)||0) * (Number(p.unit_price)||0), 0);

  const s1 = document.getElementById('promo-stat-total');
  const s2 = document.getElementById('promo-stat-ok');
  const s3 = document.getElementById('promo-stat-low');
  const s4 = document.getElementById('promo-stat-value');
  if (s1) s1.textContent = total;
  if (s2) s2.textContent = okItems.length;
  if (s3) s3.textContent = lowItems.length;
  if (s4) s4.textContent = totalValue ? totalValue.toLocaleString() + '원' : '-';

  renderPromoCategoryChart(items);
  renderPromoLowStockList(lowItems);
}

function renderPromoCategoryChart(items) {
  const ctx = document.getElementById('promoCategoryChart');
  if (!ctx) return;
  const catMap = {};
  items.forEach(p => {
    const cat = p.category || '기타';
    catMap[cat] = (catMap[cat] || 0) + (Number(p.current_stock)||0);
  });
  const labels = Object.keys(catMap);
  const data   = Object.values(catMap);

  if (promoCategoryChartInstance) promoCategoryChartInstance.destroy();
  promoCategoryChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '재고 수량',
        data,
        backgroundColor: 'rgba(249,115,22,0.7)',
        borderColor: '#f97316',
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

function renderPromoLowStockList(lowItems) {
  const el = document.getElementById('promoLowStock');
  if (!el) return;
  if (!lowItems.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">재고 부족 품목 없음</p>';
    return;
  }
  el.innerHTML = lowItems.slice(0, 6).map(p => {
    const stock = Number(p.current_stock)||0;
    const min   = Number(p.stock_min)||0;
    const cls   = stock === 0 ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50';
    const tCls  = stock === 0 ? 'text-red-700' : 'text-orange-700';
    return `
      <div class="flex items-center gap-3 p-2.5 ${cls} border rounded-xl">
        <i class="fas fa-exclamation-triangle ${tCls}"></i>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-gray-700 truncate">${p.promo_name} (${p.promo_code||'-'})</p>
          <p class="text-xs text-gray-500">${p.category||''} · 안전재고: ${min}개</p>
        </div>
        <span class="text-xs font-bold ${tCls} whitespace-nowrap">재고 ${stock}개</span>
      </div>
    `;
  }).join('');
}

// ============================================================
// 판촉물 대시보드 탭 연동 (app.js switchDashTab에서 호출)
// ============================================================
async function renderPromoDashboardTab() {
  await renderPromoDashboard();
}

// ============================================================
// Excel 내보내기
// ============================================================
function exportPromoExcel() {
  try {
    const data = filteredPromoItems.map(p => ({
      '품목코드':   p.promo_code,
      '판촉물명':   p.promo_name,
      '분류':       p.category,
      '규격':       p.spec,
      '단가(원)':   p.unit_price,
      '현재재고':   p.current_stock,
      '안전재고':   p.stock_min,
      '입고누계':   p.total_in,
      '출고누계':   p.total_out,
      '보관위치':   p.location,
      '담당부서':   p.department,
      '담당자':     p.manager,
      '상태':       p.status,
      '비고':       p.note,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '판촉물 재고현황');
    ws['!cols'] = [
      {wch:14},{wch:20},{wch:12},{wch:16},{wch:10},{wch:10},
      {wch:10},{wch:10},{wch:10},{wch:16},{wch:14},{wch:10},{wch:10},{wch:20}
    ];
    const now = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `판촉물재고현황_${now}.xlsx`);
    showToast('Excel 파일이 다운로드되었습니다.', 'success');
  } catch (e) {
    showToast('Excel 내보내기 실패: ' + e.message, 'error');
  }
}

// ============================================================
// 유틸: 로그인 사용자 이름 가져오기
// ============================================================
function getLoginUserName() {
  if (typeof AuthManager !== 'undefined') {
    const u = AuthManager.getCurrentUser();
    if (u) return u.full_name || u.email || u.username || 'IT관리자';
  }
  return 'IT관리자';
}

// ============================================================
// 페이지 진입 시 날짜/담당자 기본값 세팅
// ============================================================
function initPromoInOutDefaults() {
  const today = new Date().toISOString().split('T')[0];
  const userName = getLoginUserName();

  const inDateEl = document.getElementById('promoInDate');
  const outDateEl = document.getElementById('promoOutDate');
  const inHandlerEl = document.getElementById('promoInHandler');
  const outHandlerEl = document.getElementById('promoOutHandler');

  if (inDateEl && !inDateEl.value) inDateEl.value = today;
  if (outDateEl && !outDateEl.value) outDateEl.value = today;
  if (inHandlerEl && !inHandlerEl.value) inHandlerEl.value = userName;
  if (outHandlerEl && !outHandlerEl.value) outHandlerEl.value = userName;
}

// ============================================================
// select onchange 이벤트 바인딩 (DOMContentLoaded)
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // 출고 처리 select 이벤트만 바인딩 (입고는 라디오 버튼 방식으로 변경)
  const outSel = document.getElementById('promoOutItem');
  if (outSel) outSel.addEventListener('change', onPromoOutItemChange);
});
