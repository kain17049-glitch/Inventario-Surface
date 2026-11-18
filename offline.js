/* ================= v2.4 · Conexión, copia local y sincronización =================
 * La app guarda en el celular una copia de productos, stock y movimientos.
 * Buscar y escanear se responde con esa copia (instantáneo, con o sin señal).
 * Cada movimiento se guarda primero en el celular (cola) y se sube a la hoja
 * en segundo plano. Sin señal, espera y se sube solo cuando vuelve.
 */
const API_URL = 'https:' + String.fromCharCode(47, 47) + 'script.google.com/macros/s/AKfycbyXNamoz37LfEsn67XloeSKID490RBDJtJO9ZrYTswXYtp4bqABtJDuyFGOwMFijaoVLA/exec';
const APP_VER = '2.4.0';
const OFF = { en: true, snap: null, ST: {}, cola: [], sinc: false, tSnap: 0, dispositivo: '', timer: null };
const LECTURAS = ['historial', 'porEstado', 'stockBajo', 'pendientes', 'listaProyectos', 'resumenProyecto', 'kardex',
                  'listaKardex', 'resumenInicio', 'listaMantenimiento', 'detalleMaquina', 'consumoArea'];

/* ---------- Guardado en el celular ---------- */
function lsGet(k){ try { const v = localStorage.getItem('inv3_' + k); return v ? JSON.parse(v) : null; } catch(e){ return null; } }
function lsSet(k, v){ try { localStorage.setItem('inv3_' + k, JSON.stringify(v)); return true; } catch(e){ return false; } }
function lsDel(k){ try { localStorage.removeItem('inv3_' + k); } catch(e){} }
function guardarCola(){ lsSet('cola', OFF.cola); pintarChipSync(); }
function guardarSnap(sn){
  OFF.snap = sn; OFF.tSnap = Date.now();
  if (!lsSet('snap', sn)){ /* sin espacio: se guarda sin historial de movimientos */
    const liv = Object.assign({}, sn, {movs: (sn.movs || []).slice(-200)}); lsSet('snap', liv);
  }
  lsSet('tSnap', OFF.tSnap);
}
function dispositivo(){
  let d = lsGet('disp');
  if (!d){ d = 'cel-' + Math.random().toString(36).slice(2, 8); lsSet('disp', d); }
  return d;
}
function nuevoOpid(){ return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9); }
function fechaCorta(d){ const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function hace(t){ const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; }
async function hashPin(u, pin){
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(u).toUpperCase() + '|' + pin));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  } catch(e){ return 'x' + String(u).toUpperCase() + '|' + pin.length; }
}

/* ---------- Llamada al servidor (Apps Script) ---------- */
function errRed(msg){ const x = new Error(msg || 'Sin conexión.'); x.red = true; return x; }
async function remoto(fn, args, ms){
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms || 45000);
  let r;
  try {
    r = await fetch(API_URL, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
                              body: JSON.stringify({fn: fn, args: args}), signal: ctrl.signal, redirect: 'follow', cache: 'no-store'});
  } catch(e){ marcarRed(false); throw errRed(); }
  finally { clearTimeout(t); }
  let j;
  try { j = await r.json(); } catch(e){ marcarRed(false); throw errRed('El servidor no respondió. Intenta de nuevo.'); }
  marcarRed(true);
  if (!j.ok) throw new Error(j.error || 'Error del servidor.');
  return j.data;
}
function marcarRed(ok){ if (OFF.en !== ok){ OFF.en = ok; pintarChipSync(); if (ok) programarSync(300); } }

