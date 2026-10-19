(function () {
'use strict';

/* <parser> */
var MAX_EVENTS = 3000;
function dict() { return Object.create(null); }
function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n) : s; }
function clean(s) { return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, ''); }
function unfold(t) { return String(t).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, ''); }
function unesc(s) { return s.replace(/\\([nN,;\\])/g, function (m, c) { return (c === 'n' || c === 'N') ? '\n' : c; }); }
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
}
function stripHtml(s) {
  return decodeEntities(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function offsetAt(tz, ms) {
  var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  var p = {};
  f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = +x.value; });
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
function zoned(y, mo, d, h, mi, s, tz) {
  try {
    var guess = Date.UTC(y, mo, d, h, mi, s);
    var first = guess - offsetAt(tz, guess);
    return new Date(guess - offsetAt(tz, first));
  } catch (e) { return null; }
}
function parseDT(val, params) {
  var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(val).trim());
  if (!m) return null;
  var y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (m[4] === undefined) return { date: new Date(y, mo, d, 23, 59, 0), allDay: true };
  var h = +m[4], mi = +m[5], s = +(m[6] || 0);
  if (m[7]) return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
  if (params.TZID) { var z = zoned(y, mo, d, h, mi, s, params.TZID); if (z) return { date: z, allDay: false }; }
  return { date: new Date(y, mo, d, h, mi, s), allDay: false };
}
function kindOf(link, title) {
  var m = /\/mod\/([a-z0-9_]+)\//i.exec(link || '');
  if (m) {
    var map = { assign: 'Tarea', quiz: 'Cuestionario', forum: 'Foro', workshop: 'Taller', lesson: 'Lección', choice: 'Consulta', feedback: 'Encuesta', data: 'Base de datos', scorm: 'Paquete', h5pactivity: 'H5P', bigbluebuttonbn: 'Clase en vivo' };
    if (map[m[1].toLowerCase()]) return map[m[1].toLowerCase()];
  }
  if (/tarea|assign|entrega|deber|taller/i.test(title)) return 'Tarea';
  if (/cuestionario|quiz|examen|prueba|evaluaci/i.test(title)) return 'Cuestionario';
  if (/foro|forum/i.test(title)) return 'Foro';
  return 'Evento';
}
function actionOf(title) {
  var t = title, a = '';
  var rules = [
    [/\s+(est[aá] en fecha de entrega|is due|vence|se entrega|fecha de entrega)\s*$/i, 'Entrega'],
    [/\s+(cierra|closes|cierre)\s*$/i, 'Cierra'],
    [/\s+(abre|opens|apertura)\s*$/i, 'Abre']
  ];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i][0].test(t)) { a = rules[i][1]; t = t.replace(rules[i][0], ''); break; }
  }
  return { title: t.trim() || title, action: a };
}
function parseICS(text) {
  var lines = unfold(text).split('\n');
  var raw = [], cur = null, skip = 0;
  lines.forEach(function (line) {
    if (!line) return;
    if (line === 'BEGIN:VEVENT') { cur = {}; skip = 0; return; }
    if (line === 'END:VEVENT') { if (cur && raw.length < MAX_EVENTS) raw.push(cur); cur = null; return; }
    if (!cur) return;
    if (/^BEGIN:/i.test(line)) { skip++; return; }
    if (/^END:/i.test(line)) { if (skip > 0) skip--; return; }
    if (skip > 0) return;
    var i = line.indexOf(':');
    if (i < 1) return;
    var parts = line.slice(0, i).split(';');
    var params = {};
    for (var k = 1; k < parts.length; k++) {
      var kv = parts[k].split('=');
      params[kv[0].toUpperCase()] = (kv.slice(1).join('=') || '').replace(/^"|"$/g, '');
    }
    cur[parts[0].toUpperCase()] = { val: clip(line.slice(i + 1), 30000), params: params };
  });
  var seen = dict(), out = [];
  raw.forEach(function (e) {
    if (!e.DTSTART) return;
    var dt = parseDT(e.DTSTART.val, e.DTSTART.params);
    if (!dt || isNaN(dt.date.getTime())) return;
    var rawTitle = clean(unesc((e.SUMMARY && e.SUMMARY.val) || '')).trim() || 'Sin título';
    var descRaw = clip(unesc((e.DESCRIPTION && e.DESCRIPTION.val) || ''), 20000);
    var link = clip((e.URL && e.URL.val) || '', 1000);
    if (!link) { var lm = /https?:\/\/[^\s<>"']+/.exec(descRaw); link = lm ? clip(lm[0], 1000) : ''; }
    link = link.replace(/[.,;:)\]]+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(link)) link = '';
    var cat = clip(clean(unesc((e.CATEGORIES && e.CATEGORIES.val) || '')).trim(), 120);
    var course = cat;
    if (/^user$/i.test(cat)) course = 'Personal';
    else if (/^site$/i.test(cat)) course = 'General';
    if (!course) course = 'Sin curso';
    var act = actionOf(clip(rawTitle, 300));
    var uid = clip((e.UID && e.UID.val) || (rawTitle + '|' + dt.date.getTime()), 200);
    if (seen[uid]) return;
    seen[uid] = 1;
    out.push({
      id: uid, title: act.title, action: act.action, course: course,
      kind: kindOf(link, act.title), start: dt.date, allDay: dt.allDay,
      desc: clip(clean(stripHtml(descRaw)), 2000), link: link
    });
  });
  out.truncated = raw.length >= MAX_EVENTS;
  return out;
}
/* </parser> */

