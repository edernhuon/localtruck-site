/* LocalTruck – l'affiche : aperçu, demande d'envoi, suivi (food truck) ; liste des demandes et PDF d'impression (administration). */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui; const App = MFT.App;
  const S = MFT.screens; const U = MFT.util; const store = () => App.store; const me = () => App.user();

  /* ---------------------------------------------------------- petits outils */
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  /** « 26 oct. à 19 h 12 » (avec l'heure) ou « 26 oct. ». */
  function fmtWhen(ms, withTime) {
    const d = new Date(ms); const day = d.getDate() + ' ' + MONTHS[d.getMonth()];
    return withTime === false ? day : day + ' à ' + d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0');
  }
  const bare = (url) => String(url).replace(/^https?:\/\//, '');
  const posters = () => MFT.poster;
  const TRUCK_LABEL = { pending: 'Demande envoyée', preparing: 'En préparation', shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée' };
  const ADMIN_LABEL = { pending: 'À traiter', preparing: 'En préparation', shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée' };
  const TAG_CLASS = { pending: 'todo', preparing: 'soon', shipped: 'ver', delivered: 'open', cancelled: 'cancelled' };
  const tag = (status, admin) => h('span', { class: 'tag ' + TAG_CLASS[status] }, (admin ? ADMIN_LABEL : TRUCK_LABEL)[status] || status);
  const isOpen = (r) => r && ['pending', 'preparing', 'shipped'].includes(r.status);

  /** Aperçu de l'affiche (le même dessin que le PDF). Les contours des lettres se chargent à la demande. */
  U.posterView = function (name, slug, cls, o) {
    o = o || {};
    const box = h('div', { class: 'poster-thumb' + (cls ? ' ' + cls : ''), role: 'img', 'aria-label': 'Aperçu de l’affiche' + (name ? ' de ' + name : '') });
    posters().load().then(() => {
      const doc = new DOMParser().parseFromString(posters().toSVG(posters().build({ name, slug, kind: o.kind, format: o.format })), 'image/svg+xml');
      box.replaceChildren(document.importNode(doc.documentElement, true));
    }).catch(() => { box.classList.add('off'); });
    return box;
  };

  /* ---------- formats : A4, A5, A6 (même dessin, à l'échelle) */
  const FORMATS = [['A4', '21 × 29,7 cm', 'Grande vitre, chevalet'], ['A5', '14,8 × 21 cm', 'Près du comptoir'], ['A6', '10,5 × 14,8 cm', 'Petit espace, flyer']];
  const ISO = { A4: [210, 297], A5: [148, 210], A6: [105, 148] };      // 1 px par mm : les trois formats restent à l'échelle
  const CM = { A4: ['21 cm', '29,7 cm'], A5: ['14,8 cm', '21 cm'], A6: ['10,5 cm', '14,8 cm'] };
  /** Rendu en perspective (isométrique) de l'affiche posée à plat, avec ses cotes ; le contour de l'A4 reste visible pour comparer. */
  U.posterIso = function (name, slug, format, o) {
    o = o || {}; const f = ISO[format] ? format : 'A4'; const [w, hh] = ISO[f];
    const ghost = f !== 'A4' ? h('div', { class: 'iso-ghost', style: { width: ISO.A4[0] + 'px', height: ISO.A4[1] + 'px' } }, h('span', null, 'A4')) : null;
    const sheet = h('div', { class: 'iso-sheet', style: { width: w + 'px', height: hh + 'px' } }, U.posterView(name, slug, 'iso-art', { kind: o.kind, format: f }),
      h('div', { class: 'dim dw' }, h('span', null, CM[f][0])), h('div', { class: 'dim dh' }, h('span', null, CM[f][1])));
    return h('div', { class: 'iso-stage', 'data-format': f, role: 'button', tabindex: '0', 'aria-label': 'Affiche ' + f + ', ' + CM[f][0] + ' sur ' + CM[f][1] + ' : voir en grand',
      onClick: () => U.posterLightbox(name, slug, f, o), onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); U.posterLightbox(name, slug, f, o); } } },
      h('div', { class: 'iso-plane', style: { width: ISO.A4[0] + 'px', height: ISO.A4[1] + 'px' } }, ghost, sheet),
      h('span', { class: 'iso-hint' }, icon('eye', 14), 'Voir en grand'));
  };
  /** L'affiche vue de face, presque plein écran, le reste flouté. Se ferme d'un appui, avec la croix ou la touche Échap. */
  U.posterLightbox = function (name, slug, format, o) {
    o = o || {}; const f = ISO[format] ? format : 'A4';
    const prev = document.activeElement;
    const close = () => { lb.classList.add('out'); document.removeEventListener('keydown', onKey, true); setTimeout(() => lb.remove(), 180); if (prev && prev.focus) prev.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const lb = h('div', { class: 'poster-lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Aperçu de l’affiche ' + f, onClick: close },
      h('div', { class: 'lb-art-wrap' }, U.posterView(name, slug, 'lb-art', { kind: o.kind, format: f })),
      h('div', { class: 'lb-cap' }, 'Affiche ' + f + ' · ' + CM[f][0] + ' × ' + CM[f][1]),
      h('button', { class: 'icon-btn lb-close', 'aria-label': 'Fermer', onClick: (e) => { e.stopPropagation(); close(); } }, icon('close')));
    document.body.appendChild(lb); document.addEventListener('keydown', onKey, true);
    setTimeout(() => { const b = lb.querySelector('.lb-close'); if (b) b.focus(); }, 30);
    return lb;
  };
  /** Choix du format : trois boutons et le rendu qui suit. onChange(format) */
  U.posterFormatPicker = function (name, slug, initial, onChange, o) {
    let cur = ISO[initial] ? initial : 'A4'; const stageHost = h('div', { class: 'iso-host' }); const cap = h('div', { class: 'small muted center mt8' });
    const btns = FORMATS.map(([f, cm, use]) => h('button', { class: 'fmt-btn', type: 'button', 'data-format': f, 'aria-pressed': 'false', onClick: () => set(f) }, h('b', null, f), h('span', null, cm), h('small', null, use)));
    function set(f) { cur = f; btns.forEach((b) => { const on = b.dataset.format === f; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); stageHost.replaceChildren(U.posterIso(name, slug, f, o)); const x = FORMATS.find((y) => y[0] === f); cap.textContent = 'Affiche ' + f + ' · ' + x[1] + ' · ' + x[2].toLowerCase(); if (onChange) onChange(f); }
    const el = h('div', { class: 'fmt-pick' }, h('div', { class: 'fmt-row' }, btns), stageHost, cap);
    set(cur); return { el, get: () => cur };
  };

  /** Extension native de l'application Android (mobile/native/ApkUpdaterPlugin.java) : seule façon d'enregistrer un fichier fabriqué dans la page,
   *  la vue web d'Android ne sait pas le « télécharger ». Absente (navigateur, ordinateur, ancienne version de l'application) : null. */
  function nativePdf() {
    try { const c = window.Capacitor; const p = c && c.Plugins && c.Plugins.ApkUpdater; const on = c && (c.isNativePlatform ? c.isNativePlatform() : (c.getPlatform && c.getPlatform() !== 'web')); return on && p && typeof p.savePdf === 'function' ? p : null; } catch (e) { return null; }
  }
  const toBase64 = (bytes) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };

  /** Enregistre un fichier : application Android → « Téléchargements » puis lecteur PDF ; ailleurs → téléchargement du navigateur. */
  async function saveFile(bytes, name, type) {
    const native = nativePdf();
    if (native) {
      try {
        const r = await native.savePdf({ name, data: toBase64(bytes) });
        ui.toast(r && r.saved === 'downloads' ? 'PDF enregistré dans Téléchargements' : 'PDF prêt', 'ok');
        return;
      } catch (e) { throw new C.UserError('Impossible d’enregistrer le PDF (' + String((e && e.message) || e).slice(0, 80) + ').'); }
    }
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) throw new C.UserError('Mettez l’application à jour pour télécharger le PDF.');
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/pdf' }));
    const a = h('a', { href: url, download: name, style: { display: 'none' } }); document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
  }
  /** Télécharge le PDF d'une ou plusieurs affiches (un seul fichier, une page chacune). */
  async function downloadPosters(list) {
    try { await posters().load(); } catch (e) { throw new C.UserError(e.message); }
    const irs = list.map((r) => posters().build({ name: r.truckName, slug: r.slug, kind: r.kind, format: r.format }));
    await saveFile(posters().toPDF(irs), list.length === 1 ? posters().fileName(list[0].slug || (list[0].kind === 'join' ? 'rejoindre-localtruck' : 'localtruck'), list[0].format) : 'affiches-localtruck-' + list.length + '.pdf');
  }
  U.downloadPosters = downloadPosters;

  /* ================================================================ FOOD TRUCK : aperçu et lien */
  /** « Mon affiche » : la demande en cours si elle existe, sinon l'aperçu et le bouton de demande. */
  S.openPoster = App.guard(async function (truckId) {
    await store().loadPosterRequests(true);
    const last = store().posterRequests(truckId)[0];
    return last ? S.posterTracking(truckId) : S.posterIntro(truckId);
  });

  /** Écran d'aperçu. opts.fresh : affiché juste après la création de la fiche (« Votre fiche est en ligne »). */
  S.posterIntro = function (truckId, opts) {
    opts = opts || {}; const t = store().getTruck(truckId); if (!t) return null;
    const link = App.shareLink(t); const canAsk = store().posterSupported() && !!t.slug;
    const body = h('div', { class: 'scroll pad' });
    const ask = h('button', { class: 'btn block mt12', disabled: !canAsk, onClick: () => S.posterRequest(truckId) }, icon('truck', 18), 'Demander mon affiche');
    const hero = opts.fresh
      ? [h('div', { class: 'lbl', style: { letterSpacing: '.3em', marginTop: '4px' } }, 'LocalTruck'),
         h('div', { class: 'big-ok', style: { margin: '16px 0 0' }, 'aria-hidden': 'true' }, icon('check', 34)),
         h('h2', { style: { margin: '14px 0 6px', textTransform: 'uppercase' } }, 'Votre fiche est en ligne'),
         h('p', { class: 'muted small', style: { margin: '0 0 16px' } }, canAsk ? 'Les clients autour de vous peuvent déjà la trouver sur la carte. Voici l’aperçu de votre affiche : demandez-la, nous vous l’envoyons.' : 'Les clients autour de vous peuvent déjà la trouver sur la carte.')]
      : [h('p', { class: 'muted small', style: { margin: '4px 0 16px' } }, 'Collez l’affiche sur votre camion : vos clients vous retrouvent en un scan. Elle est gratuite et vous est envoyée par courrier.')];
    body.append(...hero,
      canAsk ? h('div', { class: 'card poster-hero' }, U.posterView(t.name, t.slug, 'w140'),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'lbl' }, 'Votre affiche · A4, A5 ou A6'), h('p', { class: 'small muted', style: { margin: '8px 0 0' } }, 'Nous vous l’envoyons par courrier. Collez-la sur votre camion : vos clients vous retrouvent en un scan.'), ask)) : null,
      h('div', { class: 'lbl mt16' }, 'Votre lien'),
      h('div', { class: 'card row gap12 mt8', style: { padding: '12px 16px' } }, h('div', { class: 'grow bold', style: { userSelect: 'text', minWidth: 0, overflowWrap: 'anywhere' }, 'data-testid': 'poster-link' }, bare(link)),
        h('button', { class: 'icon-btn', 'aria-label': 'Copier le lien', onClick: async () => { await MFT.platform.copy(link); ui.toast('Lien copié', 'ok'); } }, icon('copy', 20))),
      h('button', { class: 'btn block mt12', onClick: () => U.openShareSheet(t) }, icon('share'), 'Partager ma fiche'),
      opts.fresh ? h('button', { class: 'btn primary block lg mt24', style: { marginBottom: '24px' }, onClick: () => { App.popAll(); S.openFiche(t.id, { preview: true }); } }, 'Voir ma fiche')
        : h('div', { style: { height: '24px' } }));
    const bar = opts.fresh ? h('div', { class: 'topbar' }, h('span', { style: { flex: 1 } }), h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onClick: () => App.popAll() }, icon('close')))
      : h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Mon affiche'));
    const scr = { posterFlow: true, el: h('div', { class: 'col' }, bar, body), refresh: () => {} };
    App.push(scr); return scr;
  };

  /* ================================================================ FOOD TRUCK : demande d'envoi */
  S.posterRequest = function (truckId) {
    const t = store().getTruck(truckId); if (!t) return null;
    const f = {
      recipient: h('input', { class: 'inp', placeholder: 'Prénom et nom', autocomplete: 'name', maxlength: '80', value: (me() && me().name) || '', 'aria-label': 'Nom du destinataire' }),
      address: h('input', { class: 'inp', placeholder: 'Numéro et rue', autocomplete: 'address-line1', maxlength: '120', 'aria-label': 'Adresse' }),
      address2: h('input', { class: 'inp', placeholder: 'Bâtiment, étage, boîte aux lettres…', autocomplete: 'address-line2', maxlength: '120', 'aria-label': 'Complément d’adresse' }),
      postcode: h('input', { class: 'inp', placeholder: '00000', autocomplete: 'postal-code', inputmode: 'numeric', maxlength: '5', 'aria-label': 'Code postal' }),
      city: h('input', { class: 'inp', placeholder: 'Ville', autocomplete: 'address-level2', maxlength: '60', 'aria-label': 'Ville' }),
      phone: h('input', { class: 'inp', type: 'tel', placeholder: 'Pour le transporteur', autocomplete: 'tel', maxlength: '20', 'aria-label': 'Téléphone' }),
    };
    f.postcode.addEventListener('input', () => { f.postcode.value = f.postcode.value.replace(/\D/g, '').slice(0, 5); });
    const sub = h('p', { class: 'muted small', style: { margin: 0 } }, 'Une affiche A4 au nom de ' + t.name + ', envoyée par courrier.');
    const picker = U.posterFormatPicker(t.name, t.slug, 'A4', (fm) => { sub.textContent = 'Une affiche ' + fm + ' au nom de ' + t.name + ', envoyée par courrier.'; });
    const err = h('div', { class: 'err', role: 'alert' });
    const go = h('button', { class: 'btn primary block lg mt16', style: { marginBottom: '24px' } }, 'Envoyer ma demande');
    go.addEventListener('click', App.guard(async () => {
      err.textContent = ''; go.disabled = true;
      try {
        await store().requestPoster(me().id, truckId, { format: picker.get(), recipient: f.recipient.value, address: f.address.value, address2: f.address2.value, postcode: f.postcode.value, city: f.city.value, phone: f.phone.value });
      } catch (e) { go.disabled = false; err.textContent = e.message; if (!(e instanceof C.UserError)) throw e; return; }
      while (App.stack.length && App.stack[App.stack.length - 1].posterFlow !== undefined) App.pop();      // referme le formulaire et l'aperçu
      ui.toast('Demande envoyée', 'ok'); S.posterTracking(truckId);
    }));
    const body = h('div', { class: 'scroll pad' },
      h('h2', { style: { margin: '2px 0 4px', textTransform: 'uppercase', fontSize: '17px' } }, 'Quel format ?'),
      h('p', { class: 'muted small', style: { margin: '0 0 12px' } }, 'Le même dessin, à la taille qui convient à votre camion.'),
      picker.el,
      h('h2', { style: { margin: '24px 0 4px', textTransform: 'uppercase', fontSize: '17px' } }, 'Où l’envoyer ?'), sub,
      h('div', { class: 'mt16' }, ui.field('Nom du destinataire', f.recipient)),
      ui.field('Adresse', f.address), ui.field('Complément (facultatif)', f.address2),
      h('div', { class: 'row gap12' }, h('div', { style: { flex: '0 0 38%' } }, ui.field('Code postal', f.postcode)), h('div', { class: 'grow' }, ui.field('Ville', f.city))),
      ui.field('Téléphone (facultatif)', f.phone),
      h('p', { class: 'fine', style: { margin: '4px 0 0' } }, 'Votre adresse ne sert qu’à envoyer l’affiche. Elle est effacée une fois la livraison confirmée.'),
      err, go);
    const scr = { posterFlow: false, el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Demander mon affiche')), body), refresh: () => {}, onMount: () => { setTimeout(() => (f.recipient.value ? f.address : f.recipient).focus(), 80); } };
    App.push(scr); return scr;
  };

  /* ================================================================ FOOD TRUCK : suivi */
  S.posterTracking = function (truckId) {
    const t = store().getTruck(truckId); if (!t) return null;
    const body = h('div', { class: 'scroll pad' }); const head = h('div');
    function build() {
      const r = store().posterRequests(truckId)[0]; const keep = body.scrollTop;
      if (!r) { body.replaceChildren(ui.empty('🪧', 'Aucune demande', 'Vous n’avez pas encore demandé votre affiche.'), h('button', { class: 'btn primary block mt16', onClick: () => S.posterRequest(truckId) }, 'Demander mon affiche')); return; }
      const st = r.status; const rank = { pending: 1, preparing: 2, shipped: 3, delivered: 4 }[st] || 0;
      // état de chaque étape : demande (1), préparation (2), expédition (3), livraison (4)
      const steps = [
        ['Demande envoyée', fmtWhen(r.createdAt), 'done'],
        ['En préparation', rank >= 2 ? 'Votre affiche est imprimée à votre nom.' : '', rank === 2 ? 'cur' : rank > 2 ? 'done' : ''],
        ['Expédiée', r.tracking ? 'Numéro de suivi : ' + r.tracking : rank >= 3 ? 'Votre affiche est en route.' : 'Le numéro de suivi s’affichera ici.', rank === 3 ? 'cur' : rank > 3 ? 'done' : ''],
        ['Livrée', st === 'delivered' ? 'Votre adresse a été effacée.' : '', st === 'delivered' ? 'done' : ''],
      ];
      head.replaceChildren(h('div', { class: 'row gap12', style: { alignItems: 'flex-start' } }, U.posterView(r.truckName, r.slug, 'w76', { format: r.format }),
        h('div', { class: 'grow', style: { minWidth: 0, paddingTop: '4px' } }, h('h2', { style: { margin: '0 0 10px', textTransform: 'uppercase', fontSize: '17px' } }, 'Affiche ' + (r.format || 'A4') + ' · ' + r.truckName), tag(st))));
      const timeline = st === 'cancelled'
        ? h('div', { class: 'card alert small' }, h('div', { class: 'bold' }, 'Demande annulée'), h('div', { class: 'mt4' }, 'Votre adresse a été effacée. Vous pouvez refaire une demande quand vous voulez.'))
        : h('div', { class: 'card steps', 'data-testid': 'poster-steps' }, steps.map(([title, text, s]) => h('div', { class: 'step ' + s }, h('span', { class: 'step-dot ' + (s === 'done' ? 'ok' : s), 'aria-hidden': 'true' }, s === 'done' ? icon('check', 14) : null),
          h('div', null, h('div', { class: 'bold' + (s ? '' : ' muted') }, title), text ? h('div', { class: 'small muted' }, text) : null))));
      const delivery = r.address ? [h('div', { class: 'lbl mt16' }, 'Livraison'),
        h('div', { class: 'card mt8' }, h('div', { class: 'bold' }, r.recipient), h('div', { class: 'small mt4' }, r.address), r.address2 ? h('div', { class: 'small' }, r.address2) : null, h('div', { class: 'small' }, r.postcode + ' ' + r.city), r.phone ? h('div', { class: 'small muted mt4' }, 'Tél. ' + r.phone) : null)] : [];
      const canCancel = st === 'pending' || st === 'preparing';
      body.replaceChildren(head, h('div', { class: 'mt16' }, timeline), ...delivery,
        isOpen(r) ? h('div', { class: 'row gap12 mt16 small muted', style: { alignItems: 'flex-start' } }, h('span', { style: { color: 'var(--ac)', paddingTop: '1px' } }, icon('bell', 18)), h('span', null, 'Vous êtes prévenu à chaque étape par une notification.')) : null,
        h('div', { class: 'col gap8 mt24', style: { paddingBottom: '24px' } },
          canCancel ? h('button', { class: 'btn block', onClick: App.guard(async () => {
            if (!(await ui.confirmDialog({ title: 'Annuler ma demande ?', text: 'Votre affiche ne sera pas envoyée et votre adresse sera effacée.', okLabel: 'Annuler la demande', cancelLabel: 'Garder', danger: true }))) return;
            await store().cancelPoster(me().id, r.id); ui.toast('Demande annulée'); build();
          }) }, 'Annuler ma demande') : null,
          canCancel ? h('div', { class: 'tiny muted center' }, 'Possible jusqu’à l’expédition.') : null,
          st === 'delivered' || st === 'cancelled' ? h('button', { class: 'btn block', onClick: () => S.posterRequest(truckId) }, st === 'delivered' ? 'Demander une autre affiche' : 'Refaire une demande') : null));
      body.scrollTop = keep;
    }
    const scr = { posterFlow: true, el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Mon affiche')), body), refresh: () => { store().loadPosterRequests(); build(); }, onMount: () => { build(); store().loadPosterRequests(true); } };
    App.push(scr); return scr;
  };

  /** Bouton « Mon affiche » des écrans du food truck (rien si la base n'a pas encore le script 13, ou en mode local). */
  U.posterButton = function (t) {
    if (!t || !t.slug || !store().posterSupported()) return null;
    const last = store().posterRequests(t.id)[0];
    return h('button', { class: 'btn block', 'data-testid': 'poster-btn', onClick: () => S.openPoster(t.id) }, icon('qr'), 'Mon affiche' + (last && isOpen(last) ? ' · ' + TRUCK_LABEL[last.status].toLowerCase() : ''));
  };

  /* ================================================================ ADMINISTRATION */
  /** Onglet « Affiches » de l'administration : demandes des food trucks, affiche de n'importe quelle fiche (même sans demande), affiches génériques. */
  S.admin_posters = function () {
    const body = h('div', { class: 'scroll pad' });
    function build() {
      const list = store().posterAdmin ? store().posterAdmin() : []; const n = (st) => list.filter((r) => r.status === st).length;
      const entry = (title, sub, onClick, badge, testid) => h('div', { class: 'item', 'data-testid': testid, onClick }, h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 's' }, sub)), badge ? h('span', { class: 'tag todo' }, badge) : null, icon('right'));
      body.replaceChildren(
        h('div', { class: 'row gap8', style: { alignItems: 'stretch' } }, [['pending', 'À traiter'], ['preparing', 'En préparation'], ['shipped', 'Expédiées']].map(([k, lab]) => h('div', { class: 'tile', style: { minWidth: 0 } }, h('b', null, n(k)), h('span', null, lab)))),
        h('div', { class: 'sec' }, 'Demandes des food trucks'),
        h('div', { class: 'list' }, entry('Demandes d’affiches', n('pending') ? n('pending') + ' à traiter' : (list.length ? list.length + ' demande' + (list.length > 1 ? 's' : '') + ', rien à traiter' : 'Aucune demande pour l’instant'), () => S.adminPosters(), n('pending'), 'poster-admin-entry')),
        h('div', { class: 'sec' }, 'Créer une affiche'),
        h('div', { class: 'list' },
          entry('Affiche d’un food truck', 'N’importe quelle fiche, inscrite ou non : pour démarcher ou offrir', () => S.adminPosterPick(), 0, 'poster-pick'),
          entry('« Rejoignez LocalTruck »', 'Affiche générique pour inviter les food trucks', () => S.adminPosterMake({ kind: 'join' }), 0, 'poster-join'),
          entry('« Les food trucks près de chez vous »', 'Affiche générique pour les clients (mairies, commerces…)', () => S.adminPosterMake({ kind: 'clients' }), 0, 'poster-clients')),
        h('p', { class: 'fine', style: { margin: '16px 0 24px' } }, 'Toutes les affiches existent en A4, A5 et A6, en PDF vectoriel prêt à imprimer.'));
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Affiches')), body), refresh: build, onMount: () => { build(); store().loadAdminPosters(); posters().load().catch(() => {}); } };
  };

  /** Choisir la fiche (food truck inscrit ou fiche provisoire) dont on veut l'affiche. */
  S.adminPosterPick = function () {
    let q = ''; let listings = []; const list = h('div', { class: 'list mt12' }); const note = h('div', { class: 'tiny muted mt8' }, 'Chargement des fiches non inscrites…');
    const input = h('input', { type: 'search', placeholder: 'Nom, ville ou cuisine', onInput: (e) => { q = C.norm(e.target.value); draw(); } });
    function draw() {
      const tr = store().db.trucks.filter((t) => t.slug).map((t) => ({ name: t.name, slug: t.slug, sub: (t.cuisines || []).join(', '), kind: 'Inscrit' }));
      const ls = listings.map((l) => ({ name: l.name, slug: l.slug, sub: [l.cuisine, l.city].filter(Boolean).join(' · '), kind: 'Non inscrit' }));
      const all = tr.concat(ls).filter((x) => !q || C.norm(x.name + ' ' + x.sub).includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      list.replaceChildren(...(all.length ? all.slice(0, 80).map((x) => h('div', { class: 'item', 'data-slug': x.slug, onClick: () => S.adminPosterMake({ name: x.name, slug: x.slug }) },
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 't ell' }, x.name), h('div', { class: 's ell' }, x.sub || '—')), h('span', { class: 'tag' + (x.kind === 'Inscrit' ? ' open' : '') }, x.kind), icon('right')))
        : [ui.empty('🔍', 'Aucune fiche', 'Essayez un autre nom.')]));
    }
    const body = h('div', { class: 'scroll pad' }, h('div', { class: 'searchbar', style: { marginTop: '4px' } }, icon('search', 20), input), note, list);
    const scr = { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Affiche d’un food truck')), body), refresh: draw,
      onMount: () => { draw(); store().allListings().then((l) => { listings = l; note.textContent = l.length + ' fiche' + (l.length > 1 ? 's' : '') + ' non inscrite' + (l.length > 1 ? 's' : '') + ' en plus des food trucks inscrits.'; draw(); }).catch(() => { note.textContent = 'Fiches non inscrites indisponibles.'; }); } };
    App.push(scr); return scr;
  };

  /** Fabriquer une affiche (food truck ou générique) : format, rendu, PDF. o : { name, slug } ou { kind: 'join' | 'clients' } */
  S.adminPosterMake = function (o) {
    const title = o.kind === 'join' ? 'Rejoignez LocalTruck' : o.kind === 'clients' ? 'Affiche clients' : o.name;
    const picker = U.posterFormatPicker(o.name || '', o.slug || '', 'A4', null, { kind: o.kind });
    const dl = h('button', { class: 'btn primary block lg mt16', 'data-testid': 'poster-make-download', onClick: App.guard(async () => { await downloadPosters([{ truckName: o.name, slug: o.slug, kind: o.kind, format: picker.get() }]); }) }, icon('download', 18), 'Télécharger le PDF');
    const all = h('button', { class: 'btn block mt8', onClick: App.guard(async () => { await downloadPosters(['A4', 'A5', 'A6'].map((f) => ({ truckName: o.name, slug: o.slug, kind: o.kind, format: f }))); }) }, 'Les 3 formats dans un seul PDF');
    const info = o.kind ? (o.kind === 'join' ? 'Le QR code mène à la page « Pour les food trucks » de localtruck.fr.' : 'Le QR code mène à la carte localtruck.fr.')
      : 'Le QR code mène à la fiche : localtruck.fr/t/' + o.slug + '. Vous pouvez la montrer au food truck avant même qu’il s’inscrive.';
    const body = h('div', { class: 'scroll pad' }, picker.el, dl, all, h('p', { class: 'fine', style: { margin: '12px 0 24px' } }, info + ' PDF vectoriel, net à toute taille.'));
    const scr = { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', { class: 'ell' }, title)), body), refresh: () => {} };
    App.push(scr); return scr;
  };

  S.adminPosters = function () {
    let filter = 'all';
    const body = h('div', { class: 'scroll pad' });
    const FILTERS = [['all', 'Toutes', () => true], ['pending', 'À traiter', (r) => r.status === 'pending'], ['preparing', 'En préparation', (r) => r.status === 'preparing'], ['shipped', 'Expédiées', (r) => r.status === 'shipped' || r.status === 'delivered']];
    function build() {
      const list = store().posterAdmin(); const keep = body.scrollTop;
      const count = (f) => list.filter(FILTERS.find((x) => x[0] === f)[2]).length;
      const tiles = h('div', { class: 'row gap8', style: { alignItems: 'stretch' } }, [['pending', 'À traiter'], ['preparing', 'En préparation'], ['shipped', 'Expédiées']].map(([k, lab]) => h('div', { class: 'tile', style: { minWidth: 0 }, 'data-count': k }, h('b', null, count(k)), h('span', null, lab))));
      const chips = h('div', { class: 'mt12' }, ui.chipRow(FILTERS.map(([v, lab]) => ({ value: v, label: lab })), filter, (v) => { filter = v; build(); }));
      const todo = list.filter((r) => r.status === 'pending');
      const bulk = todo.length ? h('button', { class: 'btn primary block lg mt12', 'data-testid': 'poster-bulk', onClick: App.guard(async () => { await downloadPosters(todo); ui.toast(todo.length + ' affiche' + (todo.length > 1 ? 's' : '') + ' dans un seul PDF', 'ok'); }) }, icon('download', 18), 'Télécharger les ' + todo.length + ' PDF à traiter') : null;
      const shown = list.filter(FILTERS.find((x) => x[0] === filter)[2]);
      const rows = shown.map((r) => h('div', { class: 'card poster-row', 'data-poster': r.id, onClick: () => S.adminPoster(r.id) },
        h('div', { class: 'row gap8' }, h('div', { class: 'grow bold', style: { textTransform: 'uppercase', minWidth: 0, overflowWrap: 'anywhere' } }, r.truckName), h('span', { class: 'tag' }, r.format || 'A4'), tag(r.status, true)),
        h('div', { class: 'small muted mt8' }, r.address ? r.recipient + ' · ' + r.postcode + ' ' + r.city : 'Adresse effacée'),
        h('div', { class: 'row gap8 mt8' }, h('div', { class: 'grow tiny muted' }, 'Demandée le ' + fmtWhen(r.createdAt)),
          h('button', { class: 'btn sm', 'aria-label': 'Télécharger le PDF de ' + r.truckName, onClick: (e) => { e.stopPropagation(); App.guard(async () => downloadPosters([r]))(); } }, icon('download', 16), 'PDF'))));
      body.replaceChildren(tiles, chips, bulk, h('div', { class: 'col gap12 mt12' }, rows.length ? rows : [ui.empty('🪧', 'Aucune demande', 'Les demandes d’affiche des food trucks arriveront ici.')]),
        h('p', { class: 'fine', style: { margin: '16px 0 24px' } }, 'Le PDF est créé automatiquement à chaque demande. Le food truck est prévenu à chaque changement de statut.'));
      body.scrollTop = keep;
    }
    const scr = { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Demandes d’affiches')), body), refresh: () => { store().loadAdminPosters(); build(); }, onMount: () => { build(); store().loadAdminPosters(); posters().load().catch(() => {}); } };
    App.push(scr); return scr;
  };

  S.adminPoster = function (id) {
    const body = h('div', { class: 'scroll pad' }); const title = h('h1', null, ''); const tagHost = h('span');
    function build() {
      const r = store().posterAdmin().find((x) => x.id === id);
      if (!r) { body.replaceChildren(ui.empty('🪧', 'Demande introuvable', 'Elle a peut-être été supprimée.')); return; }
      title.textContent = r.truckName; tagHost.replaceChildren(tag(r.status, true));
      const next = { pending: ['preparing', 'Passer en préparation'], preparing: ['shipped', 'Marquer comme expédiée'], shipped: ['delivered', 'Marquer comme livrée'] }[r.status];
      const advance = App.guard(async () => {
        if (next[0] === 'shipped') {
          const trk = h('input', { class: 'inp', placeholder: 'Numéro de suivi (facultatif)', maxlength: '40', 'aria-label': 'Numéro de suivi' });
          if (!(await ui.confirmDialog({ title: 'Marquer comme expédiée ?', text: 'Le food truck est prévenu. Vous pouvez ajouter le numéro de suivi.', okLabel: 'Expédiée', content: trk }))) return;
          await store().setPosterStatus(me().id, r.id, 'shipped', trk.value);
        } else if (next[0] === 'delivered') {
          if (!(await ui.confirmDialog({ title: 'Marquer comme livrée ?', text: 'L’adresse de livraison sera effacée définitivement.', okLabel: 'Livrée' }))) return;
          await store().setPosterStatus(me().id, r.id, 'delivered');
        } else await store().setPosterStatus(me().id, r.id, next[0]);
        ui.toast('Statut mis à jour · le food truck est prévenu', 'ok'); build();
      });
      const cancel = App.guard(async () => {
        if (!(await ui.confirmDialog({ title: 'Annuler cette demande ?', text: 'Le food truck est prévenu et l’adresse est effacée.', okLabel: 'Annuler la demande', cancelLabel: 'Garder', danger: true }))) return;
        await store().setPosterStatus(me().id, r.id, 'cancelled'); ui.toast('Demande annulée'); build();
      });
      const addr = r.address ? [r.recipient, r.address, r.address2, r.postcode + ' ' + r.city, r.phone ? 'Tél. ' + r.phone : ''].filter(Boolean) : null;
      body.replaceChildren(
        h('div', { class: 'row gap12', style: { alignItems: 'flex-start' } }, U.posterView(r.truckName, r.slug, 'w140', { format: r.format }),
          h('div', { class: 'grow', style: { minWidth: 0 } }, h('span', { class: 'tag open' }, icon('check', 14), 'PDF prêt'),
            h('div', { class: 'bold mt8', style: { overflowWrap: 'anywhere' } }, posters().fileName(r.slug, r.format)), h('div', { class: 'small muted mt4' }, (r.format || 'A4') + ' · 1 page · version jour · vectoriel'),
            h('div', { class: 'small muted mt8' }, 'Textes en courbes et QR en carrés vectoriels : net à toute taille.'),
            h('button', { class: 'btn primary block mt12', 'data-testid': 'poster-download', onClick: App.guard(async () => downloadPosters([r])) }, icon('download', 18), 'Télécharger'))),
        h('div', { class: 'lbl mt24' }, 'Livraison'),
        h('div', { class: 'card mt8 row gap12', style: { alignItems: 'flex-start' } },
          h('div', { class: 'grow', style: { userSelect: 'text', minWidth: 0 } }, addr ? addr.map((l, i) => h('div', { class: i === 0 ? 'bold' : 'small' }, l)) : h('div', { class: 'small muted' }, 'Adresse effacée')),
          addr ? h('button', { class: 'icon-btn', 'aria-label': 'Copier l’adresse', onClick: async () => { await MFT.platform.copy(addr.join('\n')); ui.toast('Adresse copiée', 'ok'); } }, icon('copy', 20)) : null),
        h('p', { class: 'fine', style: { margin: '8px 0 0' } }, 'Demandée le ' + fmtWhen(r.createdAt) + '. L’adresse est effacée après la livraison.' + (r.tracking ? ' Suivi : ' + r.tracking + '.' : '')),
        h('div', { class: 'col gap8 mt24', style: { paddingBottom: '24px' } },
          next ? h('button', { class: 'btn block', 'data-testid': 'poster-next', onClick: advance }, next[1]) : null,
          next ? h('div', { class: 'tiny muted center' }, 'Le food truck est prévenu par notification.') : null,
          isOpen(r) ? h('button', { class: 'btn danger block', onClick: cancel }, 'Annuler la demande') : null));
    }
    const scr = { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), title, tagHost), body), refresh: build, onMount: build };
    App.push(scr); return scr;
  };
})();
