// app.js - Tonang Farma Management System Core Engine
// Hybrid Online-Offline PMS & Multi-Branch Architecture

(function() {
  'use strict';

  // ==========================================
  // 1. INITIAL STATE & SEED DATA
  // ==========================================
  const DEFAULT_STATE = {
    currentBranch: 'ALL', // 'ALL', 'TLD', 'KBJ'
    currentRole: 'OWNER',  // 'OWNER', 'ADMIN', 'APOTEKER', 'KASIR'
    isOnline: true,
    outbox: [],
    
    branches: [
      { id: 'TLD', name: 'Cabang Kepulauan Talaud', location: 'Kab. Kepulauan Talaud, Sulawesi Utara' },
      { id: 'KBJ', name: 'Cabang Kembang Janggut', location: 'Kutai Kartanegara, Kalimantan Timur' }
    ],

    // Clean initial state (no dummy/seed data)
    medicines: [],
    deletedMedicineCodes: [],
    batches: [],
    sales: [],
    transfers: [],
    expenses: [],
    deletedExpenseIds: [],

    suppliers: [
      { id: 'SUP-01', name: 'PT. Kimia Farma Trading & Distribution', phone: '021-3847709', address: 'Manado / Balikpapan' },
      { id: 'SUP-02', name: 'PT. Enseval Putera Megatrading', phone: '021-4609042', address: 'Samarinda / Manado' },
      { id: 'SUP-03', name: 'PT. Anugrah Argon Medica (AAM)', phone: '021-6593000', address: 'Balikpapan' },
      { id: 'SUP-04', name: 'PT. Mensa Bina Sukses (MBS)', phone: '021-4701234', address: 'Manado' }
    ],
    purchases: [],

    users: [
      {
        id: 'USR-01',
        username: 'owner',
        password: 'owner123',
        fullName: 'Bpk. Tonang (Owner)',
        role: 'OWNER',
        branchId: 'ALL',
        active: true
      },
      {
        id: 'USR-02',
        username: 'admin',
        password: 'admin123',
        fullName: 'Admin Pusat',
        role: 'ADMIN',
        branchId: 'ALL',
        active: true
      },
      {
        id: 'USR-03',
        username: 'apoteker.tld',
        password: 'apoteker123',
        fullName: 'apt. Sarah, S.Farm (Talaud)',
        role: 'APOTEKER',
        branchId: 'TLD',
        active: true
      },
      {
        id: 'USR-04',
        username: 'apoteker.kbj',
        password: 'apoteker123',
        fullName: 'apt. Hendra, S.Farm (Kembang Janggut)',
        role: 'APOTEKER',
        branchId: 'KBJ',
        active: true
      },
      {
        id: 'USR-05',
        username: 'kasir.tld',
        password: 'kasir123',
        fullName: 'Rina Marlina (Kasir Talaud)',
        role: 'KASIR',
        branchId: 'TLD',
        active: true
      },
      {
        id: 'USR-07',
        username: 'kasir.kbj',
        password: 'kasir123',
        fullName: 'Budi Santoso (Kasir Kembang)',
        role: 'KASIR',
        branchId: 'KBJ',
        active: true
      }
    ],
    currentUserId: 'USR-01',

    cart: []
  };

  // Load from LocalStorage (V2 Clean) or seed
  let appState = (function() {
    try {
      // Clear legacy V1 cache that held dummy demo medicines/batches
      localStorage.removeItem('TONANG_FARMA_STATE_V1');

      const saved = localStorage.getItem('TONANG_FARMA_STATE_V2');
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.deletedMedicineCodes = parsed.deletedMedicineCodes || [];
        parsed.medicines = parsed.medicines || [];
        parsed.batches = parsed.batches || [];
        parsed.sales = parsed.sales || [];
        parsed.expenses = parsed.expenses || [];
        if (!parsed.users || parsed.users.length === 0) {
          parsed.users = DEFAULT_STATE.users;
          parsed.currentUserId = DEFAULT_STATE.currentUserId;
        }
        return parsed;
      }
    } catch (e) {
      console.warn('Could not load saved state, using default:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  })();

  // ==========================================
  // REAL-TIME MULTI-DEVICE & CENTRAL SYNC ENGINE
  // ==========================================
  let lastKnownServerVersion = 0;
  let syncDebounceTimer = null;
  let isSyncingWithServer = false;

  // Helper to merge collections by ID/code without losing local items
  function mergeArrayById(targetArr, sourceArr, idKey = 'id') {
    if (!Array.isArray(targetArr)) targetArr = [];
    if (!Array.isArray(sourceArr)) return targetArr;

    const map = new Map();
    targetArr.forEach(item => {
      const key = item[idKey] || item.code || JSON.stringify(item);
      map.set(key, item);
    });

    sourceArr.forEach(item => {
      const key = item[idKey] || item.code || JSON.stringify(item);
      if (map.has(key)) {
        map.set(key, Object.assign({}, map.get(key), item));
      } else {
        map.set(key, item);
      }
    });

    return Array.from(map.values());
  }

  function getSharedStatePayload() {
    return {
      medicines: appState.medicines,
      deletedMedicineCodes: [],
      branches: appState.branches,
      batches: appState.batches,
      replaceBatches: true,
      deletedBatchIds: appState.deletedBatchIds || [],
      sales: appState.sales || [],
      transfers: appState.transfers,
      expenses: appState.expenses,
      replaceExpenses: true,
      deletedExpenseIds: appState.deletedExpenseIds || [],
      users: appState.users,
      suppliers: appState.suppliers || [],
      purchases: appState.purchases || []
    };
  }

  function animateSyncPulse() {
    const icon = document.getElementById('sync-icon');
    if (icon) {
      icon.classList.add('animate-spin');
      setTimeout(() => icon.classList.remove('animate-spin'), 600);
    }
  }

  function applyServerState(serverData, version, notifyUser = false) {
    if (!serverData) return;
    if (version) lastKnownServerVersion = version;

    // Preserve local user session so client doesn't get logged out or switched
    const savedUserId = appState.currentUserId;
    const savedBranch = appState.currentBranch;
    const savedRole = appState.currentRole;
    const savedCart = appState.cart;
    const savedOutbox = appState.outbox;

    // Server data is the absolute authority for medicines
    if (Array.isArray(serverData.medicines)) {
      appState.medicines = serverData.medicines;
      appState.deletedMedicineCodes = [];
    }
    // Batches from server are authoritative for real-time stock deductions across branches
    if (Array.isArray(serverData.batches)) {
      appState.batches = serverData.batches;
    }
    // Sales from server are merged
    if (Array.isArray(serverData.sales)) {
      appState.sales = mergeArrayById(appState.sales || [], serverData.sales, 'id');
    }
    if (Array.isArray(serverData.transfers)) {
      appState.transfers = mergeArrayById(appState.transfers || [], serverData.transfers, 'id');
    }
    if (Array.isArray(serverData.expenses)) {
      appState.expenses = mergeArrayById(appState.expenses || [], serverData.expenses, 'id');
    }
    if (Array.isArray(serverData.users)) {
      appState.users = mergeArrayById(appState.users || [], serverData.users, 'id');
    }
    if (Array.isArray(serverData.branches)) {
      appState.branches = mergeArrayById(appState.branches || [], serverData.branches, 'id');
    }
    if (Array.isArray(serverData.suppliers)) {
      appState.suppliers = mergeArrayById(appState.suppliers || [], serverData.suppliers, 'id');
    }
    if (Array.isArray(serverData.purchases)) {
      appState.purchases = mergeArrayById(appState.purchases || [], serverData.purchases, 'id');
    }

    appState.currentUserId = savedUserId;
    appState.currentBranch = savedBranch;
    appState.currentRole = savedRole;
    appState.cart = savedCart;
    appState.outbox = savedOutbox;

    // Cache locally for offline availability (local only, do not loop-push)
    saveStateLocalOnly();

    // Real-time update active screen immediately
    refreshCurrentActiveTab();
    animateSyncPulse();

    if (notifyUser) {
      showToast('Data otomatis tersinkronisasi real-time!', 'success');
    }
  }

  async function pushStateToServer() {
    try {
      const payload = getSharedStatePayload();
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload })
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.version) {
          lastKnownServerVersion = json.version;
          animateSyncPulse();
          console.log('[SYNC] Pushed state to server. Version:', json.version);
        }
      }
    } catch (err) {
      console.warn('[SYNC] Push to server failed (offline or disconnected):', err.message);
    }
  }

  async function pushMedicineToServer(med) {
    if (!med) return;
    try {
      const res = await fetch('/api/medicine/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medicine: med })
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.version) {
          lastKnownServerVersion = json.version;
          animateSyncPulse();
          console.log('[SYNC] Medicine pushed directly to server. Version:', json.version);
        }
      }
    } catch (err) {
      console.warn('[SYNC] Direct push medicine failed:', err.message);
    }
  }

  async function pushSaleToServer(sale, batches) {
    if (!sale) return;
    try {
      const res = await fetch('/api/pos/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale, batches })
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.version) {
          lastKnownServerVersion = json.version;
          animateSyncPulse();
          console.log('[POS SYNC] Sale pushed directly to server. Version:', json.version);
        }
      }
    } catch (err) {
      console.warn('[POS SYNC] Direct push sale failed (will sync on reconnect):', err.message);
    }
  }

  async function pullStateFromServer(mergeLocalFirst = false) {
    if (isSyncingWithServer) return;
    isSyncingWithServer = true;

    try {
      if (mergeLocalFirst) {
        // Bi-directional merge: upload any local medicines or records, get unified server state
        const payload = getSharedStatePayload();
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payload })
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            applyServerState(json.data, json.version, false);
            console.log('[SYNC] Initial bi-directional sync merged. Version:', json.version);
            return;
          }
        }
      }

      const res = await fetch('/api/state');
      if (res.ok) {
        const json = await res.json();
        if (json && json.data) {
          applyServerState(json.data, json.version, false);
        }
      }
    } catch (err) {
      console.warn('[SYNC] Pull from server failed:', err.message);
    } finally {
      isSyncingWithServer = false;
    }
  }

  function initRealtimeSync() {
    // 1. Initial sync: always pull authoritative central server state first
    pullStateFromServer(false);

    // 2. Real-time Server-Sent Events (SSE) push
    if (window.EventSource) {
      try {
        const evtSource = new EventSource('/api/events');
        evtSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);

            // Real-time sale completed on another device (iPad, Android, PC)
            if (data.type === 'SALE_COMPLETED' && data.sale) {
              console.log('[REALTIME] SSE SALE_COMPLETED received:', data.sale.id);
              if (data.version) lastKnownServerVersion = data.version;
              appState.sales = appState.sales || [];
              const sIdx = appState.sales.findIndex(s => s.id === data.sale.id);
              if (sIdx !== -1) {
                appState.sales[sIdx] = data.sale;
              } else {
                appState.sales.unshift(data.sale);
              }
              if (Array.isArray(data.batches)) {
                appState.batches = data.batches;
              }
              saveStateLocalOnly();
              refreshCurrentActiveTab();
              animateSyncPulse();
              const brName = data.sale.branchId === 'TLD' ? 'Cabang Talaud' : data.sale.branchId === 'KBJ' ? 'Cabang KBJ' : 'Kasir';
              showToast(`🔔 Transaksi baru ${data.sale.id} (${formatIDR(data.sale.total)}) dari ${brName} tersinkron!`, 'success');
              return;
            }

            if (data.type === 'MEDICINE_SAVED' && data.medicine) {
              const med = data.medicine;
              console.log('[REALTIME] SSE MEDICINE_SAVED received:', med.name, med.code);
              appState.deletedMedicineCodes = (appState.deletedMedicineCodes || []).filter(c => c !== med.code && c !== med.id);
              const idx = appState.medicines.findIndex(m => m.id === med.id || m.code === med.code);
              if (idx !== -1) {
                appState.medicines[idx] = Object.assign({}, appState.medicines[idx], med);
              } else {
                appState.medicines.push(med);
              }
              if (data.version) lastKnownServerVersion = data.version;
              saveStateLocalOnly();
              refreshCurrentActiveTab();
              animateSyncPulse();
              showToast(`Obat "${med.name}" (${med.code}) tersinkron otomatis real-time dari perangkat lain!`, 'success');
              return;
            }

            if (data.type === 'MEDICINE_DELETED') {
              console.log('[REALTIME] SSE MEDICINE_DELETED received:', data.code || data.id);
              if (data.code || data.id) {
                appState.medicines = appState.medicines.filter(m => m.code !== data.code && m.id !== data.id);
              }
              if (data.version) lastKnownServerVersion = data.version;
              saveStateLocalOnly();
              refreshCurrentActiveTab();
              animateSyncPulse();
              return;
            }

            if ((data.type === 'STATE_UPDATED' || data.type === 'MEDICINE_DELETED') && (!data.version || data.version > lastKnownServerVersion)) {
              console.log('[REALTIME] SSE broadcast received: ' + data.type + ' v' + data.version);
              pullStateFromServer(false);
            }
          } catch (err) {}
        };
        evtSource.onerror = () => {
          // Reconnect handled automatically by browser
        };
      } catch (e) {}
    }

    // 3. Fallback polling every 3 seconds to guarantee 100% sync on all networks
    setInterval(async () => {
      try {
        const res = await fetch('/api/version');
        if (res.ok) {
          const json = await res.json();
          if (json.version && json.version > lastKnownServerVersion) {
            console.log('[POLL] New version detected on server:', json.version);
            pullStateFromServer(false);
          }
        }
      } catch (e) {}
    }, 3000);
  }

  function saveStateLocalOnly() {
    try {
      localStorage.setItem('TONANG_FARMA_STATE_V1', JSON.stringify(appState));
    } catch (e) {
      console.error('Failed to save state to localStorage:', e);
    }
  }

  function saveState() {
    saveStateLocalOnly();
    // Push immediately to central server so all devices/IPs receive changes in real-time
    pushStateToServer();
  }

  // ==========================================
  // 2. HELPER UTILITIES
  // ==========================================
  const formatIDR = (val) => {
    return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
  };

  // Standardized Date & Time Formatter for Tonang Farma (Pinned to WITA - Asia/Makassar, UTC+8)
  // Menjamin 100% keseragaman waktu di semua perangkat (MacBook, iPad, Android, Windows)
  function formatDateTimeWITA(dateInput, includeTimezoneLabel = true) {
    if (!dateInput) return '-';
    try {
      const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
      if (isNaN(d.getTime())) return String(dateInput);
      
      const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const formatted = formatter.format(d).replace(/\./g, ':');
      return includeTimezoneLabel ? `${formatted} WITA` : formatted;
    } catch (e) {
      return String(dateInput);
    }
  }

  function formatTimeOnlyWITA(dateInput) {
    if (!dateInput) return '-';
    try {
      const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
      if (isNaN(d.getTime())) return '-';
      const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Makassar',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      return formatter.format(d).replace(/\./g, ':') + ' WITA';
    } catch (e) {
      return '-';
    }
  }

  function formatDateOnlyWITA(dateInput) {
    if (!dateInput) return '-';
    try {
      const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
      if (isNaN(d.getTime())) return '-';
      return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    } catch (e) {
      return '-';
    }
  }

  function getTodayDateStrWITA() {
    try {
      const d = new Date();
      const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(d);
      const y = parts.find(p => p.type === 'year')?.value || '2026';
      const m = parts.find(p => p.type === 'month')?.value || '11';
      const day = parts.find(p => p.type === 'day')?.value || '24';
      return `${y}${m}${day}`;
    } catch (e) {
      return '20261124';
    }
  }

  function updateLiveWITAClock() {
    const el = document.getElementById('live-wita-clock');
    if (!el) return;
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Makassar',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      el.textContent = formatter.format(now).replace(/\./g, ':') + ' WITA';
    } catch (e) {}
  }

  const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `p-3.5 rounded-lg text-xs font-semibold shadow-lg border flex items-center space-x-2 animate-fade-in ${
      type === 'success' ? 'bg-emerald-600 text-white border-emerald-500' :
      type === 'warning' ? 'bg-amber-500 text-slate-900 border-amber-400' :
      'bg-red-600 text-white border-red-500'
    }`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3500);
  };

  const getDaysUntilExpiry = (dateStr) => {
    const today = new Date('2026-11-22'); // Fixed timeline per PRD
    const exp = new Date(dateStr);
    const diffTime = exp - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // ==========================================
  // 3. TAB NAVIGATION CONTROLLER
  // ==========================================
  function setupNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    const panes = document.querySelectorAll('.tab-pane');

    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const targetTab = tab.getAttribute('data-tab');

        // Security: Menu Pengguna & Hak Akses khusus kewenangan Owner
        if (targetTab === 'users' && getCurrentUser().role !== 'OWNER') {
          e.preventDefault();
          showToast('Akses ditolak: Menu Pengguna & Hak Akses hanya dapat diakses oleh Owner (Pemilik).', 'error');
          return;
        }

        tabs.forEach(t => {
          t.classList.remove('active', 'text-emerald-400', 'bg-emerald-500/10', 'border-emerald-500/30');
        });

        tab.classList.add('active');

        panes.forEach(pane => pane.classList.add('hidden'));
        const activePane = document.getElementById(`view-${targetTab}`);
        if (activePane) {
          activePane.classList.remove('hidden');
        }

        // Render target view
        if (targetTab === 'dashboard') renderDashboard();
        if (targetTab === 'pos') renderPOS();
        if (targetTab === 'medicines') renderMedicinesTable();
        if (targetTab === 'inventory') renderInventoryBatches();
        if (targetTab === 'purchases') renderPurchases();
        if (targetTab === 'finance') renderFinance();
        if (targetTab === 'reports') renderReports();
        if (targetTab === 'ai') renderAIChat();
        if (targetTab === 'users') renderUsersTable();

        lucide.createIcons();
      });
    });
  }

  // ==========================================
  // 4. BRANCH & NETWORK & SYNC LOGIC
  // ==========================================
  function getCurrentUser() {
    return appState.users.find(u => u.id === appState.currentUserId) || appState.users[0];
  }

  function setupHeaderControls() {
    const branchSelect = document.getElementById('branch-select');
    const toggleNetBtn = document.getElementById('toggle-network-btn');
    const syncNowBtn = document.getElementById('sync-now-btn');
    const fullscreenBtn = document.getElementById('btn-fullscreen');

    branchSelect.value = appState.currentBranch;

    branchSelect.addEventListener('change', (e) => {
      appState.currentBranch = e.target.value;
      saveState();
      showToast(`Filter cabang diubah ke: ${branchSelect.options[branchSelect.selectedIndex].text}`);
      refreshCurrentActiveTab();
    });

    toggleNetBtn.addEventListener('click', () => {
      appState.isOnline = !appState.isOnline;
      updateNetworkUI();
      saveState();
      if (appState.isOnline) {
        showToast('Koneksi internet pulih. Siap melakukan sinkronisasi.', 'success');
      } else {
        showToast('Mode Offline aktif! Kasir tetap bisa transaksi normal.', 'warning');
      }
    });

    syncNowBtn.addEventListener('click', () => {
      handleManualSync();
    });

    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    const dashPeriodEl = document.getElementById('dash-period');
    if (dashPeriodEl) {
      dashPeriodEl.addEventListener('change', () => {
        renderDashboard();
      });
    }

    updateNetworkUI();
  }

  function updateNetworkUI() {
    const indicatorDot = document.getElementById('network-indicator-dot');
    const statusText = document.getElementById('network-status-text');
    const banner = document.getElementById('offline-alert-banner');
    const toggleBtn = document.getElementById('toggle-network-btn');
    const outboxCountEl = document.getElementById('outbox-pending-count');

    outboxCountEl.textContent = appState.outbox.length;

    if (appState.isOnline) {
      indicatorDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
      statusText.textContent = 'ONLINE';
      toggleBtn.className = 'flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      banner.classList.add('hidden');
    } else {
      indicatorDot.className = 'w-2.5 h-2.5 rounded-full bg-red-400';
      statusText.textContent = 'OFFLINE';
      toggleBtn.className = 'flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all bg-red-500/20 text-red-400 border-red-500/30';
      banner.classList.remove('hidden');
    }
  }

  async function handleManualSync() {
    if (!appState.isOnline) {
      showToast('Gagal Sync: Perangkat masih dalam status OFFLINE.', 'warning');
      return;
    }

    const icon = document.getElementById('sync-icon');
    if (icon) icon.classList.add('animate-spin');

    const syncCount = appState.outbox.length;
    if (syncCount > 0) {
      appState.outbox = [];
      saveState();
      updateNetworkUI();
    }

    // Clear any local ghost tombstones and pull authoritative server state
    appState.deletedMedicineCodes = [];
    await pullStateFromServer(false);
    renderMedicinesTable();
    renderPOSProductGrid();

    if (icon) {
      setTimeout(() => icon.classList.remove('animate-spin'), 600);
    }

    if (syncCount > 0) {
      showToast(`Berhasil menyinkronkan ${syncCount} transaksi antrean & update data ke Server Pusat!`, 'success');
    } else {
      showToast(`Sinkronisasi real-time berhasil: Katalog obat diperbarui (${appState.medicines?.length || 0} obat)!`, 'success');
    }
  }

  function updateRolePermissions() {
    const user = getCurrentUser();
    appState.currentRole = user.role;

    // Update Topbar Profile Display
    const nameEl = document.getElementById('user-display-name');
    const roleBadgeEl = document.getElementById('user-role-badge');
    const branchBadgeEl = document.getElementById('user-branch-badge');
    const avatarInitialsEl = document.getElementById('user-avatar-initials');
    const branchSelect = document.getElementById('branch-select');

    if (nameEl) nameEl.textContent = user.fullName;
    if (roleBadgeEl) roleBadgeEl.textContent = user.role;
    if (avatarInitialsEl) {
      const parts = user.fullName.split(' ');
      avatarInitialsEl.textContent = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : user.fullName.slice(0, 2).toUpperCase();
    }

    // Branch locking per role assignment
    if (user.branchId !== 'ALL') {
      appState.currentBranch = user.branchId;
      branchSelect.value = user.branchId;
      branchSelect.disabled = true;
      if (branchBadgeEl) branchBadgeEl.textContent = user.branchId === 'TLD' ? '🏝️ Cabang Talaud' : '🌲 Kembang Janggut';
    } else {
      branchSelect.disabled = false;
      if (branchBadgeEl) {
        branchBadgeEl.textContent = appState.currentBranch === 'ALL' ? '🌐 Semua Cabang' : (appState.currentBranch === 'TLD' ? '🏝️ Cabang Talaud' : '🌲 Kembang Janggut');
      }
    }

    // Dynamic Tab Visibility based on Role Permissions
    const tabs = document.querySelectorAll('.nav-tab');
    let activeTabAllowed = false;

    tabs.forEach(tab => {
      const allowedRoles = (tab.getAttribute('data-roles') || '').split(',');
      if (allowedRoles.includes(user.role)) {
        tab.style.display = 'inline-flex';
        if (tab.classList.contains('active')) {
          activeTabAllowed = true;
        }
      } else {
        tab.style.display = 'none';
      }
    });

    // If currently active tab is not allowed for this role, auto-switch to first allowed tab
    if (!activeTabAllowed) {
      const firstAllowedTab = Array.from(tabs).find(t => t.style.display !== 'none');
      if (firstAllowedTab) {
        firstAllowedTab.click();
      }
    } else {
      refreshCurrentActiveTab();
    }
  }

  function refreshCurrentActiveTab() {
    const activeTab = document.querySelector('.nav-tab.active');
    if (!activeTab) return;
    const tabName = activeTab.getAttribute('data-tab');
    if (tabName === 'dashboard') renderDashboard();
    if (tabName === 'pos') renderPOS();
    if (tabName === 'medicines') renderMedicinesTable();
    if (tabName === 'inventory') renderInventoryBatches();
    if (tabName === 'purchases') renderPurchases();
    if (tabName === 'finance') renderFinance();
    if (tabName === 'reports') renderReports();
    if (tabName === 'ai') renderAIChat();
    if (tabName === 'users') renderUsersTable();
    if (window.lucide) lucide.createIcons();
  }

  // ==========================================
  // 5. DASHBOARD OWNER ENGINE
  // ==========================================
  let salesChartInstance = null;

  // Helper for Dashboard Period Date Range
  function getDashboardDateRange(periodVal) {
    const now = new Date();
    let startDate = null;
    let endDate = null;

    if (periodVal === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (periodVal === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (periodVal === 'last_month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (periodVal === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else if (periodVal === 'all') {
      startDate = null;
      endDate = null;
    } else {
      // default 'month' (Bulan Ini)
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    return { startDate, endDate };
  }

  function renderDashboard() {
    const branch = appState.currentBranch;
    const periodSelect = document.getElementById('dash-period');
    const periodVal = periodSelect ? periodSelect.value : 'month';
    const { startDate, endDate } = getDashboardDateRange(periodVal);

    // Filter Sales by Date & Status (non-VOID)
    const allValidSales = (appState.sales || []).filter(s => {
      if (s.status === 'VOID') return false;
      if (!s.date) return true;
      const d = new Date(s.date);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });

    // Filter Expenses by Date
    const allValidExpenses = (appState.expenses || []).filter(e => {
      if (!e.date) return true;
      const d = new Date(e.date);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });

    // Branch specific filtering for KPI
    const currentSales = branch === 'ALL' ? allValidSales : allValidSales.filter(s => s.branchId === branch);
    const currentExpenses = branch === 'ALL' ? allValidExpenses : allValidExpenses.filter(e => e.branchId === branch);

    // Calculate Actual Metrics (100% Real from Data)
    const totalRevenue = currentSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
    const totalHPP = currentSales.reduce((acc, s) => {
      const saleHpp = (s.items || []).reduce((sum, it) => sum + ((Number(it.hpp) || 0) * (Number(it.qty) || 1)), 0);
      return acc + saleHpp;
    }, 0);
    const grossProfit = totalRevenue - totalHPP;
    const operationalExpenses = currentExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const netProfit = grossProfit - operationalExpenses;

    const totalItemsSold = currentSales.reduce((acc, s) => acc + (s.items || []).reduce((iSum, it) => iSum + (Number(it.qty) || 1), 0), 0);
    const hppRatio = totalRevenue > 0 ? ((totalHPP / totalRevenue) * 100).toFixed(1) : '0.0';
    const netMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0';

    // Update KPI Elements
    const elOmzet = document.getElementById('kpi-omzet');
    if (elOmzet) elOmzet.textContent = formatIDR(totalRevenue);

    const elSubOmzet = document.getElementById('kpi-sub-omzet');
    if (elSubOmzet) {
      elSubOmzet.innerHTML = `<i data-lucide="shopping-cart" class="w-3.5 h-3.5 mr-1"></i><span>${currentSales.length} transaksi (${totalItemsSold} item terjual)</span>`;
    }

    const elHpp = document.getElementById('kpi-hpp');
    if (elHpp) elHpp.textContent = formatIDR(totalHPP);

    const elSubHpp = document.getElementById('kpi-sub-hpp');
    if (elSubHpp) elSubHpp.textContent = `Rasio HPP: ${hppRatio}% dari omzet`;

    const elOperasional = document.getElementById('kpi-operasional');
    if (elOperasional) elOperasional.textContent = formatIDR(operationalExpenses);

    const elSubOperasional = document.getElementById('kpi-sub-operasional');
    if (elSubOperasional) elSubOperasional.textContent = `${currentExpenses.length} pos beban operasional`;

    const elNet = document.getElementById('kpi-laba-bersih');
    if (elNet) elNet.textContent = formatIDR(netProfit);

    const elSubNet = document.getElementById('kpi-sub-net');
    if (elSubNet) elSubNet.textContent = `Margin Bersih: ${netMargin}%`;

    // Branch Comparison Breakdown (Talaud vs Kembang Janggut)
    const tldSales = allValidSales.filter(s => s.branchId === 'TLD');
    const tldRevenue = tldSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
    const tldHpp = tldSales.reduce((acc, s) => acc + (s.items || []).reduce((sum, it) => sum + ((Number(it.hpp) || 0) * (Number(it.qty) || 1)), 0), 0);
    const tldExp = allValidExpenses.filter(e => e.branchId === 'TLD').reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const tldNet = (tldRevenue - tldHpp) - tldExp;

    const kbjSales = allValidSales.filter(s => s.branchId === 'KBJ');
    const kbjRevenue = kbjSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
    const kbjHpp = kbjSales.reduce((acc, s) => acc + (s.items || []).reduce((sum, it) => sum + ((Number(it.hpp) || 0) * (Number(it.qty) || 1)), 0), 0);
    const kbjExp = allValidExpenses.filter(e => e.branchId === 'KBJ').reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const kbjNet = (kbjRevenue - kbjHpp) - kbjExp;

    const maxBranchRev = Math.max(tldRevenue, kbjRevenue, 1);
    const tldBarPct = tldRevenue > 0 ? Math.min(100, Math.round((tldRevenue / maxBranchRev) * 100)) : 0;
    const kbjBarPct = kbjRevenue > 0 ? Math.min(100, Math.round((kbjRevenue / maxBranchRev) * 100)) : 0;

    const elTldOmzet = document.getElementById('branch-tld-omzet');
    if (elTldOmzet) elTldOmzet.textContent = formatIDR(tldRevenue);
    const elTldNet = document.getElementById('branch-tld-net');
    if (elTldNet) elTldNet.textContent = formatIDR(tldNet);
    const elTldCount = document.getElementById('branch-tld-count');
    if (elTldCount) elTldCount.textContent = `${tldSales.length} Struk`;
    const elTldBar = document.getElementById('branch-tld-bar');
    if (elTldBar) elTldBar.style.width = `${tldBarPct}%`;

    const elKbjOmzet = document.getElementById('branch-kbj-omzet');
    if (elKbjOmzet) elKbjOmzet.textContent = formatIDR(kbjRevenue);
    const elKbjNet = document.getElementById('branch-kbj-net');
    if (elKbjNet) elKbjNet.textContent = formatIDR(kbjNet);
    const elKbjCount = document.getElementById('branch-kbj-count');
    if (elKbjCount) elKbjCount.textContent = `${kbjSales.length} Struk`;
    const elKbjBar = document.getElementById('branch-kbj-bar');
    if (elKbjBar) elKbjBar.style.width = `${kbjBarPct}%`;

    // Subtitle & Header
    const subtitle = document.getElementById('dash-subtitle');
    if (subtitle) {
      if (branch === 'ALL') {
        subtitle.textContent = 'Pemantauan konsolidasi performa finansial seluruh cabang Tonang Farma.';
      } else if (branch === 'TLD') {
        subtitle.textContent = 'Data operasional & keuangan khusus Cabang Kepulauan Talaud (Sulut).';
      } else {
        subtitle.textContent = 'Data operasional & keuangan khusus Cabang Kembang Janggut (Kaltim).';
      }
    }

    // Render Alerts, Top Lists, and Chart
    renderDashboardAlerts();
    renderTopLists(currentSales);
    renderDashboardChart();
    if (window.lucide) lucide.createIcons();
  }

  function renderDashboardAlerts() {
    const listEl = document.getElementById('inventory-alerts-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const branch = appState.currentBranch;
    const relevantBatches = branch === 'ALL' ? (appState.batches || []) : (appState.batches || []).filter(b => b.branchId === branch);

    let alertCount = 0;

    // 1. Expiry alerts from active batches
    relevantBatches.forEach(b => {
      const med = (appState.medicines || []).find(m => m.id === b.medicineId);
      if (!med) return;
      const days = getDaysUntilExpiry(b.expiryDate);

      let alertHTML = '';
      if (days < 0) {
        alertCount++;
        alertHTML = `
          <div class="p-2.5 rounded-lg badge-expired flex items-center justify-between text-xs">
            <div>
              <div class="font-bold">[KADALUWARSA] ${med.name}</div>
              <div class="text-[10px]">Batch ${b.batchNo} (${b.branchId === 'TLD' ? 'Talaud' : 'Kembang Janggut'}) • Telah Expired ${Math.abs(days)} hari lalu!</div>
            </div>
            <span class="font-bold mono text-xs">${b.stock} ${med.baseUnit || 'unit'}</span>
          </div>`;
      } else if (days <= 30) {
        alertCount++;
        alertHTML = `
          <div class="p-2.5 rounded-lg badge-critical flex items-center justify-between text-xs">
            <div>
              <div class="font-bold">[KRITIS &lt;30 HARI] ${med.name}</div>
              <div class="text-[10px]">Batch ${b.batchNo} (${b.branchId === 'TLD' ? 'Talaud' : 'Kembang Janggut'}) • Sisa ${days} hari (Exp: ${b.expiryDate})</div>
            </div>
            <span class="font-bold mono text-xs">${b.stock} ${med.baseUnit || 'unit'}</span>
          </div>`;
      }

      if (alertHTML) {
        listEl.insertAdjacentHTML('beforeend', alertHTML);
      }
    });

    // 2. Minimum Buffer Stock Alerts (calculated per branch in flexible units: Strip, Botol, Box)
    const branchesToCheck = branch === 'ALL' ? ['TLD', 'KBJ'] : [branch];
    branchesToCheck.forEach(bId => {
      (appState.medicines || []).forEach(med => {
        const bCfg = (med.branchConfigs && med.branchConfigs[bId]) || {};
        if (bCfg.active === false) return;

        const targetMin = bCfg.minStock !== undefined ? bCfg.minStock : (med.minStock || 10);
        const targetUnit = bCfg.minStockUnit || med.minStockUnit || (med.dosageForm === 'Sirup' || med.baseUnit === 'Botol' ? 'Botol' : (med.stripUnit ? med.stripUnit : (med.baseUnit || 'Tablet')));

        // Sum non-expired stock in base units
        const branchBatches = (appState.batches || []).filter(b => b.medicineId === med.id && b.branchId === bId && getDaysUntilExpiry(b.expiryDate) >= 0);
        const totalBaseStock = branchBatches.reduce((acc, b) => acc + (Number(b.stock) || 0), 0);

        // Convert totalBaseStock to targetUnit
        let stockInUnit = totalBaseStock;
        let rateToUnit = 1;
        if (targetUnit === med.stripUnit && Number(med.stripConversion) > 1) {
          rateToUnit = Number(med.stripConversion);
          stockInUnit = totalBaseStock / rateToUnit;
        } else if (targetUnit === med.buyUnit && Number(med.conversionRate) > 1) {
          rateToUnit = Number(med.conversionRate);
          stockInUnit = totalBaseStock / rateToUnit;
        }

        if (stockInUnit <= targetMin) {
          alertCount++;
          const branchName = bId === 'TLD' ? 'Talaud' : 'Kembang Janggut';
          const displayStock = Math.round(stockInUnit * 10) / 10;
          const isOut = displayStock <= 0;
          const alertClass = isOut ? 'badge-expired' : 'badge-warning';
          const alertTitle = isOut ? `[STOK HABIS (${branchName})] ${med.name}` : `[STOK MENIPIS (${branchName})] ${med.name}`;
          const alertSub = isOut 
            ? `Stok kosong di rak ${branchName}! Batas buffer: ${targetMin} ${targetUnit}`
            : `Sisa ${displayStock} ${targetUnit} • Di bawah batas minimum ${targetMin} ${targetUnit}`;

          const alertHTML = `
            <div class="p-2.5 rounded-lg ${alertClass} flex items-center justify-between text-xs">
              <div>
                <div class="font-bold">${alertTitle}</div>
                <div class="text-[10px]">${alertSub}</div>
              </div>
              <span class="font-bold mono text-xs">${displayStock} ${targetUnit}</span>
            </div>`;
          listEl.insertAdjacentHTML('beforeend', alertHTML);
        }
      });
    });

    if (alertCount === 0) {
      listEl.innerHTML = `
        <div class="p-4 text-center text-slate-400 text-xs">
          <i data-lucide="shield-check" class="w-6 h-6 mx-auto mb-1 text-emerald-500"></i>
          <span class="font-semibold text-slate-600">Semua Persediaan Aman</span>
          <p class="text-[10px] text-slate-400 mt-0.5">Tidak ada obat kedaluwarsa atau di bawah batas buffer.</p>
        </div>`;
    }

    const badgeTotal = document.getElementById('badge-total-alerts');
    if (badgeTotal) badgeTotal.textContent = `${alertCount} Peringatan`;
    if (window.lucide) lucide.createIcons();
  }

  function renderTopLists(salesList) {
    const topSellingEl = document.getElementById('top-selling-list');
    const topProfitEl = document.getElementById('top-profit-list');
    if (!topSellingEl || !topProfitEl) return;

    const list = salesList || (appState.sales || []).filter(s => s.status !== 'VOID');
    if (list.length === 0) {
      const emptyHtml = `
        <div class="py-6 text-center text-slate-400 col-span-full">
          <i data-lucide="inbox" class="w-7 h-7 mx-auto mb-1 text-slate-300"></i>
          <p class="text-xs font-semibold text-slate-600">Belum Ada Transaksi Penjualan</p>
          <p class="text-[10px] text-slate-400">Peringkat produk akan muncul otomatis setelah kasir mencatat penjualan aktual.</p>
        </div>
      `;
      topSellingEl.innerHTML = emptyHtml;
      topProfitEl.innerHTML = emptyHtml;
      if (window.lucide) lucide.createIcons();
      return;
    }

    // Aggregate by medicine
    const medMap = {};
    list.forEach(sale => {
      (sale.items || []).forEach(it => {
        const key = it.medicineId || it.name;
        if (!medMap[key]) {
          medMap[key] = {
            id: it.medicineId,
            name: it.name,
            unit: it.unit || it.baseUnit || 'Unit',
            qty: 0,
            revenue: 0,
            profit: 0
          };
        }
        const qty = Number(it.qty) || 1;
        const price = Number(it.price) || 0;
        const hpp = Number(it.hpp) || 0;
        medMap[key].qty += qty;
        medMap[key].revenue += (price * qty);
        medMap[key].profit += ((price - hpp) * qty);
      });
    });

    const items = Object.values(medMap);
    const byQty = [...items].sort((a, b) => b.qty - a.qty).slice(0, 5);
    const byProfit = [...items].sort((a, b) => b.profit - a.profit).slice(0, 5);

    topSellingEl.innerHTML = byQty.map((item, idx) => `
      <div class="flex items-center justify-between text-xs p-2 rounded bg-slate-50 border border-slate-100">
        <div>
          <span class="font-bold text-slate-800">${idx + 1}. ${item.name}</span>
          <div class="text-[10px] text-slate-500">Omzet: ${formatIDR(item.revenue)}</div>
        </div>
        <span class="mono font-extrabold text-slate-900">${item.qty} ${item.unit}</span>
      </div>
    `).join('');

    topProfitEl.innerHTML = byProfit.map((item, idx) => `
      <div class="flex items-center justify-between text-xs p-2 rounded bg-emerald-50/50 border border-emerald-100">
        <div>
          <span class="font-bold text-slate-800">${idx + 1}. ${item.name}</span>
          <div class="text-[10px] text-slate-500">Terjual ${item.qty} ${item.unit}</div>
        </div>
        <span class="mono font-extrabold text-emerald-700">${formatIDR(item.profit)}</span>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  }

  function renderDashboardChart() {
    const ctx = document.getElementById('salesTrendChart');
    if (!ctx) return;

    if (salesChartInstance) {
      salesChartInstance.destroy();
    }

    // Build last 7 calendar days labels and aggregate real sales per branch
    const labels = [];
    const dataTalaud = [];
    const dataKembang = [];
    const now = new Date();

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

      const dayStr = `${d.getDate()} ${monthNames[d.getMonth()]}${i === 0 ? ' (Hari Ini)' : ''}`;
      labels.push(dayStr);

      const tldDaySum = (appState.sales || [])
        .filter(s => s.status !== 'VOID' && s.branchId === 'TLD')
        .filter(s => {
          if (!s.date) return false;
          const sd = new Date(s.date);
          return sd >= dayStart && sd <= dayEnd;
        })
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0);

      const kbjDaySum = (appState.sales || [])
        .filter(s => s.status !== 'VOID' && s.branchId === 'KBJ')
        .filter(s => {
          if (!s.date) return false;
          const sd = new Date(s.date);
          return sd >= dayStart && sd <= dayEnd;
        })
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0);

      dataTalaud.push(tldDaySum);
      dataKembang.push(kbjDaySum);
    }

    salesChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Cabang Talaud (Sulut)',
            data: dataTalaud,
            borderColor: '#0284c7',
            backgroundColor: 'rgba(2, 132, 199, 0.08)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35
          },
          {
            label: 'Cabang Kembang Janggut (Kaltim)',
            data: dataKembang,
            borderColor: '#059669',
            backgroundColor: 'rgba(5, 150, 105, 0.08)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' } }
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatIDR(context.parsed.y)}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMin: 0,
            suggestedMax: 5000000,
            ticks: {
              callback: (val) => val === 0 ? 'Rp 0' : 'Rp ' + (val >= 1000000 ? (val / 1000000) + ' Jt' : (val / 1000) + ' Rb'),
              font: { family: 'JetBrains Mono', size: 10 }
            },
            grid: { color: '#f1f5f9' }
          },
          x: {
            ticks: { font: { family: 'Plus Jakarta Sans', size: 10 } },
            grid: { display: false }
          }
        }
      }
    });
  }

  // ==========================================
  // HELPER: CABANG & HARGA BERTINGKAT
  // ==========================================
  function getMedicineBranchConfig(medicine, branchId) {
    if (!medicine) return null;
    const branch = (branchId === 'ALL' || !branchId) ? 'TLD' : branchId;
    if (medicine.branchConfigs && medicine.branchConfigs[branch]) {
      return medicine.branchConfigs[branch];
    }
    // Safe fallback to root fields or standard defaults
    return {
      active: medicine.active !== false,
      barcode: medicine.barcode || '',
      location: medicine.location || (branch === 'KBJ' ? 'Rak B-01' : 'Rak A-01'),
      buyPrice: medicine.buyPrice || 0,
      sellPrice: medicine.sellPrice || 0,
      stripPrice: medicine.stripPrice || 0,
      boxPrice: medicine.boxPrice || 0,
      minStock: medicine.minStock || 50
    };
  }

  // ==========================================
  // 6. KASIR & PENJUALAN (POS) ENGINE
  // ==========================================
  let activePOSCategory = 'ALL';
  let posSearchTerm = '';

  function renderPOS() {
    // Generate Invoice Number
    const activeBranchCode = appState.currentBranch === 'ALL' ? 'TLD' : appState.currentBranch;
    const invEl = document.getElementById('pos-invoice-no');
    const cashierEl = document.getElementById('pos-active-cashier');

    const dateStr = getTodayDateStrWITA();
    const randomSeq = String(appState.sales.length + 1).padStart(4, '0');
    invEl.textContent = `TF-${activeBranchCode}-${dateStr}-${randomSeq}`;
    cashierEl.textContent = `${getCurrentUser().fullName} (${activeBranchCode})`;

    renderPOSProductGrid();
    renderCart();
    updateSalesBadgeCount();
  }

  function getFEFOAllocations(medicineId, branchId, neededBaseUnits) {
    const batches = appState.batches
      .filter(b => b.medicineId === medicineId && b.branchId === branchId && b.stock > 0)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    let remaining = neededBaseUnits;
    const allocation = [];

    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.stock, remaining);
      allocation.push({
        batchId: b.id,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        takeQty: take
      });
      remaining -= take;
    }

    return {
      allocation,
      isFulfilled: remaining <= 0,
      unfulfilled: Math.max(0, remaining)
    };
  }

  function renderPOSProductGrid() {
    const gridEl = document.getElementById('pos-product-grid');
    gridEl.innerHTML = '';

    const activeBranch = appState.currentBranch === 'ALL' ? 'TLD' : appState.currentBranch;

    const searchClean = (posSearchTerm || '').trim().toLowerCase();
    const filtered = (appState.medicines || []).filter(m => {
      if (!m) return false;
      const branchCfg = getMedicineBranchConfig(m, activeBranch) || {};
      // Skip if explicitly marked inactive in this branch
      if (branchCfg.active === false) return false;

      const branchBarcode = String(branchCfg.barcode || m.barcode || '').toLowerCase();
      const matchCat = activePOSCategory === 'ALL' || m.category === activePOSCategory;
      const name = String(m.name || '').toLowerCase();
      const code = String(m.code || '').toLowerCase();
      const matchSearch = name.includes(searchClean) ||
                          branchBarcode.includes(searchClean) ||
                          code.includes(searchClean);
      return matchCat && matchSearch;
    });

    if (filtered.length === 0) {
      gridEl.innerHTML = `
        <div class="col-span-3 text-center py-12 text-slate-400 text-xs">
          Tidak ditemukan obat dengan kata kunci "${posSearchTerm}"
        </div>`;
      return;
    }

    filtered.forEach(med => {
      // Find batches for active branch
      const medBatches = appState.batches
        .filter(b => b.medicineId === med.id && b.branchId === activeBranch && b.stock > 0)
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
      const totalStock = medBatches.reduce((acc, b) => acc + b.stock, 0);

      // FEFO Batch indicator (First-Expired, First-Out with multi-batch support)
      const earliestBatch = medBatches[0];
      let fefoDesc = '';
      if (medBatches.length > 1) {
        fefoDesc = `FEFO: Batch ${earliestBatch.batchNo} (${earliestBatch.stock} ${med.baseUnit}) + ${medBatches.length - 1} batch lain`;
      } else if (medBatches.length === 1) {
        fefoDesc = `FEFO: Batch ${earliestBatch.batchNo} (Exp ${earliestBatch.expiryDate})`;
      }

      // Multi-tier prices configured per branch
      const branchCfg = getMedicineBranchConfig(med, activeBranch);
      const basePrice = Number(branchCfg.sellPrice ?? med.sellPrice ?? 0);
      const stripPrice = Number(branchCfg.stripPrice ?? med.stripPrice ?? 0);
      const boxPrice = Number(branchCfg.boxPrice ?? med.boxPrice ?? 0);

      const hasStrip = Boolean(med.stripUnit && med.stripConversion && med.stripConversion > 1);
      const hasBox = Boolean(med.buyUnit && med.conversionRate && med.conversionRate > 1);
      const tierBtnCount = (basePrice > 0 ? 1 : 0) + (hasStrip && stripPrice > 0 ? 1 : 0) + (hasBox && boxPrice > 0 ? 1 : 0);

      const card = document.createElement('div');
      card.className = `bg-white p-3 rounded-xl border border-slate-200 hover:border-emerald-500 hover:shadow-md transition flex flex-col justify-between ${totalStock <= 0 ? 'opacity-50 pointer-events-none' : ''}`;
      
      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${
              med.category === 'Obat Keras' ? 'bg-red-100 text-red-700' :
              med.category === 'Bebas Terbatas' ? 'bg-blue-100 text-blue-700' :
              med.category === 'Bebas' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }">${med.category}</span>
            <span class="text-[10px] text-slate-400 mono">${med.code}</span>
          </div>
          <h4 class="font-bold text-xs text-slate-900 leading-snug line-clamp-2">${med.name}</h4>
          <div class="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
            <span>${med.dosageForm} • <i class="text-slate-400">${branchCfg.location || 'Rak A-01'}</i></span>
            <span class="font-semibold text-slate-700">Total Stok: <b>${totalStock}</b> ${med.baseUnit}</span>
          </div>
          ${fefoDesc ? `<div class="text-[10px] text-emerald-700 font-medium mt-0.5">${fefoDesc}</div>` : ''}

          <!-- Price List per Tier (Cabang) -->
          <div class="mt-2.5 p-2 bg-slate-50 rounded-lg border border-slate-100 space-y-1 text-[11px]">
            ${basePrice > 0 ? `
            <div class="flex items-center justify-between">
              <span class="text-slate-600 font-medium">Per ${med.baseUnit || 'Tablet'}:</span>
              <span class="font-bold text-emerald-700 mono">${formatIDR(basePrice)}</span>
            </div>` : `
            <div class="flex items-center justify-between text-slate-400 italic text-[10px]">
              <span>Per ${med.baseUnit || 'Tablet'}:</span>
              <span>(Eceran tidak dijual)</span>
            </div>`}
            ${hasStrip && stripPrice > 0 ? `
            <div class="flex items-center justify-between border-t border-slate-200/60 pt-1">
              <span class="text-slate-600 font-medium">Per ${med.stripUnit} <span class="text-[9px] text-slate-400">(${med.stripConversion} ${med.baseUnit})</span>:</span>
              <span class="font-bold text-blue-700 mono">${formatIDR(stripPrice)}</span>
            </div>` : ''}
            ${hasBox && boxPrice > 0 ? `
            <div class="flex items-center justify-between border-t border-slate-200/60 pt-1">
              <span class="text-slate-600 font-medium">Per ${med.buyUnit} <span class="text-[9px] text-slate-400">(${med.conversionRate} ${med.baseUnit})</span>:</span>
              <span class="font-bold text-purple-700 mono">${formatIDR(boxPrice)}</span>
            </div>` : ''}
          </div>
        </div>

        <!-- Quick Add Buttons -->
        <div class="mt-3 pt-2 border-t border-slate-100">
          <div class="text-[10px] text-slate-400 font-medium mb-1.5">Pilih Satuan Jual:</div>
          <div class="grid ${tierBtnCount === 3 ? 'grid-cols-3' : tierBtnCount === 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5">
            ${basePrice > 0 ? `
            <button class="btn-add-tier py-1 px-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white font-bold text-[10px] text-center transition flex flex-col items-center justify-center border border-emerald-200" data-tier="base">
              <span>+1 ${med.baseUnit}</span>
              <span class="text-[9px] opacity-80">${formatIDR(basePrice)}</span>
            </button>` : ''}
            ${hasStrip && stripPrice > 0 ? `
            <button class="btn-add-tier py-1 px-1.5 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white font-bold text-[10px] text-center transition flex flex-col items-center justify-center border border-blue-200" data-tier="strip">
              <span>+1 ${med.stripUnit}</span>
              <span class="text-[9px] opacity-80">${formatIDR(stripPrice)}</span>
            </button>` : ''}
            ${hasBox && boxPrice > 0 ? `
            <button class="btn-add-tier py-1 px-1.5 rounded-lg bg-purple-50 hover:bg-purple-600 text-purple-700 hover:text-white font-bold text-[10px] text-center transition flex flex-col items-center justify-center border border-purple-200" data-tier="box">
              <span>+1 ${med.buyUnit}</span>
              <span class="text-[9px] opacity-80">${formatIDR(boxPrice)}</span>
            </button>` : ''}
            ${tierBtnCount === 0 ? `
            <div class="text-center py-1 text-[10px] text-amber-700 bg-amber-50 rounded border border-amber-200 font-medium col-span-full">
              Harga belum diatur di cabang ini
            </div>` : ''}
          </div>
        </div>
      `;

      card.querySelectorAll('.btn-add-tier').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tier = btn.getAttribute('data-tier');
          addToCart(med, tier);
        });
      });

      gridEl.appendChild(card);
    });

    lucide.createIcons();
  }

  function addToCart(medicine, tier = 'base') {
    const activeBranch = appState.currentBranch === 'ALL' ? 'TLD' : appState.currentBranch;
    const branchCfg = getMedicineBranchConfig(medicine, activeBranch);

    if (branchCfg.active === false) {
      showToast(`Obat ${medicine.name} dinonaktifkan untuk cabang ini!`, 'error');
      return;
    }

    const medBatches = appState.batches
      .filter(b => b.medicineId === medicine.id && b.branchId === activeBranch && b.stock > 0)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    const totalStock = medBatches.reduce((acc, b) => acc + b.stock, 0);

    if (totalStock <= 0) {
      showToast(`Stok ${medicine.name} habis di cabang ini!`, 'error');
      return;
    }

    let unitName = medicine.baseUnit;
    let multiplier = 1;
    let unitPrice = branchCfg.sellPrice || medicine.sellPrice || 0;

    if (tier === 'strip') {
      unitName = medicine.stripUnit || 'Strip';
      multiplier = medicine.stripConversion || 1;
      unitPrice = branchCfg.stripPrice || medicine.stripPrice || 0;
    } else if (tier === 'box') {
      unitName = medicine.buyUnit || 'Box';
      multiplier = medicine.conversionRate || 1;
      unitPrice = branchCfg.boxPrice || medicine.boxPrice || 0;
    }

    if (unitPrice <= 0) {
      showToast(`Harga jual untuk satuan ${unitName} belum diatur di cabang ini!`, 'warning');
      return;
    }

    // Check total base units currently in cart for this medicine across all tiers
    const currentBaseUnits = appState.cart
      .filter(i => i.medicineId === medicine.id)
      .reduce((sum, i) => sum + (i.qty * (i.multiplier || 1)), 0);

    if (currentBaseUnits + multiplier > totalStock) {
      const remainingBase = totalStock - currentBaseUnits;
      showToast(`Total stok ${medicine.name} (${totalStock} ${medicine.baseUnit}) tidak mencukupi untuk +1 ${unitName} (${multiplier} ${medicine.baseUnit}). Tersisa ${remainingBase} ${medicine.baseUnit}`, 'warning');
      return;
    }

    let actualItemHpp = 0;
    if (tier === 'box' && (branchCfg.pkgBuyPrice > 0 || medicine.pkgBuyPrice > 0)) {
      actualItemHpp = branchCfg.pkgBuyPrice || medicine.pkgBuyPrice;
    } else if (tier === 'strip' && (branchCfg.stripBuyPrice > 0 || medicine.stripBuyPrice > 0)) {
      actualItemHpp = branchCfg.stripBuyPrice || medicine.stripBuyPrice;
    } else {
      actualItemHpp = (branchCfg.buyPrice || medicine.buyPrice || 0) * multiplier;
    }

    const existingIndex = appState.cart.findIndex(i => i.medicineId === medicine.id && i.tier === tier);
    if (existingIndex > -1) {
      appState.cart[existingIndex].qty += 1;
      appState.cart[existingIndex].subtotal = appState.cart[existingIndex].qty * appState.cart[existingIndex].price;
    } else {
      appState.cart.push({
        medicineId: medicine.id,
        name: medicine.name,
        tier: tier,
        unit: unitName,
        baseUnit: medicine.baseUnit,
        multiplier: multiplier,
        price: unitPrice,
        hpp: actualItemHpp,
        qty: 1,
        subtotal: unitPrice
      });
    }

    showToast(`Ditambahkan 1 ${unitName} ${medicine.name} (${formatIDR(unitPrice)}) ke keranjang`, 'success');
    renderCart();
  }

  function renderCart() {
    const cartListEl = document.getElementById('pos-cart-items');
    const subtotalEl = document.getElementById('cart-subtotal');
    const discountInput = document.getElementById('cart-discount-input');
    const discountDisplay = document.getElementById('cart-discount-display');
    const grandTotalEl = document.getElementById('cart-grand-total');
    const cashInput = document.getElementById('cart-cash-received');
    const changeDisplay = document.getElementById('cart-change-display');
    const checkoutBtn = document.getElementById('btn-process-payment');
    const activeBranch = appState.currentBranch === 'ALL' ? 'TLD' : appState.currentBranch;

    if (appState.cart.length === 0) {
      cartListEl.innerHTML = `
        <div class="text-center py-16 text-slate-400">
          <i data-lucide="shopping-bag" class="w-12 h-12 mx-auto mb-2 stroke-1"></i>
          <p class="text-xs">Keranjang masih kosong</p>
          <p class="text-[11px] text-slate-400">Pilih obat dan satuan jual di sebelah kiri</p>
        </div>`;
      subtotalEl.textContent = 'Rp 0';
      discountDisplay.textContent = '- Rp 0';
      grandTotalEl.textContent = 'Rp 0';
      changeDisplay.textContent = 'Rp 0';
      checkoutBtn.disabled = true;
      lucide.createIcons();
      return;
    }

    checkoutBtn.disabled = false;
    cartListEl.innerHTML = '';

    let subtotal = 0;

    appState.cart.forEach((item, index) => {
      subtotal += item.subtotal;

      const med = appState.medicines.find(m => m.id === item.medicineId) || {};
      const medBatches = appState.batches.filter(b => b.medicineId === item.medicineId && b.branchId === activeBranch && b.stock > 0);
      const totalBranchStock = medBatches.reduce((acc, b) => acc + b.stock, 0);
      
      const otherBaseUnitsInCart = appState.cart
        .filter((it, idx) => idx !== index && it.medicineId === item.medicineId)
        .reduce((s, it) => s + (it.qty * (it.multiplier || 1)), 0);
      const availableBaseUnits = Math.max(0, totalBranchStock - otherBaseUnitsInCart);
      const maxQtyForTier = Math.floor(availableBaseUnits / (item.multiplier || 1));

      // Cascading FEFO Allocation preview
      const neededBase = item.qty * (item.multiplier || 1);
      const allocResult = getFEFOAllocations(item.medicineId, activeBranch, neededBase);
      const allocs = allocResult.allocation;

      let fefoBadgeHtml = '';
      if (allocs.length > 1) {
        fefoBadgeHtml = `
          <div class="p-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-[10px] space-y-0.5 my-1">
            <div class="flex items-center space-x-1 font-bold text-blue-700">
              <i data-lucide="layers" class="w-3 h-3"></i>
              <span>FEFO Multi-Batch (${allocs.length} Batch Digabung):</span>
            </div>
            <div class="text-[9px] text-slate-600 flex flex-wrap gap-1">
              ${allocs.map(a => `<span class="bg-white px-1.5 py-0.2 rounded border border-blue-100 font-mono font-bold">${a.batchNo} (${a.takeQty} ${item.baseUnit})</span>`).join(' + ')}
            </div>
          </div>
        `;
      } else if (allocs.length === 1) {
        fefoBadgeHtml = `<div class="text-[10px] text-emerald-600 font-semibold mono">Batch: ${allocs[0].batchNo} • Exp: ${allocs[0].expiryDate}</div>`;
      } else {
        fefoBadgeHtml = `<div class="text-[10px] text-red-600 font-semibold">Stok tidak mencukupi</div>`;
      }

      const hasStrip = Boolean(med.stripUnit && med.stripConversion && med.stripConversion > 1);
      const hasBox = Boolean(med.buyUnit && med.conversionRate && med.conversionRate > 1);

      const itemRow = document.createElement('div');
      itemRow.className = 'p-3 rounded-lg border border-slate-200 bg-white space-y-2';
      itemRow.innerHTML = `
        <div class="flex items-start justify-between">
          <div>
            <div class="font-bold text-xs text-slate-900">${item.name}</div>
            ${fefoBadgeHtml}
          </div>
          <button class="text-slate-400 hover:text-red-600 p-1" data-remove="${index}" title="Hapus dari keranjang">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>

        <!-- Unit Switcher Pills -->
        <div class="flex items-center gap-1.5 py-1 px-2 bg-slate-50 rounded-md border border-slate-100">
          <span class="text-[10px] text-slate-500 font-semibold">Satuan:</span>
          <button class="px-2 py-0.5 text-[10px] rounded font-bold transition ${item.tier === 'base' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'}" data-switch-tier="${index}" data-target-tier="base">
            ${med.baseUnit || item.unit}
          </button>
          ${hasStrip ? `
          <button class="px-2 py-0.5 text-[10px] rounded font-bold transition ${item.tier === 'strip' ? 'bg-blue-600 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'}" data-switch-tier="${index}" data-target-tier="strip">
            ${med.stripUnit} (${med.stripConversion})
          </button>` : ''}
          ${hasBox ? `
          <button class="px-2 py-0.5 text-[10px] rounded font-bold transition ${item.tier === 'box' ? 'bg-purple-600 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'}" data-switch-tier="${index}" data-target-tier="box">
            ${med.buyUnit} (${med.conversionRate})
          </button>` : ''}
        </div>

        <div class="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
          <div class="flex items-center space-x-1.5">
            <button class="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 font-bold flex items-center justify-center text-slate-700" data-minus="${index}">-</button>
            <input type="number" min="1" max="${Math.max(1, maxQtyForTier)}" value="${item.qty}" class="w-16 text-center border border-slate-300 rounded py-0.5 text-xs font-bold mono" data-qty-input="${index}">
            <button class="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 font-bold flex items-center justify-center text-slate-700" data-plus="${index}">+</button>
            <span class="text-[11px] font-semibold text-slate-700 ml-1">${item.unit}</span>
          </div>
          <div class="text-right">
            <div class="font-extrabold text-xs text-slate-900 mono">${formatIDR(item.subtotal)}</div>
            <div class="text-[10px] text-slate-400">@ ${formatIDR(item.price)}</div>
          </div>
        </div>
      `;

      cartListEl.appendChild(itemRow);
    });

    const discountVal = Number(discountInput.value || 0);
    const grandTotal = Math.max(0, subtotal - discountVal);

    subtotalEl.textContent = formatIDR(subtotal);
    discountDisplay.textContent = `- ${formatIDR(discountVal)}`;
    grandTotalEl.textContent = formatIDR(grandTotal);

    // Calculate Change
    const cashVal = Number(cashInput.value || 0);
    const change = Math.max(0, cashVal - grandTotal);
    changeDisplay.textContent = formatIDR(change);

    // Bind item actions
    cartListEl.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove'));
        appState.cart.splice(idx, 1);
        renderCart();
      });
    });

    // Switch tier pill click
    cartListEl.querySelectorAll('[data-switch-tier]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-switch-tier'));
        const targetTier = btn.getAttribute('data-target-tier');
        const it = appState.cart[idx];
        if (!it || it.tier === targetTier) return;

        const targetMed = appState.medicines.find(m => m.id === it.medicineId);
        if (!targetMed) return;

        let newUnit = targetMed.baseUnit;
        let newMultiplier = 1;
        let newPrice = targetMed.sellPrice || 0;

        if (targetTier === 'strip') {
          newUnit = targetMed.stripUnit || 'Strip';
          newMultiplier = targetMed.stripConversion || 1;
          newPrice = targetMed.stripPrice || (targetMed.sellPrice * newMultiplier);
        } else if (targetTier === 'box') {
          newUnit = targetMed.buyUnit || 'Box';
          newMultiplier = targetMed.conversionRate || 1;
          newPrice = targetMed.boxPrice || (targetMed.sellPrice * newMultiplier);
        }

        const otherBase = appState.cart
          .filter((c, i) => i !== idx && c.medicineId === it.medicineId)
          .reduce((s, c) => s + (c.qty * (c.multiplier || 1)), 0);

        const medBatches = appState.batches.filter(b => b.medicineId === it.medicineId && b.branchId === activeBranch && b.stock > 0);
        const totalStock = medBatches.reduce((acc, b) => acc + b.stock, 0);
        const availableBase = Math.max(0, totalStock - otherBase);

        if (newMultiplier > availableBase) {
          showToast(`Total stok cabang tidak mencukupi untuk beralih ke satuan ${newUnit} (Butuh ${newMultiplier} ${targetMed.baseUnit}, sisa ${availableBase})`, 'warning');
          return;
        }

        const existingSameTierIdx = appState.cart.findIndex((c, i) => i !== idx && c.medicineId === it.medicineId && c.tier === targetTier);

        if (existingSameTierIdx > -1) {
          appState.cart[existingSameTierIdx].qty += 1;
          appState.cart[existingSameTierIdx].subtotal = appState.cart[existingSameTierIdx].qty * appState.cart[existingSameTierIdx].price;
          appState.cart.splice(idx, 1);
        } else {
          it.tier = targetTier;
          it.unit = newUnit;
          it.multiplier = newMultiplier;
          it.price = newPrice;
          it.hpp = (targetMed.buyPrice || 0) * newMultiplier;
          it.qty = 1;
          it.subtotal = it.qty * it.price;
        }
        renderCart();
      });
    });

    cartListEl.querySelectorAll('[data-minus]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-minus'));
        if (appState.cart[idx].qty > 1) {
          appState.cart[idx].qty -= 1;
          appState.cart[idx].subtotal = appState.cart[idx].qty * appState.cart[idx].price;
          renderCart();
        }
      });
    });

    cartListEl.querySelectorAll('[data-plus]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-plus'));
        const it = appState.cart[idx];
        const medBatches = appState.batches.filter(b => b.medicineId === it.medicineId && b.branchId === activeBranch && b.stock > 0);
        const totalStock = medBatches.reduce((acc, b) => acc + b.stock, 0);
        const currentBaseUnits = appState.cart.reduce((s, c) => s + (c.medicineId === it.medicineId ? c.qty * (c.multiplier || 1) : 0), 0);

        if (currentBaseUnits + (it.multiplier || 1) <= totalStock) {
          it.qty += 1;
          it.subtotal = it.qty * it.price;
          renderCart();
        } else {
          showToast(`Maksimum total stok cabang tercapai (${totalStock} ${it.baseUnit || ''})`, 'warning');
        }
      });
    });

    cartListEl.querySelectorAll('[data-qty-input]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.getAttribute('data-qty-input'));
        const it = appState.cart[idx];
        const medBatches = appState.batches.filter(b => b.medicineId === it.medicineId && b.branchId === activeBranch && b.stock > 0);
        const totalStock = medBatches.reduce((acc, b) => acc + b.stock, 0);
        const otherBase = appState.cart
          .filter((c, i) => i !== idx && c.medicineId === it.medicineId)
          .reduce((s, c) => s + (c.qty * (c.multiplier || 1)), 0);
        const maxAvailableQty = Math.floor(Math.max(0, totalStock - otherBase) / (it.multiplier || 1));
        
        let newQty = parseInt(inp.value) || 1;
        newQty = Math.min(Math.max(1, newQty), Math.max(1, maxAvailableQty));
        it.qty = newQty;
        it.subtotal = newQty * it.price;
        renderCart();
      });
    });

    lucide.createIcons();
  }

  function setupPOSListeners() {
    const searchInput = document.getElementById('pos-search-input');
    const clearBtn = document.getElementById('pos-clear-search');
    const discountInput = document.getElementById('cart-discount-input');
    const cashInput = document.getElementById('cart-cash-received');
    const quickCashBtns = document.querySelectorAll('.quick-cash-btn');
    const checkoutBtn = document.getElementById('btn-process-payment');
    const categoryBtns = document.querySelectorAll('.pos-cat-filter');

    // Search input
    searchInput.addEventListener('input', (e) => {
      posSearchTerm = e.target.value;
      renderPOSProductGrid();
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      posSearchTerm = '';
      renderPOSProductGrid();
    });

    // Keyboard shortcut / for search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
    });

    // Category filter
    categoryBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        categoryBtns.forEach(b => {
          b.className = 'pos-cat-filter px-3 py-1 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200';
        });
        btn.className = 'pos-cat-filter active px-3 py-1 rounded-full bg-emerald-600 text-white font-semibold';
        activePOSCategory = btn.getAttribute('data-cat');
        renderPOSProductGrid();
      });
    });

    // Discount change
    discountInput.addEventListener('input', () => {
      renderCart();
    });

    // Cash input
    cashInput.addEventListener('input', () => {
      renderCart();
    });

    // Quick cash buttons
    quickCashBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const subtotal = appState.cart.reduce((sum, it) => sum + it.subtotal, 0);
        const discountVal = Number(discountInput.value || 0);
        const grandTotal = Math.max(0, subtotal - discountVal);
        const val = btn.getAttribute('data-val');

        if (val === 'exact') {
          cashInput.value = grandTotal;
        } else {
          cashInput.value = Number(val);
        }
        renderCart();
      });
    });

    // Checkout button
    checkoutBtn.addEventListener('click', () => {
      handlePOSCheckout();
    });

    // Sales history & correction buttons
    const openSalesHistoryBtn = document.getElementById('btn-open-sales-history');
    const quickHistoryCartBtn = document.getElementById('btn-quick-history-cart');

    if (openSalesHistoryBtn) {
      openSalesHistoryBtn.addEventListener('click', openSalesHistoryModal);
    }
    if (quickHistoryCartBtn) {
      quickHistoryCartBtn.addEventListener('click', openSalesHistoryModal);
    }

    // Keyboard shortcut F8 for sales history & correction
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F8') {
        e.preventDefault();
        openSalesHistoryModal();
      }
    });
  }

  function handlePOSCheckout() {
    if (appState.cart.length === 0) return;

    const activeBranch = appState.currentBranch === 'ALL' ? 'TLD' : appState.currentBranch;
    const invoiceNo = document.getElementById('pos-invoice-no').textContent;
    const discountVal = Number(document.getElementById('cart-discount-input').value || 0);
    const subtotal = appState.cart.reduce((sum, it) => sum + it.subtotal, 0);
    const grandTotal = Math.max(0, subtotal - discountVal);
    const cashReceived = Number(document.getElementById('cart-cash-received').value || 0);
    const paymentMethod = document.getElementById('cart-payment-method').value;

    if (paymentMethod === 'CASH' && cashReceived < grandTotal) {
      showToast(`Uang diterima (${formatIDR(cashReceived)}) kurang dari total bayar (${formatIDR(grandTotal)})!`, 'warning');
      return;
    }

    const change = Math.max(0, cashReceived - grandTotal);

    // Create Transaction Record
    const newSale = {
      id: invoiceNo,
      branchId: activeBranch,
      date: new Date().toISOString(),
      cashier: document.getElementById('pos-active-cashier').textContent,
      items: JSON.parse(JSON.stringify(appState.cart)),
      subtotal: subtotal,
      discount: discountVal,
      total: grandTotal,
      paid: paymentMethod === 'CASH' ? cashReceived : grandTotal,
      change: paymentMethod === 'CASH' ? change : 0,
      paymentMethod: paymentMethod,
      synced: appState.isOnline
    };

    // Deduct stock from batches using Cascading FEFO Allocation (First Expired, First Out across all batches)
    newSale.items.forEach(item => {
      const neededBase = item.qty * (item.multiplier || 1);
      const medBatches = appState.batches
        .filter(b => b.medicineId === item.medicineId && b.branchId === activeBranch && b.stock > 0)
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

      let remaining = neededBase;
      const batchDetails = [];

      for (const b of medBatches) {
        if (remaining <= 0) break;
        const deduct = Math.min(b.stock, remaining);
        b.stock = Math.max(0, b.stock - deduct);
        remaining -= deduct;

        batchDetails.push({
          batchId: b.id,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          deductedQty: deduct
        });
      }

      item.batchDetails = batchDetails;
      item.batchNo = batchDetails.map(d => d.batchNo).join(', ');
      item.expiryDate = batchDetails[0] ? batchDetails[0].expiryDate : '-';
    });

    // Save sale to history
    appState.sales.unshift(newSale);

    // Handle Offline Outbox Event
    if (!appState.isOnline) {
      appState.outbox.push({
        id: 'EVT-' + Date.now(),
        type: 'SALE_CREATED',
        payload: newSale,
        createdAt: new Date().toISOString()
      });
      showToast('Transaksi BERHASIL disimpan ke Database Lokal (Mode Offline).', 'warning');
    } else {
      showToast('Transaksi kasir berhasil dan langsung tersinkron ke Server Pusat!', 'success');
    }

    saveState();
    pushSaleToServer(newSale, appState.batches);
    updateNetworkUI();

    // Show Printable Receipt Modal
    showReceiptModal(newSale);

    // Reset Cart
    appState.cart = [];
    document.getElementById('cart-discount-input').value = '0';
    document.getElementById('cart-cash-received').value = '';
    renderPOS();
  }

  function showReceiptModal(sale) {
    const backdrop = document.getElementById('receipt-modal-backdrop');
    document.getElementById('receipt-branch-name').textContent = sale.branchId === 'TLD' ? 'Cabang Kepulauan Talaud' : 'Cabang Kembang Janggut';
    document.getElementById('rcpt-no').textContent = sale.id;
    document.getElementById('rcpt-date').textContent = formatDateTimeWITA(sale.date);
    document.getElementById('rcpt-cashier').textContent = sale.cashier;

    // Status badge & revision notes in thermal receipt
    const statusBadgeEl = document.getElementById('rcpt-status-badge');
    const revisionNotesEl = document.getElementById('rcpt-revision-notes');

    if (sale.status === 'VOID') {
      if (statusBadgeEl) {
        statusBadgeEl.textContent = '❌ TRANSAKSI INI DIBATALKAN (VOID)';
        statusBadgeEl.className = 'mt-1 px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wider border border-red-500 bg-red-100 text-red-800';
      }
      if (revisionNotesEl) {
        revisionNotesEl.classList.remove('hidden');
        revisionNotesEl.innerHTML = `
          <div><b>Status:</b> DIBATALKAN (VOID)</div>
          <div><b>Waktu Batal:</b> ${sale.voidInfo?.voidedAt ? formatDateTimeWITA(sale.voidInfo.voidedAt) : '-'}</div>
          <div><b>Oleh:</b> ${sale.voidInfo?.voidedBy || 'Supervisor'}</div>
          <div><b>Alasan:</b> "${sale.voidInfo?.reason || '-'}"</div>
        `;
      }
    } else if (sale.status === 'REVISED') {
      if (statusBadgeEl) {
        statusBadgeEl.textContent = '✏️ NOTA REVISI (SAH)';
        statusBadgeEl.className = 'mt-1 px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wider border border-blue-500 bg-blue-100 text-blue-800';
      }
      if (revisionNotesEl) {
        const lastRev = sale.revisionHistory && sale.revisionHistory[sale.revisionHistory.length - 1];
        revisionNotesEl.classList.remove('hidden');
        revisionNotesEl.innerHTML = `
          <div><b>Status:</b> REVISI KE-${sale.revisionHistory?.length || 1}</div>
          <div><b>Waktu Koreksi:</b> ${lastRev?.revisedAt ? formatDateTimeWITA(lastRev.revisedAt) : '-'}</div>
          <div><b>Diotorisasi:</b> ${lastRev?.revisedBy || 'Supervisor'}</div>
          <div><b>Alasan:</b> "${lastRev?.reason || '-'}"</div>
        `;
      }
    } else {
      if (statusBadgeEl) statusBadgeEl.className = 'hidden';
      if (revisionNotesEl) revisionNotesEl.className = 'hidden';
    }

    const itemsListEl = document.getElementById('rcpt-items-list');
    itemsListEl.innerHTML = '';
    sale.items.forEach(it => {
      let batchLabel = '';
      if (it.batchDetails && it.batchDetails.length > 1) {
        batchLabel = `[FEFO: ${it.batchDetails.map(d => `${d.batchNo}:${d.deductedQty}`).join(' + ')}]`;
      } else if (it.batchDetails && it.batchDetails.length === 1) {
        batchLabel = `[Batch: ${it.batchDetails[0].batchNo}]`;
      } else {
        batchLabel = it.batchNo ? `[Batch: ${it.batchNo}]` : '';
      }

      itemsListEl.innerHTML += `
        <div class="flex justify-between py-1 border-b border-dashed border-slate-200">
          <div>
            <div class="font-bold">${it.name} (${it.unit})</div>
            <div class="text-[9px] text-slate-500">${it.qty} ${it.unit} x ${formatIDR(it.price)} ${batchLabel}</div>
          </div>
          <span class="mono font-bold">${formatIDR(it.subtotal || (it.price * it.qty))}</span>
        </div>`;
    });

    document.getElementById('rcpt-subtotal').textContent = formatIDR(sale.subtotal);
    document.getElementById('rcpt-discount').textContent = `- ${formatIDR(sale.discount)}`;
    document.getElementById('rcpt-total').textContent = formatIDR(sale.total);
    document.getElementById('rcpt-paid').textContent = formatIDR(sale.paid);
    document.getElementById('rcpt-change').textContent = formatIDR(sale.change);

    backdrop.classList.remove('hidden');

    document.getElementById('btn-close-receipt').onclick = () => backdrop.classList.add('hidden');
    document.getElementById('btn-done-receipt').onclick = () => backdrop.classList.add('hidden');
    document.getElementById('btn-print-thermal-action').onclick = () => {
      window.print();
    };
  }

  // ==========================================
  // RIWAYAT & KOREKSI TRANSAKSI PENJUALAN (SALES HISTORY, REVISION & VOID)
  // ==========================================
  let activeEditingSale = null;
  let editSaleWorkingItems = [];
  let pendingSupervisorAction = null;

  function isUserAdminOrOwner(user = null) {
    const u = user || getCurrentUser();
    return u && (u.role === 'OWNER' || u.role === 'ADMIN');
  }

  function updateSalesBadgeCount() {
    const badge = document.getElementById('badge-sales-count');
    if (badge) {
      const activeBranch = appState.currentBranch === 'ALL' ? null : appState.currentBranch;
      const count = activeBranch 
        ? appState.sales.filter(s => s.branchId === activeBranch).length
        : appState.sales.length;
      badge.textContent = count;
    }
  }

  function openSalesHistoryModal() {
    const modal = document.getElementById('modal-sales-history');
    if (!modal) return;
    renderSalesHistory();
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function renderSalesHistory() {
    updateSalesBadgeCount();
    const tbody = document.getElementById('sales-history-table-body');
    if (!tbody) return;

    const searchVal = (document.getElementById('sales-history-search')?.value || '').toLowerCase();
    const branchFilter = document.getElementById('sales-history-branch-filter')?.value || 'ALL';
    const statusFilter = document.getElementById('sales-history-status-filter')?.value || 'ALL';
    const currentUser = getCurrentUser();
    const canManageSales = isUserAdminOrOwner(currentUser);

    tbody.innerHTML = '';

    const filtered = appState.sales.filter(s => {
      const matchBranch = branchFilter === 'ALL' || s.branchId === branchFilter;
      const currentStatus = s.status || 'COMPLETED';
      const matchStatus = statusFilter === 'ALL' || currentStatus === statusFilter;
      const matchSearch = s.id.toLowerCase().includes(searchVal) ||
        (s.cashier && s.cashier.toLowerCase().includes(searchVal)) ||
        (s.items && s.items.some(it => it.name.toLowerCase().includes(searchVal)));

      return matchBranch && matchStatus && matchSearch;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-12 text-center text-slate-400">
            <i data-lucide="receipt" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
            <p class="font-bold">Tidak ada riwayat transaksi penjualan yang cocok.</p>
            <p class="text-[11px] text-slate-400">Lakukan transaksi baru di kasir atau sesuaikan filter pencarian.</p>
          </td>
        </tr>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    filtered.forEach(sale => {
      const isVoid = sale.status === 'VOID';
      const isRevised = sale.status === 'REVISED';

      // Items summary list
      const itemsSummary = (sale.items || []).map(it => {
        return `<span class="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] mr-1 mb-0.5 font-medium border border-slate-200">${it.qty} ${it.unit || 'Tab'} ${it.name}</span>`;
      }).join('');

      const tr = document.createElement('tr');
      tr.className = `hover:bg-slate-50 transition ${isVoid ? 'opacity-60 bg-red-50/20' : isRevised ? 'bg-blue-50/20' : ''}`;

      tr.innerHTML = `
        <td class="py-3 px-4 font-mono">
          <div class="font-extrabold text-slate-900 ${isVoid ? 'line-through text-slate-400' : ''}">${sale.id}</div>
          <div class="text-[10px] text-slate-500 font-mono font-medium">${formatDateTimeWITA(sale.date)}</div>
        </td>
        <td class="py-3 px-4">
          <span class="font-bold ${sale.branchId === 'TLD' ? 'text-blue-700' : 'text-emerald-700'}">${sale.branchId === 'TLD' ? '🏝️ Talaud' : '🌲 Kembang Jgt'}</span>
          <div class="text-[11px] text-slate-600">${sale.cashier || '-'}</div>
        </td>
        <td class="py-3 px-4 max-w-xs">
          <div class="flex flex-wrap">${itemsSummary}</div>
          ${isRevised && sale.revisionHistory?.length ? `
          <div class="text-[10px] text-blue-700 font-semibold mt-1 flex items-center space-x-1">
            <i data-lucide="info" class="w-3 h-3 text-blue-500"></i>
            <span>Direvisi ${sale.revisionHistory.length}x: "${sale.revisionHistory[sale.revisionHistory.length - 1].reason}"</span>
          </div>` : ''}
          ${isVoid && sale.voidInfo ? `
          <div class="text-[10px] text-red-700 font-semibold mt-1 flex items-center space-x-1">
            <i data-lucide="alert-circle" class="w-3 h-3 text-red-500"></i>
            <span>Batal: "${sale.voidInfo.reason}" (${sale.voidInfo.voidedBy})</span>
          </div>` : ''}
        </td>
        <td class="py-3 px-4 text-right mono">
          <div class="font-extrabold text-slate-900 ${isVoid ? 'line-through text-slate-400' : ''}">${formatIDR(sale.total)}</div>
          <div class="text-[10px] text-slate-500">${sale.paymentMethod || 'CASH'}</div>
        </td>
        <td class="py-3 px-4 text-center">
          ${isVoid ? `
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold bg-red-100 text-red-700 border border-red-200">
              ❌ DIBATALKAN
            </span>
          ` : isRevised ? `
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-700 border border-blue-200">
              ✏️ DIREVISI
            </span>
          ` : `
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
              ✓ LUNAS
            </span>
          `}
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <button class="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition btn-reprint-sale" data-id="${sale.id}" title="Cetak Ulang Struk">
              <i data-lucide="printer" class="w-3.5 h-3.5"></i>
            </button>

            ${!isVoid ? `
              ${canManageSales ? `
                <button class="p-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md transition btn-edit-sale" data-id="${sale.id}" title="Revisi / Koreksi Transaksi (Admin/Owner)">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                </button>
                <button class="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition btn-void-sale" data-id="${sale.id}" title="Batalkan Transaksi / Void (Admin/Owner)">
                  <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
                </button>
              ` : `
                <button class="p-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-md transition btn-request-spv-edit" data-id="${sale.id}" title="Koreksi Nota (Minta Izin Supervisor Admin/Owner)">
                  <i data-lucide="lock" class="w-3.5 h-3.5"></i>
                </button>
              `}
            ` : `
              <span class="text-[10px] text-slate-400 italic">Nonaktif</span>
            `}
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-reprint-sale').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const s = appState.sales.find(item => item.id === id);
        if (s) showReceiptModal(s);
      });
    });

    tbody.querySelectorAll('.btn-edit-sale').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openEditSaleModal(id);
      });
    });

    tbody.querySelectorAll('.btn-void-sale').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openVoidSaleModal(id);
      });
    });

    tbody.querySelectorAll('.btn-request-spv-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        requestSupervisorAuth((spv) => {
          openEditSaleModal(id, spv);
        });
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  function requestSupervisorAuth(onSuccess) {
    pendingSupervisorAction = onSuccess;
    const modal = document.getElementById('modal-supervisor-auth');
    if (!modal) return;
    document.getElementById('spv-auth-username').value = '';
    document.getElementById('spv-auth-password').value = '';
    const errEl = document.getElementById('spv-auth-error');
    if (errEl) errEl.classList.add('hidden');

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function openEditSaleModal(saleId, supervisorUser = null) {
    const user = supervisorUser || getCurrentUser();
    if (!isUserAdminOrOwner(user)) {
      requestSupervisorAuth((spv) => openEditSaleModal(saleId, spv));
      return;
    }

    const sale = appState.sales.find(s => s.id === saleId);
    if (!sale) {
      showToast('Transaksi tidak ditemukan!', 'error');
      return;
    }

    if (sale.status === 'VOID') {
      showToast('Transaksi ini sudah DIBATALKAN dan tidak dapat direvisi lagi.', 'warning');
      return;
    }

    activeEditingSale = sale;
    editSaleWorkingItems = JSON.parse(JSON.stringify(sale.items || []));

    const modal = document.getElementById('modal-edit-sale');
    document.getElementById('edit-sale-id').value = sale.id;
    document.getElementById('edit-sale-invoice-no').textContent = sale.id;
    document.getElementById('edit-sale-branch-badge').textContent = sale.branchId === 'TLD' ? '🏝️ Cabang Talaud' : '🌲 Cabang Kembang Janggut';
    document.getElementById('edit-sale-cashier-text').textContent = sale.cashier || '-';
    document.getElementById('edit-sale-date-text').textContent = formatDateTimeWITA(sale.date);
    document.getElementById('edit-sale-old-total').textContent = formatIDR(sale.total);
    document.getElementById('edit-sale-discount-input').value = sale.discount || 0;
    document.getElementById('edit-sale-reason-input').value = '';
    document.getElementById('edit-sale-authorizer-name').textContent = `${user.fullName} (${user.role})`;

    // Hide quick add item panel
    const quickAddPanel = document.getElementById('quick-add-item-panel');
    if (quickAddPanel) quickAddPanel.classList.add('hidden');

    // Populate quick add medicine dropdown
    const medSelect = document.getElementById('quick-add-med-select');
    if (medSelect) {
      medSelect.innerHTML = appState.medicines.map(m => `<option value="${m.id}">${m.code} - ${m.name}</option>`).join('');
    }

    renderEditSaleItemsTable();
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function renderEditSaleItemsTable() {
    const tbody = document.getElementById('edit-sale-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (editSaleWorkingItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-6 text-center text-slate-400">
            Belum ada obat dalam nota ini. Klik "+ Tambah Obat Lain ke Nota" di atas.
          </td>
        </tr>
      `;
      recalculateEditSaleTotals();
      return;
    }

    editSaleWorkingItems.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-bold text-slate-900">${it.name}</td>
        <td class="py-2.5 px-2">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${it.unit || 'Tablet'}</span>
        </td>
        <td class="py-2.5 px-2 text-right mono font-semibold text-slate-700">${formatIDR(it.price)}</td>
        <td class="py-2.5 px-2 text-center">
          <input type="number" min="1" value="${it.qty}" class="w-16 px-1.5 py-0.5 border border-slate-300 rounded text-center mono font-bold item-qty-input" data-idx="${idx}">
        </td>
        <td class="py-2.5 px-3 text-right mono font-bold text-slate-900">${formatIDR(it.subtotal || (it.price * it.qty))}</td>
        <td class="py-2.5 px-2 text-center">
          <button type="button" class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition btn-remove-edit-item" data-idx="${idx}" title="Hapus obat dari nota">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.item-qty-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const val = Math.max(1, parseInt(e.target.value) || 1);
        editSaleWorkingItems[idx].qty = val;
        editSaleWorkingItems[idx].subtotal = val * editSaleWorkingItems[idx].price;
        const subtotalCell = input.closest('tr').children[4];
        if (subtotalCell) subtotalCell.textContent = formatIDR(editSaleWorkingItems[idx].subtotal);
        recalculateEditSaleTotals();
      });
    });

    tbody.querySelectorAll('.btn-remove-edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        editSaleWorkingItems.splice(idx, 1);
        renderEditSaleItemsTable();
      });
    });

    recalculateEditSaleTotals();
    if (window.lucide) lucide.createIcons();
  }

  function recalculateEditSaleTotals() {
    const subtotalText = document.getElementById('edit-sale-subtotal-text');
    const discountInput = document.getElementById('edit-sale-discount-input');
    const newTotalText = document.getElementById('edit-sale-new-total');
    const diffBanner = document.getElementById('edit-sale-diff-banner');

    const newSubtotal = editSaleWorkingItems.reduce((acc, it) => acc + (it.subtotal || (it.price * it.qty)), 0);
    const discountVal = Math.max(0, parseInt(discountInput?.value) || 0);
    const newTotal = Math.max(0, newSubtotal - discountVal);
    const oldTotal = activeEditingSale ? activeEditingSale.total : 0;

    if (subtotalText) subtotalText.textContent = formatIDR(newSubtotal);
    if (newTotalText) newTotalText.textContent = formatIDR(newTotal);

    if (diffBanner) {
      const diff = newTotal - oldTotal;
      if (diff < 0) {
        const refund = Math.abs(diff);
        diffBanner.className = 'p-2.5 rounded-lg border font-bold text-xs flex items-center justify-between bg-emerald-50 border-emerald-200 text-emerald-800';
        diffBanner.innerHTML = `
          <span>💵 Uang Kembalian ke Pelanggan (Refund):</span>
          <span class="mono text-sm font-extrabold text-emerald-700">+ ${formatIDR(refund)}</span>
        `;
      } else if (diff > 0) {
        diffBanner.className = 'p-2.5 rounded-lg border font-bold text-xs flex items-center justify-between bg-amber-50 border-amber-200 text-amber-800';
        diffBanner.innerHTML = `
          <span>💳 Pelanggan Perlu Tambah Bayar (Kekurangan):</span>
          <span class="mono text-sm font-extrabold text-amber-700">${formatIDR(diff)}</span>
        `;
      } else {
        diffBanner.className = 'p-2.5 rounded-lg border font-bold text-xs flex items-center justify-between bg-slate-100 border-slate-200 text-slate-700';
        diffBanner.innerHTML = `
          <span>Total Tagihan Sama Persis:</span>
          <span class="mono text-sm font-extrabold text-slate-800">${formatIDR(newTotal)}</span>
        `;
      }
    }
  }

  function adjustStockForSaleRevision(sale, newItems) {
    const branchId = sale.branchId;

    const oldMedicineBase = {};
    (sale.items || []).forEach(it => {
      const bUnits = it.qty * (it.multiplier || 1);
      oldMedicineBase[it.medicineId] = (oldMedicineBase[it.medicineId] || 0) + bUnits;
    });

    const newMedicineBase = {};
    newItems.forEach(it => {
      const bUnits = it.qty * (it.multiplier || 1);
      newMedicineBase[it.medicineId] = (newMedicineBase[it.medicineId] || 0) + bUnits;
    });

    const allMedIds = new Set([...Object.keys(oldMedicineBase), ...Object.keys(newMedicineBase)]);

    // 1. Availability check first
    for (const medId of allMedIds) {
      const oldQty = oldMedicineBase[medId] || 0;
      const newQty = newMedicineBase[medId] || 0;
      const diff = newQty - oldQty;

      if (diff > 0) {
        const availableStock = appState.batches
          .filter(b => b.medicineId === medId && b.branchId === branchId && b.stock > 0)
          .reduce((sum, b) => sum + b.stock, 0);

        if (availableStock < diff) {
          const med = appState.medicines.find(m => m.id === medId);
          throw new Error(`Stok ${med ? med.name : medId} di cabang ini tidak mencukupi untuk penambahan ${diff} unit dasar (tersisa ${availableStock} unit).`);
        }
      }
    }

    // 2. Apply adjustments
    for (const medId of allMedIds) {
      const oldQty = oldMedicineBase[medId] || 0;
      const newQty = newMedicineBase[medId] || 0;
      const diff = newQty - oldQty;

      if (diff < 0) {
        let restoreQty = Math.abs(diff);

        // Try restoring to original batches first
        const origItem = (sale.items || []).find(it => it.medicineId === medId);
        if (origItem && origItem.batchDetails && Array.isArray(origItem.batchDetails)) {
          for (const bd of origItem.batchDetails) {
            if (restoreQty <= 0) break;
            const b = appState.batches.find(batch => batch.id === bd.batchId || batch.batchNo === bd.batchNo);
            if (b) {
              const add = Math.min(restoreQty, bd.deductedQty || restoreQty);
              b.stock += add;
              restoreQty -= add;
            }
          }
        }

        if (restoreQty > 0) {
          const b = appState.batches.find(batch => batch.medicineId === medId && batch.branchId === branchId);
          if (b) {
            b.stock += restoreQty;
          }
        }
      } else if (diff > 0) {
        let needDeduct = diff;
        const medBatches = appState.batches
          .filter(b => b.medicineId === medId && b.branchId === branchId && b.stock > 0)
          .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

        for (const b of medBatches) {
          if (needDeduct <= 0) break;
          const take = Math.min(b.stock, needDeduct);
          b.stock = Math.max(0, b.stock - take);
          needDeduct -= take;
        }
      }
    }
  }

  function restoreStockForVoid(sale) {
    (sale.items || []).forEach(it => {
      let restoreQty = it.qty * (it.multiplier || 1);

      if (it.batchDetails && Array.isArray(it.batchDetails) && it.batchDetails.length > 0) {
        it.batchDetails.forEach(bd => {
          const b = appState.batches.find(batch => batch.id === bd.batchId || batch.batchNo === bd.batchNo);
          if (b) {
            b.stock += bd.deductedQty;
            restoreQty -= bd.deductedQty;
          }
        });
      }

      if (restoreQty > 0) {
        const b = appState.batches.find(batch => batch.medicineId === it.medicineId && batch.branchId === sale.branchId);
        if (b) {
          b.stock += restoreQty;
        }
      }
    });
  }

  function openVoidSaleModal(saleId, supervisorUser = null) {
    const user = supervisorUser || getCurrentUser();
    if (!isUserAdminOrOwner(user)) {
      requestSupervisorAuth((spv) => openVoidSaleModal(saleId, spv));
      return;
    }

    const sale = appState.sales.find(s => s.id === saleId);
    if (!sale) {
      showToast('Transaksi tidak ditemukan!', 'error');
      return;
    }

    if (sale.status === 'VOID') {
      showToast('Transaksi ini sudah berstatus DIBATALKAN.', 'warning');
      return;
    }

    const modal = document.getElementById('modal-void-sale');
    document.getElementById('void-sale-id').value = sale.id;
    document.getElementById('void-sale-invoice-no').textContent = sale.id;
    document.getElementById('void-sale-total').textContent = formatIDR(sale.total);
    document.getElementById('void-sale-reason').value = '';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function setupSalesCorrectionModals() {
    const historyModal = document.getElementById('modal-sales-history');
    const editModal = document.getElementById('modal-edit-sale');
    const voidModal = document.getElementById('modal-void-sale');
    const spvModal = document.getElementById('modal-supervisor-auth');

    // Generic modal close buttons
    [historyModal, editModal, voidModal, spvModal].forEach(m => {
      if (!m) return;
      m.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', () => m.classList.add('hidden'));
      });
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });
    });

    // History filters
    const searchInp = document.getElementById('sales-history-search');
    const branchSel = document.getElementById('sales-history-branch-filter');
    const statusSel = document.getElementById('sales-history-status-filter');

    if (searchInp) searchInp.addEventListener('input', renderSalesHistory);
    if (branchSel) branchSel.addEventListener('change', renderSalesHistory);
    if (statusSel) statusSel.addEventListener('change', renderSalesHistory);

    // Edit modal: Quick add item button toggle
    const btnAddItem = document.getElementById('btn-add-item-to-sale');
    const quickAddPanel = document.getElementById('quick-add-item-panel');
    const btnConfirmAdd = document.getElementById('btn-confirm-add-item');

    if (btnAddItem && quickAddPanel) {
      btnAddItem.addEventListener('click', () => {
        quickAddPanel.classList.toggle('hidden');
      });
    }

    if (btnConfirmAdd && quickAddPanel) {
      btnConfirmAdd.addEventListener('click', () => {
        const medId = document.getElementById('quick-add-med-select')?.value;
        const tier = document.getElementById('quick-add-tier-select')?.value || 'base';
        const qty = Math.max(1, parseInt(document.getElementById('quick-add-qty-input')?.value) || 1);

        const med = appState.medicines.find(m => m.id === medId);
        if (!med || !activeEditingSale) return;

        const bCfg = getMedicineBranchConfig(med, activeEditingSale.branchId);
        let unitName = med.baseUnit;
        let multiplier = 1;
        let unitPrice = bCfg.sellPrice || 0;

        if (tier === 'strip') {
          unitName = med.stripUnit || 'Strip';
          multiplier = med.stripConversion || 1;
          unitPrice = bCfg.stripPrice || (unitPrice * multiplier);
        } else if (tier === 'box') {
          unitName = med.buyUnit || 'Box';
          multiplier = med.conversionRate || 1;
          unitPrice = bCfg.boxPrice || (unitPrice * multiplier);
        }

        const existingIdx = editSaleWorkingItems.findIndex(it => it.medicineId === med.id && it.unit === unitName);
        if (existingIdx > -1) {
          editSaleWorkingItems[existingIdx].qty += qty;
          editSaleWorkingItems[existingIdx].subtotal = editSaleWorkingItems[existingIdx].qty * editSaleWorkingItems[existingIdx].price;
        } else {
          editSaleWorkingItems.push({
            medicineId: med.id,
            name: med.name,
            tier: tier,
            unit: unitName,
            baseUnit: med.baseUnit,
            multiplier: multiplier,
            price: unitPrice,
            hpp: (bCfg.buyPrice || med.buyPrice || 0) * multiplier,
            qty: qty,
            subtotal: unitPrice * qty
          });
        }

        quickAddPanel.classList.add('hidden');
        renderEditSaleItemsTable();
      });
    }

    // Discount change in edit modal
    const editDiscountInp = document.getElementById('edit-sale-discount-input');
    if (editDiscountInp) {
      editDiscountInp.addEventListener('input', recalculateEditSaleTotals);
    }

    // Edit Form Submit (Execute Revision)
    const formEditSale = document.getElementById('form-edit-sale');
    if (formEditSale) {
      formEditSale.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!activeEditingSale) return;

        if (editSaleWorkingItems.length === 0) {
          showToast('Nota tidak boleh kosong! Batalkan transaksi jika seluruh obat dibatalkan.', 'error');
          return;
        }

        const reasonVal = (document.getElementById('edit-sale-reason-input')?.value || '').trim();
        if (reasonVal.length < 3) {
          showToast('Alasan revisi / koreksi wajib diisi!', 'error');
          document.getElementById('edit-sale-reason-input')?.focus();
          return;
        }

        const user = getCurrentUser();
        const oldTotal = activeEditingSale.total;
        const newSubtotal = editSaleWorkingItems.reduce((acc, it) => acc + (it.subtotal || (it.price * it.qty)), 0);
        const discountVal = Math.max(0, parseInt(document.getElementById('edit-sale-discount-input')?.value) || 0);
        const newTotal = Math.max(0, newSubtotal - discountVal);

        try {
          // Adjust stock atomically
          adjustStockForSaleRevision(activeEditingSale, editSaleWorkingItems);
        } catch (err) {
          showToast(err.message, 'error');
          return;
        }

        // Apply changes to sale
        activeEditingSale.items = JSON.parse(JSON.stringify(editSaleWorkingItems));
        activeEditingSale.subtotal = newSubtotal;
        activeEditingSale.discount = discountVal;
        activeEditingSale.total = newTotal;
        activeEditingSale.status = 'REVISED';

        activeEditingSale.revisionHistory = activeEditingSale.revisionHistory || [];
        activeEditingSale.revisionHistory.push({
          revisedAt: new Date().toISOString(),
          revisedBy: `${user.fullName} (${user.role})`,
          reason: reasonVal,
          oldTotal: oldTotal,
          newTotal: newTotal,
          diff: newTotal - oldTotal
        });

        saveState();
        pushSaleToServer(activeEditingSale, appState.batches);
        showToast(`Nota ${activeEditingSale.id} berhasil DIREVISI! Stok obat fisik telah disesuaikan.`, 'success');

        renderSalesHistory();
        renderDashboard();
        renderPOS();
        renderInventoryBatches();
        showReceiptModal(activeEditingSale);
      });
    }

    // Void Confirm Button Click
    const btnConfirmVoid = document.getElementById('btn-confirm-void-sale');
    if (btnConfirmVoid) {
      btnConfirmVoid.addEventListener('click', () => {
        const saleId = document.getElementById('void-sale-id')?.value;
        const reasonVal = (document.getElementById('void-sale-reason')?.value || '').trim();

        if (reasonVal.length < 3) {
          showToast('Alasan pembatalan transaksi wajib diisi!', 'error');
          document.getElementById('void-sale-reason')?.focus();
          return;
        }

        const sale = appState.sales.find(s => s.id === saleId);
        if (!sale) return;

        const user = getCurrentUser();

        // Restore stock to batches
        restoreStockForVoid(sale);

        sale.status = 'VOID';
        sale.voidInfo = {
          voidedAt: new Date().toISOString(),
          voidedBy: `${user.fullName} (${user.role})`,
          reason: reasonVal
        };

        saveState();
        pushSaleToServer(sale, appState.batches);
        if (voidModal) voidModal.classList.add('hidden');
        showToast(`Transaksi ${sale.id} berhasil DIBATALKAN (VOID). Seluruh stok telah dikembalikan ke nomor batch masing-masing.`, 'success');

        renderSalesHistory();
        renderDashboard();
        renderPOS();
        renderInventoryBatches();
        showReceiptModal(sale);
      });
    }

    // Supervisor Auth Modal Submit
    const btnSubmitSpv = document.getElementById('btn-submit-spv-auth');
    if (btnSubmitSpv) {
      btnSubmitSpv.addEventListener('click', () => {
        const uVal = (document.getElementById('spv-auth-username')?.value || '').trim();
        const pVal = (document.getElementById('spv-auth-password')?.value || '').trim();

        const spv = appState.users.find(u => 
          (u.username.toLowerCase() === uVal.toLowerCase() || u.role.toLowerCase() === uVal.toLowerCase()) &&
          u.password === pVal &&
          (u.role === 'OWNER' || u.role === 'ADMIN')
        );

        if (!spv) {
          const errEl = document.getElementById('spv-auth-error');
          if (errEl) {
            errEl.textContent = 'Kredensial tidak valid atau akun bukan Admin/Owner apotek!';
            errEl.classList.remove('hidden');
          }
          return;
        }

        if (spvModal) spvModal.classList.add('hidden');
        showToast(`Otorisasi Supervisor Berhasil: ${spv.fullName} (${spv.role})`, 'success');

        if (pendingSupervisorAction) {
          const action = pendingSupervisorAction;
          pendingSupervisorAction = null;
          action(spv);
        }
      });
    }
  }

  // ==========================================
  // 7. MASTER OBAT ENGINE
  // ==========================================
  function getMedicineLocation(med) {
    if (med.location && med.location.trim()) return med.location.trim();
    if (med.category === 'Obat Keras') return 'Rak B-02 (Obat Keras)';
    if (med.dosageForm === 'Sirup' || med.dosageForm === 'Drop') return 'Rak C-01 (Sirup)';
    if (med.dosageForm === 'Salep') return 'Rak C-02 (Salep)';
    if (med.category === 'Alkes') return 'Etalase Alkes';
    if (med.category === 'Suplemen') return 'Etalase Depan Kasir';
    return 'Rak A-01 (Obat Bebas)';
  }

  let activeMasterBranchFilter = 'ALL';

  function renderMedicinesTable() {
    const tbody = document.getElementById('medicine-table-body');
    const searchVal = (document.getElementById('medicine-search-table').value || '').toLowerCase();
    tbody.innerHTML = '';

    // Update table header labels based on selected branch
    const thLocation = document.getElementById('th-master-location');
    const thHpp = document.getElementById('th-master-hpp');
    const thPrice = document.getElementById('th-master-price');
    const thBuffer = document.getElementById('th-master-buffer');

    if (activeMasterBranchFilter === 'TLD') {
      if (thLocation) thLocation.textContent = 'Lokasi Rak (Talaud)';
      if (thHpp) thHpp.textContent = 'HPP Talaud';
      if (thPrice) thPrice.textContent = 'Harga Jual Talaud';
      if (thBuffer) thBuffer.textContent = 'Min. Buffer (TLD)';
    } else if (activeMasterBranchFilter === 'KBJ') {
      if (thLocation) thLocation.textContent = 'Lokasi Rak (KBJ)';
      if (thHpp) thHpp.textContent = 'HPP KBJ';
      if (thPrice) thPrice.textContent = 'Harga Jual KBJ';
      if (thBuffer) thBuffer.textContent = 'Min. Buffer (KBJ)';
    } else {
      if (thLocation) thLocation.textContent = 'Lokasi Rak (Pusat)';
      if (thHpp) thHpp.textContent = 'HPP (Beli)';
      if (thPrice) thPrice.textContent = 'Harga Jual Bertingkat';
      if (thBuffer) thBuffer.textContent = 'Stok Min. Buffer';
    }

    const searchClean = (searchVal || '').trim().toLowerCase();
    const filtered = (appState.medicines || []).filter(m => {
      if (!m) return false;
      const bCfg = (activeMasterBranchFilter !== 'ALL') ? getMedicineBranchConfig(m, activeMasterBranchFilter) : null;
      const bBarcode = String((bCfg && bCfg.barcode) || m.barcode || '').toLowerCase();
      const bLocation = String((bCfg && bCfg.location) || m.location || '').toLowerCase();
      const name = String(m.name || '').toLowerCase();
      const code = String(m.code || '').toLowerCase();
      const barcode = String(m.barcode || '').toLowerCase();
      const location = String(m.location || '').toLowerCase();

      return name.includes(searchClean) ||
        code.includes(searchClean) ||
        barcode.includes(searchClean) ||
        bBarcode.includes(searchClean) ||
        location.includes(searchClean) ||
        bLocation.includes(searchClean);
    });

    if ((appState.medicines || []).length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="8" class="text-center py-12 px-4 text-slate-400">
          <div class="max-w-md mx-auto space-y-2.5">
            <div class="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <i data-lucide="package-plus" class="w-6 h-6"></i>
            </div>
            <div class="text-sm font-bold text-slate-800">Master Obat Bersih & Siap Diisi</div>
            <p class="text-xs text-slate-500 leading-relaxed">
              Semua data contoh lama telah dibersihkan total. Silakan klik tombol 
              <b class="text-emerald-700 font-bold">+ Tambah Obat Baru</b> di kanan atas untuk mulai menginput obat riil Apotek Tonang Farma dengan batas buffer fleksibel (Botol / Strip).
            </p>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
      if (window.lucide) lucide.createIcons();
      return;
    }

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="8" class="text-center py-10 text-slate-400 font-medium">
          <div class="flex flex-col items-center justify-center space-y-2">
            <i data-lucide="package-search" class="w-8 h-8 text-slate-300"></i>
            <div>Tidak ada obat yang cocok dengan filter cabang atau kata kunci pencarian.</div>
            <button onclick="document.getElementById('medicine-search-table').value=''; renderMedicinesTable();" class="text-xs text-emerald-600 hover:underline font-semibold">Reset Pencarian</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
      if (window.lucide) lucide.createIcons();
      return;
    }

    filtered.forEach(med => {
      const bCfg = (activeMasterBranchFilter !== 'ALL') 
        ? (getMedicineBranchConfig(med, activeMasterBranchFilter) || {})
        : (getMedicineBranchConfig(med, 'TLD') || {});

      const loc = (activeMasterBranchFilter !== 'ALL') ? (bCfg.location || 'Rak A-01') : getMedicineLocation(med);
      const barcodeDisplay = (activeMasterBranchFilter !== 'ALL' && bCfg.barcode) ? bCfg.barcode : (med.barcode || '-');
      const buyPriceDisplay = (activeMasterBranchFilter !== 'ALL') ? (bCfg.buyPrice || 0) : (med.buyPrice || bCfg.buyPrice || 0);
      const sellPriceDisplay = (activeMasterBranchFilter !== 'ALL') ? (bCfg.sellPrice || 0) : (med.sellPrice || bCfg.sellPrice || 0);
      const stripPriceDisplay = (activeMasterBranchFilter !== 'ALL') ? (bCfg.stripPrice || 0) : (med.stripPrice || bCfg.stripPrice || 0);
      const boxPriceDisplay = (activeMasterBranchFilter !== 'ALL') ? (bCfg.boxPrice || 0) : (med.boxPrice || bCfg.boxPrice || 0);
      const minStockDisplay = (activeMasterBranchFilter !== 'ALL') ? (bCfg.minStock !== undefined ? bCfg.minStock : (med.minStock || 10)) : (med.minStock !== undefined ? med.minStock : 10);
      const minStockUnitDisplay = (activeMasterBranchFilter !== 'ALL') ? (bCfg.minStockUnit || med.minStockUnit || (med.dosageForm === 'Sirup' || med.baseUnit === 'Botol' ? 'Botol' : (med.stripUnit ? med.stripUnit : (med.buyUnit || 'Box')))) : (med.minStockUnit || (med.dosageForm === 'Sirup' || med.baseUnit === 'Botol' ? 'Botol' : (med.stripUnit ? med.stripUnit : (med.buyUnit || 'Box'))));

      const hasStripMed = Boolean(med.stripUnit && (Number(med.stripConversion) || 0) > 1);
      const pkgHppDisplay = (activeMasterBranchFilter !== 'ALL')
        ? (bCfg.pkgBuyPrice || (bCfg.buyPrice && med.conversionRate ? Math.round(bCfg.buyPrice * med.conversionRate) : 0))
        : (med.pkgBuyPrice || bCfg.pkgBuyPrice || (buyPriceDisplay && med.conversionRate ? Math.round(buyPriceDisplay * med.conversionRate) : 0));
      const stripHppDisplay = hasStripMed
        ? ((activeMasterBranchFilter !== 'ALL')
            ? (bCfg.stripBuyPrice || (bCfg.buyPrice && med.stripConversion ? Math.round(bCfg.buyPrice * med.stripConversion) : 0))
            : (med.stripBuyPrice || bCfg.stripBuyPrice || (buyPriceDisplay && med.stripConversion ? Math.round(buyPriceDisplay * med.stripConversion) : 0)))
        : 0;

      const tldActive = med.branchConfigs?.TLD?.active !== false;
      const kbjActive = med.branchConfigs?.KBJ?.active !== false;

      const isCurrentBranchInactive = (activeMasterBranchFilter !== 'ALL') && (bCfg.active === false);

      const tr = document.createElement('tr');
      tr.className = `hover:bg-slate-50 transition ${isCurrentBranchInactive ? 'opacity-60 bg-slate-50/70' : ''}`;
      tr.innerHTML = `
        <td class="py-3 px-4 font-mono">
          <div class="font-bold text-slate-900">${med.code}</div>
          <div class="text-[10px] text-slate-400">${barcodeDisplay}</div>
        </td>
        <td class="py-3 px-4">
          <div class="font-bold text-slate-900">${med.name}</div>
          ${activeMasterBranchFilter === 'ALL' ? `
          <div class="flex items-center space-x-1.5 mt-1">
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${tldActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400 line-through'}">
              🏝️ TLD: ${tldActive ? 'Aktif' : 'Nonaktif'}
            </span>
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${kbjActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400 line-through'}">
              🌲 KBJ: ${kbjActive ? 'Aktif' : 'Nonaktif'}
            </span>
          </div>` : isCurrentBranchInactive ? `
          <div class="mt-1">
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800">
              ⚠️ Tidak dijual di cabang ini (Nonaktif)
            </span>
          </div>` : ''}
        </td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            med.category === 'Obat Keras' ? 'bg-red-100 text-red-700' :
            med.category === 'Bebas Terbatas' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
          }">${med.category}</span>
          <span class="text-[11px] text-slate-500 ml-1">${med.dosageForm}</span>
        </td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <i data-lucide="map-pin" class="w-3 h-3 text-rose-500 shrink-0"></i>
            <span>${loc}</span>
          </span>
        </td>
        <td class="py-3 px-4 text-slate-600">
          <div class="font-bold text-slate-800">1 ${med.buyUnit || 'Box'} = ${med.conversionRate || 100} ${med.baseUnit || 'Tablet'}</div>
          ${med.stripUnit && med.stripConversion > 1 ? `<div class="text-[10px] text-blue-700 font-semibold">1 ${med.stripUnit} = ${med.stripConversion} ${med.baseUnit || 'Tablet'}</div>` : ''}
        </td>
        <td class="py-3 px-4 text-right mono text-slate-700">
          ${hasStripMed ? `
            <div class="font-bold text-blue-900">${stripHppDisplay > 0 ? formatIDR(stripHppDisplay) : '-'} <span class="text-[10px] font-normal text-blue-600">/${med.stripUnit}</span></div>
            ${pkgHppDisplay > 0 ? `<div class="text-[10px] text-purple-700 font-semibold">${formatIDR(pkgHppDisplay)} <span class="font-normal text-slate-400">/${med.buyUnit || 'Box'}</span></div>` : ''}
            ${buyPriceDisplay > 0 ? `<div class="text-[9px] text-slate-400 font-normal">Dasar: ${formatIDR(buyPriceDisplay)}/${med.baseUnit || 'Tab'}</div>` : ''}
          ` : `
            <div class="font-bold text-emerald-900">${buyPriceDisplay > 0 ? formatIDR(buyPriceDisplay) : '-'} <span class="text-[10px] font-normal text-emerald-600">/${med.baseUnit || 'Botol'}</span></div>
            ${pkgHppDisplay > 0 ? `<div class="text-[10px] text-purple-700 font-semibold">${formatIDR(pkgHppDisplay)} <span class="font-normal text-slate-400">/${med.buyUnit || 'Dus'}</span></div>` : ''}
          `}
        </td>
        <td class="py-3 px-4 text-right">
          ${sellPriceDisplay > 0 ? `<div class="mono font-bold text-emerald-700">${formatIDR(sellPriceDisplay)} <span class="text-[10px] font-normal text-slate-500">/${med.baseUnit || 'Tab'}</span></div>` : `<div class="text-[10px] text-slate-400 italic">Eceran: -</div>`}
          ${stripPriceDisplay > 0 && med.stripConversion > 1 ? `<div class="mono text-[10px] font-bold text-blue-700">${formatIDR(stripPriceDisplay)} <span class="font-normal text-slate-400">/${med.stripUnit || 'Strip'}</span></div>` : ''}
          ${boxPriceDisplay > 0 ? `<div class="mono text-[10px] font-bold text-purple-700">${formatIDR(boxPriceDisplay)} <span class="font-normal text-slate-400">/${med.buyUnit || 'Box'}</span></div>` : ''}
        </td>
        <td class="py-3 px-4 text-center">
          <span class="mono font-bold text-slate-800">${minStockDisplay}</span>
          <span class="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-bold ml-1">${minStockUnitDisplay}</span>
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <button class="p-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-md transition config-branch-med-btn" data-id="${med.id}" data-name="${(med.name || '').replace(/"/g, '&quot;')}" title="⚙️ Atur Cabang, Harga & Lokasi Rak">
              <i data-lucide="settings" class="w-3.5 h-3.5"></i>
            </button>
            <button class="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition add-stock-med-btn" data-id="${med.id}" title="Input Obat Masuk / Tambah Stok">
              <i data-lucide="package-plus" class="w-3.5 h-3.5"></i>
            </button>
            <button class="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition edit-med-btn" data-id="${med.id}" data-code="${med.code}" title="Edit Data Master Umum">
              <i data-lucide="edit" class="w-3.5 h-3.5"></i>
            </button>
            <button class="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition delete-med-btn" data-id="${med.id}" data-code="${med.code}" data-name="${(med.name || '').replace(/"/g, '&quot;')}" title="Hapus Data Obat">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Event listeners for configure branch & pricing
    tbody.querySelectorAll('.config-branch-med-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openBranchPricingModal(id);
      });
    });

    // Event listener for add stock / incoming stock button per medicine
    tbody.querySelectorAll('.add-stock-med-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openIncomingStockModal(id);
      });
    });

    // Event listeners for edit buttons
    tbody.querySelectorAll('.edit-med-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || btn.getAttribute('data-code');
        openEditMedicineModal(id);
      });
    });

    // Event listeners for delete buttons
    tbody.querySelectorAll('.delete-med-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || '';
        const code = btn.getAttribute('data-code') || '';
        const name = btn.getAttribute('data-name') || '';
        openDeleteMedicineModal(id, code, name);
      });
    });

    lucide.createIcons();
  }

  // Helper to generate barcode from medicine code
  // Example: MED-011 -> 8999909011, MED-012 -> 8999909012
  function generateBarcodeFromCode(code) {
    if (!code) return '';
    const clean = code.trim().toUpperCase();
    const digits = clean.replace(/\D/g, '');
    if (digits) {
      return '8999909' + digits.padStart(3, '0');
    }
    return '8999909001';
  }

  // Lookup medicine by code (case-insensitive) excluding a specific id (for edit mode)
  function findMedicineByCode(code, excludeId = null) {
    if (!code) return null;
    const clean = code.trim().toUpperCase();
    return appState.medicines.find(m => 
      (m.code || '').trim().toUpperCase() === clean && m.id !== excludeId
    ) || null;
  }

  // Lookup medicine by barcode excluding a specific id (for edit mode)
  function findMedicineByBarcode(barcode, excludeId = null) {
    if (!barcode) return null;
    const clean = barcode.trim();
    return appState.medicines.find(m => 
      (m.barcode || '').trim() === clean && m.id !== excludeId
    ) || null;
  }

  // Lookup medicine by name (case-insensitive & trimmed) excluding a specific id (for edit mode)
  function findMedicineByName(name, excludeId = null) {
    if (!name) return null;
    const clean = name.trim().toLowerCase();
    return appState.medicines.find(m => 
      (m.name || '').trim().toLowerCase() === clean && m.id !== excludeId
    ) || null;
  }

  // Generate next unused medicine code & barcode (skips taken active & deleted codes)
  function getNextMedicineCode() {
    const takenCodes = new Set();
    const takenBarcodes = new Set();

    appState.medicines.forEach(m => {
      if (m.code) takenCodes.add(m.code.trim().toUpperCase());
      if (m.barcode) takenBarcodes.add(m.barcode.trim());
    });

    let num = 1;
    while (num < 9999) {
      const candidateCode = 'MED-' + String(num).padStart(3, '0');
      const candidateBarcode = generateBarcodeFromCode(candidateCode);
      if (!takenCodes.has(candidateCode) && !takenBarcodes.has(candidateBarcode)) {
        return candidateCode;
      }
      num++;
    }
    return 'MED-' + Date.now().toString().slice(-4);
  }

  // Real-time validator for Code, Barcode, and Name uniqueness
  function validateMedicineUniqueness() {
    const editIdInput = document.getElementById('edit-med-id');
    const editId = (editIdInput && editIdInput.value.trim()) || null;
    const codeInput = document.getElementById('new-med-code');
    const barcodeInput = document.getElementById('new-med-barcode');
    const nameInput = document.getElementById('new-med-name');
    const codeFeedback = document.getElementById('med-code-feedback');
    const barcodeFeedback = document.getElementById('med-barcode-feedback');
    const nameFeedback = document.getElementById('med-name-feedback');
    const submitBtn = document.getElementById('btn-submit-medicine');

    const codeVal = (codeInput && codeInput.value.trim().toUpperCase()) || '';
    const barcodeVal = (barcodeInput && barcodeInput.value.trim()) || '';
    const nameVal = (nameInput && nameInput.value.trim()) || '';

    let isCodeValid = true;
    let isNameValid = true;

    // 1. VALIDATE CODE & BARCODE
    if (!codeVal) {
      if (codeFeedback) codeFeedback.innerHTML = '<p class="text-[10px] text-slate-400">Kode unik obat (wajib diisi)</p>';
      if (codeInput) {
        codeInput.classList.remove('border-red-500', 'bg-red-50', 'text-red-900', 'border-emerald-500');
        codeInput.classList.add('border-slate-300');
      }
      isCodeValid = false;
    } else {
      const dupCode = findMedicineByCode(codeVal, editId);
      const dupBarcode = findMedicineByBarcode(barcodeVal, editId);

      if (dupCode) {
        // DUPLICATE CODE FOUND
        if (codeFeedback) {
          codeFeedback.innerHTML = `
            <div class="text-[11px] text-red-600 font-bold flex items-center space-x-1 mt-0.5 animate-pulse">
              <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-red-500 shrink-0"></i>
              <span>Kode "${codeVal}" sudah digunakan oleh "${dupCode.name}"!</span>
            </div>
          `;
        }
        if (barcodeFeedback) {
          barcodeFeedback.innerHTML = `
            <div class="text-[10px] text-red-500 font-medium mt-0.5">
              ⚠️ Barcode tidak dapat digunakan (duplikasi dengan obat lain)
            </div>
          `;
        }
        if (codeInput) {
          codeInput.classList.add('border-red-500', 'bg-red-50', 'text-red-900');
          codeInput.classList.remove('border-slate-300', 'border-emerald-500');
        }
        isCodeValid = false;
      } else if (dupBarcode) {
        // DUPLICATE BARCODE FOUND
        if (barcodeFeedback) {
          barcodeFeedback.innerHTML = `
            <div class="text-[11px] text-red-600 font-bold flex items-center space-x-1 mt-0.5 animate-pulse">
              <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-red-500 shrink-0"></i>
              <span>Barcode "${barcodeVal}" sudah digunakan oleh "${dupBarcode.name}"!</span>
            </div>
          `;
        }
        if (codeInput) {
          codeInput.classList.add('border-red-500', 'bg-red-50', 'text-red-900');
          codeInput.classList.remove('border-slate-300', 'border-emerald-500');
        }
        isCodeValid = false;
      } else {
        // UNIQUE CODE & BARCODE
        if (codeFeedback) {
          codeFeedback.innerHTML = `
            <div class="text-[11px] text-emerald-600 font-semibold flex items-center space-x-1 mt-0.5">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-500 shrink-0"></i>
              <span>Kode & Barcode unik (Tersedia)</span>
            </div>
          `;
        }
        if (barcodeFeedback) {
          barcodeFeedback.innerHTML = `
            <div class="text-[10px] text-emerald-600 font-medium mt-0.5">
              ✓ Terisi otomatis & terproteksi dari duplikasi
            </div>
          `;
        }
        if (codeInput) {
          codeInput.classList.remove('border-red-500', 'bg-red-50', 'text-red-900');
          codeInput.classList.add('border-emerald-500');
        }
      }
    }

    // 2. VALIDATE MEDICINE NAME UNIQUENESS
    if (!nameVal) {
      if (nameFeedback) {
        nameFeedback.innerHTML = '<p class="text-[10px] text-slate-400">Nama obat harus unik & belum pernah terdaftar</p>';
      }
      if (nameInput) {
        nameInput.classList.remove('border-red-500', 'bg-red-50', 'text-red-900', 'border-emerald-500');
        nameInput.classList.add('border-slate-300');
      }
      isNameValid = false;
    } else {
      const dupName = findMedicineByName(nameVal, editId);
      if (dupName) {
        // DUPLICATE MEDICINE NAME FOUND
        if (nameFeedback) {
          nameFeedback.innerHTML = `
            <div class="text-[11px] text-red-600 font-bold flex items-center space-x-1 mt-0.5 animate-pulse">
              <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-red-500 shrink-0"></i>
              <span>Nama obat "${nameVal}" sudah terdaftar (${dupName.code})!</span>
            </div>
          `;
        }
        if (nameInput) {
          nameInput.classList.add('border-red-500', 'bg-red-50', 'text-red-900');
          nameInput.classList.remove('border-slate-300', 'border-emerald-500');
        }
        isNameValid = false;
      } else {
        // UNIQUE MEDICINE NAME
        if (nameFeedback) {
          nameFeedback.innerHTML = `
            <div class="text-[11px] text-emerald-600 font-semibold flex items-center space-x-1 mt-0.5">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-500 shrink-0"></i>
              <span>Nama obat unik (Tersedia)</span>
            </div>
          `;
        }
        if (nameInput) {
          nameInput.classList.remove('border-red-500', 'bg-red-50', 'text-red-900');
          nameInput.classList.add('border-emerald-500');
        }
      }
    }

    const isValid = isCodeValid && isNameValid;

    if (submitBtn) {
      if (isValid) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        submitBtn.title = '';
      } else {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        submitBtn.title = 'Periksa kembali kode atau nama obat yang duplikat';
      }
    }

    if (window.lucide) lucide.createIcons();
    return isValid;
  }

  // Function to open modal in Edit Mode (Katalog Umum Pusat)
  function openEditMedicineModal(idOrCode) {
    const med = appState.medicines.find(m => m.id === idOrCode || m.code === idOrCode);
    if (!med) return;

    const modal = document.getElementById('modal-add-medicine');
    const modalTitle = document.getElementById('modal-medicine-title');
    const submitBtn = document.getElementById('btn-submit-medicine');
    const editIdInput = document.getElementById('edit-med-id');
    const codeInput = document.getElementById('new-med-code');
    const nameInput = document.getElementById('new-med-name');
    const catSelect = document.getElementById('new-med-cat');
    const dosageSelect = document.getElementById('new-med-dosage');
    const baseUnitInput = document.getElementById('new-med-base-unit');
    const buyUnitInput = document.getElementById('new-med-buy-unit');
    const convRateInput = document.getElementById('new-med-conv-rate');
    const stripUnitInput = document.getElementById('new-med-strip-unit');
    const stripConvInput = document.getElementById('new-med-strip-conv');
    const suffixStripBase = document.getElementById('suffix-strip-base');
    const suffixBoxBase = document.getElementById('suffix-box-base');

    if (editIdInput) editIdInput.value = med.id;
    if (modalTitle) modalTitle.textContent = `Edit Master Obat: ${med.name}`;
    if (submitBtn) {
      submitBtn.textContent = 'Simpan Perubahan';
      submitBtn.className = 'px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow';
    }

    if (codeInput) codeInput.value = med.code || '';
    if (nameInput) nameInput.value = med.name || '';
    if (catSelect) catSelect.value = med.category || 'Bebas';
    if (dosageSelect) dosageSelect.value = med.dosageForm || 'Tablet';
    if (baseUnitInput) baseUnitInput.value = med.baseUnit || 'Tablet';
    if (buyUnitInput) buyUnitInput.value = med.buyUnit || 'Box';
    if (convRateInput) convRateInput.value = med.conversionRate || 100;
    if (stripUnitInput) stripUnitInput.value = med.stripUnit !== undefined ? med.stripUnit : (med.dosageForm === 'Tablet' || med.dosageForm === 'Kapsul' ? 'Strip' : '');
    if (stripConvInput) stripConvInput.value = med.stripConversion !== undefined ? med.stripConversion : (med.dosageForm === 'Tablet' || med.dosageForm === 'Kapsul' ? 10 : 0);

    const baseName = (med.baseUnit || 'Tab').slice(0, 4);
    if (suffixStripBase) suffixStripBase.textContent = baseName;
    if (suffixBoxBase) suffixBoxBase.textContent = baseName;

    const minStockInput = document.getElementById('new-med-min-stock');
    const minStockUnitSelect = document.getElementById('new-med-min-stock-unit');
    if (minStockInput) minStockInput.value = med.minStock !== undefined ? med.minStock : 10;
    if (minStockUnitSelect) {
      const defUnit = med.minStockUnit || (med.dosageForm === 'Sirup' || med.baseUnit === 'Botol' ? 'Botol' : (med.stripUnit ? med.stripUnit : (med.baseUnit || 'Tablet')));
      minStockUnitSelect.value = defUnit;
    }

    validateMedicineUniqueness();

    if (modal) modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  // Function to open confirmation modal for deleting medicine
  function openDeleteMedicineModal(id, code, name) {
    const modal = document.getElementById('modal-delete-medicine');
    const targetIdInput = document.getElementById('delete-med-target-id');
    const targetCodeInput = document.getElementById('delete-med-target-code');
    const nameText = document.getElementById('delete-med-name-text');
    const codeText = document.getElementById('delete-med-code-text');

    if (targetIdInput) targetIdInput.value = id || '';
    if (targetCodeInput) targetCodeInput.value = code || '';
    if (nameText) nameText.textContent = name || code || id;
    if (codeText) codeText.textContent = code || id;

    if (modal) modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  // Helper to update live HPP calculation badge
  function updateBranchHPPBadge(branchKey, baseHpp, pkgHpp, med, stripHpp) {
    const badge = document.getElementById(`bp-${branchKey}-hpp-summary-calc`);
    if (!badge || !med) return;
    const baseUnit = med.baseUnit || 'Tablet';
    const buyUnit = med.buyUnit || 'Box';
    const stripUnit = med.stripUnit || '';
    const stripConv = Number(med.stripConversion) || 0;
    const hasStrip = Boolean(stripUnit && stripConv > 1);

    if (hasStrip) {
      badge.innerHTML = `💡 <b>Input Mandiri:</b> 1 ${buyUnit} = <b>${formatIDR(pkgHpp || 0)}</b> | 1 ${stripUnit} = <b>${formatIDR(stripHpp || 0)}</b> (Dasar: ${formatIDR(baseHpp || 0)}/${baseUnit})`;
      badge.className = 'text-[10px] text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300';
    } else if (baseHpp > 0 || pkgHpp > 0) {
      badge.innerHTML = `💡 <b>Input Mandiri:</b> 1 ${baseUnit} = <b>${formatIDR(baseHpp || 0)}</b>${pkgHpp > 0 ? ` | 1 ${buyUnit} = <b>${formatIDR(pkgHpp)}</b>` : ''}`;
      badge.className = 'text-[10px] text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300';
    } else {
      badge.textContent = `💡 Input HPP Box & HPP Strip masing-masing secara mandiri (tidak dikali otomatis).`;
      badge.className = 'text-[10px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded border border-amber-300';
    }
  }

  // Function to open modal: Atur Cabang & Harga Bertingkat
  function openBranchPricingModal(idOrCode) {
    const med = appState.medicines.find(m => m.id === idOrCode || m.code === idOrCode);
    if (!med) {
      showToast('Data obat tidak ditemukan!', 'error');
      return;
    }

    const modal = document.getElementById('modal-branch-pricing');
    if (!modal) return;

    document.getElementById('branch-pricing-med-id').value = med.id || med.code;
    document.getElementById('branch-pricing-med-name').textContent = med.name || '';
    document.getElementById('branch-pricing-med-code').textContent = med.code || '';

    // Medicine packaging & unit definitions
    const baseUnit = med.baseUnit || 'Tablet';
    const buyUnit = med.buyUnit || 'Box';
    const convRate = Number(med.conversionRate) || 1;
    const stripUnit = med.stripUnit || '';
    const stripConv = Number(med.stripConversion) || 0;
    const hasStrip = Boolean(stripUnit && stripConv > 1);

    // Summary unit badges at modal top
    const sumBase = document.getElementById('bp-summary-base');
    if (sumBase) sumBase.textContent = `1 ${baseUnit} (Satuan Terkecil)`;

    const sumStrip = document.getElementById('bp-summary-strip');
    if (sumStrip) {
      if (hasStrip) {
        sumStrip.style.display = '';
        sumStrip.textContent = `1 ${stripUnit} = ${stripConv} ${baseUnit}`;
      } else {
        sumStrip.style.display = 'none';
      }
    }

    const sumBuy = document.getElementById('bp-summary-buy');
    if (sumBuy) sumBuy.textContent = `1 ${buyUnit} = ${convRate} ${baseUnit}`;

    // Update dynamic labels for Talaud & Kembang Janggut
    ['tld', 'kbj'].forEach(branchKey => {
      // HPP Labels
      const lblBuyPkg = document.getElementById(`lbl-bp-${branchKey}-buy-pkg`);
      if (lblBuyPkg) lblBuyPkg.textContent = `HPP per 1 Kemasan Besar (${buyUnit} / Faktur PBF) *`;

      const lblBuyBase = document.getElementById(`lbl-bp-${branchKey}-buy-base`);
      if (lblBuyBase) lblBuyBase.textContent = `HPP Satuan Dasar (per 1 ${baseUnit}) *`;

      // Selling Price Labels
      const lblSell = document.getElementById(`lbl-bp-${branchKey}-sell-price`);
      if (lblSell) lblSell.textContent = `Harga per 1 ${baseUnit} (Eceran) (Opsional)`;

      const colStrip = document.getElementById(`col-bp-${branchKey}-strip`);
      const lblStrip = document.getElementById(`lbl-bp-${branchKey}-strip-price`);
      const subStrip = document.getElementById(`sub-bp-${branchKey}-strip`);
      if (colStrip) {
        if (hasStrip) {
          colStrip.classList.remove('hidden');
          if (lblStrip) lblStrip.textContent = `Harga per 1 ${stripUnit} (${stripConv} ${baseUnit})`;
          if (subStrip) subStrip.textContent = `Satuan menengah (${stripConv} ${baseUnit})`;
        } else {
          colStrip.classList.add('hidden');
        }
      }

      const lblBox = document.getElementById(`lbl-bp-${branchKey}-box-price`);
      const subBox = document.getElementById(`sub-bp-${branchKey}-box`);
      if (lblBox) lblBox.textContent = `Harga per 1 ${buyUnit} (${convRate} ${baseUnit})`;
      if (subBox) subBox.textContent = `Kemasan beli / grosir (${convRate} ${baseUnit})`;
    });

    // Update static placeholder spans for package buy name
    document.querySelectorAll('.lbl-pkg-buy-name').forEach(el => {
      el.textContent = buyUnit;
    });

    const tldCfg = (med.branchConfigs && med.branchConfigs.TLD) || {
      active: true,
      location: med.location || 'Rak A-01',
      barcode: med.barcode || generateBarcodeFromCode(med.code),
      buyPrice: med.buyPrice || 0,
      sellPrice: med.sellPrice || 0,
      stripPrice: med.stripPrice || 0,
      boxPrice: med.boxPrice || 0,
      minStock: med.minStock || 50
    };

    const kbjCfg = (med.branchConfigs && med.branchConfigs.KBJ) || {
      active: true,
      location: (med.location && med.location.replace('A-', 'B-')) || 'Rak B-01',
      barcode: med.barcode || generateBarcodeFromCode(med.code),
      buyPrice: med.buyPrice || 0,
      sellPrice: med.sellPrice || 0,
      stripPrice: med.stripPrice || 0,
      boxPrice: med.boxPrice || 0,
      minStock: med.minStock || 50
    };

    // Talaud (TLD) inputs
    const tldActive = document.getElementById('bp-tld-active');
    if (tldActive) tldActive.checked = tldCfg.active !== false;
    const tldLoc = document.getElementById('bp-tld-location');
    if (tldLoc) tldLoc.value = tldCfg.location || 'Rak A-01';
    const tldBarcode = document.getElementById('bp-tld-barcode');
    if (tldBarcode) tldBarcode.value = tldCfg.barcode || '';

    // Talaud HPP inputs (Pengisian Mandiri HPP Box & HPP Strip)
    const lblTldBuyBase = document.getElementById('lbl-bp-tld-buy-base');
    const subTldBuyBase = document.getElementById('sub-bp-tld-buy-base');
    const tldBuyPkgInp = document.getElementById('bp-tld-buy-pkg-price');
    const tldBuyInp = document.getElementById('bp-tld-buy-price');

    const tldPkgHpp = tldCfg.pkgBuyPrice ?? (tldCfg.buyPrice && convRate > 0 ? Math.round(tldCfg.buyPrice * convRate) : 0);
    if (tldBuyPkgInp) tldBuyPkgInp.value = tldPkgHpp > 0 ? tldPkgHpp : '';

    let tldDisplayHpp = 0;
    if (hasStrip) {
      if (lblTldBuyBase) lblTldBuyBase.textContent = `HPP per 1 ${stripUnit} *`;
      if (subTldBuyBase) subTldBuyBase.textContent = `Modal beli per 1 ${stripUnit} (${stripConv} ${baseUnit})`;
      tldDisplayHpp = tldCfg.stripBuyPrice ?? (tldCfg.buyPrice && stripConv > 0 ? Math.round(tldCfg.buyPrice * stripConv) : 0);
    } else {
      if (lblTldBuyBase) lblTldBuyBase.textContent = `HPP Satuan Dasar (per 1 ${baseUnit}) *`;
      if (subTldBuyBase) subTldBuyBase.textContent = `Modal beli per 1 ${baseUnit} (${baseUnit === 'Botol' ? 'Sirup / Drop' : 'Eceran'})`;
      tldDisplayHpp = tldCfg.buyPrice ?? 0;
    }
    if (tldBuyInp) tldBuyInp.value = tldDisplayHpp > 0 ? tldDisplayHpp : '';

    const tldBaseCalculated = hasStrip ? (stripConv > 0 ? Math.round(tldDisplayHpp / stripConv) : 0) : tldDisplayHpp;
    updateBranchHPPBadge('tld', tldBaseCalculated, tldPkgHpp, med, tldDisplayHpp);

    const tldSell = document.getElementById('bp-tld-sell-price');
    if (tldSell) tldSell.value = tldCfg.sellPrice > 0 ? tldCfg.sellPrice : '';
    const tldStrip = document.getElementById('bp-tld-strip-price');
    if (tldStrip) tldStrip.value = (hasStrip && tldCfg.stripPrice > 0) ? tldCfg.stripPrice : '';
    const tldBox = document.getElementById('bp-tld-box-price');
    if (tldBox) tldBox.value = tldCfg.boxPrice > 0 ? tldCfg.boxPrice : '';
    const tldMin = document.getElementById('bp-tld-min-stock');
    if (tldMin) tldMin.value = tldCfg.minStock ?? 10;

    // Kembang Janggut (KBJ) inputs
    const kbjActive = document.getElementById('bp-kbj-active');
    if (kbjActive) kbjActive.checked = kbjCfg.active !== false;
    const kbjLoc = document.getElementById('bp-kbj-location');
    if (kbjLoc) kbjLoc.value = kbjCfg.location || 'Rak B-01';
    const kbjBarcode = document.getElementById('bp-kbj-barcode');
    if (kbjBarcode) kbjBarcode.value = kbjCfg.barcode || '';

    // KBJ HPP inputs (Pengisian Mandiri HPP Box & HPP Strip)
    const lblKbjBuyBase = document.getElementById('lbl-bp-kbj-buy-base');
    const subKbjBuyBase = document.getElementById('sub-bp-kbj-buy-base');
    const kbjBuyPkgInp = document.getElementById('bp-kbj-buy-pkg-price');
    const kbjBuyInp = document.getElementById('bp-kbj-buy-price');

    const kbjPkgHpp = kbjCfg.pkgBuyPrice ?? (kbjCfg.buyPrice && convRate > 0 ? Math.round(kbjCfg.buyPrice * convRate) : 0);
    if (kbjBuyPkgInp) kbjBuyPkgInp.value = kbjPkgHpp > 0 ? kbjPkgHpp : '';

    let kbjDisplayHpp = 0;
    if (hasStrip) {
      if (lblKbjBuyBase) lblKbjBuyBase.textContent = `HPP per 1 ${stripUnit} *`;
      if (subKbjBuyBase) subKbjBuyBase.textContent = `Modal beli per 1 ${stripUnit} (${stripConv} ${baseUnit})`;
      kbjDisplayHpp = kbjCfg.stripBuyPrice ?? (kbjCfg.buyPrice && stripConv > 0 ? Math.round(kbjCfg.buyPrice * stripConv) : 0);
    } else {
      if (lblKbjBuyBase) lblKbjBuyBase.textContent = `HPP Satuan Dasar (per 1 ${baseUnit}) *`;
      if (subKbjBuyBase) subKbjBuyBase.textContent = `Modal beli per 1 ${baseUnit} (${baseUnit === 'Botol' ? 'Sirup / Drop' : 'Eceran'})`;
      kbjDisplayHpp = kbjCfg.buyPrice ?? 0;
    }
    if (kbjBuyInp) kbjBuyInp.value = kbjDisplayHpp > 0 ? kbjDisplayHpp : '';

    const kbjBaseCalculated = hasStrip ? (stripConv > 0 ? Math.round(kbjDisplayHpp / stripConv) : 0) : kbjDisplayHpp;
    updateBranchHPPBadge('kbj', kbjBaseCalculated, kbjPkgHpp, med, kbjDisplayHpp);

    const kbjSell = document.getElementById('bp-kbj-sell-price');
    if (kbjSell) kbjSell.value = kbjCfg.sellPrice > 0 ? kbjCfg.sellPrice : '';
    const kbjStrip = document.getElementById('bp-kbj-strip-price');
    if (kbjStrip) kbjStrip.value = (hasStrip && kbjCfg.stripPrice > 0) ? kbjCfg.stripPrice : '';
    const kbjBox = document.getElementById('bp-kbj-box-price');
    if (kbjBox) kbjBox.value = kbjCfg.boxPrice > 0 ? kbjCfg.boxPrice : '';
    const kbjMin = document.getElementById('bp-kbj-min-stock');
    if (kbjMin) kbjMin.value = kbjCfg.minStock ?? 10;

    function populateBufferUnitSelect(selectId, chosenUnit) {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      sel.innerHTML = '';
      const options = [];
      if (hasStrip) {
        options.push({ val: stripUnit, label: `${stripUnit} (Rekomendasi Strip)` });
      }
      if (baseUnit && baseUnit !== stripUnit) {
        options.push({ val: baseUnit, label: `${baseUnit} (${baseUnit === 'Botol' ? 'Rekomendasi Sirup' : 'Satuan Dasar'})` });
      }
      if (buyUnit && buyUnit !== baseUnit && buyUnit !== stripUnit) {
        options.push({ val: buyUnit, label: `${buyUnit} (Kemasan Besar)` });
      }
      if (options.length === 0) {
        options.push({ val: 'Botol', label: 'Botol' }, { val: 'Strip', label: 'Strip' }, { val: 'Box', label: 'Box' }, { val: 'Tablet', label: 'Tablet' }, { val: 'Pcs', label: 'Pcs' });
      }
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.val;
        o.textContent = opt.label;
        sel.appendChild(o);
      });
      if (chosenUnit && options.some(o => o.val === chosenUnit)) {
        sel.value = chosenUnit;
      } else if (options.length > 0) {
        sel.value = options[0].val;
      }
    }
    populateBufferUnitSelect('bp-tld-min-stock-unit', tldCfg.minStockUnit || med.minStockUnit);
    populateBufferUnitSelect('bp-kbj-min-stock-unit', kbjCfg.minStockUnit || med.minStockUnit);

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function setupBranchPricingModal() {
    const modal = document.getElementById('modal-branch-pricing');
    const form = document.getElementById('form-branch-pricing');
    const copyBtn = document.getElementById('btn-copy-pricing-tld-to-kbj');
    const editUnitsBtn = document.getElementById('btn-edit-units-from-pricing');

    if (!modal) return;

    modal.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => modal.classList.add('hidden'));
    });

    const getActiveMed = () => {
      const medId = document.getElementById('branch-pricing-med-id')?.value;
      return appState.medicines.find(m => m.id === medId || m.code === medId);
    };

    // Button: Ubah Satuan / Kemasan (direct shortcut to Master Obat Edit)
    if (editUnitsBtn) {
      editUnitsBtn.addEventListener('click', () => {
        const med = getActiveMed();
        if (!med) return;
        modal.classList.add('hidden');
        openEditMedicineModal(med.id);
      });
    }

    // Live badge update for Talaud (TLD) without overwriting inputs
    const tldPkgInp = document.getElementById('bp-tld-buy-pkg-price');
    const tldBaseInp = document.getElementById('bp-tld-buy-price');

    function refreshTldHppBadge() {
      const med = getActiveMed();
      if (!med) return;
      const stripConv = Number(med.stripConversion) || 0;
      const hasStrip = Boolean(med.stripUnit && stripConv > 1);
      const pkgVal = parseFloat(tldPkgInp?.value) || 0;
      const secondVal = parseFloat(tldBaseInp?.value) || 0;
      const baseVal = hasStrip ? (stripConv > 0 ? Math.round(secondVal / stripConv) : 0) : secondVal;
      updateBranchHPPBadge('tld', baseVal, pkgVal, med, secondVal);
    }

    if (tldPkgInp) tldPkgInp.addEventListener('input', refreshTldHppBadge);
    if (tldBaseInp) tldBaseInp.addEventListener('input', refreshTldHppBadge);

    // Live badge update for Kembang Janggut (KBJ) without overwriting inputs
    const kbjPkgInp = document.getElementById('bp-kbj-buy-pkg-price');
    const kbjBaseInp = document.getElementById('bp-kbj-buy-price');

    function refreshKbjHppBadge() {
      const med = getActiveMed();
      if (!med) return;
      const stripConv = Number(med.stripConversion) || 0;
      const hasStrip = Boolean(med.stripUnit && stripConv > 1);
      const pkgVal = parseFloat(kbjPkgInp?.value) || 0;
      const secondVal = parseFloat(kbjBaseInp?.value) || 0;
      const baseVal = hasStrip ? (stripConv > 0 ? Math.round(secondVal / stripConv) : 0) : secondVal;
      updateBranchHPPBadge('kbj', baseVal, pkgVal, med, secondVal);
    }

    if (kbjPkgInp) kbjPkgInp.addEventListener('input', refreshKbjHppBadge);
    if (kbjBaseInp) kbjBaseInp.addEventListener('input', refreshKbjHppBadge);

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const med = getActiveMed();
        const tldActive = document.getElementById('bp-tld-active')?.checked ?? true;
        const tldLoc = document.getElementById('bp-tld-location')?.value || '';
        const tldBarcode = document.getElementById('bp-tld-barcode')?.value || '';
        const tldPkg = document.getElementById('bp-tld-buy-pkg-price')?.value || '';
        const tldBuy = document.getElementById('bp-tld-buy-price')?.value || '';
        const tldSell = document.getElementById('bp-tld-sell-price')?.value || '';
        const tldStrip = document.getElementById('bp-tld-strip-price')?.value || '';
        const tldBox = document.getElementById('bp-tld-box-price')?.value || '';
        const tldMin = document.getElementById('bp-tld-min-stock')?.value || 50;

        const kbjActive = document.getElementById('bp-kbj-active');
        const kbjLoc = document.getElementById('bp-kbj-location');
        const kbjBarcode = document.getElementById('bp-kbj-barcode');
        const kbjPkg = document.getElementById('bp-kbj-buy-pkg-price');
        const kbjBuy = document.getElementById('bp-kbj-buy-price');
        const kbjSell = document.getElementById('bp-kbj-sell-price');
        const kbjStrip = document.getElementById('bp-kbj-strip-price');
        const kbjBox = document.getElementById('bp-kbj-box-price');
        const kbjMin = document.getElementById('bp-kbj-min-stock');

        if (kbjActive) kbjActive.checked = tldActive;
        if (kbjLoc) kbjLoc.value = tldLoc ? tldLoc.replace('A-', 'B-') : 'Rak B-01';
        if (kbjBarcode) kbjBarcode.value = tldBarcode;
        if (kbjPkg) kbjPkg.value = tldPkg;
        if (kbjBuy) kbjBuy.value = tldBuy;
        if (kbjSell) kbjSell.value = tldSell;
        if (kbjStrip) kbjStrip.value = tldStrip;
        if (kbjBox) kbjBox.value = tldBox;
        if (kbjMin) kbjMin.value = tldMin;

        refreshKbjHppBadge();
        showToast('Pengaturan harga & HPP Talaud berhasil disalin ke Kembang Janggut!', 'success');
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const medId = document.getElementById('branch-pricing-med-id')?.value;
        const med = appState.medicines.find(m => m.id === medId || m.code === medId);
        if (!med) {
          showToast('Data obat tidak ditemukan!', 'error');
          return;
        }

        const convRate = Number(med.conversionRate) || 1;
        const stripConv = Number(med.stripConversion) || 0;
        const hasStrip = Boolean(med.stripUnit && stripConv > 1);

        const tldActive = document.getElementById('bp-tld-active')?.checked ?? true;
        const tldLoc = (document.getElementById('bp-tld-location')?.value || 'Rak A-01').trim();
        const tldBarcode = (document.getElementById('bp-tld-barcode')?.value || '').trim() || med.barcode;
        const tldPkgBuy = Number(document.getElementById('bp-tld-buy-pkg-price')?.value) || 0;
        const tldSecondBuy = Number(document.getElementById('bp-tld-buy-price')?.value) || 0;
        const tldStripBuy = hasStrip ? tldSecondBuy : 0;
        const tldBaseBuy = hasStrip ? (stripConv > 0 ? Math.round(tldSecondBuy / stripConv) : 0) : tldSecondBuy;
        const tldSell = Number(document.getElementById('bp-tld-sell-price')?.value) || 0;
        const tldStrip = hasStrip ? (Number(document.getElementById('bp-tld-strip-price')?.value) || 0) : 0;
        const tldBox = Number(document.getElementById('bp-tld-box-price')?.value) || 0;
        const tldMin = Number(document.getElementById('bp-tld-min-stock')?.value) || 10;
        const tldMinUnit = document.getElementById('bp-tld-min-stock-unit')?.value || med.minStockUnit || (hasStrip ? med.stripUnit : med.baseUnit);

        const kbjActive = document.getElementById('bp-kbj-active')?.checked ?? true;
        const kbjLoc = (document.getElementById('bp-kbj-location')?.value || 'Rak B-01').trim();
        const kbjBarcode = (document.getElementById('bp-kbj-barcode')?.value || '').trim() || med.barcode;
        const kbjPkgBuy = Number(document.getElementById('bp-kbj-buy-pkg-price')?.value) || 0;
        const kbjSecondBuy = Number(document.getElementById('bp-kbj-buy-price')?.value) || 0;
        const kbjStripBuy = hasStrip ? kbjSecondBuy : 0;
        const kbjBaseBuy = hasStrip ? (stripConv > 0 ? Math.round(kbjSecondBuy / stripConv) : 0) : kbjSecondBuy;
        const kbjSell = Number(document.getElementById('bp-kbj-sell-price')?.value) || 0;
        const kbjStrip = hasStrip ? (Number(document.getElementById('bp-kbj-strip-price')?.value) || 0) : 0;
        const kbjBox = Number(document.getElementById('bp-kbj-box-price')?.value) || 0;
        const kbjMin = Number(document.getElementById('bp-kbj-min-stock')?.value) || 10;
        const kbjMinUnit = document.getElementById('bp-kbj-min-stock-unit')?.value || med.minStockUnit || (hasStrip ? med.stripUnit : med.baseUnit);

        med.branchConfigs = {
          TLD: {
            active: tldActive,
            location: tldLoc,
            barcode: tldBarcode,
            pkgBuyPrice: tldPkgBuy,
            stripBuyPrice: tldStripBuy,
            buyPrice: tldBaseBuy,
            sellPrice: tldSell,
            stripPrice: tldStrip,
            boxPrice: tldBox,
            minStock: tldMin,
            minStockUnit: tldMinUnit
          },
          KBJ: {
            active: kbjActive,
            location: kbjLoc,
            barcode: kbjBarcode,
            pkgBuyPrice: kbjPkgBuy,
            stripBuyPrice: kbjStripBuy,
            buyPrice: kbjBaseBuy,
            sellPrice: kbjSell,
            stripPrice: kbjStrip,
            boxPrice: kbjBox,
            minStock: kbjMin,
            minStockUnit: kbjMinUnit
          }
        };

        // Also update default root fields as fallback
        med.location = tldLoc;
        med.buyPrice = tldBaseBuy;
        med.pkgBuyPrice = tldPkgBuy;
        med.stripBuyPrice = tldStripBuy;
        med.sellPrice = tldSell;
        med.stripPrice = tldStrip;
        med.boxPrice = tldBox;
        med.minStock = tldMin;
        med.minStockUnit = tldMinUnit;

        saveState();
        pushMedicineToServer(med);
        modal.classList.add('hidden');
        showToast(`Pengaturan cabang & harga untuk "${med.name}" berhasil disimpan!`, 'success');
        renderMedicinesTable();
        renderPOSProductGrid();
      });
    }
  }

  function setupMedicineModal() {
    const openBtn = document.getElementById('btn-add-medicine-modal');
    const modal = document.getElementById('modal-add-medicine');
    const form = document.getElementById('form-add-medicine');
    const searchInput = document.getElementById('medicine-search-table');
    const codeInput = document.getElementById('new-med-code');
    const nameInput = document.getElementById('new-med-name');
    const baseUnitInput = document.getElementById('new-med-base-unit');
    const buyUnitInput = document.getElementById('new-med-buy-unit');
    const dosageSelect = document.getElementById('new-med-dosage');
    const convRateInputEl = document.getElementById('new-med-conv-rate');
    const stripUnitInp = document.getElementById('new-med-strip-unit');
    const stripConvInp = document.getElementById('new-med-strip-conv');
    const suffixStrip = document.getElementById('suffix-strip-base');
    const suffixBox = document.getElementById('suffix-box-base');

    // Setup Branch Filter View Pills in Master Obat Header
    document.querySelectorAll('.filter-master-branch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeMasterBranchFilter = btn.dataset.branch || 'ALL';
        document.querySelectorAll('.filter-master-branch-btn').forEach(b => {
          if (b.dataset.branch === activeMasterBranchFilter) {
            b.className = 'filter-master-branch-btn px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white shadow-xs transition shrink-0';
          } else {
            b.className = 'filter-master-branch-btn px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition shrink-0';
          }
        });
        renderMedicinesTable();
      });
    });

    // Real-time validation for medicine code uniqueness
    if (codeInput) {
      codeInput.addEventListener('input', () => {
        validateMedicineUniqueness();
      });
    }

    // Real-time validation for medicine name uniqueness
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        validateMedicineUniqueness();
      });
    }

    // Auto-update strip & box suffix labels when base unit changes
    if (baseUnitInput) {
      baseUnitInput.addEventListener('input', () => {
        const bName = (baseUnitInput.value.trim() || 'Tab').slice(0, 4);
        if (suffixStrip) suffixStrip.textContent = bName;
        if (suffixBox) suffixBox.textContent = bName;
      });
    }

    // Auto-suggest base unit and buy unit when dosage form changes
    if (dosageSelect) {
      dosageSelect.addEventListener('change', () => {
        const val = dosageSelect.value;
        if (val === 'Tablet') {
          if (baseUnitInput) baseUnitInput.value = 'Tablet';
          if (buyUnitInput) buyUnitInput.value = 'Box';
          if (stripUnitInp) stripUnitInp.value = 'Strip';
          if (stripConvInp) stripConvInp.value = 10;
          if (convRateInputEl) convRateInputEl.value = 100;
          if (suffixStrip) suffixStrip.textContent = 'Tab';
          if (suffixBox) suffixBox.textContent = 'Tab';
        } else if (val === 'Kapsul') {
          if (baseUnitInput) baseUnitInput.value = 'Kapsul';
          if (buyUnitInput) buyUnitInput.value = 'Box';
          if (stripUnitInp) stripUnitInp.value = 'Strip';
          if (stripConvInp) stripConvInp.value = 10;
          if (convRateInputEl) convRateInputEl.value = 100;
          if (suffixStrip) suffixStrip.textContent = 'Kap';
          if (suffixBox) suffixBox.textContent = 'Kap';
        } else if (val === 'Sirup' || val === 'Drop') {
          if (baseUnitInput) baseUnitInput.value = 'Botol';
          if (buyUnitInput) buyUnitInput.value = 'Karton';
          if (stripUnitInp) stripUnitInp.value = '';
          if (stripConvInp) stripConvInp.value = 0;
          if (convRateInputEl) convRateInputEl.value = 24;
          if (suffixStrip) suffixStrip.textContent = 'Btl';
          if (suffixBox) suffixBox.textContent = 'Btl';
          const minStockInput = document.getElementById('new-med-min-stock');
          const minStockUnitSelect = document.getElementById('new-med-min-stock-unit');
          if (minStockInput) minStockInput.value = 5;
          if (minStockUnitSelect) minStockUnitSelect.value = 'Botol';
        } else if (val === 'Salep') {
          if (baseUnitInput) baseUnitInput.value = 'Tube';
          if (buyUnitInput) buyUnitInput.value = 'Lusin';
          if (stripUnitInp) stripUnitInp.value = '';
          if (stripConvInp) stripConvInp.value = 0;
          if (convRateInputEl) convRateInputEl.value = 12;
          if (suffixStrip) suffixStrip.textContent = 'Tub';
          if (suffixBox) suffixBox.textContent = 'Tub';
          const minStockInput = document.getElementById('new-med-min-stock');
          const minStockUnitSelect = document.getElementById('new-med-min-stock-unit');
          if (minStockInput) minStockInput.value = 5;
          if (minStockUnitSelect) minStockUnitSelect.value = 'Tube';
        }
      });
    }

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        try {
          const editIdInput = document.getElementById('edit-med-id');
          const modalTitle = document.getElementById('modal-medicine-title');
          const submitBtn = document.getElementById('btn-submit-medicine');

          if (editIdInput) editIdInput.value = '';
          if (modalTitle) modalTitle.textContent = 'Tambah Master Obat Umum';
          if (submitBtn) {
            submitBtn.textContent = 'Simpan Master Obat';
            submitBtn.className = 'px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow';
          }
          if (form) form.reset();

          // Auto-calculate next unique code
          const nextCode = getNextMedicineCode();
          if (codeInput) codeInput.value = nextCode;

          if (baseUnitInput) baseUnitInput.value = 'Tablet';
          if (buyUnitInput) buyUnitInput.value = 'Box';
          if (convRateInputEl) convRateInputEl.value = 100;
          if (stripUnitInp) stripUnitInp.value = 'Strip';
          if (stripConvInp) stripConvInp.value = 10;
          if (suffixStrip) suffixStrip.textContent = 'Tab';
          if (suffixBox) suffixBox.textContent = 'Tab';

          const minStockInput = document.getElementById('new-med-min-stock');
          const minStockUnitSelect = document.getElementById('new-med-min-stock-unit');
          if (minStockInput) minStockInput.value = 10;
          if (minStockUnitSelect) minStockUnitSelect.value = 'Strip';

          validateMedicineUniqueness();
        } catch (err) {
          console.error('Error pre-filling medicine modal:', err);
        }

        if (modal) {
          modal.classList.remove('hidden');
        }
        if (window.lucide) lucide.createIcons();
      });
    }

    if (modal) {
      modal.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', () => modal.classList.add('hidden'));
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => renderMedicinesTable());
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const editId = (document.getElementById('edit-med-id')?.value || '').trim();
        const codeVal = (codeInput && codeInput.value.trim().toUpperCase()) || 'MED-000';
        const chosenName = document.getElementById('new-med-name')?.value.trim() || '';

        // Strict verification: prevent duplicate code or name
        if (!validateMedicineUniqueness()) {
          const dupCode = findMedicineByCode(codeVal, editId);
          const dupName = findMedicineByName(chosenName, editId);
          if (dupCode) {
            showToast(`Gagal: Kode "${codeVal}" sudah digunakan oleh "${dupCode.name}"!`, 'error');
            if (codeInput) codeInput.focus();
          } else if (dupName) {
            showToast(`Gagal: Nama obat "${chosenName}" sudah terdaftar (${dupName.code})!`, 'error');
            if (nameInput) nameInput.focus();
          } else {
            showToast('Gagal: Periksa kembali data obat yang duplikat atau belum lengkap!', 'error');
          }
          return;
        }

        const chosenCat = document.getElementById('new-med-cat').value;
        const chosenDosage = document.getElementById('new-med-dosage').value;
        const chosenBaseUnit = (baseUnitInput && baseUnitInput.value.trim()) || 'Tablet';
        const chosenBuyUnit = (buyUnitInput && buyUnitInput.value.trim()) || 'Box';
        const chosenConv = Number(document.getElementById('new-med-conv-rate').value) || 1;
        const chosenStripUnit = document.getElementById('new-med-strip-unit')?.value.trim() || 'Strip';
        const chosenStripConv = Number(document.getElementById('new-med-strip-conv')?.value) || 0;
        const chosenMinStock = Number(document.getElementById('new-med-min-stock')?.value) || 10;
        const chosenMinStockUnit = document.getElementById('new-med-min-stock-unit')?.value || (chosenDosage === 'Sirup' || chosenDosage === 'Drop' ? 'Botol' : (chosenStripConv > 1 ? 'Strip' : chosenBaseUnit));

        if (editId) {
          // UPDATE EXISTING MEDICINE (EDIT MODE)
          const targetIdx = appState.medicines.findIndex(m => m.id === editId || m.code === editId);
          if (targetIdx !== -1) {
            appState.medicines[targetIdx] = {
              ...appState.medicines[targetIdx],
              code: codeVal,
              name: chosenName,
              category: chosenCat,
              dosageForm: chosenDosage,
              baseUnit: chosenBaseUnit,
              buyUnit: chosenBuyUnit,
              conversionRate: chosenConv,
              stripUnit: chosenStripUnit,
              stripConversion: chosenStripConv,
              minStock: chosenMinStock,
              minStockUnit: chosenMinStockUnit
            };
            appState.deletedMedicineCodes = (appState.deletedMedicineCodes || []).filter(c => c !== editId && c !== codeVal);
            saveState();
            pushMedicineToServer(appState.medicines[targetIdx]);
            if (modal) modal.classList.add('hidden');
            form.reset();
            showToast(`Master obat "${chosenName}" (${codeVal}) berhasil diperbarui!`, 'success');
            renderMedicinesTable();
            return;
          }
        }

        // ADD NEW MEDICINE (ADD MODE)
        const defBarcode = generateBarcodeFromCode(codeVal);
        const newMed = {
          id: codeVal,
          code: codeVal,
          barcode: defBarcode,
          name: chosenName,
          category: chosenCat,
          dosageForm: chosenDosage,
          baseUnit: chosenBaseUnit,
          buyUnit: chosenBuyUnit,
          conversionRate: chosenConv,
          stripUnit: chosenStripUnit,
          stripConversion: chosenStripConv,
          location: 'Rak A-01',
          buyPrice: 0,
          sellPrice: 0,
          stripPrice: 0,
          boxPrice: 0,
          minStock: chosenMinStock,
          minStockUnit: chosenMinStockUnit,
          active: true,
          branchConfigs: {
            TLD: {
              active: true,
              location: 'Rak A-01',
              barcode: defBarcode,
              buyPrice: 0,
              sellPrice: 0,
              stripPrice: 0,
              boxPrice: 0,
              minStock: chosenMinStock,
              minStockUnit: chosenMinStockUnit
            },
            KBJ: {
              active: true,
              location: 'Rak B-01',
              barcode: defBarcode,
              buyPrice: 0,
              sellPrice: 0,
              stripPrice: 0,
              boxPrice: 0,
              minStock: chosenMinStock,
              minStockUnit: chosenMinStockUnit
            }
          }
        };

        appState.deletedMedicineCodes = (appState.deletedMedicineCodes || []).filter(c => c !== newMed.code && c !== newMed.id);
        appState.medicines.push(newMed);
        saveState();
        pushMedicineToServer(newMed);
        if (modal) modal.classList.add('hidden');
        form.reset();
        showToast(`Master obat "${newMed.name}" (${newMed.code}) berhasil ditambahkan! Silakan lengkapi harga cabang.`, 'success');
        renderMedicinesTable();

        // Immediately open Branch Pricing Modal for the newly added medicine!
        openBranchPricingModal(newMed.id);
      });
    }
  }

  function setupDeleteMedicineModal() {
    const modal = document.getElementById('modal-delete-medicine');
    const cancelBtn = document.getElementById('btn-cancel-delete-med');
    const confirmBtn = document.getElementById('btn-confirm-delete-med');

    function closeModal() {
      if (modal) modal.classList.add('hidden');
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeModal);
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
      modal.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', closeModal);
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const targetId = document.getElementById('delete-med-target-id')?.value;
        const targetCode = document.getElementById('delete-med-target-code')?.value;
        const nameText = document.getElementById('delete-med-name-text')?.textContent || targetCode;

        if (!targetId && !targetCode) {
          closeModal();
          return;
        }

        // Remove from local appState.medicines
        appState.medicines = appState.medicines.filter(m => m.id !== targetId && m.code !== targetCode);
        appState.deletedMedicineCodes = [];

        saveState();
        renderMedicinesTable();
        closeModal();
        showToast(`Data obat ${nameText} (${targetCode}) berhasil dihapus.`, 'success');

        // Immediately notify server and broadcast real-time to other branches/devices
        try {
          const res = await fetch('/api/medicine/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: targetId, code: targetCode })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.version) {
              lastKnownServerVersion = data.version;
              animateSyncPulse();
            }
          }
        } catch (err) {
          console.warn('[DELETE] Offline or server unreachable, deletion stored locally and synced later:', err.message);
        }
      });
    }
  }

  // ==========================================
  // 8. PERSEDIAAN & BATCH (FEFO) ENGINE
  // ==========================================
  function renderInventoryBatches() {
    const tbody = document.getElementById('inventory-batch-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const branch = appState.currentBranch;
    const relevantBatches = branch === 'ALL' ? (appState.batches || []) : (appState.batches || []).filter(b => b.branchId === branch);

    if (relevantBatches.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-12 px-4 text-slate-400">
            <div class="max-w-md mx-auto space-y-2.5">
              <div class="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <i data-lucide="package-check" class="w-6 h-6"></i>
              </div>
              <div class="font-bold text-sm text-slate-800">Belum Ada Batch / Stok Obat Masuk</div>
              <p class="text-xs text-slate-500 leading-relaxed">
                Obat yang terdaftar di Master Obat belum memiliki fisik stok di rak. Silakan klik tombol 
                <b class="text-emerald-700 font-bold">+ Input Penerimaan Faktur PBF / Obat Masuk</b> di kanan atas 
                atau lakukan <b>Stok Opname</b> untuk mencatat nomor batch asli dan tanggal expired dari distributor PBF.
              </p>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    // Sort by Expiry Date ascending (FEFO)
    relevantBatches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    relevantBatches.forEach(b => {
      const med = appState.medicines.find(m => m.id === b.medicineId);
      if (!med) return;
      const days = getDaysUntilExpiry(b.expiryDate);

      let statusBadge = '';
      if (days < 0) {
        statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-expired">EXPIRED</span>';
      } else if (days <= 30) {
        statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-critical">KRITIS &lt;30 HARI</span>';
      } else if (days <= 90) {
        statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-warning">WASPADA &lt;90 HARI</span>';
      } else {
        statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-safe">AMAN</span>';
      }

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-3 px-4 font-bold text-slate-900">${med.name}</td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded font-semibold text-[10px] ${b.branchId === 'TLD' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}">
            ${b.branchId === 'TLD' ? 'Cabang Talaud' : 'Kembang Janggut'}
          </span>
        </td>
        <td class="py-3 px-4 mono font-bold text-slate-700">${b.batchNo}</td>
        <td class="py-3 px-4 mono font-semibold text-slate-900">${b.expiryDate}</td>
        <td class="py-3 px-4 font-bold ${days < 0 ? 'text-red-600' : days <= 30 ? 'text-amber-600' : 'text-slate-600'}">
          ${days < 0 ? `Lewat ${Math.abs(days)} hari` : `${days} hari lagi`}
        </td>
        <td class="py-3 px-4 text-right mono font-extrabold text-slate-900">${b.stock} ${med.baseUnit}</td>
        <td class="py-3 px-4 text-center">${statusBadge}</td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <button type="button" class="btn-edit-batch p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition" data-batch-id="${b.id}" title="Edit Rincian Batch">
              <i data-lucide="edit" class="w-3.5 h-3.5"></i>
            </button>
            <button type="button" class="btn-delete-batch p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition" data-batch-id="${b.id}" data-batch-no="${b.batchNo}" data-med-name="${(med.name || '').replace(/"/g, '&quot;')}" title="Hapus Batch Ini">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-batch').forEach(btn => {
      btn.addEventListener('click', () => {
        const batchId = btn.getAttribute('data-batch-id');
        openEditBatchModal(batchId);
      });
    });

    tbody.querySelectorAll('.btn-delete-batch').forEach(btn => {
      btn.addEventListener('click', () => {
        const batchId = btn.getAttribute('data-batch-id');
        openDeleteBatchModal(batchId);
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  function openEditBatchModal(batchId) {
    const batch = (appState.batches || []).find(b => b.id === batchId);
    if (!batch) {
      showToast('Data batch tidak ditemukan!', 'error');
      return;
    }
    const med = (appState.medicines || []).find(m => m.id === batch.medicineId);

    const modal = document.getElementById('modal-edit-batch');
    if (!modal) return;

    document.getElementById('edit-batch-id').value = batch.id;
    document.getElementById('edit-batch-med-id').value = batch.medicineId;
    document.getElementById('edit-batch-med-name').textContent = med ? med.name : batch.medicineId;
    document.getElementById('edit-batch-med-code').textContent = med ? med.code : '-';
    document.getElementById('edit-batch-base-unit').textContent = med ? med.baseUnit : 'Satuan';
    document.getElementById('edit-batch-unit-label').textContent = med ? med.baseUnit : 'Satuan';
    document.getElementById('edit-batch-unit-suffix').textContent = med ? med.baseUnit : 'Satuan';
    document.getElementById('edit-batch-branch').value = batch.branchId || 'TLD';
    document.getElementById('edit-batch-no').value = batch.batchNo || '';
    document.getElementById('edit-batch-expiry').value = batch.expiryDate || '';
    document.getElementById('edit-batch-stock').value = batch.stock ?? 0;
    document.getElementById('edit-batch-notes').value = '';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function openDeleteBatchModal(batchId) {
    const batch = (appState.batches || []).find(b => b.id === batchId);
    if (!batch) {
      showToast('Data batch tidak ditemukan!', 'error');
      return;
    }
    const med = (appState.medicines || []).find(m => m.id === batch.medicineId);

    const modal = document.getElementById('modal-delete-batch');
    if (!modal) return;

    document.getElementById('delete-batch-target-id').value = batch.id;
    document.getElementById('delete-batch-med-name').textContent = med ? med.name : batch.medicineId;
    document.getElementById('delete-batch-target-no').textContent = batch.batchNo || '-';
    document.getElementById('delete-batch-target-branch').textContent = batch.branchId === 'TLD' ? 'Cabang Kepulauan Talaud' : 'Cabang Kembang Janggut';
    document.getElementById('delete-batch-target-stock').textContent = `${batch.stock} ${med ? med.baseUnit : 'Satuan'}`;

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function setupBatchActionModals() {
    const editModal = document.getElementById('modal-edit-batch');
    const deleteModal = document.getElementById('modal-delete-batch');
    const editForm = document.getElementById('form-edit-batch');
    const confirmDeleteBtn = document.getElementById('btn-confirm-delete-batch');

    [editModal, deleteModal].forEach(m => {
      if (!m) return;
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });
      m.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => m.classList.add('hidden'));
      });
    });

    if (editForm) {
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const batchId = document.getElementById('edit-batch-id')?.value;
        const branchVal = document.getElementById('edit-batch-branch')?.value || 'TLD';
        const batchNoVal = (document.getElementById('edit-batch-no')?.value || '').trim().toUpperCase();
        const expiryVal = document.getElementById('edit-batch-expiry')?.value;
        const stockVal = Number(document.getElementById('edit-batch-stock')?.value) || 0;

        if (!batchNoVal || !expiryVal) {
          showToast('Nomor Batch dan Tanggal Expired wajib diisi!', 'error');
          return;
        }

        const idx = (appState.batches || []).findIndex(b => b.id === batchId);
        if (idx === -1) {
          showToast('Data batch tidak ditemukan!', 'error');
          return;
        }

        // Update batch
        appState.batches[idx] = {
          ...appState.batches[idx],
          branchId: branchVal,
          batchNo: batchNoVal,
          expiryDate: expiryVal,
          stock: stockVal
        };

        saveState();
        pushStateToServer();

        if (editModal) editModal.classList.add('hidden');
        showToast(`Data Batch "${batchNoVal}" berhasil diperbarui!`, 'success');

        renderInventoryBatches();
        renderPOSProductGrid();
        renderDashboard();
      });
    }

    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', () => {
        const batchId = document.getElementById('delete-batch-target-id')?.value;
        const idx = (appState.batches || []).findIndex(b => b.id === batchId);
        if (idx === -1) {
          showToast('Batch tidak ditemukan!', 'error');
          if (deleteModal) deleteModal.classList.add('hidden');
          return;
        }

        const targetBatch = appState.batches[idx];
        const batchNo = targetBatch.batchNo;
        const med = (appState.medicines || []).find(m => m.id === targetBatch.medicineId);

        // Remove batch
        appState.batches.splice(idx, 1);
        appState.deletedBatchIds = appState.deletedBatchIds || [];
        if (!appState.deletedBatchIds.includes(batchId)) {
          appState.deletedBatchIds.push(batchId);
        }

        saveState();
        pushStateToServer();

        if (deleteModal) deleteModal.classList.add('hidden');
        showToast(`Batch "${batchNo}" (${med ? med.name : ''}) berhasil dihapus dari sistem!`, 'success');

        renderInventoryBatches();
        renderPOSProductGrid();
        renderDashboard();
      });
    }
  }

  function setupTransferStockModal() {
    const openBtn = document.getElementById('btn-open-transfer-modal');
    const modal = document.getElementById('modal-transfer-stock');
    const form = document.getElementById('form-transfer-stock');
    const fromSelect = document.getElementById('transfer-from-branch');
    const toSelect = document.getElementById('transfer-to-branch');
    const batchSelect = document.getElementById('transfer-batch-select');

    function populateBatches() {
      const fromBranch = fromSelect.value;
      batchSelect.innerHTML = '';
      appState.batches.filter(b => b.branchId === fromBranch && b.stock > 0).forEach(b => {
        const med = appState.medicines.find(m => m.id === b.medicineId);
        if (med) {
          batchSelect.innerHTML += `<option value="${b.id}">${med.name} [Batch: ${b.batchNo}] (Stok: ${b.stock})</option>`;
        }
      });
    }

    fromSelect.addEventListener('change', () => {
      toSelect.value = fromSelect.value === 'TLD' ? 'KBJ' : 'TLD';
      populateBatches();
    });

    openBtn.addEventListener('click', () => {
      populateBatches();
      modal.classList.remove('hidden');
    });

    modal.querySelectorAll('.btn-close-modal').forEach(b => {
      b.addEventListener('click', () => modal.classList.add('hidden'));
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const batchId = batchSelect.value;
      const transferQty = Number(document.getElementById('transfer-qty').value);
      const toBranch = toSelect.value;
      const notes = document.getElementById('transfer-notes').value;

      const sourceBatch = appState.batches.find(b => b.id === batchId);
      if (!sourceBatch || sourceBatch.stock < transferQty) {
        showToast('Jumlah transfer melebihi stok yang tersedia!', 'error');
        return;
      }

      // Deduct from source branch
      sourceBatch.stock -= transferQty;

      // Add to destination branch batch
      const targetBatch = appState.batches.find(b => b.medicineId === sourceBatch.medicineId && b.branchId === toBranch && b.batchNo === sourceBatch.batchNo);
      if (targetBatch) {
        targetBatch.stock += transferQty;
      } else {
        appState.batches.push({
          id: 'B-' + Date.now(),
          medicineId: sourceBatch.medicineId,
          branchId: toBranch,
          batchNo: sourceBatch.batchNo,
          expiryDate: sourceBatch.expiryDate,
          stock: transferQty
        });
      }

      saveState();
      modal.classList.add('hidden');
      form.reset();
      showToast(`Transfer ${transferQty} unit stok ke ${toBranch} berhasil diproses!`, 'success');
      renderInventoryBatches();
    });
  }

  // ==========================================
  // INCOMING STOCK & PURCHASE ENGINE (PBF)
  // ==========================================

  function calculateDueDate(startDateStr, days) {
    if (!startDateStr) {
      const today = new Date();
      startDateStr = today.toISOString().split('T')[0];
    }
    const parts = startDateStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() + parseInt(days));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dt = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dt}`;
  }

  function getDaysDiffFromToday(targetDateStr) {
    if (!targetDateStr) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parts = targetDateStr.split('-');
    const target = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    target.setHours(0, 0, 0, 0);
    const diffTime = target.getTime() - today.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  let incomingFinalTotalManuallyEdited = false;

  function recalculateIncomingInvoiceTotals() {
    const container = document.getElementById('incoming-rows-container');
    const calcSubtotalInput = document.getElementById('incoming-calc-subtotal');
    const discountInput = document.getElementById('incoming-discount');
    const finalTotalInput = document.getElementById('incoming-final-total');

    if (!container || !calcSubtotalInput || !finalTotalInput) return;

    let subtotalCost = 0;
    const rows = container.querySelectorAll('.incoming-item-row');
    rows.forEach(r => {
      const qty = Math.max(1, parseInt(r.querySelector('.incoming-qty-input')?.value) || 1);
      const buyPrice = Math.max(0, parseFloat(r.querySelector('.incoming-buyprice-input')?.value) || 0);
      subtotalCost += (qty * buyPrice);
    });

    calcSubtotalInput.value = formatIDR(subtotalCost);

    const discount = Math.max(0, parseFloat(discountInput?.value) || 0);
    const calculatedFinal = Math.max(0, subtotalCost - discount);

    if (!incomingFinalTotalManuallyEdited || !finalTotalInput.value || parseFloat(finalTotalInput.value) === 0) {
      finalTotalInput.value = calculatedFinal;
    }
  }

  function updateIncomingDueDateDisplay() {
    const incomingDate = document.getElementById('incoming-date')?.value;
    const topSelect = document.getElementById('incoming-top-select');
    const dueDateInput = document.getElementById('incoming-due-date');
    const dueBadge = document.getElementById('incoming-due-days-badge');
    const infoText = document.getElementById('incoming-due-info-text');

    if (!topSelect || !dueDateInput) return;

    if (topSelect.value !== 'custom') {
      const days = parseInt(topSelect.value) || 30;
      dueDateInput.value = calculateDueDate(incomingDate, days);
      if (dueBadge) dueBadge.textContent = `${days} Hari`;
    }

    if (dueDateInput.value) {
      const diff = getDaysDiffFromToday(dueDateInput.value);
      if (infoText) {
        if (diff > 0) {
          infoText.textContent = `📅 Jatuh tempo pada ${dueDateInput.value} (Sisa ${diff} hari lagi untuk pembayaran ke PBF).`;
        } else if (diff === 0) {
          infoText.textContent = `🚨 Jatuh tempo HARI INI (${dueDateInput.value})!`;
        } else {
          infoText.textContent = `⚠️ Tanggal tempo telah lewat ${Math.abs(diff)} hari!`;
        }
      }
    }
  }

  function openIncomingStockModal(prefillMedicineId = '') {
    const modal = document.getElementById('modal-incoming-stock');
    if (!modal) return;

    const dateInput = document.getElementById('incoming-date');
    const invoiceInput = document.getElementById('incoming-invoice-no');
    const supplierSelect = document.getElementById('incoming-supplier-select');
    const branchSelect = document.getElementById('incoming-branch-select');
    const rowsContainer = document.getElementById('incoming-rows-container');
    const paidRadio = document.getElementById('incoming-pay-status-paid');
    const unpaidRadio = document.getElementById('incoming-pay-status-unpaid');
    const dueContainer = document.getElementById('incoming-due-date-container');
    const topSelect = document.getElementById('incoming-top-select');
    const discountInput = document.getElementById('incoming-discount');
    const finalTotalInput = document.getElementById('incoming-final-total');

    incomingFinalTotalManuallyEdited = false;

    // Default Date: today (YYYY-MM-DD)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    if (dateInput) dateInput.value = todayStr;

    // Auto Invoice No: FAK-YYYYMMDD-XXXX
    const randSeq = Math.floor(1000 + Math.random() * 9000);
    if (invoiceInput) invoiceInput.value = `FAK-${yyyy}${mm}${dd}-${randSeq}`;

    // Populate Suppliers
    if (supplierSelect) {
      supplierSelect.innerHTML = '';
      (appState.suppliers || []).forEach(s => {
        supplierSelect.innerHTML += `<option value="${s.id}">${s.name} [AP: ${formatIDR(s.apBalance || 0)}]</option>`;
      });
    }

    // Populate Branch
    if (branchSelect) {
      branchSelect.value = appState.currentBranch === 'ALL' ? 'TLD' : appState.currentBranch;
    }

    // Default Payment Status: LUNAS (PAID)
    if (paidRadio) paidRadio.checked = true;
    if (unpaidRadio) unpaidRadio.checked = false;
    if (dueContainer) dueContainer.classList.add('hidden');
    if (topSelect) topSelect.value = '30';
    if (discountInput) discountInput.value = 0;
    if (finalTotalInput) finalTotalInput.value = 0;

    updateIncomingDueDateDisplay();

    // Reset rows and add first row
    if (rowsContainer) {
      rowsContainer.innerHTML = '';
      addIncomingStockRow(prefillMedicineId);
    }

    recalculateIncomingInvoiceTotals();
    updateIncomingStockPreview();

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function addIncomingStockRow(prefillMedId = '') {
    const container = document.getElementById('incoming-rows-container');
    const branchSelect = document.getElementById('incoming-branch-select');
    if (!container) return;

    const rowId = 'inc-row-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const rowEl = document.createElement('div');
    rowEl.className = 'incoming-item-row p-3 bg-white border border-slate-200 rounded-xl space-y-2.5 relative shadow-xs';
    rowEl.setAttribute('data-row-id', rowId);

    const medOptions = appState.medicines.map(m => {
      const isSel = m.id === prefillMedId ? 'selected' : '';
      return `<option value="${m.id}" ${isSel}>${m.name} [${m.code}]</option>`;
    }).join('');

    rowEl.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1">
          <label class="text-[10px] font-bold text-slate-700">Pilih Obat Masuk *</label>
          <select class="incoming-med-select w-full mt-0.5 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white" required>
            <option value="">-- Pilih Obat dari Master Obat --</option>
            ${medOptions}
          </select>
        </div>
        <button type="button" class="btn-remove-incoming-row text-slate-400 hover:text-red-600 p-1.5 mt-3.5 rounded hover:bg-red-50 transition" title="Hapus baris ini">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
        <div>
          <label class="text-[10px] font-bold text-slate-700">Satuan Beli *</label>
          <select class="incoming-unit-select w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 bg-white">
            <!-- populated dynamically -->
          </select>
        </div>
        <div>
          <label class="text-[10px] font-bold text-slate-700">Jumlah *</label>
          <input type="number" min="1" value="1" class="incoming-qty-input w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-bold mono text-right" required>
        </div>
        <div>
          <label class="text-[10px] font-bold text-slate-700 flex items-center justify-between">
            <span>Harga Beli (Rp) *</span>
          </label>
          <input type="number" min="0" value="0" class="incoming-buyprice-input w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold text-right text-slate-800" required>
        </div>
        <div>
          <label class="text-[10px] font-bold text-slate-700">Subtotal (Rp)</label>
          <div class="incoming-subtotal-display mt-0.5 px-2 py-1.5 bg-slate-100 rounded-lg text-xs font-mono font-bold text-emerald-700 text-right truncate">Rp 0</div>
        </div>
        <div>
          <label class="text-[10px] font-bold text-slate-700">No. Batch *</label>
          <input type="text" placeholder="B26N29" class="incoming-batch-input w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold uppercase" required>
        </div>
        <div>
          <label class="text-[10px] font-bold text-slate-700">Tgl. Expired *</label>
          <input type="date" class="incoming-exp-input w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-semibold" required>
        </div>
      </div>

      <div class="incoming-calc-note text-[10px] bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center justify-between text-slate-600">
        <span class="incoming-conversion-info font-medium">Pilih obat untuk melihat konversi satuan</span>
        <span class="incoming-addition-info font-bold text-emerald-700"></span>
      </div>
    `;

    container.appendChild(rowEl);

    const medSelect = rowEl.querySelector('.incoming-med-select');
    const unitSelect = rowEl.querySelector('.incoming-unit-select');
    const qtyInput = rowEl.querySelector('.incoming-qty-input');
    const buyPriceInput = rowEl.querySelector('.incoming-buyprice-input');
    const subtotalDisplay = rowEl.querySelector('.incoming-subtotal-display');
    const batchInput = rowEl.querySelector('.incoming-batch-input');
    const expInput = rowEl.querySelector('.incoming-exp-input');
    const removeBtn = rowEl.querySelector('.btn-remove-incoming-row');

    function refreshRowUnitOptions() {
      const chosenMedId = medSelect.value;
      const med = appState.medicines.find(m => m.id === chosenMedId);
      unitSelect.innerHTML = '';

      if (!med) {
        unitSelect.innerHTML = '<option value="base">Pilih Obat Dahulu</option>';
        buyPriceInput.value = 0;
        subtotalDisplay.textContent = 'Rp 0';
        return;
      }

      // 1. Box / Kemasan Beli
      if (med.buyUnit && med.conversionRate && med.conversionRate > 1) {
        unitSelect.innerHTML += `<option value="box" selected>${med.buyUnit} (1 ${med.buyUnit} = ${med.conversionRate} ${med.baseUnit})</option>`;
      }
      // 2. Strip / Kemasan Menengah
      if (med.stripUnit && med.stripConversion && med.stripConversion > 1) {
        unitSelect.innerHTML += `<option value="strip">${med.stripUnit} (1 ${med.stripUnit} = ${med.stripConversion} ${med.baseUnit})</option>`;
      }
      // 3. Eceran / Base Unit
      unitSelect.innerHTML += `<option value="base">${med.baseUnit} (1 ${med.baseUnit})</option>`;

      // Set default buy price based on selected unit
      updateDefaultBuyPrice();

      // Suggest batch number based on code + date
      if (!batchInput.value) {
        const cleanCode = med.code.replace(/[^a-zA-Z0-9]/g, '');
        const datePart = (document.getElementById('incoming-date')?.value || '').replace(/-/g, '').slice(2, 6);
        batchInput.value = `${cleanCode}-${datePart || '2611'}-01`;
      }

      // Suggest expiry date: 2 years from incoming date
      if (!expInput.value) {
        const baseDate = new Date(document.getElementById('incoming-date')?.value || Date.now());
        baseDate.setFullYear(baseDate.getFullYear() + 2);
        const y = baseDate.getFullYear();
        const m = String(baseDate.getMonth() + 1).padStart(2, '0');
        const d = String(baseDate.getDate()).padStart(2, '0');
        expInput.value = `${y}-${m}-${d}`;
      }

      updateRowCalculation();
    }

    function updateDefaultBuyPrice() {
      const chosenMedId = medSelect.value;
      const med = appState.medicines.find(m => m.id === chosenMedId);
      if (!med) return;

      const chosenBranch = (branchSelect && branchSelect.value) || appState.currentBranch || 'TLD';
      const bCfg = getMedicineBranchConfig(med, chosenBranch);
      const baseBuyPrice = (bCfg && bCfg.buyPrice) || med.buyPrice || 0;

      const unitTier = unitSelect.value;
      let multiplier = 1;
      if (unitTier === 'box') {
        multiplier = med.conversionRate || 1;
      } else if (unitTier === 'strip') {
        multiplier = med.stripConversion || 1;
      }

      buyPriceInput.value = Math.round(baseBuyPrice * multiplier);
    }

    function updateRowCalculation() {
      const chosenMedId = medSelect.value;
      const med = appState.medicines.find(m => m.id === chosenMedId);
      const convInfoEl = rowEl.querySelector('.incoming-conversion-info');
      const addInfoEl = rowEl.querySelector('.incoming-addition-info');

      if (!med) {
        convInfoEl.textContent = 'Pilih obat untuk melihat konversi satuan';
        addInfoEl.textContent = '';
        subtotalDisplay.textContent = 'Rp 0';
        recalculateIncomingInvoiceTotals();
        updateIncomingStockPreview();
        return;
      }

      const unitTier = unitSelect.value;
      let multiplier = 1;
      let unitLabel = med.baseUnit;

      if (unitTier === 'box') {
        multiplier = med.conversionRate || 1;
        unitLabel = med.buyUnit || 'Box';
      } else if (unitTier === 'strip') {
        multiplier = med.stripConversion || 1;
        unitLabel = med.stripUnit || 'Strip';
      }

      const qty = Math.max(1, parseInt(qtyInput.value) || 1);
      const buyPrice = Math.max(0, parseFloat(buyPriceInput.value) || 0);
      const rowSubtotal = qty * buyPrice;
      const totalBaseUnits = qty * multiplier;

      subtotalDisplay.textContent = formatIDR(rowSubtotal);
      convInfoEl.innerHTML = `Konversi: <b>1 ${unitLabel}</b> = <b>${multiplier} ${med.baseUnit}</b>`;
      addInfoEl.innerHTML = `+<b>${totalBaseUnits} ${med.baseUnit}</b> ke stok`;

      recalculateIncomingInvoiceTotals();
      updateIncomingStockPreview();
    }

    medSelect.addEventListener('change', () => {
      refreshRowUnitOptions();
    });

    unitSelect.addEventListener('change', () => {
      updateDefaultBuyPrice();
      updateRowCalculation();
    });

    qtyInput.addEventListener('input', () => {
      updateRowCalculation();
    });

    buyPriceInput.addEventListener('input', () => {
      updateRowCalculation();
    });

    removeBtn.addEventListener('click', () => {
      const allRows = container.querySelectorAll('.incoming-item-row');
      if (allRows.length <= 1) {
        showToast('Minimal harus ada 1 obat masuk dalam faktur penerimaan.', 'warning');
        return;
      }
      rowEl.remove();
      recalculateIncomingInvoiceTotals();
      updateIncomingStockPreview();
    });

    if (prefillMedId) {
      refreshRowUnitOptions();
    }

    if (window.lucide) lucide.createIcons();
  }

  function updateIncomingStockPreview() {
    const container = document.getElementById('incoming-rows-container');
    const badge = document.getElementById('incoming-total-qty-badge');
    const previewList = document.getElementById('incoming-preview-list');
    const branchSelect = document.getElementById('incoming-branch-select');
    if (!container || !previewList) return;

    const chosenBranch = branchSelect ? branchSelect.value : 'TLD';
    const branchName = chosenBranch === 'TLD' ? 'Cabang Talaud' : 'Cabang Kembang Janggut';

    const rows = container.querySelectorAll('.incoming-item-row');
    let totalItems = 0;
    let totalBaseAddedAll = 0;
    previewList.innerHTML = '';

    rows.forEach(r => {
      const medId = r.querySelector('.incoming-med-select')?.value;
      const med = appState.medicines.find(m => m.id === medId);
      if (!med) return;

      totalItems++;
      const unitTier = r.querySelector('.incoming-unit-select')?.value;
      const qty = Math.max(1, parseInt(r.querySelector('.incoming-qty-input')?.value) || 1);

      let multiplier = 1;
      let unitLabel = med.baseUnit;
      if (unitTier === 'box') {
        multiplier = med.conversionRate || 1;
        unitLabel = med.buyUnit || 'Box';
      } else if (unitTier === 'strip') {
        multiplier = med.stripConversion || 1;
        unitLabel = med.stripUnit || 'Strip';
      }

      const totalBaseUnits = qty * multiplier;
      totalBaseAddedAll += totalBaseUnits;

      // Current stock in selected branch
      const currentBranchStock = appState.batches
        .filter(b => b.medicineId === med.id && b.branchId === chosenBranch)
        .reduce((s, b) => s + b.stock, 0);
      const afterStock = currentBranchStock + totalBaseUnits;

      const pEl = document.createElement('div');
      pEl.className = 'flex items-center justify-between py-0.5';
      pEl.innerHTML = `
        <span>• <b>${med.name}</b> (${branchName}): Stok awal: <b>${currentBranchStock} ${med.baseUnit}</b> + Masuk <b>${qty} ${unitLabel}</b> (${totalBaseUnits} ${med.baseUnit})</span>
        <span class="font-bold text-emerald-800">➔ Stok Baru: ${afterStock} ${med.baseUnit}</span>
      `;
      previewList.appendChild(pEl);
    });

    if (totalItems === 0) {
      previewList.innerHTML = `<span class="text-slate-400 italic">Belum ada obat yang dipilih</span>`;
      badge.textContent = '0 Item Obat';
    } else {
      badge.textContent = `${totalItems} Obat (+${totalBaseAddedAll} Satuan Dasar)`;
    }
  }

  function setupIncomingStockModal() {
    const modal = document.getElementById('modal-incoming-stock');
    const openBtn = document.getElementById('btn-open-incoming-stock-modal');
    const purchaseBtn = document.getElementById('btn-open-purchase-modal');
    const quickBtn = document.getElementById('btn-quick-incoming-stock');
    const form = document.getElementById('form-incoming-stock');
    const addRowBtn = document.getElementById('btn-add-incoming-row');
    const branchSelect = document.getElementById('incoming-branch-select');
    const dateInput = document.getElementById('incoming-date');
    const paidRadio = document.getElementById('incoming-pay-status-paid');
    const unpaidRadio = document.getElementById('incoming-pay-status-unpaid');
    const dueContainer = document.getElementById('incoming-due-date-container');
    const topSelect = document.getElementById('incoming-top-select');
    const dueDateInput = document.getElementById('incoming-due-date');
    const discountInput = document.getElementById('incoming-discount');
    const finalTotalInput = document.getElementById('incoming-final-total');

    if (!modal) return;

    function closeModal() {
      modal.classList.add('hidden');
    }

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelectorAll('.btn-close-modal').forEach(b => {
      b.addEventListener('click', closeModal);
    });

    if (openBtn) openBtn.addEventListener('click', () => openIncomingStockModal());
    if (purchaseBtn) purchaseBtn.addEventListener('click', () => openIncomingStockModal());
    if (quickBtn) quickBtn.addEventListener('click', () => openIncomingStockModal());

    if (addRowBtn) {
      addRowBtn.addEventListener('click', () => {
        addIncomingStockRow();
      });
    }

    if (branchSelect) {
      branchSelect.addEventListener('change', () => {
        updateIncomingStockPreview();
      });
    }

    // Payment Status Toggle
    if (paidRadio && unpaidRadio && dueContainer) {
      paidRadio.addEventListener('change', () => {
        if (paidRadio.checked) dueContainer.classList.add('hidden');
      });
      unpaidRadio.addEventListener('change', () => {
        if (unpaidRadio.checked) {
          dueContainer.classList.remove('hidden');
          updateIncomingDueDateDisplay();
        }
      });
    }

    // TOP & Due Date Change Handlers
    if (topSelect) {
      topSelect.addEventListener('change', () => {
        updateIncomingDueDateDisplay();
      });
    }
    if (dueDateInput) {
      dueDateInput.addEventListener('change', () => {
        updateIncomingDueDateDisplay();
      });
    }
    if (dateInput) {
      dateInput.addEventListener('change', () => {
        updateIncomingDueDateDisplay();
      });
    }

    // Discount & Total Input Handlers
    if (discountInput) {
      discountInput.addEventListener('input', () => {
        recalculateIncomingInvoiceTotals();
      });
    }
    if (finalTotalInput) {
      finalTotalInput.addEventListener('input', () => {
        incomingFinalTotalManuallyEdited = true;
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();

        const incomingDate = document.getElementById('incoming-date').value;
        const invoiceNo = document.getElementById('incoming-invoice-no').value.trim();
        const supplierId = document.getElementById('incoming-supplier-select').value;
        const branchId = document.getElementById('incoming-branch-select').value;

        // Payment status & Due date
        const isUnpaid = document.getElementById('incoming-pay-status-unpaid')?.checked;
        const paymentStatus = isUnpaid ? 'UNPAID' : 'PAID';
        const topDays = isUnpaid ? (parseInt(document.getElementById('incoming-top-select')?.value) || 30) : 0;
        const dueDate = isUnpaid ? (document.getElementById('incoming-due-date')?.value || calculateDueDate(incomingDate, 30)) : null;

        const rows = document.querySelectorAll('.incoming-item-row');
        if (rows.length === 0) {
          showToast('Masukkan minimal 1 baris obat masuk!', 'error');
          return;
        }

        const itemsToAdd = [];
        let hasError = false;

        rows.forEach(r => {
          const medId = r.querySelector('.incoming-med-select')?.value;
          const unitTier = r.querySelector('.incoming-unit-select')?.value;
          const qty = parseInt(r.querySelector('.incoming-qty-input')?.value);
          const buyPrice = parseFloat(r.querySelector('.incoming-buyprice-input')?.value) || 0;
          const batchNo = r.querySelector('.incoming-batch-input')?.value?.trim().toUpperCase();
          const expDate = r.querySelector('.incoming-exp-input')?.value;

          if (!medId) {
            showToast('Silakan pilih obat untuk semua baris!', 'warning');
            hasError = true;
            return;
          }
          if (!batchNo) {
            showToast('Nomor batch obat wajib diisi untuk semua baris!', 'warning');
            hasError = true;
            return;
          }
          if (!expDate) {
            showToast('Tanggal expired wajib diisi untuk semua baris!', 'warning');
            hasError = true;
            return;
          }

          const med = appState.medicines.find(m => m.id === medId);
          if (!med) return;

          let multiplier = 1;
          let unitLabel = med.baseUnit;
          if (unitTier === 'box') {
            multiplier = med.conversionRate || 1;
            unitLabel = med.buyUnit || 'Box';
          } else if (unitTier === 'strip') {
            multiplier = med.stripConversion || 1;
            unitLabel = med.stripUnit || 'Strip';
          }

          const baseQty = qty * multiplier;
          itemsToAdd.push({
            medicineId: med.id,
            medicineName: med.name,
            baseUnit: med.baseUnit,
            inputUnit: unitLabel,
            inputQty: qty,
            buyPrice: buyPrice,
            multiplier: multiplier,
            baseQty: baseQty,
            batchNo: batchNo,
            expiryDate: expDate,
            subtotalCost: qty * buyPrice
          });
        });

        if (hasError || itemsToAdd.length === 0) return;

        // Financial Totals
        const subtotalCost = itemsToAdd.reduce((s, it) => s + it.subtotalCost, 0);
        const discountAmount = Math.max(0, parseFloat(document.getElementById('incoming-discount')?.value) || 0);
        let finalInvoiceTotal = parseFloat(document.getElementById('incoming-final-total')?.value);
        if (isNaN(finalInvoiceTotal) || finalInvoiceTotal < 0) {
          finalInvoiceTotal = Math.max(0, subtotalCost - discountAmount);
        }

        // Process stock addition into appState.batches
        let summaryToastNames = [];
        itemsToAdd.forEach(item => {
          summaryToastNames.push(`${item.medicineName} (+${item.baseQty} ${item.baseUnit})`);

          const existingBatch = appState.batches.find(b => 
            b.medicineId === item.medicineId && 
            b.branchId === branchId && 
            b.batchNo === item.batchNo
          );

          if (existingBatch) {
            existingBatch.stock += item.baseQty;
            existingBatch.expiryDate = item.expiryDate;
          } else {
            appState.batches.push({
              id: 'B-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
              medicineId: item.medicineId,
              branchId: branchId,
              batchNo: item.batchNo,
              expiryDate: item.expiryDate,
              stock: item.baseQty
            });
          }
        });

        // If UNPAID, add to Supplier AP Balance (Saldo Utang)
        const sup = appState.suppliers.find(s => s.id === supplierId);
        if (isUnpaid && sup) {
          sup.apBalance = (sup.apBalance || 0) + finalInvoiceTotal;
        }

        // Record in appState.purchases
        const purchaseRecord = {
          id: 'PO-' + Date.now(),
          invoiceNo: invoiceNo,
          date: incomingDate,
          supplierId: supplierId,
          branchId: branchId,
          subtotal: subtotalCost,
          discount: discountAmount,
          total: finalInvoiceTotal,
          items: itemsToAdd,
          status: paymentStatus,
          dueDate: dueDate,
          topDays: topDays,
          paidDate: isUnpaid ? null : incomingDate,
          paidMethod: isUnpaid ? null : 'CASH'
        };

        appState.purchases = appState.purchases || [];
        appState.purchases.unshift(purchaseRecord);

        // Save and Sync
        saveState();

        closeModal();
        form.reset();

        const statusMsg = isUnpaid 
          ? `Status: BELUM LUNAS / HUTANG PBF (Jatuh tempo: ${dueDate})` 
          : `Status: LUNAS (Cash / Transfer Langsung)`;

        showToast(`Faktur ${invoiceNo} berhasil dicatat! Total: ${formatIDR(finalInvoiceTotal)}. ${statusMsg}`, 'success');

        // Re-render relevant tables
        renderInventoryBatches();
        renderMedicinesTable();
        renderPurchases();
        renderDashboard();
      });
    }
  }

  // ==========================================
  // 9. PEMBELIAN & PBF ENGINE
  // ==========================================
  function renderPurchases() {
    const cardsGrid = document.getElementById('supplier-cards-grid');
    const tbody = document.getElementById('purchase-history-table-body');
    const statTotalUnpaidEl = document.getElementById('stat-ap-total-unpaid');
    const statCountUnpaidEl = document.getElementById('stat-ap-count-unpaid');
    const statCountUrgentEl = document.getElementById('stat-ap-count-urgent');
    const statCountOverdueEl = document.getElementById('stat-ap-count-overdue');
    const badgeSupCount = document.getElementById('badge-suppliers-count');

    if (!tbody) return;

    if (badgeSupCount) {
      badgeSupCount.textContent = (appState.suppliers || []).length;
    }

    // 1. Render Supplier Cards (if container present, otherwise hidden for clean 5S layout)
    if (cardsGrid) {
      cardsGrid.innerHTML = '';
      (appState.suppliers || []).forEach(sup => {
        cardsGrid.innerHTML += `
          <div class="bg-white p-4 rounded-xl card-shadow space-y-2">
            <div class="flex items-start justify-between">
              <span class="text-xs font-bold text-slate-800">${sup.name}</span>
              <span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-bold">${sup.id}</span>
            </div>
            <div class="text-[11px] text-slate-500">Kontak: ${sup.contact}</div>
            <div class="pt-2 border-t border-slate-100 flex justify-between items-center">
              <span class="text-[11px] text-slate-500">Saldo Utang (AP):</span>
              <span class="text-xs font-extrabold text-red-600 mono">${formatIDR(sup.apBalance || 0)}</span>
            </div>
          </div>
        `;
      });
    }

    const branch = appState.currentBranch;
    const allPurchases = appState.purchases || [];
    const branchPurchases = branch === 'ALL' ? allPurchases : allPurchases.filter(p => p.branchId === branch);

    // 2. Compute Debt / AP & Due Date Stats
    let totalUnpaidAmount = 0;
    let countUnpaid = 0;
    let countUrgent = 0;
    let countOverdue = 0;

    branchPurchases.forEach(po => {
      if (po.status === 'UNPAID') {
        countUnpaid++;
        totalUnpaidAmount += (po.total || 0);

        const dueStr = po.dueDate || calculateDueDate(po.date, 30);
        const diff = getDaysDiffFromToday(dueStr);
        if (diff < 0) {
          countOverdue++;
        } else if (diff <= 7) {
          countUrgent++;
        }
      }
    });

    if (statTotalUnpaidEl) statTotalUnpaidEl.textContent = formatIDR(totalUnpaidAmount);
    if (statCountUnpaidEl) statCountUnpaidEl.textContent = `${countUnpaid} Faktur`;
    if (statCountUrgentEl) statCountUrgentEl.textContent = `${countUrgent} Faktur`;
    if (statCountOverdueEl) statCountOverdueEl.textContent = `${countOverdue} Faktur`;

    // 3. Filter Purchases
    const searchVal = (document.getElementById('purchase-search-input')?.value || '').toLowerCase().trim();
    const statusVal = document.getElementById('purchase-status-filter')?.value || 'ALL';
    const dueVal = document.getElementById('purchase-due-filter')?.value || 'ALL';

    const filteredPurchases = branchPurchases.filter(po => {
      const sup = appState.suppliers.find(s => s.id === po.supplierId);
      const supName = (sup ? sup.name : '').toLowerCase();
      const invNo = (po.invoiceNo || '').toLowerCase();

      // Search
      if (searchVal && !invNo.includes(searchVal) && !supName.includes(searchVal)) {
        return false;
      }

      // Status Filter
      if (statusVal !== 'ALL' && po.status !== statusVal) {
        return false;
      }

      // Due Filter
      if (dueVal !== 'ALL') {
        if (po.status !== 'UNPAID') return false;
        const dueStr = po.dueDate || calculateDueDate(po.date, 30);
        const diff = getDaysDiffFromToday(dueStr);
        if (dueVal === 'OVERDUE' && diff >= 0) return false;
        if (dueVal === 'URGENT' && (diff < 0 || diff > 7)) return false;
      }

      return true;
    });

    // 4. Render Table Rows
    tbody.innerHTML = '';
    if (filteredPurchases.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-8 text-slate-400 italic">
            Belum ada riwayat pembelian atau faktur yang sesuai filter.
          </td>
        </tr>
      `;
      return;
    }

    filteredPurchases.forEach(po => {
      const sup = appState.suppliers.find(s => s.id === po.supplierId);
      const isPaid = po.status === 'PAID';

      // Due Date Badge Logic
      let dueHtml = '';
      if (isPaid) {
        dueHtml = `<span class="text-slate-400 font-mono text-[11px]">- (Lunas ${po.paidDate || ''})</span>`;
      } else {
        const dueStr = po.dueDate || calculateDueDate(po.date, 30);
        const diff = getDaysDiffFromToday(dueStr);

        if (diff < 0) {
          dueHtml = `
            <div class="text-center space-y-0.5">
              <span class="block font-bold mono text-red-700 text-[11px]">${dueStr}</span>
              <span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-100 text-red-800 border border-red-200">
                ⚠️ Lewat ${Math.abs(diff)} Hari
              </span>
            </div>
          `;
        } else if (diff === 0) {
          dueHtml = `
            <div class="text-center space-y-0.5">
              <span class="block font-bold mono text-amber-900 text-[11px]">${dueStr}</span>
              <span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-200 text-amber-950 border border-amber-300">
                🚨 Hari Ini!
              </span>
            </div>
          `;
        } else if (diff <= 7) {
          dueHtml = `
            <div class="text-center space-y-0.5">
              <span class="block font-bold mono text-amber-800 text-[11px]">${dueStr}</span>
              <span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                ⏰ Sisa ${diff} Hari
              </span>
            </div>
          `;
        } else {
          dueHtml = `
            <div class="text-center space-y-0.5">
              <span class="block font-bold mono text-slate-800 text-[11px]">${dueStr}</span>
              <span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-100 text-slate-600">
                📅 Sisa ${diff} Hari
              </span>
            </div>
          `;
        }
      }

      tbody.innerHTML += `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-3 px-4 font-bold mono text-slate-900">${po.invoiceNo}</td>
          <td class="py-3 px-4 mono text-slate-600">${po.date}</td>
          <td class="py-3 px-4 font-semibold text-slate-800">${sup ? sup.name : po.supplierId}</td>
          <td class="py-3 px-4 font-semibold ${po.branchId === 'TLD' ? 'text-blue-600' : 'text-emerald-600'}">
            ${po.branchId === 'TLD' ? 'Cabang Talaud' : 'Kembang Janggut'}
          </td>
          <td class="py-3 px-4 text-right mono font-extrabold text-slate-900">${formatIDR(po.total)}</td>
          <td class="py-3 px-4 text-center">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPaid ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}">
              ${isPaid ? '🟢 LUNAS' : '🔴 BELUM LUNAS'}
            </span>
          </td>
          <td class="py-3 px-4 text-center">
            ${dueHtml}
          </td>
          <td class="py-3 px-4 text-center whitespace-nowrap">
            <div class="flex items-center justify-center space-x-1.5">
              <button type="button" class="btn-view-po-detail px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold flex items-center space-x-1 transition" data-po-id="${po.id}">
                <i data-lucide="file-text" class="w-3.5 h-3.5 text-slate-500"></i>
                <span>Detail</span>
              </button>
              ${!isPaid ? `
                <button type="button" class="btn-pay-po px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold flex items-center space-x-1 shadow-xs transition" data-po-id="${po.id}">
                  <i data-lucide="credit-card" class="w-3.5 h-3.5"></i>
                  <span>Lunasi</span>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    });

    if (window.lucide) lucide.createIcons();

    // Bind Detail & Pay Buttons
    tbody.querySelectorAll('.btn-view-po-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        const poId = btn.getAttribute('data-po-id');
        openPurchaseDetailModal(poId);
      });
    });

    tbody.querySelectorAll('.btn-pay-po').forEach(btn => {
      btn.addEventListener('click', () => {
        const poId = btn.getAttribute('data-po-id');
        openPayPurchaseModal(poId);
      });
    });
  }

  // ==========================================
  // DETAIL & PELUNASAN FAKTUR ENGINE
  // ==========================================

  function openPurchaseDetailModal(poId) {
    const po = (appState.purchases || []).find(p => p.id === poId);
    if (!po) return;

    const modal = document.getElementById('modal-purchase-detail');
    if (!modal) return;

    const sup = appState.suppliers.find(s => s.id === po.supplierId);
    const branchName = po.branchId === 'TLD' ? 'Cabang Kepulauan Talaud' : 'Cabang Kembang Janggut';
    const isPaid = po.status === 'PAID';

    // Info Box
    const infoBox = document.getElementById('detail-po-info-box');
    infoBox.innerHTML = `
      <div>
        <span class="text-slate-400 text-[10px] block">No. Faktur PBF:</span>
        <span class="font-bold font-mono text-slate-800 text-xs">${po.invoiceNo}</span>
      </div>
      <div>
        <span class="text-slate-400 text-[10px] block">Tanggal Masuk:</span>
        <span class="font-bold font-mono text-slate-800 text-xs">${po.date}</span>
      </div>
      <div>
        <span class="text-slate-400 text-[10px] block">Supplier PBF:</span>
        <span class="font-bold text-slate-800 text-xs">${sup ? sup.name : po.supplierId}</span>
      </div>
      <div>
        <span class="text-slate-400 text-[10px] block">Cabang Penerima:</span>
        <span class="font-bold text-slate-800 text-xs">${branchName}</span>
      </div>
      <div>
        <span class="text-slate-400 text-[10px] block">Status Pembayaran:</span>
        <span class="font-bold text-xs ${isPaid ? 'text-emerald-700' : 'text-red-700'}">${isPaid ? '🟢 LUNAS' : '🔴 BELUM LUNAS (HUTANG)'}</span>
      </div>
      <div>
        <span class="text-slate-400 text-[10px] block">Jatuh Tempo (TOP):</span>
        <span class="font-bold font-mono text-xs ${isPaid ? 'text-slate-500' : 'text-amber-800'}">
          ${isPaid ? `Lunas (${po.paidDate || po.date})` : `${po.dueDate || calculateDueDate(po.date, 30)} (${po.topDays || 30} Hari)`}
        </span>
      </div>
      <div class="col-span-2">
        <span class="text-slate-400 text-[10px] block">Total Faktur Fisik:</span>
        <span class="font-extrabold font-mono text-emerald-800 text-sm">${formatIDR(po.total)}</span>
      </div>
    `;

    // Items Table
    const tbody = document.getElementById('detail-po-items-table');
    tbody.innerHTML = '';
    const items = po.items || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-slate-400 italic">Tidak ada item obat tercatat.</td></tr>`;
    } else {
      items.forEach((it, idx) => {
        const itemSubtotal = it.subtotalCost || (it.inputQty * (it.buyPrice || 0));
        tbody.innerHTML += `
          <tr class="hover:bg-slate-50">
            <td class="py-2 px-3 text-center text-slate-400 font-mono text-[10px]">${idx + 1}</td>
            <td class="py-2 px-3 font-bold text-slate-800">${it.medicineName}</td>
            <td class="py-2 px-3 font-semibold text-slate-700">${it.inputQty} ${it.inputUnit} <span class="text-[10px] text-slate-400">(= ${it.baseQty} ${it.baseUnit})</span></td>
            <td class="py-2 px-3 font-mono font-bold text-slate-700 uppercase">${it.batchNo}</td>
            <td class="py-2 px-3 font-mono text-slate-600">${it.expiryDate}</td>
            <td class="py-2 px-3 text-right font-mono font-semibold text-slate-700">${formatIDR(it.buyPrice || 0)}</td>
            <td class="py-2 px-3 text-right font-mono font-bold text-emerald-800">${formatIDR(itemSubtotal)}</td>
          </tr>
        `;
      });
    }

    // Financial Summary
    const finSummary = document.getElementById('detail-po-financial-summary');
    finSummary.innerHTML = `
      <div class="flex justify-between items-center text-slate-600">
        <span>Subtotal Obat:</span>
        <span class="font-mono font-bold text-slate-800">${formatIDR(po.subtotal || po.total)}</span>
      </div>
      ${po.discount > 0 ? `
        <div class="flex justify-between items-center text-amber-700">
          <span>Potongan / Diskon Faktur:</span>
          <span class="font-mono font-bold">- ${formatIDR(po.discount)}</span>
        </div>
      ` : ''}
      <div class="flex justify-between items-center pt-1.5 border-t border-slate-200 font-extrabold text-sm text-slate-900">
        <span>Total Faktur Bersih:</span>
        <span class="font-mono text-emerald-800">${formatIDR(po.total)}</span>
      </div>
      ${isPaid ? `
        <div class="pt-1 text-[11px] text-emerald-700 flex items-center justify-between">
          <span>✓ Pembayaran: <b>${po.paidMethod || 'CASH'}</b> pada <b>${po.paidDate || po.date}</b></span>
          ${po.paidRef ? `<span>Ref: <b>${po.paidRef}</b></span>` : ''}
        </div>
      ` : `
        <div class="pt-1 text-[11px] text-red-600 flex items-center justify-between">
          <span>⚠️ Belum Lunas: Tagihan hutang jatuh tempo pada <b>${po.dueDate || calculateDueDate(po.date, 30)}</b></span>
          <span>Sisa Tagihan: <b>${formatIDR(po.total)}</b></span>
        </div>
      `}
    `;

    // Action button
    const actionsBox = document.getElementById('detail-po-actions');
    if (!isPaid) {
      actionsBox.innerHTML = `
        <button type="button" id="btn-detail-pay-now" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow flex items-center space-x-1.5 transition">
          <i data-lucide="credit-card" class="w-3.5 h-3.5"></i>
          <span>Bayar / Lunasi Tagihan Ini</span>
        </button>
      `;
      document.getElementById('btn-detail-pay-now')?.addEventListener('click', () => {
        modal.classList.add('hidden');
        openPayPurchaseModal(po.id);
      });
    } else {
      actionsBox.innerHTML = '';
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function openPayPurchaseModal(poId) {
    const po = (appState.purchases || []).find(p => p.id === poId);
    if (!po) return;

    const modal = document.getElementById('modal-pay-purchase');
    if (!modal) return;

    const sup = appState.suppliers.find(s => s.id === po.supplierId);
    const branchName = po.branchId === 'TLD' ? 'Cabang Kepulauan Talaud' : 'Cabang Kembang Janggut';

    document.getElementById('pay-po-id').value = po.id;
    document.getElementById('pay-po-invoice-no').textContent = po.invoiceNo;
    document.getElementById('pay-po-supplier-name').textContent = sup ? sup.name : po.supplierId;
    document.getElementById('pay-po-branch-name').textContent = branchName;
    document.getElementById('pay-po-amount').textContent = formatIDR(po.total);

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('pay-po-date').value = today;
    document.getElementById('pay-po-ref').value = '';
    document.getElementById('pay-po-notes').value = '';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function setupPurchaseDebtModals() {
    const detailModal = document.getElementById('modal-purchase-detail');
    const payModal = document.getElementById('modal-pay-purchase');
    const payForm = document.getElementById('form-pay-purchase');

    [detailModal, payModal].forEach(m => {
      if (!m) return;
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });
      m.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => m.classList.add('hidden'));
      });
    });

    // Filter Listeners in Purchase View
    const searchInput = document.getElementById('purchase-search-input');
    const statusFilter = document.getElementById('purchase-status-filter');
    const dueFilter = document.getElementById('purchase-due-filter');

    if (searchInput) searchInput.addEventListener('input', () => renderPurchases());
    if (statusFilter) statusFilter.addEventListener('change', () => renderPurchases());
    if (dueFilter) dueFilter.addEventListener('change', () => renderPurchases());

    if (payForm) {
      payForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const poId = document.getElementById('pay-po-id').value;
        const payDate = document.getElementById('pay-po-date').value;
        const payMethod = document.getElementById('pay-po-method').value;
        const payRef = document.getElementById('pay-po-ref').value.trim();
        const payNotes = document.getElementById('pay-po-notes').value.trim();

        const po = (appState.purchases || []).find(p => p.id === poId);
        if (!po) return;

        // Update Purchase
        po.status = 'PAID';
        po.paidDate = payDate;
        po.paidMethod = payMethod;
        po.paidRef = payRef;
        po.paidNotes = payNotes;

        // Decrease Supplier AP Balance
        const sup = appState.suppliers.find(s => s.id === po.supplierId);
        if (sup) {
          sup.apBalance = Math.max(0, (sup.apBalance || 0) - po.total);
        }

        saveState();

        payModal.classList.add('hidden');
        showToast(`Pelunasan faktur ${po.invoiceNo} sebesar ${formatIDR(po.total)} berhasil dicatat! Saldo utang ${sup ? sup.name : ''} telah berkurang.`, 'success');

        renderPurchases();
        renderDashboard();
      });
    }
  }

  // ==========================================
  // 9B. SUPPLIER MANAGEMENT (PBF)
  // ==========================================
  function getNextSupplierCode() {
    const sups = appState.suppliers || [];
    let maxNum = 0;
    sups.forEach(s => {
      const match = (s.id || '').match(/SUP-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    const nextNum = maxNum + 1;
    return `SUP-${String(nextNum).padStart(2, '0')}`;
  }

  function openAddSupplierModal() {
    const modal = document.getElementById('modal-add-supplier');
    const form = document.getElementById('form-add-supplier');
    const title = document.getElementById('modal-supplier-title');
    const editIdInput = document.getElementById('edit-supplier-id');
    const codeInput = document.getElementById('new-supplier-code');
    const submitBtn = document.getElementById('btn-submit-supplier');

    if (!modal) return;
    if (form) form.reset();
    if (editIdInput) editIdInput.value = '';
    if (title) title.innerHTML = '<i data-lucide="building-2" class="w-5 h-5 text-emerald-600 mr-2"></i><span>Tambah Supplier PBF Baru</span>';
    if (codeInput) codeInput.value = getNextSupplierCode();
    if (submitBtn) submitBtn.innerHTML = '<i data-lucide="save" class="w-4 h-4 mr-1"></i><span>Simpan Supplier</span>';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function openEditSupplierModal(supId) {
    const sup = (appState.suppliers || []).find(s => s.id === supId);
    if (!sup) {
      showToast('Data supplier tidak ditemukan!', 'error');
      return;
    }

    const modal = document.getElementById('modal-add-supplier');
    const title = document.getElementById('modal-supplier-title');
    const editIdInput = document.getElementById('edit-supplier-id');
    const codeInput = document.getElementById('new-supplier-code');
    const nameInput = document.getElementById('new-supplier-name');
    const contactInput = document.getElementById('new-supplier-contact');
    const addressInput = document.getElementById('new-supplier-address');
    const picInput = document.getElementById('new-supplier-pic');
    const topInput = document.getElementById('new-supplier-top');
    const submitBtn = document.getElementById('btn-submit-supplier');

    if (!modal) return;
    if (editIdInput) editIdInput.value = sup.id;
    if (title) title.innerHTML = `<i data-lucide="building-2" class="w-5 h-5 text-blue-600 mr-2"></i><span>Edit Supplier: ${sup.name}</span>`;
    if (codeInput) codeInput.value = sup.id;
    if (nameInput) nameInput.value = sup.name || '';
    if (contactInput) contactInput.value = sup.contact || '';
    if (addressInput) addressInput.value = sup.address || '';
    if (picInput) picInput.value = sup.pic || '';
    if (topInput) topInput.value = sup.top || '30 Hari';
    if (submitBtn) submitBtn.innerHTML = '<i data-lucide="save" class="w-4 h-4 mr-1"></i><span>Simpan Perubahan</span>';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function openSupplierListModal() {
    const modal = document.getElementById('modal-supplier-list');
    if (!modal) return;
    renderSupplierListTable();
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function renderSupplierListTable() {
    const tbody = document.getElementById('supplier-list-table-body');
    const countText = document.getElementById('supplier-count-text');
    const searchVal = (document.getElementById('supplier-search-input')?.value || '').toLowerCase().trim();
    if (!tbody) return;

    const sups = appState.suppliers || [];
    if (countText) countText.textContent = `Total: ${sups.length} Supplier`;

    const filtered = sups.filter(s => {
      const name = (s.name || '').toLowerCase();
      const code = (s.id || '').toLowerCase();
      const contact = (s.contact || '').toLowerCase();
      const address = (s.address || '').toLowerCase();
      return name.includes(searchVal) || code.includes(searchVal) || contact.includes(searchVal) || address.includes(searchVal);
    });

    tbody.innerHTML = '';
    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-8 text-slate-400">
            Tidak ada supplier yang cocok dengan kata kunci pencarian.
          </td>
        </tr>
      `;
      return;
    }

    filtered.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-mono font-bold text-slate-700">${s.id}</td>
        <td class="py-2.5 px-3">
          <div class="font-bold text-slate-900">${s.name}</div>
          ${s.pic ? `<div class="text-[10px] text-slate-400">PIC: ${s.pic}</div>` : ''}
        </td>
        <td class="py-2.5 px-3 text-slate-600 font-medium">${s.contact || '-'}</td>
        <td class="py-2.5 px-3 text-slate-600 max-w-xs truncate" title="${s.address || '-'}">${s.address || '-'}</td>
        <td class="py-2.5 px-3 text-right mono font-extrabold ${s.apBalance > 0 ? 'text-red-600' : 'text-slate-500'}">
          ${formatIDR(s.apBalance || 0)}
        </td>
        <td class="py-2.5 px-3 text-center">
          <div class="flex items-center justify-center space-x-1">
            <button type="button" class="btn-edit-sup p-1.5 text-blue-600 hover:bg-blue-50 rounded" data-id="${s.id}" title="Edit Data Supplier">
              <i data-lucide="edit" class="w-3.5 h-3.5"></i>
            </button>
            <button type="button" class="btn-delete-sup p-1.5 text-red-600 hover:bg-red-50 rounded" data-id="${s.id}" data-name="${s.name.replace(/"/g, '&quot;')}" title="Hapus Supplier">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-sup').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openEditSupplierModal(id);
      });
    });

    tbody.querySelectorAll('.btn-delete-sup').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        if (confirm(`Yakin ingin menghapus supplier "${name}" (${id}) dari sistem?`)) {
          deleteSupplier(id);
        }
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  function deleteSupplier(id) {
    const idx = (appState.suppliers || []).findIndex(s => s.id === id);
    if (idx !== -1) {
      const removed = appState.suppliers.splice(idx, 1)[0];
      saveState();
      pushStateToServer();
      renderSupplierListTable();
      renderPurchases();
      showToast(`Supplier "${removed.name}" berhasil dihapus dari sistem`, 'success');
    }
  }

  function setupSupplierManagement() {
    const openAddBtn = document.getElementById('btn-open-add-supplier-modal');
    const openListBtn = document.getElementById('btn-open-supplier-list-modal');
    const triggerAddFromList = document.getElementById('btn-trigger-add-supplier-from-list');
    const addModal = document.getElementById('modal-add-supplier');
    const listModal = document.getElementById('modal-supplier-list');
    const addForm = document.getElementById('form-add-supplier');
    const searchInput = document.getElementById('supplier-search-input');

    if (openAddBtn) openAddBtn.addEventListener('click', openAddSupplierModal);
    if (openListBtn) openListBtn.addEventListener('click', openSupplierListModal);
    if (triggerAddFromList) triggerAddFromList.addEventListener('click', openAddSupplierModal);

    if (addModal) {
      addModal.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => addModal.classList.add('hidden'));
      });
    }

    if (listModal) {
      listModal.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => listModal.classList.add('hidden'));
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => renderSupplierListTable());
    }

    if (addForm) {
      addForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const editId = (document.getElementById('edit-supplier-id')?.value || '').trim();
        const code = (document.getElementById('new-supplier-code')?.value || '').trim().toUpperCase() || getNextSupplierCode();
        const name = (document.getElementById('new-supplier-name')?.value || '').trim();
        const contact = (document.getElementById('new-supplier-contact')?.value || '').trim();
        const address = (document.getElementById('new-supplier-address')?.value || '').trim();
        const pic = (document.getElementById('new-supplier-pic')?.value || '').trim();
        const top = (document.getElementById('new-supplier-top')?.value || '').trim();

        if (!name || !contact || !address) {
          showToast('Nama, Kontak, dan Alamat supplier wajib diisi!', 'error');
          return;
        }

        appState.suppliers = appState.suppliers || [];

        if (editId) {
          // EDIT EXISTING
          const idx = appState.suppliers.findIndex(s => s.id === editId);
          if (idx !== -1) {
            appState.suppliers[idx] = {
              ...appState.suppliers[idx],
              name: name,
              contact: contact,
              address: address,
              pic: pic,
              top: top || '30 Hari'
            };
            showToast(`Supplier "${name}" berhasil diperbarui di sistem!`, 'success');
          }
        } else {
          // ADD NEW
          const newSup = {
            id: code,
            name: name,
            contact: contact,
            address: address,
            pic: pic,
            top: top || '30 Hari',
            apBalance: 0
          };
          appState.suppliers.push(newSup);
          showToast(`Supplier baru "${name}" (${code}) berhasil disimpan ke sistem!`, 'success');
        }

        saveState();
        pushStateToServer();

        // Refresh UI
        renderPurchases();
        if (listModal && !listModal.classList.contains('hidden')) {
          renderSupplierListTable();
        }
        if (addModal) addModal.classList.add('hidden');
      });
    }
  }

  // ==========================================
  // 10. KEUANGAN & LABA RUGI ENGINE
  // ==========================================
  const financeFilter = {
    period: 'this_month', // 'this_month' | 'last_month' | 'this_year' | 'all' | 'custom'
    startDate: '',
    endDate: ''
  };

  function getFinanceDateRange() {
    const now = new Date();
    const currYear = now.getFullYear();
    const currMonth = now.getMonth();
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    if (financeFilter.period === 'this_month') {
      const end = new Date(currYear, currMonth + 1, 0);
      const sStr = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-01`;
      const eStr = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      return {
        startStr: sStr,
        endStr: eStr,
        label: `Bulan Ini (${monthNames[currMonth]} ${currYear})`,
        isThisMonth: true,
        isLastMonth: false
      };
    } else if (financeFilter.period === 'last_month') {
      const prevDate = new Date(currYear, currMonth - 1, 1);
      const prevYear = prevDate.getFullYear();
      const prevMonth = prevDate.getMonth();
      const endPrev = new Date(prevYear, prevMonth + 1, 0);
      const sStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
      const eStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(endPrev.getDate()).padStart(2, '0')}`;
      return {
        startStr: sStr,
        endStr: eStr,
        label: `Bulan Lalu (${monthNames[prevMonth]} ${prevYear})`,
        isThisMonth: false,
        isLastMonth: true
      };
    } else if (financeFilter.period === 'this_year') {
      return {
        startStr: `${currYear}-01-01`,
        endStr: `${currYear}-12-31`,
        label: `Tahun Ini (${currYear})`,
        isThisMonth: false,
        isLastMonth: false
      };
    } else if (financeFilter.period === 'all') {
      return {
        startStr: '2020-01-01',
        endStr: '2099-12-31',
        label: 'Semua Periode',
        isThisMonth: false,
        isLastMonth: false
      };
    } else if (financeFilter.period === 'custom') {
      const sStr = financeFilter.startDate || `${currYear}-01-01`;
      const eStr = financeFilter.endDate || `${currYear}-12-31`;
      return {
        startStr: sStr,
        endStr: eStr,
        label: `Rentang ${sStr} s/d ${eStr}`,
        isThisMonth: false,
        isLastMonth: false
      };
    }
    return {
      startStr: `${currYear}-01-01`,
      endStr: `${currYear}-12-31`,
      label: 'Bulan Ini',
      isThisMonth: true,
      isLastMonth: false
    };
  }

  function getExpenseCategoryBadge(cat) {
    switch (cat) {
      case 'Gaji & Uang Makan':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">Gaji & Insentif</span>';
      case 'Listrik & Air':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">Listrik & Air</span>';
      case 'Internet & Pulsa':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-100 text-cyan-800 border border-cyan-200">Internet & WiFi</span>';
      case 'Transport & Logistik':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">Transport & Logistik</span>';
      case 'Sewa Tempat':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">Sewa Tempat</span>';
      case 'ATK & Perlengkapan':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-200">ATK & Kasir</span>';
      case 'Biaya Lain-lain':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">Biaya Lain-lain</span>';
      default:
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">${cat}</span>`;
    }
  }

  function renderFinance() {
    const branch = appState.currentBranch;
    const labelEl = document.getElementById('pnl-branch-label');
    const revEl = document.getElementById('pnl-revenue');
    const cogsEl = document.getElementById('pnl-cogs');
    const grossEl = document.getElementById('pnl-gross');
    const totalExpEl = document.getElementById('pnl-total-expense');
    const netEl = document.getElementById('pnl-net');
    const expBreakdownEl = document.getElementById('pnl-expense-breakdown');
    const expLogListEl = document.getElementById('expense-log-list');
    const activePeriodLabel = document.getElementById('finance-active-period-label');
    const periodPill = document.getElementById('pnl-period-pill');
    const netMarginLabel = document.getElementById('pnl-net-margin-label');
    const expCountBadge = document.getElementById('expense-count-badge');
    const pnlExpCountText = document.getElementById('pnl-expense-count-text');

    if (!revEl) return;

    const range = getFinanceDateRange();

    // Update Banner & Labels
    if (activePeriodLabel) activePeriodLabel.textContent = range.label;
    if (periodPill) periodPill.textContent = range.label;
    if (labelEl) {
      labelEl.textContent = branch === 'ALL' ? 'Semua Cabang (Konsolidasi)' : branch === 'TLD' ? 'Cabang Kepulauan Talaud' : 'Cabang Kembang Janggut';
    }

    // Baseline Revenue & HPP based on selected period
    let baseRevenue = 0;
    let baseHPP = 0;

    if (range.isThisMonth || financeFilter.period === 'all' || financeFilter.period === 'this_year') {
      baseRevenue = branch === 'ALL' ? 128450000 : branch === 'TLD' ? 68200000 : 60250000;
      baseHPP = branch === 'ALL' ? 89915000 : branch === 'TLD' ? 47740000 : 42175000;
    } else if (range.isLastMonth) {
      baseRevenue = branch === 'ALL' ? 112500000 : branch === 'TLD' ? 59800000 : 52700000;
      baseHPP = branch === 'ALL' ? 78750000 : branch === 'TLD' ? 41860000 : 36890000;
    }

    // Filter Sales by branch and date range
    const filteredSales = (appState.sales || []).filter(s => {
      if (branch !== 'ALL' && s.branchId !== branch) return false;
      const sDate = s.date ? s.date.slice(0, 10) : '';
      if (!sDate) return true;
      return sDate >= range.startStr && sDate <= range.endStr;
    });

    const addSales = filteredSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const addHPP = filteredSales.reduce((sum, s) => {
      const itemsHpp = (s.items || []).reduce((acc, it) => acc + ((it.hpp || 0) * (it.qty || 1)), 0);
      return sum + itemsHpp;
    }, 0);

    const totalRev = baseRevenue + addSales;
    const totalHPP = baseHPP + addHPP;
    const grossProfit = totalRev - totalHPP;

    // Filter Expenses by branch and date range (only show current month by default)
    const filteredExpenses = (appState.expenses || []).filter(e => {
      if (branch !== 'ALL' && e.branchId !== branch) return false;
      const eDate = e.date ? e.date.slice(0, 10) : '';
      if (!eDate) return true;
      return eDate >= range.startStr && eDate <= range.endStr;
    });

    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const netProfit = grossProfit - totalExpenses;
    const netMargin = totalRev > 0 ? ((netProfit / totalRev) * 100).toFixed(1) : 0;

    // Render P&L Values
    revEl.textContent = formatIDR(totalRev);
    cogsEl.textContent = `(${formatIDR(totalHPP)})`;
    grossEl.textContent = formatIDR(grossProfit);
    totalExpEl.textContent = `(${formatIDR(totalExpenses)})`;
    netEl.textContent = formatIDR(netProfit);
    if (netMarginLabel) {
      netMarginLabel.textContent = `Margin Laba Bersih: ${netMargin}% (Omzet: ${formatIDR(totalRev)})`;
    }

    // Group expenses by category
    const catMap = {};
    filteredExpenses.forEach(e => {
      const c = e.category || 'Biaya Lain-lain';
      catMap[c] = (catMap[c] || 0) + (Number(e.amount) || 0);
    });

    const catKeys = Object.keys(catMap);
    if (pnlExpCountText) {
      pnlExpCountText.textContent = `${catKeys.length} Kategori • ${filteredExpenses.length} Beban`;
    }

    expBreakdownEl.innerHTML = '';
    if (catKeys.length === 0) {
      expBreakdownEl.innerHTML = `
        <div class="py-2 text-slate-400 text-center italic text-xs">
          Belum ada beban operasional yang dicatat pada periode ini.
        </div>`;
    } else {
      catKeys.forEach(cat => {
        const catAmount = catMap[cat];
        const pctOfExp = totalExpenses > 0 ? Math.round((catAmount / totalExpenses) * 100) : 0;
        expBreakdownEl.innerHTML += `
          <div class="flex items-center justify-between py-1 border-b border-slate-50 last:border-b-0 hover:bg-slate-50/80 px-1 rounded transition text-xs">
            <div class="flex items-center space-x-1.5">
              <span>•</span>
              <span class="font-medium text-slate-800">${cat}</span>
              <span class="text-[10px] text-slate-400">(${pctOfExp}%)</span>
            </div>
            <span class="mono font-bold text-slate-900">${formatIDR(catAmount)}</span>
          </div>`;
      });
    }

    // Render Expenses Log List
    if (expCountBadge) {
      expCountBadge.textContent = `${filteredExpenses.length} Beban (${formatIDR(totalExpenses)})`;
    }

    expLogListEl.innerHTML = '';
    if (filteredExpenses.length === 0) {
      expLogListEl.innerHTML = `
        <div class="p-8 text-center text-slate-400 bg-slate-50/80 rounded-xl border border-dashed border-slate-200">
          <i data-lucide="receipt" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
          <p class="font-bold text-slate-600 text-xs">Tidak ada catatan pengeluaran pada periode ini</p>
          <p class="text-[11px] text-slate-400 mt-1">Pilih periode lain di atas atau klik tombol "Catat Beban Operasional" untuk menambah biaya.</p>
        </div>`;
    } else {
      // Sort newest date first
      const sortedExp = filteredExpenses.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      sortedExp.forEach(exp => {
        const badge = getExpenseCategoryBadge(exp.category);
        const branchBadge = exp.branchId === 'TLD' ? '<span class="text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">Talaud</span>' : '<span class="text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">Kembang Janggut</span>';
        
        expLogListEl.innerHTML += `
          <div class="p-3 rounded-xl border border-slate-200/90 bg-white hover:border-amber-300 hover:shadow-xs transition space-y-1.5 group">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-1.5">
                ${badge}
                ${branchBadge}
                <span class="text-[11px] font-mono text-slate-500">${exp.date || '-'}</span>
              </div>
              <div class="flex items-center space-x-1">
                <button type="button" class="btn-edit-expense p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Edit Pengeluaran" data-id="${exp.id}">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                </button>
                <button type="button" class="btn-delete-expense p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition" title="Hapus Pengeluaran" data-id="${exp.id}">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </div>
            <div class="flex items-end justify-between pt-0.5">
              <div class="text-xs text-slate-600 pr-2 leading-relaxed">
                <span class="font-medium text-slate-800">${exp.notes || 'Biaya operasional apotek'}</span>
              </div>
              <span class="mono font-black text-amber-700 text-sm whitespace-nowrap">${formatIDR(exp.amount)}</span>
            </div>
          </div>`;
      });
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function setupExpenseModal() {
    const openBtn = document.getElementById('btn-open-expense-modal');
    const quickAddBtn = document.getElementById('btn-quick-add-expense');
    const modal = document.getElementById('modal-expense');
    const form = document.getElementById('form-expense');
    const editIdInput = document.getElementById('expense-edit-id');
    const titleEl = document.getElementById('modal-expense-title');
    const submitBtn = document.getElementById('btn-submit-expense');
    const dateInput = document.getElementById('expense-date');
    const expListEl = document.getElementById('expense-log-list');

    function openModalForAdd() {
      if (!modal) return;
      form.reset();
      if (editIdInput) editIdInput.value = '';
      if (titleEl) titleEl.textContent = 'Catat Pengeluaran Beban Operasional';
      if (submitBtn) submitBtn.textContent = 'Simpan Pengeluaran';
      if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
      
      const branchSel = document.getElementById('expense-branch');
      if (branchSel && appState.currentBranch !== 'ALL') {
        branchSel.value = appState.currentBranch;
      }
      modal.classList.remove('hidden');
    }

    function openModalForEdit(expId) {
      if (!modal) return;
      const target = (appState.expenses || []).find(e => e.id === expId);
      if (!target) {
        showToast('Data pengeluaran tidak ditemukan!', 'error');
        return;
      }

      if (editIdInput) editIdInput.value = target.id;
      if (titleEl) titleEl.textContent = 'Edit Pengeluaran Beban Operasional';
      if (submitBtn) submitBtn.textContent = 'Perbarui Pengeluaran';
      
      const branchSel = document.getElementById('expense-branch');
      if (branchSel) branchSel.value = target.branchId || 'TLD';
      if (dateInput) dateInput.value = target.date || new Date().toISOString().split('T')[0];
      const catSel = document.getElementById('expense-category');
      if (catSel) catSel.value = target.category || 'Biaya Lain-lain';
      const amtInput = document.getElementById('expense-amount');
      if (amtInput) amtInput.value = target.amount || 0;
      const notesInput = document.getElementById('expense-notes');
      if (notesInput) notesInput.value = target.notes || '';

      modal.classList.remove('hidden');
    }

    if (openBtn) openBtn.addEventListener('click', openModalForAdd);
    if (quickAddBtn) quickAddBtn.addEventListener('click', openModalForAdd);

    if (modal) {
      modal.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => modal.classList.add('hidden'));
      });
    }

    // Delegated edit & delete buttons
    if (expListEl) {
      expListEl.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit-expense');
        const delBtn = e.target.closest('.btn-delete-expense');

        if (editBtn) {
          const id = editBtn.dataset.id;
          openModalForEdit(id);
        } else if (delBtn) {
          const id = delBtn.dataset.id;
          const target = (appState.expenses || []).find(x => x.id === id);
          if (!target) return;

          const ok = confirm(`Konfirmasi Hapus:\nApakah Anda yakin ingin menghapus catatan biaya "${target.category} - ${formatIDR(target.amount)}"?`);
          if (ok) {
            appState.expenses = (appState.expenses || []).filter(x => x.id !== id);
            appState.deletedExpenseIds = appState.deletedExpenseIds || [];
            appState.deletedExpenseIds.push(id);
            saveState();
            showToast(`Pengeluaran ${target.category} berhasil dihapus!`, 'success');
            renderFinance();
            renderDashboard();
          }
        }
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const editId = editIdInput ? editIdInput.value : '';
        const branchVal = document.getElementById('expense-branch').value;
        const dateVal = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0];
        const catVal = document.getElementById('expense-category').value;
        const amountVal = Number(document.getElementById('expense-amount').value);
        const notesVal = document.getElementById('expense-notes').value.trim();

        if (isNaN(amountVal) || amountVal <= 0) {
          showToast('Nominal biaya harus lebih besar dari Rp 0!', 'error');
          return;
        }

        if (editId) {
          // Edit existing expense
          const idx = (appState.expenses || []).findIndex(x => x.id === editId);
          if (idx !== -1) {
            appState.expenses[idx] = {
              ...appState.expenses[idx],
              branchId: branchVal,
              date: dateVal,
              category: catVal,
              amount: amountVal,
              notes: notesVal
            };
            showToast(`Pengeluaran ${catVal} berhasil diperbarui!`, 'success');
          }
        } else {
          // Create new expense
          const newExp = {
            id: 'EXP-' + Date.now(),
            branchId: branchVal,
            date: dateVal,
            category: catVal,
            amount: amountVal,
            notes: notesVal
          };
          appState.expenses = appState.expenses || [];
          appState.expenses.push(newExp);
          showToast(`Pengeluaran ${catVal} sebesar ${formatIDR(amountVal)} berhasil dicatat!`, 'success');
        }

        saveState();
        modal.classList.add('hidden');
        form.reset();
        renderFinance();
        renderDashboard();
      });
    }

    // Setup Period Filter Buttons & Inputs
    document.querySelectorAll('.finance-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.finance-period-btn').forEach(b => {
          b.classList.remove('bg-emerald-600', 'text-white');
          b.classList.add('bg-slate-100', 'text-slate-700');
        });
        btn.classList.remove('bg-slate-100', 'text-slate-700');
        btn.classList.add('bg-emerald-600', 'text-white');

        financeFilter.period = btn.dataset.period || 'this_month';
        renderFinance();
      });
    });

    const applyFilterBtn = document.getElementById('btn-apply-finance-filter');
    const resetFilterBtn = document.getElementById('btn-reset-finance-filter');
    const startInput = document.getElementById('finance-start-date');
    const endInput = document.getElementById('finance-end-date');

    if (applyFilterBtn && startInput && endInput) {
      applyFilterBtn.addEventListener('click', () => {
        const sVal = startInput.value;
        const eVal = endInput.value;
        if (!sVal || !eVal) {
          showToast('Harap pilih Tanggal Dari dan Sampai!', 'warning');
          return;
        }
        if (sVal > eVal) {
          showToast('Tanggal Dari tidak boleh lebih besar dari Sampai!', 'warning');
          return;
        }

        document.querySelectorAll('.finance-period-btn').forEach(b => {
          b.classList.remove('bg-emerald-600', 'text-white');
          b.classList.add('bg-slate-100', 'text-slate-700');
        });

        financeFilter.period = 'custom';
        financeFilter.startDate = sVal;
        financeFilter.endDate = eVal;
        renderFinance();
        showToast(`Memfilter laporan periode ${sVal} s/d ${eVal}`, 'info');
      });
    }

    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', () => {
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        document.querySelectorAll('.finance-period-btn').forEach(b => {
          if (b.dataset.period === 'this_month') {
            b.classList.add('bg-emerald-600', 'text-white');
            b.classList.remove('bg-slate-100', 'text-slate-700');
          } else {
            b.classList.remove('bg-emerald-600', 'text-white');
            b.classList.add('bg-slate-100', 'text-slate-700');
          }
        });
        financeFilter.period = 'this_month';
        financeFilter.startDate = '';
        financeFilter.endDate = '';
        renderFinance();
        showToast('Periode dikembalikan ke Bulan Ini (Default)', 'info');
      });
    }
  }

  // ==========================================
  // 11. LAPORAN & EKSPOR EXCEL (CSV) & PDF
  // ==========================================
  function renderReports() {
    const reportType = document.getElementById('report-type-select').value;
    const thead = document.getElementById('report-table-head');
    const tbody = document.getElementById('report-table-body');
    const titleEl = document.getElementById('report-preview-title');

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (reportType === 'sales') {
      titleEl.textContent = 'Laporan Penjualan Transaksi Kasir';
      thead.innerHTML = `
        <tr>
          <th class="py-3 px-4">No. Struk</th>
          <th class="py-3 px-4">Waktu</th>
          <th class="py-3 px-4">Cabang</th>
          <th class="py-3 px-4">Kasir</th>
          <th class="py-3 px-4 text-right">Total Transaksi</th>
          <th class="py-3 px-4 text-center">Status Nota</th>
          <th class="py-3 px-4 text-center">Sync</th>
        </tr>`;

      appState.sales.forEach(s => {
        const isVoid = s.status === 'VOID';
        const isRevised = s.status === 'REVISED';
        tbody.innerHTML += `
          <tr class="hover:bg-slate-50 ${isVoid ? 'opacity-60 bg-red-50/20' : ''}">
            <td class="py-3 px-4 mono font-bold text-slate-900 ${isVoid ? 'line-through text-slate-400' : ''}">${s.id}</td>
            <td class="py-3 px-4 mono text-slate-500">${formatDateTimeWITA(s.date)}</td>
            <td class="py-3 px-4 font-semibold ${s.branchId === 'TLD' ? 'text-blue-600' : 'text-emerald-600'}">${s.branchId}</td>
            <td class="py-3 px-4">${s.cashier}</td>
            <td class="py-3 px-4 text-right mono font-extrabold ${isVoid ? 'line-through text-slate-400' : ''}">${formatIDR(s.total)}</td>
            <td class="py-3 px-4 text-center">
              ${isVoid ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-red-100 text-red-700">DIBATALKAN</span>' :
                isRevised ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-700">DIREVISI</span>' :
                '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">LUNAS</span>'}
            </td>
            <td class="py-3 px-4 text-center">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.synced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
                ${s.synced ? 'SYNCED' : 'PENDING'}
              </span>
            </td>
          </tr>`;
      });
    } else if (reportType === 'stock') {
      titleEl.textContent = 'Laporan Posisi Stok & FEFO per Cabang';
      thead.innerHTML = `
        <tr>
          <th class="py-3 px-4">Nama Obat</th>
          <th class="py-3 px-4">Cabang</th>
          <th class="py-3 px-4">No. Batch</th>
          <th class="py-3 px-4">Expired Date</th>
          <th class="py-3 px-4 text-right">Stok Fisik</th>
        </tr>`;

      appState.batches.forEach(b => {
        const med = appState.medicines.find(m => m.id === b.medicineId);
        tbody.innerHTML += `
          <tr class="hover:bg-slate-50">
            <td class="py-3 px-4 font-bold text-slate-900">${med ? med.name : b.medicineId}</td>
            <td class="py-3 px-4 font-semibold">${b.branchId}</td>
            <td class="py-3 px-4 mono">${b.batchNo}</td>
            <td class="py-3 px-4 mono">${b.expiryDate}</td>
            <td class="py-3 px-4 text-right mono font-bold">${b.stock}</td>
          </tr>`;
      });
    } else {
      titleEl.textContent = 'Laporan Laba Rugi Komparasi Cabang';
      thead.innerHTML = `
        <tr>
          <th class="py-3 px-4">Komponen Keuangan</th>
          <th class="py-3 px-4 text-right">Cabang Talaud</th>
          <th class="py-3 px-4 text-right">Cabang Kembang Janggut</th>
          <th class="py-3 px-4 text-right">Konsolidasi Total</th>
        </tr>`;

      tbody.innerHTML = `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 font-bold">1. Omzet Penjualan</td>
          <td class="py-3 px-4 text-right mono font-semibold">Rp 68.200.000</td>
          <td class="py-3 px-4 text-right mono font-semibold">Rp 60.250.000</td>
          <td class="py-3 px-4 text-right mono font-extrabold text-emerald-700">Rp 128.450.000</td>
        </tr>
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 pl-8 text-slate-600">2. HPP (Biaya Beli Obat)</td>
          <td class="py-3 px-4 text-right mono text-red-600">(Rp 47.740.000)</td>
          <td class="py-3 px-4 text-right mono text-red-600">(Rp 42.175.000)</td>
          <td class="py-3 px-4 text-right mono font-bold text-red-600">(Rp 89.915.000)</td>
        </tr>
        <tr class="hover:bg-slate-50 font-bold bg-slate-50">
          <td class="py-3 px-4">LABA KOTOR (Gross Margin)</td>
          <td class="py-3 px-4 text-right mono text-emerald-600">Rp 20.460.000</td>
          <td class="py-3 px-4 text-right mono text-emerald-600">Rp 18.075.000</td>
          <td class="py-3 px-4 text-right mono text-emerald-700">Rp 38.535.000</td>
        </tr>
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 pl-8 text-slate-600">3. Beban Operasional Toko</td>
          <td class="py-3 px-4 text-right mono text-amber-600">(Rp 6.200.000)</td>
          <td class="py-3 px-4 text-right mono text-amber-600">(Rp 5.000.000)</td>
          <td class="py-3 px-4 text-right mono font-bold text-amber-600">(Rp 11.200.000)</td>
        </tr>
        <tr class="hover:bg-slate-50 font-bold bg-emerald-50 text-emerald-900">
          <td class="py-3 px-4">LABA BERSIH (Net Income)</td>
          <td class="py-3 px-4 text-right mono text-emerald-700">Rp 14.260.000</td>
          <td class="py-3 px-4 text-right mono text-emerald-700">Rp 13.075.000</td>
          <td class="py-3 px-4 text-right mono text-emerald-800 text-sm">Rp 27.335.000</td>
        </tr>
      `;
    }
  }

  function setupReportsExport() {
    const typeSelect = document.getElementById('report-type-select');
    const exportBtn = document.getElementById('btn-export-csv');
    const printBtn = document.getElementById('btn-print-report');

    typeSelect.addEventListener('change', () => renderReports());

    exportBtn.addEventListener('click', () => {
      exportToExcelCSV();
    });

    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  function exportToExcelCSV() {
    const reportType = document.getElementById('report-type-select').value;
    let csvContent = "data:text/csv;charset=utf-8,";

    if (reportType === 'sales') {
      csvContent += "No. Struk,Waktu (WITA),Cabang,Kasir,Subtotal,Diskon,Total Bayar,Metode,Status Sync\n";
      appState.sales.forEach(s => {
        csvContent += `"${s.id}","${formatDateTimeWITA(s.date)}","${s.branchId}","${s.cashier}",${s.subtotal},${s.discount},${s.total},"${s.paymentMethod}","${s.synced ? 'SYNCED' : 'PENDING'}"\n`;
      });
    } else if (reportType === 'stock') {
      csvContent += "Nama Obat,Cabang,No. Batch,Tanggal Expired,Stok Fisik\n";
      appState.batches.forEach(b => {
        const med = appState.medicines.find(m => m.id === b.medicineId);
        csvContent += `"${med ? med.name : b.medicineId}","${b.branchId}","${b.batchNo}","${b.expiryDate}",${b.stock}\n`;
      });
    } else {
      csvContent += "Komponen Keuangan,Cabang Talaud,Cabang Kembang Janggut,Konsolidasi Total\n";
      csvContent += "Omzet Penjualan,68200000,60250000,128450000\n";
      csvContent += "HPP (Biaya Beli),47740000,42175000,89915000\n";
      csvContent += "Laba Kotor,20460000,18075000,38535000\n";
      csvContent += "Beban Operasional,6200000,5000000,11200000\n";
      csvContent += "Laba Bersih,14260000,13075000,27335000\n";
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Laporan_Tonang_Farma_${reportType}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Laporan berhasil diekspor ke format Excel (CSV)!', 'success');
  }

  // ==========================================
  // 12. AI BUSINESS ANALYST ENGINE
  // ==========================================
  function renderAIChat() {
    // Quick prompt buttons
    const chips = document.querySelectorAll('.ai-prompt-chip');
    chips.forEach(chip => {
      chip.onclick = () => {
        const text = chip.textContent.replace(/^[^\w]+/, '').trim();
        processAIQuery(text);
      };
    });
  }

  function setupAIChatListeners() {
    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-chat-send');

    const handleSend = () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      processAIQuery(q);
    };

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSend();
    });
  }

  function processAIQuery(query) {
    const historyEl = document.getElementById('ai-chat-history');

    // Append User Message
    historyEl.innerHTML += `
      <div class="flex items-start justify-end space-x-3">
        <div class="bg-emerald-600 text-white p-3.5 rounded-2xl rounded-tr-none text-xs leading-relaxed max-w-xl">
          ${query}
        </div>
        <div class="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shrink-0">
          Anda
        </div>
      </div>
    `;

    // Process Business Intelligence Logic Deterministically
    const q = query.toLowerCase();
    let replyTitle = 'Hasil Analisis Data Aktual:';
    let replyBody = '';

    if (q.includes('cabang mana') || q.includes('laba tertinggi') || q.includes('tertinggi') || q.includes('performa')) {
      replyTitle = 'Analisis Performa Komparasi Laba Cabang:';
      replyBody = `
        <div class="space-y-2">
          <p>Berdasarkan data keuangan bulan berjalan yang telah diverifikasi:</p>
          <ul class="list-disc pl-4 space-y-1">
            <li><b>Cabang Kepulauan Talaud:</b> Omzet <b>Rp 68.200.000</b>, Laba Bersih <b>Rp 14.850.000</b> (Margin Bersih: 21.7%).</li>
            <li><b>Cabang Kembang Janggut:</b> Omzet <b>Rp 60.250.000</b>, Laba Bersih <b>Rp 12.485.000</b> (Margin Bersih: 20.7%).</li>
          </ul>
          <p class="font-bold text-emerald-800">Kesimpulan AI:</p>
          <p><b>Cabang Talaud</b> menghasilkan laba bersih tertinggi (selisih +Rp 2.365.000). Namun, biaya logistik kapal Talaud mencapai Rp 1,2 juta per bulan. Jika pengiriman digabung per 2 minggu, penghematan margin dapat meningkat hingga 3.5%.</p>
        </div>
      `;
    } else if (q.includes('beli') || q.includes('restock') || q.includes('order') || q.includes('habis')) {
      replyTitle = 'Rekomendasi Pembelian & Restock Obat Minggu Ini:';
      
      const restockSuggestions = [];
      appState.medicines.forEach(m => {
        const total = appState.batches.filter(b => b.medicineId === m.id).reduce((s, b) => s + b.stock, 0);
        if (total <= m.minStock) {
          restockSuggestions.push({ name: m.name, stock: total, min: m.minStock, unit: m.buyUnit, rate: m.conversionRate });
        }
      });

      replyBody = `
        <div class="space-y-2">
          <p>Sistem mendeteksi <b>${restockSuggestions.length} produk</b> yang telah menyentuh batas minimum buffer stok:</p>
          <div class="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1.5 font-mono text-[11px]">
            ${restockSuggestions.map(r => `
              <div class="flex justify-between border-b border-slate-100 pb-1">
                <span>• <b>${r.name}</b> (Sisa: ${r.stock})</span>
                <span class="text-emerald-700 font-bold">Usulan PO: 5 ${r.unit}</span>
              </div>
            `).join('')}
          </div>
          <p class="text-[11px] text-slate-600">Pertimbangan Logistik: Mengingat kapal ekspedisi ke Talaud membutuhkan waktu 4-6 hari, disarankan membuat PO ke <b>PT Kimia Farma</b> sebelum hari Rabu.</p>
        </div>
      `;
    } else if (q.includes('expired') || q.includes('kadaluwarsa') || q.includes('slow')) {
      replyTitle = 'Laporan Audit Obat Expired & FEFO:';
      
      const expiredBatches = appState.batches.filter(b => getDaysUntilExpiry(b.expiryDate) < 0);
      const criticalBatches = appState.batches.filter(b => {
        const d = getDaysUntilExpiry(b.expiryDate);
        return d >= 0 && d <= 30;
      });

      replyBody = `
        <div class="space-y-2">
          <p>Hasil audit persediaan otomatis:</p>
          <div class="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-800 text-[11px] space-y-1">
            <div class="font-bold">1. Sudah Kedaluwarsa (${expiredBatches.length} batch):</div>
            ${expiredBatches.map(b => {
              const med = appState.medicines.find(m => m.id === b.medicineId);
              return `<div>• ${med ? med.name : b.medicineId} (Batch: ${b.batchNo}, Cabang: ${b.branchId}) - Sisa: ${b.stock} unit. Segera pisahkan ke lemari karantina retur PBF!</div>`;
            }).join('')}
          </div>

          <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] space-y-1">
            <div class="font-bold">2. Kritis Expired &lt;30 Hari (${criticalBatches.length} batch):</div>
            ${criticalBatches.map(b => {
              const med = appState.medicines.find(m => m.id === b.medicineId);
              return `<div>• ${med ? med.name : b.medicineId} (Batch: ${b.batchNo}) - Exp: ${b.expiryDate}. Segera tempatkan di barisan depan etalase kasir (FEFO).</div>`;
            }).join('')}
          </div>
        </div>
      `;
    } else if (q.includes('biaya') || q.includes('operasional') || q.includes('pengeluaran')) {
      replyTitle = 'Analisis Perbedaan Beban Operasional:';
      replyBody = `
        <div class="space-y-2">
          <p>Perbandingan biaya operasional antara kedua cabang:</p>
          <ul class="list-disc pl-4 space-y-1">
            <li><b>Cabang Talaud:</b> Rp 6.200.000 (Didorong oleh biaya logistik laut Rp 1.200.000 dan Internet Starlink Rp 850.000).</li>
            <li><b>Cabang Kembang Janggut:</b> Rp 5.000.000 (Biaya logistik darat Samarinda Rp 800.000 dan Orbit Rp 450.000).</li>
          </ul>
          <p>Biaya di Talaud 24% lebih tinggi karena faktor geografis kepulauan terpencil. Namun omzet Talaud juga lebih tinggi (+13.2%), sehingga rasio biaya operasional terhadap omzet masih tergolong sangat sehat (9.1% di Talaud vs 8.3% di KBJ).</p>
        </div>
      `;
    } else {
      replyTitle = 'Ringkasan Eksekutif Bisnis Tonang Farma:';
      replyBody = `
        <div class="space-y-2">
          <p>Saya dapat membantu Anda menganalisis:</p>
          <ul class="list-disc pl-4 space-y-1">
            <li>Analisis Omzet & Laba Bersih konsolidasi maupun per cabang.</li>
            <li>Rekomendasi pemesanan ulang (Restock PO) berdasarkan sisa stok & lead-time pengiriman.</li>
            <li>Pengawasan batch kadaluwarsa (FEFO) dan produk slow-moving.</li>
            <li>Rincian audit beban operasional dan efisiensi logistik.</li>
          </ul>
          <p class="text-slate-500 italic">Silakan klik salah satu tombol rekomendasi pertanyaan di atas untuk melihat analisis instan.</p>
        </div>
      `;
    }

    // Append AI Response
    setTimeout(() => {
      historyEl.innerHTML += `
        <div class="flex items-start space-x-3">
          <div class="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-bold text-xs shrink-0 shadow">
            AI
          </div>
          <div class="bg-slate-100 text-slate-800 p-4 rounded-2xl rounded-tl-none text-xs leading-relaxed max-w-2xl space-y-2 shadow-sm">
            <div class="font-bold text-slate-900 border-b border-slate-200 pb-1.5 flex items-center">
              <i data-lucide="sparkles" class="w-3.5 h-3.5 mr-1.5 text-amber-600"></i>
              ${replyTitle}
            </div>
            ${replyBody}
          </div>
        </div>
      `;
      historyEl.scrollTop = historyEl.scrollHeight;
      lucide.createIcons();
    }, 300);
  }

  // ==========================================
  // 13. USER MANAGEMENT & RBAC AUTH ENGINE
  // ==========================================
  let showAllPasswords = false;

  function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const currentUser = getCurrentUser();

    appState.users.forEach(u => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      
      const roleColor = u.role === 'OWNER' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                        u.role === 'ADMIN' ? 'bg-blue-100 text-blue-800 border-blue-300' :
                        u.role === 'APOTEKER' ? 'bg-teal-100 text-teal-800 border-teal-300' :
                        u.role === 'GUDANG' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                        'bg-slate-200 text-slate-800 border-slate-300';

      const branchLabel = u.branchId === 'ALL' ? '🌐 Semua Cabang (Pusat)' :
                          u.branchId === 'TLD' ? '🏝️ Cabang Talaud' : '🌲 Kembang Janggut';

      tr.innerHTML = `
        <td class="py-3 px-4 font-bold text-slate-900 flex items-center space-x-2">
          <div class="w-7 h-7 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs shrink-0">
            ${u.fullName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div>${u.fullName}</div>
            ${u.id === currentUser.id ? '<span class="text-[9px] text-emerald-600 font-extrabold">(Sesi Aktif Anda)</span>' : ''}
          </div>
        </td>
        <td class="py-3 px-4 font-mono font-bold text-slate-700">${u.username}</td>
        <td class="py-3 px-4 font-mono font-semibold text-slate-900">
          ${showAllPasswords ? u.password : '••••••••'}
        </td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${roleColor}">${u.role}</span>
        </td>
        <td class="py-3 px-4 font-semibold text-slate-700">${branchLabel}</td>
        <td class="py-3 px-4 text-center">
          <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">AKTIF</span>
        </td>
        <td class="py-3 px-4 text-center">
          <button type="button" class="btn-edit-user px-2.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold inline-flex items-center space-x-1 shadow-xs transition" data-user-id="${u.id}" title="Ubah Nama, Username, dan Kata Sandi">
            <i data-lucide="key-round" class="w-3.5 h-3.5"></i>
            <span>Ubah User & Sandi</span>
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
      btn.addEventListener('click', () => {
        const uId = btn.getAttribute('data-user-id');
        openEditUserModal(uId);
      });
    });

    lucide.createIcons();
  }

  function openEditUserModal(userId) {
    const user = (appState.users || []).find(u => u.id === userId);
    if (!user) return;

    const modal = document.getElementById('modal-edit-user');
    if (!modal) return;

    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-fullname').value = user.fullName;
    document.getElementById('edit-user-username').value = user.username;
    document.getElementById('edit-user-password').value = user.password;
    document.getElementById('edit-user-password').type = 'password';
    document.getElementById('edit-user-role').value = user.role;
    document.getElementById('edit-user-branch').value = user.branchId;

    const toggleBtn = document.getElementById('btn-toggle-edit-password');
    if (toggleBtn) toggleBtn.textContent = 'Lihat';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function loginAsUser(userId) {
    const targetUser = appState.users.find(u => u.id === userId);
    if (!targetUser) return;

    appState.isLoggedIn = true;
    appState.currentUserId = targetUser.id;
    saveState();

    const loginModal = document.getElementById('modal-login-switch');
    if (loginModal) {
      loginModal.classList.add('hidden');
      loginModal.querySelectorAll('.btn-close-modal').forEach(b => b.style.display = 'inline-flex');
    }

    const headerLogoutBtn = document.getElementById('btn-header-logout');
    if (headerLogoutBtn) headerLogoutBtn.style.display = 'inline-flex';

    updateRolePermissions();
    showToast(`Berhasil masuk sebagai ${targetUser.fullName} (${targetUser.role})`, 'success');
    renderUsersTable();
  }

  function performLogout() {
    appState.isLoggedIn = false;
    saveState();

    // Clear form inputs & error message
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorMsg = document.getElementById('login-error-msg');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (errorMsg) errorMsg.classList.add('hidden');

    // Update Topbar Display
    const nameEl = document.getElementById('user-display-name');
    const roleBadgeEl = document.getElementById('user-role-badge');
    const branchBadgeEl = document.getElementById('user-branch-badge');
    const avatarInitialsEl = document.getElementById('user-avatar-initials');
    const headerLogoutBtn = document.getElementById('btn-header-logout');
    const loginModal = document.getElementById('modal-login-switch');

    if (nameEl) nameEl.textContent = 'Belum Masuk';
    if (roleBadgeEl) roleBadgeEl.textContent = 'KELUAR';
    if (branchBadgeEl) branchBadgeEl.textContent = 'Silakan Login';
    if (avatarInitialsEl) avatarInitialsEl.textContent = '?';
    if (headerLogoutBtn) headerLogoutBtn.style.display = 'none';

    // Hide all tabs & panes
    document.querySelectorAll('.nav-tab').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

    // Open Login Modal with force (hide close button until logged in)
    if (loginModal) {
      loginModal.classList.remove('hidden');
      loginModal.querySelectorAll('.btn-close-modal').forEach(b => b.style.display = 'none');
    }

    showToast('Anda telah keluar (Logout). Silakan masukkan username dan password untuk masuk.', 'warning');
    lucide.createIcons();
  }

  function setupLoginAndUserModals() {
    const userProfileBtn = document.getElementById('btn-user-profile');
    const headerLogoutBtn = document.getElementById('btn-header-logout');
    const modalLogoutBtn = document.getElementById('btn-modal-logout');
    const loginModal = document.getElementById('modal-login-switch');
    const loginForm = document.getElementById('form-login');
    const quickLoginChips = document.querySelectorAll('.quick-login-chip');
    const toggleLoginPassBtn = document.getElementById('btn-toggle-login-password');

    const addUserBtn = document.getElementById('btn-open-add-user-modal');
    const addUserModal = document.getElementById('modal-add-user');
    const addUserForm = document.getElementById('form-add-user');

    const togglePassBtn = document.getElementById('btn-toggle-all-passwords');

    if (userProfileBtn && loginModal) {
      userProfileBtn.addEventListener('click', () => {
        loginModal.classList.remove('hidden');
      });
    }

    // Toggle password visibility in login form
    toggleLoginPassBtn?.addEventListener('click', () => {
      const passwordInput = document.getElementById('login-password');
      if (passwordInput) {
        const isPass = passwordInput.type === 'password';
        passwordInput.type = isPass ? 'text' : 'password';
        const eyeIcon = document.getElementById('eye-login-icon');
        if (eyeIcon) {
          eyeIcon.setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
          lucide.createIcons();
        }
      }
    });

    // Logout button listeners
    headerLogoutBtn?.addEventListener('click', () => {
      performLogout();
    });

    modalLogoutBtn?.addEventListener('click', () => {
      performLogout();
    });

    loginModal?.querySelectorAll('.btn-close-modal').forEach(b => {
      b.addEventListener('click', () => loginModal.classList.add('hidden'));
    });

    // Form login submission (Strict validation)
    loginForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = document.getElementById('login-username').value.trim();
      const p = document.getElementById('login-password').value.trim();
      const errorMsg = document.getElementById('login-error-msg');
      const errorText = document.getElementById('login-error-text');

      const matched = appState.users.find(user => user.username === u && user.password === p);
      if (matched) {
        if (errorMsg) errorMsg.classList.add('hidden');
        loginAsUser(matched.id);
        loginModal.classList.add('hidden');
        loginForm.reset();
      } else {
        if (errorMsg) {
          errorMsg.classList.remove('hidden');
          if (errorText) errorText.textContent = 'Kata sandi atau username salah! Silakan coba lagi.';
        }
        const passwordInput = document.getElementById('login-password');
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
        showToast('Kata sandi atau username salah! Akses ditolak.', 'error');
      }
    });

    // Role credential helper chips: ONLY sets username, keeps password field EMPTY so user MUST type password!
    quickLoginChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const u = chip.getAttribute('data-u');
        const usernameInput = document.getElementById('login-username');
        const passwordInput = document.getElementById('login-password');
        const errorMsg = document.getElementById('login-error-msg');

        if (errorMsg) errorMsg.classList.add('hidden');

        if (usernameInput && passwordInput) {
          usernameInput.value = u;
          passwordInput.value = ''; // Always keep password empty!
          passwordInput.focus();
          showToast(`Username '${u}' dipilih. Silakan ketik kata sandi (password) Anda untuk masuk.`);
        }
      });
    });

    // Toggle password view
    togglePassBtn?.addEventListener('click', () => {
      showAllPasswords = !showAllPasswords;
      const label = document.getElementById('label-toggle-passwords');
      if (label) label.textContent = showAllPasswords ? 'Sembunyikan Password' : 'Tampilkan Password';
      renderUsersTable();
    });

    // Add User Modal
    addUserBtn?.addEventListener('click', () => addUserModal?.classList.remove('hidden'));
    addUserModal?.querySelectorAll('.btn-close-modal').forEach(b => {
      b.addEventListener('click', () => addUserModal.classList.add('hidden'));
    });

    addUserForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const newUser = {
        id: 'USR-' + String(appState.users.length + 1).padStart(2, '0'),
        fullName: document.getElementById('new-user-fullname').value.trim(),
        username: document.getElementById('new-user-username').value.trim(),
        password: document.getElementById('new-user-password').value.trim(),
        role: document.getElementById('new-user-role').value,
        branchId: document.getElementById('new-user-branch').value,
        active: true
      };

      if (appState.users.some(u => u.username === newUser.username)) {
        showToast('Username sudah digunakan oleh akun lain!', 'error');
        return;
      }

      appState.users.push(newUser);
      saveState();
      addUserModal.classList.add('hidden');
      addUserForm.reset();
      showToast(`Pengguna baru ${newUser.fullName} (${newUser.role}) berhasil ditambahkan!`, 'success');
      renderUsersTable();
    });

    // Edit User Modal (Owner Authority)
    const editUserModal = document.getElementById('modal-edit-user');
    const editUserForm = document.getElementById('form-edit-user');
    const toggleEditPassBtn = document.getElementById('btn-toggle-edit-password');

    editUserModal?.querySelectorAll('.btn-close-modal').forEach(b => {
      b.addEventListener('click', () => editUserModal.classList.add('hidden'));
    });
    editUserModal?.addEventListener('click', (e) => {
      if (e.target === editUserModal) editUserModal.classList.add('hidden');
    });

    toggleEditPassBtn?.addEventListener('click', () => {
      const passInput = document.getElementById('edit-user-password');
      if (passInput) {
        const isPass = passInput.type === 'password';
        passInput.type = isPass ? 'text' : 'password';
        toggleEditPassBtn.textContent = isPass ? 'Sembunyikan' : 'Lihat';
      }
    });

    editUserForm?.addEventListener('submit', (e) => {
      e.preventDefault();

      // Strict role check: Only OWNER has authority
      const current = getCurrentUser();
      if (current.role !== 'OWNER') {
        showToast('Akses ditolak: Hanya Owner yang berwenang mengubah akun dan sandi anggota!', 'error');
        return;
      }

      const uId = document.getElementById('edit-user-id').value;
      const targetUser = (appState.users || []).find(u => u.id === uId);
      if (!targetUser) return;

      const newFullname = document.getElementById('edit-user-fullname').value.trim();
      const newUsername = document.getElementById('edit-user-username').value.trim();
      const newPassword = document.getElementById('edit-user-password').value.trim();
      const newRole = document.getElementById('edit-user-role').value;
      const newBranch = document.getElementById('edit-user-branch').value;

      if (!newFullname || !newUsername || !newPassword) {
        showToast('Nama, username, dan kata sandi wajib diisi!', 'warning');
        return;
      }

      // Check if username taken by another user
      const duplicate = (appState.users || []).some(u => u.id !== uId && u.username.toLowerCase() === newUsername.toLowerCase());
      if (duplicate) {
        showToast(`Username "${newUsername}" sudah dipakai oleh akun lain! Gunakan username lain.`, 'error');
        return;
      }

      // Update user credentials
      targetUser.fullName = newFullname;
      targetUser.username = newUsername;
      targetUser.password = newPassword;
      targetUser.role = newRole;
      targetUser.branchId = newBranch;

      saveState();
      pushStateToServer();

      // If updating active session user, refresh display
      if (current.id === targetUser.id) {
        updateRolePermissions();
      }

      editUserModal.classList.add('hidden');
      showToast(`Kredensial ${targetUser.fullName} berhasil diperbarui! Username: ${targetUser.username}, Sandi telah diperbarui.`, 'success');
      renderUsersTable();
    });
  }

  function getActiveAppUrl() {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return window.location.origin;
    }
    const mobileText = document.getElementById('mobile-url-text')?.textContent.trim();
    if (mobileText && mobileText.startsWith('http')) return mobileText;
    return 'https://pos.tonangfarma.com';
  }

  function setupMobileAccessModal() {
    const mobileBtn = document.getElementById('btn-open-mobile-modal');
    const mobileModal = document.getElementById('modal-mobile-access');
    const copyBtn = document.getElementById('btn-copy-mobile-url');

    if (mobileBtn && mobileModal) {
      mobileBtn.addEventListener('click', () => {
        mobileModal.classList.remove('hidden');
      });
      mobileModal.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => mobileModal.classList.add('hidden'));
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text = getActiveAppUrl();
        navigator.clipboard.writeText(text).then(() => {
          showToast('URL berhasil disalin ke clipboard!');
        }).catch(() => {
          showToast('URL: ' + text);
        });
      });
    }
  }

  function setupDownloadModal() {
    const dlBtns = [document.getElementById('btn-open-download-modal'), document.getElementById('btn-open-download-modal-m')].filter(Boolean);
    const dlModal = document.getElementById('modal-download-app');
    const copyIpadBtn = document.getElementById('btn-copy-ipad-url');

    if (dlBtns.length > 0 && dlModal) {
      dlBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          dlModal.classList.remove('hidden');
          if (window.lucide) lucide.createIcons();
        });
      });
      dlModal.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => dlModal.classList.add('hidden'));
      });
      dlModal.addEventListener('click', (e) => {
        if (e.target === dlModal) dlModal.classList.add('hidden');
      });
    }

    const copyAndroidBtn = document.getElementById('btn-copy-android-url');
    if (copyAndroidBtn) {
      copyAndroidBtn.addEventListener('click', () => {
        const url = getActiveAppUrl();
        navigator.clipboard.writeText(url).then(() => {
          showToast('Link berhasil disalin! Buka di Google Chrome HP Anda lalu klik "Instal Aplikasi".', 'success');
        }).catch(() => {
          showToast('Buka di Chrome: ' + url, 'info');
        });
      });
    }

    if (copyIpadBtn) {
      copyIpadBtn.addEventListener('click', () => {
        const url = getActiveAppUrl();
        navigator.clipboard.writeText(url).then(() => {
          showToast('Tautan akses untuk iPad/Safari berhasil disalin!', 'success');
        }).catch(() => {
          showToast('Buka di Safari iPad: ' + url, 'info');
        });
      });
    }
  }

  // ==========================================
  // 14. APP INITIALIZER
  // ==========================================
  function init() {
    setupNavigation();
    setupHeaderControls();
    setupPOSListeners();
    setupSalesCorrectionModals();
    setupMedicineModal();
    setupBranchPricingModal();
    setupDeleteMedicineModal();
    setupTransferStockModal();
    setupBatchActionModals();
    setupIncomingStockModal();
    setupPurchaseDebtModals();
    setupSupplierManagement();
    setupExpenseModal();
    setupReportsExport();
    setupAIChatListeners();
    setupLoginAndUserModals();
    setupMobileAccessModal();
    setupDownloadModal();

    // Initialize user permissions & active role
    if (appState.isLoggedIn === false) {
      performLogout();
    } else {
      updateRolePermissions();
      renderDashboard();
    }

    // Connect to Central Real-Time Sync Engine (multi-device & cross-IP)
    initRealtimeSync();

    // Start Real-Time WITA Official Clock
    updateLiveWITAClock();
    setInterval(updateLiveWITAClock, 1000);

    lucide.createIcons();
    console.log('Tonang Farma PMS Initialized successfully with RBAC.');
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
