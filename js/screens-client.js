/* LocalTruck – parcours client : carte + liste, fiche food truck, favoris, alertes, profil. */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui; const App = MFT.App;
  const S = MFT.screens; const U = MFT.util; const store = () => App.store;
  const fmtRating = (r) => r.count ? r.avg.toFixed(1).replace('.', ',') + ' · ' + r.count + ' avis' : 'Pas encore d’avis';
  const bbox = (c, km) => { const dl = km / 111.32, dg = km / (111.32 * Math.cos(c.lat * Math.PI / 180)); return [{ lat: c.lat + dl, lng: c.lng - dg }, { lat: c.lat - dl, lng: c.lng + dg }]; };

  /* ================================================================ CARTE + LISTE */
  function mapScreen(o) {
    o = o || {}; const f = App.filters; const user = App.user();
    let selectedId = null, selectedSlug = null, listings = [], state = 'peek', results = [], sheetH = 260, userMoved = false, fitDone = false, lastCount = -1;
    const map = new MFT.MapView({ lat: 46.6, lng: 2.4, zoom: 6, onLocate: () => locateMe(), ctrlsBottom: 270 });
    map.el.style.position = 'absolute'; map.el.style.inset = '0';

    /* --- haut : recherche + filtres */
    const search = h('input', { type: 'search', placeholder: 'Food truck, plat ou lieu', value: f.text, 'aria-label': 'Rechercher' });
    let st = 0; search.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => { f.text = search.value; compute(); draw(); fitResults(); }, 250); });
    const momentsHost = h('div', { class: 'chips wrap map-moments' }); const filtersHost = h('div', { class: 'chips wrap' });      // tout reste visible : rien ne défile hors de l'écran
    const top = h('div', { class: 'map-top' },
      h('div', { class: 'row gap8' }, o.pushed ? h('button', { class: 'icon-btn fill', 'aria-label': 'Retour', onClick: () => App.pop() }, icon('back')) : null,
        h('div', { class: 'searchbar grow' }, icon('search', 20), search)),
      momentsHost, filtersHost, MFT.install ? MFT.install.banner() : null);
    const dayLabel = () => f.dateKey ? U.dayWord(f.dateKey) : 'Un autre jour';
    function drawChips() {
      const chip = (label, on, fn, ic, trail) => h('button', { class: 'chip map' + (on ? ' on' : ''), onClick: fn }, ic ? icon(ic, 16) : null, label, trail ? icon(trail, 14) : null);
      const refresh = () => { compute(); draw(); fitResults(); drawChips(); };
      const setMoment = (m, dk) => { f.moment = m; f.dateKey = dk || null; refresh(); };
      const noonLabel = C.lunchKey(store().now()) === C.dateKey(store().now()) ? 'Ce midi' : 'Demain midi';
      momentsHost.replaceChildren(
        chip('Maintenant', f.moment === 'now', () => setMoment('now')), chip(noonLabel, f.moment === 'noon', () => setMoment('noon')),
        chip('Ce soir', f.moment === 'tonight', () => setMoment('tonight')), chip('Demain', f.moment === 'tomorrow', () => setMoment('tomorrow')));
      const nFilters = (f.veg ? 1 : 0) + (f.cuisine !== 'Tout' ? 1 : 0);
      filtersHost.replaceChildren(
        chip(f.moment === 'date' ? dayLabel() : 'Un autre jour', f.moment === 'date', () => pickDay(setMoment), 'calendar'),
        chip(nFilters ? 'Filtres · ' + nFilters : 'Filtres', nFilters > 0, () => openFilters(refresh), 'sliders'));
    }
    /** Régime et type de cuisine : tout est visible dans une même feuille, avec ce qui est choisi. */
    function openFilters(refresh) {
      const body = h('div', { class: 'col' }); let sh;
      const draw = () => body.replaceChildren(
        h('div', { class: 'lbl' }, 'Régime'),
        h('div', { class: 'chips wrap mt8' }, h('button', { class: 'chip' + (f.veg ? ' on' : ''), onClick: () => { f.veg = !f.veg; refresh(); draw(); } }, icon('leaf', 16), 'Option végé')),
        h('div', { class: 'lbl mt16' }, 'Type de cuisine'),
        h('div', { class: 'chips wrap mt8' }, ['Tout', ...C.CUISINES].map((c) => h('button', { class: 'chip' + (f.cuisine === c ? ' on' : ''), onClick: () => { f.cuisine = c; refresh(); draw(); } }, c))),
        h('button', { class: 'btn primary block mt24', onClick: () => sh.close() }, 'Voir les food trucks'));
      draw(); sh = ui.openSheet('Filtres', body);
    }
    function pickDay(setMoment) {
      const keys = store().weekKeys(); let sh;
      sh = ui.openSheet('Quel jour ?', h('div', { class: 'list' }, keys.map((k) => h('button', { class: 'btn block' + (f.moment === 'date' && f.dateKey === k ? ' on' : ''), style: { justifyContent: 'space-between' }, onClick: () => { sh.close(); setMoment('date', k); } }, h('span', null, C.fmtDayLong(k)), k === keys[0] ? h('span', { class: 'tag' }, 'Aujourd’hui') : null))));
    }

    /* --- panneau coulissant */
    const title = h('div', { class: 'bold', style: { fontSize: '18px' } }, 'Autour de moi'); const count = h('div', { class: 'small muted' });
    const where = h('div', { class: 'small row gap4' });
    const radiusLbl = h('b', null, C.fmtRadius(f.radiusKm));
    const radius = ui.radiusSlider(f.radiusKm, (v) => { f.radiusKm = v; radiusLbl.textContent = C.fmtRadius(v); clearTimeout(rt); rt = setTimeout(() => { compute(); draw(); }, 60); });
    let rt = 0; radius.addEventListener('change', () => fitCircle());
    const grab = h('div', { class: 'grab', title: 'Glisser ou cliquer pour agrandir la liste' }, h('i'));
    const hd = h('div', { class: 'hd' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, title, where), h('div', { class: 'col', style: { alignItems: 'flex-end' } }, count, MFT.presence ? MFT.presence.badge('tiny') : null)),
      h('div', { class: 'row gap12 mt4' }, h('span', { class: 'small muted' }, 'Rayon'), h('div', { class: 'grow' }, radius), radiusLbl));
    const list = h('div', { class: 'list' }); const body = h('div', { class: 'body' }, list);
    const panel = h('div', { class: 'sheet-panel' }, grab, hd, body);
    const fab = h('button', { class: 'btn primary fab hide', style: { bottom: '18px' }, onClick: () => setState('half') }, icon('map'), 'Voir la carte');
    const el = h('div', { class: 'col map-screen' }, map.el, top, panel, fab);

    /* hauteurs : peek / half / full */
    const H = () => el.clientHeight || 760; const topH = () => top.offsetHeight + 6;
    const heights = () => ({ peek: Math.min(300, Math.round(H() * 0.4)), half: Math.round(H() * 0.58), full: H() - topH() });
    function applyState(animate) {
      const hs = heights(); sheetH = hs[state]; panel.classList.toggle('dragging', !animate); panel.style.height = sheetH + 'px';
      top.classList.toggle('solid', state === 'full'); top.style.background = state === 'full' ? 'var(--bg)' : ''; top.style.paddingBottom = state === 'full' ? '8px' : '';
      fab.classList.toggle('hide', state !== 'full');
      map.setCtrlsBottom(state === 'full' ? 20 : sheetH + 12);
      body.style.overflowY = state === 'peek' ? 'hidden' : 'auto';
    }
    function setState(s) { state = s; applyState(true); if (s !== 'peek') scrollToSel(); else if (map.w) { /* garde la vue */ } }
    let drag = null;
    const startDrag = (e) => { if (e.target.closest('input, button')) return; drag = { y: e.clientY, h: sheetH, moved: false, t: performance.now() }; panel.classList.add('dragging'); };
    [grab, hd].forEach((x) => x.addEventListener('pointerdown', startDrag));
    window.addEventListener('pointermove', (onMoveW) => {
      if (!drag) return; const dy = drag.y - onMoveW.clientY; if (Math.abs(dy) > 3) drag.moved = true; const hs = heights();
      panel.style.height = C.clamp(drag.h + dy, hs.peek, hs.full) + 'px';
    });
    window.addEventListener('pointerup', (onUpW) => {
      if (!drag) return; const d = drag; drag = null; const hs = heights();
      if (!d.moved) { if (onUpW.target === grab || grab.contains(onUpW.target)) setState(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek'); else applyState(true); return; }
      const cur = parseFloat(panel.style.height); const dy = d.y - onUpW.clientY; const v = dy / Math.max(1, performance.now() - d.t);
      const target = Math.abs(v) > 0.5 ? (v > 0 ? (cur > hs.half ? 'full' : 'half') : (cur < hs.half ? 'peek' : 'half')) : Object.entries(hs).sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0];
      setState(target);
    });

    /* --- données */
    const center = () => App.pos || map.getCenter();
    function compute() {
      App.lastMapCenter = map.getCenter();
      if (store().isCloud) store().ensureArea(center(), f.radiusKm);
      results = store().queryTrucks({ center: center(), radiusKm: f.radiusKm, moment: f.moment, dateKey: f.dateKey, cuisine: f.cuisine, text: f.text, veg: f.veg });
      if (selectedId && !results.some((r) => r.truck.id === selectedId)) selectedId = null;
      listings = store().listingsNear ? store().listingsNear(center(), f.radiusKm, { text: f.text, cuisine: f.cuisine, veg: f.veg }) : [];      // camions repérés sans compte : repère sobre, fiche plus courte
      if (selectedSlug && !listings.some((x) => x.listing.slug === selectedSlug)) selectedSlug = null;
    }
    function selectListing(slug, fromPin) {
      selectedSlug = slug; selectedId = null; draw(); const it = listings.find((x) => x.listing.slug === slug);
      if (it && fromPin) { const p = C.listingPinPos(it.listing); map.panTo(p.lat, p.lng); }
      scrollToSel();
    }
    function selectTruck(id, fromPin) {
      selectedId = id; selectedSlug = null; draw(); const r = results.find((x) => x.truck.id === id);
      if (r && fromPin) { map.panTo(r.slot.place.lat, r.slot.place.lng); if (state === 'peek' && false) setState('peek'); }
      scrollToSel();
    }
    function scrollToSel() { const row = list.querySelector('.item.sel'); if (row) row.scrollIntoView({ block: 'nearest' }); }
    const openTruck = (id) => S.openFiche(id);
    function draw() {
      // en-tête
      const label = App.pos ? (App.pos.label || 'Ma position') : 'Centre de la carte';
      const total = results.length + listings.length;
      count.textContent = total + ' food truck' + (total > 1 ? 's' : '');
      where.replaceChildren(icon('pin', 14), h('span', { class: 'muted ell', style: { maxWidth: '190px' } }, label), h('span', { class: 'link', onClick: () => changePlace() }, 'Changer'));
      // repères
      map.setUser(App.pos); map.setCircle(App.pos, f.radiusKm);
      // repère : couleur et animation selon l'état ; l'heure affichée est recalculée à chaque rafraîchissement (signature à la minute)
      const nowMs = +store().now(); const minute = Math.floor(nowMs / 60000);
      map.setMarkers(results.map((r) => { const sel = r.truck.id === selectedId; const start = C.slotInterval(r.key, r.slot).start;
        return { id: r.truck.id, lat: r.slot.place.lat, lng: r.slot.place.lng, selected: sel, sig: [r.status, sel, r.suspect, r.truck.name.charAt(0), r.status === 'open' ? '' : start, r.status === 'soon' ? minute : ''].join('|'), el: MFT.pins.truckPin(r.truck, r.status, { selected: sel, suspect: r.suspect, start, now: nowMs }), onClick: () => selectTruck(r.truck.id, true) }; }).concat(listings.map((x) => { const l = x.listing; const sel = l.slug === selectedSlug; const p = C.listingPinPos(l);
        const ls = C.listingStatus(l, nowMs);
        return { id: 'l:' + l.slug, lat: p.lat, lng: p.lng, selected: sel, z: sel ? 5 : 2, sig: ['l', sel, l.name.charAt(0), ls ? ls.status + ls.start : '', ls && ls.status === 'soon' ? minute : ''].join('|'), el: U.listingPin(l, sel, ls, nowMs), onClick: () => selectListing(l.slug, true) }; })));
      // liste
      if (lastCount === 0 && total > 0) body.scrollTop = 0;
      if (total === 0 && lastCount !== 0 && state === 'peek') setTimeout(() => setState('half'), 0);
      lastCount = total;
      list.replaceChildren();
      if (!total) {
        const noTrucks = store().db.trucks.length === 0;
        if (!(noTrucks && !store().isCloud)) list.append(zoneInvite());
        list.append(noTrucks && store().isCloud ? ui.empty('🚚', 'Aucun food truck dans cette zone', 'Les food trucks annoncent leur emplacement du soir. Élargissez le rayon ou déplacez la carte pour chercher ailleurs.', h('button', { class: 'btn', onClick: () => changePlace() }, icon('pin', 16), 'Changer de lieu'))
          : noTrucks ? ui.empty('🚚', 'Aucun food truck pour l’instant', 'Les food trucks annoncent leur emplacement du soir. Pour essayer l’application, générez des food trucks de démonstration autour de vous.', h('button', { class: 'btn primary', onClick: () => { const c = center(); if (!C.isInFrance(c.lat, c.lng)) { ui.toast('Choisissez d’abord une position en France.', 'err'); return changePlace(); } store().seedDemo(c); ui.toast('Food trucks de démonstration créés', 'ok'); compute(); draw(); fitResults(true); } }, icon('truck'), 'Générer des food trucks de démo'))
          : ui.empty('🔎', 'Aucun food truck ici', 'Rien ne correspond à ces critères dans ' + C.fmtRadius(f.radiusKm) + '. Élargissez le rayon ou changez de moment.', h('div', { class: 'row gap8', style: { justifyContent: 'center' } }, f.radiusKm < 50 ? h('button', { class: 'btn', onClick: () => { const i = Math.min(C.RADIUS_STEPS.length - 1, C.radiusIndex(f.radiusKm) + 2); f.radiusKm = C.RADIUS_STEPS[i]; radius.value = i; ui.setRange(radius); radiusLbl.textContent = C.fmtRadius(f.radiusKm); compute(); draw(); fitCircle(); } }, 'Élargir le rayon') : null, f.moment !== 'tonight' || f.cuisine !== 'Tout' || f.text || f.veg ? h('button', { class: 'btn', onClick: () => { Object.assign(f, { moment: 'tonight', dateKey: null, cuisine: 'Tout', text: '', veg: false }); search.value = ''; drawChips(); compute(); draw(); fitResults(); } }, 'Réinitialiser les filtres') : null)));
        return;
      }
      if (!results.length) {
        if (!(store().db.trucks.length === 0 && !store().isCloud)) list.append(zoneInvite());
        list.append(h('div', { class: 'small muted', style: { margin: '6px 4px 0' } }, 'Aucune annonce pour ce moment dans cette zone.'));
      }
      results.forEach((r) => {
        const sel = r.truck.id === selectedId;
        list.append(U.truckRow(r, { selected: sel, userId: user && user.id, onClick: () => openTruck(r.truck.id), onHeart: (t) => toggleFollow(t),
          actions: sel ? [h('button', { class: 'btn primary sm', onClick: (e) => { e.stopPropagation(); openTruck(r.truck.id); } }, 'Voir la fiche'), h('button', { class: 'btn sm', onClick: (e) => { e.stopPropagation(); App.openRoute(r.truck, r.slot); } }, icon('route', 16), 'Itinéraire')] : null }));
      });
      if (listings.length) {
        list.append(h('div', { class: 'lbl list-lbl' }, results.length ? 'Aussi dans le secteur' : 'Food trucks du secteur'));
        listings.forEach((it) => {
          const sel = it.listing.slug === selectedSlug;
          list.append(U.listingRow(it, { selected: sel, onClick: () => S.openListing(it.listing.slug),
            actions: sel ? [h('button', { class: 'btn primary sm', onClick: (e) => { e.stopPropagation(); S.openListing(it.listing.slug); } }, 'Voir la fiche')] : null }));
        });
      }
    }
    const toggleFollow = App.guard(async (t) => { if (!user) return U.askAccount('suivre ' + t.name); const now = store().toggleFollow(user.id, t.id); ui.toast(now ? 'Vous suivez ' + t.name : 'Vous ne suivez plus ' + t.name, now ? 'ok' : undefined); if (now) U.followed(); });
    const zoneCenter = () => { const c = center(); return { lat: c.lat, lng: c.lng, label: App.pos ? (App.pos.label || '') : '' }; };
    const zoneInvite = () => h('div', { class: 'card row gap12', style: { margin: '4px 0 0' } }, icon('bell', 22),
      h('div', { class: 'grow' }, h('div', { class: 'bold small' }, 'Prévenez-moi quand un truck arrive'), h('div', { class: 'tiny muted' }, 'Dès qu’un food truck annonce un emplacement ici.')),
      h('button', { class: 'btn primary sm', onClick: () => (user ? U.openZoneSheet({ center: zoneCenter() }) : U.askAccount('être prévenu quand un food truck arrive près de chez vous')) }, store().myZone() ? 'Modifier' : 'Me prévenir'));
    function changePlace() { U.openLocationSheet({ mapCenter: () => map.getCenter(), onDone: () => { compute(); draw(); fitCircle(); } }); }

    /* --- vue de la carte */
    const pad = () => (MFT.desktop && MFT.desktop.on() ? { top: 70, bottom: 70, left: 70, right: 90 } : { top: topH() + 20, bottom: sheetH + 24, left: 30, right: 30 });      // ordinateur : la liste est à côté de la carte, pas dessus
    function fitCircle() { if (!App.pos) return fitResults(); const bb = bbox(App.pos, f.radiusKm); map.fitBounds(bb, pad(), 18, true); map.emit('moveend'); }
    function fitResults(force) {
      if (!results.length && !listings.length) { if (App.pos) fitCircle(); return; }
      const pts = results.map((r) => ({ lat: r.slot.place.lat, lng: r.slot.place.lng })); if (!results.length) listings.forEach((x) => pts.push(C.listingPinPos(x.listing))); if (App.pos) pts.push({ lat: App.pos.lat, lng: App.pos.lng });
      map.fitBounds(pts, pad(), 17, true);
    }
    async function locateMe() {
      ui.toast('Localisation en cours…');
      try {
        const p = await App.locate(); const r = await App.reverse(p.lat, p.lng); const pl = r ? App.placeFromGeo(r) : null;
        App.setPos({ lat: p.lat, lng: p.lng, label: pl ? (pl.city || pl.name) : 'Ma position', source: 'gps' }); compute(); draw(); fitCircle();
        if (!C.isInFrance(p.lat, p.lng)) ui.toast('Vous êtes hors de France : LocalTruck n’est disponible qu’en France pour l’instant.', 'err');
      } catch (e) { ui.toast('Position indisponible. Indiquez une ville ou une adresse.', 'err'); changePlace(); }
    }

    map.on('moveend', () => { App.lastMapCenter = map.getCenter(); if (!App.pos) { compute(); draw(); } });
    const offPos = App.onPos(() => { /* le redessin est fait par l'appelant */ });
    new ResizeObserver(() => requestAnimationFrame(() => applyState(false))).observe(el);

    const scr = {
      el, map, destroy: () => { offPos(); map.destroy(); },
      refresh: () => { compute(); draw(); },
      fit: () => { compute(); draw(); fitResults(); },
      onMount: async () => {
        map.invalidate(); drawChips(); applyState(false); compute(); draw();
        if (App.pos) fitCircle();
        else if (!App.geoTried && !o.pushed) {
          App.geoTried = true;
          try { const p = await App.locate(); const r = await App.reverse(p.lat, p.lng); const pl = r ? App.placeFromGeo(r) : null; App.setPos({ lat: p.lat, lng: p.lng, label: pl ? (pl.city || pl.name) : 'Ma position', source: 'gps' }); compute(); draw(); fitCircle(); }
          catch (e) { if (store().db.trucks.length) fitResults(); changePlace(); }
        } else if (results.length) fitResults();
      },
    };
    return scr;
  }
  S.client_map = () => mapScreen({});
  S.openMap = () => App.push(mapScreen({ pushed: true }));

  /* ================================================================ FICHE FOOD TRUCK */
  function fiche(truckId, o) {
    o = o || {}; const user = App.user();
    if (!store().getTruck(truckId)) { ui.toast('Ce food truck n’existe plus.', 'err'); return null; }
    const scroll = h('div', { class: 'scroll' }); const bottom = h('div', { class: 'bottom-bar' });
    const titleEl = h('h1', { class: 'ell' }, '');
    const top = h('div', { class: 'topbar' }, App.backBtn(), titleEl,
      h('button', { class: 'icon-btn', 'aria-label': 'Partager', onClick: () => { const t = store().getTruck(truckId); if (t) U.openShareSheet(t); } }, icon('share')),
      h('button', { class: 'icon-btn', 'aria-label': 'Plus d’actions', onClick: () => moreMenu() }, icon('more')));
    const preview = h('div', { class: 'preview-ban hide' }, 'Aperçu côté client : voici ce que voient vos clients');
    const el = h('div', { class: 'col' }, top, preview, scroll, bottom);
    const mini = new MFT.MapView({ lat: 46.6, lng: 2.4, zoom: 6, zoomControls: true });
    mini.el.style.height = '210px'; mini.el.style.borderRadius = '18px'; mini.el.style.border = '1px solid var(--bd)';
    let hlKey = null; let starPick = 0; let reviewText = ''; let fitted = false; let lastSig = '';

    function moreMenu() {
      const t = store().getTruck(truckId); const u = App.user(); let sh; const items = [];
      if (!u) items.push(h('button', { class: 'btn block', onClick: () => { sh.close(); U.askAccount('signaler ce food truck'); } }, icon('flag'), 'Signaler ce food truck'));
      if (u && !store().canManage(u.id, t)) items.push(h('button', { class: 'btn block', onClick: () => { sh.close(); U.openReportSheet({ type: 'truck', id: t.id, title: 'Signaler ' + t.name }); } }, icon('flag'), 'Signaler ce food truck'));
      items.push(h('button', { class: 'btn block', onClick: () => { sh.close(); U.openShareSheet(t); } }, icon('qr'), 'Partager (lien et QR code)'));
      if (u && u.role === 'admin') {
        items.push(h('button', { class: 'btn block', onClick: App.guard(async () => { await store().setVerified(u.id, t.id, !t.verified); sh.close(); ui.toast(t.verified ? 'Fiche marquée comme vérifiée' : 'Mention « Pas encore vérifié » rétablie'); }) }, icon('shield'), t.verified ? 'Retirer le badge Vérifié' : 'Marquer comme vérifié'));
        items.push(h('button', { class: 'btn block', onClick: App.guard(async () => { await store().setHidden(u.id, t.id, !t.hidden); sh.close(); ui.toast(t.hidden ? 'Fiche masquée' : 'Fiche à nouveau visible'); }) }, icon('eye'), t.hidden ? 'Afficher la fiche' : 'Masquer la fiche'));
      }
      sh = ui.openSheet('Actions', h('div', { class: 'col gap8' }, items));
    }

    function build() {
      const t = store().getTruck(truckId); if (!t) { App.pop(); return; }
      const u = App.user(); const mgr = u && (u.role === 'admin' && App.mode !== 'admin' ? App.myTrucks().some((x) => x.id === t.id) : store().canManage(u.id, t)); const isAdmin = u && u.role === 'admin' && App.mode === 'admin';
      const sum = store().summary(t); const today = C.dateKey(store().now()); const suspect = store().isSuspect(t.id);
      const rating = store().rating(t.id); const dish = store().dishOfDay(t);
      titleEl.textContent = t.name; preview.classList.toggle('hide', !o.preview);
      const keep = scroll.scrollTop;
      const vegOk = t.cuisines.includes('Végé') || t.products.some((p) => p.veg);

      const head = h('div', { class: 'hero' }, ui.avatar(t, 'lg'), h('div', { class: 'grow' },
        h('div', { class: 'row gap8' }, h('h2', { style: { fontSize: '20px' } }, t.name), suspect ? ui.suspectIcon(22) : null),
        h('div', { class: 'small muted mt4' }, t.cuisines.join(' · ')),
        h('div', { class: 'row gap8 mt8' }, ui.stars(rating.avg), h('span', { class: 'small muted' }, fmtRating(rating))),
        U.followersLine(t)));
      const statusRow = h('div', { class: 'pad row gap8 mt12', style: { flexWrap: 'wrap' } },
        sum ? ui.statusTag(sum.status, sum.slot) : h('span', { class: 'tag' }, 'Pas d’annonce'),
        sum && sum.status !== 'cancelled' ? h('span', { class: 'small' }, (sum.slot.place.name || sum.slot.place.address) + ' · ' + C.fmtHours(sum.slot) + (sum.key !== today ? ' · ' + U.dayWord(sum.key) : '')) : null);
      const chips = h('div', { class: 'pad row gap8 mt8', style: { flexWrap: 'wrap' } }, vegOk ? h('span', { class: 'tag veg' }, icon('leaf', 12), 'Option végé') : null,
        t.verified ? h('span', { class: 'tag ver' }, icon('check', 12), 'Vérifié') : h('span', { class: 'tag unv' }, 'Pas encore vérifié'), t.hidden ? h('span', { class: 'tag cancelled' }, 'Masquée') : null);
      const unvNote = h('div', { class: 'pad tiny muted mt4' }, (t.verified ? 'Informations fournies par le food truck' : 'Les informations viennent du food truck lui-même') + ', seul responsable de son activité.');
      const susBanner = suspect ? h('div', { class: 'pad mt12' }, h('div', { class: 'card alert row gap12', style: { alignItems: 'flex-start' } }, ui.suspectIcon(26),
        h('div', null, h('div', { class: 'bold' }, 'Food truck signalé plusieurs fois'), h('div', { class: 'small', style: { color: 'var(--rd-tx)' } }, 'Des utilisateurs ont signalé cette fiche (plus de ' + C.SUSPECT_THRESHOLD + ' signalements). Ses informations peuvent être fausses : soyez vigilant.')))) : null;
      const cancelBanner = sum && sum.status === 'cancelled' ? h('div', { class: 'pad mt12' }, h('div', { class: 'card alert' }, h('div', { class: 'bold' }, 'Fermé ce soir'), h('div', { class: 'small' }, sum.slot.cancelReason ? 'Raison : ' + sum.slot.cancelReason : 'Le food truck a annulé son service d’aujourd’hui.'))) : null;
      const bio = t.bio ? h('div', { class: 'pad mt16', style: { userSelect: 'text' } }, t.bio) : null;
      const socialBtn = (kind, label) => {
        const url = C.socialUrl(kind, t[kind]); if (!url) return null; // adresse revalidée à l'affichage : jamais d'autre site que Instagram / Facebook
        return h('button', { class: 'btn sm social-' + kind, 'aria-label': label + ' de ' + t.name, onClick: () => { MFT.platform.openExternal(url).then((ok) => { if (!ok) ui.toast('Impossible d’ouvrir ' + label + '.', 'err'); }); } }, icon(kind, 18), label);
      };
      const socials = socialBtn('instagram', 'Instagram') || socialBtn('facebook', 'Facebook')
        ? h('div', { class: 'pad row gap8 mt12', style: { flexWrap: 'wrap' } }, socialBtn('instagram', 'Instagram'), socialBtn('facebook', 'Facebook')) : null;
      const dishCard = dish ? h('div', { class: 'pad mt16' }, h('div', { class: 'card tint' }, h('div', { class: 'tiny bold', style: { color: 'var(--ac-tx)', letterSpacing: '.08em' } }, 'PLAT DU JOUR'),
        h('div', { class: 'row mt4' }, h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '17px' } }, dish.name), dish.desc ? h('div', { class: 'small muted' }, dish.desc) : null), dish.price != null ? h('div', { class: 'price' }, ui.money(dish.price)) : null),
        dish.photo != null && t.gallery[dish.photo] ? h('div', { class: 'mt8', style: { height: '140px', borderRadius: '12px', background: 'center/cover url(' + t.gallery[dish.photo] + ')' } }) : null)) : null;

      // planning 7 jours
      const days = store().weekKeys().map((k) => {
        const d = store().getDay(t, k); const dd = C.parseKey(k);
        let mid;
        if (!d) mid = h('div', { class: 'grow muted small' }, 'Non communiqué');
        else if (d.rest) mid = h('div', { class: 'grow' }, h('div', { class: 'bold' }, 'Repos'), h('div', { class: 'small muted' }, 'Pas de service'));
        else mid = h('div', { class: 'grow col gap8' }, d.slots.map((s) => {
          const stt = C.slotStatus(s, k, store().now());
          return h('div', { class: 'row gap8', style: { cursor: 'pointer' }, onClick: () => { hlKey = k; mini.panTo(s.place.lat, s.place.lng); drawMini(); } },
            h('div', { class: 'grow' }, h('div', { class: 'bold ell' }, s.place.name || s.place.address), h('div', { class: 'small muted' }, C.fmtHours(s.slot || s) + (s.note ? ' · ' + s.note : '') + (stt === 'cancelled' ? ' · annulé' : ''))),
            stt === 'open' ? ui.statusTag('open') : stt === 'cancelled' ? ui.statusTag('cancelled') : k === today && stt !== 'done' ? h('span', { class: 'tag soon' }, 'Ce soir') : null,
            ['done', 'cancelled'].includes(stt) ? null : h('button', { class: 'icon-btn', style: { width: '34px', height: '34px' }, 'aria-label': 'Itinéraire', onClick: (e) => { e.stopPropagation(); App.openRoute(t, s); } }, icon('route', 18)));
        }));
        return h('div', { class: 'day-row' + (k === today ? ' today' : '') }, h('div', { class: 'd' }, C.DOW_SHORT[dd.getDay()], h('b', null, dd.getDate())), mid);
      });
      const planning = h('div', { class: 'pad' }, h('div', { class: 'sec' }, h('span', null, '7 prochains jours'), h('span', { class: 'tiny', style: { textTransform: 'none', letterSpacing: 0 } }, C.fmtDayShort(store().weekKeys()[0]) + ' – ' + C.fmtDayShort(store().weekKeys()[6]))), h('div', { class: 'list' }, days));
      const places = store().weekPlaces(t);
      const mapSec = places.length ? h('div', { class: 'pad' }, h('div', { class: 'sec' }, 'Ses emplacements cette semaine'), mini.el, h('div', { class: 'tiny muted mt8' }, 'Touchez un jour dans le planning pour le retrouver sur la carte.')) : null;

      // menu
      const prods = t.products.length ? h('div', null, t.products.map((p) => h('div', { class: 'prod' + (p.available ? '' : ' off') },
        h('div', { class: 'grow' }, h('div', { class: 'row gap8', style: { flexWrap: 'wrap' } }, h('span', { class: 'bold nm' }, p.name), p.veg ? h('span', { class: 'tag veg' }, 'Végé') : null, p.available ? null : h('span', { class: 'tag cancelled' }, 'Rupture')),
          p.desc ? h('div', { class: 'small muted' }, p.desc) : null, p.allergens && p.allergens.length ? h('div', { class: 'tiny muted' }, 'Allergènes : ' + p.allergens.join(', ').toLowerCase()) : null),
        h('div', { class: 'price' }, ui.money(p.price))))) : h('div', { class: 'muted small' }, 'Ce food truck n’a pas encore détaillé sa carte.');
      const pay = h('div', { class: 'small muted mt12' }, (t.payments.length ? 'Paiement sur place : ' + t.payments.map((x) => x.toLowerCase()).join(', ') + '. ' : '') + 'LocalTruck ne gère aucun paiement.');
      const menu = h('div', { class: 'pad' }, h('div', { class: 'sec' }, h('span', null, 'Au menu'), h('span', { class: 'tiny', style: { textTransform: 'none', letterSpacing: 0 } }, 'prix indicatifs')), prods, pay);

      const gallery = t.gallery.length ? h('div', { class: 'pad' }, h('div', { class: 'sec' }, 'Photos'), h('div', { class: 'gal' }, t.gallery.map((src) => h('div', { class: 'ph', style: { backgroundImage: 'url(' + src + ')', cursor: 'pointer' }, onClick: () => ui.openSheet(t.name, h('div', { class: 'photo-view' }, h('img', { src }))) })))) : null;

      // avis
      const reviews = store().reviewsOf(t.id); const mine = u ? reviews.find((r) => r.userId === u.id) : null;
      if (!starPick && mine) { starPick = mine.rating; reviewText = mine.text; }
      const starRow = h('div', { class: 'stars pick' }); for (let i = 1; i <= 5; i++) { const b = h('button', { 'aria-label': i + ' étoile' + (i > 1 ? 's' : ''), style: { color: i <= starPick ? '#E8A317' : 'var(--star-off)' }, onClick: () => { starPick = i; starRow.querySelectorAll('button').forEach((x, j) => { x.style.color = j < i ? '#E8A317' : 'var(--star-off)'; }); } }, ui.starIcon(i <= starPick)); starRow.appendChild(b); }
      const ta = h('textarea', { class: 'inp', maxlength: '300', placeholder: 'Votre avis (facultatif) : accueil, goût, attente…', onInput: (e) => { reviewText = e.target.value; } }, reviewText);
      const form = u && !mgr && !isAdmin ? h('div', { class: 'card mt8' }, h('div', { class: 'bold' }, mine ? 'Modifier mon avis' : 'Donner mon avis'), h('div', { class: 'mt8' }, starRow), h('div', { class: 'mt8' }, ta),
        h('button', { class: 'btn primary block mt8', onClick: App.guard(async () => { await store().addReview(u.id, t.id, starPick, reviewText); ui.toast('Merci pour votre avis', 'ok'); }) }, mine ? 'Mettre à jour mon avis' : 'Publier mon avis')) : null;
      const guestForm = !u ? h('div', { class: 'card mt8' }, h('div', { class: 'bold' }, 'Donner mon avis'), h('div', { class: 'small muted mt4' }, 'Notez ce food truck et aidez les autres clients : un compte gratuit est nécessaire.'), h('button', { class: 'btn primary block mt8', onClick: () => U.askAccount('donner votre avis') }, 'Créer un compte pour noter')) : null;
      const revList = reviews.map((r) => {
        const own = u && r.userId === u.id;
        return h('div', { class: 'card', style: { padding: '12px' } },
          h('div', { class: 'row gap8' }, h('div', { class: 'avatar sm', style: { background: 'var(--s3)', color: 'var(--tx)' } }, (r.userName || '?').charAt(0).toUpperCase()), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, r.userName), h('div', { class: 'tiny muted' }, 'Avis du ' + C.fmtDateShort(r.createdAt) + (r.editedAt ? ' · modifié le ' + C.fmtDateShort(r.editedAt) : ''))), ui.stars(r.rating, 15)),
          r.text ? h('div', { class: 'small mt8', style: { userSelect: 'text' } }, r.text) : null,
          r.reply ? h('div', { class: 'bubble' }, h('div', { class: 'tiny bold', style: { color: 'var(--ac-tx)' } }, 'Réponse de ' + t.name), r.reply.text) : null,
          h('div', { class: 'row gap8 mt8', style: { justifyContent: 'flex-end' } },
            mgr ? h('button', { class: 'btn ghost sm', onClick: () => replyForm(r) }, r.reply ? 'Modifier la réponse' : 'Répondre') : null,
            u && !own && !isAdmin ? h('button', { class: 'btn ghost sm', onClick: () => U.openReportSheet({ type: 'review', id: r.id, title: mgr ? 'Signaler un avis douteux' : 'Signaler cet avis', reasons: mgr ? C.REVIEW_REPORT_REASONS_PRO : C.REVIEW_REPORT_REASONS }) }, icon('flag', 14), 'Signaler') : null,
            own || isAdmin ? h('button', { class: 'btn ghost sm', onClick: App.guard(async () => { if (await ui.confirmDialog({ title: 'Supprimer cet avis ?', okLabel: 'Supprimer', danger: true })) { await store().deleteReview(u.id, r.id); if (own) { starPick = 0; reviewText = ''; } } }) }, icon('trash', 14), 'Supprimer') : null));
      });
      const revSec = h('div', { class: 'pad' }, h('div', { class: 'sec' }, h('span', null, 'Avis (' + reviews.length + ')'), h('span', { class: 'link', style: { textTransform: 'none', letterSpacing: 0, fontSize: '13px' }, onClick: () => S.legalSheet('Règles des avis', S.REVIEWS) }, 'Règles des avis')), form || guestForm, h('div', { class: 'list mt12' }, revList.length ? revList : [h('div', { class: 'muted small' }, 'Aucun avis pour le moment.')]));
      const reportLink = !mgr ? h('div', { class: 'center small mt24', style: { paddingBottom: '24px' } }, h('span', { class: 'link', style: { color: 'var(--mu)' }, onClick: () => u ? U.openReportSheet({ type: 'truck', id: t.id, title: 'Signaler ' + t.name }) : U.askAccount('signaler ce food truck') }, 'Signaler ce food truck')) : h('div', { style: { height: '24px' } });

      scroll.replaceChildren(head, statusRow, chips, unvNote, susBanner, cancelBanner, bio, socials, dishCard, planning, mapSec, menu, gallery, revSec, reportLink);
      scroll.scrollTop = keep;
      if (mapSec) { mini.invalidate(); drawMini(); const sig = places.map((p) => p.slot.id + p.slot.place.lat).join(); if (!fitted || sig !== lastSig) { lastSig = sig; fitted = true; mini.fitBounds(places.map((p) => ({ lat: p.slot.place.lat, lng: p.slot.place.lng })), { top: 40, bottom: 40, left: 40, right: 40 }, 15, true); } }

      // barre du bas
      const target = sum && ['open', 'soon', 'later'].includes(sum.status) ? sum : null;
      bottom.replaceChildren();
      if (mgr && !isAdmin) bottom.append(h('button', { class: 'btn grow', onClick: () => { App.popAll(); App.setTab('menu'); } }, icon('edit'), 'Modifier ma fiche'), h('button', { class: 'btn primary grow', onClick: () => { App.popAll(); App.setTab('planning'); } }, icon('calendar'), 'Mon planning'));
      else if (isAdmin) bottom.append(h('button', { class: 'btn grow', onClick: App.guard(async () => { await store().setHidden(u.id, t.id, !t.hidden); }) }, icon('eye'), t.hidden ? 'Afficher' : 'Masquer'), h('button', { class: 'btn primary grow', onClick: App.guard(async () => { await store().setVerified(u.id, t.id, !t.verified); }) }, icon('shield'), t.verified ? 'Retirer « Vérifié »' : 'Marquer vérifié'));
      else {
        const fol = u && store().isFollowing(u.id, t.id);
        bottom.append(h('button', { class: 'btn grow' + (fol ? ' on' : ''), onClick: App.guard(async () => { if (!u) return U.askAccount('suivre ' + t.name + ' et être prévenu de ses changements'); const now = store().toggleFollow(u.id, t.id); ui.toast(now ? 'Vous suivez ' + t.name + ' : vous serez prévenu de ses changements' : 'Vous ne suivez plus ' + t.name, now ? 'ok' : undefined); if (now) U.followed(); }) }, (() => { const s = icon('heart'); if (fol) s.style.fill = 'currentColor'; return s; })(), fol ? 'Suivi' : 'Suivre'),
          h('button', { class: 'btn primary grow', disabled: !target, onClick: () => App.openRoute(t, target.slot) }, icon('route'), 'Itinéraire'));
      }
    }
    function drawMini() {
      const t = store().getTruck(truckId); if (!t) return; const today = C.dateKey(store().now());
      const groups = new Map();
      store().weekPlaces(t).forEach((p) => { const key = p.slot.place.lat.toFixed(4) + ',' + p.slot.place.lng.toFixed(4); if (!groups.has(key)) groups.set(key, { lat: p.slot.place.lat, lng: p.slot.place.lng, days: [] }); groups.get(key).days.push(p.key); });
      mini.setMarkers([...groups.entries()].map(([id, g]) => { const sel = hlKey && g.days.includes(hlKey); const pin = MFT.pins.numPin(C.parseKey(g.days[0]).getDate(), g.days.includes(today)); pin.title = g.days.map((k) => C.fmtDayLong(k)).join('\n'); if (g.days.length > 1) pin.appendChild(h('div', { class: 'sx', style: { background: 'var(--ac)', color: 'var(--on-ac)' } }, g.days.length)); if (sel) pin.classList.add('sel'); return { id, lat: g.lat, lng: g.lng, selected: sel, sig: g.days.join() + sel, el: pin, onClick: () => { hlKey = g.days[0]; drawMini(); } }; }));
    }
    function replyForm(r) {
      const ta = h('textarea', { class: 'inp', maxlength: '300', placeholder: 'Votre réponse publique' }, r.reply ? r.reply.text : ''); let sh;
      sh = ui.openSheet('Répondre à ' + r.userName, h('div', null, ta, h('button', { class: 'btn primary block mt16', onClick: App.guard(async () => { await store().replyReview(user.id, r.id, ta.value); sh.close(); }) }, 'Publier la réponse')));
    }

    return { el, refresh: build, destroy: () => mini.destroy(), onMount: () => { build(); if (!o.preview) { store().track(truckId, 'view'); const u = App.user(); if (!u || u.role === 'client') MFT.funnel.track('fiche'); } } };
  }
  S.openFiche = function (id, o) {
    const st = store();
    if (st.isCloud && !st.getTruck(id)) {            // fiche pas encore sur l'appareil (lien partagé, notification) : on la télécharge d'abord
      st.fetchTruck(id).then(() => { if (st.getTruck(id)) S.openFiche(id, o); else ui.toast('Ce food truck n’existe plus.', 'err'); })
        .catch(() => ui.toast('Impossible de charger la fiche. Vérifiez votre connexion.', 'err'));
      return null;
    }
    const f = fiche(id, o);
    if (f && MFT.desktop && MFT.desktop.on() && App.tabName === 'map' && !App.stack.length) f.el.classList.add('dk-side');      // ordinateur : panneau à gauche, la carte reste visible
    if (f) { App.push(f); if (st.isCloud) st.refreshTruck(id); } return f;
  };

  /* ================================================================ FAVORIS */
  S.client_favorites = function () {
    const body = h('div', { class: 'scroll pad' }); const user = () => App.user();
    function build() {
      const u = user(); const favs = (u.favorites || []).map((id) => store().getTruck(id)).filter((t) => t && !t.hidden);
      const alertRange = h('span', { class: 'bold' }, (u.prefs.alertKm || 3) + ' km');
      const slider = ui.slider(1, 20, u.prefs.alertKm || 3, (v) => { alertRange.textContent = v + ' km'; });
      slider.addEventListener('change', () => store().updateUser(u.id, { prefs: { alertKm: +slider.value } }));
      const settings = h('div', { class: 'card' },
        h('div', { class: 'setting', style: { padding: '0 0 10px' } }, icon('bell'), h('div', { class: 'grow' }, h('div', { class: 'bold' }, 'Alertes de proximité'), h('div', { class: 'small muted' }, 'Être prévenu quand un favori s’installe près de moi')), ui.toggle(u.prefs.alertsEnabled !== false, (v) => store().updateUser(u.id, { prefs: { alertsEnabled: v } }))),
        h('div', { class: 'row gap12' }, h('span', { class: 'small muted' }, 'À moins de'), h('div', { class: 'grow' }, slider), alertRange),
        h('div', { class: 'tiny muted mt8' }, 'Votre position est utilisée uniquement sur cet écran pour comparer les distances ; elle n’est jamais enregistrée.'));
      const rows = favs.map((t) => {
        const s = store().summary(t); const dist = s && App.pos ? C.haversine(App.pos.lat, App.pos.lng, s.slot.place.lat, s.slot.place.lng) : null;
        if (s) return U.truckRow({ truck: t, slot: s.slot, status: s.status, key: s.key, dist, suspect: store().isSuspect(t.id) }, { userId: u.id, onClick: () => S.openFiche(t.id), onHeart: (tt) => store().toggleFollow(u.id, tt.id) });
        return h('div', { class: 'item', onClick: () => S.openFiche(t.id) }, ui.avatar(t), h('div', { class: 'grow' }, h('div', { class: 't' }, t.name), h('div', { class: 's' }, 'Aucune annonce pour les 7 prochains jours')), h('button', { class: 'icon-btn', style: { color: 'var(--ac)' }, onClick: (e) => { e.stopPropagation(); store().toggleFollow(u.id, t.id); } }, (() => { const x = icon('heart'); x.style.fill = 'currentColor'; return x; })()));
      });
      const keep = body.scrollTop;
      body.replaceChildren(settings, h('div', { class: 'sec' }, 'Mes favoris (' + favs.length + ')'),
        favs.length ? h('div', { class: 'list' }, rows) : ui.empty('♡', 'Aucun favori pour l’instant', 'Touchez « Suivre » sur la fiche d’un food truck pour être prévenu quand il s’installe près de vous ou change de lieu.', h('button', { class: 'btn primary', onClick: () => App.setTab('map') }, icon('map'), 'Voir la carte')));
      body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Mes favoris')), body), refresh: build, onMount: build };
  };

  /* ================================================================ ALERTES + ÉVÉNEMENTS */
  S.client_alerts = function () {
    let tab = 'alerts'; const content = h('div', { class: 'scroll pad' }); const segHost = h('div', { class: 'pad' }); const events = U.eventsList(false);
    const iconFor = { live: ['truck', 'live'], moved: ['pin', 'live'], cancel: ['close', 'cancel'], delay: ['clock', 'delay'], stock: ['alert', 'stock'], planning: ['calendar', ''], message: ['send', ''], proximity: ['locate', 'prox'], zone: ['pin', 'live'], recap: ['chart', ''] };
    function build() {
      const u = App.user(); const unread = store().unreadCount(u.id);
      segHost.replaceChildren(h('div', { class: 'seg' }, h('button', { class: tab === 'alerts' ? 'on' : '', onClick: () => { tab = 'alerts'; build(); } }, 'Alertes' + (unread ? ' (' + unread + ')' : '')), h('button', { class: tab === 'events' ? 'on' : '', onClick: () => { tab = 'events'; build(); } }, 'Événements')));
      const keep = content.scrollTop;
      if (tab === 'events') { events.refresh(); content.replaceChildren(events.el); }
      else {
        const list = store().notificationsOf(u.id);
        content.replaceChildren(
          list.length ? h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '4px 0 10px' } }, h('span', { class: 'small muted' }, list.length + ' alerte' + (list.length > 1 ? 's' : '')), unread ? h('span', { class: 'link small', onClick: () => store().markAllRead(u.id) }, 'Tout marquer comme lu') : null) : null,
          list.length ? h('div', { class: 'list' }, list.map((n) => { const [ic, cls] = iconFor[n.type] || ['bell', '']; return h('div', { class: 'notif' + (n.read ? '' : ' unread'), onClick: () => { store().markRead(n.id); if (n.truckId) S.openFiche(n.truckId); } }, h('div', { class: 'ic ' + cls }, icon(ic, 18)), h('div', { class: 'grow' }, h('div', { class: 'small', style: { color: 'var(--tx)' } }, n.text), h('div', { class: 'tiny muted mt4' }, ui.ago(n.createdAt, store().now()))), n.read ? null : h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ac)', flex: 'none', marginTop: '6px' } })); }))
            : ui.empty('🔔', 'Rien pour l’instant', 'Suivez des food trucks : vous serez prévenu de leurs changements de lieu, retards, annulations et ruptures, et quand l’un d’eux s’installe près de vous.', h('div', { class: 'col gap8', style: { alignItems: 'center' } }, h('button', { class: 'btn primary', onClick: () => App.setTab('map') }, icon('map'), 'Trouver des food trucks'), h('button', { class: 'btn', onClick: () => U.openZoneSheet({ onDone: build }) }, icon('pin'), 'Me prévenir près de chez moi'))));
      }
      content.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Alertes')), segHost, h('div', { style: { height: '8px' } }), content), refresh: build, onMount: build };
  };

  /* ================================================================ MODE SANS COMPTE (consultation seule) */
  S.guest_map = () => mapScreen({});
  S.guest_events = function () {
    const events = U.eventsList(false); const body = h('div', { class: 'scroll pad' }, events.el);
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Événements')), body), refresh: () => events.refresh(), onMount: () => events.refresh() };
  };
  S.guest_account = function () {
    const li = (ic, t) => h('div', { class: 'row gap12', style: { padding: '6px 0' } }, icon(ic, 20), h('div', { class: 'small' }, t));
    const body = h('div', { class: 'scroll pad' },
      h('div', { class: 'card' }, h('div', { class: 'bold', style: { fontSize: '18px' } }, 'Vous explorez sans compte'),
        h('div', { class: 'small muted mt4' }, 'Vous pouvez voir la carte, les fiches, les avis et les événements. Avec un compte gratuit, vous pouvez en plus :'),
        h('div', { class: 'mt8' }, li('heart', 'suivre vos food trucks préférés'), li('bell', 'être prévenu de leurs changements de lieu, retards et annulations'), li('check', 'donner votre avis'), li('flag', 'signaler une fiche trompeuse')),
        h('button', { class: 'btn primary block lg mt12', onClick: () => App.push(S.signupClient()) }, 'Créer mon compte client'),
        h('button', { class: 'btn block mt8', onClick: () => App.push(S.login()) }, 'Se connecter'),
        h('button', { class: 'btn block mt8', onClick: () => App.push(S.signupTruck()) }, icon('truck'), 'Je suis un food truck')),
      ...S.appearanceBlock(),
      h('div', { class: 'sec' }, 'Informations'),
      h('div', { class: 'card small muted' }, 'Votre position n’est jamais enregistrée : elle sert uniquement à afficher les food trucks autour de vous.'),
      h('div', { class: 'col gap8 mt12' },
        ...S.legalButtons(),
        h('button', { class: 'btn ghost block', onClick: () => { App.guest = false; App.render(); } }, 'Retour à l’accueil')),
      U.updateCard(),
        h('div', { class: 'tiny muted center mt16', style: { paddingBottom: '24px' } }, 'LocalTruck · version ' + MFT.updates.label() + ' · gratuit · France\nCartes © contributeurs OpenStreetMap'));
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Compte')), body) };
  };

  /* ================================================================ PROFIL CLIENT */
  S.accountCommon = function (opts) {
    opts = opts || {}; const u = App.user();
    const name = h('input', { class: 'inp', value: u.name, maxlength: '40' });
    const rows = [];
    if (u.deletionRequestedAt) rows.push(h('div', { class: 'card warn' }, h('div', { class: 'bold' }, 'Suppression de compte demandée'), h('div', { class: 'small mt4' }, 'Demande du ' + new Date(u.deletionRequestedAt).toLocaleDateString('fr-FR') + '. Votre compte' + (App.myTrucks().length ? ' et votre fiche sont masqués' : ' est masqué') + ' en attendant la validation de l’administrateur, qui effacera ensuite vos données.'), h('button', { class: 'btn block mt12', onClick: () => S.deleteAccountFlow() }, 'Annuler ma demande')));
    rows.push(h('div', { class: 'card' }, h('div', { class: 'row gap12' }, h('div', { class: 'avatar', style: { background: 'var(--ac)' } }, u.name.charAt(0).toUpperCase()), h('div', { class: 'grow' }, h('div', { class: 'bold' }, u.name), h('div', { class: 'small muted ell' }, u.email), h('div', { class: 'tiny muted' }, u.role === 'admin' ? 'Administration' : u.role === 'truck' || App.myTrucks().length ? 'Compte food truck' : 'Compte client'))),
      ui.field('Nom affiché', name), h('button', { class: 'btn block mt12', onClick: App.guard(async () => { store().updateUser(u.id, { name: name.value }); ui.toast('Nom mis à jour', 'ok'); }) }, 'Enregistrer')));
    const promo = MFT.install && u.role !== 'admin' ? MFT.install.card({ compact: true, where: 'profile' }) : null; if (promo) rows.push(promo);
    return { rows, name };
  };
  S.passwordSheet = function () {
    const u = App.user(); const o = h('input', { class: 'inp', type: 'password', placeholder: 'Mot de passe actuel' }); const n = h('input', { class: 'inp', type: 'password', placeholder: 'Nouveau mot de passe' }); let sh;
    sh = ui.openSheet('Changer le mot de passe', h('div', null, ui.field('Actuel', ui.pwdField(o)), ui.field('Nouveau', ui.pwdField(n), C.PASSWORD_HINT), h('button', { class: 'btn primary block mt16', onClick: App.guard(async () => { await store().changePassword(u.id, o.value, n.value); sh.close(); ui.toast('Mot de passe modifié', 'ok'); }) }, 'Modifier')));
  };
  /* Suppression de compte en deux temps : on DEMANDE (compte masqué, annulable) ; l'administrateur valide ou refuse. */
  S.deleteAccountFlow = function () {
    const u = App.user(); const mine = store().db.trucks.filter((t) => t.ownerId === u.id); const names = mine.map((t) => t.name).join(', ');
    if (u.deletionRequestedAt) {
      return ui.confirmDialog({ title: 'Annuler ma demande ?', text: 'Votre compte' + (mine.length ? ' et la fiche de votre food truck (' + names + ')' : '') + ' redeviendra visible.', okLabel: 'Annuler ma demande', cancelLabel: 'Garder ma demande' })
        .then(App.guard(async (ok) => { if (!ok) return; await store().cancelDeletion(u.id); App.render(); ui.toast('Demande annulée : votre compte est de nouveau visible', 'ok'); }));
    }
    return ui.confirmDialog({ title: 'Demander la suppression de mon compte ?', text: 'Votre compte' + (mine.length ? ' et la fiche de votre food truck (' + names + ')' : '') + ' sera masqué tout de suite. L’administrateur validera ensuite la suppression définitive de vos données (avis, favoris' + (mine.length ? ', fiche' : '') + '…). Vous pouvez annuler votre demande tant qu’elle n’est pas validée.', okLabel: 'Envoyer la demande', danger: true })
      .then(App.guard(async (ok) => { if (!ok) return; await store().requestDeletion(u.id); App.viewAsClient = false; App.render(); ui.toast('Demande envoyée : votre compte est masqué', 'ok'); }));
  };
  S.deleteAccountLabel = function (u, withFiche) { return u.deletionRequestedAt ? 'Annuler ma demande de suppression' : (withFiche ? 'Demander la suppression de mon compte et ma fiche' : 'Demander la suppression de mon compte'); };
  S.client_profile = function () {
    const body = h('div', { class: 'scroll pad' });
    function build() {
      const u = App.user(); const common = S.accountCommon(); const keep = body.scrollTop;
      const radiusLbl = h('b', null, C.fmtRadius(u.prefs.radiusKm || 12));
      const radius = ui.radiusSlider(u.prefs.radiusKm || 12, (v) => { radiusLbl.textContent = C.fmtRadius(v); App.filters.radiusKm = v; }); radius.addEventListener('change', () => store().updateUser(u.id, { prefs: { radiusKm: C.RADIUS_STEPS[+radius.value] } }));
      body.replaceChildren(...common.rows,
        h('div', { class: 'sec' }, 'Préférences'),
        h('div', { class: 'card' },
          h('div', { class: 'col gap8' }, h('div', { class: 'small bold' }, 'Rayon de recherche par défaut'), h('div', { class: 'row gap12' }, h('div', { class: 'grow' }, radius), radiusLbl)),
          h('div', { class: 'sep', style: { margin: '10px 0' } }),
          h('div', { class: 'setting', style: { padding: '4px 0' } }, icon('bell'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, 'Alertes de mes favoris'), h('div', { class: 'tiny muted' }, 'Lieu, retard, annulation, rupture, proximité')), ui.toggle(u.prefs.alertsEnabled !== false, (v) => store().updateUser(u.id, { prefs: { alertsEnabled: v } }))),
          h('div', { class: 'setting', style: { padding: '8px 0 4px', border: 0 } }, icon('send'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, MFT.platform.isElectron ? 'Notifications Windows' : 'Notifications de l’appareil'), h('div', { class: 'tiny muted' }, 'Afficher une notification quand l’application est en arrière-plan')), ui.toggle(u.prefs.nativeNotifs !== false, (v) => { store().updateUser(u.id, { prefs: { nativeNotifs: v } }); if (v) MFT.platform.askNotifyPermission(); }))),
        U.pushCard(build),
        u.role === 'client' || u.role === 'admin' ? U.zoneCard(build) : null,
        u.role === 'truck' && !App.myTrucks().length ? h('div', { class: 'card' }, h('div', { class: 'bold' }, 'Votre fiche food truck n’a pas été créée'), h('div', { class: 'small muted mt4' }, 'Votre compte existe, mais la fiche n’a pas pu être enregistrée (connexion coupée ?). Terminez en quelques secondes.'), h('button', { class: 'btn primary block mt12', onClick: () => App.push(S.signupTruck({ existing: true })) }, icon('truck'), 'Créer ma fiche')) : null,
        App.myTrucks().length ? h('div', { class: 'sec' }, 'Mon food truck') : null,
        App.myTrucks().length ? h('button', { class: 'btn primary block', onClick: () => { App.viewAsClient = false; App.render(); } }, icon('truck'), 'Revenir à mon espace food truck') : null,
        u.role === 'admin' ? h('button', { class: 'btn block mt8', onClick: () => { App.adminAsTruck = false; App.viewAsClient = false; App.render(); } }, icon('shield'), 'Revenir à l’administration') : null,
        ...U.testSection(),
        ...S.appearanceBlock(),
        h('div', { class: 'sec' }, 'Mes données'),
        h('div', { class: 'card small muted' }, 'Votre position n’est jamais enregistrée : elle sert uniquement à afficher les food trucks autour de vous. Seule exception, facultative : la zone « Prévenez-moi », dont le centre est arrondi à 1 km environ.'),
        h('div', { class: 'col gap8 mt12' },
          ...S.legalButtons(),
          h('button', { class: 'btn block', onClick: () => S.passwordSheet() }, 'Changer le mot de passe'),
          h('button', { class: 'btn block', onClick: () => { store().logout(); App.viewAsClient = false; App.adminAsTruck = false; App.render(); } }, icon('logout'), 'Se déconnecter'),
          u.role === 'admin' ? null : h('button', { class: 'btn block' + (u.deletionRequestedAt ? '' : ' danger'), onClick: () => S.deleteAccountFlow() }, icon('trash'), S.deleteAccountLabel(u))),
        U.updateCard(),
        h('div', { class: 'tiny muted center mt16', style: { paddingBottom: '24px' } }, 'LocalTruck · version ' + MFT.updates.label() + ' · gratuit · France\nCartes © contributeurs OpenStreetMap'));
      body.scrollTop = keep;
    }
    const watch = () => { if (!MFT.push) return; const off = MFT.push.onChange(() => { if (!body.isConnected) off(); else build(); }); };
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Profil')), body), onMount: () => { build(); watch(); } };
  };
})();
