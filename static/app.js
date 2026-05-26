/* ═══════════════════════════════════════════════════════
   PRO MERIDIAN — Frontend SPA
   ═══════════════════════════════════════════════════════ */

const PIPELINE_STAGES = ['NEW', 'CONTACTED', 'RESPONDED', 'PROPOSAL', 'WON', 'LOST'];

const STAGE_LABEL = {
  NEW: 'New', CONTACTED: 'Contacted', RESPONDED: 'Responded',
  PROPOSAL: 'Proposal', WON: 'Won', LOST: 'Lost',
};

const state = {
  tab: 'home',
  leads: [],
  stats: {},
  filters: { tier: 'all', status: 'all', search: '' },
  expandedId: null,
  scraper: { running: false, status: 'idle', message: 'Ready', leads_found: 0, hot_count: 0 },
  pollTimer: null,
  coach: {
    reviews: [],
    reviewing: false,
    reviewMsg: '',
    expandedReviewId: null,
    weekly: null,
    weeklyLoading: false,
    activeSubtab: 'analyze', // 'analyze' | 'history' | 'weekly'
    batchCalls: [{ name: '', transcript: '' }],
  },
};

// ── Boot ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  loadAll();
  startScraperPoll();
});

async function loadAll() {
  await Promise.all([loadLeads(), loadStats()]);
}

// ── Navigation ──────────────────────────────────────────

function setupNav() {
  // Covers both desktop .nav-btn and mobile .mnav-btn
  document.querySelectorAll('.nav-btn, .mnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      // Sync active state on both nav bars simultaneously
      document.querySelectorAll('.nav-btn, .mnav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      state.tab = tab;
      state.expandedId = null;
      render();
    });
  });
}

// ── Data fetching ───────────────────────────────────────

async function loadLeads() {
  const { tier, status, search } = state.filters;
  const params = new URLSearchParams({ tier, status, search });
  const res = await fetch(`/api/leads?${params}`);
  const data = await res.json();
  state.leads = data.leads || [];
  renderLeadsCount();
}

async function loadStats() {
  const res = await fetch('/api/stats');
  state.stats = await res.json();
  renderHeaderStats();
}

async function updateStatus(leadId, newStatus) {
  await fetch(`/api/leads/${leadId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });
  const lead = state.leads.find(l => l.id === leadId);
  if (lead) lead.pipeline_status = newStatus;
  await loadStats();
  render();
}

// ── Header stats ────────────────────────────────────────

function renderHeaderStats() {
  const s = state.stats;
  const el = id => document.getElementById(id);
  if (el('hdr-total')) el('hdr-total').textContent = `${s.total ?? '--'} leads`;
  if (el('hdr-hot'))   el('hdr-hot').textContent   = `${s.tiers?.HOT ?? '--'} HOT`;
  if (el('hdr-warm'))  el('hdr-warm').textContent  = `${s.tiers?.WARM ?? '--'} WARM`;
}

function renderLeadsCount() {}

// ── Master render ───────────────────────────────────────

function render() {
  const view = document.getElementById('view');
  switch (state.tab) {
    case 'home':     view.innerHTML = renderHomeView(); initSphere(); break;
    case 'leads':    view.innerHTML = renderLeadsView(); break;
    case 'pipeline': view.innerHTML = renderPipelineView(); break;
    case 'scraper':  view.innerHTML = renderScraperView(); break;
    case 'reports':  view.innerHTML = renderReportsView(); break;
    case 'coach':    view.innerHTML = renderCoachView(); break;
  }
  // Scan line when scraper is running
  view.classList.toggle('scanning', state.scraper.running);
  attachHandlers();
}

function attachHandlers() {
  // Search input debounce
  const searchEl = document.getElementById('search-input');
  if (searchEl) {
    searchEl.value = state.filters.search;
    let debounce;
    searchEl.addEventListener('input', e => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        state.filters.search = e.target.value;
        await loadLeads();
        render();
      }, 280);
    });
  }

  // Filter selects
  const tierSel = document.getElementById('filter-tier');
  if (tierSel) {
    tierSel.value = state.filters.tier;
    tierSel.addEventListener('change', async e => {
      state.filters.tier = e.target.value;
      await loadLeads();
      render();
    });
  }

  const statusSel = document.getElementById('filter-status');
  if (statusSel) {
    statusSel.value = state.filters.status;
    statusSel.addEventListener('change', async e => {
      state.filters.status = e.target.value;
      await loadLeads();
      render();
    });
  }

  // Lead row expand
  document.querySelectorAll('.lead-row[data-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.status-pill') || e.target.closest('.status-opt') ||
          e.target.closest('.status-menu') || e.target.closest('a') ||
          e.target.closest('.pipeline-opt') || e.target.closest('.kt-btn')) return;
      const lid = row.dataset.id;
      state.expandedId = state.expandedId === lid ? null : lid;
      render();
    });
  });

  // Status options in expanded row
  document.querySelectorAll('.status-opt[data-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      updateStatus(btn.dataset.id, btn.dataset.status);
    });
  });

  // Kanban tile move buttons
  document.querySelectorAll('.kt-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { id, action, status } = btn.dataset;
      if (action === 'detail') { openDrawer(id); return; }
      if (action === 'move') { updateStatus(id, status); }
    });
  });

  // Drawer pipeline options
  document.querySelectorAll('.pipeline-opt[data-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      updateStatus(btn.dataset.id, btn.dataset.status);
      document.querySelectorAll(`.pipeline-opt[data-id="${btn.dataset.id}"]`).forEach(b => {
        b.className = 'pipeline-opt';
      });
      btn.classList.add(`sel-${btn.dataset.status}`);
    });
  });

  // Scraper run button
  const scraperBtn = document.getElementById('scraper-run-btn');
  if (scraperBtn) scraperBtn.addEventListener('click', runScraper);

  // Report export
  const exportBtn = document.getElementById('export-csv-btn');
  if (exportBtn) exportBtn.addEventListener('click', () => { window.location.href = '/api/export/csv'; });
}

// ── Score ring SVG ──────────────────────────────────────

function scoreRing(score, size = 52) {
  score = parseFloat(score) || 0;
  const r = (size / 2) - 4;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(1, score / 10)) * circ;
  const color = score >= 8 ? 'var(--hot)' : score >= 5 ? 'var(--warm)' : 'var(--cold)';
  const trackColor = score >= 8 ? 'oklch(62% 0.21 27 / 0.15)'
                   : score >= 5 ? 'oklch(72% 0.16 72 / 0.15)'
                   : 'oklch(62% 0.15 240 / 0.15)';
  return `
    <svg class="score-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="3"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="3"
        stroke-dasharray="${fill.toFixed(1)} ${circ.toFixed(1)}"
        stroke-linecap="round"
        transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="${color}"
        font-family="JetBrains Mono, monospace" font-size="13" font-weight="500">${score || '?'}</text>
    </svg>`;
}

// ── Leads view ──────────────────────────────────────────

function renderLeadsView() {
  const leads = state.leads;
  return `
    <div class="filter-bar">
      <div class="search-wrap">
        <input class="search-input" id="search-input" type="text" placeholder="Search by name, category, city...">
      </div>
      <select class="filter-select" id="filter-tier">
        <option value="all">All Tiers</option>
        <option value="HOT">🔥 HOT</option>
        <option value="WARM">🟡 WARM</option>
        <option value="COLD">🧊 COLD</option>
      </select>
      <select class="filter-select" id="filter-status">
        <option value="all">All Stages</option>
        ${PIPELINE_STAGES.map(s => `<option value="${s}">${STAGE_LABEL[s]}</option>`).join('')}
      </select>
      <div class="filter-right">
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-3);align-self:center;">
          ${leads.length} result${leads.length !== 1 ? 's' : ''}
        </span>
        <button class="btn btn-ghost" onclick="window.location.href='/api/export/csv'">Export CSV</button>
      </div>
    </div>
    <div class="leads-list">
      ${leads.length === 0 ? renderEmpty() : leads.map(l => renderLeadRow(l)).join('')}
    </div>`;
}

function renderEmpty() {
  return `<div class="empty-state">
    <div class="empty-icon">⬡</div>
    <p>No leads match your filters. Run the scraper or adjust filters.</p>
  </div>`;
}

function renderLeadRow(lead) {
  const isExpanded = state.expandedId === lead.id;
  const tier   = (lead.tier || 'COLD').toUpperCase();
  const status = (lead.pipeline_status || 'NEW').toUpperCase();
  const score  = parseFloat(lead.score) || 0;
  const hasWebsite = lead.website && lead.website !== 'None' && lead.website !== '';
  const currentIdx = PIPELINE_STAGES.indexOf(status);
  const nextStage  = PIPELINE_STAGES[currentIdx + 1];

  // Website presence is a scoring signal — show absence as opportunity
  const webDisplay = hasWebsite
    ? `<span class="contact-item"><span class="contact-label">WEB</span><a href="${lead.website}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${truncate(lead.website, 26)}</a></span>`
    : `<span class="contact-item contact-warning"><span class="contact-label">WEB</span>No website — opportunity</span>`;

  return `
    <div class="lead-row ${isExpanded ? 'expanded' : ''} tier-row-${tier}" data-id="${lead.id}">
      ${scoreRing(lead.score)}
      <div class="lead-body">
        <div class="lead-header-row" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:3px;">
          <div class="lead-name">${esc(lead.business_name || 'Unknown')}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span class="tier-badge tier-${tier}">${tier}</span>
            <span class="status-pill status-${status}">${STAGE_LABEL[status] || status}</span>
          </div>
        </div>
        <div class="lead-meta">
          ${lead.category ? `<span class="lead-cat">${esc(lead.category)}</span>` : ''}
          ${lead.city ? `<span class="lead-loc">📍 ${esc(lead.city)}${lead.state ? ', ' + esc(lead.state) : ''}</span>` : ''}
          ${lead.rating ? `<span class="lead-loc">⭐ ${lead.rating} · ${lead.review_count || 0} reviews</span>` : ''}
        </div>
        <div class="lead-contacts">
          ${lead.phone ? `<span class="contact-item"><span class="contact-label">PH</span>${esc(lead.phone)}</span>` : ''}
          ${lead.email ? `<span class="contact-item"><span class="contact-label">EM</span>${esc(lead.email)}</span>` : ''}
          ${webDisplay}
        </div>
        ${!isExpanded && lead.outreach_angle ? `
        <div class="lead-angle-teaser">"${esc(truncate(lead.outreach_angle, 95))}"</div>` : ''}
      </div>
      <div class="lead-quick-action">
        ${lead.phone ? `<a class="lqa-btn${tier === 'HOT' ? ' lqa-btn-hot' : ''}" href="tel:${lead.phone}" onclick="event.stopPropagation()" title="Call ${esc(lead.business_name)}">📞</a>` : ''}
        ${nextStage ? `<button class="lqa-btn" data-id="${lead.id}"
          onclick="event.stopPropagation();updateStatus('${lead.id}','${nextStage}')"
          title="Move to ${STAGE_LABEL[nextStage]}">→</button>` : ''}
      </div>
      ${isExpanded ? renderLeadDetail(lead) : ''}
    </div>`;
}