/* ---------- Estado ---------- */
var LS = { ics: 'pm.ics', done: 'pm.done', prefs: 'pm.prefs' };
var MAX_BYTES = 5 * 1024 * 1024;
var WINDOW_DAYS = 14;
var state = { events: [], done: dict(), just: dict(), course: '', day: '', dayLabel: '', range: 'all', q: '', showDone: false, sample: false, name: '', at: null };

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/* ---------- Fechas ---------- */
var fDay = new Intl.DateTimeFormat('es', { weekday: 'long' });
var fMonth = new Intl.DateTimeFormat('es', { month: 'short' });
var fTime = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hour12: false });
var fStamp = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
var fLong = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
var fDM = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
function sod(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayDiff(d, now) { return Math.round((sod(d) - sod(now)) / 86400000); }
function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function rel(d, now) {
  var diff = d - now, abs = Math.abs(diff), txt;
  if (abs < 60000) return 'ahora';
  if (abs < 3600000) txt = Math.round(abs / 60000) + ' min';
  else if (abs < 86400000) txt = Math.round(abs / 3600000) + ' h';
  else { var n = Math.abs(dayDiff(d, now)); txt = n + (n === 1 ? ' día' : ' días'); }
  return diff < 0 ? 'hace ' + txt : 'en ' + txt;
}
function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
function tzName() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
function smooth() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; } catch (e) { return 'auto'; } }