/* ---------- Stock local = copia del servidor + movimientos en cola ---------- */
function claveSt(c, u, e){ return c + '||' + u + '||' + e; }
function recalcLocal(){
  const m = {};
  ((OFF.snap && OFF.snap.stock) || []).forEach(x => { const k = claveSt(x[0], x[1], x[2]); m[k] = r3(( m[k] || 0) + x[3]); });
  OFF.cola.forEach(o => { if (o.est === 'error') return; (o.efs || []).forEach(e => { const k = claveSt(e[0], e[1], e[2]); m[k] = r3((m[k] || 0) + e[3]); }); });
  OFF.ST = m;
}
function r3(x){ return Math.round(x * 1000) / 1000; }
function cantLocal(c, u, e){ return OFF.ST[claveSt(c, u, e)] || 0; }
function prodLocal(cod){
  const k = String(cod || '').trim().toUpperCase(); if (!k) return null;
  return S.productos.find(p => p.c.toUpperCase() === k || (p.bar && p.bar.toUpperCase() === k)) || null;
}
function ubicTodas(){ return (OFF.snap && OFF.snap.ubicTodas) || S.ubicaciones; }
function efectosLocal(m){
  const c = m.cod, q = m.q, ub = m.ub, eo = m.eo || 'DISPONIBLE', ed = m.ed || 'DISPONIBLE';
  switch (m.tipo){
    case 'ENTRADA': return [[c, ub, 'DISPONIBLE', q]];
    case 'DEVOLUCION': return [[c, ub, ed, q]];
    case 'SALIDA': case 'PRESTAMO': return [[c, ub, 'DISPONIBLE', -q]];
    case 'TRASLADO': return [[c, ub, eo, -q], [c, m.dest, eo, q]];
    case 'CAMBIO': return [[c, ub, eo, -q], [c, ub, ed, q]];
    case 'BAJA': return [[c, ub, eo, -q]];
    case 'AJUSTE': case 'CONTEO': return [[c, ub, eo, q]];
  }
  return [];
}
function pendientesLocal(c){
  const usados = {};
  OFF.cola.forEach(o => { if (o.est !== 'error' && o.m.tipo === 'DEVOLUCION' && o.m.pendiente) usados[o.m.pendiente] = r3((usados[o.m.pendiente] || 0) + o.q); });
  return ((OFF.snap && OFF.snap.pendientes) || []).filter(x => !c || x.c === c)
    .map(x => Object.assign({}, x, {falta: r3(x.falta - (usados[x.id] || 0))})).filter(x => x.falta > 1e-9);
}
function movDeCola(o){
  return {id: '⏳', f: fechaCorta(new Date(o.ms)), t: o.m.tipo, c: o.c, d: o.d, q: o.q, un: o.un, u: o.m.ubicacion, eo: o.m.estadoOrigen,
          dest: o.m.destino || '', ed: o.m.estadoDestino, pry: o.m.proyecto || '', area: o.m.area || '', resp: o.m.responsable || '',
          us: S.u, nota: (o.est === 'error' ? '⚠️ ' + o.error : 'Pendiente de subir'), val: 0, e: o.est === 'error' ? 'ERROR' : 'COLA', ref: ''};
}

