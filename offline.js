/* ================= v2.4 · Conexión, copia local y sincronización =================
 * La app guarda en el celular una copia de productos, stock y movimientos.
 * Buscar y escanear se responde con esa copia (instantáneo, con o sin señal).
 * Cada movimiento se guarda primero en el celular (cola) y se sube a la hoja
 * en segundo plano. Sin señal, espera y se sube solo cuando vuelve.
 */
const API_URL = 'https:' + String.fromCharCode(47, 47) + 'script.google.com/macros/s/AKfycbyXNamoz37LfEsn67XloeSKID490RBDJtJO9ZrYTswXYtp4bqABtJDuyFGOwMFijaoVLA/exec';
const APP_VER = '2.6.0';
const OFF = { en: true, snap: null, ST: {}, TOT: {}, FOTOS: {}, FT: {}, DET: {}, cola: [], sinc: false, tSnap: 0, dispositivo: '', timer: null };
const LECTURAS = ['historial', 'porEstado', 'stockBajo', 'pendientes', 'listaProyectos', 'resumenProyecto', 'kardex',
                  'listaKardex', 'resumenInicio', 'listaMantenimiento', 'detalleMaquina', 'consumoArea', 'sinMovimiento'];

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
  const t = {};
  Object.keys(m).forEach(k => { const z = k.split('||'); if (z[2] === 'DISPONIBLE') t[z[0]] = r3((t[z[0]] || 0) + m[k]); });
  OFF.TOT = t;
}
/** Stock disponible total de un producto (todas las ubicaciones), con lo que está en cola */
function stockTotalLocal(c){ return OFF.TOT[c] || 0; }
function esProvisional(c){ return OFF.cola.some(o => o.k === 'CREAR' && o.c === c); }
function r3(x){ return Math.round(x * 1000) / 1000; }
function cantLocal(c, u, e){ return OFF.ST[claveSt(c, u, e)] || 0; }
function prodLocal(cod){
  const k = String(cod || '').trim().toUpperCase(); if (!k) return null;
  return S.productos.find(p => p.c.toUpperCase() === k || barras(p).indexOf(k) >= 0) || null;
}
/** Un producto puede tener varios códigos de barras separados por " / " (misma cosa, otra marca o empaque) */
function barras(p){ return String((p && p.bar) || '').toUpperCase().split(/\s*[\/;,]\s*/).filter(Boolean); }
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
  const cerrados = {};
  OFF.cola.forEach(o => { if (o.est !== 'error' && o.m && o.m.tipo === 'DEVOLUCION' && o.m.pendiente){
    usados[o.m.pendiente] = r3((usados[o.m.pendiente] || 0) + o.q);
    if (o.m.restoConsumido) cerrados[o.m.pendiente] = true; } });
  return ((OFF.snap && OFF.snap.pendientes) || []).filter(x => (!c || x.c === c) && !cerrados[x.id])
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
  const cola = OFF.cola.filter(o => o.c === p.c && !o.k).slice().reverse().map(movDeCola);
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
  else if (q === 0 && tipo === 'DEVOLUCION' && m.restoConsumido && m.pendiente){ /* no vuelve nada: todo se gastó */ }
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
  let consumido = 0;
  if (tipo === 'DEVOLUCION' && m.pendiente && m.restoConsumido){
    const pe = pendientesLocal(p.c).find(x => x.id === m.pendiente);
    consumido = pe ? r3(pe.falta - q) : 0;
  }
  const o = {opid: nuevoOpid(), ms: Date.now(), u: S.u, m: Object.assign({}, m, {tipo: tipo, codigo: p.c}),
             c: p.c, d: p.d, un: p.u, q: q, efs: efs, est: 'pendiente', error: ''};
  OFF.cola.push(o); guardarCola(); recalcLocal();
  const nuevos = {};
  efs.forEach(e => { nuevos[e[1] + (e[2] !== 'DISPONIBLE' ? ' · ' + EST[e[2]] : '')] = cantLocal(e[0], e[1], e[2]); });
  programarSync(400);
  if (q === 0 && consumido > 0)
    return {ok: true, id: OFF.en ? '☁️ subiendo' : '⏳ en cola', fecha: fechaCorta(new Date()), tipo: 'CONSUMO', codigo: p.c, producto: p.d,
            unidad: p.u, cantidad: consumido, ubicacion: ub, destino: '', stock: {}, enCola: true};
  return {ok: true, id: OFF.en ? '☁️ subiendo' : '⏳ en cola', fecha: fechaCorta(new Date()), tipo: tipo, codigo: p.c, producto: p.d,
          unidad: p.u, cantidad: q, ubicacion: ub, destino: dest, stock: nuevos, enCola: true, consumido: consumido};
}

