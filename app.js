const API_URL = 'https://api.hyperliquid.xyz/info';
const DEX = 'xyz';
const HOURS_PER_YEAR = 24 * 365;

let rows = [];
let sortKey = 'funding';
let sortDir = 'desc';
let activeCategory = 'ALL';

const tableBody = document.getElementById('tableBody');
const summaryCards = document.getElementById('summaryCards');
const categoryTabs = document.getElementById('categoryTabs');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');

function fmtNum(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function fmtUsd(n) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return '$' + fmtNum(n, 2);
}

function fmtPct(n, decimals = 4) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%';
}

function fundingClass(annualizedPct) {
  if (annualizedPct >= 50) return 'fc-high-pos';
  if (annualizedPct > 0) return 'fc-pos';
  if (annualizedPct < -50) return 'fc-high-neg';
  if (annualizedPct < 0) return 'fc-neg';
  return 'fc-neutral';
}

async function fetchData() {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: DEX }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const [meta, ctxs] = await res.json();
  const universe = meta.universe;

  rows = universe.map((u, i) => {
    const ctx = ctxs[i] || {};
    const funding = parseFloat(ctx.funding ?? '0');
    const markPx = parseFloat(ctx.markPx ?? '0');
    const premium = parseFloat(ctx.premium ?? '0');
    const openInterest = parseFloat(ctx.openInterest ?? '0');
    const dayNtlVlm = parseFloat(ctx.dayNtlVlm ?? '0');
    const annualized = funding * HOURS_PER_YEAR * 100;
    const fullName = u.name; // e.g. "xyz:NVDA"
    const symbol = fullName.includes(':') ? fullName.split(':')[1] : fullName;
    const category = getCategory(symbol);
    const isListed = openInterest > 0 || dayNtlVlm > 0;
    return {
      fullName,
      symbol,
      category: category.key,
      categoryLabel: category.label,
      isListed,
      markPx,
      funding,
      annualized,
      premium,
      openInterest,
      openInterestUsd: openInterest * markPx,
      dayNtlVlm,
    };
  });
}

function renderCategoryTabs() {
  const listed = rows.filter(r => r.isListed);
  const upcoming = rows.filter(r => !r.isListed);
  const counts = {};
  listed.forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1; });

  const tabs = [{ key: 'ALL', label: '全部', cls: '', count: listed.length }];
  Object.values(CATEGORIES).forEach(c => {
    if (counts[c.key]) tabs.push({ key: c.key, label: c.label, cls: c.cls, count: counts[c.key] });
  });
  if (upcoming.length) {
    tabs.push({ key: 'UPCOMING', label: '即将上架', cls: 'cat-upcoming', count: upcoming.length });
  }

  categoryTabs.innerHTML = tabs.map(t => `
    <button class="cat-tab ${t.cls} ${t.key === activeCategory ? 'active' : ''}" data-cat="${t.key}">
      ${t.label} <span style="opacity:.6">(${t.count})</span>
    </button>
  `).join('');

  categoryTabs.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderCategoryTabs();
      renderTable();
    });
  });
}

function renderSummary() {
  const listed = rows.filter(r => r.isListed);
  if (!listed.length) {
    summaryCards.innerHTML = '';
    return;
  }
  const sorted = [...listed].sort((a, b) => b.annualized - a.annualized);
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];
  const avgAnnualized = listed.reduce((s, r) => s + r.annualized, 0) / listed.length;
  const totalOi = listed.reduce((s, r) => s + r.openInterestUsd, 0);
  const totalVol = listed.reduce((s, r) => s + r.dayNtlVlm, 0);

  summaryCards.innerHTML = `
    <div class="card">
      <div class="card-label">监控 Ticker 数量</div>
      <div class="card-value">${listed.length}</div>
      <div class="card-sub">Trade[XYZ] (dex: ${DEX})</div>
    </div>
    <div class="card">
      <div class="card-label">最高正费率</div>
      <div class="card-value" style="color: var(--green)">${fmtPct(highest.annualized, 2)}</div>
      <div class="card-sub">${highest.symbol}</div>
    </div>
    <div class="card">
      <div class="card-label">最高负费率</div>
      <div class="card-value" style="color: var(--red)">${fmtPct(lowest.annualized, 2)}</div>
      <div class="card-sub">${lowest.symbol}</div>
    </div>
    <div class="card">
      <div class="card-label">平均年化费率</div>
      <div class="card-value">${fmtPct(avgAnnualized, 2)}</div>
      <div class="card-sub">全市场均值</div>
    </div>
    <div class="card">
      <div class="card-label">总未平仓量</div>
      <div class="card-value">${fmtUsd(totalOi)}</div>
      <div class="card-sub">24h 总成交额 ${fmtUsd(totalVol)}</div>
    </div>
  `;
}

