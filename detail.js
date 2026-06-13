const API_URL = 'https://api.hyperliquid.xyz/info';
const HOURS_PER_YEAR = 24 * 365;

const params = new URLSearchParams(location.search);
const symbol = params.get('symbol') || '';
const fullName = params.get('full') || ('xyz:' + symbol);

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statCards = document.getElementById('statCards');
const rangeTabs = document.getElementById('rangeTabs');

let chartInstance = null;
let currentRange = '7d';

const RANGES = {
  '24h': { ms: 24 * 60 * 60 * 1000, tickLimit: 8 },
  '7d': { ms: 7 * 24 * 60 * 60 * 1000, tickLimit: 8 },
  '30d': { ms: 30 * 24 * 60 * 60 * 1000, tickLimit: 10 },
};

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

function init() {
  document.getElementById('symbolTitle').textContent = symbol;
  const category = getCategory(symbol);
  const pill = document.getElementById('categoryPill');
  pill.textContent = category.label;
  pill.classList.add(category.cls);

  document.getElementById('tradeLink').href = 'https://app.trade.xyz/?market=' + encodeURIComponent(symbol);

  rangeTabs.querySelectorAll('.range-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      rangeTabs.querySelectorAll('.range-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      loadChart();
    });
  });
}

async function loadCurrentStats() {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const [meta, ctxs] = await res.json();
    const idx = meta.universe.findIndex(u => u.name === fullName);
    if (idx === -1) throw new Error('未找到该 ticker');
    const ctx = ctxs[idx];
    const funding = parseFloat(ctx.funding ?? '0');
    const markPx = parseFloat(ctx.markPx ?? '0');
    const openInterest = parseFloat(ctx.openInterest ?? '0');
    const dayNtlVlm = parseFloat(ctx.dayNtlVlm ?? '0');
    const annualized = funding * HOURS_PER_YEAR * 100;

    statCards.innerHTML = `
      <div class="card">
        <div class="card-label">标记价格</div>
        <div class="card-value">${fmtNum(markPx, 4)}</div>
      </div>
      <div class="card">
        <div class="card-label">当前资金费率 (1h)</div>
        <div class="card-value" style="color: ${funding >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(funding * 100, 5)}</div>
      </div>
      <div class="card">
        <div class="card-label">当前年化费率</div>
        <div class="card-value" style="color: ${annualized >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(annualized, 2)}</div>
      </div>
      <div class="card">
        <div class="card-label">未平仓量</div>
        <div class="card-value">${fmtUsd(openInterest * markPx)}</div>
      </div>
      <div class="card">
        <div class="card-label">24h 成交额</div>
        <div class="card-value">${fmtUsd(dayNtlVlm)}</div>
      </div>
    `;

    statusDot.className = 'dot ok';
    statusText.textContent = '已更新 · ' + new Date().toLocaleTimeString('zh-CN');
  } catch (e) {
    console.error(e);
    statusDot.className = 'dot err';
    statusText.textContent = '加载失败: ' + e.message;
  }
}

const crosshairPlugin = {
  id: 'crosshair',
  afterDraw(chart) {
    const active = chart.tooltip && chart.tooltip._active;
    if (active && active.length) {
      const ctx = chart.ctx;
      const x = active[0].element.x;
      const top = chart.scales.y.top;
      const bottom = chart.scales.y.bottom;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(240, 185, 11, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  },
};

async function loadChart() {
  const range = RANGES[currentRange];
  const startTime = Date.now() - range.ms;

  try {
    const [fundingRes, candleRes] = await Promise.all([
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fundingHistory', coin: fullName, startTime }),
      }),
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'candleSnapshot', req: { coin: fullName, interval: '1h', startTime } }),
      }),
    ]);
    if (!fundingRes.ok) throw new Error('HTTP ' + fundingRes.status);
    const history = await fundingRes.json();
    const candles = candleRes.ok ? await candleRes.json() : [];

    const priceByHour = new Map();
    candles.forEach(c => {
      const hour = Math.floor(c.t / 3600000);
      priceByHour.set(hour, parseFloat(c.c));
    });

    const labels = history.map(h => {
      const d = new Date(h.time);
      if (currentRange === '24h') {
        return String(d.getHours()).padStart(2, '0') + ':00';
      }
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':00';
    });
    const annualizedSeries = history.map(h => parseFloat(h.fundingRate) * HOURS_PER_YEAR * 100);
    const priceSeries = history.map(h => {
      const hour = Math.floor(h.time / 3600000);
      return priceByHour.has(hour) ? priceByHour.get(hour) : null;
    });

    const ctx = document.getElementById('fundingChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '年化资金费率 (%)',
            data: annualizedSeries,
            borderColor: '#f0b90b',
            backgroundColor: 'rgba(240, 185, 11, 0.08)',
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 1.5,
            yAxisID: 'y',
          },
          {
            label: '标记价格',
            data: priceSeries,
            borderColor: '#7da9ff',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            borderWidth: 1.5,
            yAxisID: 'y1',
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { maxTicksLimit: range.tickLimit, font: { size: 10 }, color: '#787b86' },
            grid: { color: '#1c2030' },
          },
          y: {
            position: 'left',
            ticks: { callback: v => v + '%', color: '#f0b90b' },
            grid: { color: '#1c2030' },
            title: { display: true, text: '年化资金费率', color: '#f0b90b', font: { size: 11 } },
          },
          y1: {
            position: 'right',
            ticks: { color: '#7da9ff' },
            grid: { display: false },
            title: { display: true, text: '标记价格', color: '#7da9ff', font: { size: 11 } },
          },
        },
        plugins: {
          legend: { display: true, labels: { color: '#d1d4dc', usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            backgroundColor: '#161a25',
            borderColor: '#232733',
            borderWidth: 1,
            titleColor: '#d1d4dc',
            bodyColor: '#d1d4dc',
            callbacks: {
              label: (item) => {
                if (item.dataset.yAxisID === 'y') {
                  return '年化资金费率: ' + item.formattedValue + '%';
                }
                return '标记价格: ' + (item.raw == null ? '--' : fmtNum(item.raw, 4));
              },
            },
          },
        },
      },
      plugins: [crosshairPlugin],
    });
  } catch (e) {
    console.error(e);
  }
}

init();
loadCurrentStats();
loadChart();
