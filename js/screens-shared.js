/* LocalTruck – composants partagés : lignes de liste, recherche d'adresse, sélecteur de lieu, partage, signalement, événements. */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui; const App = MFT.App;
  MFT.screens = MFT.screens || {};
  const U = (MFT.util = {});
  const store = () => App.store;
  const FRANCE_CENTER = { lat: 46.6, lng: 2.4 };

  U.dayWord = function (key) {
    const today = C.dateKey(store().now());
    if (key === today) return 'Aujourd’hui'; if (key === C.addDaysKey(today, 1)) return 'Demain';
    const d = C.parseKey(key); const w = C.DOW_LONG[d.getDay()]; return w[0].toUpperCase() + w.slice(1, 3) + ' ' + d.getDate();
  };
  U.untilText = function (slot) { return 'jusqu’à ' + C.fmtHM(slot.end); };
  U.statusLine = function (r) {
    if (r.status === 'open') return 'Ouvert ' + U.untilText(r.slot);
    if (r.status === 'cancelled') return 'Fermé ce soir' + (r.slot.cancelReason ? ' (' + r.slot.cancelReason + ')' : '');
    return (r.key === C.dateKey(store().now()) ? 'Dès ' : U.dayWord(r.key) + ' dès ') + C.fmtHM(r.slot.start);
  };

  /* ---------------------------------------------------------- preuve sociale discrète : affichée seulement à partir de 3 abonnés (« 1 abonné » ferait fuir plus qu'il ne rassure) */
  const SOCIAL_MIN = 3;
  U.followersLine = function (t) {
    const n = store().followerCount(t.id); if (n < SOCIAL_MIN) return null;
    return h('div', { class: 'small muted mt4 row gap4', 'data-social': '1' }, icon('heart', 14), n + ' personnes suivent ce food truck');
  };

  /* ---------------------------------------------------------- ligne de food truck */
  U.truckRow = function (r, o) {
    o = o || {}; const t = r.truck; const today = C.dateKey(store().now());
    const following = o.userId && store().isFollowing(o.userId, t.id);
    const nFollow = store().followerCount(t.id);
    const heart = o.userId && o.heart !== false
      ? h('button', { class: 'icon-btn', 'aria-label': following ? 'Ne plus suivre' : 'Suivre', onClick: (e) => { e.stopPropagation(); o.onHeart && o.onHeart(t); }, style: { color: following ? 'var(--ac)' : 'var(--mu)' } }, (() => { const s = icon('heart'); if (following) s.style.fill = 'currentColor'; return s; })())
      : h('span', { style: { color: 'var(--mu)', display: 'grid', placeItems: 'center', width: '38px', height: '38px' } }, icon('right', 20));
    const row = h('div', { class: 'item tr' + (o.selected ? ' sel' : ''), 'data-id': t.id, role: 'button', tabindex: '0', onClick: () => o.onClick && o.onClick(r) },
      h('div', { class: 'it-top' },
        h('div', { class: 'it-tags' }, ui.statusTag(r.status, r.slot), t.verified ? h('span', { class: 'tag ver' }, icon('check', 12), 'Vérifié') : h('span', { class: 'tag unv' }, 'Non vérifié'), r.suspect ? ui.suspectTag() : null,
          r.key !== today ? h('span', { class: 'lbl' }, U.dayWord(r.key)) : null),
        heart),
      h('div', { class: 'it-main' },
        h('div', { class: 'cell it-av' }, ui.avatar(t)),
        h('div', { class: 'vrule' }),
        h('div', { class: 'cell it-mid' },
          h('div', { class: 'row gap8' }, h('span', { class: 't' }, t.name), r.suspect ? ui.suspectIcon() : null, nFollow >= SOCIAL_MIN ? h('span', { class: 'tiny muted row gap4', style: { flex: 'none' }, 'aria-label': nFollow + ' abonnés' }, icon('heart', 12), nFollow) : null),
          h('div', { class: 's' }, (r.slot.place.name || r.slot.place.address) + (r.dist != null ? ' · ' + C.fmtDist(r.dist) : ''))),
        h('div', { class: 'vrule' }),
        h('div', { class: 'cell it-hrs', 'aria-label': C.fmtHours(r.slot) }, h('span', { class: 'hr-a' }, C.fmtHM(r.slot.start)), h('span', { class: 's' }, C.fmtHM(r.slot.end)))),
      o.selected && o.actions ? h('div', { class: 'it-act' }, o.actions) : null);
    return row;
  };

  /* ---------------------------------------------------------- recherche d'adresse (Nominatim, France) */
  U.geoSearchBox = function (onSelect, o) {
    o = o || {};
    const input = h('input', { type: 'text', placeholder: o.placeholder || 'Adresse, ville, lieu…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Rechercher une adresse' });
    const clearBtn = h('button', { class: 'icon-btn hide', 'aria-label': 'Effacer', onClick: () => { input.value = ''; results.classList.add('hide'); clearBtn.classList.add('hide'); input.focus(); } }, icon('close', 18));
    const results = h('div', { class: 'results hide' });
    const box = h('div', { class: 'searchbar' }, icon('search', 20), input, clearBtn);
    let timer = 0, seq = 0;
    const show = (list, q) => {
      results.classList.remove('hide');
      if (!list.length) { results.replaceChildren(h('div', { style: { padding: '12px 14px', color: 'var(--mu)', fontSize: '14px' } }, 'Aucun résultat en France pour « ' + q + ' ».')); return; }
      results.replaceChildren(...list.map((p) => {
        const pl = App.placeFromGeo(p);
        return h('button', { onClick: () => { results.classList.add('hide'); input.value = pl.name + (pl.city && pl.city !== pl.name ? ', ' + pl.city : ''); onSelect(Object.assign({}, p, pl)); } }, pl.name, h('small', null, (p.label || '').split(',').slice(0, 4).join(',')));
      }));
    };
    const run = async () => {
      const q = input.value.trim(); clearBtn.classList.toggle('hide', !q);
      if (q.length < 3) { results.classList.add('hide'); return; }
      const my = ++seq; results.classList.remove('hide');
      results.replaceChildren(h('div', { style: { padding: '12px 14px', color: 'var(--mu)', fontSize: '14px' } }, h('span', { class: 'spin' }), ' Recherche…'));
      const list = await App.geoSearch(q); if (my !== seq) return; show(list, q);
    };
    input.addEventListener('input', () => { clearTimeout(timer); clearBtn.classList.toggle('hide', !input.value); timer = setTimeout(run, 700); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
    const el = h('div', { class: 'col gap8' }, box, results);
    return { el, input, focus: () => input.focus() };
  };

  /* ---------------------------------------------------------- « Où êtes-vous ? » (client) */
  U.openLocationSheet = function (o) {
    o = o || {};
    const wrap = h('div');
    let sheet;
    const sb = U.geoSearchBox((p) => { App.setPos({ lat: p.lat, lng: p.lng, label: p.name + (p.city && p.city !== p.name ? ', ' + p.city : ''), source: 'manual' }); sheet.close(); if (o.onDone) o.onDone(); }, { placeholder: 'Ville, adresse ou quartier' });
    const gpsBtn = h('button', { class: 'btn block mt12', onClick: async () => {
      gpsBtn.disabled = true; gpsBtn.replaceChildren(h('span', { class: 'spin' }), ' Localisation…');
      try { const p = await App.locate(); const r = await App.reverse(p.lat, p.lng); const pl = r ? App.placeFromGeo(r) : null; App.setPos({ lat: p.lat, lng: p.lng, label: pl ? (pl.city || pl.name) : 'Ma position', source: 'gps' }); sheet.close(); if (o.onDone) o.onDone(); }
      catch (e) { gpsBtn.disabled = false; gpsBtn.replaceChildren(icon('locate'), 'Utiliser ma position'); ui.toast('Position indisponible. Saisissez une adresse ou une ville ci-dessus.', 'err'); }
    } }, icon('locate'), 'Utiliser ma position');
    wrap.append(h('p', { class: 'muted small', style: { margin: '0 0 12px' } }, 'Votre position sert uniquement à afficher les food trucks autour de vous. Elle n’est jamais enregistrée.'), sb.el, gpsBtn);
    if (o.mapCenter) wrap.append(h('button', { class: 'btn block mt8', onClick: () => { const c = o.mapCenter(); App.setPos({ lat: c.lat, lng: c.lng, label: 'Centre de la carte', source: 'manual' }); sheet.close(); if (o.onDone) o.onDone(); } }, icon('pin'), 'Utiliser le centre de la carte'));
    sheet = ui.openSheet(o.title || 'Où êtes-vous ?', wrap);
    setTimeout(() => sb.focus(), 80);
    return sheet;
  };

  /* ---------------------------------------------------------- sélecteur de lieu sur la carte (food trucks) */
  U.locationPicker = function (o) {
    const start = o.place && typeof o.place.lat === 'number' ? { lat: o.place.lat, lng: o.place.lng, zoom: 16 }
      : App.pos ? { lat: App.pos.lat, lng: App.pos.lng, zoom: 15 }
        : o.hint ? { lat: o.hint.lat, lng: o.hint.lng, zoom: 15 } : { lat: FRANCE_CENTER.lat, lng: FRANCE_CENTER.lng, zoom: 6 };
    const map = new MFT.MapView({ lat: start.lat, lng: start.lng, zoom: start.zoom, ctrlsBottom: 14, onLocate: async () => {
      try { const p = await App.locate(); map.setView(p.lat, p.lng, 17); } catch (e) { ui.toast('Position indisponible : cherchez une adresse ou déplacez la carte.', 'err'); }
    } });
    const pin = h('div', { class: 'center-pin' }, h('div', { class: 'b' }), h('div', { class: 'l' }));
    const sb = U.geoSearchBox((p) => { map.setView(p.lat, p.lng, 17); nameInp.value = p.name; addr = p.address || ''; addrEl.textContent = addr; }, { placeholder: 'Rechercher une adresse en France' });
    let addr = ''; let seq = 0; let timer = 0; let pendingName = '';
    const nameInp = h('input', { class: 'inp', placeholder: 'Nom du lieu (ex. Place de la Mairie)', maxlength: '60', value: (o.place && o.place.name) || '' });
    const addrEl = h('div', { class: 'small muted ell' }, (o.place && o.place.address) || 'Déplacez la carte pour placer le repère.');
    const hint = h('div', { class: 'hint' });
    const warnBox = h('div');
    const confirm = h('button', { class: 'btn primary block lg' }, o.confirmLabel || 'Confirmer ce lieu');
    const scr = {
      el: h('div', { class: 'col' }, map.el,
        h('div', { class: 'pick-top' }, h('div', { class: 'row gap8' }, h('button', { class: 'icon-btn fill', 'aria-label': 'Retour', onClick: () => App.pop() }, icon('back')), h('div', { class: 'grow' }, sb.el))),
        h('div', { class: 'pick-bot' },
          h('div', { class: 'row gap8', style: { marginBottom: '8px' } }, h('h2', { style: { fontSize: '17px', flex: 1 } }, o.title || 'Choisir le lieu sur la carte'), h('span', { class: 'tiny muted' }, 'Glissez pour ajuster')),
          warnBox, nameInp, h('div', { class: 'mt8' }, addrEl), hint,
          h('div', { class: 'col gap8 mt12' }, confirm, h('button', { class: 'btn ghost block', onClick: () => App.pop() }, o.cancelLabel || 'Annuler')))),
      destroy: () => map.destroy(),
    };
    map.el.style.position = 'absolute'; map.el.style.left = '0'; map.el.style.right = '0'; map.el.style.top = '0'; map.el.appendChild(pin);
    const bot = scr.el.querySelector('.pick-bot');
    new ResizeObserver(() => requestAnimationFrame(() => { map.el.style.bottom = bot.offsetHeight + 'px'; })).observe(bot);
    const evaluate = () => {
      const c = map.getCenter(); const z = map.getZoom();
      const inFr = C.isInFrance(c.lat, c.lng);
      confirm.disabled = !inFr || z < 13;
      hint.textContent = !inFr ? 'LocalTruck est disponible en France uniquement pour l’instant.' : z < 13 ? 'Zoomez davantage pour placer le repère précisément.' : '';
      warnBox.replaceChildren();
      if (o.nearby && inFr && z >= 13) {
        const near = store().nearbySlots(o.nearby.truckId, o.nearby.key, o.nearby.start, o.nearby.end, c.lat, c.lng);
        if (near.length) warnBox.append(h('div', { class: 'card warn', style: { marginBottom: '10px', padding: '10px 12px' } },
          h('div', { class: 'row gap8 bold' }, icon('alert', 18), 'Un autre food truck est annoncé tout près'),
          ...near.slice(0, 2).map((n) => h('div', { class: 'small', style: { marginTop: '4px' } }, n.truck.name + ', à moins de ' + (Math.ceil(n.meters / 50) * 50) + ' m, de ' + C.fmtHM(n.slot.start) + ' à ' + C.fmtHM(n.slot.end) + '.'))));
      }
    };
    const lookup = () => {
      clearTimeout(timer); const c = map.getCenter();
      if (!C.isInFrance(c.lat, c.lng) || map.getZoom() < 13) return;
      timer = setTimeout(async () => {
        const my = ++seq; const r = await App.reverse(c.lat, c.lng); if (my !== seq || !r) return;
        const pl = App.placeFromGeo(r); addr = pl.address; addrEl.textContent = pl.address || (c.lat.toFixed(5) + ', ' + c.lng.toFixed(5));
        if (!nameInp.value.trim() || nameInp.value === pendingName) { nameInp.value = pl.name; pendingName = pl.name; }
      }, 700);
    };
    map.on('move', () => pin.classList.add('lift'));
    map.on('moveend', () => { pin.classList.remove('lift'); evaluate(); lookup(); });
    confirm.addEventListener('click', () => {
      const c = map.getCenter();
      const place = { name: nameInp.value.trim() || 'Lieu choisi sur la carte', address: addr || (c.lat.toFixed(5) + ', ' + c.lng.toFixed(5)), lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) };
      o.onConfirm(place); App.pop();
    });
    scr.onMount = () => { map.invalidate(); evaluate(); if (!o.place) lookup(); else pendingName = nameInp.value; };
    return scr;
  };

  /* ---------------------------------------------------------- partage (lien + QR) */
  U.openShareSheet = function (truck) {
    const text = App.shareText(truck); const link = App.shareLink(truck);
    const canvas = document.createElement('canvas'); MFT.qr.draw(canvas, text, 6);
    const body = h('div', { class: 'col gap12' },
      h('div', { class: 'row gap12' }, ui.avatar(truck), h('div', { class: 'grow' }, h('div', { class: 'bold' }, truck.name), h('div', { class: 'small muted' }, 'Fiche LocalTruck'))),
      h('div', { class: 'center' }, h('div', { class: 'qr' }, canvas), h('div', { class: 'tiny muted mt8' }, 'Le QR code contient le message ci-dessous.')),
      h('div', { class: 'card small', style: { userSelect: 'text' } }, text),
      h('div', { class: 'row gap8' },
        h('button', { class: 'btn grow', onClick: async () => { await MFT.platform.copy(text); store().track(truck.id, 'share'); ui.toast('Message copié', 'ok'); } }, icon('copy'), 'Copier le message'),
        h('button', { class: 'btn grow', onClick: async () => { await MFT.platform.copy(link); store().track(truck.id, 'share'); ui.toast('Lien copié', 'ok'); } }, icon('share'), 'Copier le lien')));
    return ui.openSheet('Partager ' + truck.name, body);
  };

  /* ---------------------------------------------------------- mode « sans compte » : invitation à créer un compte */
  U.askAccount = function (what) {
    let sh; if (MFT.funnel) MFT.funnel.track('wall');
    sh = ui.openSheet('Un compte est nécessaire', h('div', { class: 'col gap12' },
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Pour ' + what + ', il faut un compte. C’est gratuit, rapide, et sans paiement.'),
      h('button', { class: 'btn primary block', onClick: () => { sh.close(); App.push(MFT.screens.signupClient()); } }, 'Créer mon compte client'),
      h('button', { class: 'btn block', onClick: () => { sh.close(); App.push(MFT.screens.login()); } }, 'J’ai déjà un compte'),
      h('button', { class: 'btn ghost block', onClick: () => sh.close() }, 'Plus tard')));
    return sh;
  };

  /** Bouton « Rechercher une mise à jour » des écrans « Compte » (absent là où les mises à jour automatiques n'existent pas). */
  U.updateCard = function () {
    const up = MFT.updates; if (!up || !up.supported() || !up.manual()) return null;      // le site se met à jour tout seul : pas de bouton
    const pend = up.pending();
    const b = h('button', { class: 'btn block' + (pend ? ' primary' : ''), onClick: async () => { b.disabled = true; try { await up.checkNow(); } finally { b.disabled = false; } } },
      icon('refresh'), pend && pend.version ? 'Mettre à jour vers la version ' + pend.version : 'Rechercher une mise à jour');
    return h('div', { class: 'mt12' }, b);
  };

  /** « Mon abonnement » (écrans du food truck). Invisible tant que les abonnements sont éteints (script SQL 7 : `set_billing`).
   *  opts.compact : simple bandeau d'alerte, uniquement quand un paiement est à faire. Le paiement se fait sur la page sécurisée de Stripe :
   *  aucun numéro de carte ne passe par LocalTruck. */
  U.billingCard = function (t, rebuild, opts) {
    opts = opts || {}; if (!t || !store().billingFor) return null;
    const v = store().billingFor(t); if (!v.show) return null;
    const todo = v.state === 'due' || v.state === 'late';
    if (opts.compact && !todo) return null;
    const open = (base) => {
      let url = null; try { const u = new URL(base); u.searchParams.set('client_reference_id', t.id); url = u.toString(); } catch (e) { /* lien invalide : pas de bouton */ }
      if (!url) return ui.toast('Lien de paiement indisponible.', 'err');
      MFT.platform.openExternal(url).then((ok) => { if (!ok) ui.toast('Impossible d’ouvrir la page de paiement.', 'err'); });
    };
    const btns = [];
    const payLink = v.paymentLink, portal = v.portalLink;
    if (v.state === 'due' || v.state === 'canceled') { if (payLink) btns.push(h('button', { class: 'btn primary block', onClick: () => open(payLink) }, icon('share'), v.state === 'canceled' ? 'Me réabonner · ' + v.price : 'M’abonner · ' + v.price)); }
    if (v.state === 'late' && (portal || payLink)) btns.push(h('button', { class: 'btn primary block', onClick: () => open(portal || payLink) }, icon('share'), 'Régler mon paiement'));
    if (v.state === 'paid' && portal) btns.push(h('button', { class: 'btn block', onClick: () => open(portal) }, icon('share'), 'Gérer mon abonnement (facture, carte, résiliation)'));
    if (todo || v.state === 'canceled') btns.push(h('button', { class: 'btn block', onClick: App.guard(async () => { await store().refreshBilling(); ui.toast('Abonnement actualisé', 'ok'); if (rebuild) rebuild(); }) }, icon('refresh'), 'J’ai payé : actualiser'));
    if (todo && !payLink && !portal) btns.push(h('div', { class: 'tiny muted' }, 'Le paiement en ligne n’est pas encore ouvert : contactez LocalTruck.'));
    const head = opts.compact ? null : h('div', { class: 'sec' }, 'Mon abonnement');
    const card = h('div', { class: 'card' + (todo ? ' warn' : ''), style: opts.compact ? { marginTop: '12px' } : null },
      h('div', { class: 'row gap12' }, icon(todo ? 'alert' : 'check'), h('div', { class: 'grow' }, opts.compact ? h('div', { class: 'bold small' }, v.state === 'late' ? 'Paiement en retard' : 'Abonnement à régler') : null, h('div', { class: 'small' }, v.text))),
      btns.length ? h('div', { class: 'col gap8 mt12' }, btns) : null);
    return opts.compact ? card : h('div', null, head, card);
  };

  /* ---------------------------------------------------------- après un « Suivre » : compteur anonyme + proposition d'installer l'application */
  U.followed = function () { if (MFT.funnel) MFT.funnel.track('follow'); if (MFT.install) MFT.install.afterFollow(); };

  /* ---------------------------------------------------------- « Prévenez-moi quand un truck arrive » : une zone (centre arrondi à ~1 km, rayon 1 à 5 km) */
  const ZONE_RADII = [1, 2, 5];
  U.zoneText = (z) => (z.label || 'Zone choisie') + ' · ' + z.radiusKm + ' km';
  U.openZoneSheet = function (o) {
    o = o || {}; const u = App.user();
    if (!u) return U.askAccount('être prévenu quand un food truck arrive près de chez vous');
    const c = o.center || App.pos || App.lastMapCenter; if (!c) { ui.toast('Indiquez d’abord où vous êtes.', 'err'); return null; }
    const cur = store().myZone(); let radius = cur ? cur.radiusKm : 2; let label = c.label || ''; let sh;
    const where = h('b', null, label || 'Autour de ce point');
    if (!label) App.reverse(c.lat, c.lng).then((r) => { if (!r) return; const pl = App.placeFromGeo(r); label = pl.city || pl.name || ''; if (label) where.textContent = label; });
    const chips = h('div', { class: 'chips wrap' });
    const drawChips = () => chips.replaceChildren(...ZONE_RADII.map((k) => h('button', { class: 'chip' + (radius === k ? ' on' : ''), type: 'button', onClick: () => { radius = k; drawChips(); } }, k + ' km')));
    drawChips();
    const kids = [
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Dès qu’un food truck annonce un emplacement dans cette zone, vous êtes prévenu.'),
      h('div', { class: 'card row gap8' }, icon('pin', 18), h('div', { class: 'grow small' }, where)),
      h('div', null, h('div', { class: 'lbl' }, 'Rayon autour de ce point'), chips),
      h('button', { class: 'btn primary block', onClick: App.guard(async () => {
        await store().setZone(u.id, { lat: c.lat, lng: c.lng, radiusKm: radius, label });
        if (MFT.funnel) MFT.funnel.track('zone');
        sh.close(); ui.toast('C’est noté : vous serez prévenu près de ' + (label || 'ce point'), 'ok');
        if (o.onDone) o.onDone();
        if (MFT.install) MFT.install.afterZone();
      }) }, icon('bell'), cur ? 'Remplacer ma zone' : 'Me prévenir'),
    ];
    if (cur) kids.push(h('div', { class: 'small muted' }, 'Zone actuelle : ' + U.zoneText(cur)),
      h('button', { class: 'btn ghost block', onClick: App.guard(async () => { await store().clearZone(u.id); sh.close(); ui.toast('Zone supprimée'); if (o.onDone) o.onDone(); }) }, icon('trash'), 'Supprimer ma zone'));
    if (MFT.platform.isAndroidApp) kids.push(h('div', { class: 'tiny muted' }, 'Dans l’application Android, l’alerte apparaît dans l’onglet Alertes quand vous l’ouvrez. Pour être prévenu application fermée, ouvrez LocalTruck dans Chrome puis « Ajouter à l’écran d’accueil ».'));
    kids.push(h('div', { class: 'tiny muted' }, 'Nous gardons seulement le centre de la zone, arrondi à 1 km environ, pour vous prévenir. Personne d’autre ne le voit, et vous pouvez le supprimer quand vous voulez.'));
    sh = ui.openSheet('Prévenez-moi quand un truck arrive', h('div', { class: 'col gap12' }, kids));
    return sh;
  };
  /** Carte « Ma zone d'alerte » du profil : voir, changer ou supprimer sa zone. */
  U.zoneCard = function (onChange) {
    const z = store().myZone(); const u = App.user();
    return h('div', { class: 'card mt12' },
      h('div', { class: 'setting', style: { padding: 0, border: 0 } }, icon('pin'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, 'Prévenez-moi quand un truck arrive'), h('div', { class: 'tiny muted' }, z ? U.zoneText(z) : 'Choisissez une zone : vous êtes prévenu quand un food truck y annonce un emplacement.'))),
      h('div', { class: 'row gap8 mt12' },
        h('button', { class: 'btn grow', onClick: () => U.openZoneSheet({ onDone: onChange }) }, z ? 'Modifier' : 'Choisir une zone'),
        z ? h('button', { class: 'btn grow', onClick: App.guard(async () => { await store().clearZone(u.id); ui.toast('Zone supprimée'); if (onChange) onChange(); }) }, 'Supprimer') : null));
  };

  /** Carte « Notifications même application fermée » des écrans « Profil » / « Compte » (rien si l'appareil ne peut pas les recevoir). */
  U.pushCard = function (rebuild, opts) {
    opts = opts || {}; const P = MFT.push; const st = P ? P.state() : 'unsupported';
    const head = (sub, ctl) => h('div', { class: 'setting', style: { padding: 0, border: 0 } }, icon('bell'), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, 'Notifications même application fermée'), h('div', { class: 'tiny muted' }, sub)), ctl || null);
    if (MFT.platform.isAndroidApp) return h('div', { class: 'card mt12' }, head('Pas disponibles dans cette application : les alertes s’affichent quand vous l’ouvrez. Pour être prévenu application fermée, utilisez LocalTruck depuis Chrome (« Ajouter à l’écran d’accueil »).'),
      h('button', { class: 'btn block mt12', onClick: () => MFT.platform.openExternal((window.MFT_CONFIG && window.MFT_CONFIG.shareBase) || 'https://localtruck.fr/') }, icon('share'), 'Ouvrir la version web'));
    if (st === 'unsupported' || st === 'unavailable' || st === 'loading') return null;
    if (st === 'install') return h('div', { class: 'card mt12' }, head('Sur iPhone, ajoutez d’abord LocalTruck à l’écran d’accueil (Partager > Sur l’écran d’accueil), ouvrez-le depuis là, puis revenez ici pour les activer.'));
    if (st === 'blocked') return h('div', { class: 'card mt12' }, head('Bloquées pour ce site : autorisez les notifications dans les réglages du navigateur, puis revenez ici.'));
    const sub = st === 'on' ? 'Activées sur cet appareil' + (opts.truck ? ' · alertes, avis et récap du lundi' : ' · alertes de vos favoris et de votre zone') : 'Recevoir les alertes sur cet appareil, même quand LocalTruck est fermé';
    return h('div', { class: 'card mt12' }, head(sub, ui.toggle(st === 'on', App.guard(async (v) => {
      try {
        if (v) { await P.enable(); ui.toast('Notifications activées sur cet appareil', 'ok'); }
        else { await P.disable(); ui.toast('Notifications désactivées sur cet appareil'); }
      } finally { if (rebuild) rebuild(); }
    }))));
  };

  /* ---------------------------------------------------------- signalement */
  U.openReportSheet = function (target) {
    let reason = null; const ta = h('textarea', { class: 'inp', maxlength: '300', placeholder: 'Précisez si vous le souhaitez (facultatif)' });
    const chips = h('div', { class: 'chips wrap' });
    (target.reasons || C.REPORT_REASONS).forEach((r) => { const b = h('button', { class: 'chip', type: 'button', onClick: () => { reason = r.id; chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); } }, r.label); chips.appendChild(b); });
    let sheet;
    const send = h('button', { class: 'btn primary block mt16', onClick: App.guard(async () => {
      if (!reason) { ui.toast('Choisissez un motif.', 'err'); return; }
      const res = await store().report(App.user().id, { targetType: target.type, targetId: target.id, reason, comment: ta.value });
      sheet.close(); ui.toast(res.suspect ? 'Merci. Ce food truck est désormais signalé comme suspect.' : 'Merci, votre signalement a été transmis.', 'ok');
    }) }, icon('flag'), 'Envoyer le signalement');
    sheet = ui.openSheet(target.title || 'Signaler', h('div', null,
      h('p', { class: 'muted small', style: { margin: '0 0 10px' } }, target.type === 'review' ? 'L’administration examine chaque signalement et retire l’avis s’il ne respecte pas les règles des avis.' : 'Quand un food truck est signalé plus de ' + C.SUSPECT_THRESHOLD + ' fois, un point d’exclamation prévient les autres utilisateurs.'),
      h('div', { class: 'lbl' }, 'Motif'), chips, ui.field('Commentaire', ta), send));
    return sheet;
  };

  /* ---------------------------------------------------------- événements */
  U.openEventSheet = function (eventId) {
    const ev = store().db.events.find((e) => e.id === eventId); if (!ev) return;
    const u = App.user(); const mine = App.myTrucks();
    let sheet;
    const body = h('div', { class: 'col gap12' });
    const build = () => {
      const e = store().db.events.find((x) => x.id === eventId); if (!e) { sheet.close(); return; }
      const d = C.parseKey(e.date); const joined = mine.find((t) => e.truckIds.includes(t.id));
      const canDelete = u && (u.role === 'admin' || e.createdBy === u.id);
      body.replaceChildren(
        h('div', { class: 'row gap12' }, h('div', { class: 'datebox' }, h('span', null, C.DOW_SHORT[d.getDay()]), h('b', null, d.getDate())),
          h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '18px' } }, e.name), h('div', { class: 'small muted' }, C.fmtDayLong(e.date) + ' · ' + C.fmtHM(e.start) + ' – ' + C.fmtHM(e.end)))),
        h('div', { class: 'row gap8' }, icon('pin', 18), h('div', { class: 'grow small' }, e.place.name + (e.place.address && e.place.address !== e.place.name ? ' · ' + e.place.address : ''))),
        e.description ? h('div', { class: 'small', style: { userSelect: 'text' } }, e.description) : null,
        h('button', { class: 'btn block', onClick: () => { MFT.platform.openExternal('https://www.openstreetmap.org/directions?route=' + (App.pos ? App.pos.lat.toFixed(5) + ',' + App.pos.lng.toFixed(5) : '') + ';' + e.place.lat + ',' + e.place.lng); } }, icon('route'), 'Itinéraire'),
        h('div', { class: 'sec', style: { margin: '6px 0 0' } }, 'Food trucks présents (' + e.truckIds.length + ')'),
        e.truckIds.length ? h('div', { class: 'list' }, e.truckIds.map((id) => store().getTruck(id)).filter(Boolean).map((t) => h('div', { class: 'item', onClick: () => { sheet.close(); MFT.screens.openFiche(t.id); } }, ui.avatar(t, 'sm'), h('div', { class: 'grow' }, h('div', { class: 't' }, t.name), h('div', { class: 's' }, t.cuisines.join(', '))), icon('right')))) : h('div', { class: 'muted small' }, 'Aucun food truck inscrit pour le moment.'),
        mine.length ? h('button', { class: 'btn block ' + (joined ? '' : 'primary'), onClick: App.guard(async () => { const t = joined || App.activeTruck(); const now = await store().toggleEventTruck(u.id, e.id, t.id); ui.toast(now ? 'Vous participez à cet événement' : 'Participation retirée', 'ok'); build(); }) }, joined ? 'Je ne participe plus' : 'Je participe avec ' + App.activeTruck().name) : null,
        h('div', { class: 'row gap8' },
          u && u.role !== 'admin' && e.createdBy !== u.id ? h('button', { class: 'btn ghost sm', onClick: () => U.openReportSheet({ type: 'event', id: e.id, title: 'Signaler cet événement' }) }, icon('flag', 16), 'Signaler') : null,
          canDelete ? h('button', { class: 'btn danger sm', onClick: App.guard(async () => { if (await ui.confirmDialog({ title: 'Supprimer cet événement ?', okLabel: 'Supprimer', danger: true })) { await store().deleteEvent(u.id, e.id); sheet.close(); ui.toast('Événement supprimé'); } }) }, icon('trash', 16), 'Supprimer') : null));
    };
    sheet = ui.openSheet('Événement', body); build();
    return sheet;
  };

  U.openEventForm = function (onDone) {
    const u = App.user(); const today = C.dateKey(store().now());
    const st = { name: '', date: today, start: '18:00', end: '23:00', description: '', place: null };
    const name = h('input', { class: 'inp', maxlength: '80', placeholder: 'Ex. Marché de nuit des food trucks', onInput: (e) => { st.name = e.target.value; } });
    const date = h('input', { class: 'inp', type: 'date', min: today, value: today, onChange: (e) => { st.date = e.target.value; } });
    const s1 = h('input', { class: 'inp', type: 'time', value: st.start, onChange: (e) => { st.start = e.target.value; } });
    const s2 = h('input', { class: 'inp', type: 'time', value: st.end, onChange: (e) => { st.end = e.target.value; } });
    const desc = h('textarea', { class: 'inp', maxlength: '400', placeholder: 'Programme, musique, nombre de food trucks…', onInput: (e) => { st.description = e.target.value; } });
    let sheet;
    const placeBtn = h('button', { class: 'btn block', type: 'button', style: { justifyContent: 'flex-start' }, onClick: () => {
      // la feuille (z-index 100) passerait devant la carte : on la masque le temps du choix, puis on la réaffiche
      sheet.hide();
      const picker = U.locationPicker({ title: 'Lieu de l’événement', confirmLabel: 'Choisir ce lieu', place: st.place, onConfirm: (p) => { st.place = p; placeBtn.replaceChildren(icon('pin'), p.name); } });
      const prevDestroy = picker.destroy; picker.destroy = () => { if (prevDestroy) prevDestroy.call(picker); sheet.show(); };
      App.push(picker);
    } }, icon('pin'), st.place ? st.place.name : 'Choisir le lieu sur la carte');
    const go = h('button', { class: 'btn primary block mt16', onClick: App.guard(async () => { const ev = await store().createEvent(u.id, st); sheet.close(); ui.toast('Événement publié', 'ok'); if (onDone) onDone(ev); }) }, 'Publier l’événement');
    sheet = ui.openSheet('Nouvel événement', h('div', null, ui.field('Nom', name), ui.field('Date', date), h('div', { class: 'row gap12' }, h('div', { class: 'grow' }, ui.field('De', s1)), h('div', { class: 'grow' }, ui.field('à', s2))), ui.field('Lieu', placeBtn), ui.field('Description (facultatif)', desc), go));
    return sheet;
  };

  /* Liste d'événements (onglet « Événements ») */
  U.eventsList = function (canCreate) {
    const wrap = h('div', { class: 'col gap12' });
    const build = () => {
      const list = store().upcomingEvents();
      wrap.replaceChildren(
        canCreate ? h('button', { class: 'btn primary block', onClick: () => U.openEventForm(build) }, icon('plus'), 'Créer un événement') : null,
        list.length ? h('div', { class: 'list' }, list.map((e) => {
          const d = C.parseKey(e.date); const dist = App.pos ? C.haversine(App.pos.lat, App.pos.lng, e.place.lat, e.place.lng) : null;
          return h('div', { class: 'item', onClick: () => U.openEventSheet(e.id) },
            h('div', { class: 'datebox' }, h('span', null, C.DOW_SHORT[d.getDay()]), h('b', null, d.getDate())),
            h('div', { class: 'grow' }, h('div', { class: 't ell' }, e.name), h('div', { class: 's ell' }, e.place.name + (dist != null ? ' · ' + C.fmtDist(dist) : '')), h('div', { class: 's' }, C.fmtHM(e.start) + ' – ' + C.fmtHM(e.end) + ' · ' + e.truckIds.length + ' food truck' + (e.truckIds.length > 1 ? 's' : ''))), icon('right'));
        })) : ui.empty('🎪', 'Pas d’événement à venir', canCreate ? 'Créez le premier : marché de nuit, festival, rassemblement…' : 'Les rassemblements de food trucks apparaîtront ici.'));
    };
    build(); return { el: wrap, refresh: build };
  };

  MFT.screens.locationPicker = U.locationPicker;

  /* ---------------------------------------------------------- outils de test (données de démonstration, réinitialisation) */
  /** Section « Test » des profils : uniquement en mode local (hors connexion) ; en ligne il n'y a pas de données de démo. */
  U.testSection = function () { return store().isCloud ? [] : [h('div', { class: 'sec' }, 'Test'), U.testTools()]; };
  U.testTools = function () {
    const box = h('div');
    const build = () => {
      const has = store().hasDemo();
      box.replaceChildren(h('div', { class: 'card' },
        h('div', { class: 'bold' }, 'Outils de test'),
        h('div', { class: 'small muted mt4' }, 'Version de test : les données restent sur cet ordinateur. Générez de faux food trucks pour essayer la carte sans attendre de vrais inscrits.'),
        h('div', { class: 'col gap8 mt12' },
          h('button', { class: 'btn block', onClick: App.guard(async () => {
            const c = App.pos || App.lastMapCenter || { lat: 48.8566, lng: 2.3522 };
            if (!C.isInFrance(c.lat, c.lng)) { ui.toast('Choisissez une position en France pour générer des food trucks de démonstration.', 'err'); return; }
            const n = store().seedDemo(c); ui.toast(n + ' food trucks de démonstration créés autour de ' + (App.pos && App.pos.label ? App.pos.label : 'la carte'), 'ok'); build();
            if (App.tabs.map && App.tabs.map.fit) App.tabs.map.fit();
          }) }, icon('truck'), has ? 'Régénérer les food trucks de démo' : 'Générer des food trucks de démo autour de moi'),
          has ? h('button', { class: 'btn block', onClick: () => { store().removeDemo(); ui.toast('Données de démonstration supprimées'); build(); } }, icon('trash'), 'Supprimer les données de démo') : null,
          h('button', { class: 'btn danger block', onClick: App.guard(async () => {
            if (await ui.confirmDialog({ title: 'Tout réinitialiser ?', text: 'Tous les comptes, fiches, avis et réglages de cette version de test seront effacés.', okLabel: 'Tout effacer', danger: true })) { await store().resetAll(); App.render(); ui.toast('Données réinitialisées'); }
          }) }, icon('refresh'), 'Réinitialiser toutes les données'))));
    };
    build(); return box;
  };
})();