/** Igual que buscar() del servidor, pero con la copia local */
function buscarOffline(codigo){
  const cod = String(codigo || '').trim();
  if (!cod) throw new Error('Escribe o escanea un código.');
  const ub = ubicTodas().find(x => x.c.toUpperCase() === cod.toUpperCase());
  if (ub){
    const items = [];
    Object.keys(OFF.ST).forEach(k => {
      const [c, u, e] = k.split('||'); const q = OFF.ST[k];
      if (u !== ub.c || Math.abs(q) < 1e-9) return;
      const p = S.productos.find(x => x.c === c);
      items.push({c: c, d: p ? p.d : c, u: p ? p.u : '', e: e, q: q});
    });
    items.sort((a, b) => a.d.localeCompare(b.d));
    return {tipo: 'ubicacion', ubicacion: ub, items: items};
  }
  const p = prodLocal(cod);
  if (!p) return {tipo: 'nuevo', codigo: cod};
  const um = {}; ubicTodas().forEach(u => um[u.c] = u);
  const stock = [], tot = {DISPONIBLE: 0, REVISION: 0, VENTA: 0};
  Object.keys(OFF.ST).forEach(k => {
    const [c, u, e] = k.split('||'); const q = OFF.ST[k];
    if (c !== p.c || Math.abs(q) < 1e-9) return;
    stock.push({u: u, a: (um[u] || {}).a || '', e: e, q: q}); tot[e] = r3((tot[e] || 0) + q);
  });
  const pend = pendientesLocal(p.c);
  const enUsoCola = OFF.cola.filter(o => o.est !== 'error' && o.c === p.c && o.m.tipo === 'PRESTAMO').reduce((s, o) => s + o.q, 0);
  const enUso = r3(pend.reduce((s, x) => s + x.falta, 0) + enUsoCola);
  const movs = ((OFF.snap && OFF.snap.movs) || []).filter(m => m.c === p.c);
  const desde = Date.now() - 90 * 864e5;
  const cons = movs.filter(m => m.t === 'SALIDA' && m.e === 'OK' && m.ms >= desde).reduce((s, m) => s + m.q, 0)
    + OFF.cola.filter(o => o.est !== 'error' && o.c === p.c && o.m.tipo === 'SALIDA').reduce((s, o) => s + o.q, 0);
  const total = r3(tot.DISPONIBLE + tot.REVISION + tot.VENTA);
  const cola = OFF.cola.filter(o => o.c === p.c).slice().reverse().map(movDeCola);
  return {tipo: 'producto', producto: p, stock: stock, tot: tot, total: total, enUso: enUso, pendientes: pend,
          consumoMes: r3(cons / 3), valor: Math.round(total * (p.cp || 0) * 100) / 100,
          bajo: p.min > 0 && tot.DISPONIBLE < p.min,
          ultimos: cola.concat(movs.slice(-10).reverse()).slice(0, 10), local: true};
}

/** Valida como el servidor, guarda en la cola y descuenta del stock local al instante */
function registrarOffline(m){
  const tipo = String(m.tipo || '').toUpperCase();
  if (!TIPOS[tipo]) throw new Error('Tipo de movimiento no válido.');
  const p = prodLocal(m.codigo);
  if (!p) throw new Error('El código ' + m.codigo + ' no está registrado.');
  const ubs = ubicTodas(), ub = String(m.ubicacion || '').trim();
  if (!ubs.some(x => x.c === ub)) throw new Error('Elige una ubicación válida.');
  const eo = String(m.estadoOrigen || 'DISPONIBLE').toUpperCase(), ed = String(m.estadoDestino || 'DISPONIBLE').toUpperCase();
  let dest = '';
  if (tipo === 'TRASLADO'){
    dest = String(m.destino || '').trim();
    if (!ubs.some(x => x.c === dest)) throw new Error('Elige la ubicación de destino.');
    if (dest === ub) throw new Error('El origen y el destino son la misma ubicación.');
  }
  if (tipo === 'CAMBIO' && eo === ed) throw new Error('Elige un estado distinto al actual.');
  const pry = String(m.proyecto || '').trim(), resp = String(m.responsable || '').trim(), area = String(m.area || '').trim();
  if (pry && !S.proyectos.some(x => x.c === pry)) throw new Error('Proyecto no válido.');
  if (tipo === 'SALIDA'){
    if (!pry && !area) throw new Error('Indica el proyecto o para qué se usa.');
    if (!pry && S.cfg.proyectoObligatorio) throw new Error('Indica el proyecto.');
  }
  if (tipo === 'PRESTAMO' && !resp && !pry) throw new Error('Indica el responsable o el proyecto.');
  if ((tipo === 'AJUSTE' || tipo === 'BAJA') && !String(m.nota || '').trim()) throw new Error('Escribe el motivo en la nota.');
  if (tipo === 'BAJA' && !String(m.motivoBaja || '').trim()) throw new Error('Elige el motivo de la baja.');
  let q = parseFloat(String(m.cantidad).replace(',', '.'));
  if (isNaN(q)) throw new Error('Escribe una cantidad válida.');
  if (m.enPresentacion && p.fac > 0) q = q * p.fac;
  if (tipo === 'CONTEO'){
    if (q < 0) throw new Error('La cantidad contada no puede ser negativa.');
    q = r3(q - cantLocal(p.c, ub, eo));
  } else if (tipo === 'AJUSTE'){ if (q === 0) throw new Error('El ajuste no puede ser 0.'); }
  else if (q <= 0) throw new Error('La cantidad debe ser mayor que 0.');
  q = r3(q);
  if (tipo === 'DEVOLUCION' && m.pendiente){
    const pe = pendientesLocal(p.c).find(x => x.id === m.pendiente);
    if (!pe) throw new Error('Ese préstamo ya no está pendiente.');
    if (q > pe.falta + 1e-9) throw new Error('Solo faltan devolver ' + pe.falta + ' ' + p.u + '.');
  }
  const efs = efectosLocal({tipo: tipo, cod: p.c, q: q, ub: ub, eo: eo, dest: dest, ed: ed});
  const acum = {};
  efs.forEach(e => {
    const k = claveSt(e[0], e[1], e[2]);
    acum[k] = (acum[k] == null ? cantLocal(e[0], e[1], e[2]) : acum[k]) + e[3];
    if (acum[k] < -1e-9) throw new Error('En ' + e[1] + (e[2] !== 'DISPONIBLE' ? ' (' + EST[e[2]] + ')' : '') + ' solo hay ' + fmtN(cantLocal(e[0], e[1], e[2])) + ' ' + p.u + '.');
  });
  const o = {opid: nuevoOpid(), ms: Date.now(), u: S.u, m: Object.assign({}, m, {tipo: tipo, codigo: p.c}),
             c: p.c, d: p.d, un: p.u, q: q, efs: efs, est: 'pendiente', error: ''};
  OFF.cola.push(o); guardarCola(); recalcLocal();
  const nuevos = {};
  efs.forEach(e => { nuevos[e[1] + (e[2] !== 'DISPONIBLE' ? ' · ' + EST[e[2]] : '')] = cantLocal(e[0], e[1], e[2]); });
  programarSync(400);
  return {ok: true, id: OFF.en ? '☁️ subiendo' : '⏳ en cola', fecha: fechaCorta(new Date()), tipo: tipo, codigo: p.c, producto: p.d,
          unidad: p.u, cantidad: q, ubicacion: ub, destino: dest, stock: nuevos, enCola: true};
}

