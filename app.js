// ---- state -----------------------------------------------------------
let DATA = null;
let ACTIVE_SYMBOL = null;
let ACTIVE_INTERVAL = '1d'; // '1d' | '1w' | '1m' | '3m' | '6m' | '1y'
let chart = null;
let candleSeries = null;
let maShortSeries = null;
let maLongSeries = null;

// ---- indicator math ----------------------------------------------------

function simpleMovingAverage(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function commodityChannelIndex(high, low, close, period) {
  const typicalPrices = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const smaTp = simpleMovingAverage(typicalPrices, period);
  const out = new Array(close.length).fill(null);
  for (let i = period - 1; i < close.length; i++) {
    const window = typicalPrices.slice(i - period + 1, i + 1);
    const mean = smaTp[i];
    const meanDeviation =
      window.reduce((sum, tp) => sum + Math.abs(tp - mean), 0) / period;
    out[i] = meanDeviation === 0 ? 0 : (typicalPrices[i] - mean) / (0.015 * meanDeviation);
  }
  return out;
}

// ---- recommendation engine ---------------------------------------------

function evaluateStrategies(series) {
  const signals = [];

  const maOn = document.getElementById('maToggle').checked;
  const cciOn = document.getElementById('cciToggle').checked;

  if (maOn) {
    const shortPeriod = Number(document.getElementById('maShort').value);
    const longPeriod = Number(document.getElementById('maLong').value);
    const shortMa = simpleMovingAverage(series.close, shortPeriod);
    const longMa = simpleMovingAverage(series.close, longPeriod);
    const i = series.close.length - 1;
    const price = series.close[i];
    const s = shortMa[i];
    const l = longMa[i];
    let vote = 0;
    let note = 'not enough history yet';
    if (s !== null && l !== null) {
      if (price > s && s > l) {
        vote = 1;
        note = `price above both averages, short above long`;
      } else if (price < s && s < l) {
        vote = -1;
        note = `price below both averages, short below long`;
      } else {
        vote = 0;
        note = 'averages mixed with price, no clean trend';
      }
    }
    signals.push({
      name: `Moving averages (${shortPeriod}/${longPeriod})`,
      vote,
      note,
    });
  }

  if (cciOn) {
    const period = Number(document.getElementById('cciPeriod').value);
    const cci = commodityChannelIndex(series.high, series.low, series.close, period);
    const value = cci[cci.length - 1];
    let vote = 0;
    let note = 'not enough history yet';
    if (value !== null) {
      if (value <= -100) {
        vote = 1;
        note = `CCI at ${value.toFixed(0)}, in oversold territory`;
      } else if (value >= 100) {
        vote = -1;
        note = `CCI at ${value.toFixed(0)}, in overbought territory`;
      } else {
        vote = 0;
        note = `CCI at ${value.toFixed(0)}, no extreme reading`;
      }
    }
    signals.push({ name: `CCI (${period})`, vote, note });
  }

  return signals;
}

function scoreToRecommendation(signals) {
  if (signals.length === 0) {
    return { label: 'HOLD', tone: 'hold', detail: 'Turn on a strategy to get a read.' };
  }
  const average = signals.reduce((sum, s) => sum + s.vote, 0) / signals.length;
  if (average >= 0.5) return { label: 'BUY', tone: 'buy', detail: 'Selected strategies line up bullish.' };
  if (average > 0) return { label: 'WATCH', tone: 'watch', detail: 'Leaning bullish, not a full alignment.' };
  if (average === 0) return { label: 'HOLD', tone: 'hold', detail: 'Signals are mixed or flat.' };
  if (average > -0.5) return { label: 'WATCH', tone: 'watch', detail: 'Leaning bearish, not a full alignment.' };
  return { label: 'SELL', tone: 'sell', detail: 'Selected strategies line up bearish.' };
}

// ---- rendering -----------------------------------------------------------

function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // move to Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(
    ((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function bucketKey(dateStr, interval) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0 to 11
  switch (interval) {
    case '1w':
      return isoWeekKey(dateStr);
    case '1m':
      return `${year}-${String(month + 1).padStart(2, '0')}`;
    case '3m':
      return `${year}-Q${Math.floor(month / 3) + 1}`;
    case '6m':
      return `${year}-H${month < 6 ? 1 : 2}`;
    case '1y':
      return `${year}`;
    default:
      return dateStr;
  }
}

// Turns the daily series into weekly, monthly, quarterly, half year, or
// yearly bars, all derived from the same daily history, no extra data
// needed. '1d' returns the series untouched.
function aggregateSeries(series, interval) {
  if (interval === '1d') return series;

  const buckets = new Map();
  const order = [];

  for (let i = 0; i < series.dates.length; i++) {
    const key = bucketKey(series.dates[i], interval);
    if (!buckets.has(key)) {
      buckets.set(key, {
        date: series.dates[i], // label the bar with the period's first day
        open: series.open[i],
        high: series.high[i],
        low: series.low[i],
        close: series.close[i],
        volume: series.volume[i] || 0,
      });
      order.push(key);
    } else {
      const bucket = buckets.get(key);
      bucket.high = Math.max(bucket.high, series.high[i]);
      bucket.low = Math.min(bucket.low, series.low[i]);
      bucket.close = series.close[i];
      bucket.volume += series.volume[i] || 0;
    }
  }

  return {
    dates: order.map((k) => buckets.get(k).date),
    open: order.map((k) => buckets.get(k).open),
    high: order.map((k) => buckets.get(k).high),
    low: order.map((k) => buckets.get(k).low),
    close: order.map((k) => buckets.get(k).close),
    volume: order.map((k) => buckets.get(k).volume),
  };
}function renderTickerRail() {
  const rail = document.getElementById('tickerRail');
  rail.innerHTML = '';
  Object.keys(DATA.tickers).sort().forEach((symbol) => {
    const entry = DATA.tickers[symbol];
    const button = document.createElement('button');
    button.className = 'tickerRail__item' + (symbol === ACTIVE_SYMBOL ? ' is-active' : '');
    const changeClass = entry.stats.change >= 0 ? 'tickerRail__change--up' : 'tickerRail__change--down';
    button.innerHTML = `<span>${symbol}</span><span class="${changeClass}">${entry.stats.change_pct >= 0 ? '+' : ''}${formatNumber(entry.stats.change_pct)}%</span>`;
    button.addEventListener('click', () => selectSymbol(symbol));
    rail.appendChild(button);
  });
}

function renderStatGrid(stats) {
  const grid = document.getElementById('statGrid');
  const cells = [
    ['Period high', formatNumber(stats.period_high)],
    ['Period low', formatNumber(stats.period_low)],
    ['52 week high', formatNumber(stats.high_52w)],
    ['52 week low', formatNumber(stats.low_52w)],
  ];
  grid.innerHTML = cells
    .map(([label, value]) => `<div class="statGrid__cell"><span class="statGrid__label">${label}</span><span class="statGrid__value">${value}</span></div>`)
    .join('');
}

function renderSignals(signals, recommendation) {
  const list = document.getElementById('signalList');
  if (signals.length === 0) {
    list.innerHTML = '<li><span>No strategy selected</span></li>';
  } else {
    list.innerHTML = signals
      .map((s) => `<li><span>${s.name}</span><span class="value">${s.note}</span></li>`)
      .join('');
  }

  const box = document.getElementById('recommendation');
  box.className = `recommendation recommendation--${recommendation.tone}`;
  box.querySelector('.recommendation__label').textContent = recommendation.label;
  document.getElementById('recommendationDetail').textContent = recommendation.detail;
}

function ensureChart() {
  if (chart) return;
  chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: {
      background: { color: '#10141B' },
      textColor: '#8993A6',
      fontFamily: 'IBM Plex Mono, monospace',
    },
    grid: {
      vertLines: { color: '#1C222D' },
      horzLines: { color: '#1C222D' },
    },
    rightPriceScale: { borderColor: '#262D3A' },
    timeScale: {
      borderColor: '#262D3A',
      rightOffset: 0,
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
    },
  });
  candleSeries = chart.addCandlestickSeries({
    upColor: '#3DDC97',
    downColor: '#FF6B6B',
    borderVisible: false,
    wickUpColor: '#3DDC97',
    wickDownColor: '#FF6B6B',
  });
  maShortSeries = chart.addLineSeries({ color: '#E8B84B', lineWidth: 1 });
  maLongSeries = chart.addLineSeries({ color: '#8993A6', lineWidth: 1 });

  new ResizeObserver(() => {
    chart.applyOptions({ width: document.getElementById('chart').clientWidth });
  }).observe(document.getElementById('chart'));
}