/** Producto nuevo sin señal: código provisional (ej. CIN-N7KQ) que se cambia por el definitivo al subir */
function crearProductoOffline(d){
  const desc = String(d.descripcion || '').trim();
  if (!desc) throw new Error('Escribe la descripción del producto.');
  const fam = S.familias.find(f => f.p === String(d.familia || '').trim().toUpperCase());
  if (!fam) throw new Error('Elige la familia.');
  const igual = S.productos.find(x => x.d.toUpperCase() === desc.toUpperCase());
  if (igual) throw new Error('Ya existe "' + igual.d + '" con el código ' + igual.c + '.');
  const bar = String(d.codBarras || '').trim();
  if (bar){
    if (barras({bar: bar}).some(b => prodLocal(b))) throw new Error('El código de barras ' + bar + ' ya pertenece a otro producto.');
    if (ubicTodas().some(x => x.c.toUpperCase() === bar.toUpperCase())) throw new Error('Ese código es de una ubicación, no de un producto.');
  }
  const unidad = String(d.unidad || '').trim().toUpperCase() || 'UND';
  const pres = String(d.presentacion || '').trim().toUpperCase();
  const fac = pres ? (parseFloat(String(d.factor).replace(',', '.')) || 0) : 0;
  if (pres && fac <= 0) throw new Error('Indica cuántas ' + unidad + ' trae cada ' + pres + '.');
  let tmp;
  do { tmp = fam.p + '-N' + Math.random().toString(36).slice(2, 5).toUpperCase(); } while (prodLocal(tmp));
  const kdx = ['NO', 'DIARIO', 'SEMANAL'].indexOf(String(d.kardex || '').toUpperCase()) >= 0 ? String(d.kardex).toUpperCase() : 'NO';
  const p = {c: tmp, d: desc, fam: fam.f, cla: String(d.clase || '').trim(), mar: String(d.marca || '').trim(), u: unidad, pres: pres, fac: fac,
             bar: bar, ubh: String(d.ubicHabitual || '').trim(), min: parseFloat(d.minimo) || 0, kdx: kdx, cp: 0, act: true,
             notas: String(d.notas || '').trim(), tmp: true};
  OFF.cola.push({opid: nuevoOpid(), ms: Date.now(), u: S.u, k: 'CREAR', d: d, c: tmp, p: p, m: {tipo: 'CREAR', ubicacion: p.ubh},
                 un: unidad, q: 0, efs: [], est: 'pendiente', error: ''});
  guardarCola(); programarSync(400);
  return p;
}
/** Productos creados sin señal que aún no están en la copia del servidor */
function productosEnCola(){ return OFF.cola.filter(o => o.k === 'CREAR').map(o => o.p); }
/** Cambia el código provisional por el definitivo en todo lo que sigue en la cola */
function cambiarCodigo(tmp, real){
  OFF.cola.forEach(o => {
    if (o.c === tmp) o.c = real;
    if (o.m && o.m.codigo === tmp) o.m.codigo = real;
    (o.efs || []).forEach(e => { if (e[0] === tmp) e[0] = real; });
  });
  Object.keys(OFF.FOTOS).filter(k => k.split('#')[0] === tmp).forEach(k => { const nk = real + k.slice(tmp.length); OFF.FOTOS[nk] = OFF.FOTOS[k]; delete OFF.FOTOS[k]; idbPut(nk, OFF.FOTOS[nk]); idbDel(k); });
  OFF.cola.forEach(o => { if ((o.k === 'FOTO' || o.k === 'DET') && o.c.split('#')[0] === tmp) o.c = real + o.c.slice(tmp.length); });
  if (OFF.DET[tmp]){ OFF.DET[real] = OFF.DET[tmp]; delete OFF.DET[tmp]; }
  if (S.prod && S.prod.c === tmp){ S.prod = Object.assign({}, S.prod, {c: real, tmp: false}); const c = document.getElementById('codigo'); if (c && c.value === tmp) c.value = real; }
  toast('☁️ Producto nuevo subido: ' + esc(tmp) + ' → <b>' + esc(real) + '</b>');
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
    const r = await remoto('sincronizar', [S.u, S.pin, lote.map(o => o.k === 'CREAR' ? {opid: o.opid, ms: o.ms, k: 'CREAR', d: o.d, tmp: o.c}
                                                       : o.k === 'FOTO' ? {opid: o.opid, ms: o.ms, k: 'FOTO', c: o.c, data: o.data}
                                                       : o.k === 'DET' ? {opid: o.opid, ms: o.ms, k: 'DET', c: o.c, d: o.d}
                                                       : {opid: o.opid, ms: o.ms, m: o.m}), dispositivo()], 180000);
    const porId = {}; r.res.forEach(x => porId[x.opid] = x);
    r.res.forEach(x => { if (x.ok && x.tmp && x.cod) cambiarCodigo(x.tmp, x.cod); });
    let err = 0, ok = 0;
    OFF.cola = OFF.cola.filter(o => {
      const x = porId[o.opid]; if (!x) return true;
      if (x.ok){ ok++; return false; }
      o.est = 'error'; o.error = x.error; err++; return true;
    });
    lote.forEach(o => { if (o.k === 'FOTO' && porId[o.opid] && porId[o.opid].ok && r.snap.fotos){ if (r.snap.fotos[o.c]) OFF.FT[o.c] = r.snap.fotos[o.c]; else delete OFF.FT[o.c]; lsSet('fotoT', OFF.FT); } });
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
  const enCola = productosEnCola().filter(p => !sn.productos.some(x => x.c === p.c));
  S.productos = sn.productos.concat(enCola); S.proyectos = sn.proyectos; S.ubicaciones = sn.ubicaciones; S.familias = sn.familias;
  S.areas = sn.areas; S.unidades = sn.unidades; S.cfg = sn.cfg;
  indexar();
  try { pintarProyectosSelect(); } catch(e){}
  bajarFotos(sn);
  armarDetalles(sn);
  if (S.prod){ const np = S.productos.find(p => p.c === S.prod.c); if (np) S.prod = np; }
}