/* ---------- Sincronización ---------- */
function programarSync(ms){ clearTimeout(OFF.timer); OFF.timer = setTimeout(() => sincronizarCola(false), ms || 800); }
async function sincronizarCola(manual){
  if (OFF.sinc || !S.u || !S.pin) return;
  const pend = OFF.cola.filter(o => o.est === 'pendiente' && o.u === S.u);
  if (!pend.length){ if (manual) await refrescarSnap(true); return; }
  OFF.sinc = true; pintarChipSync();
  try {
    const lote = pend.slice(0, 15);
    const r = await remoto('sincronizar', [S.u, S.pin, lote.map(o => ({opid: o.opid, ms: o.ms, m: o.m})), dispositivo()], 180000);
    const porId = {}; r.res.forEach(x => porId[x.opid] = x);
    let err = 0, ok = 0;
    OFF.cola = OFF.cola.filter(o => {
      const x = porId[o.opid]; if (!x) return true;
      if (x.ok){ ok++; return false; }
      o.est = 'error'; o.error = x.error; err++; return true;
    });
    guardarCola(); guardarSnap(r.snap); recalcLocal(); aplicarSnap(r.snap);
    if (err) toast(`⚠️ ${err} movimiento(s) no se pudieron guardar. Toca <b>⚠️</b> arriba para revisarlos.`, true);
    else if (manual) toast(`☁️ ${ok} movimiento(s) subidos a la hoja.`);
    if (OFF.cola.some(o => o.est === 'pendiente' && o.u === S.u)) programarSync(300);
  } catch(e){
    if (/SESION:/.test(e.message)){ toast(esc(e.message.replace(/^.*SESION:\s*/, '')), true); salir(); }
    else if (manual) toast(e.red ? '📴 Sin conexión. Se subirán solos cuando vuelva la señal.' : '⚠️ ' + esc(e.message), true);
  } finally { OFF.sinc = false; pintarChipSync(); }
}
async function refrescarSnap(avisar){
  try {
    const sn = await remoto('snapshot', [S.u, S.pin]);
    guardarSnap(sn); recalcLocal(); aplicarSnap(sn);
    if (avisar) toast('🔄 Datos actualizados.');
    return sn;
  } catch(e){
    if (/SESION:/.test(e.message)){ toast(esc(e.message.replace(/^.*SESION:\s*/, '')), true); salir(); }
    else if (avisar) toast(e.red ? '📴 Sin conexión: sigues trabajando con los datos guardados.' : '⚠️ ' + esc(e.message), true);
    return null;
  }
}
/** Actualiza catálogos sin interrumpir lo que el usuario está haciendo */
function aplicarSnap(sn){
  if (!sn || !S.u) return;
  S.productos = sn.productos; S.proyectos = sn.proyectos; S.ubicaciones = sn.ubicaciones; S.familias = sn.familias;
  S.areas = sn.areas; S.unidades = sn.unidades; S.cfg = sn.cfg;
  indexar();
  try { pintarProyectosSelect(); } catch(e){}
  if (S.prod){ const np = S.productos.find(p => p.c === S.prod.c); if (np) S.prod = np; }
}