function renderLeadDetail(lead) {
  const status = (lead.pipeline_status || 'NEW').toUpperCase();
  return `
    <div class="lead-detail">
      <div class="detail-block">
        <div class="detail-label">Why this score</div>
        <div class="detail-text">${esc(lead.summary || 'No analysis available.')}</div>
      </div>
      <div class="detail-block">
        <div class="detail-label">Outreach angle</div>
        <div class="detail-text detail-outreach">"${esc(lead.outreach_angle || 'N/A')}"</div>
        ${lead.best_service ? `<div style="margin-top:8px;font-size:12px;color:var(--text-3)">Pitch: <strong style="color:var(--text-2)">${esc(lead.best_service)}</strong></div>` : ''}
      </div>
      ${lead.key_pain_points ? `
      <div class="detail-block">
        <div class="detail-label">Pain points</div>
        <div class="detail-text" style="color:var(--text-3)">${esc(lead.key_pain_points)}</div>
      </div>` : ''}
      <div class="detail-actions">
        <div style="font-size:11px;color:var(--text-3);align-self:center;margin-right:4px;font-family:var(--font-ui);font-weight:600;letter-spacing:0.07em;text-transform:uppercase;">Move to:</div>
        <div class="status-menu">
          ${PIPELINE_STAGES.map(s => `
            <button class="status-opt ${s === status ? 'active' : ''}" data-id="${lead.id}" data-status="${s}">
              ${STAGE_LABEL[s]}
            </button>`).join('')}
        </div>
        <button class="btn btn-ghost" style="margin-left:auto;font-size:12px;" onclick="openDrawer('${lead.id}')">Full Details</button>
      </div>
    </div>`;
}

// ── Pipeline view ───────────────────────────────────────