function getFilteredSortedRows() {
  const q = searchInput.value.trim().toUpperCase();
  let filtered;
  if (activeCategory === 'UPCOMING') {
    filtered = rows.filter(r => !r.isListed);
  } else if (activeCategory === 'ALL') {
    filtered = rows.filter(r => r.isListed);
  } else {
    filtered = rows.filter(r => r.isListed && r.category === activeCategory);
  }
  if (q) {
    filtered = filtered.filter(r => r.symbol.toUpperCase().includes(q));
  }
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (typeof av === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === 'asc' ? av - bv : bv - av;
  });
  return sorted;
}

function renderTable() {
  const data = getFilteredSortedRows();
  if (!data.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="empty-row">没有匹配的 ticker</td></tr>';
    return;
  }
  tableBody.innerHTML = data.map(r => {
    const catCls = CATEGORIES[r.category].cls;
    const detailUrl = `detail.html?symbol=${encodeURIComponent(r.symbol)}&full=${encodeURIComponent(r.fullName)}`;

    if (!r.isListed) {
      return `
        <tr>
          <td>
            <a class="ticker-cell" href="${detailUrl}">
              <span>${r.symbol}</span>
            </a>
          </td>
          <td><span class="cat-pill ${catCls}">${r.categoryLabel}</span></td>
          <td class="num">${fmtNum(r.markPx, 4)}</td>
          <td class="num">--</td>
          <td class="num">--</td>
          <td class="num">--</td>
          <td class="num">--</td>
        </tr>
      `;
    }

    const fClass = fundingClass(r.annualized);
    return `
      <tr>
        <td>
          <a class="ticker-cell" href="${detailUrl}">
            <span>${r.symbol}</span>
          </a>
        </td>
        <td><span class="cat-pill ${catCls}">${r.categoryLabel}</span></td>
        <td class="num">${fmtNum(r.markPx, 4)}</td>
        <td class="num"><span class="funding-cell ${fClass}">${fmtPct(r.funding * 100, 5)}</span></td>
        <td class="num">${fmtPct(r.annualized, 2)}</td>
        <td class="num">${fmtUsd(r.openInterestUsd)}</td>
        <td class="num">${fmtUsd(r.dayNtlVlm)}</td>
      </tr>
    `;
  }).join('');
}

function updateSortHeaders() {
  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sorted', 'asc', 'desc');
    if (th.dataset.key === sortKey) {
      th.classList.add('sorted', sortDir);
    }
  });
}

document.querySelectorAll('thead th[data-key]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'desc';
    }
    updateSortHeaders();
    renderTable();
  });
});

async function refresh() {
  try {
    statusDot.className = 'dot';
    statusText.textContent = '更新中...';
    await fetchData();
    renderCategoryTabs();
    renderSummary();
    renderTable();
    updateSortHeaders();
    statusDot.className = 'dot ok';
    const now = new Date();
    statusText.textContent = '已更新 · ' + now.toLocaleTimeString('zh-CN');
  } catch (e) {
    console.error(e);
    statusDot.className = 'dot err';
    statusText.textContent = '更新失败: ' + e.message;
  }
}

refreshBtn.addEventListener('click', refresh);
searchInput.addEventListener('input', renderTable);

// init
updateSortHeaders();
refresh();