/* ---------- Rutas: qué se responde local y qué va al servidor ---------- */
async function rutaApi(fn, args){
  if (fn === 'buscar') return buscarOffline(args[0]);
  if (fn === 'registrar') return registrarOffline(args[0]);
  if (fn === 'crearProducto'){
    if (OFF.en){
      try { const p = await remoto(fn, [S.u, S.pin].concat(args)); setTimeout(() => refrescarSnap(false), 300); return p; }
      catch(e){ if (!e.red) throw e; }
    }
    return crearProductoOffline(args[0]);
  }
  if (fn === 'guardarDetalle') return guardarDetalleLocal(args[0], args[1]);
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
    guardarSnap(sn); OFF.cola = lsGet('cola') || []; recalcLocal(); armarDetalles(sn);
    setTimeout(() => bajarFotos(sn), 1500);
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
  $('syEstado').innerHTML = `${est}<br><small>Datos del ${esc((OFF.snap && OFF.snap.ts) || '—')}${OFF.tSnap ? ' (' + hace(OFF.tSnap) + ')' : ''} · app ${APP_VER} · <a href="#" onclick="actualizarApp();return false" style="color:#cfc6ff">buscar actualización</a></small>` +
    (otros ? `<div class="aviso">Hay ${otros} movimiento(s) de otro usuario en este celular. Se subirán cuando esa persona entre.</div>` : '');
  $('syLista').innerHTML = mias.length ? mias.slice().reverse().map(o => {
    const T = o.k === 'CREAR' ? {t: 'Producto nuevo'} : o.k === 'FOTO' ? {t: o.data ? '📷 Foto' : '🗑️ Quitar foto'} : o.k === 'DET' ? {t: '📋 Datos adicionales'} : (TIPOS[o.m.tipo] || {t: o.m.tipo});
    return `<div class="item"><div class="top"><span><span class="badge ${o.m.tipo}">${esc(T.t)}</span> ${o.est === 'error' ? '<span class="badge SALIDA">Error</span>' : '<span class="badge">Por subir</span>'}</span><span>${esc(fechaCorta(new Date(o.ms)))}</span></div>
      <div>${o.k === 'FOTO' || o.k === 'DET' ? `${esc(o.c)} · ${esc((prodLocal(o.c.split('#')[0]) || {}).d || '')}` : o.k === 'CREAR' ? `<b class="tmpCod">${esc(o.c)}</b> · ${esc(o.p.d)}` : `<b>${fmtN(o.q)} ${esc(o.un)}</b> · ${esc(o.d)}`}</div><div class="meta">${esc(o.m.ubicacion)}${o.m.destino ? ' → ' + esc(o.m.destino) : ''}</div>
      ${o.est === 'error' ? `<div class="aviso error">${esc(o.error)}</div><div class="fila" style="margin-top:8px"><button class="btn sm" onclick="reintentarOp('${o.opid}')">Reintentar</button> <button class="btn sm peligro" onclick="descartarOp('${o.opid}')">Descartar</button></div>` : ''}</div>`;
  }).join('') : '<div class="ayuda">✓ No hay nada pendiente: todo está en la hoja.</div>';
}
function reintentarOp(id){ const o = OFF.cola.find(x => x.opid === id); if (o){ o.est = 'pendiente'; o.error = ''; guardarCola(); recalcLocal(); sincronizarCola(true); } }
function descartarOp(id){
  const o = OFF.cola.find(x => x.opid === id);
  if (o && o.k === 'CREAR'){ OFF.cola = OFF.cola.filter(x => x.c !== o.c); S.productos = S.productos.filter(p => p.c !== o.c); indexar(); }
  OFF.cola = OFF.cola.filter(x => x.opid !== id); guardarCola(); recalcLocal(); pintarPanelSync(); toast('Movimiento descartado. No se guardó en la hoja.'); }