function renderPipelineView() {
  const cols = PIPELINE_STAGES.map(stage => {
    const leads = state.leads.filter(l => (l.pipeline_status || 'NEW').toUpperCase() === stage);
    const colors = {
      NEW: 'var(--accent)', CONTACTED: 'var(--cold)', RESPONDED: 'var(--proposal)',
      PROPOSAL: 'var(--warm)', WON: 'var(--won)', LOST: 'var(--lost)',
    };
    return `
      <div class="kanban-col">
        <div class="kanban-head">
          <span class="kanban-title" style="color:${colors[stage]}">${STAGE_LABEL[stage]}</span>
          <span class="kanban-count">${leads.length}</span>
        </div>
        <div class="kanban-body">
          ${leads.length === 0
            ? `<div style="padding:12px 8px;font-size:12px;color:var(--text-4);text-align:center;font-family:var(--font-ui);">Empty</div>`
            : leads.map(l => renderKanbanTile(l, stage)).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="pipeline-view">
      <div class="pipeline-header">
        <h2>Pipeline Board</h2>
      </div>
      <div class="kanban">${cols}</div>
    </div>`;
}

function renderKanbanTile(lead, currentStage) {
  const score = parseFloat(lead.score) || 0;
  const scoreColor = score >= 8 ? 'var(--hot)' : score >= 5 ? 'var(--warm)' : 'var(--cold)';
  const ci = PIPELINE_STAGES.indexOf(currentStage);
  const next = PIPELINE_STAGES[ci + 1];
  const prev = PIPELINE_STAGES[ci - 1];

  return `
    <div class="kanban-tile" data-id="${lead.id}">
      <div class="kt-name">${esc(lead.business_name || 'Unknown')}</div>
      <div class="kt-meta">
        <span class="kt-cat">${esc(truncate(lead.category || '', 18))}</span>
        <span class="kt-score" style="color:${scoreColor}">${score}/10</span>
      </div>
      ${lead.phone ? `<div class="kt-phone">${esc(lead.phone)}</div>` : ''}
      <div class="kt-actions">
        <button class="kt-btn" data-action="detail" data-id="${lead.id}">Details</button>
        ${prev ? `<button class="kt-btn" data-action="move" data-id="${lead.id}" data-status="${prev}">← ${STAGE_LABEL[prev]}</button>` : ''}
        ${next ? `<button class="kt-btn" data-action="move" data-id="${lead.id}" data-status="${next}" style="color:var(--accent);border-color:oklch(70% 0.26 295 / 0.3)">${STAGE_LABEL[next]} →</button>` : ''}
      </div>
    </div>`;
}

// ── Scraper view ────────────────────────────────────────

function renderScraperView() {
  const s = state.scraper;
  const dotClass = s.running ? 'running' : s.status === 'complete' ? 'complete' : s.status === 'error' ? 'error' : '';

  const defaultQueries = [
    'contractors in San Diego CA',
    'plumbers in San Diego CA',
    'HVAC in San Diego CA',
    'electricians in San Diego CA',
    'roofers in San Diego CA',
    'funeral homes in San Diego CA',
    'crematorium in San Diego CA',
  ].join('\n');

  return `
    <div class="scraper-view">
      <h2>Run Scraper</h2>
      <p class="sub">Configure and trigger a new Apify scrape. Results are cleaned, scored, and added to your sheet automatically.</p>

      <div class="form-field">
        <label class="form-label" for="scraper-actor-id">Apify Actor ID</label>
        <input class="form-input" id="scraper-actor-id" type="text"
          value="apify/google-maps-scraper"
          placeholder="e.g. apify/google-maps-scraper">
        <div class="form-hint">
          Find this in Apify → Actors → your actor → copy the <strong style="color:var(--text-2)">username/actor-name</strong> from the URL.
          Common: <code style="color:var(--accent)">apify/google-maps-scraper</code> or <code style="color:var(--accent)">compass/crawler-google-places</code>
        </div>
      </div>

      <div class="form-field">
        <label class="form-label" for="scraper-queries">Search Queries</label>
        <textarea class="form-textarea" id="scraper-queries">${defaultQueries}</textarea>
        <div class="form-hint">One search per line. Uses the actor above.</div>
      </div>

      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Max Results Per Search</label>
          <input class="form-number" id="scraper-max" type="number" value="200" min="10" max="500">
        </div>
        <div class="form-field">
          <label class="form-label">Min Star Rating</label>
          <input class="form-number" id="scraper-stars" type="number" value="3" min="1" max="5">
        </div>
        <div class="form-field">
          <label class="form-label">Max Reviews to Scrape</label>
          <input class="form-number" id="scraper-reviews" type="number" value="5" min="0" max="50">
        </div>
      </div>

      <button class="scraper-run-btn" id="scraper-run-btn" ${s.running ? 'disabled' : ''}>
        ${s.running
          ? `<div class="spinner"></div> Running...`
          : `<span>▶</span> Start Scrape`}
      </button>

      <div class="status-panel">
        <div class="status-header">
          <span class="status-label">Status</span>
          <div class="status-dot ${dotClass}"></div>
        </div>
        <div class="status-message" id="scraper-status-msg">${esc(s.message || 'Ready')}</div>
        ${s.status === 'complete' && s.leads_found > 0 ? `
          <div class="status-result">
            <div class="result-stat">
              <span style="color:var(--accent)">${s.leads_found}</span>
              new leads
            </div>
            <div class="result-stat">
              <span style="color:var(--hot)">${s.hot_count}</span>
              HOT
            </div>
          </div>` : ''}
      </div>

      <div class="import-section">
        <div class="import-divider">
          <span>OR IMPORT EXISTING DATASET</span>
        </div>
        <p class="sub" style="margin-bottom:16px;margin-top:0;">Have an Apify dataset from a previous run? Pull it without re-scraping.</p>
        <div class="form-field">
          <label class="form-label" for="dataset-id-input">Apify Dataset ID</label>
          <input class="form-input" id="dataset-id-input" type="text"
            placeholder="e.g. RnXtM8i4PKFbzgHf2">
          <div class="form-hint">Apify → Storage → Datasets → copy the ID from the list or URL bar.</div>
        </div>
        <button class="btn btn-accent" id="import-dataset-btn" onclick="importDataset()" ${s.running ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
          Import Dataset
        </button>
        <div id="import-status" class="import-status-msg"></div>
      </div>
    </div>`;
}

async function runScraper() {
  const queries = document.getElementById('scraper-queries').value.trim().split('\n').filter(q => q.trim());
  const maxPlaces = parseInt(document.getElementById('scraper-max').value) || 200;
  const minStars  = parseInt(document.getElementById('scraper-stars').value) || 3;
  const maxReviews = parseInt(document.getElementById('scraper-reviews').value) || 5;
  const actorId   = (document.getElementById('scraper-actor-id').value || '').trim();

  if (!queries.length) return;

  const payload = {
    _actorId: actorId || 'apify/google-maps-scraper',
    searchStringsArray: queries.map(q => q.trim()),
    maxCrawledPlacesPerSearch: maxPlaces,
    minStars,
    skipClosedPlaces: true,
    scrapeContacts: true,
    maxReviews,
    reviewsSort: 'newest',
    includeWebResults: true,
  };

  const res = await fetch('/api/scraper/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    state.scraper.running = true;
    render();
  }
}

async function quickRun() {
  const res = await fetch('/api/scraper/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.ok) {
    state.tab = 'scraper';
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'scraper');
    });
    state.scraper.running = true;
    render();
  }
}

async function importDataset() {
  const input = document.getElementById('dataset-id-input');
  const datasetId = (input ? input.value : '').trim();
  if (!datasetId) {
    const el = document.getElementById('import-status');
    if (el) el.textContent = 'Enter a dataset ID first.';
    return;
  }

  const statusEl = document.getElementById('import-status');
  if (statusEl) statusEl.textContent = 'Starting import...';

  try {
    const res = await fetch('/api/scraper/import-dataset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset_id: datasetId }),
    });

    if (res.ok) {
      state.scraper.running = true;
      if (statusEl) statusEl.textContent = 'Import running — watch status panel above.';
      render();
    } else {
      const err = await res.json().catch(() => ({ detail: 'Request failed' }));
      if (statusEl) statusEl.textContent = `Error: ${err.detail || 'Unknown error'}`;
    }
  } catch (e) {
    const statusEl = document.getElementById('import-status');
    if (statusEl) statusEl.textContent = `Network error: ${e.message}`;
  }
}

// ── Scraper polling ──────────────────────────────────────

// Sphere mood map: pipeline status → sphere mode
const SPHERE_MODE_MAP = {
  idle:      'IDLE',
  starting:  'ACTIVE',
  scraping:  'ACTIVE',
  cleaning:  'ACTIVE',
  analyzing: 'THINKING',
  saving:    'ACTIVE',
  notifying: 'COMPLETE',
  complete:  'COMPLETE',
  error:     'IDLE',
};

function startScraperPoll() {
  pollScraperStatus();
  setInterval(pollScraperStatus, 3000);
}

async function pollScraperStatus() {
  try {
    const res = await fetch('/api/scraper/status');
    const s = await res.json();
    const wasRunning = state.scraper.running;
    state.scraper = s;

    // Sync Three.js sphere mood with pipeline state
    if (window.setSphereMode) {
      window.setSphereMode(SPHERE_MODE_MAP[s.status] || 'IDLE');
    }

    // Keep scan animation in sync regardless of which tab is active
    const viewEl = document.getElementById('view');
    if (viewEl) viewEl.classList.toggle('scanning', s.running);

    // Update run button in topbar
    const runBtn = document.getElementById('hdr-run-btn');
    if (runBtn) {
      if (s.running) {
        runBtn.classList.add('running');
        runBtn.innerHTML = `<div class="spinner" style="width:12px;height:12px"></div> Running`;
      } else {
        runBtn.classList.remove('running');
        runBtn.innerHTML = `<span class="run-icon">▶</span> Run Scraper`;
      }
    }

    // Scraper just finished: reload data and re-render
    if (wasRunning && !s.running) {
      await loadAll();
      if (state.tab === 'scraper') render();
    }

    // Live-update the status message without full re-render
    if (state.tab === 'scraper') {
      const msgEl = document.getElementById('scraper-status-msg');
      if (msgEl) {
        msgEl.textContent = s.message || '';
      } else {
        render();
      }
    }
  } catch (_) { /* server may be starting */ }
}

// ── Reports view ─────────────────────────────────────────

