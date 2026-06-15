// ==========================================================================
// Aegis Health ITAM - Enterprise SPA Controller v2.0
// Auth + Router + 8 Pages + Toast Notifications + WebSocket
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // STATE
    // ==========================================
    let ws;
    let telemetryChart = null;
    let miniCharts = {};
    let currentUser = null;
    let currentPage = 'dashboard';
    let assetsData = [];
    let employeesData = [];
    let workflowsData = [];
    let procurementData = [];
    let currentUploadAssetTag = null;
    let currentUploadWfEmpId = null;
    let assetFilter = 'all';
    let assetSearch = '';
    let assetSortCol = null;
    let assetSortDir = 1;
    let mdmToggles = { jamf: true, intune: false };
    let secretVisible = false;

    // ==========================================
    // ROLE-BASED PAGE PERMISSIONS
    // ==========================================
    // Defines which pages each role is allowed to visit / see in sidebar
    const rolePermissions = {
        'hr-admin':           ['dashboard','assets','employees','workflows','procurement','compliance','integration-lab','settings'],
        'it-helpdesk':        ['dashboard','assets','employees','workflows','procurement','compliance','integration-lab'],
        'compliance-auditor': ['dashboard','assets','employees','workflows','procurement','compliance'],
        'guest':              ['dashboard','assets','employees','workflows','procurement'],
    };

    function canAccess(page) {
        if (!currentUser) return false;
        const allowed = rolePermissions[currentUser.role] || [];
        return allowed.includes(page);
    }

    // ==========================================
    // HMAC HELPER (Web Crypto API)
    // ==========================================
    async function generateHMAC(key, message) {
        const encoder = new TextEncoder();
        const cryptoKey = await window.crypto.subtle.importKey(
            'raw', encoder.encode(key),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sig = await window.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ==========================================
    // TOAST MANAGER
    // ==========================================
    const toastContainer = document.getElementById('toast-container');
    const toastIcons = { success: 'fa-circle-check', danger: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };

    function showToast(type, title, message, duration = 5000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fa-solid ${toastIcons[type] || toastIcons.info} toast-icon"></i>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-msg">${message}</div>
            </div>
            <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
        `;
        toastContainer.appendChild(toast);
        toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
        setTimeout(() => removeToast(toast), duration);
    }

    function removeToast(toast) {
        if (!toast.parentNode) return;
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }

    // ==========================================
    // AUTH MANAGER
    // ==========================================
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app-shell');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const loginBtn = document.getElementById('login-btn');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('login-password');

    togglePasswordBtn.addEventListener('click', () => {
        const isText = passwordInput.type === 'text';
        passwordInput.type = isText ? 'password' : 'text';
        togglePasswordBtn.querySelector('i').className = isText ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = passwordInput.value;

        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Authenticating...</span>';
        loginError.style.display = 'none';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login failed');

            currentUser = data.user;
            enterApp();
        } catch (err) {
            loginError.style.display = 'flex';
            loginError.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${err.message}`;
        } finally {
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> <span>Sign In</span>';
        }
    });

    function enterApp() {
        loginScreen.style.display = 'none';
        appShell.style.display = 'flex';
        updateUserUI();
        applySidebarVisibility();
        connectWebSocket();
        navigateTo('dashboard');
        refreshAllData();
        setInterval(refreshAllData, 10000);
    }

    function updateUserUI() {
        if (!currentUser) return;
        const initials = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        document.getElementById('sidebar-user-avatar').textContent = initials;
        document.getElementById('sidebar-user-name').textContent = currentUser.name;
        document.getElementById('sidebar-user-role').textContent = currentUser.roleLabel;
        document.getElementById('topbar-avatar').textContent = initials;
        document.getElementById('topbar-user-name').textContent = currentUser.name;
        document.getElementById('topbar-user-role').textContent = currentUser.roleLabel;
    }

    // Show/hide sidebar links and section labels based on role
    function applySidebarVisibility() {
        if (!currentUser) return;
        const allowed = rolePermissions[currentUser.role] || [];

        // Show/hide nav links
        document.querySelectorAll('.sidebar-link').forEach(link => {
            const page = link.dataset.page;
            link.style.display = allowed.includes(page) ? '' : 'none';
        });

        // Hide section labels that have NO visible links under them
        document.querySelectorAll('.sidebar-section-label').forEach(label => {
            // Find the next sibling nav group
            const nav = label.nextElementSibling;
            if (!nav) return;
            const visibleLinks = nav.querySelectorAll('.sidebar-link:not([style*="display: none"])');
            // If all links in this section are hidden, hide the label and nav too
            label.style.display = visibleLinks.length === 0 ? 'none' : '';
            nav.style.display = visibleLinks.length === 0 ? 'none' : '';
        });
    }

    document.getElementById('btn-logout').addEventListener('click', () => {
        currentUser = null;
        if (ws) ws.close();
        if (telemetryChart) { telemetryChart.destroy(); telemetryChart = null; }
        appShell.style.display = 'none';
        loginScreen.style.display = 'flex';
        loginForm.reset();
        loginError.style.display = 'none';
    });

    // ==========================================
    // ROUTER
    // ==========================================
    const pageTitle = document.getElementById('page-title');
    const pageBreadcrumb = document.getElementById('page-breadcrumb');
    const pageContent = document.getElementById('page-content');

    const pages = {
        dashboard: { title: 'Dashboard', breadcrumb: 'Overview › Real-time ITAM Status', icon: 'fa-gauge-high' },
        assets: { title: 'Asset Registry', breadcrumb: 'Operations › IT Asset Management', icon: 'fa-boxes-stacked' },
        employees: { title: 'Employees', breadcrumb: 'Operations › Employee Directory', icon: 'fa-users' },
        workflows: { title: 'Workflows', breadcrumb: 'Operations › Temporal Workflow Engine', icon: 'fa-rotate' },
        procurement: { title: 'Procurement', breadcrumb: 'Operations › Coupa ERP Orders', icon: 'fa-file-invoice-dollar' },
        compliance: { title: 'Compliance & Reports', breadcrumb: 'Operations › HIPAA Compliance Gateway', icon: 'fa-shield-check' },
        'integration-lab': { title: 'Integration Lab', breadcrumb: 'System › Webhook & Event Simulator', icon: 'fa-flask' },
        settings: { title: 'Settings', breadcrumb: 'System › Configuration & Integrations', icon: 'fa-gear' },
    };

    function navigateTo(page) {
        // Guard: redirect to dashboard if user doesn't have access
        if (!canAccess(page)) {
            renderAccessDenied(page);
            return;
        }

        currentPage = page;
        const meta = pages[page] || pages.dashboard;
        pageTitle.textContent = meta.title;
        pageBreadcrumb.innerHTML = meta.breadcrumb;

        document.querySelectorAll('.sidebar-link').forEach(l => {
            l.classList.toggle('active', l.dataset.page === page);
        });

        pageContent.innerHTML = '';
        pageContent.className = 'page-content page-enter';

        const renderers = {
            dashboard: renderDashboard,
            assets: renderAssets,
            employees: renderEmployees,
            workflows: renderWorkflows,
            procurement: renderProcurement,
            compliance: renderCompliance,
            'integration-lab': renderIntegrationLab,
            settings: renderSettings,
        };
        (renderers[page] || renderDashboard)();
    }

    function renderAccessDenied(page) {
        currentPage = page;
        const meta = pages[page] || { title: page, breadcrumb: '' };
        pageTitle.textContent = meta.title;
        pageBreadcrumb.innerHTML = meta.breadcrumb;
        pageContent.className = 'page-content page-enter';
        pageContent.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;gap:20px;text-align:center;">
                <div style="width:80px;height:80px;border-radius:20px;background:var(--danger-glow);border:1px solid var(--danger);display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-lock" style="font-size:32px;color:var(--danger);"></i>
                </div>
                <div>
                    <h2 style="font-family:var(--font-heading);font-size:22px;margin-bottom:8px;">Access Restricted</h2>
                    <p style="color:var(--text-secondary);font-size:14px;max-width:380px;">
                        Your current role (<strong style="color:var(--accent-primary);">${currentUser?.roleLabel || 'Unknown'}</strong>) does not have permission to view this page.
                    </p>
                </div>
                <div style="background:rgba(0,0,0,0.2);border:1px solid var(--border-card);border-radius:12px;padding:16px 24px;font-size:13px;color:var(--text-muted);">
                    <i class="fa-solid fa-circle-info" style="color:var(--accent-primary);margin-right:6px;"></i>
                    Contact your HR Admin or IT Administrator to request elevated access.
                </div>
                <button class="btn btn-outline-teal" onclick="navigateTo('dashboard')">
                    <i class="fa-solid fa-house"></i> Back to Dashboard
                </button>
            </div>`;
    }

    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });

    // ==========================================
    // WEBSOCKET
    // ==========================================
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}`);

        ws.onopen = () => {
            updateWSStatus('connected');
            showToast('success', 'Connected', 'WebSocket synchronized with ITAM gateway.');
        };
        ws.onclose = () => {
            updateWSStatus('disconnected');
            setTimeout(connectWebSocket, 3000);
        };
        ws.onmessage = (e) => handleIncomingMessage(JSON.parse(e.data));
    }

    function updateWSStatus(status) {
        const el = document.getElementById('ws-status');
        if (!el) return;
        const ind = el.querySelector('.status-indicator');
        if (status === 'connected') {
            ind.className = 'status-indicator green';
            el.childNodes[el.childNodes.length - 1].nodeValue = ' Live';
        } else {
            ind.className = 'status-indicator red';
            el.childNodes[el.childNodes.length - 1].nodeValue = ' Offline';
        }
    }

    function handleIncomingMessage(msg) {
        switch (msg.type) {
            case 'SYSTEM_MESSAGE':
                appendConsole('success', msg.payload);
                if (msg.payload.includes('Onboarded')) showToast('success', 'Employee Onboarded', msg.payload.replace('[Onboarding] ', ''));
                if (msg.payload.includes('Failure Risk')) showToast('warning', 'AI Alert', msg.payload.replace('[AI Model] ', ''));
                if (msg.payload.includes('SECURITY')) showToast('danger', 'Security Event', msg.payload.replace('[SECURITY WARNING] ', '').replace('[SECURITY ALERT] ', ''));
                break;
            case 'KAFKA_EVENT':
                appendConsole('kafka', `[Topic: hr.employee.events] ${msg.payload.eventType} — ID: ${msg.payload.eventId.substring(0, 8)}`);
                if (msg.payload.eventType === 'EmployeeTerminatedEvent') showToast('warning', 'Offboarding Started', `Workflow launched for employee ${msg.payload.data.employeeId}`);
                if (msg.payload.eventType === 'PurchaseOrderCreatedEvent') showToast('info', 'Auto-PO Created', `${msg.payload.data.item} replacement order triggered by AI`);
                refreshAllData();
                break;
            case 'KAFKA_LOG_HISTORY':
                msg.payload.forEach(log => appendConsole('kafka', `[Log] ${log.eventType} — ID: ${log.eventId.substring(0, 8)}`));
                break;
            case 'WORKFLOW_UPDATE':
                workflowsData = workflowsData.filter(w => w.workflowId !== msg.payload.workflowId);
                workflowsData.unshift(msg.payload);
                appendConsole('workflow', `[Temporal] ${msg.payload.workflowId} → Step: ${msg.payload.step}`);
                if (currentPage === 'workflows') renderWorkflows();
                updateWorkflowBadge();
                refreshAllData();
                break;
            case 'TELEMETRY_BATCH':
                updateTelemetryChart(msg.payload);
                break;
            case 'DATA_REFRESH':
                refreshAllData();
                break;
        }
    }

    function appendConsole(type, msg) {
        const el = document.getElementById('console-stream');
        if (!el) return;
        const line = document.createElement('div');
        line.className = `console-line ${type} animate-slide-up`;
        line.innerHTML = `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span><span> ${msg}</span>`;
        el.appendChild(line);
        el.scrollTop = el.scrollHeight;
    }

    // ==========================================
    // DATA FETCHING
    // ==========================================
    async function refreshAllData() {
        await Promise.all([fetchAssets(), fetchEmployees(), fetchWorkflows(), fetchProcurement()]);
        updateKPIBadges();
    }

    async function fetchAssets() {
        try {
            const res = await fetch('/api/assets');
            assetsData = await res.json();
            if (currentPage === 'assets') renderAssetsTable();
            if (currentPage === 'dashboard') renderDashboardAssetTable();
        } catch (e) { console.error('fetchAssets', e); }
    }

    async function fetchEmployees() {
        try {
            const res = await fetch('/api/employees');
            employeesData = await res.json();
            if (currentPage === 'employees') renderEmployeeCards();
        } catch (e) { console.error('fetchEmployees', e); }
    }

    async function fetchWorkflows() {
        try {
            const res = await fetch('/api/workflows');
            workflowsData = await res.json();
            if (currentPage === 'workflows') renderWorkflows();
            updateWorkflowBadge();
        } catch (e) { console.error('fetchWorkflows', e); }
    }

    async function fetchProcurement() {
        try {
            const res = await fetch('/api/procurement/orders');
            procurementData = await res.json();
            if (currentPage === 'procurement') renderProcurementTable();
        } catch (e) { console.error('fetchProcurement', e); }
    }

    function updateKPIBadges() {
        const needsWipe = assetsData.filter(a => a.status === 'Needs Sanitization').length;
        const badge = document.getElementById('badge-needs-wipe');
        if (badge) {
            badge.textContent = needsWipe;
            badge.style.display = needsWipe > 0 ? 'flex' : 'none';
        }
        if (currentPage === 'dashboard') refreshKPICards();
    }

    function updateWorkflowBadge() {
        const running = workflowsData.filter(w => w.status === 'Running').length;
        const badge = document.getElementById('badge-workflows');
        if (badge) {
            badge.textContent = running;
            badge.style.display = running > 0 ? 'flex' : 'none';
        }
    }

    // ==========================================
    // PAGE: DASHBOARD
    // ==========================================
    function renderDashboard() {
        pageContent.innerHTML = `
            <!-- KPI Row -->
            <div class="kpi-grid" id="kpi-grid">
                ${renderKPICards()}
            </div>
            <div class="dashboard-grid">
                <!-- Telemetry Chart -->
                <section class="panel">
                    <div class="panel-header">
                        <h2><i class="fa-solid fa-gauge-high header-icon"></i> Telemetry & Predictive AI Analytics</h2>
                        <span class="badge badge-teal">InfluxDB Pulse</span>
                    </div>
                    <div class="panel-body" style="display:flex;flex-direction:column;gap:8px;">
                        <p class="panel-desc">Real-time CPU temp and battery health streaming from MDM. High thresholds trigger automated replacement POs.</p>
                        <div class="chart-container"><canvas id="telemetryChart"></canvas></div>
                    </div>
                </section>
                <!-- Procurement summary -->
                <section class="panel">
                    <div class="panel-header">
                        <h2><i class="fa-solid fa-file-invoice-dollar header-icon"></i> Recent Procurement Orders</h2>
                        <span class="badge badge-green">Coupa ERP</span>
                    </div>
                    <div class="panel-body no-pad">
                        <div class="table-responsive">
                            <table class="data-table small-table">
                                <thead><tr><th>PO ID</th><th>Item</th><th>Qty</th><th>Cost</th><th>Status</th></tr></thead>
                                <tbody id="dashboard-po-body"></tbody>
                            </table>
                        </div>
                    </div>
                </section>
                <!-- Asset registry snapshot -->
                <section class="panel span-2">
                    <div class="panel-header">
                        <h2><i class="fa-solid fa-boxes-stacked header-icon"></i> Asset Registry Snapshot</h2>
                        <div class="header-actions">
                            <div class="search-box" style="width:220px;">
                                <i class="fa-solid fa-magnifying-glass"></i>
                                <input type="text" id="dash-asset-search" placeholder="Search assets...">
                            </div>
                            <a href="#" data-page="assets" class="sidebar-link-btn btn btn-outline-teal btn-sm" onclick="event.preventDefault(); navigateTo('assets')">
                                <i class="fa-solid fa-arrow-right"></i> Full Registry
                            </a>
                        </div>
                    </div>
                    <div class="panel-body no-pad">
                        <div class="table-responsive">
                            <table class="data-table" id="dash-asset-table">
                                <thead><tr><th>Tag</th><th>Model</th><th>Serial</th><th>Type</th><th>Assigned User</th><th>MDM Status</th><th>Status</th><th>Wipe Cert</th></tr></thead>
                                <tbody id="dash-asset-body"></tbody>
                            </table>
                        </div>
                    </div>
                </section>
                <!-- Active Workflows -->
                <section class="panel span-2">
                    <div class="panel-header">
                        <h2><i class="fa-solid fa-rotate header-icon"></i> Active Offboarding Workflows</h2>
                        <span class="badge badge-blue" id="dash-wf-count">0 Active</span>
                    </div>
                    <div class="panel-body">
                        <div class="workflows-container" id="dash-workflows-grid">
                            <div class="no-workflows"><i class="fa-solid fa-inbox"></i><p>No active workflows. Trigger offboarding from Integration Lab.</p></div>
                        </div>
                    </div>
                </section>
                <!-- Kafka Console -->
                <section class="panel span-2">
                    <div class="panel-header">
                        <h2><i class="fa-solid fa-terminal header-icon"></i> System Event Stream</h2>
                        <button id="btn-clear-console" class="btn btn-outline-light btn-xs"><i class="fa-solid fa-trash-can"></i> Clear</button>
                    </div>
                    <div class="console-body" id="console-stream">
                        <div class="console-line system"><span class="timestamp">[SYSTEM]</span><span> Aegis ITAM event pipeline active. Events will stream here in real-time.</span></div>
                    </div>
                </section>
            </div>`;

        // Wire up dashboard interactions
        document.getElementById('btn-clear-console')?.addEventListener('click', () => {
            const el = document.getElementById('console-stream');
            if (el) { el.innerHTML = ''; appendConsole('system', 'Console cleared.'); }
        });
        document.getElementById('dash-asset-search')?.addEventListener('input', (e) => {
            assetSearch = e.target.value;
            renderDashboardAssetTable();
        });

        initTelemetryChart();
        renderDashboardAssetTable();
        renderDashboardPOTable();
        renderDashboardWorkflows();
    }

    function renderKPICards() {
        const total = assetsData.length;
        const deployed = assetsData.filter(a => a.status === 'Deployed').length;
        const needsWipe = assetsData.filter(a => a.status === 'Needs Sanitization').length;
        const activeEmp = employeesData.filter(e => e.status === 'Active').length;
        const openPOs = procurementData.filter(o => o.status.includes('Approved')).length;
        return `
            <div class="kpi-card kpi-teal">
                <span class="kpi-label">Total Assets</span>
                <span class="kpi-value" id="kpi-total">${total}</span>
                <span class="kpi-sub"><i class="fa-solid fa-boxes-stacked"></i> In registry</span>
                <i class="fa-solid fa-boxes-stacked kpi-icon"></i>
            </div>
            <div class="kpi-card kpi-blue">
                <span class="kpi-label">Deployed</span>
                <span class="kpi-value" id="kpi-deployed">${deployed}</span>
                <span class="kpi-sub"><i class="fa-solid fa-laptop-medical"></i> MDM enrolled</span>
                <i class="fa-solid fa-laptop kpi-icon"></i>
            </div>
            <div class="kpi-card kpi-danger">
                <span class="kpi-label">Needs Sanitization</span>
                <span class="kpi-value ${needsWipe > 0 ? 'danger' : ''}" id="kpi-wipe">${needsWipe}</span>
                <span class="kpi-sub"><i class="fa-solid fa-triangle-exclamation"></i> Requires HIPAA wipe</span>
                <i class="fa-solid fa-soap kpi-icon"></i>
            </div>
            <div class="kpi-card kpi-success">
                <span class="kpi-label">Active Employees</span>
                <span class="kpi-value" id="kpi-emp">${activeEmp}</span>
                <span class="kpi-sub"><i class="fa-solid fa-user-check"></i> Staff on record</span>
                <i class="fa-solid fa-users kpi-icon"></i>
            </div>
            <div class="kpi-card kpi-purple">
                <span class="kpi-label">Open POs</span>
                <span class="kpi-value" id="kpi-po">${openPOs}</span>
                <span class="kpi-sub"><i class="fa-solid fa-file-invoice-dollar"></i> Procurement orders</span>
                <i class="fa-solid fa-file-invoice kpi-icon"></i>
            </div>`;
    }

    function refreshKPICards() {
        const grid = document.getElementById('kpi-grid');
        if (grid) grid.innerHTML = renderKPICards();
    }

    function renderDashboardAssetTable() {
        const tbody = document.getElementById('dash-asset-body');
        if (!tbody) return;
        const q = assetSearch.toLowerCase();
        const filtered = assetsData.filter(a =>
            !q || a.tag.toLowerCase().includes(q) || a.model.toLowerCase().includes(q) ||
            a.ownerName.toLowerCase().includes(q) || a.status.toLowerCase().includes(q)
        ).slice(0, 8);
        tbody.innerHTML = filtered.map(a => assetRow(a)).join('');
        bindWipeBtns();
    }

    function renderDashboardPOTable() {
        const tbody = document.getElementById('dashboard-po-body');
        if (!tbody) return;
        tbody.innerHTML = [...procurementData].reverse().slice(0, 6).map(o => `
            <tr>
                <td><strong>${o.poId}</strong></td>
                <td>${o.item}</td>
                <td>${o.quantity}</td>
                <td>$${o.unitCost}</td>
                <td><span class="status-badge ${o.status.includes('AI') ? 'ready' : 'deployed'}">${o.status}</span></td>
            </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No orders yet</td></tr>';
    }

    function renderDashboardWorkflows() {
        const grid = document.getElementById('dash-workflows-grid');
        if (!grid) return;
        const active = workflowsData.filter(w => w.status === 'Running');
        const badge = document.getElementById('dash-wf-count');
        if (badge) badge.textContent = `${active.length} Active`;
        if (workflowsData.length === 0) return;
        grid.innerHTML = workflowsData.slice(0, 3).map(wf => workflowCard(wf)).join('');
        bindWorkflowLogToggles();
    }

    // ==========================================
    // PAGE: ASSETS
    // ==========================================
    function renderAssets() {
        pageContent.innerHTML = `
            <section class="panel">
                <div class="panel-header">
                    <h2><i class="fa-solid fa-boxes-stacked header-icon"></i> Central ITAM Asset Registry</h2>
                    <div class="header-actions">
                        <div class="search-box">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <input type="text" id="asset-search-input" placeholder="Search tag, model, serial, owner..." value="${assetSearch}">
                        </div>
                    </div>
                </div>
                <div style="padding: 14px 24px; border-bottom: 1px solid var(--border-card); display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                    <div class="filter-chips" id="asset-filter-chips">
                        ${renderAssetFilterChips()}
                    </div>
                </div>
                <div class="panel-body no-pad">
                    <div class="table-responsive">
                        <table class="data-table" id="asset-table-full">
                            <thead>
                                <tr>
                                    <th data-col="tag">Asset Tag <i class="fa-solid fa-sort" style="font-size:10px;opacity:0.4;"></i></th>
                                    <th data-col="model">Model</th>
                                    <th data-col="serial">Serial Number</th>
                                    <th data-col="type">Type</th>
                                    <th data-col="ownerName">Assigned User</th>
                                    <th data-col="mdmStatus">MDM Status</th>
                                    <th data-col="status">Asset Status</th>
                                    <th>Wipe Cert</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="asset-table-body-full"></tbody>
                        </table>
                    </div>
                </div>
            </section>`;

        document.getElementById('asset-search-input')?.addEventListener('input', e => {
            assetSearch = e.target.value;
            renderAssetsTable();
        });
        document.querySelectorAll('#asset-filter-chips .filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                assetFilter = chip.dataset.filter;
                document.querySelectorAll('#asset-filter-chips .filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                renderAssetsTable();
            });
        });
        document.querySelectorAll('#asset-table-full th[data-col]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                if (assetSortCol === col) assetSortDir *= -1;
                else { assetSortCol = col; assetSortDir = 1; }
                renderAssetsTable();
            });
        });
        renderAssetsTable();
    }

    function renderAssetFilterChips() {
        const counts = {
            all: assetsData.length,
            deployed: assetsData.filter(a => a.status === 'Deployed').length,
            ready: assetsData.filter(a => a.status === 'Ready to Deploy').length,
            wipe: assetsData.filter(a => a.status === 'Needs Sanitization').length,
            wiped: assetsData.filter(a => a.mdmStatus && a.mdmStatus.includes('Wiped')).length,
        };
        return [
            { f: 'all', label: 'All Assets' },
            { f: 'deployed', label: 'Deployed' },
            { f: 'ready', label: 'Available' },
            { f: 'wipe', label: 'Needs Wipe' },
            { f: 'wiped', label: 'Wiped' },
        ].map(({ f, label }) =>
            `<div class="filter-chip ${assetFilter === f ? 'active' : ''}" data-filter="${f}">${label} <span class="chip-count">${counts[f]}</span></div>`
        ).join('');
    }

    function renderAssetsTable() {
        const tbody = document.getElementById('asset-table-body-full');
        if (!tbody) return;

        let filtered = assetsData.filter(a => {
            const q = assetSearch.toLowerCase();
            const matchSearch = !q || a.tag.toLowerCase().includes(q) || a.model.toLowerCase().includes(q) ||
                a.serial.toLowerCase().includes(q) || a.ownerName.toLowerCase().includes(q) || a.status.toLowerCase().includes(q);
            const matchFilter = assetFilter === 'all' ||
                (assetFilter === 'deployed' && a.status === 'Deployed') ||
                (assetFilter === 'ready' && a.status === 'Ready to Deploy') ||
                (assetFilter === 'wipe' && a.status === 'Needs Sanitization') ||
                (assetFilter === 'wiped' && a.mdmStatus && a.mdmStatus.includes('Wiped'));
            return matchSearch && matchFilter;
        });

        if (assetSortCol) {
            filtered.sort((a, b) => {
                const va = (a[assetSortCol] || '').toString().toLowerCase();
                const vb = (b[assetSortCol] || '').toString().toLowerCase();
                return va < vb ? -assetSortDir : va > vb ? assetSortDir : 0;
            });
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px;">No assets match the current filter.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(a => `
            ${assetRow(a, true)}
            <tr class="asset-expand-row" id="expand-${a.tag}" style="display:none;">
                <td colspan="9">
                    <div class="asset-expand-content">
                        <div class="asset-detail-block">
                            <span class="asset-detail-label">Asset Cost</span>
                            <span class="asset-detail-value">$${a.cost?.toLocaleString() || 'N/A'}</span>
                            <span class="asset-detail-label" style="margin-top:10px;">Owner ID</span>
                            <span class="asset-detail-value" style="font-family:monospace;">${a.ownerId || 'Unassigned'}</span>
                        </div>
                        <div class="asset-detail-block">
                            <span class="asset-detail-label">Wipe Certificate</span>
                            <span class="asset-detail-value">${a.wipeCertificate ? `<span class="text-success"><i class="fa-solid fa-file-circle-check"></i> ${a.wipeCertificate.fileName} (${a.wipeCertificate.fileSize})</span>` : '<span class="text-muted">None uploaded</span>'}</span>
                            ${a.wipeCertificate ? `<span class="asset-detail-label" style="margin-top:10px;">Uploaded At</span><span class="asset-detail-value">${new Date(a.wipeCertificate.uploadedAt).toLocaleString()}</span>` : ''}
                        </div>
                        <div class="asset-detail-block">
                            <span class="asset-detail-label">Recent Telemetry</span>
                            <div class="mini-chart-container"><canvas id="mini-chart-${a.tag}"></canvas></div>
                        </div>
                    </div>
                </td>
            </tr>`).join('');

        bindWipeBtns();
        // Expand row toggle
        tbody.querySelectorAll('tr[data-tag]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const tag = row.dataset.tag;
                const expandRow = document.getElementById(`expand-${tag}`);
                if (!expandRow) return;
                const isOpen = expandRow.style.display !== 'none';
                tbody.querySelectorAll('.asset-expand-row').forEach(r => r.style.display = 'none');
                tbody.querySelectorAll('tr[data-tag]').forEach(r => r.classList.remove('expanded'));
                if (!isOpen) {
                    expandRow.style.display = '';
                    row.classList.add('expanded');
                    renderMiniChart(tag);
                }
            });
        });
    }

    function assetRow(a, expandable = false) {
        const mdmHtml = a.mdmStatus?.includes('Locked')
            ? `<span class="mdm-badge text-danger" style="border-color:var(--danger)"><i class="fa-solid fa-lock"></i> Locked</span>`
            : a.mdmStatus?.includes('Wiped')
            ? `<span class="mdm-badge text-success" style="border-color:var(--success)"><i class="fa-solid fa-circle-check"></i> Wiped</span>`
            : `<span class="mdm-badge"><i class="fa-solid fa-laptop-medical"></i> ${a.mdmStatus}</span>`;

        const statusClass = a.status === 'Deployed' ? 'deployed' : a.status === 'Ready to Deploy' ? 'ready' : a.status === 'Needs Sanitization' ? 'needs-wipe' : a.status.includes('Wiped') ? 'wiped' : '';

        let certHtml = '<span style="color:var(--text-muted)">—</span>';
        if (a.status === 'Needs Sanitization') {
            if (a.wipeCertificate) {
                certHtml = `<span class="text-success"><i class="fa-solid fa-file-contract"></i> Verified</span>`;
            } else {
                const isDisabled = currentUser?.role !== 'it-helpdesk' ? 'disabled title="Requires IT Helpdesk role"' : '';
                certHtml = `<button class="btn btn-danger btn-xs btn-wipe-action" data-tag="${a.tag}" data-owner="${a.ownerId || ''}" ${isDisabled}><i class="fa-solid fa-file-arrow-up"></i> Upload Cert</button>`;
            }
        } else if (a.wipeCertificate) {
            certHtml = `<span class="text-success" title="Wiped ${new Date(a.wipeCertificate.uploadedAt).toLocaleString()}"><i class="fa-solid fa-file-circle-check"></i> Verified</span>`;
        }

        const chevron = expandable ? `<td><i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:11px;transition:0.3s;"></i></td>` : '';

        return `<tr ${expandable ? `data-tag="${a.tag}" style="cursor:pointer;"` : ''}>
            <td><strong>${a.tag}</strong></td>
            <td>${a.model}</td>
            <td><code style="font-family:monospace;font-size:12px;">${a.serial}</code></td>
            <td>${a.type}</td>
            <td>${a.ownerName}</td>
            <td>${mdmHtml}</td>
            <td><span class="status-badge ${statusClass}">${a.status}</span></td>
            <td>${certHtml}</td>
            ${chevron}
        </tr>`;
    }

    function bindWipeBtns() {
        document.querySelectorAll('.btn-wipe-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openWipeModal(btn.dataset.tag, btn.dataset.owner);
            });
        });
    }

    let miniChartInstances = {};
    function renderMiniChart(tag) {
        const canvas = document.getElementById(`mini-chart-${tag}`);
        if (!canvas) return;
        if (miniChartInstances[tag]) { miniChartInstances[tag].destroy(); }
        // Use a placeholder sparkline
        miniChartInstances[tag] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: Array.from({ length: 10 }, (_, i) => i),
                datasets: [{
                    data: Array.from({ length: 10 }, () => 50 + Math.floor(Math.random() * 30)),
                    borderColor: 'hsl(252, 85%, 64%)', borderWidth: 2,
                    fill: false, tension: 0.3, pointRadius: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, animation: false }
        });
    }

    // ==========================================
    // PAGE: EMPLOYEES
    // ==========================================
    function renderEmployees() {
        const isHR = currentUser?.role === 'hr-admin';
        pageContent.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="emp-search" placeholder="Search by name or department..."></div>
                    <div class="filter-chips" id="emp-dept-chips">
                        <div class="filter-chip active" data-dept="all">All <span class="chip-count">${employeesData.length}</span></div>
                        <div class="filter-chip" data-dept="Telehealth">Telehealth <span class="chip-count">${employeesData.filter(e=>e.department==='Telehealth').length}</span></div>
                        <div class="filter-chip" data-dept="Clinical Operations">Clinical Ops <span class="chip-count">${employeesData.filter(e=>e.department==='Clinical Operations').length}</span></div>
                        <div class="filter-chip" data-dept="Active">Active <span class="chip-count">${employeesData.filter(e=>e.status==='Active').length}</span></div>
                        <div class="filter-chip" data-dept="Terminated">Terminated <span class="chip-count">${employeesData.filter(e=>e.status==='Terminated').length}</span></div>
                    </div>
                </div>
                <button id="btn-new-hire" class="btn btn-success" ${!isHR ? 'disabled title="Requires HR Admin"' : ''}>
                    <i class="fa-solid fa-user-plus"></i> New Hire
                </button>
            </div>
            <div class="employee-grid" id="employee-grid"></div>`;

        let deptFilter = 'all';
        let empSearch = '';

        const renderCards = () => {
            const grid = document.getElementById('employee-grid');
            const q = empSearch.toLowerCase();
            const filtered = employeesData.filter(e => {
                const matchSearch = !q || e.name.toLowerCase().includes(q) || e.department.toLowerCase().includes(q) || e.role.toLowerCase().includes(q);
                const matchDept = deptFilter === 'all' || e.department === deptFilter || e.status === deptFilter;
                return matchSearch && matchDept;
            });
            if (filtered.length === 0) {
                grid.innerHTML = '<p style="color:var(--text-muted);padding:40px;">No employees match.</p>';
                return;
            }
            grid.innerHTML = filtered.map(e => {
                const initials = e.name.split(' ').filter(n => /^[A-Z]/i.test(n)).map(n => n[0]).join('').substring(0, 2).toUpperCase();
                const deptClass = e.status === 'Terminated' ? 'terminated' : e.department === 'Telehealth' ? 'telehealth' : 'clinical';
                const myAssets = assetsData.filter(a => a.ownerId === e.id);
                const assetTags = myAssets.map(a => `<span class="emp-asset-tag">${a.tag}</span>`).join('') || '<span style="color:var(--text-muted);font-size:11px;">No assets</span>';
                const isHRAdmin = currentUser?.role === 'hr-admin';
                const actionBtn = e.status === 'Active'
                    ? `<button class="btn btn-danger btn-xs btn-offboard-emp" data-id="${e.id}" data-name="${e.name}" ${!isHRAdmin ? 'disabled title="Requires HR Admin"' : ''}><i class="fa-solid fa-user-minus"></i> Offboard</button>`
                    : `<span class="status-badge terminated"><i class="fa-solid fa-ban"></i> Terminated</span>`;
                return `
                    <div class="employee-card ${e.status === 'Terminated' ? 'terminated' : ''}">
                        <div class="emp-card-header">
                            <div class="emp-avatar ${deptClass}">${initials}</div>
                            <div class="emp-info">
                                <div class="emp-name">${e.name}</div>
                                <div class="emp-role">${e.role}</div>
                            </div>
                            <span class="status-badge ${e.status === 'Active' ? 'active' : 'terminated'}">${e.status}</span>
                        </div>
                        <div>
                            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Assigned Assets</div>
                            <div class="emp-assets">${assetTags}</div>
                        </div>
                        <div class="emp-card-footer">
                            <span class="emp-dept-badge"><i class="fa-solid fa-building"></i> ${e.department}</span>
                            ${actionBtn}
                        </div>
                    </div>`;
            }).join('');

            document.querySelectorAll('.btn-offboard-emp').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const empId = btn.dataset.id;
                    const empName = btn.dataset.name;
                    if (!confirm(`Trigger offboarding workflow for ${empName}?`)) return;
                    await triggerTerminationWebhook(empId);
                });
            });
        };

        document.getElementById('emp-search')?.addEventListener('input', e => { empSearch = e.target.value; renderCards(); });
        document.querySelectorAll('#emp-dept-chips .filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                deptFilter = chip.dataset.dept;
                document.querySelectorAll('#emp-dept-chips .filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                renderCards();
            });
        });
        document.getElementById('btn-new-hire')?.addEventListener('click', () => {
            document.getElementById('new-employee-modal').classList.add('active');
        });

        renderCards();
    }

    function renderEmployeeCards() {
        if (currentPage === 'employees') renderEmployees();
    }

    // ==========================================
    // PAGE: WORKFLOWS
    // ==========================================
    function renderWorkflows() {
        if (currentPage !== 'workflows') return;
        const running = workflowsData.filter(w => w.status === 'Running');
        const completed = workflowsData.filter(w => w.status === 'Completed');
        const failed = workflowsData.filter(w => w.status === 'Failed');

        pageContent.innerHTML = `
            <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
                <div class="kpi-card kpi-blue" style="flex:1;min-width:150px;padding:16px 20px;">
                    <span class="kpi-label">Running</span>
                    <span class="kpi-value" style="font-size:28px;">${running.length}</span>
                </div>
                <div class="kpi-card kpi-success" style="flex:1;min-width:150px;padding:16px 20px;">
                    <span class="kpi-label">Completed</span>
                    <span class="kpi-value" style="font-size:28px;">${completed.length}</span>
                </div>
                <div class="kpi-card kpi-danger" style="flex:1;min-width:150px;padding:16px 20px;">
                    <span class="kpi-label">Failed</span>
                    <span class="kpi-value" style="font-size:28px;">${failed.length}</span>
                </div>
            </div>
            <section class="panel">
                <div class="panel-header">
                    <h2><i class="fa-solid fa-rotate header-icon"></i> Temporal Offboarding Workflows</h2>
                    <div class="filter-chips" id="wf-filter-chips">
                        <div class="filter-chip active" data-filter="all">All <span class="chip-count">${workflowsData.length}</span></div>
                        <div class="filter-chip" data-filter="Running">Running <span class="chip-count">${running.length}</span></div>
                        <div class="filter-chip" data-filter="Completed">Completed <span class="chip-count">${completed.length}</span></div>
                        <div class="filter-chip" data-filter="Failed">Failed <span class="chip-count">${failed.length}</span></div>
                    </div>
                </div>
                <div class="panel-body">
                    <div class="workflows-container" id="wf-main-grid">
                        ${workflowsData.length === 0 ? '<div class="no-workflows"><i class="fa-solid fa-inbox"></i><p>No workflows yet. Trigger an offboarding from the Integration Lab.</p></div>' : ''}
                    </div>
                </div>
            </section>`;

        let wfFilter = 'all';
        const renderWFCards = () => {
            const grid = document.getElementById('wf-main-grid');
            if (!grid) return;
            const filtered = wfFilter === 'all' ? workflowsData : workflowsData.filter(w => w.status === wfFilter);
            if (filtered.length === 0) {
                grid.innerHTML = '<div class="no-workflows"><i class="fa-solid fa-inbox"></i><p>No workflows in this category.</p></div>';
                return;
            }
            grid.innerHTML = filtered.map(wf => workflowCard(wf)).join('');
            bindWorkflowLogToggles();
        };
        document.querySelectorAll('#wf-filter-chips .filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                wfFilter = chip.dataset.filter;
                document.querySelectorAll('#wf-filter-chips .filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                renderWFCards();
            });
        });
        renderWFCards();
    }

    function workflowCard(wf) {
        const jClass = stepClass(wf.steps['JAMF_LOCK']);
        const fClass = stepClass(wf.steps['FEDEX_LABEL']);
        const sClass = stepClass(wf.steps['SHIPPING']);
        const wClass = stepClass(wf.steps['WIPE_VERIFICATION']);
        let statusBadge = `<span class="badge badge-blue">Running</span>`;
        if (wf.status === 'Completed') statusBadge = `<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i> Completed</span>`;
        if (wf.status === 'Failed') statusBadge = `<span class="badge badge-danger">Failed</span>`;
        const labelBtn = wf.fedexLabelUrl ? `<a href="${wf.fedexLabelUrl}" target="_blank" class="btn btn-outline-light btn-xs"><i class="fa-solid fa-file-pdf"></i> Return Label</a>` : '';
        return `
            <div class="wf-card animate-slide-up ${wf.status.toLowerCase()}">
                <div class="wf-meta">
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
                        <h3>${wf.workflowId}</h3>${statusBadge}
                    </div>
                    <span style="font-weight:600;font-size:13px;color:var(--text-primary);">Target: ${wf.employeeName}</span>
                    <span class="employee-tag">ID: ${wf.employeeId}</span>
                    <span style="margin-top:8px;font-size:11px;">Assets to recover:</span>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
                        ${wf.assets.map(a => `<code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;font-size:11px;">${a}</code>`).join('')}
                    </div>
                </div>
                <div class="wf-progress-container">
                    <div class="wf-tracker">
                        <div class="wf-steps">
                            <div class="wf-step-node ${jClass}"><i class="fa-solid fa-mobile-screen"></i> Jamf Lock</div>
                            <div class="wf-step-node ${fClass}"><i class="fa-solid fa-barcode"></i> Label API</div>
                            <div class="wf-step-node ${sClass}"><i class="fa-solid fa-truck"></i> Transit</div>
                            <div class="wf-step-node ${wClass}"><i class="fa-solid fa-soap"></i> HIPAA Wipe</div>
                        </div>
                        <div class="wf-actions">${labelBtn}</div>
                    </div>
                    <div class="wf-progress-track"><div class="wf-progress-bar" style="width:${wf.shippingProgress}%"></div></div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
                        <span>Current Step: <strong style="color:white;">${wf.step}</strong></span>
                        <span class="wf-log-toggle" data-wfid="${wf.workflowId}">Execution Logs (${wf.logs.length})</span>
                    </div>
                </div>
                <div class="wf-logs-expand" id="logs-${wf.workflowId}" style="display:none;">
                    ${wf.logs.map(l => `<div>${l}</div>`).reverse().join('')}
                </div>
            </div>`;
    }

    function stepClass(s) { return s === 'COMPLETED' ? 'completed' : s === 'PENDING' ? '' : 'active'; }
    function bindWorkflowLogToggles() {
        document.querySelectorAll('.wf-log-toggle').forEach(el => {
            el.addEventListener('click', () => {
                const logsEl = document.getElementById(`logs-${el.dataset.wfid}`);
                if (logsEl) logsEl.style.display = logsEl.style.display === 'none' ? 'flex' : 'none';
            });
        });
    }

    // ==========================================
    // PAGE: PROCUREMENT
    // ==========================================
    function renderProcurement() {
        pageContent.innerHTML = `
            <section class="panel">
                <div class="panel-header">
                    <h2><i class="fa-solid fa-file-invoice-dollar header-icon"></i> Procurement Orders Log</h2>
                    <span class="badge badge-green">Coupa ERP API</span>
                </div>
                <div class="procurement-summary" id="po-summary-bar"></div>
                <div style="padding:12px 20px;border-bottom:1px solid var(--border-card);">
                    <div class="filter-chips" id="po-filter-chips">
                        <div class="filter-chip active" data-filter="all">All</div>
                        <div class="filter-chip" data-filter="Approved">Approved</div>
                        <div class="filter-chip" data-filter="AI">AI-Triggered</div>
                    </div>
                </div>
                <div class="panel-body no-pad">
                    <div class="table-responsive">
                        <table class="data-table">
                            <thead><tr><th>PO ID</th><th>Vendor</th><th>Item</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th>Status</th><th>Notes</th><th>Date</th></tr></thead>
                            <tbody id="po-table-body"></tbody>
                        </table>
                    </div>
                </div>
            </section>`;

        let poFilter = 'all';
        const render = () => {
            const tbody = document.getElementById('po-table-body');
            const filtered = poFilter === 'all' ? procurementData
                : poFilter === 'AI' ? procurementData.filter(o => o.status.includes('AI'))
                : procurementData.filter(o => o.status.includes('Approved') && !o.status.includes('AI'));
            tbody.innerHTML = [...filtered].reverse().map(o => `
                <tr>
                    <td><strong>${o.poId}</strong></td>
                    <td>${o.vendor || '—'}</td>
                    <td>${o.item}</td>
                    <td>${o.quantity}</td>
                    <td>$${o.unitCost.toLocaleString()}</td>
                    <td><strong>$${(o.unitCost * o.quantity).toLocaleString()}</strong></td>
                    <td><span class="status-badge ${o.status.includes('AI') ? 'ready' : 'deployed'}">${o.status}</span></td>
                    <td><small style="color:var(--text-muted)">${o.notes || 'Normal reorder'}</small></td>
                    <td>${o.date}</td>
                </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px;">No orders.</td></tr>`;
            // Summary bar
            const totalVal = procurementData.reduce((s, o) => s + o.unitCost * o.quantity, 0);
            const aiCount = procurementData.filter(o => o.status.includes('AI')).length;
            const summaryBar = document.getElementById('po-summary-bar');
            if (summaryBar) summaryBar.innerHTML = `
                <div class="po-summary-item">Total PO Value: <strong>$${totalVal.toLocaleString()}</strong></div>
                <div class="po-summary-item">Total Orders: <strong>${procurementData.length}</strong></div>
                <div class="po-summary-item">AI-Triggered: <strong style="color:var(--accent-primary)">${aiCount}</strong></div>
                <div class="po-summary-item">Manual: <strong>${procurementData.length - aiCount}</strong></div>`;
        };
        document.querySelectorAll('#po-filter-chips .filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                poFilter = chip.dataset.filter;
                document.querySelectorAll('#po-filter-chips .filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                render();
            });
        });
        render();
    }

    function renderProcurementTable() {
        if (currentPage === 'procurement') renderProcurement();
    }

    // ==========================================
    // PAGE: COMPLIANCE
    // ==========================================
    async function renderCompliance() {
        pageContent.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="font-size:28px;"></i><p style="margin-top:14px;">Loading compliance data...</p></div>`;
        try {
            const [summaryRes, certsRes, policiesRes] = await Promise.all([
                fetch('/api/compliance/summary'),
                fetch('/api/compliance/certificates'),
                fetch('/api/compliance/policies')
            ]);
            const summary = await summaryRes.json();
            const certs = await certsRes.json();
            const policies = await policiesRes.json();

            const scoreColor = summary.overallScore >= 80 ? 'var(--success)' : summary.overallScore >= 50 ? 'var(--warning)' : 'var(--danger)';
            const scoreLabel = summary.overallScore >= 80 ? 'Compliant' : summary.overallScore >= 50 ? 'At Risk' : 'Non-Compliant';

            pageContent.innerHTML = `
                <div class="compliance-grid">
                    <div class="score-card panel">
                        <span class="score-label">Overall Compliance Score</span>
                        <div style="position:relative;width:160px;height:160px;margin:0 auto;">
                            <canvas id="compliance-gauge"></canvas>
                            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                                <span style="font-family:var(--font-heading);font-size:36px;font-weight:800;color:${scoreColor};">${summary.overallScore}%</span>
                                <span style="font-size:11px;color:${scoreColor};font-weight:600;">${scoreLabel}</span>
                            </div>
                        </div>
                        <div class="score-sub-grid">
                            <div class="score-sub">
                                <div class="score-sub-val">${summary.policyScore}%</div>
                                <div class="score-sub-label">Policy Sigs</div>
                            </div>
                            <div class="score-sub">
                                <div class="score-sub-val">${summary.wipeScore}%</div>
                                <div class="score-sub-label">Wipe Certs</div>
                            </div>
                        </div>
                        <button class="btn btn-outline-teal btn-sm" id="btn-gen-report" style="width:100%;">
                            <i class="fa-solid fa-file-arrow-down"></i> Generate Report
                        </button>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:16px;">
                        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                            <div class="kpi-card kpi-teal" style="padding:16px;">
                                <span class="kpi-label">Wipe Certificates</span>
                                <span class="kpi-value" style="font-size:28px;">${summary.certCount}</span>
                                <span class="kpi-sub">Verified uploads</span>
                            </div>
                            <div class="kpi-card kpi-blue" style="padding:16px;">
                                <span class="kpi-label">Policy Signatures</span>
                                <span class="kpi-value" style="font-size:28px;">${summary.policyCount}</span>
                                <span class="kpi-sub">HIPAA-AUP signed</span>
                            </div>
                            <div class="kpi-card ${summary.needsSanitizationCount > 0 ? 'kpi-danger' : 'kpi-success'}" style="padding:16px;">
                                <span class="kpi-label">Needs Sanitization</span>
                                <span class="kpi-value ${summary.needsSanitizationCount > 0 ? 'danger' : ''}" style="font-size:28px;">${summary.needsSanitizationCount}</span>
                                <span class="kpi-sub">Pending wipe certs</span>
                            </div>
                        </div>
                        <section class="panel" style="flex:1;">
                            <div class="panel-header"><h2><i class="fa-solid fa-file-signature header-icon"></i> HIPAA Policy Signatures</h2></div>
                            <div class="panel-body no-pad">
                                <div class="table-responsive">
                                    <table class="data-table small-table">
                                        <thead><tr><th>Employee</th><th>Role</th><th>Department</th><th>Policy Version</th><th>Signed Date</th><th>Status</th></tr></thead>
                                        <tbody>${policies.map(p => `
                                            <tr>
                                                <td><strong>${p.employeeName}</strong></td>
                                                <td>${p.role}</td>
                                                <td>${p.department}</td>
                                                <td><code style="font-size:11px;">${p.version}</code></td>
                                                <td>${new Date(p.signedAt).toLocaleDateString()}</td>
                                                <td><span class="status-badge active">Signed</span></td>
                                            </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No policy records</td></tr>'}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
                <section class="panel" style="margin-top:20px;">
                    <div class="panel-header"><h2><i class="fa-solid fa-file-shield header-icon"></i> Wipe Certificate Registry</h2><span class="badge badge-teal">${certs.length} Verified</span></div>
                    <div class="panel-body no-pad">
                        <div class="table-responsive">
                            <table class="data-table small-table">
                                <thead><tr><th>Asset Tag</th><th>Model</th><th>Last Employee</th><th>Certificate File</th><th>File Size</th><th>Uploaded At</th><th>Verified</th></tr></thead>
                                <tbody>${certs.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px;"><i class="fa-solid fa-folder-open" style="font-size:24px;display:block;margin-bottom:10px;"></i>No wipe certificates uploaded yet.<br><small>Trigger an offboarding workflow and upload certificates from Asset Registry.</small></td></tr>' :
                                    certs.map(c => `<tr>
                                        <td><strong>${c.assetTag}</strong></td>
                                        <td>${c.assetModel}</td>
                                        <td>${c.employeeName}</td>
                                        <td><i class="fa-solid fa-file-pdf" style="color:var(--danger);margin-right:6px;"></i>${c.fileName}</td>
                                        <td>${c.fileSize}</td>
                                        <td>${new Date(c.uploadedAt).toLocaleString()}</td>
                                        <td><span class="text-success"><i class="fa-solid fa-circle-check"></i> Verified</span></td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>`;

            // Render compliance donut gauge
            const gCtx = document.getElementById('compliance-gauge')?.getContext('2d');
            if (gCtx) {
                new Chart(gCtx, {
                    type: 'doughnut',
                    data: {
                        datasets: [{
                            data: [summary.overallScore, 100 - summary.overallScore],
                            backgroundColor: [scoreColor, 'rgba(255,255,255,0.05)'],
                            borderWidth: 0
                        }]
                    },
                    options: { cutout: '78%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { animateRotate: true, duration: 1000 } }
                });
            }

            document.getElementById('btn-gen-report')?.addEventListener('click', () => {
                const reportContent = `AEGIS HEALTH PARTNERS — HIPAA COMPLIANCE REPORT\n${'='.repeat(52)}\nGenerated: ${new Date().toLocaleString()}\n\nOVERALL COMPLIANCE SCORE: ${summary.overallScore}% (${scoreLabel})\n\nPOLICY COMPLIANCE SCORE: ${summary.policyScore}%\nWIPE CERTIFICATE SCORE: ${summary.wipeScore}%\n\nWIPE CERTIFICATES VERIFIED: ${summary.certCount}\nHIPAA POLICY SIGNATURES: ${summary.policyCount}\nACTIVE EMPLOYEES: ${summary.activeEmployees}\nNEEDS SANITIZATION: ${summary.needsSanitizationCount}\n\nCERTIFICATE RECORDS:\n${certs.map(c => `  - ${c.assetTag} | ${c.assetModel} | ${c.fileName} | Verified: ${new Date(c.uploadedAt).toLocaleDateString()}`).join('\n') || '  None'}\n\nPOLICY SIGNATURES:\n${policies.map(p => `  - ${p.employeeName} | ${p.version} | ${new Date(p.signedAt).toLocaleDateString()}`).join('\n') || '  None'}\n\n[END OF REPORT]`;
                const blob = new Blob([reportContent], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `aegis-compliance-report-${new Date().toISOString().split('T')[0]}.txt`;
                a.click(); URL.revokeObjectURL(url);
                showToast('success', 'Report Generated', 'Compliance report downloaded successfully.');
            });
        } catch (e) {
            pageContent.innerHTML = `<div style="text-align:center;padding:60px;color:var(--danger);"><i class="fa-solid fa-circle-exclamation" style="font-size:28px;"></i><p>Failed to load compliance data: ${e.message}</p></div>`;
        }
    }

    // ==========================================
    // PAGE: INTEGRATION LAB
    // ==========================================
    function renderIntegrationLab() {
        pageContent.innerHTML = `
            <div class="lab-banner">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <div><strong>Demo / Lab Environment</strong> — All actions below are simulations. Events triggered here propagate through the full Kafka → Temporal → MDM pipeline.</div>
            </div>
            <div class="lab-grid">
                <div>
                    <section class="panel" style="margin-bottom:20px;">
                        <div class="panel-header">
                            <h2><i class="fa-solid fa-user-minus header-icon"></i> BambooHR Termination Webhook</h2>
                            <span class="badge badge-purple">HMAC-SHA256</span>
                        </div>
                        <div class="panel-body">
                            <div class="control-group">
                                <h3><i class="fa-solid fa-user-minus"></i> Trigger Employee Termination</h3>
                                <p class="panel-desc" style="margin-bottom:12px;">Select an active employee and choose the signature method for the outbound webhook.</p>
                                <div class="form-row" style="margin-bottom:10px;">
                                    <select id="terminate-employee-select" class="form-select">
                                        <option value="">Select Employee to Terminate...</option>
                                        ${employeesData.filter(e=>e.status==='Active').map(e=>`<option value="${e.id}">${e.name} (${e.id}) — ${e.role}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="form-row">
                                    <select id="webhook-sig-select" class="form-select" style="border-color:var(--accent-purple);">
                                        <option value="authentic">Signed (Authentic HMAC SHA-256)</option>
                                        <option value="unsigned">Unsigned (No Security Header)</option>
                                        <option value="spoofed">Spoofed (Invalid Signature)</option>
                                    </select>
                                    <button id="btn-trigger-webhook" class="btn btn-danger" ${currentUser?.role !== 'hr-admin' ? 'disabled title="Requires HR Admin"' : ''}>
                                        <i class="fa-solid fa-paper-plane"></i> Fire Webhook
                                    </button>
                                </div>
                            </div>
                            <div class="control-group">
                                <h3><i class="fa-solid fa-user-plus"></i> Simulate New Hire Onboarding</h3>
                                <form id="onboard-form-lab" class="form-grid">
                                    <input type="text" id="lab-onboard-name" placeholder="Full Name (e.g. Dr. Juan Cruz)" required class="form-input" ${currentUser?.role !== 'hr-admin' ? 'disabled' : ''}>
                                    <input type="text" id="lab-onboard-role" placeholder="Role (e.g. Clinical Specialist)" required class="form-input" ${currentUser?.role !== 'hr-admin' ? 'disabled' : ''}>
                                    <select id="lab-onboard-dept" class="form-select" ${currentUser?.role !== 'hr-admin' ? 'disabled' : ''}>
                                        <option value="Telehealth">Telehealth</option>
                                        <option value="Clinical Operations">Clinical Operations</option>
                                    </select>
                                    <button type="submit" class="btn btn-success" ${currentUser?.role !== 'hr-admin' ? 'disabled title="Requires HR Admin"' : ''}>
                                        <i class="fa-solid fa-user-check"></i> Trigger Hire Webhook
                                    </button>
                                </form>
                            </div>
                            <div class="control-group">
                                <h3><i class="fa-solid fa-bolt"></i> Inject Telemetry Anomaly (AI Failure Trigger)</h3>
                                <p class="panel-desc" style="margin-bottom:12px;">Spikes a device metric past the AI threshold to trigger automated procurement.</p>
                                <div class="form-row flex-wrap">
                                    <button id="btn-inject-temp" class="btn btn-warning flex-grow">
                                        <i class="fa-solid fa-temperature-arrow-up"></i> Overheat KIT-302 (&gt;85°C)
                                    </button>
                                    <button id="btn-inject-battery" class="btn btn-warning flex-grow">
                                        <i class="fa-solid fa-battery-quarter"></i> Degrade LPT-882 (&lt;60%)
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
                <div>
                    <section class="panel" style="margin-bottom:20px;">
                        <div class="panel-header">
                            <h2><i class="fa-solid fa-circle-nodes header-icon"></i> GraphQL Federation Explorer</h2>
                            <span class="badge badge-purple">Apollo Server Mock</span>
                        </div>
                        <div class="panel-body">
                            <p class="panel-desc">Query unified records using GraphQL federation to fetch employee details, assigned assets, and hardware diagnostics.</p>
                            <div class="graphql-layout">
                                <div class="graphql-query-panel">
                                    <div class="form-row">
                                        <select id="graphql-employee-select" class="form-select">
                                            ${employeesData.map(e=>`<option value="${e.id}">${e.name} (${e.id}) [${e.status}]</option>`).join('')}
                                        </select>
                                        <button id="btn-run-graphql" class="btn btn-success" ${currentUser?.role === 'guest' ? 'disabled' : ''}>
                                            <i class="fa-solid fa-play"></i> Execute
                                        </button>
                                    </div>
                                    <div class="graphql-query-code"><pre>query GetEmployeeDiagnostics($id: ID!) {
  employee(id: $id) {
    name, role, department
    assignedAssets {
      tag, model, mdmStatus
      telemetry { cpuTemp }
    }
  }
}</pre></div>
                                </div>
                                <div class="graphql-response-panel">
                                    <span style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;font-family:monospace;">RESPONSE PAYLOAD (JSON):</span>
                                    <div class="graphql-response-box" id="graphql-response">{ "click": "Execute to see Apollo federated result" }</div>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section class="panel">
                        <div class="panel-header">
                            <h2><i class="fa-solid fa-terminal header-icon"></i> Kafka Event Stream</h2>
                            <button id="btn-clear-console-lab" class="btn btn-outline-light btn-xs"><i class="fa-solid fa-trash-can"></i> Clear</button>
                        </div>
                        <div class="console-body" id="console-stream">
                            <div class="console-line system"><span class="timestamp">[SYSTEM]</span><span> Aegis ITAM event pipeline active.</span></div>
                        </div>
                    </section>
                </div>
            </div>`;

        // Wire up all lab buttons
        document.getElementById('btn-trigger-webhook')?.addEventListener('click', async () => {
            const empId = document.getElementById('terminate-employee-select').value;
            if (!empId) { showToast('warning', 'No Employee Selected', 'Please select an employee to offboard.'); return; }
            await triggerTerminationWebhook(empId, document.getElementById('webhook-sig-select').value);
        });
        document.getElementById('onboard-form-lab')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('lab-onboard-name').value;
            const role = document.getElementById('lab-onboard-role').value;
            const dept = document.getElementById('lab-onboard-dept').value;
            await triggerOnboardWebhook(name, role, dept);
            e.target.reset();
        });
        document.getElementById('btn-inject-temp')?.addEventListener('click', async () => {
            appendConsole('telemetry', '[Jamf] Spiking KIT-302 temperature to 93°C...');
            await fetch('/api/telemetry/inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: 'KIT-302', type: 'temp' }) });
        });
        document.getElementById('btn-inject-battery')?.addEventListener('click', async () => {
            appendConsole('telemetry', '[Jamf] Degrading LPT-882 battery to 48%...');
            await fetch('/api/telemetry/inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: 'LPT-882', type: 'battery' }) });
        });
        document.getElementById('btn-run-graphql')?.addEventListener('click', async () => {
            const empId = document.getElementById('graphql-employee-select').value;
            if (!empId) return;
            const respBox = document.getElementById('graphql-response');
            respBox.innerHTML = '<span style="color:var(--text-secondary)">Querying...</span>';
            try {
                const res = await fetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query GetEmployeeDiagnostics($id: ID!) { employee(id: $id) { id name role department assignedAssets { tag model mdmStatus telemetry { time cpuTemp batteryHealth } } } }', variables: { id: empId } }) });
                respBox.textContent = JSON.stringify(await res.json(), null, 2);
            } catch (err) { respBox.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`; }
        });
        document.getElementById('btn-clear-console-lab')?.addEventListener('click', () => {
            const el = document.getElementById('console-stream');
            if (el) { el.innerHTML = ''; appendConsole('system', 'Console cleared.'); }
        });
    }

    // ==========================================
    // PAGE: SETTINGS
    // ==========================================
    async function renderSettings() {
        pageContent.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="font-size:28px;"></i></div>`;
        try {
            const res = await fetch('/api/settings');
            const cfg = await res.json();

            pageContent.innerHTML = `
                <div style="max-width:900px;">
                    <div class="settings-section">
                        <div class="settings-section-title"><i class="fa-solid fa-server" style="margin-right:8px;"></i>System Configuration</div>
                        <div class="settings-grid">
                            ${Object.entries(cfg.systemConfig).map(([key, val]) => `
                                <div class="settings-item">
                                    <i class="fa-solid ${key === 'postgres' ? 'fa-database' : key === 'mongodb' ? 'fa-folder-open' : key === 'influxdb' ? 'fa-chart-line' : key === 'kafka' ? 'fa-bolt' : 'fa-rotate'} settings-item-icon"></i>
                                    <div class="settings-item-info">
                                        <div class="settings-item-label">${key.charAt(0).toUpperCase() + key.slice(1)}</div>
                                        <div class="settings-item-value">${val.host || val.broker || val.endpoint}${val.port ? ':' + val.port : ''}</div>
                                    </div>
                                    <span class="settings-item-status ${val.status === 'Connected' ? 'connected' : 'active'}">${val.status}</span>
                                </div>`).join('')}
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title"><i class="fa-solid fa-mobile-screen" style="margin-right:8px;"></i>MDM Integration Toggles</div>
                        ${Object.entries(cfg.mdmIntegrations).map(([key, val]) => `
                            <div class="toggle-row">
                                <div class="toggle-info">
                                    <i class="fa-solid ${key === 'jamf' ? 'fa-apple' : 'fa-microsoft'}"></i>
                                    <div>
                                        <div class="toggle-label">${key === 'jamf' ? 'Jamf Pro' : 'Microsoft Intune'}</div>
                                        <div class="toggle-sub">${val.endpoint} — ${val.version}</div>
                                    </div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" class="mdm-toggle" data-mdm="${key}" ${val.enabled ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>`).join('')}
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title"><i class="fa-solid fa-key" style="margin-right:8px;"></i>Webhook Secrets</div>
                        <div class="settings-item" style="margin-bottom:12px;">
                            <i class="fa-solid fa-webhook settings-item-icon"></i>
                            <div class="settings-item-info">
                                <div class="settings-item-label">BambooHR HMAC Secret</div>
                                <div class="settings-item-value" id="secret-val">${cfg.webhookSecrets.bamboohr.masked}</div>
                            </div>
                            <button class="btn btn-outline-light btn-xs" id="btn-toggle-secret">
                                <i class="fa-solid fa-eye"></i> Show
                            </button>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title"><i class="fa-solid fa-users" style="margin-right:8px;"></i>User Management</div>
                        <div class="table-responsive" style="background:rgba(0,0,0,0.15);border:1px solid var(--border-card);border-radius:12px;overflow:hidden;">
                            <table class="data-table small-table">
                                <thead><tr><th>User ID</th><th>Name</th><th>Username</th><th>Email</th><th>Role</th></tr></thead>
                                <tbody>
                                    ${cfg.users.map(u => `
                                        <tr>
                                            <td><code style="font-size:11px;">${u.id}</code></td>
                                            <td><strong>${u.name}</strong> ${u.id === currentUser?.id ? '<span class="badge badge-teal" style="font-size:9px;">You</span>' : ''}</td>
                                            <td><code style="font-size:12px;">${u.username}</code></td>
                                            <td style="color:var(--text-muted);font-size:12px;">${u.email}</td>
                                            <td><span class="badge ${u.role === 'hr-admin' ? 'badge-teal' : u.role === 'it-helpdesk' ? 'badge-blue' : u.role === 'compliance-auditor' ? 'badge-purple' : 'badge-warning'}">${u.roleLabel}</span></td>
                                        </tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>`;

            document.getElementById('btn-toggle-secret')?.addEventListener('click', (e) => {
                secretVisible = !secretVisible;
                document.getElementById('secret-val').textContent = secretVisible ? cfg.webhookSecrets.bamboohr.key : cfg.webhookSecrets.bamboohr.masked;
                e.currentTarget.innerHTML = `<i class="fa-solid ${secretVisible ? 'fa-eye-slash' : 'fa-eye'}"></i> ${secretVisible ? 'Hide' : 'Show'}`;
            });
            document.querySelectorAll('.mdm-toggle').forEach(toggle => {
                toggle.addEventListener('change', (e) => {
                    const mdm = e.target.dataset.mdm;
                    const enabled = e.target.checked;
                    mdmToggles[mdm] = enabled;
                    showToast(enabled ? 'success' : 'info', `${mdm.toUpperCase()} ${enabled ? 'Enabled' : 'Disabled'}`, `${mdm === 'jamf' ? 'Jamf Pro' : 'Microsoft Intune'} integration has been ${enabled ? 'activated' : 'deactivated'}.`);
                });
            });
        } catch (e) {
            pageContent.innerHTML = `<p style="color:var(--danger)">Failed to load settings: ${e.message}</p>`;
        }
    }

    // ==========================================
    // TELEMETRY CHART
    // ==========================================
    function initTelemetryChart() {
        const canvas = document.getElementById('telemetryChart');
        if (!canvas || typeof Chart === 'undefined') return;
        if (telemetryChart) { telemetryChart.destroy(); telemetryChart = null; }
        const ctx = canvas.getContext('2d');
        const tempGrad = ctx.createLinearGradient(0, 0, 0, 200);
        tempGrad.addColorStop(0, 'rgba(235,94,85,0.4)');
        tempGrad.addColorStop(1, 'rgba(235,94,85,0)');
        const battGrad = ctx.createLinearGradient(0, 0, 0, 200);
        battGrad.addColorStop(0, 'rgba(124,88,237,0.4)');
        battGrad.addColorStop(1, 'rgba(124,88,237,0)');
        telemetryChart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [
                { label: 'CPU Temp (°C)', data: [], borderColor: 'hsl(352,85%,55%)', backgroundColor: tempGrad, fill: true, tension: 0.3, borderWidth: 2, pointRadius: 1, yAxisID: 'y' },
                { label: 'Battery Health (%)', data: [], borderColor: 'hsl(252,85%,64%)', backgroundColor: battGrad, fill: true, tension: 0.3, borderWidth: 2, pointRadius: 1, yAxisID: 'y1' }
            ]},
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: 'hsl(220,15%,72%)', font: { family: 'Inter' } } } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'hsl(220,10%,45%)', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
                    y: { position: 'left', min: 30, max: 100, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'hsl(220,15%,72%)' } },
                    y1: { position: 'right', min: 20, max: 100, grid: { drawOnChartArea: false }, ticks: { color: 'hsl(220,15%,72%)' } }
                }
            }
        });
    }

    function updateTelemetryChart(logs) {
        if (!telemetryChart) return;
        const maxPoints = 25;
        logs.forEach(m => {
            const ts = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (!telemetryChart.data.labels.includes(ts)) {
                telemetryChart.data.labels.push(ts);
                telemetryChart.data.datasets[0].data.push(m.cpuTemp);
                telemetryChart.data.datasets[1].data.push(m.batteryHealth);
            }
        });
        while (telemetryChart.data.labels.length > maxPoints) {
            telemetryChart.data.labels.shift();
            telemetryChart.data.datasets[0].data.shift();
            telemetryChart.data.datasets[1].data.shift();
        }
        telemetryChart.update('quiet');
    }

    // ==========================================
    // WEBHOOK HELPERS
    // ==========================================
    async function triggerTerminationWebhook(empId, sigMode = 'authentic') {
        const bodyObj = { type: 'EmployeeTerminatedEvent', employee_id: empId, terminationDate: new Date().toISOString().split('T')[0] };
        const bodyStr = JSON.stringify(bodyObj);
        let headers = { 'Content-Type': 'application/json' };
        if (sigMode === 'authentic') {
            headers['x-bamboohr-signature'] = await generateHMAC('aegis-webhook-secret-key', bodyStr);
            appendConsole('webhook', `[BambooHR] Dispatching signed termination webhook for ${empId}...`);
        } else if (sigMode === 'spoofed') {
            headers['x-bamboohr-signature'] = 'unsigned-spoof';
            appendConsole('webhook', `[BambooHR] Dispatching spoofed webhook (will be blocked)...`);
        } else {
            appendConsole('webhook', `[BambooHR] Dispatching unsigned webhook (will be blocked)...`);
        }
        try {
            const res = await fetch('/api/webhooks/bamboohr', { method: 'POST', headers, body: bodyStr });
            const data = await res.json();
            if (res.ok) {
                showToast('warning', 'Offboarding Triggered', `Workflow started for employee ${empId}`);
            } else {
                showToast('danger', 'Webhook Blocked', data.error || 'Security check failed');
            }
            refreshAllData();
        } catch (e) { showToast('danger', 'Error', e.message); }
    }

    async function triggerOnboardWebhook(name, role, dept) {
        const employeeId = 'EMP-' + Math.floor(200 + Math.random() * 800);
        const bodyObj = { type: 'EmployeeHiredEvent', employee_id: employeeId, name, role, department: dept };
        const bodyStr = JSON.stringify(bodyObj);
        const sig = await generateHMAC('aegis-webhook-secret-key', bodyStr);
        appendConsole('webhook', `[BambooHR] Dispatching hire webhook for ${name} (${employeeId})...`);
        try {
            const res = await fetch('/api/webhooks/bamboohr', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bamboohr-signature': sig }, body: bodyStr });
            const data = await res.json();
            if (res.ok) showToast('success', 'Employee Onboarded', `${name} added and assets provisioned.`);
            else showToast('danger', 'Onboarding Failed', data.error || 'Schema validation error');
            refreshAllData();
        } catch (e) { showToast('danger', 'Error', e.message); }
    }

    // ==========================================
    // WIPE CERTIFICATE MODAL
    // ==========================================
    function openWipeModal(tag, ownerId) {
        currentUploadAssetTag = tag;
        currentUploadWfEmpId = ownerId;
        document.getElementById('modal-asset-info').innerHTML = `<i class="fa-solid fa-tag"></i> Asset Tag: <strong>${tag}</strong> &nbsp;|&nbsp; <i class="fa-solid fa-id-card"></i> Owner: <strong>${ownerId || 'Unassigned'}</strong>`;
        document.getElementById('file-details').style.display = 'none';
        document.getElementById('drag-area').style.display = 'flex';
        document.getElementById('btn-submit-wipe').disabled = true;
        document.getElementById('wipe-modal').classList.add('active');
    }
    function closeWipeModal() {
        document.getElementById('wipe-modal').classList.remove('active');
        currentUploadAssetTag = null;
    }

    document.getElementById('btn-close-modal')?.addEventListener('click', closeWipeModal);
    document.getElementById('btn-cancel-upload')?.addEventListener('click', closeWipeModal);
    document.getElementById('drag-area')?.addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('drag-area')?.addEventListener('dragover', e => { e.preventDefault(); document.getElementById('drag-area').style.borderColor = 'var(--accent-primary)'; });
    document.getElementById('drag-area')?.addEventListener('dragleave', () => { document.getElementById('drag-area').style.borderColor = 'rgba(255,255,255,0.15)'; });
    document.getElementById('drag-area')?.addEventListener('drop', e => {
        e.preventDefault();
        document.getElementById('drag-area').style.borderColor = 'rgba(255,255,255,0.15)';
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
    document.getElementById('file-input')?.addEventListener('change', e => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
    document.getElementById('btn-remove-file')?.addEventListener('click', () => {
        document.getElementById('file-input').value = '';
        document.getElementById('file-details').style.display = 'none';
        document.getElementById('drag-area').style.display = 'flex';
        document.getElementById('btn-submit-wipe').disabled = true;
    });
    function handleFileSelect(file) {
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-size').textContent = (file.size / 1024).toFixed(1) + ' KB';
        document.getElementById('drag-area').style.display = 'none';
        document.getElementById('file-details').style.display = 'flex';
        document.getElementById('btn-submit-wipe').disabled = false;
    }
    document.getElementById('btn-submit-wipe')?.addEventListener('click', async () => {
        if (!currentUploadAssetTag) return;
        const btn = document.getElementById('btn-submit-wipe');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';
        try {
            const res = await fetch(`/api/assets/${currentUploadAssetTag}/wipe-certificate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeId: currentUploadWfEmpId, fileName: document.getElementById('file-name').textContent, fileSize: document.getElementById('file-size').textContent })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('success', 'Certificate Registered', `Wipe cert for ${currentUploadAssetTag} verified in MongoDB.`);
                closeWipeModal();
                refreshAllData();
            } else {
                showToast('danger', 'Upload Failed', data.error);
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Submit Sanitization Verification';
            }
        } catch (e) {
            showToast('danger', 'Upload Error', e.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Submit Sanitization Verification';
        }
    });

    // ==========================================
    // NEW EMPLOYEE MODAL (from Employees page)
    // ==========================================
    document.getElementById('btn-close-emp-modal')?.addEventListener('click', () => document.getElementById('new-employee-modal').classList.remove('active'));
    document.getElementById('btn-cancel-emp-modal')?.addEventListener('click', () => document.getElementById('new-employee-modal').classList.remove('active'));
    document.getElementById('btn-submit-onboard')?.addEventListener('click', async () => {
        const name = document.getElementById('modal-onboard-name').value.trim();
        const role = document.getElementById('modal-onboard-role').value.trim();
        const dept = document.getElementById('modal-onboard-dept').value;
        if (!name || !role) { showToast('warning', 'Missing Fields', 'Please fill in all required fields.'); return; }
        document.getElementById('new-employee-modal').classList.remove('active');
        document.getElementById('onboard-form-modal').reset();
        await triggerOnboardWebhook(name, role, dept);
    });

    // Make navigateTo global for inline onclick
    window.navigateTo = navigateTo;

    // ==========================================
    // INIT - Show login screen
    // ==========================================
    loginScreen.style.display = 'flex';
    appShell.style.display = 'none';
});