function renderChart(series) {
  ensureChart();
  const candles = series.dates.map((d, i) => ({
    time: d,
    open: series.open[i],
    high: series.high[i],
    low: series.low[i],
    close: series.close[i],
  }));
  candleSeries.setData(candles);

  const shortPeriod = Number(document.getElementById('maShort').value);
  const longPeriod = Number(document.getElementById('maLong').value);
  const shortMa = simpleMovingAverage(series.close, shortPeriod);
  const longMa = simpleMovingAverage(series.close, longPeriod);

  maShortSeries.setData(
    series.dates.map((d, i) => ({ time: d, value: shortMa[i] })).filter((p) => p.value !== null)
  );
  maLongSeries.setData(
    series.dates.map((d, i) => ({ time: d, value: longMa[i] })).filter((p) => p.value !== null)
  );

  chart.timeScale().fitContent();
}

function renderHeader(symbol, stats) {
  document.getElementById('activeSymbol').textContent = symbol;
  document.getElementById('activePrice').textContent = formatNumber(stats.last_close);
  const changeEl = document.getElementById('activeChange');
  const sign = stats.change >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${formatNumber(stats.change)} (${sign}${formatNumber(stats.change_pct)}%)`;
  changeEl.className = 'change ' + (stats.change >= 0 ? 'change--up' : 'change--down');
}

function selectSymbol(symbol) {
  ACTIVE_SYMBOL = symbol;
  renderTickerRail();
  update();
}

function update() {
  const entry = DATA.tickers[ACTIVE_SYMBOL];
  const fullSeries = entry.series;
  const displaySeries = aggregateSeries(fullSeries, ACTIVE_INTERVAL);

  renderHeader(ACTIVE_SYMBOL, entry.stats);
  renderStatGrid(entry.stats);
  renderChart(displaySeries);

  const signals = evaluateStrategies(displaySeries);
  const recommendation = scoreToRecommendation(signals);
  renderSignals(signals, recommendation);
}

function wireControls() {
  ['maToggle', 'maShort', 'maLong', 'cciToggle', 'cciPeriod'].forEach((id) => {
    document.getElementById(id).addEventListener('input', update);
    document.getElementById(id).addEventListener('change', update);
  });

  document.querySelectorAll('.rangeBtn').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rangeBtn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      ACTIVE_INTERVAL = btn.dataset.interval;
      update();
    });
  });
}

async function init() {
  const response = await fetch('data/data.json', { cache: 'no-store' });
  DATA = await response.json();

  const updatedLabel = DATA.generated_at === 'SAMPLE-DATA-NOT-REAL'
    ? 'sample data, run the fetch script to load real prices'
    : `updated ${DATA.generated_at}`;
  document.getElementById('updatedAt').textContent = updatedLabel;

  ACTIVE_SYMBOL = Object.keys(DATA.tickers).sort()[0];
  renderTickerRail();
  wireControls();
  update();
}

init();