function renderReportsView() {
  const s = state.stats;
  const total = s.total || 0;
  const tiers = s.tiers || {};
  const pipeline = s.pipeline || {};

  const tierRows = [
    { key: 'HOT',  color: 'var(--hot)',  label: 'HOT' },
    { key: 'WARM', color: 'var(--warm)', label: 'WARM' },
    { key: 'COLD', color: 'var(--cold)', label: 'COLD' },
  ].map(({ key, color, label }) => {
    const count = tiers[key] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `
      <div class="dist-row">
        <div class="dist-label" style="color:${color}">${label}</div>
        <div class="dist-bar-wrap">
          <div class="dist-bar" style="width:${pct}%;background:${color};"></div>
        </div>
        <div class="dist-count">${count}</div>
      </div>`;
  }).join('');

  const funnelRows = PIPELINE_STAGES.map(st => `
    <div class="funnel-row">
      <span class="funnel-stage">${STAGE_LABEL[st]}</span>
      <span class="funnel-count">${pipeline[st] || 0}</span>
    </div>`).join('');

  const hotLeads = [...state.leads]
    .filter(l => (l.tier || '').toUpperCase() === 'HOT')
    .sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0))
    .slice(0, 10);

  const topRows = hotLeads.map((l, i) => {
    const score = parseFloat(l.score) || 0;
    const color = score >= 8 ? 'var(--hot)' : 'var(--warm)';
    return `
      <div class="top-row">
        <div class="top-rank">${i + 1}</div>
        <div class="top-name">${esc(l.business_name || 'Unknown')}</div>
        <div class="top-phone">${esc(l.phone || '')}</div>
        <span class="tier-badge tier-${(l.tier||'COLD').toUpperCase()}">${l.tier || 'COLD'}</span>
        <span style="font-family:var(--font-mono);font-size:13px;font-weight:500;color:${color}">${score}/10</span>
      </div>`;
  }).join('');

  return `
    <div class="reports-view">
      <h2>Reports</h2>
      <div class="reports-grid">
        <div class="report-block">
          <h3>Lead Distribution</h3>
          ${total === 0 ? '<p style="color:var(--text-3);font-size:13px">No leads yet.</p>' : tierRows}
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-dim);display:flex;gap:16px;">
            <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-3)">Total: <strong style="color:var(--text-1)">${total}</strong></span>
          </div>
        </div>
        <div class="report-block">
          <h3>Pipeline Stages</h3>
          ${funnelRows}
        </div>
        ${hotLeads.length > 0 ? `
        <div class="report-block top-leads">
          <h3>Top HOT Leads</h3>
          ${topRows}
        </div>` : ''}
      </div>
      <div class="report-actions">
        <button class="btn btn-accent" id="export-csv-btn">Export All Leads (CSV)</button>
        <button class="btn btn-ghost" onclick="window.print()">Print Report</button>
      </div>
    </div>`;
}

// ── Drawer ───────────────────────────────────────────────