/* ---------- Rutas: qué se responde local y qué va al servidor ---------- */
async function rutaApi(fn, args){
  if (fn === 'buscar') return buscarOffline(args[0]);
  if (fn === 'registrar') return registrarOffline(args[0]);
  if (fn === 'iniciar'){
    const sn = await refrescarSnap(false);
    if (sn) return sn;
    if (OFF.snap) return Object.assign({}, OFF.snap, {usuario: S.u});
    throw new Error('Sin conexión y sin datos guardados.');
  }
  if (LECTURAS.indexOf(fn) >= 0){
    const k = 'c_' + fn + '|' + JSON.stringify(args).slice(0, 200);
    try { const d = await remoto(fn, [S.u, S.pin].concat(args)); lsSet(k, {t: Date.now(), d: d}); return d; }
    catch(e){
      if (!e.red) throw e;
      const c = lsGet(k);
      if (c){ toast('📴 Sin conexión: datos guardados ' + hace(c.t) + '.'); return c.d; }
      throw new Error('Sin conexión, y esta consulta aún no está guardada en el celular.');
    }
  }
  try {
    const d = await remoto(fn, [S.u, S.pin].concat(args));
    setTimeout(() => refrescarSnap(false), 300);
    return d;
  } catch(e){
    if (e.red) throw new Error('Sin conexión: esta acción necesita internet. Los movimientos (entradas, salidas, traslados…) sí se guardan sin señal.');
    throw e;
  }
}
async function api(fn, ...args){
  try { return await rutaApi(fn, args); }
  catch(e){
    if (/SESION:/.test(e.message)){ toast(esc(e.message.replace(/^.*SESION:\s*/, '')), true); salir(); }
    e.message = String(e.message).replace(/^Error:\s*/, '');
    throw e;
  }
}

/* ---------- Inicio de sesión ---------- */
async function offNombres(){
  try { const n = await remoto('nombresUsuarios', []); lsSet('nombres', n); return n; }
  catch(e){ const n = lsGet('nombres'); if (n) return n; throw errRed('Sin conexión. La primera vez necesitas internet para entrar.'); }
}
async function offEntrar(u, pin){
  try {
    const sn = await remoto('snapshot', [u, pin]);
    lsSet('h_' + sn.usuario.toUpperCase(), await hashPin(sn.usuario, pin));
    guardarSnap(sn); OFF.cola = lsGet('cola') || []; recalcLocal();
    return sn;
  } catch(e){
    if (!e.red) throw e;
    const h = lsGet('h_' + String(u).toUpperCase());
    if (h && OFF.snap && h === await hashPin(u, pin)){
      toast('📴 Entraste sin conexión. Trabajas con los datos guardados.');
      return Object.assign({}, OFF.snap, {usuario: u});
    }
    throw errRed('Sin conexión. Para entrar sin señal, antes debes haber entrado una vez con internet en este celular.');
  }
}

