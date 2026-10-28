/* LocalTruck – espace food truck : tableau de bord, planning 7 jours, ma carte, statistiques, compte et équipe. */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui; const App = MFT.App;
  const S = MFT.screens; const U = MFT.util; const store = () => App.store;
  const ALLERGENS = ['Gluten', 'Lait', 'Œufs', 'Arachides', 'Fruits à coque', 'Poisson', 'Crustacés', 'Soja', 'Sésame', 'Moutarde', 'Céleri', 'Sulfites'];
  const me = () => App.user(); const truck = () => App.activeTruck();
  const todayKey = () => C.dateKey(store().now());
  const fmtIn = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') : m + ' min'; };
  const lastPlace = (t) => { let p = null; Object.values(t.planning).forEach((d) => (d.slots || []).forEach((s) => { if (s.place && typeof s.place.lat === 'number') p = s.place; })); return p; };
  const followers = (t) => store().followerCount(t.id);
  /** Ligne « Prévenir mes N abonnés » avec interrupteur. */
  function notifyRow(t, initial) {
    let on = !!initial; const n = followers(t);
    const el = h('div', { class: 'setting', style: { padding: '8px 0' } }, icon('bell'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, n ? 'Prévenir mes ' + n + ' abonné' + (n > 1 ? 's' : '') : 'Prévenir mes abonnés'), h('div', { class: 'tiny muted' }, n ? 'Une alerte leur sera envoyée' : 'Aucun abonné pour le moment')), ui.toggle(on, (v) => { on = v; }));
    return { el, get: () => on };
  }
  const header = (t, right) => h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('div', { class: 'grow row gap12', style: { minWidth: 0 } }, ui.avatar(t, 'sm'), h('div', { style: { minWidth: 0 } }, h('h1', { class: 'ell', style: { fontSize: '19px' } }, t.name), h('div', { class: 'sub' }, App.myTrucks().length > 1 ? h('span', { class: 'link', onClick: () => switchTruck() }, 'Changer de food truck') : t.cuisines.join(' · ')))), right || null);
  function switchTruck() {
    let sh; sh = ui.openSheet('Mes food trucks', h('div', { class: 'list' }, App.myTrucks().map((t) => h('div', { class: 'item' + (t.id === truck().id ? ' sel' : ''), onClick: () => { App.activeTruckId = t.id; sh.close(); App.render(); } }, ui.avatar(t, 'sm'), h('div', { class: 'grow t' }, t.name), t.id === truck().id ? icon('check') : null))));
  }

  /* ================================================================ ACCUEIL */
  S.truck_home = function () {
    const body = h('div', { class: 'scroll pad' }); const wrap = h('div', { class: 'col' });
    const hd = h('div'); wrap.append(hd, body);
    function goLive(mode) {
      const t = truck(); const cur = store().currentSlot(t); const hint = (cur && cur.slot.place) || lastPlace(t);
      App.push(S.locationPicker({ title: mode === 'move' ? 'Nouvel endroit' : 'Où êtes-vous ?', confirmLabel: mode === 'move' ? 'Je suis maintenant ici' : 'Je suis ici', hint, nearby: { truckId: t.id, key: todayKey(), start: C.hm(store().now()), end: C.addMinutesHM(C.hm(store().now()), 180) },
        onConfirm: (place) => {
          const nr = notifyRow(t, followers(t) > 0); const sm = store().summary(t); const soonEnd = !cur && sm && sm.status === 'soon' && sm.key === todayKey() ? sm.slot.end : null; const end = h('input', { class: 'inp', type: 'time', value: cur ? cur.slot.end : soonEnd || C.addMinutesHM(C.hm(store().now()), 180) });
          ui.confirmDialog({ title: mode === 'move' ? 'Changer d’endroit ?' : 'Passer en service ?', text: place.name + (place.address && place.address !== place.name ? ' · ' + place.address : ''), okLabel: mode === 'move' ? 'Je change d’endroit' : 'Passer en service',
            content: h('div', null, mode === 'move' ? null : ui.field('Jusqu’à', end), nr.el) }).then(App.guard(async (ok) => {
            if (!ok) return;
            if (mode === 'move') { const r = store().moveLive(me().id, t.id, place, nr.get()); ui.toast('Nouvel emplacement publié' + (r.notified ? ' · ' + r.notified + ' abonné(s) prévenu(s)' : ''), 'ok'); }
            else { const r = store().goLive(me().id, t.id, { place, endTime: end.value, notify: nr.get() }); ui.toast('Vous êtes en service' + (r.notified ? ' · ' + r.notified + ' abonné(s) prévenu(s)' : ''), 'ok'); }
          }));
        } }));
    }
    function delaySheet() {
      const t = truck(); let min = 15; const nr = notifyRow(t, followers(t) > 0); let sh;
      const chips = h('div'); const paint = () => chips.replaceChildren(ui.chipRow([15, 30, 45, 60].map((m) => ({ value: m, label: '+' + m + ' min' })), min, (v) => { min = v; paint(); }, { wrap: true }));
      paint();
      sh = ui.openSheet('J’ai du retard', h('div', null, h('p', { class: 'muted small', style: { margin: '0 0 10px' } }, 'Les horaires de votre prochain créneau sont décalés.'), chips, nr.el, h('button', { class: 'btn primary block mt16', onClick: App.guard(async () => { const r = store().delayService(me().id, t.id, min, nr.get()); sh.close(); ui.toast('Créneau décalé de ' + min + ' min' + (r.notified ? ' · ' + r.notified + ' abonné(s) prévenu(s)' : ''), 'ok'); }) }, 'Décaler mon ouverture')));
    }
    function cancelSheet() {
      const t = truck(); let reason = 'Météo'; const nr = notifyRow(t, followers(t) > 0); let sh;
      const chips = h('div'); const paint = () => chips.replaceChildren(ui.chipRow(['Météo', 'Panne', 'Complet', 'Imprévu'], reason, (v) => { reason = v; paint(); }, { wrap: true })); paint();
      sh = ui.openSheet('Fermé ce soir', h('div', null, h('p', { class: 'muted small', style: { margin: '0 0 10px' } }, 'Vos créneaux d’aujourd’hui sont annulés et n’apparaissent plus dans les listes.'), chips, nr.el, h('button', { class: 'btn danger block mt16', onClick: App.guard(async () => { const r = store().cancelTonight(me().id, t.id, reason, nr.get()); sh.close(); ui.toast('Service annulé pour ce soir' + (r.notified ? ' · ' + r.notified + ' abonné(s) prévenu(s)' : ''), 'ok'); }) }, 'Annuler le service de ce soir')));
    }
    function notifySheet() {
      const t = truck(); const n = followers(t); let sh;
      const ta = h('textarea', { class: 'inp', maxlength: '140', placeholder: 'Ex. Ce soir : burger du mois à 9 € !' });
      const quick = ['Ouvert dès maintenant !', 'Burger du mois dispo ce soir', 'Dernières portions, venez vite'];
      sh = ui.openSheet('Prévenir mes abonnés', h('div', null, h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, n ? n + ' abonné' + (n > 1 ? 's' : '') + ' recevront ce message.' : 'Vous n’avez pas encore d’abonné : ils apparaissent quand des clients vous suivent.'), ta,
        h('div', { class: 'chips wrap mt8' }, quick.map((q) => h('button', { class: 'chip', onClick: () => { ta.value = q; } }, q))),
        h('button', { class: 'btn primary block mt16', disabled: !n, onClick: App.guard(async () => { const c = await store().manualNotify(me().id, t.id, ta.value); sh.close(); ui.toast(c + ' abonné(s) prévenu(s)', 'ok'); }) }, icon('send'), 'Envoyer')));
    }
    function build() {
      const t = truck(); if (!t) return; const keep = body.scrollTop;
      const cur = store().currentSlot(t); const sum = store().summary(t); const st = store().statsFor(t.id); const now = +store().now();
      hd.replaceChildren(header(t, h('div', { class: 'row' }, h('button', { class: 'icon-btn', 'aria-label': 'Voir la carte', onClick: () => S.openMap() }, icon('map')), h('button', { class: 'icon-btn', 'aria-label': 'Aperçu côté client', onClick: () => S.openFiche(t.id, { preview: true }) }, icon('eye')))));
      let card;
      if (cur) {
        const iv = C.slotInterval(cur.key, cur.slot);
        card = h('div', { class: 'card tint' }, h('div', { class: 'row gap8' }, h('span', { class: 'pulse' }), h('span', { class: 'tiny bold', style: { color: 'var(--gr-tx)', letterSpacing: '.1em' } }, 'EN SERVICE')),
          h('div', { style: { fontFamily: 'var(--font-d)', fontSize: '22px', fontWeight: 800, marginTop: '6px' } }, cur.slot.place.name), h('div', { class: 'small muted' }, 'Aujourd’hui, ' + C.fmtHours(cur.slot) + ' · fin dans ' + fmtIn(iv.end - now)),
          h('div', { class: 'row gap8 mt12' }, h('button', { class: 'btn grow', onClick: () => goLive('move') }, icon('swap'), 'Je change d’endroit'), h('button', { class: 'btn grow', onClick: App.guard(async () => { if (await ui.confirmDialog({ title: 'Terminer le service ?', text: 'Vous n’apparaîtrez plus comme ouvert.', okLabel: 'Fin de service' })) { store().endService(me().id, t.id); ui.toast('Service terminé'); } }) }, icon('stop'), 'Fin de service')));
      } else if (sum && sum.status === 'cancelled') {
        card = h('div', { class: 'card alert' }, h('div', { class: 'tiny bold', style: { color: 'var(--rd-tx)', letterSpacing: '.1em' } }, 'FERMÉ CE SOIR'), h('div', { class: 'small mt4' }, (sum.slot.cancelReason ? 'Raison : ' + sum.slot.cancelReason + '. ' : '') + 'Vos clients voient que vous ne servez pas aujourd’hui.'),
          h('div', { class: 'row gap8 mt12' }, h('button', { class: 'btn grow', onClick: App.guard(async () => { store().restoreTonight(me().id, t.id); ui.toast('Service rétabli'); }) }, 'Rouvrir'), h('button', { class: 'btn primary grow', onClick: () => goLive('live') }, 'Je suis ici maintenant')));
      } else if (sum && ['soon', 'later'].includes(sum.status) && sum.key === todayKey()) {
        const iv = C.slotInterval(sum.key, sum.slot);
        card = h('div', { class: 'card' }, h('div', { class: 'tiny bold', style: { color: 'var(--am-tx)', letterSpacing: '.1em' } }, 'PROCHAIN CRÉNEAU'), h('div', { style: { fontFamily: 'var(--font-d)', fontSize: '21px', fontWeight: 800, marginTop: '6px' } }, sum.slot.place.name), h('div', { class: 'small muted' }, 'Aujourd’hui, ' + C.fmtHours(sum.slot) + ' · dans ' + fmtIn(iv.start - now)),
          h('button', { class: 'btn primary block mt12', onClick: () => goLive('live') }, icon('play'), 'Je suis ici maintenant'),
          h('div', { class: 'row gap8 mt8' }, h('button', { class: 'btn grow', onClick: delaySheet }, icon('clock'), 'J’ai du retard'), h('button', { class: 'btn grow', onClick: cancelSheet }, icon('close'), 'Fermé ce soir')));
      } else {
        card = h('div', { class: 'card' }, h('div', { class: 'tiny bold muted', style: { letterSpacing: '.1em' } }, 'HORS SERVICE'), h('div', { class: 'bold mt4', style: { fontSize: '17px' } }, 'Rien de prévu pour le moment'), h('div', { class: 'small muted' }, 'Annoncez où vous êtes pour apparaître sur la carte.'),
          h('button', { class: 'btn primary block mt12', onClick: () => goLive('live') }, icon('play'), 'Je suis ici maintenant'), h('button', { class: 'btn block mt8', onClick: () => App.setTab('planning') }, icon('calendar'), 'Planifier mes prochains jours'));
      }
      const unplanned = store().weekKeys().filter((k) => !store().getDay(t, k));
      const weekRows = store().weekKeys().map((k) => {
        const d = store().getDay(t, k); const dd = C.parseKey(k);
        return h('div', { class: 'day-row' + (k === todayKey() ? ' today' : ''), style: { cursor: 'pointer' }, onClick: () => { App.planningKey = k; App.setTab('planning'); } }, h('div', { class: 'd' }, C.DOW_SHORT[dd.getDay()], h('b', null, dd.getDate())),
          d ? (d.rest ? h('div', { class: 'grow' }, h('div', { class: 'bold' }, 'Repos'), h('div', { class: 'small muted' }, 'Pas de service')) : h('div', { class: 'grow' }, d.slots.map((s) => h('div', null, h('div', { class: 'bold ell' }, (s.place.name || s.place.address) + (s.cancelled ? ' (annulé)' : '')), h('div', { class: 'small muted' }, C.fmtHours(s)))))) : h('div', { class: 'grow muted small' }, 'Non planifié'), icon('right', 18));
      });
      const unp = unplanned.length ? h('div', { class: 'card warn mt12', style: { display: 'flex', gap: '12px', alignItems: 'center' } }, icon('alert'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, unplanned.length === 1 ? C.fmtDayLong(unplanned[0]) + ' n’est pas planifié' : unplanned.length + ' jours ne sont pas planifiés'), h('div', { class: 'tiny' }, 'Vos clients ne savent pas où vous trouver.')), h('button', { class: 'btn sm', onClick: () => { App.planningKey = unplanned[0]; App.setTab('planning'); } }, 'Planifier')) : null;
      const stock = t.products.length ? h('div', { class: 'card' }, t.products.map((p) => h('div', { class: 'setting', style: { padding: '8px 0' } }, h('div', { class: 'grow' }, h('div', { class: 'bold small' + (p.available ? '' : ' muted') }, p.name), h('div', { class: 'tiny muted' }, p.available ? 'Disponible' : 'Rupture · abonnés prévenus')), ui.toggle(p.available, App.guard(async (v) => { const n = store().setProductAvailable(me().id, t.id, p.id, v); ui.toast(v ? p.name + ' de nouveau disponible' : 'Plus de ' + p.name + (n ? ' · ' + n + ' abonné(s) prévenu(s)' : '')); }))))) : h('div', { class: 'card small muted' }, 'Ajoutez vos produits dans « Ma carte » pour gérer les ruptures en un tap.');
      body.replaceChildren(card, U.billingCard(t, build, { compact: true }),
        h('div', { class: 'row gap8 mt12' }, h('div', { class: 'tile', onClick: () => App.setTab('stats'), style: { cursor: 'pointer' } }, h('b', null, st.views), h('span', null, 'Vues de la fiche')), h('div', { class: 'tile', onClick: () => App.setTab('stats'), style: { cursor: 'pointer' } }, h('b', null, st.routes), h('span', null, 'Itinéraires')), h('div', { class: 'tile', onClick: () => App.setTab('stats'), style: { cursor: 'pointer' } }, h('b', null, st.followers), h('span', null, 'Abonnés'))),
        h('div', { class: 'sec' }, h('span', null, 'Votre semaine'), h('span', { class: 'link', style: { textTransform: 'none', letterSpacing: 0, fontSize: '13px' }, onClick: () => App.setTab('planning') }, 'Modifier')),
        h('div', { class: 'list' }, weekRows), unp,
        h('div', { class: 'sec' }, 'Ruptures de stock'), stock,
        h('div', { class: 'col gap8 mt16', style: { paddingBottom: '24px' } },
          h('button', { class: 'btn block', onClick: notifySheet }, icon('bell'), 'Prévenir mes abonnés'),
          h('button', { class: 'btn block', onClick: () => App.push(editFiche()) }, icon('edit'), 'Modifier ma fiche (logo, nom, présentation)'),
          h('button', { class: 'btn block', onClick: () => S.openFiche(t.id, { preview: true }) }, icon('eye'), 'Aperçu côté client'),
          h('button', { class: 'btn block', onClick: () => U.openShareSheet(t) }, icon('qr'), 'Partager ma fiche (lien et QR code)'),
          U.posterButton ? U.posterButton(t) : null));
      body.scrollTop = keep;
    }
    return { el: wrap, refresh: build, onMount: build };
  };

  /* ================================================================ PLANNING */
  S.truck_planning = function () {
    let selKey = null; const drafts = {}; let draftTruck = null;
    const strip = h('div', { class: 'chips pad', style: { padding: '2px 16px 8px' } }); const body = h('div', { class: 'scroll pad' });
    const blankSlot = (t) => ({ id: C.uid('sl'), start: '18:00', end: '22:00', place: null, products: [], note: '' });
    function draft(key) {
      const t = truck();
      if (draftTruck !== t.id) { Object.keys(drafts).forEach((k) => delete drafts[k]); draftTruck = t.id; }
      if (!drafts[key]) {
        const d = store().getDay(t, key); const wd = C.weekdayOf(key);
        drafts[key] = d ? { rest: d.rest, slots: C.clone(d.slots), note: d.note || '', repeat: !!(t.weekly && t.weekly[wd]), notify: false, dirty: false } : { rest: false, slots: [blankSlot(t)], note: '', repeat: false, notify: false, dirty: false };
        if (d && !d.rest && !d.slots.length) drafts[key].slots = [blankSlot(t)];
      }
      return drafts[key];
    }
    function drawStrip() {
      const t = truck(); strip.replaceChildren(...store().weekKeys().map((k) => {
        const d = store().getDay(t, k); const dd = C.parseKey(k);
        return h('button', { class: 'day-pill' + (k === selKey ? ' on' : '') + (d && d.rest ? ' rest' : ''), 'data-key': k, onClick: () => { selKey = k; drawStrip(); drawEditor(); } }, C.DOW_SHORT[dd.getDay()], h('b', null, dd.getDate()), d ? h('i') : null);
      }));
    }
    function drawEditor() {
      const t = truck(); const k = selKey; const dr = draft(k); const keep = body.scrollTop;
      const fresh = !store().getDay(t, k);
      const seg = h('div', { class: 'seg' }, h('button', { class: !dr.rest ? 'on' : '', onClick: () => { dr.rest = false; dr.dirty = true; drawEditor(); } }, 'Je suis là'), h('button', { class: dr.rest ? 'on' : '', onClick: () => { dr.rest = true; dr.dirty = true; drawEditor(); } }, 'Repos'));
      const parts = [h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '4px 0 10px' } }, h('h2', { style: { fontSize: '20px', fontWeight: 800 } }, C.fmtDayLong(k)), fresh ? h('span', { class: 'tag soon' }, 'Non planifié') : dr.dirty ? h('span', { class: 'tag' }, 'Modifié') : h('span', { class: 'tag open' }, 'Publié')), seg];
      if (dr.rest) parts.push(h('div', { class: 'card mt16 small muted' }, 'Ce jour-là, vos clients verront « Repos · pas de service ».'));
      else {
        dr.slots.forEach((s, i) => {
          const prodChips = t.products.length ? h('div', { class: 'chips wrap mt8' }, t.products.map((p) => { const on = !s.products.length || s.products.includes(p.id); return h('button', { class: 'chip' + (on ? ' on' : ''), onClick: () => { let sel = s.products.length ? s.products.slice() : t.products.map((x) => x.id); const ix = sel.indexOf(p.id); if (ix >= 0) sel.splice(ix, 1); else sel.push(p.id); if (sel.length === t.products.length) sel = []; if (!sel.length && ix >= 0 && t.products.length === 1) sel = [p.id]; s.products = sel; dr.dirty = true; drawEditor(); } }, p.name); })) : h('div', { class: 'tiny muted mt4' }, 'Ajoutez des produits dans « Ma carte » pour choisir ceux du jour.');
          const from = h('input', { class: 'inp', type: 'time', value: s.start, onChange: (e) => { s.start = e.target.value; dr.dirty = true; } });
          const to = h('input', { class: 'inp', type: 'time', value: s.end, onChange: (e) => { s.end = e.target.value; dr.dirty = true; } });
          const note = h('input', { class: 'inp', maxlength: '140', placeholder: 'Un mot pour vos clients (facultatif)', value: s.note || '', onInput: (e) => { s.note = e.target.value; dr.dirty = true; } });
          parts.push(h('div', { class: 'card mt16' },
            h('div', { class: 'row' }, h('div', { class: 'bold grow' }, dr.slots.length > 1 ? 'Créneau ' + (i + 1) : 'Où serez-vous ?'), dr.slots.length > 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Supprimer ce créneau', onClick: () => { dr.slots.splice(i, 1); dr.dirty = true; drawEditor(); } }, icon('trash', 20)) : null),
            h('button', { class: 'btn block mt8', style: { justifyContent: 'flex-start', height: 'auto', minHeight: '48px', padding: '8px 14px', textAlign: 'left' }, onClick: () => App.push(S.locationPicker({ title: 'Où serez-vous ?', place: s.place, hint: lastPlace(t), nearby: { truckId: t.id, key: k, start: s.start, end: s.end }, confirmLabel: 'Confirmer ce lieu', cancelLabel: 'Garder l’emplacement précédent', onConfirm: (p) => { s.place = p; dr.dirty = true; drawEditor(); } })) }, icon('pin'), h('span', { style: { minWidth: 0, whiteSpace: 'normal' } }, s.place ? h('span', null, h('b', null, s.place.name), h('br'), h('span', { class: 'small muted' }, s.place.address)) : 'Choisir le lieu sur la carte')),
            h('div', { class: 'row gap12' }, h('div', { class: 'grow' }, ui.field('De', from)), h('div', { class: 'grow' }, ui.field('à', to))),
            h('div', { class: 'field' }, h('label', null, 'Ce que vous proposez ce jour-là'), prodChips), ui.field(null, note)));
        });
        if (dr.slots.length < C.MAX_SLOTS_PER_DAY) parts.push(h('button', { class: 'btn block mt12', onClick: () => { const last = dr.slots[dr.slots.length - 1]; const s = blankSlot(t); if (last) { s.start = last.end; s.end = C.addMinutesHM(last.end, 180); } dr.slots.push(s); dr.dirty = true; drawEditor(); } }, icon('plus'), 'Ajouter un créneau'));
        parts.push(ui.field('Message pour la journée (facultatif)', h('input', { class: 'inp', maxlength: '200', placeholder: 'Ex. Burger du mois à 9 € ce jour-là', value: dr.note, onInput: (e) => { dr.note = e.target.value; dr.dirty = true; } })));
      }
      const n = followers(t); const wd = C.DOW_LONG[C.weekdayOf(k)];
      parts.push(h('div', { class: 'card mt16' },
        h('div', { class: 'setting', style: { padding: '4px 0' } }, icon('bell'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, n ? 'Prévenir mes ' + n + ' abonné' + (n > 1 ? 's' : '') : 'Prévenir mes abonnés'), h('div', { class: 'tiny muted' }, n ? 'À la publication' : 'Aucun abonné pour le moment')), ui.toggle(dr.notify, (v) => { dr.notify = v; })),
        h('div', { class: 'setting', style: { padding: '8px 0 4px', border: 0 } }, icon('refresh'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, 'Répéter chaque ' + wd), h('div', { class: 'tiny muted' }, 'Ce planning se reproduit automatiquement')), ui.toggle(dr.repeat, (v) => { dr.repeat = v; dr.dirty = true; }))));
      parts.push(h('div', { class: 'col gap8 mt16', style: { paddingBottom: '24px' } },
        h('button', { class: 'btn primary lg block', onClick: App.guard(async () => save()) }, 'Enregistrer et publier'),
        h('div', { class: 'row gap8' }, h('button', { class: 'btn grow', onClick: App.guard(async () => copySheet()) }, icon('copy'), 'Copier vers…'),
          !fresh ? h('button', { class: 'btn danger grow', onClick: App.guard(async () => { if (await ui.confirmDialog({ title: 'Effacer ce jour ?', text: 'Il redeviendra « non planifié ».', okLabel: 'Effacer', danger: true })) { store().clearDay(me().id, t.id, k); delete drafts[k]; drawStrip(); drawEditor(); ui.toast('Jour effacé'); } }) }, icon('trash'), 'Effacer') : null)));
      body.replaceChildren(...parts); body.scrollTop = keep;
    }
    function payload(dr) { return { rest: dr.rest, note: dr.note, slots: dr.slots.map((s) => ({ id: s.id, start: s.start, end: s.end, place: s.place, products: s.products, note: s.note, cancelled: s.cancelled, live: s.live, endedAt: s.endedAt, delayMin: s.delayMin, moved: s.moved })) }; }
    function save() {
      const t = truck(); const dr = draft(selKey);
      const r = store().setDay(me().id, t.id, selKey, payload(dr), { notify: dr.notify, repeat: dr.repeat });
      dr.dirty = false; dr.notify = false; delete drafts[selKey]; drawStrip(); drawEditor();
      ui.toast('Planning publié' + (r.notified ? ' · ' + r.notified + ' abonné(s) prévenu(s)' : ''), 'ok');
    }
    function copySheet() {
      const t = truck(); const dr = draft(selKey);
      store().setDay(me().id, t.id, selKey, payload(dr), { repeat: dr.repeat }); dr.dirty = false; delete drafts[selKey];
      const picked = new Set(); let sh;
      const rows = store().weekKeys().filter((k) => k !== selKey).map((k) => { const cb = h('input', { type: 'checkbox', onChange: (e) => { e.target.checked ? picked.add(k) : picked.delete(k); } }); return h('label', { class: 'check', style: { alignItems: 'center', color: 'var(--tx)', margin: '0', padding: '12px 0', borderBottom: '1px solid var(--bd)', fontSize: '15px' } }, cb, C.fmtDayLong(k), store().getDay(t, k) ? h('span', { class: 'tag', style: { marginLeft: 'auto' } }, 'sera remplacé') : null); });
      sh = ui.openSheet('Copier ' + C.fmtDayLong(selKey).toLowerCase() + ' vers…', h('div', null, h('div', null, rows), h('button', { class: 'btn primary block mt16', onClick: App.guard(async () => { if (!picked.size) { ui.toast('Choisissez au moins un jour.', 'err'); return; } store().duplicateDay(me().id, t.id, selKey, [...picked]); picked.forEach((k) => delete drafts[k]); sh.close(); drawStrip(); ui.toast('Planning copié sur ' + picked.size + ' jour' + (picked.size > 1 ? 's' : ''), 'ok'); }) }, 'Copier')));
      drawStrip(); drawEditor();
    }
    const scr = {
      el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('div', { class: 'grow' }, h('h1', null, 'Mon planning'), h('div', { class: 'sub' }, 'Semaine du ' + C.fmtDayShort(store().weekKeys()[0]) + ' au ' + C.fmtDayShort(store().weekKeys()[6])))), strip, body),
      onShow: () => { const keys = store().weekKeys(); if (App.planningKey && keys.includes(App.planningKey)) { selKey = App.planningKey; App.planningKey = null; } else if (!selKey || !keys.includes(selKey)) selKey = keys.find((k) => !store().getDay(truck(), k)) || keys[0]; drawStrip(); drawEditor(); },
      refresh: () => { if (!selKey) return; if (!draft(selKey).dirty) { delete drafts[selKey]; drawEditor(); } drawStrip(); },
    };
    return scr;
  };

  /* ================================================================ MA CARTE */
  function productForm(t, p) {
    const st = { name: p ? p.name : '', desc: p ? p.desc : '', price: p ? String(p.price).replace('.', ',') : '', veg: p ? p.veg : false, allergens: p ? p.allergens.slice() : [] };
    const name = h('input', { class: 'inp', maxlength: '60', placeholder: 'Ex. Smash classique', value: st.name, onInput: (e) => { st.name = e.target.value; } });
    const desc = h('input', { class: 'inp', maxlength: '120', placeholder: 'Ex. Bœuf, cheddar, oignons, pickles', value: st.desc, onInput: (e) => { st.desc = e.target.value; } });
    const price = h('input', { class: 'inp', inputmode: 'decimal', placeholder: '9,50', value: st.price, onInput: (e) => { st.price = e.target.value; } });
    const al = h('div'); const paint = () => al.replaceChildren(ui.chipRow(ALLERGENS, st.allergens, (v) => { const i = st.allergens.indexOf(v); if (i >= 0) st.allergens.splice(i, 1); else st.allergens.push(v); paint(); }, { wrap: true })); paint();
    let sh;
    sh = ui.openSheet(p ? 'Modifier le produit' : 'Nouveau produit', h('div', null, ui.field('Nom', name), ui.field('Description', desc), ui.field('Prix indicatif (€)', price),
      h('div', { class: 'setting' }, icon('leaf'), h('div', { class: 'grow bold small' }, 'Option végétarienne'), ui.toggle(st.veg, (v) => { st.veg = v; })),
      h('div', { class: 'field' }, h('label', null, 'Allergènes'), al),
      h('div', { class: 'row gap8 mt16' }, p ? h('button', { class: 'btn danger', onClick: App.guard(async () => { if (await ui.confirmDialog({ title: 'Supprimer ce produit ?', okLabel: 'Supprimer', danger: true })) { store().removeProduct(me().id, t.id, p.id); sh.close(); } }) }, icon('trash')) : null,
        h('button', { class: 'btn primary grow', onClick: App.guard(async () => { store().upsertProduct(me().id, t.id, { id: p && p.id, name: st.name, desc: st.desc, price: st.price, veg: st.veg, allergens: st.allergens }); sh.close(); ui.toast(p ? 'Produit mis à jour' : 'Produit ajouté', 'ok'); }) }, 'Enregistrer'))));
    return sh;
  }
  S.productForm = productForm;

  function editFiche() {
    const t = truck(); const st = { name: t.name, cuisines: t.cuisines.slice(), bio: t.bio, payments: t.payments.slice(), logo: t.logo, phone: t.phone || '', instagram: C.socialLabel('instagram', t.instagram), facebook: C.socialLabel('facebook', t.facebook) };
    const logo = h('div', { class: 'logo-pick', onClick: App.guard(async () => { const l = await ui.squareLogo(160); if (l) { st.logo = l; paintLogo(); } }) });
    const paintLogo = () => { logo.style.backgroundImage = st.logo ? 'url(' + st.logo + ')' : ''; logo.replaceChildren(st.logo ? '' : icon('camera', 28)); }; paintLogo();
    const name = h('input', { class: 'inp', maxlength: '60', value: st.name, onInput: (e) => { st.name = e.target.value; } });
    const phone = h('input', { class: 'inp', maxlength: '30', placeholder: 'Facultatif', value: st.phone, onInput: (e) => { st.phone = e.target.value; } });
    const instagram = h('input', { class: 'inp', maxlength: '200', placeholder: '@votrepseudo', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', value: st.instagram, onInput: (e) => { st.instagram = e.target.value; } });
    const facebook = h('input', { class: 'inp', maxlength: '200', placeholder: 'facebook.com/votrepage', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', value: st.facebook, onInput: (e) => { st.facebook = e.target.value; } });
    const count = h('span', { class: 'hint' }, st.bio.length + ' / 280');
    const bio = h('textarea', { class: 'inp', maxlength: '280', onInput: (e) => { st.bio = e.target.value; count.textContent = st.bio.length + ' / 280'; } }, st.bio);
    const multi = (arr, opts) => { const host = h('div'); const paint = () => host.replaceChildren(ui.chipRow(opts, arr, (v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); paint(); }, { wrap: true })); paint(); return host; };
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Ma fiche')),
      h('div', { class: 'scroll pad' }, h('div', { class: 'row gap12 mt8' }, logo, h('div', { class: 'grow' }, h('div', { class: 'lbl' }, 'Logo'), st.logo ? h('span', { class: 'link small', onClick: () => { st.logo = null; paintLogo(); } }, 'Retirer le logo') : h('div', { class: 'hint' }, 'Facultatif'))),
        ui.field('Nom du food truck', name), h('div', { class: 'field' }, h('label', null, 'Type de cuisine'), multi(st.cuisines, C.CUISINES)),
        h('div', { class: 'field' }, h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Présentation'), count), bio),
        h('div', { class: 'field' }, h('label', null, 'Paiements acceptés'), multi(st.payments, C.PAYMENTS), h('div', { class: 'hint' }, 'Information affichée sur votre fiche. Vous encaissez directement vos clients.')), ui.field('Téléphone', phone),
        ui.field('Instagram', instagram, 'Facultatif : votre @pseudo ou le lien de votre profil. Affiché sur votre fiche.'), ui.field('Facebook', facebook, 'Facultatif : le lien de votre page. Affiché sur votre fiche.'),
        h('button', { class: 'btn primary block lg mt24', style: { marginBottom: '24px' }, onClick: App.guard(async () => { await store().updateTruck(me().id, t.id, st); App.pop(); ui.toast('Fiche mise à jour', 'ok'); }) }, 'Enregistrer'))) };
  }

  S.truck_menu = function () {
    const body = h('div', { class: 'scroll pad' });
    function dishSheet() {
      const t = truck(); const cur = store().dishOfDay(t); const st = { name: cur ? cur.name : '', desc: cur ? cur.desc : '', price: cur && cur.price != null ? String(cur.price).replace('.', ',') : '', photo: cur ? cur.photo : null }; let sh;
      const photos = h('div'); const paint = () => photos.replaceChildren(t.gallery.length ? h('div', { class: 'gal' }, t.gallery.map((src, i) => h('div', { class: 'ph', style: { backgroundImage: 'url(' + src + ')', cursor: 'pointer', outline: st.photo === i ? '3px solid var(--ac)' : '' }, onClick: () => { st.photo = st.photo === i ? null : i; paint(); } }))) : h('div', { class: 'tiny muted' }, 'Ajoutez des photos à votre galerie pour illustrer le plat du jour.')); paint();
      sh = ui.openSheet('Plat du jour', h('div', null, h('p', { class: 'muted small', style: { margin: '0 0 4px' } }, 'Mis en avant en haut de votre fiche, uniquement aujourd’hui.'), ui.field('Nom du plat', h('input', { class: 'inp', maxlength: '60', value: st.name, onInput: (e) => { st.name = e.target.value; } })), ui.field('Description', h('input', { class: 'inp', maxlength: '120', value: st.desc, onInput: (e) => { st.desc = e.target.value; } })), ui.field('Prix (€)', h('input', { class: 'inp', inputmode: 'decimal', value: st.price, onInput: (e) => { st.price = e.target.value; } })), h('div', { class: 'field' }, h('label', null, 'Photo'), photos),
        h('div', { class: 'row gap8 mt16' }, cur ? h('button', { class: 'btn danger', onClick: () => { store().setDish(me().id, t.id, null); sh.close(); ui.toast('Plat du jour retiré'); } }, icon('trash')) : null, h('button', { class: 'btn primary grow', onClick: App.guard(async () => { store().setDish(me().id, t.id, st); sh.close(); ui.toast('Plat du jour publié', 'ok'); }) }, 'Publier'))));
    }
    function build() {
      const t = truck(); if (!t) return; const keep = body.scrollTop; const dish = store().dishOfDay(t);
      body.replaceChildren(
        h('div', { class: 'card mt8' }, h('div', { class: 'row gap12' }, ui.avatar(t, 'lg'), h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '18px' } }, t.name), h('div', { class: 'small muted' }, t.cuisines.join(' · ')), h('div', { class: 'row gap8 mt8' }, t.verified ? h('span', { class: 'tag ver' }, 'Vérifié') : h('span', { class: 'tag unv' }, 'Pas encore vérifié')))),
          t.bio ? h('div', { class: 'small muted mt12' }, t.bio) : null,
          h('div', { class: 'row gap8 mt12' }, h('button', { class: 'btn grow', onClick: () => App.push(editFiche()) }, icon('edit'), 'Modifier ma fiche'), h('button', { class: 'btn grow', onClick: () => S.openFiche(t.id, { preview: true }) }, icon('eye'), 'Aperçu'))),
        h('div', { class: 'sec' }, h('span', null, 'Mes produits (' + t.products.length + ')'), h('span', { class: 'link', style: { textTransform: 'none', letterSpacing: 0, fontSize: '13px' }, onClick: () => productForm(t, null) }, '+ Ajouter')),
        t.products.length ? h('div', { class: 'card', style: { padding: '2px 14px' } }, t.products.map((p) => h('div', { class: 'prod' + (p.available ? '' : ' off'), style: { cursor: 'pointer' }, onClick: () => productForm(t, p) }, h('div', { class: 'grow' }, h('div', { class: 'row gap8', style: { flexWrap: 'wrap' } }, h('span', { class: 'bold nm' }, p.name), p.veg ? h('span', { class: 'tag veg' }, 'Végé') : null, p.available ? null : h('span', { class: 'tag cancelled' }, 'Rupture')), p.desc ? h('div', { class: 'small muted' }, p.desc) : null, p.allergens.length ? h('div', { class: 'tiny muted' }, 'Allergènes : ' + p.allergens.join(', ').toLowerCase()) : null), h('div', { class: 'price' }, ui.money(p.price)))))
          : ui.empty('🍔', 'Votre carte est vide', 'Ajoutez vos produits et leurs prix indicatifs : ils s’affichent sur votre fiche.', h('button', { class: 'btn primary', onClick: () => productForm(t, null) }, icon('plus'), 'Ajouter un produit')),
        h('div', { class: 'sec' }, 'Plat du jour'),
        dish ? h('div', { class: 'card tint' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, dish.name), dish.desc ? h('div', { class: 'small muted' }, dish.desc) : null), dish.price != null ? h('div', { class: 'price' }, ui.money(dish.price)) : null), h('button', { class: 'btn sm mt8', onClick: dishSheet }, 'Modifier')) : h('button', { class: 'btn block', onClick: dishSheet }, icon('gift'), 'Mettre un plat du jour en avant'),
        h('div', { class: 'sec' }, h('span', null, 'Galerie photos (' + t.gallery.length + '/' + C.MAX_PHOTOS + ')'), t.gallery.length < C.MAX_PHOTOS ? h('span', { class: 'link', style: { textTransform: 'none', letterSpacing: 0, fontSize: '13px' }, onClick: App.guard(async () => { const img = await ui.pickImage(900, 0.8); if (img) { ui.toast('Envoi de la photo…'); await store().addPhoto(me().id, t.id, img); } }) }, '+ Ajouter une photo') : null),
        t.gallery.length ? h('div', { class: 'gal' }, t.gallery.map((src, i) => h('div', { class: 'ph', style: { backgroundImage: 'url(' + src + ')' } }, h('button', { 'aria-label': 'Supprimer la photo', onClick: () => store().removePhoto(me().id, t.id, i) }, icon('close'))))) : h('div', { class: 'card small muted' }, 'Aucune photo. Montrez vos plats : la galerie apparaît sur votre fiche.'),
        h('div', { style: { height: '24px' } }));
      body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Ma carte')), body), refresh: build, onMount: build };
  };

  /* ================================================================ STATISTIQUES */
  S.truck_stats = function () {
    const body = h('div', { class: 'scroll pad' });
    function build() {
      const t = truck(); if (!t) return; const st = store().statsFor(t.id); const keep = body.scrollTop; const max = Math.max(1, ...st.perDay.map((d) => d.views));
      body.replaceChildren(h('p', { class: 'muted small', style: { margin: '4px 0 12px' } }, 'Les 7 derniers jours. Aucune donnée personnelle : seulement des compteurs.'),
        h('div', { class: 'row gap8' }, h('div', { class: 'tile' }, h('b', null, st.views), h('span', null, 'Vues de la fiche')), h('div', { class: 'tile' }, h('b', null, st.routes), h('span', null, 'Itinéraires demandés'))),
        h('div', { class: 'row gap8 mt8' }, h('div', { class: 'tile' }, h('b', null, st.followers), h('span', null, 'Abonnés' + (st.newFollowers ? ' (' + (st.newFollowers > 0 ? '+' : '') + st.newFollowers + ' cette semaine)' : ''))), h('div', { class: 'tile' }, h('b', null, st.shares), h('span', null, 'Partages'))),
        h('div', { class: 'sec' }, 'Vues par jour'),
        h('div', { class: 'card' }, h('div', { class: 'bars' }, st.perDay.map((d) => h('div', { class: 'bar' }, h('b', null, d.views || ''), h('i', { style: { height: Math.max(3, d.views / max * 78) + 'px', opacity: d.views ? 1 : .25 } }), C.DOW_SHORT[C.parseKey(d.key).getDay()].slice(0, 3))))),
        h('div', { class: 'sec' }, 'Vos meilleurs emplacements'),
        st.topPlaces.length ? h('div', { class: 'card' }, st.topPlaces.map((p, i) => h('div', { class: 'kv' }, h('span', null, (i + 1) + '. ' + p.name), h('span', { class: 'muted' }, p.score + ' pt' + (p.score > 1 ? 's' : ''))))) : h('div', { class: 'card small muted' }, 'Vos meilleurs emplacements apparaîtront quand des clients consulteront votre fiche ou demanderont un itinéraire pendant que vous êtes en service.'),
        h('div', { class: 'tiny muted mt8' }, 'Un itinéraire compte pour 3 points, une vue pour 1 point.'), h('div', { style: { height: '24px' } }));
      body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Statistiques')), body), refresh: build, onMount: build };
  };

  /* ================================================================ COMPTE FOOD TRUCK + ÉQUIPE */
  S.truck_account = function () {
    const body = h('div', { class: 'scroll pad' });
    function build() {
      const u = me(); const t = truck(); const keep = body.scrollTop; const common = S.accountCommon(); const owner = t.ownerId === u.id;
      const mail = h('input', { class: 'inp', type: 'email', placeholder: 'Adresse e-mail du membre' });
      const team = [t.ownerId, ...t.team].map((id) => store().getUser(id)).filter(Boolean);
      const myEvents = store().upcomingEvents().filter((e) => e.createdBy === u.id || e.truckIds.includes(t.id));
      body.replaceChildren(...common.rows,
        h('div', { class: 'sec' }, 'Ma fiche'),
        h('div', { class: 'card' }, h('div', { class: 'row gap12' }, ui.avatar(t, 'lg'), h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '17px' } }, t.name), h('div', { class: 'small muted' }, t.cuisines.join(' · ') || 'Type de cuisine à renseigner'))),
          h('div', { class: 'col gap8 mt12' }, h('button', { class: 'btn primary block', onClick: () => App.push(editFiche()) }, icon('edit'), 'Modifier ma fiche'), h('button', { class: 'btn block', onClick: () => S.openFiche(t.id, { preview: true }) }, icon('eye'), 'Aperçu côté client'), U.posterButton ? U.posterButton(t) : null)),
        U.billingCard(t, build),
        App.myTrucks().length > 1 ? h('div', { class: 'sec' }, 'Mes food trucks') : null,
        App.myTrucks().length > 1 ? h('div', { class: 'list' }, App.myTrucks().map((x) => h('div', { class: 'item' + (x.id === t.id ? ' sel' : ''), onClick: () => { App.activeTruckId = x.id; App.render(); } }, ui.avatar(x, 'sm'), h('div', { class: 'grow t' }, x.name), x.id === t.id ? h('span', { class: 'tag open' }, 'Actif') : null))) : null,
        h('div', { class: 'sec' }, 'Équipe de ' + t.name),
        h('div', { class: 'card' }, team.map((m) => h('div', { class: 'setting', style: { padding: '8px 0' } }, h('div', { class: 'avatar sm', style: { background: 'var(--s3)', color: 'var(--tx)' } }, m.name.charAt(0).toUpperCase()), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, m.name + (m.id === t.ownerId ? ' · propriétaire' : '')), m.email ? h('div', { class: 'tiny muted' }, m.email) : null), m.id !== t.ownerId && (owner || m.id === u.id) ? h('button', { class: 'icon-btn', 'aria-label': 'Retirer', onClick: App.guard(async () => { if (await ui.confirmDialog({ title: 'Retirer ' + m.name + ' ?', okLabel: 'Retirer', danger: true })) { await store().removeTeamMember(u.id, t.id, m.id); if (m.id === u.id) App.render(); } }) }, icon('close', 18)) : null)),
          owner ? h('div', { class: 'mt8' }, h('div', { class: 'tiny muted' }, 'Ajoutez une personne qui a déjà un compte LocalTruck : elle pourra gérer ce food truck (planning, carte, direct).'), h('div', { class: 'row gap8 mt8' }, h('div', { class: 'grow' }, mail), h('button', { class: 'btn primary', onClick: App.guard(async () => { const m = await store().addTeamMember(u.id, t.id, mail.value); ui.toast(m.name + ' fait maintenant partie de l’équipe', 'ok'); }) }, 'Ajouter'))) : null),
        h('div', { class: 'sec' }, 'Événements'),
        myEvents.length ? h('div', { class: 'list' }, myEvents.map((e) => h('div', { class: 'item', onClick: () => U.openEventSheet(e.id) }, h('div', { class: 'datebox' }, h('span', null, C.DOW_SHORT[C.parseKey(e.date).getDay()]), h('b', null, C.parseKey(e.date).getDate())), h('div', { class: 'grow' }, h('div', { class: 't ell' }, e.name), h('div', { class: 's' }, e.place.name)), icon('right')))) : h('div', { class: 'small muted' }, 'Aucun événement à venir. Marchés de nuit, festivals, rassemblements…'),
        h('div', { class: 'col gap8 mt12' }, h('button', { class: 'btn block', onClick: () => U.openEventForm() }, icon('plus'), 'Créer un événement'), h('button', { class: 'btn block', onClick: () => { U.openMapEvents(); } }, icon('calendar'), 'Tous les événements à venir')),
        h('div', { class: 'sec' }, 'Mode'),
        h('div', { class: 'col gap8' }, u.role === 'admin' ? h('button', { class: 'btn primary block', onClick: () => { App.adminAsTruck = false; App.viewAsClient = false; App.render(); } }, icon('shield'), 'Revenir à l’administration') : null, h('button', { class: 'btn block', onClick: () => { App.viewAsClient = true; App.render(); } }, icon('user'), 'Passer en mode client (carte, favoris, alertes)'), h('button', { class: 'btn block', onClick: () => S.openMap() }, icon('map'), 'Voir la carte comme un client')),
        ...U.testSection(),
        ...S.appearanceBlock(),
        h('div', { class: 'sec' }, 'Mon compte'),
        U.pushCard(build, { truck: true }),
        h('div', { class: 'col gap8 mt12' }, ...S.legalButtons(), h('button', { class: 'btn block', onClick: () => S.passwordSheet() }, 'Changer le mot de passe'),
          h('button', { class: 'btn block', onClick: () => { store().logout(); App.viewAsClient = false; App.adminAsTruck = false; App.render(); } }, icon('logout'), 'Se déconnecter'),
          u.role === 'admin' ? null : h('button', { class: 'btn block' + (u.deletionRequestedAt ? '' : ' danger'), onClick: () => S.deleteAccountFlow() }, icon('trash'), S.deleteAccountLabel(u, true))),
        U.updateCard(),
        h('div', { class: 'tiny muted center mt16', style: { paddingBottom: '24px' } }, 'LocalTruck · version ' + MFT.updates.label() + ' · gratuit · France\nCartes © contributeurs OpenStreetMap'));
      body.scrollTop = keep;
    }
    const watch = () => { if (!MFT.push) return; const off = MFT.push.onChange(() => { if (!body.isConnected) off(); else build(); }); };
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Compte')), body), onMount: () => { build(); watch(); } };
  };
  U.openMapEvents = function () {
    const ev = U.eventsList(true);
    App.push({ el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Événements')), h('div', { class: 'scroll pad' }, ev.el)), refresh: ev.refresh });
  };
})();