function openDrawer(leadId) {
  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;

  const drawer   = document.getElementById('drawer');
  const inner    = document.getElementById('drawer-inner');
  const backdrop = document.getElementById('drawer-backdrop');
  const status   = (lead.pipeline_status || 'NEW').toUpperCase();

  const pipelineOpts = PIPELINE_STAGES.map(s => `
    <button class="pipeline-opt ${s === status ? `sel-${s}` : ''}"
      data-id="${lead.id}" data-status="${s}">${STAGE_LABEL[s]}</button>`
  ).join('');

  inner.innerHTML = `
    <button class="drawer-close" onclick="closeDrawer()">✕</button>
    <div class="drawer-score-row">
      ${scoreRing(lead.score, 60)}
      <div>
        <div class="drawer-name">${esc(lead.business_name || 'Unknown')}</div>
        <span class="tier-badge tier-${(lead.tier || 'COLD').toUpperCase()}">${lead.tier || 'COLD'}</span>
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Contact</div>
      ${field('Phone',    lead.phone)}
      ${field('Email',    lead.email)}
      ${field('Website',  lead.website, true)}
      ${field('Category', lead.category)}
      ${field('Location', [lead.city, lead.state].filter(Boolean).join(', '))}
      ${field('Rating',   lead.rating ? `${lead.rating} ★ (${lead.review_count} reviews)` : '')}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Analysis</div>
      <div class="drawer-summary">${esc(lead.summary || 'No analysis available.')}</div>
      ${lead.outreach_angle ? `<div class="drawer-outreach">"${esc(lead.outreach_angle)}"</div>` : ''}
      ${lead.best_service ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:8px">Best pitch: <strong style="color:var(--text-2)">${esc(lead.best_service)}</strong></div>` : ''}
      ${lead.key_pain_points ? `
        <div class="drawer-section-title" style="margin-top:12px">Pain Points</div>
        <ul class="pain-list">
          ${lead.key_pain_points.split(';').filter(p => p.trim()).map(p =>
            `<li class="pain-item">${esc(p.trim())}</li>`
          ).join('')}
        </ul>` : ''}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Pipeline Stage</div>
      <div class="pipeline-selector">${pipelineOpts}</div>
    </div>`;

  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('visible');
}

function closeDrawer() {
  document.getElementById('drawer').setAttribute('aria-hidden', 'true');
  document.getElementById('drawer-backdrop').classList.remove('visible');
}

function field(key, val, isUrl = false) {
  if (!val || val === 'None' || val === '') return '';
  const display = isUrl
    ? `<a href="${val}" target="_blank" rel="noopener">${val}</a>`
    : esc(String(val));
  return `<div class="drawer-field">
    <span class="df-key">${key}</span>
    <span class="df-val">${display}</span>
  </div>`;
}

// ── Utilities ────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── HOME view ────────────────────────────────────────────

const NODES = [
  { id: 'apify',    label: 'APIFY',      sub: 'Scraper',    icon: '⬡', tab: 'scraper',  angle: -60  },
  { id: 'claude',   label: 'CLAUDE AI',  sub: 'Analyzer',   icon: '◎', tab: null,       angle: 0    },
  { id: 'email',    label: 'NOTIFIER',   sub: 'Email/SMS',  icon: '◉', tab: null,       angle: 60   },
  { id: 'sheets',   label: 'SHEETS',     sub: 'Database',   icon: '▦', tab: 'reports',  angle: 120  },
  { id: 'pipeline', label: 'PIPELINE',   sub: 'CRM',        icon: '⟳', tab: 'pipeline', angle: 180  },
  { id: 'leads',    label: 'LEADS',      sub: 'Database',   icon: '◈', tab: 'leads',    angle: -120 },
];

function renderHomeView() {
  const s = state.stats;
  const hot  = s.tiers?.HOT  || 0;
  const warm = s.tiers?.WARM || 0;
  const total = s.total || 0;
  const scraperActive = state.scraper.running;

  const nodeHtml = NODES.map(n => {
    let stat = '';
    if (n.id === 'apify')    stat = scraperActive ? 'Scanning...' : 'Ready';
    if (n.id === 'claude')   stat = total ? `${total} scored` : 'Standby';
    if (n.id === 'email')    stat = hot ? `${hot} HOT alerts` : 'Monitoring';
    if (n.id === 'sheets')   stat = total ? `${total} rows` : 'Connected';
    if (n.id === 'pipeline') stat = `${s.pipeline?.WON || 0} won`;
    if (n.id === 'leads')    stat = total ? `${total} total` : 'Empty';

    const isActive = (n.id === 'apify' && scraperActive) || (n.id === 'leads' && total > 0);
    return `
      <div class="mn-node ${isActive ? 'mn-active' : ''}" data-node="${n.id}" data-tab="${n.tab || ''}"
           id="mn-${n.id}" style="--angle:${n.angle}deg">
        <div class="mn-hex"><div class="mn-icon">${n.icon}</div></div>
        <div class="mn-label">${n.label}</div>
        <div class="mn-sub">${n.sub}</div>
        <div class="mn-stat" id="mnstat-${n.id}">${stat}</div>
      </div>`;
  }).join('');

  // Top priority target (highest-scored HOT lead)
  const topTarget = [...state.leads]
    .filter(l => (l.tier || '').toUpperCase() === 'HOT')
    .sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0))[0];

  const priorityHtml = topTarget ? `
    <div class="mp-target">
      <div class="mp-target-score">${parseFloat(topTarget.score).toFixed(1)}</div>
      <div class="mp-target-info">
        <div class="mp-target-name">${esc(topTarget.business_name || 'Unknown')}</div>
        <div class="mp-target-cat">${esc(topTarget.category || '')}${topTarget.city ? ' · ' + esc(topTarget.city) : ''}</div>
        ${topTarget.outreach_angle ? `<div class="mp-target-angle">"${esc(truncate(topTarget.outreach_angle, 90))}"</div>` : ''}
      </div>
    </div>
    <div class="mp-target-actions">
      <button class="mp-btn" onclick="navTo('leads')">Review Intel</button>
      ${topTarget.phone ? `<a class="mp-btn mp-btn-hot" href="tel:${topTarget.phone}">📞 Call</a>` : ''}
    </div>` : `
    <div style="color:var(--text-4);font-size:12px;font-family:var(--font-mono);padding:10px 0;line-height:1.7">
      No HOT targets yet.<br>Run scraper to generate leads.
    </div>`;

  return `
    <div class="home-view">
      <div class="home-left">
        <div class="sphere-stage" id="sphere-stage">
          <div id="sphere-3d-container" class="sphere-3d-host"></div>
          <svg class="connections-svg" id="connections-svg"></svg>
          <div class="mn-nodes" id="mn-nodes">${nodeHtml}</div>
          <div class="sphere-center-label">
            <div class="scl-name">MERIDIAN</div>
            <div class="scl-sub">Lead Intelligence</div>
          </div>
        </div>
        <div class="home-statusbar">
          <div class="hsb-item"><span class="hsb-val" style="color:var(--text-1)">${total}</span><span class="hsb-key">Total</span></div>
          <div class="hsb-sep"></div>
          <div class="hsb-item"><span class="hsb-val" style="color:var(--hot)">${hot}</span><span class="hsb-key">HOT</span></div>
          <div class="hsb-sep"></div>
          <div class="hsb-item"><span class="hsb-val" style="color:var(--warm)">${warm}</span><span class="hsb-key">WARM</span></div>
          <div class="hsb-sep"></div>
          <div class="hsb-item"><span class="hsb-val" style="color:var(--won)">${s.pipeline?.WON || 0}</span><span class="hsb-key">Won</span></div>
          <div class="hsb-sep"></div>
          <div class="hsb-item">
            <span class="hsb-val">
              <span class="status-dot ${scraperActive ? 'running' : 'complete'}" style="display:inline-block;margin-right:4px"></span>
              ${scraperActive ? 'Scanning' : 'Online'}
            </span>
            <span class="hsb-key">System</span>
          </div>
        </div>
      </div>

      <div class="home-right">
        <div class="mp-section">
          <div class="mp-label">Mission Status</div>
          <div class="mp-stat-grid">
            <div class="mp-stat">
              <span class="mp-val">${total}</span>
              <span class="mp-key">Active Targets</span>
            </div>
            <div class="mp-stat">
              <span class="mp-val" style="color:var(--hot)">${hot}</span>
              <span class="mp-key">Priority HOT</span>
            </div>
            <div class="mp-stat">
              <span class="mp-val" style="color:var(--warm)">${warm}</span>
              <span class="mp-key">Warm Leads</span>
            </div>
            <div class="mp-stat">
              <span class="mp-val" style="color:var(--won)">${s.pipeline?.WON || 0}</span>
              <span class="mp-key">Closed Won</span>
            </div>
          </div>
        </div>

        <div class="mp-section">
          <div class="mp-label">Top Priority Target</div>
          ${priorityHtml}
        </div>

        <div class="mp-section">
          <div class="mp-label">Quick Actions</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="mp-btn" style="justify-content:flex-start;gap:10px;padding:10px 14px;" onclick="navTo('leads')">
              <span style="color:var(--accent)">◈</span> View All Leads
            </button>
            <button class="mp-btn" style="justify-content:flex-start;gap:10px;padding:10px 14px;" onclick="navTo('pipeline')">
              <span style="color:var(--warm)">⟳</span> Pipeline Board
            </button>
            <button class="mp-btn" style="justify-content:flex-start;gap:10px;padding:10px 14px;" onclick="quickRun()">
              <span style="color:var(--accent)">▶</span> Run Scraper Now
            </button>
          </div>
        </div>

        <div class="mp-section">
          <div class="mp-label">System Status</div>
          <div class="mp-sys-row">
            <span class="mp-sys-key">Intelligence</span>
            <span class="mp-sys-val mp-sys-active">ONLINE</span>
          </div>
          <div class="mp-sys-row">
            <span class="mp-sys-key">Scraper</span>
            <span class="mp-sys-val ${scraperActive ? 'mp-sys-scanning' : 'mp-sys-active'}">${scraperActive ? 'SCANNING' : 'STANDBY'}</span>
          </div>
          <div class="mp-sys-row">
            <span class="mp-sys-key">Sheet Sync</span>
            <span class="mp-sys-val mp-sys-active">CONNECTED</span>
          </div>
          ${state.scraper.message && state.scraper.message !== 'Ready' ? `
          <div class="mp-sys-row">
            <span class="mp-sys-key">Last Op</span>
            <span class="mp-sys-val" style="font-size:11px;text-align:right;max-width:200px;">${esc(truncate(state.scraper.message, 40))}</span>
          </div>` : ''}
        </div>
      </div>
    </div>`;
}

function navTo(tab) {
  state.tab = tab;
  state.expandedId = null;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

// ── Sphere: Three.js wrapper ─────────────────────────────

function initSphere() {
  const stage = document.getElementById('sphere-stage');
  if (!stage) return;

  const size = Math.min(stage.clientWidth, stage.clientHeight, 560);

  // Position mindmap nodes radially
  positionNodes(size);

  // Draw SVG connection lines
  drawConnections(size);

  // Node click → tab navigation
  document.querySelectorAll('.mn-node[data-tab]').forEach(el => {
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      if (!tab) return;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      state.tab = tab;
      state.expandedId = null;
      render();
    });
  });

  // Boot Three.js sphere inside the host div
  if (window.initSphere3D) {
    window.initSphere3D('sphere-3d-container');
  }

  // Set initial mood from current scraper state
  if (window.setSphereMode) {
    window.setSphereMode(SPHERE_MODE_MAP[state.scraper.status] || 'IDLE');
  }
}

function positionNodes(size) {
  const cx = size / 2, cy = size / 2;
  const R = size * 0.38;

  NODES.forEach(n => {
    const el = document.getElementById(`mn-${n.id}`);
    if (!el) return;
    const rad = (n.angle - 90) * Math.PI / 180;
    const x = cx + R * Math.cos(rad);
    const y = cy + R * Math.sin(rad);
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  });
}

function drawConnections(size) {
  const svg = document.getElementById('connections-svg');
  if (!svg) return;
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  const cx = size / 2, cy = size / 2;
  const sphereR = size * 0.145;
  const orbitR  = size * 0.38;

  svg.innerHTML = NODES.map((n, i) => {
    const rad = (n.angle - 90) * Math.PI / 180;
    const nx = cx + orbitR * Math.cos(rad);
    const ny = cy + orbitR * Math.sin(rad);
    const sx = cx + sphereR * Math.cos(rad);
    const sy = cy + sphereR * Math.sin(rad);
    const mx = (sx + nx) / 2 - Math.sin(rad) * 18;
    const my = (sy + ny) / 2 + Math.cos(rad) * 18;

    const pathId = `conn-${n.id}`;
    const isHot  = (n.id === 'apify' && state.scraper.running);

    return `
      <path id="${pathId}" d="M ${sx} ${sy} Q ${mx} ${my} ${nx} ${ny}"
        fill="none"
        stroke="rgba(153,85,255,${isHot ? 0.6 : 0.2})"
        stroke-width="${isHot ? 1.5 : 1}"
        stroke-dasharray="5 6">
        <animate attributeName="stroke-dashoffset"
          from="0" to="-22"
          dur="${0.9 + i * 0.12}s"
          repeatCount="indefinite"/>
      </path>
      <circle r="2.5" fill="rgba(153,85,255,${isHot ? 0.9 : 0.5})">
        <animateMotion dur="${1.6 + i * 0.18}s" repeatCount="indefinite">
          <mpath href="#${pathId}"/>
        </animateMotion>
      </circle>`;
  }).join('');
}

// ── Coach tab ────────────────────────────────────────────

async function loadCoachReviews() {
  try {
    const res = await fetch('/api/coach/reviews');
    const data = await res.json();
    state.coach.reviews = data.reviews || [];
  } catch (_) {}
}

function coachSubtab(tab) {
  state.coach.activeSubtab = tab;
  if (tab === 'history' && state.coach.reviews.length === 0) {
    loadCoachReviews().then(() => render());
  }
  if (tab === 'weekly' && !state.coach.weekly) {
    loadWeeklySummary(false);
  }
  render();
}

async function loadWeeklySummary(force = false) {
  state.coach.weeklyLoading = true;
  render();
  try {
    const res = await fetch(`/api/coach/weekly?force=${force}`);
    const data = await res.json();
    state.coach.weekly = data.summary || null;
  } catch (e) {
    state.coach.weekly = { error: e.message };
  }
  state.coach.weeklyLoading = false;
  render();
}

async function submitCallForReview() {
  const calls = state.coach.batchCalls.filter(c => c.transcript.trim());
  if (!calls.length) {
    state.coach.reviewMsg = 'Paste at least one transcript before analyzing.';
    render();
    return;
  }

  state.coach.reviewing = true;
  state.coach.reviewMsg = calls.length === 1
    ? 'Marcus is reviewing the call...'
    : `Marcus is reviewing ${calls.length} calls...`;
  render();

  try {
    let results;
    if (calls.length === 1) {
      const res = await fetch('/api/coach/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: calls[0].transcript, call_name: calls[0].name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Analysis failed');
      }
      const data = await res.json();
      results = [data.review];
    } else {
      const res = await fetch('/api/coach/analyze-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calls }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Batch analysis failed');
      }
      const data = await res.json();
      results = data.results || [];
    }

    // Prepend to local state
    state.coach.reviews = [...results, ...state.coach.reviews];
    state.coach.reviewMsg = '';
    state.coach.batchCalls = [{ name: '', transcript: '' }];
    // Auto-navigate to history to show the results
    state.coach.activeSubtab = 'history';
    state.coach.expandedReviewId = results[0]?.review_id || null;

  } catch (e) {
    state.coach.reviewMsg = `Error: ${e.message}`;
  }

  state.coach.reviewing = false;
  render();
}

async function deleteReview(reviewId) {
  try {
    await fetch(`/api/coach/reviews/${reviewId}`, { method: 'DELETE' });
    state.coach.reviews = state.coach.reviews.filter(r => r.review_id !== reviewId);
    if (state.coach.expandedReviewId === reviewId) state.coach.expandedReviewId = null;
    render();
  } catch (_) {}
}

function coachUpdateBatchCall(index, field, value) {
  if (!state.coach.batchCalls[index]) return;
  state.coach.batchCalls[index][field] = value;
  // Auto-add a new empty slot if editing the last one
  if (field === 'transcript' && value.trim() && index === state.coach.batchCalls.length - 1) {
    if (state.coach.batchCalls.length < 20) {
      state.coach.batchCalls.push({ name: '', transcript: '' });
      render();
    }
  }
}

function coachRemoveBatchCall(index) {
  if (state.coach.batchCalls.length <= 1) {
    state.coach.batchCalls = [{ name: '', transcript: '' }];
  } else {
    state.coach.batchCalls.splice(index, 1);
  }
  render();
}

function renderCoachView() {
  const c = state.coach;
  const sub = c.activeSubtab;
  const filledCalls = c.batchCalls.filter(x => x.transcript.trim()).length;

  const subtabs = [
    { id: 'analyze', label: 'Analyze Call' },
    { id: 'history', label: `History${c.reviews.length ? ` (${c.reviews.length})` : ''}` },
    { id: 'weekly',  label: 'Weekly Training' },
  ];

  const subtabHtml = subtabs.map(t => `
    <button class="coach-subtab ${sub === t.id ? 'active' : ''}"
      onclick="coachSubtab('${t.id}')">${t.label}</button>`).join('');

  let content = '';
  if (sub === 'analyze') content = renderCoachAnalyzeTab();
  else if (sub === 'history') content = renderCoachHistoryTab();
  else if (sub === 'weekly') content = renderCoachWeeklyTab();

  return `
    <div class="coach-view">
      <div class="coach-header">
        <div class="coach-title-block">
          <h2 class="coach-title">Sales Coach</h2>
          <p class="coach-subtitle">Marcus reviews your calls as a $100k/month agency owner — using Hormozi frameworks to tell you exactly what to fix and what to do next.</p>
        </div>
      </div>
      <div class="coach-subtabs">${subtabHtml}</div>
      <div class="coach-content">${content}</div>
    </div>`;
}

function renderCoachAnalyzeTab() {
  const c = state.coach;
  const filledCalls = c.batchCalls.filter(x => x.transcript.trim()).length;

  const callSlots = c.batchCalls.map((call, i) => `
    <div class="coach-call-slot" data-index="${i}">
      <div class="coach-call-slot-header">
        <input class="coach-call-name-input" type="text"
          placeholder="Call name (e.g. ABC Roofing — Cold Call #3)"
          value="${esc(call.name)}"
          oninput="coachUpdateBatchCall(${i}, 'name', this.value)">
        ${c.batchCalls.length > 1 || call.transcript ? `
          <button class="coach-slot-remove" onclick="coachRemoveBatchCall(${i})" title="Remove">✕</button>` : ''}
      </div>
      <textarea
        class="coach-transcript-input"
        placeholder="Paste the call transcript here...&#10;&#10;You can paste raw text, AI transcription output, or any notes you wrote during the call. The more detail, the better the coaching."
        oninput="coachUpdateBatchCall(${i}, 'transcript', this.value)"
      >${esc(call.transcript)}</textarea>
    </div>`).join('');

  return `
    <div class="coach-analyze-wrap">
      <div class="coach-instructions">
        <div class="coach-instr-item"><span class="coach-instr-num">1</span> Paste transcripts or upload .txt files — one per call, up to 20 at once.</div>
        <div class="coach-instr-item"><span class="coach-instr-num">2</span> Give each call a name so you can find the review later.</div>
        <div class="coach-instr-item"><span class="coach-instr-num">3</span> Hit Analyze. Marcus reviews every call and tells you exactly what to do next.</div>
      </div>

      <!-- Bulk file upload drop zone -->
      <div class="coach-upload-zone" id="coach-upload-zone"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="coachHandleFileDrop(event)">
        <input type="file" id="coach-file-input" accept=".txt" multiple
          style="display:none" onchange="coachHandleFileInput(this)">
        <div class="cuz-icon">↑</div>
        <div class="cuz-text">Drop .txt transcript files here</div>
        <div class="cuz-sub">or <button class="cuz-browse-btn" onclick="document.getElementById('coach-file-input').click()">browse files</button> — up to 20 at once</div>
      </div>

      <div class="coach-call-slots" id="coach-call-slots">
        ${callSlots}
      </div>

      ${c.batchCalls.length < 20 && c.batchCalls[c.batchCalls.length - 1]?.transcript.trim() ? `
        <button class="coach-add-call-btn" onclick="coachAddCall()">+ Add Another Call</button>` : ''}

      ${c.reviewMsg ? `
        <div class="coach-msg ${c.reviewMsg.startsWith('Error') ? 'coach-msg-error' : 'coach-msg-info'}">
          ${c.reviewing ? '<div class="spinner" style="display:inline-block;width:14px;height:14px;margin-right:8px;vertical-align:middle"></div>' : ''}
          ${esc(c.reviewMsg)}
        </div>` : ''}

      <button class="coach-analyze-btn" onclick="submitCallForReview()"
        ${c.reviewing ? 'disabled' : ''}>
        ${c.reviewing
          ? `<div class="spinner" style="width:16px;height:16px"></div> Analyzing...`
          : `<span>◎</span> ${filledCalls > 1 ? `Analyze ${filledCalls} Calls` : 'Analyze Call'}`}
      </button>

      <div class="coach-tip">
        <span class="coach-tip-label">PRO TIP</span>
        Record your calls in any app, run them through Otter.ai or Rev.ai to get a .txt transcript, then drop the file above. Marcus handles the rest.
      </div>
    </div>`;
}

function coachAddCall() {
  state.coach.batchCalls.push({ name: '', transcript: '' });
  render();
}

function coachHandleFileDrop(event) {
  event.preventDefault();
  document.getElementById('coach-upload-zone')?.classList.remove('drag-over');
  const files = Array.from(event.dataTransfer.files).filter(f => f.name.endsWith('.txt'));
  if (!files.length) return;
  _coachLoadFiles(files);
}

function coachHandleFileInput(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  _coachLoadFiles(files);
  input.value = ''; // reset so same file can be re-selected
}

function _coachLoadFiles(files) {
  const MAX = 20;
  // Clear default empty slot if it's truly empty
  if (state.coach.batchCalls.length === 1 && !state.coach.batchCalls[0].transcript.trim()) {
    state.coach.batchCalls = [];
  }

  const remaining = MAX - state.coach.batchCalls.length;
  const toLoad = files.slice(0, remaining);

  let loaded = 0;
  toLoad.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const transcript = (e.target.result || '').trim();
      // Derive a clean name from the filename
      const name = file.name.replace(/\.txt$/i, '').replace(/[_-]/g, ' ');
      state.coach.batchCalls.push({ name, transcript });
      loaded++;
      if (loaded === toLoad.length) {
        // Make sure there's one empty trailing slot
        const last = state.coach.batchCalls[state.coach.batchCalls.length - 1];
        if (last?.transcript.trim()) {
          state.coach.batchCalls.push({ name: '', transcript: '' });
        }
        render();
      }
    };
    reader.readAsText(file);
  });

  if (files.length > remaining) {
    state.coach.reviewMsg = `Loaded ${toLoad.length} files. Maximum 20 calls per batch.`;
  }
}

function renderCoachHistoryTab() {
  const reviews = state.coach.reviews;

  if (reviews.length === 0) {
    return `<div class="coach-empty">
      <div class="coach-empty-icon">◎</div>
      <p>No call reviews yet.</p>
      <p style="color:var(--text-3);font-size:13px;margin-top:8px">Upload your first transcript in the Analyze Call tab.</p>
      <button class="mp-btn" style="margin-top:20px" onclick="coachSubtab('analyze')">Analyze a Call</button>
    </div>`;
  }

  const rows = reviews.map(r => renderCoachReviewCard(r)).join('');
  return `<div class="coach-history-list">${rows}</div>`;
}

function renderCoachReviewCard(r) {
  if (r.error) {
    return `<div class="coach-review-card coach-review-error">
      <div class="crc-header">
        <span class="crc-name">${esc(r.call_name || 'Unknown Call')}</span>
        <span class="crc-error-badge">ERROR</span>
      </div>
      <div class="crc-error-msg">${esc(r.error)}</div>
    </div>`;
  }

  const expanded = state.coach.expandedReviewId === r.review_id;
  const score = r.overall_score || 0;
  const scoreColor = score >= 8 ? 'var(--hot)' : score >= 6 ? 'var(--warm)' : score >= 4 ? 'var(--cold)' : 'oklch(55% 0.09 27)';
  const scoreLabel = score >= 8 ? 'STRONG' : score >= 6 ? 'DECENT' : score >= 4 ? 'WEAK' : 'POOR';

  const hormozi = r.hormozi_audit || {};
  const hormoziBits = [
    { key: 'dream_outcome_identified', label: 'Dream Outcome' },
    { key: 'pain_amplified',           label: 'Pain Amplified' },
    { key: 'value_stack_presented',    label: 'Value Stack' },
    { key: 'price_anchored',           label: 'Price Anchored' },
    { key: 'close_attempted',          label: 'Close Attempted' },
  ];

  const hormoziHtml = hormoziBits.map(bit => `
    <span class="hma-bit ${hormozi[bit.key] ? 'hma-yes' : 'hma-no'}">
      ${hormozi[bit.key] ? '✓' : '✗'} ${bit.label}
    </span>`).join('');

  const scoreBreakdown = r.score_breakdown || {};
  const sbItems = [
    { key: 'opening_rapport',   label: 'Rapport' },
    { key: 'discovery',         label: 'Discovery' },
    { key: 'value_presentation',label: 'Value' },
    { key: 'objection_handling',label: 'Objections' },
    { key: 'next_steps',        label: 'Next Steps' },
  ];

  const sbHtml = sbItems.map(item => {
    const val = scoreBreakdown[item.key] || 0;
    const maxVal = 2;
    return `
      <div class="sb-item">
        <span class="sb-label">${item.label}</span>
        <div class="sb-track">
          <div class="sb-fill" style="width:${(val / maxVal) * 100}%;background:${val === 2 ? 'var(--accent)' : val === 1 ? 'var(--warm)' : 'var(--hot)'}"></div>
        </div>
        <span class="sb-val">${val}/${maxVal}</span>
      </div>`;
  }).join('');

  const wellItems = (r.what_went_well || []).map(w => `<li>${esc(w)}</li>`).join('');
  const wrongItems = (r.what_went_wrong || []).map(w => `
    <div class="wrong-item">
      <div class="wrong-mistake">${esc(w.mistake || '')}</div>
      ${w.exact_line ? `<div class="wrong-line">"${esc(w.exact_line)}"</div>` : ''}
      ${w.better_response ? `<div class="wrong-fix"><span class="wrong-fix-label">INSTEAD SAY:</span> "${esc(w.better_response)}"</div>` : ''}
    </div>`).join('');

  const objItems = (r.objection_playbook || []).map(o => `
    <div class="obj-item">
      <div class="obj-q"><span class="obj-label">THEY SAID</span>${esc(o.objection || '')}</div>
      ${o.rep_response ? `<div class="obj-rep"><span class="obj-label">REP SAID</span>${esc(o.rep_response)}</div>` : ''}
      ${o.why_it_hurt ? `<div class="obj-why">${esc(o.why_it_hurt)}</div>` : ''}
      ${o.hormozi_reframe ? `<div class="obj-fix"><span class="obj-fix-label">HORMOZI REFRAME:</span><br>"${esc(o.hormozi_reframe)}"</div>` : ''}
    </div>`).join('');

  const nextMove = r.next_move || {};
  const weeklyPriority = r.weekly_priority || {};

  return `
    <div class="coach-review-card ${expanded ? 'expanded' : ''}" data-review-id="${r.review_id}">
      <div class="crc-header" onclick="toggleReview('${r.review_id}')">
        <div class="crc-header-left">
          <div class="crc-score-ring" style="--score-color:${scoreColor}">
            <span class="crc-score-num" style="color:${scoreColor}">${score}</span>
            <span class="crc-score-denom">/10</span>
          </div>
          <div class="crc-header-info">
            <div class="crc-name">${esc(r.call_name || 'Unnamed Call')}</div>
            <div class="crc-meta">
              <span class="crc-score-label" style="color:${scoreColor}">${scoreLabel}</span>
              ${r.prospect?.niche ? `<span class="crc-niche">${esc(r.prospect.niche)}</span>` : ''}
              <span class="crc-date">${r.analyzed_at ? new Date(r.analyzed_at).toLocaleDateString() : ''}</span>
            </div>
          </div>
        </div>
        <div class="crc-header-right">
          <div class="hma-row">${hormoziHtml}</div>
          <button class="crc-expand-btn">${expanded ? '▲' : '▼'}</button>
        </div>
      </div>

      ${!expanded ? `
        <div class="crc-preview">
          <div class="crc-critical">"${esc(truncate(r.critical_mistake || 'No issues noted.', 140))}"</div>
        </div>` : ''}

      ${expanded ? `
        <div class="crc-body">

          <div class="crc-section">
            <div class="crc-section-title">Score Breakdown</div>
            <div class="sb-grid">${sbHtml}</div>
          </div>

          ${r.prospect ? `
          <div class="crc-section">
            <div class="crc-section-title">Prospect Intel</div>
            <div class="prospect-grid">
              ${r.prospect.business_name ? `<div class="pi-item"><span class="pi-key">Business</span><span class="pi-val">${esc(r.prospect.business_name)}</span></div>` : ''}
              ${r.prospect.niche ? `<div class="pi-item"><span class="pi-key">Niche</span><span class="pi-val">${esc(r.prospect.niche)}</span></div>` : ''}
              ${r.prospect.urgency ? `<div class="pi-item"><span class="pi-key">Urgency</span><span class="pi-val urgency-${r.prospect.urgency}">${r.prospect.urgency.toUpperCase()}</span></div>` : ''}
              ${r.prospect.dream_outcome ? `<div class="pi-item pi-wide"><span class="pi-key">Dream Outcome</span><span class="pi-val">${esc(r.prospect.dream_outcome)}</span></div>` : ''}
              ${r.prospect.pain_points?.length ? `<div class="pi-item pi-wide"><span class="pi-key">Pain Points</span><span class="pi-val">${r.prospect.pain_points.map(p => esc(p)).join(' · ')}</span></div>` : ''}
              ${r.prospect.buying_signals?.length ? `<div class="pi-item pi-wide"><span class="pi-key">Buying Signals</span><span class="pi-val" style="color:var(--accent)">${r.prospect.buying_signals.map(s => esc(s)).join(' · ')}</span></div>` : ''}
            </div>
          </div>` : ''}

          <div class="crc-section">
            <div class="crc-section-title critical-title">Critical Mistake</div>
            <div class="critical-block">${esc(r.critical_mistake || 'None identified.')}</div>
          </div>

          ${wellItems ? `
          <div class="crc-section">
            <div class="crc-section-title" style="color:var(--accent)">What Went Well</div>
            <ul class="well-list">${wellItems}</ul>
          </div>` : ''}

          ${wrongItems ? `
          <div class="crc-section">
            <div class="crc-section-title" style="color:var(--hot)">What Went Wrong</div>
            <div class="wrong-list">${wrongItems}</div>
          </div>` : ''}

          ${objItems ? `
          <div class="crc-section">
            <div class="crc-section-title">Objection Playbook</div>
            <div class="obj-list">${objItems}</div>
          </div>` : ''}

          ${nextMove.action_type ? `
          <div class="crc-section next-move-section">
            <div class="crc-section-title next-move-title">Next Move</div>
            <div class="next-move-block">
              <div class="nm-row"><span class="nm-key">ACTION</span><span class="nm-val nm-action">${esc(nextMove.action_type?.toUpperCase())}</span><span class="nm-key" style="margin-left:16px">WHEN</span><span class="nm-val">${esc(nextMove.timing || '')}</span></div>
              ${nextMove.opening_line ? `<div class="nm-row"><span class="nm-key">OPEN WITH</span><div class="nm-script">"${esc(nextMove.opening_line)}"</div></div>` : ''}
              ${nextMove.key_point ? `<div class="nm-row"><span class="nm-key">KEY POINT</span><span class="nm-val">${esc(nextMove.key_point)}</span></div>` : ''}
              ${nextMove.close_to_use ? `<div class="nm-row"><span class="nm-key">CLOSE WITH</span><div class="nm-script nm-close">"${esc(nextMove.close_to_use)}"</div></div>` : ''}
              ${nextMove.materials_to_send?.length ? `<div class="nm-row"><span class="nm-key">SEND</span><span class="nm-val">${nextMove.materials_to_send.map(m => esc(m)).join(', ')}</span></div>` : ''}
            </div>
          </div>` : ''}

          ${weeklyPriority.skill ? `
          <div class="crc-section">
            <div class="crc-section-title">This Week's Drill</div>
            <div class="drill-block">
              <div class="drill-skill">${esc(weeklyPriority.skill)}</div>
              <div class="drill-text">${esc(weeklyPriority.drill || '')}</div>
              ${weeklyPriority.why_it_matters ? `<div class="drill-why">${esc(weeklyPriority.why_it_matters)}</div>` : ''}
            </div>
          </div>` : ''}

          ${r.if_i_were_on_this_call ? `
          <div class="crc-section marcus-section">
            <div class="crc-section-title marcus-title">If Marcus Were on This Call</div>
            <div class="marcus-block">${esc(r.if_i_were_on_this_call)}</div>
          </div>` : ''}

          <div class="crc-footer">
            <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px;"
              onclick="event.stopPropagation();deleteReview('${r.review_id}')">Delete Review</button>
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-4)">ID: ${r.review_id?.slice(0, 8)}</span>
          </div>

        </div>` : ''}
    </div>`;
}

function toggleReview(reviewId) {
  state.coach.expandedReviewId =
    state.coach.expandedReviewId === reviewId ? null : reviewId;
  render();
}

function renderCoachWeeklyTab() {
  const c = state.coach;

  if (c.weeklyLoading) {
    return `<div class="coach-empty">
      <div class="spinner" style="width:28px;height:28px;margin:0 auto 16px"></div>
      <p style="color:var(--text-3)">Marcus is reviewing your week...</p>
    </div>`;
  }

  if (!c.weekly) {
    return `<div class="coach-empty">
      <div class="coach-empty-icon">◎</div>
      <p>Generate your weekly training report.</p>
      <p style="color:var(--text-3);font-size:13px;margin-top:8px">Marcus reads all your calls from the past 7 days and tells you exactly what to work on.</p>
      <button class="coach-analyze-btn" style="margin-top:24px;max-width:280px" onclick="loadWeeklySummary(false)">
        <span>◎</span> Generate Weekly Report
      </button>
    </div>`;
  }

  const w = c.weekly;

  if (w.error) {
    return `<div class="coach-empty">
      <p style="color:var(--hot)">Failed to generate report: ${esc(w.error)}</p>
      <button class="mp-btn" style="margin-top:16px" onclick="loadWeeklySummary(true)">Try Again</button>
    </div>`;
  }

  if (w.calls_reviewed === 0) {
    return `<div class="coach-empty">
      <div class="coach-empty-icon">◎</div>
      <p>${esc(w.pattern_recognition || 'No calls this week.')}</p>
      <button class="mp-btn" style="margin-top:16px" onclick="coachSubtab('analyze')">Analyze a Call</button>
    </div>`;
  }

  const scoreDisplay = w.avg_score != null
    ? `<div class="weekly-score-block">
        <span class="weekly-score-num" style="color:${w.avg_score >= 7 ? 'var(--accent)' : w.avg_score >= 5 ? 'var(--warm)' : 'var(--hot)'}">${w.avg_score}</span>
        <span class="weekly-score-label">avg / 10</span>
        <span class="weekly-calls-reviewed">${w.calls_reviewed} call${w.calls_reviewed !== 1 ? 's' : ''} reviewed</span>
      </div>` : '';

  const objHtml = w.objection_of_the_week ? `
    <div class="weekly-block">
      <div class="weekly-block-title">Objection of the Week</div>
      <div class="weekly-obj-q">"${esc(w.objection_of_the_week.objection || '')}"</div>
      ${w.objection_of_the_week.script ? `<div class="weekly-obj-script">${esc(w.objection_of_the_week.script)}</div>` : ''}
    </div>` : '';

  return `
    <div class="weekly-report">
      <div class="weekly-report-header">
        ${scoreDisplay}
        <button class="btn btn-ghost" style="font-size:11px;padding:5px 12px;margin-left:auto"
          onclick="loadWeeklySummary(true)">Regenerate</button>
      </div>

      <div class="weekly-grid">
        ${w.pattern_recognition ? `
        <div class="weekly-block weekly-block-wide">
          <div class="weekly-block-title">Pattern Recognition</div>
          <div class="weekly-block-text">${esc(w.pattern_recognition)}</div>
        </div>` : ''}

        ${w.skill_gap ? `
        <div class="weekly-block">
          <div class="weekly-block-title">The Skill Gap</div>
          <div class="weekly-block-text">${esc(w.skill_gap)}</div>
        </div>` : ''}

        ${w.weekly_drill ? `
        <div class="weekly-block">
          <div class="weekly-block-title">This Week's Drill</div>
          <div class="weekly-block-text">${esc(w.weekly_drill)}</div>
        </div>` : ''}

        ${objHtml}

        ${w.hormozi_principle ? `
        <div class="weekly-block weekly-block-wide">
          <div class="weekly-block-title">Hormozi Principle of the Week</div>
          <div class="weekly-block-text">${esc(w.hormozi_principle)}</div>
        </div>` : ''}

        ${w.win_rate_insight ? `
        <div class="weekly-block">
          <div class="weekly-block-title">Win Rate Trend</div>
          <div class="weekly-block-text">${esc(w.win_rate_insight)}</div>
        </div>` : ''}

        ${w.the_one_thing ? `
        <div class="weekly-block weekly-block-one-thing">
          <div class="weekly-block-title">The One Thing</div>
          <div class="weekly-block-text">${esc(w.the_one_thing)}</div>
        </div>` : ''}
      </div>

      <div style="text-align:right;margin-top:8px;font-size:11px;color:var(--text-4);font-family:var(--font-mono)">
        Generated ${w.generated_at ? new Date(w.generated_at).toLocaleString() : '—'}
      </div>
    </div>`;
}

// ── Initial render ───────────────────────────────────────

(async () => {
  await loadAll();
  render();
})();