/* ---------- Arranque de la capa ---------- */
function iniciarCapaOffline(){
  OFF.FT = lsGet('fotoT') || {}; cargarFotosLocal();
  OFF.snap = lsGet('snap');
  try { OFF.cola = lsGet('cola') || []; armarDetalles(OFF.snap); } catch(e){} OFF.tSnap = lsGet('tSnap') || 0; OFF.cola = lsGet('cola') || [];
  OFF.en = navigator.onLine !== false;
  window.addEventListener('online', () => { OFF.en = true; pintarChipSync(); programarSync(500); });
  window.addEventListener('offline', () => { OFF.en = false; pintarChipSync(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.u) tickSync(); });
  setInterval(() => { if (document.visibilityState === 'visible' && S.u) tickSync(); }, 30000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
    const habia = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(reg => {
      OFF.reg = reg;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    /* Cuando llega una versión nueva de la app, se recarga sola (solo si no estás a mitad de algo) */
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habia || OFF.recargando) return;
      OFF.recargando = true;
      const ocupado = (document.getElementById('codigo') || {}).value || document.querySelector('.modal:not(.oculto)');
      if (ocupado) toast('🔄 Hay una versión nueva de la app. Ciérrala y ábrela para usarla.');
      else location.reload();
    });
  }
}
/** Botón del panel: busca versión nueva y recarga */
async function actualizarApp(){
  if (!navigator.onLine){ toast('📴 Necesitas señal para actualizar la app.', true); return; }
  toast('🔄 Buscando versión nueva…');
  try { if (OFF.reg) await OFF.reg.update(); } catch(e){}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch(e){}
  setTimeout(() => location.reload(), 600);
}
function tickSync(){
  if (OFF.cola.some(o => o.est === 'pendiente' && o.u === S.u)) sincronizarCola(false);
  else if (Date.now() - OFF.tSnap > 3 * 60000) refrescarSnap(false);
}

