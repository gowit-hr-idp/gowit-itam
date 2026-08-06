// ============================================================
// IT 정기결제 - Visual Studio 사용자 목록
//   구성: 서비스명 · 부서 · 사원명 · 직책 · 계정할당여부(O/X) · 할당된 날짜 · 해지일자 · 비고
//   서비스명: Security / Modern Work 기본, '설정'(카테고리 vs_service)에서 추가 가능
// ============================================================
const VS_TBL = 'vs_users';
let allVsUsers = [];

function _vsSetVal(id, v) { const el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); }
function _vsCanWrite() {
  return !(typeof AuthManager !== 'undefined' && AuthManager.hasPermission && !AuthManager.hasPermission('sub', 'write'));
}

async function loadVsUsers() {
  try {
    const data = await apiFetch(`${VS_TBL}?limit=1000`);
    allVsUsers = data?.data || [];

    // 서비스명 필터 옵션 채우기 (데이터 기준)
    const services = [...new Set(allVsUsers.map(v => v.service_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const sel = document.getElementById('vsFilterService');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">전체</option>' + services.map(s => `<option>${s}</option>`).join('');
      if (services.includes(cur)) sel.value = cur;
    }
    renderVsUsersTable();
  } catch (e) {
    showToast('Visual Studio 사용자 로드 실패: ' + e.message, 'error');
  }
}

function renderVsUsersTable() {
  const tbody = document.getElementById('vsTableBody');
  if (!tbody) return;

  const q         = (document.getElementById('vsSearchInput')?.value || '').trim().toLowerCase();
  const fSvc      = document.getElementById('vsFilterService')?.value || '';
  const fAssigned = document.getElementById('vsFilterAssigned')?.value || '';

  let rows = allVsUsers.slice();
  if (fSvc) rows = rows.filter(v => (v.service_name || '') === fSvc);
  if (fAssigned) rows = rows.filter(v => (v.assigned || 'X') === fAssigned);
  if (q) rows = rows.filter(v =>
    (v.employee_name || '').toLowerCase().includes(q) ||
    (v.department || '').toLowerCase().includes(q) ||
    (v.service_name || '').toLowerCase().includes(q) ||
    (v.title || '').toLowerCase().includes(q));

  // 서비스명 > 사원명 정렬
  rows.sort((a, b) =>
    (a.service_name || '').localeCompare(b.service_name || '', 'ko') ||
    (a.employee_name || '').localeCompare(b.employee_name || '', 'ko'));

  setEl('vsCount', `전체 ${rows.length}건`);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-16 text-gray-400"><i class="fab fa-microsoft text-4xl block mb-3 opacity-20"></i>표시할 사용자가 없습니다.</td></tr>`;
    return;
  }

  const canWrite = _vsCanWrite();
  const esc = s => String(s ?? '').replace(/"/g, '&quot;');

  tbody.innerHTML = rows.map(v => {
    const assigned = (v.assigned || 'X') === 'O';
    return `<tr class="border-b border-gray-50 hover:bg-purple-50/20">
      <td class="px-4 py-2.5 font-medium text-gray-700">${v.service_name || '-'}</td>
      <td class="px-4 py-2.5 text-gray-600">${v.department || '-'}</td>
      <td class="px-4 py-2.5 font-medium text-gray-800">${v.employee_name || '-'}</td>
      <td class="px-4 py-2.5 text-gray-600">${v.title || '-'}</td>
      <td class="px-4 py-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-xs font-bold ${assigned ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}">${v.assigned || 'X'}</span></td>
      <td class="px-4 py-2.5 text-gray-600">${v.assigned_date || '-'}</td>
      <td class="px-4 py-2.5 text-gray-600">${v.terminated_date || '-'}</td>
      <td class="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate" title="${esc(v.note)}">${v.note || '-'}</td>
      <td class="px-4 py-2.5 text-center whitespace-nowrap">
        ${canWrite ? `<button onclick="editVsUser('${v.id}')" class="action-btn btn-edit" title="수정"><i class="fas fa-edit"></i></button>
        <button onclick="deleteVsUser('${v.id}')" class="action-btn btn-delete" title="삭제"><i class="fas fa-trash"></i></button>` : '<span class="text-gray-300">-</span>'}
      </td>
    </tr>`;
  }).join('');
}

function openVsUserModal(id) {
  if (!_vsCanWrite()) { showToast('입력/수정 권한이 없습니다. 관리자에게 문의하세요.', 'error'); return; }
  const form = document.getElementById('vsUserForm');
  if (form) form.reset();
  _vsSetVal('editVsId', '');
  const titleEl = document.getElementById('vsUserModalTitle');
  if (titleEl) titleEl.innerHTML = '<i class="fab fa-microsoft text-purple-500"></i>Visual Studio 사용자 등록';

  if (id) {
    const v = allVsUsers.find(x => String(x.id) === String(id));
    if (v) {
      if (titleEl) titleEl.innerHTML = '<i class="fab fa-microsoft text-purple-500"></i>Visual Studio 사용자 수정';
      _vsSetVal('editVsId', v.id);
      _vsSetVal('vsf_service_name', v.service_name);
      _vsSetVal('vsf_department', v.department);
      _vsSetVal('vsf_employee_name', v.employee_name);
      _vsSetVal('vsf_title', v.title);
      _vsSetVal('vsf_assigned', v.assigned || 'O');
      _vsSetVal('vsf_assigned_date', v.assigned_date);
      _vsSetVal('vsf_terminated_date', v.terminated_date);
      _vsSetVal('vsf_note', v.note);
    }
  }
  openModal('vsUserModal'); // CATEGORY_REFRESH_MODALS에 포함되어 서비스명 드롭다운 자동 갱신
}

function editVsUser(id) { openVsUserModal(id); }

async function saveVsUser() {
  if (!_vsCanWrite()) { showToast('입력/수정 권한이 없습니다.', 'error'); return; }
  const id = document.getElementById('editVsId')?.value || '';
  const g = fid => (document.getElementById(fid)?.value || '').trim();

  const payload = {
    service_name:    g('vsf_service_name'),
    department:      g('vsf_department'),
    employee_name:   g('vsf_employee_name'),
    title:           g('vsf_title'),
    assigned:        g('vsf_assigned') || 'X',
    assigned_date:   g('vsf_assigned_date') || null,   // 빈 날짜는 null (date 컬럼 오류 방지)
    terminated_date: g('vsf_terminated_date') || null,
    note:            g('vsf_note'),
  };

  if (!payload.service_name)  { showToast('서비스명을 선택해주세요.', 'warning'); return; }
  if (!payload.employee_name) { showToast('사원명을 입력해주세요.', 'warning'); return; }

  try {
    if (id) {
      await apiFetch(`${VS_TBL}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('수정되었습니다.', 'success');
    } else {
      await apiFetch(VS_TBL, { method: 'POST', body: JSON.stringify(payload) });
      showToast('등록되었습니다.', 'success');
    }
    closeModal('vsUserModal');
    await loadVsUsers();
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

async function deleteVsUser(id) {
  if (!_vsCanWrite()) { showToast('삭제 권한이 없습니다.', 'error'); return; }
  const v = allVsUsers.find(x => String(x.id) === String(id));
  if (!confirm(`${v?.employee_name || '해당'} 사용자를 삭제하시겠습니까?`)) return;
  try {
    await apiFetch(`${VS_TBL}/${id}`, { method: 'DELETE' });
    showToast('삭제되었습니다.', 'success');
    await loadVsUsers();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

function exportVsExcel() {
  if (!allVsUsers.length) { showToast('내보낼 데이터가 없습니다.', 'warning'); return; }
  if (typeof XLSX === 'undefined') { showToast('Excel 기능을 사용할 수 없습니다.', 'error'); return; }
  const headers = ['서비스명', '부서', '사원명', '직책', '계정할당여부', '할당된 날짜', '해지일자', '비고'];
  const rows = [...allVsUsers]
    .sort((a, b) => (a.service_name || '').localeCompare(b.service_name || '', 'ko') || (a.employee_name || '').localeCompare(b.employee_name || '', 'ko'))
    .map(v => [v.service_name || '', v.department || '', v.employee_name || '', v.title || '', v.assigned || '', v.assigned_date || '', v.terminated_date || '', v.note || '']);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'VS사용자');
  XLSX.writeFile(wb, `VisualStudio사용자_${Date.now()}.xlsx`);
  showToast('Excel 파일이 다운로드되었습니다.', 'success');
}
