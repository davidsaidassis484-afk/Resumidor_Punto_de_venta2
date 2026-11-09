(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);

  const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const money = n => nf.format(Math.round(n || 0));
  const raw = n => String(Math.round(n || 0));

  function pctFmt(v) {
    if (!isFinite(v)) v = 0;
    return (v * 100).toFixed(1).replace('.', ',') + ' %';
  }

  function esErrorDia(d) {
    // Un día es error si la diferencia total (facturado - pagado) no es cero.
    return Math.abs(d.difTotal) > 0.5;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function fmtDia(iso) {
    const p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }
  function fmtDiaCorto(iso) {
    const p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : iso;
  }

  function num(v) {
    if (v == null) return 0;
    let s = String(v).trim();
    if (!s) return 0;
    s = s.replace(/[\s\u00A0]/g, '');
    const neg = /^-/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/[^\d.,]/g, '');
    if (!s) return 0;
    if (s.indexOf(',') > -1) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    if (isNaN(n)) return 0;
    const out = neg ? -n : n;
    return out === 0 ? 0 : out;
  }

  function toDia(v) {
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    return s.slice(0, 10);
  }

  function parseCSV(text, delim) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else q = false;
        } else field += c;
      } else if (c === '"') {
        q = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c === '\r') {
        /* ignorar */
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function detectDelim(text) {
    const line = (text.split(/\r?\n/)[0] || '');
    const c = (line.match(/,/g) || []).length;
    const s = (line.match(/;/g) || []).length;
    return s > c ? ';' : ',';
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  const state = {
    groups: [],
    q: '',
    sort: { key: 'pdv', dir: 1 },
    expanded: new Set(),
    fileName: ''
  };

  /* =========================================================
     Carga y agrupación
     ========================================================= */
  function loadData(text, fileName) {
    text = String(text).replace(/^\uFEFF/, '');
    const delim = detectDelim(text);

    const rawRows = parseCSV(text, delim)
      .filter(r => r.some(c => String(c).trim() !== ''));

    if (rawRows.length < 2) throw new Error('El archivo no contiene datos suficientes.');

    const header = rawRows[0].map(h => String(h).replace(/^\uFEFF/, '').trim().toLowerCase());
    const idx = name => header.indexOf(name);

    const i = {
      pdv:   idx('pdv'),
      fecha: idx('fecha'),
      vp:    idx('venta_pagada'),
      pp:    idx('propina_pagada'),
      vb:    idx('venta_bruta'),
      tp:    idx('total_pagado')
    };

    if (i.pdv < 0 || i.fecha < 0 || i.vp < 0) {
      throw new Error('Faltan columnas obligatorias en el CSV: "pdv", "fecha" y "venta_pagada".');
    }

    const map = new Map();

    for (let k = 1; k < rawRows.length; k++) {
      const r = rawRows[k];
      const pdv = String(r[i.pdv] == null ? '' : r[i.pdv]).trim();
      const dia = toDia(r[i.fecha]);
      if (!pdv || !dia) continue;

      const vp = num(r[i.vp]);
      const pp = i.pp >= 0 ? num(r[i.pp]) : 0;
      const vb = i.vb >= 0 ? num(r[i.vb]) : vp;
      const tp = i.tp >= 0 ? num(r[i.tp]) : (vp + pp);

      let g = map.get(pdv);
      if (!g) {
        g = {
          pdv, dias: new Map(),
          registros: 0, ventaPagada: 0, propinaPagada: 0, ventaBruta: 0, totalPagado: 0
        };
        map.set(pdv, g);
      }
      g.registros++;
      g.ventaPagada   += vp;
      g.propinaPagada += pp;
      g.ventaBruta    += vb;
      g.totalPagado   += tp;

      let d = g.dias.get(dia);
      if (!d) {
        d = { dia, registros: 0, ventaPagada: 0, propinaPagada: 0, ventaBruta: 0, totalPagado: 0 };
        g.dias.set(dia, d);
      }
      d.registros++;
      d.ventaPagada   += vp;
      d.propinaPagada += pp;
      d.ventaBruta    += vb;
      d.totalPagado   += tp;
    }

    if (!map.size) throw new Error('No se encontraron filas válidas con punto de venta y fecha.');

    state.groups = [...map.values()].map(g => {
      g.diasCount       = g.dias.size;
      g.diasList        = [...g.dias.keys()].sort();
      g.difVentaPropina = g.ventaPagada - g.propinaPagada;
      g.difTotal        = g.ventaBruta - g.ventaPagada;
      g.diasConError    = 0;
      g.diasErrorList   = [];

      for (const d of g.dias.values()) {
        d.difVentaPropina = d.ventaPagada - d.propinaPagada;
        d.difTotal        = d.ventaBruta - d.ventaPagada;
        d.esError         = esErrorDia(d);
        if (d.esError) {
          g.diasConError++;
          g.diasErrorList.push(d.dia);
        }
      }

      g.diasErrorList.sort();
      g.pctError = g.diasCount ? g.diasConError / g.diasCount : 0;
      return g;
    });

    state.expanded.clear();
    state.q = '';
    state.fileName = fileName || '';
    const s = $('#search');
    if (s) s.value = '';

    $('#loader').hidden = true;
    $('#app').hidden = false;
    $('#error').hidden = true;
    render();
  }

  /* =========================================================
     Filtro / orden / totales
     ========================================================= */
  function getRows() {
    const q = state.q;
    let list = state.groups.filter(g => !q || g.pdv.toLowerCase().indexOf(q) > -1);
    const { key, dir } = state.sort;
    list = list.slice().sort((a, b) => {
      const va = a[key], vb = b[key];
      if (typeof va === 'string') return va.localeCompare(vb, 'es') * dir;
      return (va - vb) * dir;
    });
    return list;
  }

  function totals(rows) {
    const t = {
      registros: 0,
      ventaPagada: 0,
      propinaPagada: 0,
      ventaBruta: 0,
      totalPagado: 0,
      dias: new Set(),
      pdvDias: 0,
      diasConError: 0,
      errorDates: new Set()
    };

    for (const g of rows) {
      t.registros     += g.registros;
      t.ventaPagada   += g.ventaPagada;
      t.propinaPagada += g.propinaPagada;
      t.ventaBruta    += g.ventaBruta;
      t.totalPagado   += g.totalPagado;
      t.pdvDias       += g.diasCount;
      t.diasConError  += g.diasConError;
      for (const d of g.diasList) t.dias.add(d);
      for (const d of g.diasErrorList) t.errorDates.add(d);
    }

    t.difVentaPropina = t.ventaPagada - t.propinaPagada;
    t.difTotal        = t.ventaBruta - t.ventaPagada;
    t.pctError        = t.pdvDias ? t.diasConError / t.pdvDias : 0;
    return t;
  }

  /* =========================================================
     Render
     ========================================================= */
  function cellDif(v) {
    return '<td class="num' + (v < 0 ? ' neg' : '') + '">' + money(v) + '</td>';
  }

  function chipsError(dias) {
    if (!dias || !dias.length) return '<span class="chip-ok">—</span>';
    return dias.map(d => '<span class="chip-err">' + esc(fmtDiaCorto(d)) + '</span>').join('');
  }

  function rowHTML(g) {
    const open = state.expanded.has(g.pdv);
    const diasTxt = g.diasList.map(fmtDiaCorto).join(' · ');

    let html =
      '<tr class="main' + (open ? ' open' : '') + '" data-pdv="' + esc(g.pdv) + '">' +
        '<td class="pdv"><span class="caret">' + (open ? '▾' : '▸') + '</span>' + esc(g.pdv) + '</td>' +
        '<td class="dias"><span class="badge">' + g.diasCount + '</span><span class="sub-dias">' + esc(diasTxt) + '</span></td>' +
        '<td class="num">' + g.diasConError + '</td>' +
        '<td class="errdias">' + chipsError(g.diasErrorList) + '</td>' +
        '<td class="num' + (g.pctError > 0 ? ' pct-pos' : '') + '">' + pctFmt(g.pctError) + '</td>' +
        '<td class="num">' + g.registros + '</td>' +
        '<td class="num strong">' + money(g.ventaPagada) + '</td>' +
        '<td class="num">' + money(g.propinaPagada) + '</td>' +
        cellDif(g.difVentaPropina) +
        '<td class="num">' + money(g.ventaBruta) + '</td>' +
        cellDif(g.difTotal) +
        '<td class="num">' + money(g.totalPagado) + '</td>' +
      '</tr>';

    if (open) html += detailRowHTML(g);
    return html;
  }

  function detailRowHTML(g) {
    const dias = [...g.dias.values()].sort((a, b) => a.dia.localeCompare(b.dia));
    let body = '';

    for (const d of dias) {
      body +=
        '<tr class="' + (d.esError ? 'err' : '') + '">' +
          '<td>' + fmtDia(d.dia) + '</td>' +
          '<td>' + (d.esError ? 'Sí' : 'No') + '</td>' +
          '<td class="num">' + d.registros + '</td>' +
          '<td class="num">' + money(d.ventaPagada) + '</td>' +
          '<td class="num">' + money(d.propinaPagada) + '</td>' +
          '<td class="num' + (d.difVentaPropina < 0 ? ' neg' : '') + '">' + money(d.difVentaPropina) + '</td>' +
          '<td class="num">' + money(d.ventaBruta) + '</td>' +
          '<td class="num' + (d.difTotal < 0 ? ' neg' : '') + '">' + money(d.difTotal) + '</td>' +
          '<td class="num">' + money(d.totalPagado) + '</td>' +
        '</tr>';
    }

    return '<tr class="detail"><td colspan="12"><div class="detail-wrap">' +
      '<div class="detail-title">Detalle por día — ' + esc(g.pdv) + '</div>' +
      '<table class="sub"><thead><tr>' +
        '<th>Día</th><th>Error</th><th class="num">Registros</th><th class="num">Venta pagada</th>' +
        '<th class="num">Propina pagada</th><th class="num">Dif. venta − propina</th>' +
        '<th class="num">Venta bruta</th><th class="num">Diferencia total</th><th class="num">Total pagado</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>' +
      '</div></td></tr>';
  }

  function totalsRowHTML(rows) {
    const t = totals(rows);
    const errDates = [...t.errorDates].sort();
    const errCell = errDates.length
      ? errDates.map(d => '<span class="chip-err">' + esc(fmtDiaCorto(d)) + '</span>').join('')
      : '<span class="chip-ok">—</span>';

    return '<tr>' +
      '<td>TOTAL (' + rows.length + ' punto' + (rows.length === 1 ? '' : 's') + ')</td>' +
      '<td class="dias">' + t.pdvDias + '</td>' +
      '<td class="num">' + t.diasConError + '</td>' +
      '<td class="errdias">' + errCell + '</td>' +
      '<td class="num' + (t.pctError > 0 ? ' pct-pos' : '') + '">' + pctFmt(t.pctError) + '</td>' +
      '<td class="num">' + t.registros + '</td>' +
      '<td class="num">' + money(t.ventaPagada) + '</td>' +
      '<td class="num">' + money(t.propinaPagada) + '</td>' +
      '<td class="num' + (t.difVentaPropina < 0 ? ' neg' : '') + '">' + money(t.difVentaPropina) + '</td>' +
      '<td class="num">' + money(t.ventaBruta) + '</td>' +
      '<td class="num' + (t.difTotal < 0 ? ' neg' : '') + '">' + money(t.difTotal) + '</td>' +
      '<td class="num">' + money(t.totalPagado) + '</td>' +
    '</tr>';
  }

  function renderCards(rows) {
    const t = totals(rows);
    const cards = [
      { k: 'Venta pagada',            v: '$ ' + money(t.ventaPagada),     s: 'Suma de venta_pagada' },
      { k: 'Propina pagada',          v: '$ ' + money(t.propinaPagada),   s: 'Suma de propina_pagada' },
      { k: 'Dif. venta − propina',    v: '$ ' + money(t.difVentaPropina), s: 'Venta pagada − propina' },
      { k: 'Venta bruta (facturado)', v: '$ ' + money(t.ventaBruta),      s: 'Suma de venta_bruta' },
      { k: 'Diferencia total',        v: '$ ' + money(t.difTotal),        s: 'Facturado − pagado' },
      { k: '% Error en días',         v: pctFmt(t.pctError),              s: t.diasConError + ' de ' + t.pdvDias + ' días con diferencia' },
      { k: 'Puntos de venta',         v: String(rows.length),             s: t.registros + ' registros · ' + t.dias.size + ' días únicos' }
    ];

    $('#cards').innerHTML = cards.map(c =>
      '<div class="card"><div class="k">' + esc(c.k) + '</div>' +
      '<div class="v">' + esc(c.v) + '</div>' +
      '<div class="s">' + esc(c.s) + '</div></div>'
    ).join('');
  }

  function updateSortIndicators() {
    document.querySelectorAll('th[data-sort]').forEach(th => {
      const isCur = th.dataset.sort === state.sort.key;
      th.classList.toggle('sorted', isCur);
      th.dataset.dir = isCur ? (state.sort.dir > 0 ? 'asc' : 'desc') : '';
    });
  }

  function render() {
    const rows = getRows();
    const tbody = $('#tbody');

    tbody.innerHTML = rows.length
      ? rows.map(rowHTML).join('')
      : '<tr><td colspan="12" class="empty">No hay puntos de venta que coincidan con la búsqueda.</td></tr>';

    $('#tfoot').innerHTML = rows.length ? totalsRowHTML(rows) : '';

    tbody.querySelectorAll('tr.main').forEach(tr => {
      tr.addEventListener('click', () => {
        const p = tr.dataset.pdv;
        if (state.expanded.has(p)) state.expanded.delete(p);
        else state.expanded.add(p);
        render();
      });
    });

    renderCards(rows);
    updateSortIndicators();
  }

  /* =========================================================
     Exportar CSV
     ========================================================= */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSV() {
    const rows = getRows();
    if (!rows.length) { alert('No hay datos para exportar.'); return; }

    const t = totals(rows);
    const lines = [];

    lines.push(csvCell('RESUMEN POR PUNTO DE VENTA'));
    lines.push([
      'Punto de venta', 'Días', 'Días con error', 'Fechas con error', '% error', 'Fechas',
      'Registros', 'Venta pagada', 'Propina pagada', 'Dif. venta - propina',
      'Venta bruta', 'Diferencia total', 'Total pagado'
    ].map(csvCell).join(','));

    rows.forEach(g => {
      lines.push([
        g.pdv,
        g.diasCount,
        g.diasConError,
        g.diasErrorList.map(fmtDia).join(' | '),
        pctFmt(g.pctError),
        g.diasList.map(fmtDia).join(' | '),
        g.registros,
        raw(g.ventaPagada),
        raw(g.propinaPagada),
        raw(g.difVentaPropina),
        raw(g.ventaBruta),
        raw(g.difTotal),
        raw(g.totalPagado)
      ].map(csvCell).join(','));
    });

    lines.push([
      'TOTAL',
      t.pdvDias,
      t.diasConError,
      [...t.errorDates].sort().map(fmtDia).join(' | '),
      pctFmt(t.pctError),
      '',
      t.registros,
      raw(t.ventaPagada),
      raw(t.propinaPagada),
      raw(t.difVentaPropina),
      raw(t.ventaBruta),
      raw(t.difTotal),
      raw(t.totalPagado)
    ].map(csvCell).join(','));

    lines.push('');
    lines.push('');
    lines.push(csvCell('DETALLE POR PUNTO DE VENTA Y DÍA'));
    lines.push([
      'Punto de venta', 'Día', 'Error', 'Registros', 'Venta pagada',
      'Propina pagada', 'Dif. venta - propina', 'Venta bruta',
      'Diferencia total', 'Total pagado'
    ].map(csvCell).join(','));

    rows.forEach(g => {
      [...g.dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)).forEach(d => {
        lines.push([
          g.pdv,
          fmtDia(d.dia),
          d.esError ? 'SI' : 'NO',
          d.registros,
          raw(d.ventaPagada),
          raw(d.propinaPagada),
          raw(d.difVentaPropina),
          raw(d.ventaBruta),
          raw(d.difTotal),
          raw(d.totalPagado)
        ].map(csvCell).join(','));
      });
    });

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    download(blob, 'resumen-puntos-de-venta.csv');
  }

  /* =========================================================
     Exportar Word
     ========================================================= */
  function exportWord() {
    const rows = getRows();
    if (!rows.length) { alert('No hay datos para exportar.'); return; }

    const t = totals(rows);
    const dias = [...t.dias].sort();
    const fechaGen = new Date().toLocaleString('es-CO');

    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
      '<title>Resumen por punto de venta</title><style>' +
      '@page{size:A4 landscape;mso-page-orientation:landscape;margin:1.2cm;}' +
      'body{font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#111;}' +
      'h1{font-size:16pt;margin:0 0 2pt;color:#0f766e;}' +
      'h2{font-size:12pt;margin:16pt 0 6pt;color:#0f766e;border-bottom:1pt solid #cbd5e1;padding-bottom:3pt;}' +
      'h3{font-size:10.5pt;margin:10pt 0 3pt;}' +
      'p.meta{font-size:9pt;color:#555;margin:0 0 10pt;}' +
      'table{border-collapse:collapse;width:100%;margin:0 0 10pt;}' +
      'th,td{border:0.5pt solid #9aa5b1;padding:3pt 5pt;font-size:8.5pt;vertical-align:top;}' +
      'th{background:#e6f2f0;text-align:left;}' +
      'td.n{text-align:right;}' +
      'td.err{color:#991b1b;font-weight:bold;}' +
      'tr.tot td{font-weight:bold;background:#f1f5f9;}' +
      'tr.errrow td{background:#fef2f2;}' +
      '.small{font-size:8pt;color:#666;font-weight:normal;}' +
      '</style></head><body>';

    html += '<h1>Resumen por punto de venta</h1>';
    html += '<p class="meta">Generado: ' + esc(fechaGen) +
      (state.fileName ? ' · Archivo: ' + esc(state.fileName) : '') +
      ' · Puntos de venta: ' + rows.length +
      ' · Días únicos: ' + dias.length + (dias.length ? ' (' + dias.map(fmtDia).join(', ') + ')' : '') +
      ' · Valores en COP</p>';

    html += '<h2>Resumen general</h2><table><thead><tr>' +
      '<th>Punto de venta</th><th>Días</th><th>Días error</th><th>Fechas con error</th><th>% error</th>' +
      '<th>Registros</th><th>Venta pagada</th><th>Propina pagada</th>' +
      '<th>Dif. venta − propina</th><th>Venta bruta</th>' +
      '<th>Diferencia total</th><th>Total pagado</th></tr></thead><tbody>';

    rows.forEach(g => {
      const fechasErr = g.diasErrorList.length
        ? g.diasErrorList.map(fmtDia).join(', ')
        : '—';
      html += '<tr>' +
        '<td>' + esc(g.pdv) + '</td>' +
        '<td class="n">' + g.diasCount + '</td>' +
        '<td class="n">' + g.diasConError + '</td>' +
        '<td class="' + (g.diasErrorList.length ? 'err' : '') + '">' + esc(fechasErr) + '</td>' +
        '<td class="n">' + pctFmt(g.pctError) + '</td>' +
        '<td class="n">' + g.registros + '</td>' +
        '<td class="n">' + money(g.ventaPagada) + '</td>' +
        '<td class="n">' + money(g.propinaPagada) + '</td>' +
        '<td class="n">' + money(g.difVentaPropina) + '</td>' +
        '<td class="n">' + money(g.ventaBruta) + '</td>' +
        '<td class="n">' + money(g.difTotal) + '</td>' +
        '<td class="n">' + money(g.totalPagado) + '</td>' +
        '</tr>';
    });

    const errDatesTot = [...t.errorDates].sort();
    html += '<tr class="tot"><td>TOTAL</td>' +
      '<td class="n">' + t.pdvDias + '</td>' +
      '<td class="n">' + t.diasConError + '</td>' +
      '<td class="err">' + (errDatesTot.length ? errDatesTot.map(fmtDia).join(', ') : '—') + '</td>' +
      '<td class="n">' + pctFmt(t.pctError) + '</td>' +
      '<td class="n">' + t.registros + '</td>' +
      '<td class="n">' + money(t.ventaPagada) + '</td>' +
      '<td class="n">' + money(t.propinaPagada) + '</td>' +
      '<td class="n">' + money(t.difVentaPropina) + '</td>' +
      '<td class="n">' + money(t.ventaBruta) + '</td>' +
      '<td class="n">' + money(t.difTotal) + '</td>' +
      '<td class="n">' + money(t.totalPagado) + '</td></tr>';
    html += '</tbody></table>';

    html += '<h2>Detalle por punto de venta y día</h2>';

    rows.forEach(g => {
      html += '<h3>' + esc(g.pdv) + ' <span class="small">(' + g.diasCount +
        (g.diasCount === 1 ? ' día' : ' días') + ' · ' + g.registros +
        ' registros · ' + g.diasConError + ' día(s) con error · ' +
        pctFmt(g.pctError) + ')' +
        (g.diasErrorList.length ? ' — Errores: ' + g.diasErrorList.map(fmtDia).join(', ') : '') +
        '</span></h3>';

      html += '<table><thead><tr><th>Día</th><th>Error</th><th>Registros</th>' +
        '<th>Venta pagada</th><th>Propina pagada</th><th>Dif. venta − propina</th>' +
        '<th>Venta bruta</th><th>Diferencia total</th><th>Total pagado</th>' +
        '</tr></thead><tbody>';

      [...g.dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)).forEach(d => {
        html += '<tr class="' + (d.esError ? 'errrow' : '') + '">' +
          '<td>' + fmtDia(d.dia) + '</td>' +
          '<td>' + (d.esError ? 'Sí' : 'No') + '</td>' +
          '<td class="n">' + d.registros + '</td>' +
          '<td class="n">' + money(d.ventaPagada) + '</td>' +
          '<td class="n">' + money(d.propinaPagada) + '</td>' +
          '<td class="n">' + money(d.difVentaPropina) + '</td>' +
          '<td class="n">' + money(d.ventaBruta) + '</td>' +
          '<td class="n">' + money(d.difTotal) + '</td>' +
          '<td class="n">' + money(d.totalPagado) + '</td>' +
          '</tr>';
      });

      html += '</tbody></table>';
    });

    html += '<p class="small">Fórmulas: <b>Dif. venta − propina</b> = Venta pagada − Propina pagada. ' +
      '<b>Diferencia total</b> = Venta bruta (facturado) − Venta pagada. ' +
      '<b>Error de día</b> = diferencia total distinta de cero. ' +
      '<b>% error</b> = días con error / días totales del punto.</p>';
    html += '</body></html>';

    download(new Blob(['\uFEFF', html], { type: 'application/msword' }),
      'resumen-puntos-de-venta.doc');
  }

  /* =========================================================
     Eventos
     ========================================================= */
  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadData(String(reader.result), file.name);
        $('#error').hidden = true;
      } catch (err) {
        $('#error').textContent = 'Error al procesar el archivo: ' + err.message;
        $('#error').hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    reader.onerror = () => {
      $('#error').textContent = 'No se pudo leer el archivo.';
      $('#error').hidden = false;
    };
    reader.readAsText(file, 'UTF-8');
  }

  function init() {
    const drop = $('#drop');
    const fileInput = $('#file');
    const fileInput2 = $('#file2');

    fileInput.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) readFile(f);
      e.target.value = '';
    });
    fileInput2.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) readFile(f);
      e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));

    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
    drop.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    $('#search').addEventListener('input', e => {
      state.q = e.target.value.trim().toLowerCase();
      render();
    });

    $('#btnCsv').addEventListener('click', exportCSV);
    $('#btnWord').addEventListener('click', exportWord);

    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (state.sort.key === k) state.sort.dir *= -1;
        else { state.sort.key = k; state.sort.dir = (k === 'pdv') ? 1 : -1; }
        render();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