/* ================= Fotos de referencia (v2.4.3) =================
 * Una foto pequeña por producto. Se guarda en el celular (IndexedDB) para verla sin señal
 * y se sube a la hoja FOTOS. Sin señal queda en la cola como cualquier movimiento. */
let _db = null;
function idb(){
  if (_db) return _db;
  _db = new Promise((ok, mal) => {
    try {
      const r = indexedDB.open('inv3_fotos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('f');
      r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
    } catch(e){ mal(e); }
  });
  return _db;
}
async function idbPut(k, v){ try { const d = await idb(); d.transaction('f', 'readwrite').objectStore('f').put(v, k); } catch(e){} }
async function idbDel(k){ try { const d = await idb(); d.transaction('f', 'readwrite').objectStore('f').delete(k); } catch(e){} }
async function cargarFotosLocal(){
  try {
    const d = await idb();
    const st = d.transaction('f').objectStore('f');
    const req = st.openCursor();
    req.onsuccess = () => { const c = req.result; if (c){ OFF.FOTOS[c.key] = c.value; c.continue(); } };
  } catch(e){}
}
function fotoDe(c){ return OFF.FOTOS[c] || ''; }
/** Baja en segundo plano las fotos nuevas o cambiadas desde la última vez */
async function bajarFotos(sn){
  if (!sn || !sn.fotos || OFF.bajandoFotos || !OFF.en) return;
  const pend = OFF.cola.filter(o => o.k === 'FOTO').map(o => o.c);
  Object.keys(OFF.FOTOS).filter(c => !sn.fotos[c] && OFF.FT[c] && pend.indexOf(c) < 0).forEach(c => { delete OFF.FOTOS[c]; delete OFF.FT[c]; idbDel(c); });
  lsSet('fotoT', OFF.FT);
  const faltan = Object.keys(sn.fotos).filter(c => OFF.FT[c] !== sn.fotos[c] && pend.indexOf(c) < 0);
  if (!faltan.length) return;
  OFF.bajandoFotos = true;
  try {
    for (let i = 0; i < faltan.length; i += 15){
      const lote = faltan.slice(i, i + 15);
      const r = await remoto('fotos', [S.u, S.pin, lote], 60000);
      Object.keys(r).forEach(c => {
        const url = 'data:image/jpeg;base64,' + r[c];
        OFF.FOTOS[c] = url; idbPut(c, url); OFF.FT[c] = sn.fotos[c];
      });
      lsSet('fotoT', OFF.FT);
    }
  } catch(e){} finally { OFF.bajandoFotos = false; }
}
/** Achica la foto a ~480 px y menos de 30 KB */
async function comprimirFoto(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
    let lado = 480, q = 0.72, out = '';
    for (let n = 0; n < 8; n++){
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      out = cv.toDataURL('image/jpeg', q);
      if (out.length < 40000) break;
      if (q > 0.45) q -= 0.12; else lado = Math.round(lado * 0.8);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
let _fotoPara = '', _fotoCb = null;
/** fuente: 'camara' abre la cámara directo; 'galeria' abre las fotos guardadas. cb(file) opcional */
function pedirFoto(c, fuente, cb){
  if (!c) return;
  if (!fuente){ abrirFotos(c); return; }
  _fotoPara = c; _fotoCb = cb || null;
  const id = fuente === 'camara' ? 'inpFotoCam' : 'inpFotoRef';
  let inp = document.getElementById(id);
  if (!inp){
    inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = id; inp.style.display = 'none';
    if (fuente === 'camara') inp.setAttribute('capture', 'environment');
    inp.addEventListener('change', async ev => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      if (_fotoCb) _fotoCb(f); else await guardarFotoLocal(_fotoPara, f);
    });
    document.body.appendChild(inp);
  }
  inp.click();
}
/** Quita una foto (extra o principal) */
function quitarFotoLocal(c){
  delete OFF.FOTOS[c]; idbDel(c);
  OFF.cola = OFF.cola.filter(o => !(o.k === 'FOTO' && o.c === c && o.est !== 'enviando'));
  OFF.cola.push({opid: nuevoOpid(), ms: Date.now(), u: S.u, k: 'FOTO', c: c, data: '', m: {tipo: 'FOTO', ubicacion: ''}, un: '', q: 0, efs: [], est: 'pendiente', error: ''});
  guardarCola(); programarSync(400);
  try { trasFoto(c.split('#')[0]); } catch(e){}
}
/** Fotos extra de un código: [{k:'COD#1', n:1, url, nota}] */
function fotosExtra(c){
  const nf = (detDe(c).nf) || {};
  return [1, 2, 3, 4].map(n => ({k: c + '#' + n, n: n, url: OFF.FOTOS[c + '#' + n] || '', nota: nf[n] || ''}));
}

/* ---------- Datos adicionales (medidas, peso, color, estado físico, responsable) ---------- */
function armarDetalles(sn){
  const d = Object.assign({}, (sn && sn.det) || {});
  OFF.cola.filter(o => o.k === 'DET').forEach(o => { d[o.c] = mezclarDet(d[o.c], o.d); });
  OFF.DET = d;
}
function mezclarDet(prev, nd){
  const r = Object.assign({med: '', peso: '', col: '', ef: '', resp: '', nf: {}}, prev || {});
  ['med', 'peso', 'col', 'ef', 'resp'].forEach(k => { if (nd[k] !== undefined) r[k] = nd[k]; });
  r.nf = Object.assign({}, r.nf);
  if (nd.nf) Object.keys(nd.nf).forEach(k => { if (nd.nf[k]) r.nf[k] = nd.nf[k]; else delete r.nf[k]; });
  return r;
}
function detDe(c){ return OFF.DET[c] || {med: '', peso: '', col: '', ef: '', resp: '', nf: {}}; }
function guardarDetalleLocal(c, d){
  OFF.DET[c] = mezclarDet(OFF.DET[c], d);
  OFF.cola.push({opid: nuevoOpid(), ms: Date.now(), u: S.u, k: 'DET', c: c, d: d, m: {tipo: 'DET', ubicacion: ''}, un: '', q: 0, efs: [], est: 'pendiente', error: ''});
  guardarCola(); programarSync(400);
  return {c: c, det: OFF.DET[c]};
}
async function guardarFotoLocal(c, file){
  try {
    toast('📷 Procesando foto…');
    const url = await comprimirFoto(file);
    OFF.FOTOS[c] = url; idbPut(c, url);
    OFF.cola = OFF.cola.filter(o => !(o.k === 'FOTO' && o.c === c && o.est !== 'enviando'));
    OFF.cola.push({opid: nuevoOpid(), ms: Date.now(), u: S.u, k: 'FOTO', c: c, data: url.split(',')[1], m: {tipo: 'FOTO', ubicacion: ''},
                   un: '', q: 0, efs: [], est: 'pendiente', error: ''});
    guardarCola(); programarSync(400);
    toast('✅ Foto guardada' + (OFF.en ? '. Subiendo…' : '. Se subirá cuando haya señal.'));
    try { trasFoto(c.split('#')[0]); } catch(e){}
  } catch(e){ toast('⚠️ No se pudo usar esa foto. Intenta con otra.', true); }
}
function verFoto(c){
  const u = fotoDe(c); if (!u) return;
  let v = document.getElementById('visorFoto');
  if (!v){
    v = document.createElement('div'); v.id = 'visorFoto';
    v.style.cssText = 'position:fixed;inset:0;background:rgba(5,1,15,.92);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px';
    v.onclick = () => v.remove();
    document.body.appendChild(v);
  }
  const z = c.split('#'), nota = z[1] ? ((detDe(z[0]).nf || {})[z[1]] || '') : '';
  v.style.flexDirection = 'column';
  v.innerHTML = `<img src="${u}" style="max-width:100%;max-height:84vh;border-radius:12px">${nota ? `<div style="color:#fff;margin-top:10px;font-size:15px">${esc(nota)}</div>` : ''}`;
}
