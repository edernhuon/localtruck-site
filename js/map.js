/* LocalTruck – carte interactive « slippy map » sur fond OpenStreetMap (sans bibliothèque).
 * Glisser pour déplacer, molette / double-clic / pincement pour zoomer, repères HTML, cercle de rayon. */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const { h, icon } = MFT.ui;
  const TILE_URL = (z, x, y) => String((window.MFT_CONFIG && window.MFT_CONFIG.tileUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace('{z}', z).replace('{x}', x).replace('{y}', y);

  class MapView {
    constructor(opts) {
      this.o = Object.assign({ lat: 46.6, lng: 2.4, zoom: 6, minZoom: 3, maxZoom: 19, zoomControls: true, onLocate: null, onClick: null, ctrlsBottom: 14 }, opts || {});
      this.center = { lat: this.o.lat, lng: this.o.lng }; this.zoom = this.o.zoom;
      this.w = 0; this.h = 0; this.tiles = new Map(); this.markers = new Map(); this.handlers = {}; this.circle = null; this.userDot = null;
      this._raf = 0; this._moved = false; this._justDragged = false; this._ptrs = new Map(); this._wheelAcc = 0; this._wheelT = 0;
      this.layerGrid = h('div', { class: 'layer grid' });
      this.layerTiles = h('div', { class: 'layer tiles' });
      this.layerOver = h('div', { class: 'layer', style: { pointerEvents: 'none' } });
      this.layerMarkers = h('div', { class: 'layer', style: { pointerEvents: 'none' } });
      this.attr = h('div', { class: 'attr', title: 'Données cartographiques © contributeurs OpenStreetMap', onClick: (e) => { e.stopPropagation(); MFT.platform.openExternal('https://www.openstreetmap.org/copyright'); } }, '© OpenStreetMap');
      this.ctrls = h('div', { class: 'ctrls', style: { bottom: this.o.ctrlsBottom + 'px' } });
      if (this.o.onLocate) this.ctrls.appendChild(h('button', { 'aria-label': 'Ma position', title: 'Ma position', onClick: () => this.o.onLocate() }, icon('locate')));
      if (this.o.zoomControls) {
        this.ctrls.appendChild(h('button', { 'aria-label': 'Zoom +', onClick: () => this.zoomBy(1) }, icon('plus')));
        this.ctrls.appendChild(h('button', { 'aria-label': 'Zoom −', onClick: () => this.zoomBy(-1) }, icon('minus')));
      }
      this.el = h('div', { class: 'map', tabindex: '-1' }, this.layerGrid, this.layerTiles, this.layerOver, this.layerMarkers, this.attr, this.ctrls);
      this._bind();
      this._ro = new ResizeObserver(() => requestAnimationFrame(() => { this._measure(); this.render(); }));
      this._ro.observe(this.el);
    }

    /* ------------------------------------------------------------ événements */
    on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); return this; }
    emit(evt, a) { (this.handlers[evt] || []).forEach((fn) => fn(a)); }
    _measure() { this.w = this.el.clientWidth; this.h = this.el.clientHeight; }
    getCenter() { return { lat: this.center.lat, lng: this.center.lng }; }
    getZoom() { return this.zoom; }
    /** Origine pixel (coin haut-gauche) de la vue au zoom courant. */
    _origin() { const p = C.project(this.center.lat, this.center.lng, this.zoom); return { x: p.x - this.w / 2, y: p.y - this.h / 2 }; }
    pointToLatLng(px, py) { const o = this._origin(); return C.unproject(o.x + px, o.y + py, this.zoom); }
    latLngToPoint(lat, lng) { const o = this._origin(); const p = C.project(lat, lng, this.zoom); return { x: p.x - o.x, y: p.y - o.y }; }

    _bind() {
      const el = this.el;
      const ignore = (t) => t.closest && t.closest('.ctrls, .attr');
      el.addEventListener('pointerdown', (e) => {
        if (ignore(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
        this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const rect = el.getBoundingClientRect();
        if (this._ptrs.size === 1) {
          this._drag = { sx: e.clientX, sy: e.clientY, o: C.project(this.center.lat, this.center.lng, this.zoom), moved: false };
          this._moved = false; el.classList.add('drag');
        } else if (this._ptrs.size === 2) {
          const [a, b] = [...this._ptrs.values()];
          this._pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: this.zoom, cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top, done: false };
        }
      });
      window.addEventListener('pointermove', this._onMove = (e) => {
        if (!this._ptrs.has(e.pointerId)) return;
        this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._pinch && this._ptrs.size >= 2) {
          const [a, b] = [...this._ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
          const steps = Math.round(Math.log2(d / this._pinch.d0));
          const target = C.clamp(this._pinch.z0 + steps, this.o.minZoom, this.o.maxZoom);
          if (target !== this.zoom) { this.zoomAt(this._pinch.cx, this._pinch.cy, target); this._moved = true; }
          return;
        }
        if (this._drag && this._ptrs.size === 1) {
          const dx = e.clientX - this._drag.sx, dy = e.clientY - this._drag.sy;
          if (!this._drag.moved && Math.hypot(dx, dy) < 4) return;
          this._drag.moved = true; this._moved = true;
          this.center = C.unproject(this._drag.o.x - dx, this._drag.o.y - dy, this.zoom);
          this._clampCenter(); this._schedule(); this.emit('move', this.getCenter());
        }
      });
      window.addEventListener('pointerup', this._onUp = (e) => {
        if (!this._ptrs.has(e.pointerId)) return;
        this._ptrs.delete(e.pointerId);
        if (this._ptrs.size < 2) this._pinch = null;
        if (this._ptrs.size === 0) {
          el.classList.remove('drag');
          const d = this._drag; this._drag = null;
          if (d && d.moved || this._moved) { this._justDragged = true; setTimeout(() => { this._justDragged = false; }, 60); this.emit('moveend', this.getCenter()); }
          else if (d && !e.target.closest('.marker, .ctrls, .attr') && this.o.onClick) {
            const r = el.getBoundingClientRect(); this.o.onClick(this.pointToLatLng(e.clientX - r.left, e.clientY - r.top));
          }
        }
      });
      window.addEventListener('pointercancel', this._onCancel = (e) => { this._ptrs.delete(e.pointerId); this._drag = null; this._pinch = null; el.classList.remove('drag'); });
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const now = performance.now(); if (now - this._wheelT > 250) this._wheelAcc = 0; this._wheelT = now;
        this._wheelAcc += e.deltaY;
        if (Math.abs(this._wheelAcc) >= 50) {
          const r = el.getBoundingClientRect(); const dir = this._wheelAcc < 0 ? 1 : -1; this._wheelAcc = 0;
          this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.zoom + dir);
        }
      }, { passive: false });
      el.addEventListener('dblclick', (e) => { if (ignore(e.target) || e.target.closest('.marker')) return; const r = el.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.zoom + 1); });
    }
    destroy() {
      window.removeEventListener('pointermove', this._onMove); window.removeEventListener('pointerup', this._onUp); window.removeEventListener('pointercancel', this._onCancel);
      this._ro.disconnect(); cancelAnimationFrame(this._raf); this.el.remove();
    }

    /* ------------------------------------------------------------ vue */
    _clampCenter() { this.center.lat = C.clamp(this.center.lat, -84, 84); this.center.lng = ((this.center.lng + 180) % 360 + 360) % 360 - 180; }
    setView(lat, lng, zoom, silent) {
      this.center = { lat, lng }; if (zoom != null) this.zoom = C.clamp(Math.round(zoom), this.o.minZoom, this.o.maxZoom);
      this._clampCenter(); if (!this.w) this._measure(); this.render(); if (!silent) this.emit('moveend', this.getCenter());
    }
    zoomBy(d) { this.zoomAt(this.w / 2, this.h / 2, this.zoom + d); }
    zoomAt(px, py, nz) {
      nz = C.clamp(nz, this.o.minZoom, this.o.maxZoom); if (nz === this.zoom) return;
      const g = this.pointToLatLng(px, py); this.zoom = nz;
      const gp = C.project(g.lat, g.lng, nz);
      this.center = C.unproject(gp.x - (px - this.w / 2), gp.y - (py - this.h / 2), nz); this._clampCenter();
      this.render(); this.emit('zoom', nz);
      clearTimeout(this._zt); this._zt = setTimeout(() => this.emit('moveend', this.getCenter()), 180);
    }
    panTo(lat, lng, ms) {
      const from = C.project(this.center.lat, this.center.lng, this.zoom), to = C.project(lat, lng, this.zoom);
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      if (dist < 2) return; if (dist > Math.max(this.w, this.h) * 1.5) return this.setView(lat, lng, this.zoom, true);
      const t0 = performance.now(); ms = ms || 320; cancelAnimationFrame(this._anim);
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        this.center = C.unproject(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, this.zoom); this.render();
        if (k < 1) this._anim = requestAnimationFrame(step); else this.emit('moveend', this.getCenter());
      };
      this._anim = requestAnimationFrame(step);
    }
    /** Ajuste la vue pour contenir tous les points ; `pad` = marges (px) occupées par des éléments d'interface. */
    fitBounds(points, pad, maxZoom, silent) {
      if (!this.w) this._measure();
      pad = Object.assign({ top: 60, bottom: 60, left: 40, right: 40 }, pad || {}); maxZoom = maxZoom || 16;
      if (!points.length) return;
      const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
      const b = { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lngs), e: Math.max(...lngs) };
      const aw = Math.max(80, this.w - pad.left - pad.right), ah = Math.max(80, this.h - pad.top - pad.bottom);
      let z = maxZoom;
      for (; z > this.o.minZoom; z--) { const a = C.project(b.n, b.w, z), c = C.project(b.s, b.e, z); if (c.x - a.x <= aw && c.y - a.y <= ah) break; }
      const a = C.project(b.n, b.w, z), c = C.project(b.s, b.e, z);
      const bx = (a.x + c.x) / 2, by = (a.y + c.y) / 2;
      this.zoom = z; this.center = C.unproject(bx + (pad.right - pad.left) / 2, by + (pad.bottom - pad.top) / 2, z); this._clampCenter();
      this.render(); if (!silent) this.emit('moveend', this.getCenter());
    }
    setCtrlsBottom(px) { this.ctrls.style.bottom = px + 'px'; }
    invalidate() { this._measure(); this.render(); }

    /* ------------------------------------------------------------ repères */
    setMarkers(list) {
      const seen = new Set();
      list.forEach((m) => {
        seen.add(m.id);
        let rec = this.markers.get(m.id);
        if (!rec) {
          const wrap = h('div', { class: 'marker' }); wrap.style.pointerEvents = 'auto';
          wrap.addEventListener('click', (e) => { e.stopPropagation(); if (this._justDragged) return; const r = this.markers.get(m.id); if (r && r.data.onClick) r.data.onClick(r.data); });
          this.layerMarkers.appendChild(wrap); rec = { wrap, data: m, sig: null }; this.markers.set(m.id, rec);
        }
        rec.data = m;
        const sig = m.sig == null ? null : m.sig;
        if (sig === null || sig !== rec.sig) { rec.wrap.replaceChildren(m.el); rec.sig = sig; }
        rec.wrap.classList.toggle('sel', !!m.selected); rec.wrap.style.zIndex = m.z || (m.selected ? 5 : 3);
      });
      for (const [id, rec] of this.markers) if (!seen.has(id)) { rec.wrap.remove(); this.markers.delete(id); }
      this._place();
    }
    setUser(pos) {
      if (!pos) { if (this.userDot) { this.userDot.wrap.remove(); this.userDot = null; } return; }
      if (!this.userDot) { const wrap = h('div', { class: 'marker', style: { zIndex: 2 } }, h('div', { class: 'user-dot' })); this.layerMarkers.appendChild(wrap); this.userDot = { wrap }; }
      this.userDot.pos = pos; this._place();
    }
    setCircle(pos, km) {
      if (!pos || !km) { if (this.circle) { this.circle.el.remove(); this.circle = null; } return; }
      if (!this.circle) { this.circle = { el: h('div', { class: 'circle' }) }; this.layerOver.appendChild(this.circle.el); }
      this.circle.pos = pos; this.circle.km = km; this._place();
    }
    _place() {
      if (!this.w) return; const o = this._origin(); const z = this.zoom;
      for (const rec of this.markers.values()) {
        const p = C.project(rec.data.lat, rec.data.lng, z); const x = p.x - o.x, y = p.y - o.y;
        rec.wrap.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        rec.wrap.style.display = (x < -60 || y < -80 || x > this.w + 60 || y > this.h + 60) ? 'none' : '';
      }
      if (this.userDot && this.userDot.pos) { const p = C.project(this.userDot.pos.lat, this.userDot.pos.lng, z); this.userDot.wrap.style.transform = 'translate(' + (p.x - o.x).toFixed(1) + 'px,' + (p.y - o.y).toFixed(1) + 'px)'; }
      if (this.circle) {
        const mpp = 156543.03392 * Math.cos(this.circle.pos.lat * Math.PI / 180) / Math.pow(2, z); const r = this.circle.km * 1000 / mpp;
        const p = C.project(this.circle.pos.lat, this.circle.pos.lng, z);
        const s = this.circle.el.style; s.display = r > 6000 ? 'none' : ''; s.width = s.height = (2 * r).toFixed(1) + 'px'; s.transform = 'translate(' + (p.x - o.x - r).toFixed(1) + 'px,' + (p.y - o.y - r).toFixed(1) + 'px)';
      }
    }

    /* ------------------------------------------------------------ rendu des tuiles */
    _schedule() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); }); }
    render() {
      if (!this.w || !this.h) { this._measure(); if (!this.w) return; }
      const z = this.zoom, o = this._origin(), n = Math.pow(2, z);
      const x0 = Math.floor(o.x / 256), x1 = Math.floor((o.x + this.w) / 256), y0 = Math.max(0, Math.floor(o.y / 256)), y1 = Math.min(n - 1, Math.floor((o.y + this.h) / 256));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (tx < 0 || tx >= n) continue;
          const key = z + '/' + tx + '/' + ty;
          if (!this.tiles.has(key)) this._addTile(key, z, tx, ty);
        }
      }
      let pendingCurrent = 0;
      for (const [key, t] of this.tiles) {
        const sc = Math.pow(2, z - t.z), size = 256 * sc;
        const left = t.x * size - o.x, top = t.y * size - o.y;
        const visible = left < this.w + 256 && top < this.h + 256 && left + size > -256 && top + size > -256;
        if (!visible || Math.abs(z - t.z) > 2) { t.img.remove(); this.tiles.delete(key); continue; }
        t.img.style.transform = 'translate3d(' + left.toFixed(1) + 'px,' + top.toFixed(1) + 'px,0) scale(' + sc + ')';
        t.img.style.zIndex = t.z === z ? 2 : 1;
        if (t.z === z && !t.done) pendingCurrent++;
      }
      this._pendingCurrent = pendingCurrent;
      if (!pendingCurrent) this._dropStale();
      this._place();
    }
    _addTile(key, z, x, y) {
      const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.decoding = 'async';
      const t = { img, z, x, y, done: false };
      img.onload = () => { t.done = true; img.classList.add('ld'); this._tileDone(); };
      img.onerror = () => { t.done = true; this._tileDone(); };
      img.src = TILE_URL(z, x, y);
      this.layerTiles.appendChild(img); this.tiles.set(key, t);
    }
    _tileDone() {
      if (this._td) return;
      this._td = setTimeout(() => { this._td = 0; let pend = 0; for (const t of this.tiles.values()) if (t.z === this.zoom && !t.done) pend++; if (!pend) this._dropStale(); }, 60);
    }
    _dropStale() { for (const [key, t] of this.tiles) if (t.z !== this.zoom) { t.img.remove(); this.tiles.delete(key); } }
  }

  /* ------------------------------------------------------------ repères prêts à l'emploi */
  /* Repère d'un food truck : couleur = état (vert : ouvert, orange : bientôt, gris : plus tard, bleu : fiche provisoire sans habitude connue)
   * et petite animation qui le dit : fumée de grill (ouvert), anneau qui se remplit + heure / temps restant (bientôt), Zzz / prochaine ouverture (plus tard).
   * opts : { selected, suspect, label, start (ms, début du créneau), now (ms), listing (fiche provisoire : pastille bleue) }. */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const RING_LEN = 2 * Math.PI * 19;
  function ring(frac) {
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'ring'); svg.setAttribute('viewBox', '0 0 44 44'); svg.setAttribute('aria-hidden', 'true');
    const c = (cls) => { const e = document.createElementNS(SVGNS, 'circle'); e.setAttribute('cx', '22'); e.setAttribute('cy', '22'); e.setAttribute('r', '19'); e.setAttribute('class', cls); return e; };
    const bg = c('rb'); const fg = c('rf'); fg.style.strokeDasharray = RING_LEN.toFixed(1); fg.style.strokeDashoffset = (RING_LEN * (1 - frac)).toFixed(1);
    svg.append(bg, fg); return svg;
  }
  function truckPin(truck, status, opts) {
    opts = opts || {};
    const st = status === 'open' ? 'open' : status === 'soon' ? 'soon' : (status == null && opts.listing) ? 'info' : 'later';
    const C = MFT.core; const now = opts.now || Date.now();
    const p = h('div', { class: 'pin ' + st + (opts.listing ? ' ls' : '') + (opts.selected ? ' sel' : '') + (opts.suspect ? ' sus' : '') },
      h('div', { class: 'b' }), h('div', { class: 'l' }, opts.label || (truck.name || '?').trim().charAt(0).toUpperCase()));
    if (st === 'open') p.appendChild(h('div', { class: 'fx smoke', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')));
    if (st === 'soon' && opts.start && C) {
      p.appendChild(ring(Math.max(0.04, Math.min(1, 1 - (opts.start - now) / (3 * 3600e3)))));
      p.appendChild(h('div', { class: 'tl a1' }, C.pinTime(opts.start, now)));
      p.appendChild(h('div', { class: 'tl a2' }, C.pinUntil(opts.start, now)));
    }
    if (st === 'later') {
      p.appendChild(h('div', { class: 'fx zzz' + (opts.start ? ' a1' : ''), 'aria-hidden': 'true' }, h('i', null, 'z'), h('i', null, 'z'), h('i', null, 'z')));
      if (opts.start && C) p.appendChild(h('div', { class: 'tl a2' }, C.pinTime(opts.start, now)));
    }
    if (opts.listing && st !== 'info') p.appendChild(h('div', { class: 'lsm', 'aria-hidden': 'true' }));
    if (opts.suspect) p.appendChild(h('div', { class: 'sx' }, '!'));
    return p;
  }
  function numPin(label, today) { return h('div', { class: 'pin num' + (today ? ' today' : '') }, h('div', { class: 'b' }), h('div', { class: 'l' }, label)); }

  MFT.MapView = MapView; MFT.pins = { truckPin, numPin };
})();