/* ---------- Ejemplo ---------- */
function sampleICS() {
  var now = new Date();
  function at(off, h, m) { return new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, h, m, 0); }
  function p(n) { return String(n).padStart(2, '0'); }
  function utc(d) { return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z'; }
  var rows = [
    [0, 23, 59, 'Taller 3: Derivadas implícitas está en fecha de entrega', 'Cálculo Diferencial', 'Resuelve los ejercicios 1 al 12 y sube una foto legible en PDF.'],
    [1, 20, 0, 'Cuestionario 2: Modelo relacional cierra', 'Base de Datos I', 'Tienes un intento de 30 minutos.'],
    [2, 23, 59, 'Proyecto parcial: Sistema de biblioteca está en fecha de entrega', 'Programación Orientada a Objetos', 'Entrega el código en un .zip con un archivo LEEME que explique cómo ejecutarlo.'],
    [3, 8, 0, 'Cuestionario 4: Capa de transporte abre', 'Redes de Computadoras', ''],
    [4, 23, 59, 'Foro: Dilemas éticos en ingeniería cierra', 'Ética Profesional', 'Participa con un aporte propio y responde al menos a un compañero.'],
    [6, 23, 59, 'Informe de laboratorio 4 está en fecha de entrega', 'Redes de Computadoras', 'Máximo 5 páginas, con capturas de la simulación.'],
    [9, 18, 0, 'Cuestionario 3: Límites cierra', 'Cálculo Diferencial', ''],
    [-2, 23, 59, 'Tarea 5: Normalización está en fecha de entrega', 'Base de Datos I', 'Lleva el esquema hasta tercera forma normal.']
  ];
  var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ejemplo//ES'];
  rows.forEach(function (r, i) {
    var d = at(r[0], r[1], r[2]);
    L.push('BEGIN:VEVENT', 'UID:ejemplo-' + i + '@ejemplo.local', 'SUMMARY:' + r[3].replace(/,/g, '\\,'),
      'DESCRIPTION:' + r[5].replace(/,/g, '\\,'), 'CATEGORIES:' + r[4], 'DTSTART:' + utc(d), 'DTEND:' + utc(d), 'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

/* ---------- Avisos ---------- */
var toastTimer = null;
function hideToast() { var t = $('toast'); t.className = 'toast'; t.textContent = ''; }
function toast(text, actionLabel, onAction) {
  var t = $('toast'); t.textContent = '';
  t.appendChild(el('span', '', text));
  if (actionLabel) {
    var b = el('button', 'btn', actionLabel); b.type = 'button';
    b.addEventListener('click', function () { hideToast(); onAction(); });
    t.appendChild(b);
  }
  t.className = 'toast on';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 7000);
}
function setMsg(text, cls) { var m = $('msg'); m.textContent = text || ''; m.className = 'msg' + (cls ? ' ' + cls : ''); }

/* ---------- Persistencia ---------- */
function saveDone() { lsSet(LS.done, JSON.stringify(state.done)); }
function savePrefs() { lsSet(LS.prefs, JSON.stringify({ showDone: state.showDone, course: state.course })); }
function loadDone() {
  try {
    var o = JSON.parse(lsGet(LS.done) || '{}'), n = 0;
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) { if (o[k] && n < 5000) { state.done[clip(k, 200)] = 1; n++; } });
  } catch (e) {}
}
function loadPrefs() {
  try {
    var o = JSON.parse(lsGet(LS.prefs) || 'null');
    if (!o || typeof o !== 'object') return;
    state.showDone = o.showDone === true;
    if (typeof o.course === 'string') state.course = clip(o.course, 120);
  } catch (e) {}
}

/* ---------- Carga ---------- */
function applyEvents(events, name, sample, at) {
  events.sort(function (a, b) { return a.start - b.start; });
  events.forEach(function (e, i) { e.idx = i; e.sample = sample; });
  state.events = events; state.name = name; state.sample = sample; state.at = at;
  state.course = ''; state.day = ''; state.dayLabel = ''; state.just = dict();
}

function loadText(text, name) {
  if (text.length > MAX_BYTES) {
    setMsg('El contenido es demasiado grande (máximo 5 MB). Exporta un intervalo de tiempo más corto en Moodle.', 'err'); return;
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    setMsg('Eso no parece un calendario .ics. En Moodle usa Calendario, Importar o exportar calendarios, Exportar calendario, y sube el archivo que se descarga.', 'err'); return;
  }
  var events;
  try { events = parseICS(text); } catch (e) { events = []; }
  if (!events.length) {
    setMsg('El archivo es un calendario, pero no tiene actividades con fecha. Vuelve a exportarlo con «Eventos a exportar» en «Todos» y un intervalo más largo.', 'err'); return;
  }
  var cutoff = Date.now() - WINDOW_DAYS * 86400000;
  var recent = events.filter(function (e) { return e.start.getTime() >= cutoff; }).length;
  if (!recent) {
    setMsg('Todas las actividades de ese archivo son de hace más de dos semanas. Exporta un intervalo que incluya fechas recientes o futuras, por ejemplo «Recientes y próximos 60 días».', 'err'); return;
  }
  var at = new Date();
  var truncated = events.truncated;
  applyEvents(events, clip(name || 'calendario.ics', 120), false, at);
  var saved = lsSet(LS.ics, JSON.stringify({ text: text, name: state.name, at: at.getTime() }));
  setMsg('');
  $('paste').value = '';
  openPanel(false);
  render();
  toast(recent + (recent === 1 ? ' actividad cargada.' : ' actividades cargadas.') +
    (truncated ? ' Se leyeron solo las primeras ' + MAX_EVENTS + '.' : '') +
    (saved ? '' : ' No se pudo guardar en este navegador.'));
}

function readFile(f) {
  if (!f) return;
  if (f.size > MAX_BYTES) {
    setMsg('«' + clip(f.name, 60) + '» pesa ' + (f.size / 1048576).toFixed(1) + ' MB y el máximo es 5 MB. Exporta un intervalo de tiempo más corto en Moodle.', 'err'); return;
  }
  if (!/\.ics$/i.test(f.name) && !/calendar/i.test(f.type || '')) {
    setMsg('«' + clip(f.name, 60) + '» no es un archivo .ics. En Moodle usa Calendario, Importar o exportar calendarios, Exportar calendario.', 'err'); return;
  }
  $('drop').setAttribute('aria-busy', 'true');
  setMsg('Leyendo archivo…');
  var r = new FileReader();
  r.onload = function () { $('drop').removeAttribute('aria-busy'); loadText(String(r.result), f.name); };
  r.onerror = function () { $('drop').removeAttribute('aria-busy'); setMsg('No pude leer el archivo. Vuelve a descargarlo desde Moodle e inténtalo de nuevo.', 'err'); };
  r.readAsText(f);
}

function openPanel(on) {
  $('importPanel').hidden = !on;
  $('toggleImport').setAttribute('aria-expanded', on ? 'true' : 'false');
  if (on) { try { $('importPanel').scrollIntoView({ block: 'nearest', behavior: smooth() }); } catch (e) {} }
}

/* ---------- Estado de la lista ---------- */
function isDone(e) { return !!state.done[e.id]; }
function placePending(e) { return !isDone(e) || !!state.just[e.id]; }
function setDone(e, on, withUndo) {
  if (on) state.done[e.id] = 1; else delete state.done[e.id];
  state.just[e.id] = 1;
  saveDone();
  render();
  if (on && withUndo) toast('Marcada como hecha.', 'Deshacer', function () { setDone(e, false, false); });
}
function touch() { state.just = dict(); }
function clearAll() {
  state.range = 'all'; state.course = ''; state.day = ''; state.dayLabel = ''; state.q = ''; $('q').value = ''; touch(); savePrefs();
}

/* ---------- Render ---------- */
function render() {
  var now = new Date();
  var cutoff = now.getTime() - WINDOW_DAYS * 86400000;
  var visible = state.events.filter(function (e) { return e.start.getTime() >= cutoff; });
  var hiddenOld = state.events.length - visible.length;
  var q = state.q.trim().toLowerCase();

  /* Estado superior */
  var pendingAll = visible.filter(function (e) { return !isDone(e); });
  var lateAll = pendingAll.filter(function (e) { return e.start < now; }).length;
  var st = $('status');
  st.textContent = '';
  st.appendChild(el('b', '', pendingAll.length + ' por hacer'));
  if (lateAll) { st.appendChild(document.createTextNode(' · ')); st.appendChild(el('span', 'late', lateAll + (lateAll === 1 ? ' vencida' : ' vencidas'))); }
  var next = pendingAll.filter(function (e) { return e.start >= now; })[0];
  if (next) st.appendChild(document.createTextNode(' · próxima ' + rel(next.start, now)));
  if (!state.sample && state.at) st.appendChild(document.createTextNode(' · actualizado ' + rel(state.at, now)));

  $('notice').hidden = !state.sample;
  var old = !state.sample && state.at && (now - state.at) > 3 * 86400000;
  $('stale').hidden = !old;
  if (old) $('staleTxt').textContent = 'Tu calendario se cargó ' + rel(state.at, now) + '. Exporta uno nuevo para ver los cambios de Moodle.';
  $('toggleImport').hidden = state.sample;
  $('today').textContent = cap(fLong.format(now));
  renderNext(now, true);
  renderStrip(visible, now);

  /* Chips de cursos */
  var courses = dict();
  visible.forEach(function (e) { courses[e.course] = (courses[e.course] || 0) + (isDone(e) ? 0 : 1); });
  var names = Object.keys(courses).sort(function (a, b) { return a.localeCompare(b, 'es'); });
  if (state.course && !(state.course in courses)) state.course = '';
  var chips = $('chips'); chips.textContent = '';
  function chip(label, count, value, h) {
    var c = el('button', 'chip'); c.type = 'button';
    c.setAttribute('aria-pressed', state.course === value ? 'true' : 'false');
    if (h != null) { var d = el('i', 'dot'); d.style.setProperty('--h', h); c.appendChild(d); }
    c.appendChild(el('span', 'nm', label));
    c.appendChild(el('span', 'ct', String(count)));
    c.addEventListener('click', function () { state.course = value; touch(); savePrefs(); render(); });
    chips.appendChild(c);
  }
  chip('Todos los cursos', pendingAll.length, '');
  names.forEach(function (n) { chip(n, courses[n], n, hue(n)); });

  /* Filtro base (curso, día y búsqueda) */
  var base = visible.filter(function (e) {
    if (state.course && e.course !== state.course) return false;
    if (state.day && dayKey(e.start) !== state.day) return false;
    if (q && (e.title + ' ' + e.course + ' ' + e.kind).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var week = now.getTime() + 7 * 86400000;
  function inRange(e, r) {
    var pend = placePending(e);
    if (r === 'late') return pend && e.start < now;
    if (r === 'today') return e.start >= now && dayDiff(e.start, now) === 0;
    if (r === 'week') return e.start >= now && e.start.getTime() < week;
    return true;
  }
  function countOf(r) { return base.filter(function (e) { return !isDone(e) && inRange(e, r); }).length; }

  /* Rango */
  var RANGES = [['all', 'Todo'], ['late', 'Vencidas'], ['today', 'Hoy'], ['week', '7 días']];
  var rangeEl = $('range'); rangeEl.textContent = '';
  RANGES.forEach(function (r) {
    var n = countOf(r[0]);
    var btn = el('button', r[0] === 'late' ? 'late-btn' : ''); btn.type = 'button';
    btn.setAttribute('aria-pressed', state.range === r[0] ? 'true' : 'false');
    btn.appendChild(el('span', 'n' + (n ? ' has' : ''), String(n)));
    btn.appendChild(document.createTextNode(r[1]));
    btn.addEventListener('click', function () { state.range = r[0]; state.day = ''; state.dayLabel = ''; touch(); render(); });
    rangeEl.appendChild(btn);
  });

  /* Lista */
  var list = base.filter(function (e) {
    if (!(state.showDone || !isDone(e) || state.just[e.id])) return false;
    return inRange(e, state.range);
  });
  renderActive(list.length, RANGES);

  var host = $('list'); host.textContent = '';
  if (!list.length) {
    var em = el('div', 'empty');
    var filtered = state.range !== 'all' || state.course || state.day || q;
    var none = pendingAll.length === 0 && !filtered;
    em.appendChild(el('strong', '', none ? 'No tienes pendientes' : 'Nada con estos filtros'));
    em.appendChild(document.createTextNode(none
      ? 'Todo lo que cargaste está completado o venció hace más de dos semanas.'
      : 'Prueba con otro rango, curso o día, o quita los filtros.'));
    if (filtered) {
      var cl = el('button', 'btn', 'Quitar filtros'); cl.type = 'button';
      cl.addEventListener('click', function () { clearAll(); render(); });
      em.appendChild(el('br')); em.appendChild(cl);
    }
    host.appendChild(em);
  } else {
    var groups = [], map = dict();
    list.forEach(function (e) {
      var late = e.start < now && placePending(e);
      var key = late ? 'late' : dayKey(e.start);
      if (!map[key]) { map[key] = { late: late, date: e.start, items: [] }; groups.push(map[key]); }
      map[key].items.push(e);
    });
    groups.sort(function (a, b) { return a.late ? -1 : b.late ? 1 : a.date - b.date; });
    groups.forEach(function (g) {
      var dd = dayDiff(g.date, now);
      var sec = el('section', 'group' + (g.late ? ' late' : '') + (!g.late && dd === 0 ? ' today' : ''));
      var head = el('header'); var h2 = el('h2');
      if (g.late) { h2.appendChild(el('span', 'dl', 'Vencidas')); }
      else {
        var wd = cap(fDay.format(g.date));
        h2.appendChild(el('span', 'dn', String(g.date.getDate())));
        h2.appendChild(el('span', 'dm', fMonth.format(g.date).replace('.', '')));
        h2.appendChild(el('span', 'dl', dd === 0 ? 'Hoy · ' + wd : dd === 1 ? 'Mañana · ' + wd : wd));
      }
      head.appendChild(h2);
      head.appendChild(el('span', 'cnt', String(g.items.length)));
      sec.appendChild(head);
      var ul = el('ul', 'card');
      g.items.forEach(function (e) { ul.appendChild(row(e, now)); });
      sec.appendChild(ul);
      host.appendChild(sec);
    });
  }

  /* Pie */
  var foot = $('foot'); foot.textContent = '';
  if (state.sample) foot.appendChild(el('span', '', 'Datos de ejemplo.'));
  else foot.appendChild(el('span', '', 'Calendario: ' + state.name + ', cargado el ' + fStamp.format(state.at) + '.'));
  if (hiddenOld) foot.appendChild(el('span', '', hiddenOld + (hiddenOld === 1 ? ' actividad anterior' : ' actividades anteriores') + ' a dos semanas no se muestran.'));
  foot.appendChild(el('span', '', 'Las horas se muestran en tu zona horaria' + (tzName() ? ' (' + tzName() + ')' : '') + '.'));
}

function renderActive(count, RANGES) {
  $('count').textContent = count + (count === 1 ? ' actividad' : ' actividades');
  var pills = $('pills'); pills.textContent = '';
  function pill(label, onRemove) {
    var b = el('button', 'pill'); b.type = 'button';
    b.setAttribute('aria-label', 'Quitar filtro: ' + label);
    b.appendChild(el('span', '', label));
    var x = el('span', 'x', '×'); x.setAttribute('aria-hidden', 'true'); b.appendChild(x);
    b.addEventListener('click', function () { onRemove(); touch(); render(); });
    pills.appendChild(b);
  }
  var n = 0;
  if (state.range !== 'all') { n++; pill('Rango: ' + RANGES.filter(function (r) { return r[0] === state.range; })[0][1], function () { state.range = 'all'; }); }
  if (state.course) { n++; pill('Curso: ' + clip(state.course, 28), function () { state.course = ''; savePrefs(); }); }
  if (state.day) { n++; pill('Día: ' + state.dayLabel, function () { state.day = ''; state.dayLabel = ''; }); }
  if (state.q.trim()) { n++; pill('Búsqueda: «' + clip(state.q.trim(), 20) + '»', function () { state.q = ''; $('q').value = ''; }); }
  if (n > 1) {
    var all = el('button', 'btn quiet', 'Quitar todos'); all.type = 'button';
    all.addEventListener('click', function () { clearAll(); render(); });
    pills.appendChild(all);
  }
}

var shownNext = null;
function cdText(ms) {
  var m = Math.floor(ms / 60000);
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return m + ' min';
  var h = Math.floor(m / 60);
  if (h < 24) return h + ' h ' + (m % 60) + ' min';
  var d = Math.floor(h / 24);
  return d + (d === 1 ? ' día ' : ' días ') + (h % 24) + ' h';
}

function renderNext(now, force) {
  var host = $('next');
  var cutoff = now.getTime() - WINDOW_DAYS * 86400000;
  var pend = state.events.filter(function (e) { return !isDone(e) && e.start.getTime() >= cutoff; });
  var upcoming = pend.filter(function (e) { return e.start >= now; });
  var late = pend.length - upcoming.length;
  var nx = upcoming.filter(function (e) { return e.action !== 'Abre'; })[0] || upcoming[0] || null;
  if (!force && nx && shownNext === nx.id && $('nextCd')) { $('nextCd').textContent = cdText(nx.start - now); return; }
  shownNext = nx ? nx.id : null;
  host.textContent = '';
  host.hidden = !pend.length;
  if (!pend.length) return;

  var left = el('div', 'nl');
  var acts = el('div', 'na');
  if (nx) {
    left.appendChild(el('p', 'k', 'Lo siguiente'));
    var cd = el('div', 'cd' + (nx.start - now < 86400000 ? ' hot' : ''), cdText(nx.start - now)); cd.id = 'nextCd';
    left.appendChild(cd);
    var what = nx.action === 'Entrega' ? 'para la entrega' : nx.action === 'Cierra' ? 'para el cierre' : nx.action === 'Abre' ? 'para que abra' : 'para que empiece';
    left.appendChild(el('p', 'cdl', what + ' · ' + cap(fLong.format(nx.start)) + (nx.allDay ? '' : ', ' + fTime.format(nx.start))));
    left.appendChild(el('h2', 'nt', nx.title));
    var nm = el('p', 'nm'); var dot = el('i', 'dot'); dot.style.setProperty('--h', hue(nx.course));
    nm.appendChild(dot); nm.appendChild(el('span', '', nx.course)); nm.appendChild(el('span', '', '· ' + nx.kind));
    left.appendChild(nm);
    if (nx.link && !nx.sample) {
      var a = el('a', 'btn solid', 'Abrir en Moodle'); a.href = nx.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; acts.appendChild(a);
    }
    var ok = el('button', 'btn', 'Marcar como hecha'); ok.type = 'button';
    ok.addEventListener('click', function () { touch(); setDone(nx, true, true); });
    acts.appendChild(ok);
  } else {
    left.appendChild(el('p', 'k', 'Atención'));
    left.appendChild(el('div', 'cd hot', late + (late === 1 ? ' vencida' : ' vencidas')));
    left.appendChild(el('p', 'cdl', 'No tienes nada más próximo. Revisa lo que quedó atrás.'));
  }
  if (late) {
    var lb = el('button', 'btn quiet', 'Ver ' + late + (late === 1 ? ' vencida' : ' vencidas')); lb.type = 'button';
    lb.addEventListener('click', function () { state.range = 'late'; state.day = ''; state.dayLabel = ''; touch(); render(); });
    acts.appendChild(lb);
  }
  host.appendChild(left); host.appendChild(acts);
}

function renderStrip(visible, now) {
  var host = $('strip'); host.textContent = '';
  var pend = visible.filter(function (e) { return !isDone(e) && (!state.course || e.course === state.course); });
  var head = el('div', 'sh');
  head.appendChild(el('h2', '', 'Carga por día'));
  if (state.day) {
    var clr = el('button', 'btn quiet', 'Quitar filtro de día'); clr.type = 'button';
    clr.addEventListener('click', function () { state.day = ''; state.dayLabel = ''; touch(); render(); });
    head.appendChild(clr);
  } else head.appendChild(el('span', 'hint', 'Pulsa un día para ver solo ese día'));
  host.appendChild(head);

  var grid = el('div', 'sg');
  ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (l) { var s = el('span', 'wd', l); s.setAttribute('aria-hidden', 'true'); grid.appendChild(s); });
  var t0 = sod(now), dow = (t0.getDay() + 6) % 7;
  var byDay = dict();
  pend.forEach(function (e) { var k = dayKey(e.start); (byDay[k] = byDay[k] || []).push(e); });
  for (var i = 0; i < 14; i++) {
    var d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - dow + i);
    var k = dayKey(d), items = byDay[k] || [], n = items.length;
    var cls = 'cell' + (d < t0 ? ' past' : '') + (dayDiff(d, now) === 0 ? ' today' : '') + (state.day === k ? ' sel' : '') + (n >= 4 ? ' lv3' : n >= 2 ? ' lv2' : '');
    (function (k, d) {
      var cell = el('button', cls); cell.type = 'button';
      cell.disabled = !n && state.day !== k;
      cell.setAttribute('aria-pressed', state.day === k ? 'true' : 'false');
      cell.setAttribute('aria-label', cap(fLong.format(d)) + ': ' + (n ? n + (n === 1 ? ' pendiente' : ' pendientes') : 'sin pendientes'));
      if (d.getDate() === 1 || (grid.children.length === 7)) cell.appendChild(el('span', 'mo', fMonth.format(d).replace('.', '')));
      cell.appendChild(el('span', 'n', String(d.getDate())));
      var dots = el('span', 'dots');
      items.slice(0, 3).forEach(function (e) { var dt = el('i', 'dot'); dt.style.setProperty('--h', hue(e.course)); dots.appendChild(dt); });
      if (n > 3) dots.appendChild(el('span', 'more', '+' + (n - 3)));
      cell.appendChild(dots);
      cell.addEventListener('click', function () {
        if (state.day === k) { state.day = ''; state.dayLabel = ''; } else { state.day = k; state.dayLabel = fDM.format(d).replace('.', ''); }
        state.range = 'all'; touch(); render();
      });
      grid.appendChild(cell);
    })(k, d);
  }
  host.appendChild(grid);
}

function row(e, now) {
  var done = isDone(e);
  var overdue = e.start < now && !done;
  var soon = !done && !overdue && (e.start - now) < 48 * 3600000;
  var li = el('li', 'item' + (done ? ' done' : '') + (overdue ? ' late' : '') + (soon ? ' soon' : ''));

  var lab = el('label', 'check');
  var cb = el('input'); cb.type = 'checkbox'; cb.id = 'chk-' + e.idx; cb.checked = done;
  cb.setAttribute('aria-label', 'Marcar como completada: ' + e.title);
  cb.addEventListener('change', function () {
    setDone(e, cb.checked, true);
    var again = $('chk-' + e.idx); if (again) again.focus();
  });
  lab.appendChild(cb); lab.appendChild(el('span', 'box'));
  li.appendChild(lab);

  var body = el('div', 'bd');
  var t = el('div', 'title');
  if (e.link && !e.sample) {
    var a = el('a', '', e.title); a.href = e.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; t.appendChild(a);
  } else t.textContent = e.title;
  body.appendChild(t);
  var meta = el('div', 'meta');
  var c = el('span', 'course'); var dot = el('i', 'dot'); dot.style.setProperty('--h', hue(e.course));
  c.appendChild(dot); c.appendChild(el('span', '', e.course)); meta.appendChild(c);
  meta.appendChild(el('span', 'tag', e.kind));
  if (e.action) meta.appendChild(el('span', 'tag' + (e.action === 'Abre' ? ' dim' : ''), e.action));
  body.appendChild(meta);
  if (e.desc) {
    var det = el('details', 'more'); det.appendChild(el('summary', '', 'Detalle'));
    det.appendChild(el('p', '', e.desc.length > 700 ? e.desc.slice(0, 700) + '…' : e.desc));
    body.appendChild(det);
  }
  li.appendChild(body);

  var w = el('div', 'when');
  w.appendChild(el('span', 'time', e.allDay ? 'Todo el día' : fTime.format(e.start)));
  w.appendChild(el('span', 'rel', rel(e.start, now)));
  li.appendChild(w);
  return li;
}

/* ---------- Eventos de la página ---------- */
$('toggleImport').addEventListener('click', function () { openPanel($('importPanel').hidden); });
$('noticeBtn').addEventListener('click', function () { openPanel(true); });
$('staleBtn').addEventListener('click', function () { openPanel(true); });
$('closeImport').addEventListener('click', function () { openPanel(false); $('toggleImport').hidden ? $('noticeBtn').focus() : $('toggleImport').focus(); });
$('helpBtn').addEventListener('click', function () {
  $('faqExport').open = true;
  try { $('help').scrollIntoView({ block: 'start', behavior: smooth() }); } catch (e) {}
});
$('file').addEventListener('change', function (ev) { readFile(ev.target.files[0]); ev.target.value = ''; });
var drop = $('drop');
['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (ev) { ev.preventDefault(); drop.classList.add('over'); }); });
['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (ev) { ev.preventDefault(); drop.classList.remove('over'); }); });
drop.addEventListener('drop', function (ev) { readFile(ev.dataTransfer && ev.dataTransfer.files[0]); });
$('loadPaste').addEventListener('click', function () {
  var v = $('paste').value;
  if (!v.trim()) { setMsg('Pega primero el contenido del archivo .ics.', 'err'); return; }
  loadText(v, 'texto pegado');
});
$('q').addEventListener('input', function (ev) { state.q = clip(ev.target.value, 80); touch(); render(); });
$('q').addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && $('q').value) { $('q').value = ''; state.q = ''; touch(); render(); }
});
document.addEventListener('keydown', function (ev) {
  if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var tag = ev.target && ev.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  ev.preventDefault(); $('q').focus();
});
$('showDone').addEventListener('change', function (ev) { state.showDone = ev.target.checked; touch(); savePrefs(); render(); });

$('reset').addEventListener('click', function () { $('reset').hidden = true; $('resetAsk').hidden = false; $('resetNo').focus(); });
$('resetNo').addEventListener('click', function () { $('resetAsk').hidden = true; $('reset').hidden = false; $('reset').focus(); });
$('resetYes').addEventListener('click', function () {
  lsDel(LS.ics); lsDel(LS.done); lsDel(LS.prefs);
  state.done = dict(); state.showDone = false; $('showDone').checked = false; $('q').value = ''; state.q = ''; state.range = 'all';
  applyEvents(parseICS(sampleICS()), 'ejemplo', true, new Date());
  $('resetAsk').hidden = true; $('reset').hidden = false;
  setMsg('Listo: borré el calendario y tus marcas de este navegador.', 'ok');
  render();
});

/* ---------- Inicio ---------- */
loadDone();
loadPrefs();
var prefCourse = state.course;
var restored = false;
try {
  var s0 = JSON.parse(lsGet(LS.ics) || 'null');
  if (s0 && typeof s0.text === 'string' && s0.text.length <= MAX_BYTES) {
    var ev0 = parseICS(s0.text);
    if (ev0.length) { applyEvents(ev0, clip(String(s0.name || 'calendario.ics'), 120), false, new Date(+s0.at || Date.now())); restored = true; }
  }
} catch (e) {}
if (!restored) applyEvents(parseICS(sampleICS()), 'ejemplo', true, new Date());
state.course = prefCourse;
$('showDone').checked = state.showDone;
openPanel(false);
render();
setInterval(function () { renderNext(new Date(), false); }, 30000);
})();