/* ---------- Indicador y panel de sincronización ---------- */
function pintarChipSync(){
  const b = document.getElementById('chipSync'); if (!b) return;
  const mias = OFF.cola.filter(o => o.u === S.u);
  const pend = mias.filter(o => o.est === 'pendiente').length, err = mias.filter(o => o.est === 'error').length;
  let t, c;
  if (err){ t = '⚠️ ' + err; c = 'err'; }
  else if (OFF.sinc){ t = '☁️ …'; c = 'sync'; }
  else if (pend){ t = (OFF.en ? '☁️ ' : '📴 ') + pend; c = 'pend'; }
  else if (!OFF.en){ t = '📴'; c = 'off'; }
  else { t = '✓'; c = 'ok'; }
  b.textContent = t; b.className = c;
  b.title = err ? 'Movimientos con error' : pend ? pend + ' por subir' : OFF.en ? 'Todo subido' : 'Sin conexión';
  if (!document.getElementById('mSync').classList.contains('oculto')) pintarPanelSync();
}
function abrirSync(){ pintarPanelSync(); abrirModal('mSync'); }
function pintarPanelSync(){
  const mias = OFF.cola.filter(o => o.u === S.u);
  const otros = OFF.cola.length - mias.length;
  const est = OFF.en ? '🟢 Con conexión' : '📴 Sin conexión';
  $('syEstado').innerHTML = `${est}<br><small>Datos del ${esc((OFF.snap && OFF.snap.ts) || '—')}${OFF.tSnap ? ' (' + hace(OFF.tSnap) + ')' : ''} · app ${APP_VER}</small>` +
    (otros ? `<div class="aviso">Hay ${otros} movimiento(s) de otro usuario en este celular. Se subirán cuando esa persona entre.</div>` : '');
  $('syLista').innerHTML = mias.length ? mias.slice().reverse().map(o => {
    const T = TIPOS[o.m.tipo] || {t: o.m.tipo};
    return `<div class="item"><div class="top"><span><span class="badge ${o.m.tipo}">${esc(T.t)}</span> ${o.est === 'error' ? '<span class="badge SALIDA">Error</span>' : '<span class="badge">Por subir</span>'}</span><span>${esc(fechaCorta(new Date(o.ms)))}</span></div>
      <div><b>${fmtN(o.q)} ${esc(o.un)}</b> · ${esc(o.d)}</div><div class="meta">${esc(o.m.ubicacion)}${o.m.destino ? ' → ' + esc(o.m.destino) : ''}</div>
      ${o.est === 'error' ? `<div class="aviso error">${esc(o.error)}</div><div class="fila" style="margin-top:8px"><button class="btn sm" onclick="reintentarOp('${o.opid}')">Reintentar</button> <button class="btn sm peligro" onclick="descartarOp('${o.opid}')">Descartar</button></div>` : ''}</div>`;
  }).join('') : '<div class="ayuda">✓ No hay nada pendiente: todo está en la hoja.</div>';
}
function reintentarOp(id){ const o = OFF.cola.find(x => x.opid === id); if (o){ o.est = 'pendiente'; o.error = ''; guardarCola(); recalcLocal(); sincronizarCola(true); } }
function descartarOp(id){ OFF.cola = OFF.cola.filter(x => x.opid !== id); guardarCola(); recalcLocal(); pintarPanelSync(); toast('Movimiento descartado. No se guardó en la hoja.'); }

/* ---------- Arranque de la capa ---------- */
function iniciarCapaOffline(){
  OFF.snap = lsGet('snap'); OFF.tSnap = lsGet('tSnap') || 0; OFF.cola = lsGet('cola') || [];
  OFF.en = navigator.onLine !== false;
  window.addEventListener('online', () => { OFF.en = true; pintarChipSync(); programarSync(500); });
  window.addEventListener('offline', () => { OFF.en = false; pintarChipSync(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.u) tickSync(); });
  setInterval(() => { if (document.visibilityState === 'visible' && S.u) tickSync(); }, 30000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
function tickSync(){
  if (OFF.cola.some(o => o.est === 'pendiente' && o.u === S.u)) sincronizarCola(false);
  else if (Date.now() - OFF.tSnap > 3 * 60000) refrescarSnap(false);
}
