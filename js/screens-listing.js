/* LocalTruck – fiches « pas encore reprises » : camions repérés à partir d'informations publiques (nom, cuisine, compte Instagram, ville).
 * Ils apparaissent sur la carte comme les autres, avec un repère sobre. Leur Instagram est mis en avant ; les publications ne se chargent
 * qu'après un appui (Instagram dépose alors ses propres traceurs). Le propriétaire peut reprendre la fiche ou demander sa suppression. */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui; const App = MFT.App;
  const S = MFT.screens; const U = MFT.util; const store = () => App.store;

  /* ---------------------------------------------------------- petits éléments réutilisés par la carte, la liste et la fiche */
  ui.listingAvatar = function (l, cls) { return h('div', { class: 'avatar quiet' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, C.listingInitials(l.name)); };
  /** Repère d'une fiche provisoire : couleur d'état d'après ses habitudes (avec une pastille bleue), ou bleu avec un reflet si on ne sait rien. */
  U.listingPin = function (l, selected, ls, now) {
    if (ls === undefined) { now = +store().now(); ls = C.listingStatus(l, now); }
    return MFT.pins.truckPin({ name: l.name }, ls ? ls.status : null, { selected: !!selected, listing: true, start: ls ? ls.start : 0, now: now || Date.now(), label: (l.name || '?').trim().charAt(0).toUpperCase() });
  };
  /** « Habituellement ouvert à cette heure », « Habituellement à 18 h 30 », « Habituellement : ven. 18 h ». */
  U.listingUsualText = function (l) {
    const now = +store().now(); const ls = C.listingStatus(l, now); if (!ls) return '';
    if (ls.status === 'open') return 'Habituellement ouvert à cette heure';
    const t = C.pinTime(ls.start, now).toLowerCase().replace(/ h /, ' h ').replace(/^demain /, 'demain à ');
    return ls.status === 'soon' ? 'Habituellement ouvert à ' + t : 'Prochaine ouverture habituelle : ' + t;
  };
  U.listingRow = function (it, o) {
    const l = it.listing; o = o || {};
    return h('div', { class: 'item ls' + (o.selected ? ' sel' : ''), 'data-slug': l.slug, role: 'button', tabindex: '0', onClick: () => o.onClick && o.onClick(l) },
      ui.listingAvatar(l),
      h('div', { class: 'grow', style: { minWidth: 0 } },
        h('div', { class: 't ell' }, l.name),
        h('div', { class: 's ell' }, [l.cuisine, l.city].filter(Boolean).join(' · ') + (it.dist != null ? ' · ' + C.fmtDist(it.dist) : ''))),
      o.selected && o.actions ? h('div', { class: 'it-act', style: { flexBasis: '100%' } }, o.actions) : h('span', { style: { color: 'var(--mu)', display: 'grid', placeItems: 'center' } }, icon('right', 20)));
  };
  App.listingLink = function (l) {
    const cfg = window.MFT_CONFIG || {}; const web = /^https?:/.test(location.protocol) && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
    const base = cfg.shareBase || (web ? location.origin + '/' : 'https://localtruck.fr/');
    return base.replace(/\/*$/, '/') + 't/' + l.slug;
  };

  /* ---------------------------------------------------------- la fiche */
  function listingScreen(l0) {
    let embedOn = false; let usualOpen = false;
    const get = () => store().getListing(l0.slug) || l0;
    const igUrl = (l) => (C.INSTAGRAM_HANDLE.test(l.instagram) ? C.socialUrl('instagram', l.instagram) : '');
    const openExternal = (url) => MFT.platform.openExternal(url).then((ok) => { if (!ok) ui.toast('Impossible d’ouvrir le lien.', 'err'); });
    const share = async () => {
      const l = get(); const link = App.listingLink(l);
      if (navigator.share && /^https:/.test(location.protocol)) { try { await navigator.share({ title: l.name, text: l.name + ' sur LocalTruck', url: link }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      await MFT.platform.copy(link); ui.toast('Lien copié', 'ok');
    };
    // chaque bloc a son conteneur : ouvrir « Habituellement » ne recharge pas les publications Instagram (déplacer un cadre le ferait recharger)
    const headHost = h('div'); const igHost = h('div', { class: 'pad mt16' }); const usualHost = h('div', { class: 'pad mt16' });
    const bottom = h('div', { class: 'bottom-bar' });
    const scroll = h('div', { class: 'scroll' }, headHost, igHost, usualHost, h('div', { class: 'pad mt24 fine' },
      h('div', null, 'Fiche créée à partir d’informations publiques.'),
      h('div', null, h('a', { href: '#', onClick: (e) => { e.preventDefault(); S.claimListing && S.claimListing(get()); } }, 'C’est votre camion ? Reprendre la fiche'), ' · ',
        h('a', { href: '#', onClick: (e) => { e.preventDefault(); S.openListingRemoval(get()); } }, 'Supprimer'))), h('div', { style: { height: '24px' } }));
    const top = h('div', { class: 'topbar' }, App.backBtn(), h('h1', { class: 'ell' }, l0.name), h('button', { class: 'icon-btn', 'aria-label': 'Partager', onClick: share }, icon('share')));
    const el = h('div', { class: 'col' }, top, scroll, bottom);

    function drawHead() {
      const l = get(); const url = igUrl(l);
      headHost.replaceChildren(
        h('div', { class: 'hero' }, ui.listingAvatar(l, 'lg'), h('div', { class: 'grow', style: { minWidth: 0 } }, l.cuisine ? h('div', { class: 'lbl' }, l.cuisine) : null, h('h2', { style: { fontSize: '20px', marginTop: '4px' } }, l.name))),
        h('div', { class: 'pad row gap8 mt12', style: { flexWrap: 'wrap' } }, h('span', { class: 'tag' }, icon('pin', 12), l.city + (l.department ? ' · ' + (C.DEPARTMENTS[l.department] || l.department) : '')),
          U.listingUsualText(l) ? h('span', { class: 'tag' }, icon('clock', 12), U.listingUsualText(l)) : null));
      bottom.replaceChildren(
        h('button', { class: 'btn grow', onClick: share }, icon('share'), 'Partager'),
        h('button', { class: 'btn primary grow', disabled: !url, onClick: () => url && openExternal(url) }, icon('instagram'), 'Voir sur Instagram'));
    }
    function drawEmbed() {
      const l = get(); if (!igUrl(l)) { igHost.replaceChildren(); return; }
      const head = h('div', { class: 'row gap12' },
        h('span', { class: 'ig-badge', 'aria-hidden': 'true' }, icon('instagram', 22)),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold ell' }, '@' + l.instagram), h('div', { class: 'small muted' }, 'Publications, horaires et actualités')));
      const card = h('div', { class: 'card tint ig-card' }, head);
      if (!embedOn) {
        card.append(h('div', { class: 'ig-tiles', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('button', { class: 'btn block', onClick: () => { embedOn = true; drawEmbed(); } }, 'Afficher les publications'),
          h('div', { class: 'tiny muted' }, 'Chargées depuis Instagram quand vous touchez le bouton : Instagram (Meta) peut alors déposer ses propres cookies, selon sa politique de confidentialité.'));
      } else {
        card.append(h('iframe', { class: 'ig-frame', src: 'https://www.instagram.com/' + l.instagram + '/embed', title: 'Publications Instagram de @' + l.instagram, loading: 'lazy',
          referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox' }),
        h('div', { class: 'tiny muted' }, 'Contenu affiché par Instagram : ce sont ses publications, pas les nôtres. Si rien ne s’affiche, ouvrez Instagram avec le bouton du bas.'));
      }
      igHost.replaceChildren(card);
    }
    function drawUsual() {
      const l = get(); if (!l.usual.length) { usualHost.replaceChildren(); return; }
      usualHost.replaceChildren(h('div', { class: 'card usual' },
        h('button', { class: 'usual-hd', type: 'button', 'aria-expanded': String(usualOpen), onClick: () => { usualOpen = !usualOpen; drawUsual(); } },
          h('div', { class: 'grow', style: { textAlign: 'left', minWidth: 0 } }, h('div', { class: 'bold' }, 'Habituellement'),
            h('div', { class: 'small muted ell' }, usualOpen ? 'Emplacements connus, à confirmer auprès du food truck' : l.usual.length + ' emplacement' + (l.usual.length > 1 ? 's' : '') + ' connu' + (l.usual.length > 1 ? 's' : ''))),
          h('span', { class: 'chev' + (usualOpen ? ' open' : ''), 'aria-hidden': 'true' }, icon('right', 20))),
        usualOpen ? h('div', { class: 'col gap8 mt12' }, l.usual.map((x) => h('div', { class: 'small', style: { borderLeft: '3px solid var(--bd)', paddingLeft: '10px' } }, x)),
          h('div', { class: 'tiny muted' }, 'À confirmer auprès du food truck.')) : null));
    }
    return { el, refresh: () => {}, onMount: () => { drawHead(); drawEmbed(); drawUsual(); } };
  }
  S.openListing = function (slug, o) {
    const st = store(); const l = st.getListing(slug);
    if (!l) {                                                    // lien partagé ou QR de l'affiche : la fiche n'est pas encore sur l'appareil
      st.fetchListing(slug).then((x) => { if (x) S.openListing(slug, o); else ui.toast('Cette fiche n’existe plus.', 'err'); }).catch(() => ui.toast('Impossible de charger la fiche. Vérifiez votre connexion.', 'err'));
      return null;
    }
    const f = listingScreen(l);
    if (MFT.desktop && MFT.desktop.on() && App.tabName === 'map' && !App.stack.length) f.el.classList.add('dk-side');
    App.push(f); return f;
  };

  /* ---------------------------------------------------------- reprise : « C'est mon camion » → création de la vraie fiche, pré-remplie */
  S.claimListing = function (l) {
    const u = App.user();
    if (u && u.role !== 'truck') {
      const sh = ui.openSheet('Reprendre cette fiche', h('div', { class: 'col gap12' },
        h('p', { class: 'muted small', style: { margin: 0 } }, u.role === 'admin' ? 'Un compte administrateur ne peut pas reprendre une fiche.'
          : 'Votre compte est un compte client. Pour reprendre la fiche d’un food truck, il faut un compte food truck : déconnectez-vous, puis créez-le avec une autre adresse e-mail.'),
        h('button', { class: 'btn block', onClick: () => sh.close() }, 'Compris')));
      return sh;
    }
    const scr = S.signupTruck({ existing: !!u, claim: l }); App.push(scr); return scr;
  };

  /* ---------------------------------------------------------- demande de suppression (le propriétaire, sans compte) */
  S.openListingRemoval = function (l) {
    let role = 'owner'; let done = false;
    const body = h('div', { class: 'scroll pad' });
    const email = h('input', { class: 'inp', type: 'email', placeholder: 'vous@exemple.fr', autocomplete: 'email', inputmode: 'email', maxlength: '120', 'aria-label': 'Votre adresse e-mail' });
    const msg = h('textarea', { class: 'inp', maxlength: '300', rows: '3', placeholder: 'Un mot pour nous (facultatif)', 'aria-label': 'Message' });
    const err = h('div', { class: 'err' });
    const miniCard = h('div', { class: 'card row gap12' }, ui.listingAvatar(l), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold ell' }, l.name), h('div', { class: 'small muted ell' }, [l.cuisine, l.city].filter(Boolean).join(' · '))));
    function form() {
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Vous êtes' });
      [['owner', 'Le propriétaire'], ['manager', 'Un gérant']].forEach(([v, lab]) => seg.append(h('button', { type: 'button', class: role === v ? 'on' : '', 'aria-pressed': String(role === v), onClick: () => { role = v; form(); } }, lab)));
      const go = h('button', { class: 'btn primary block lg mt16' }, 'Envoyer la demande');
      const submit = App.guard(async () => {
        err.textContent = ''; go.disabled = true;
        try { await store().requestListingRemoval(l.slug, role, email.value, msg.value); done = true; sent(); }
        catch (e) { err.textContent = e.message; go.disabled = false; if (!(e instanceof C.UserError)) throw e; }
      });
      go.addEventListener('click', submit);
      body.replaceChildren(miniCard,
        h('div', { class: 'lbl mt16' }, 'Vous êtes'), h('div', { class: 'mt8' }, seg),
        h('div', { class: 'mt16' }, ui.field('Votre adresse e-mail', email, 'Pour vous répondre. Elle est effacée une fois la demande traitée.')),
        h('div', { class: 'mt12' }, ui.field('Message', msg)),
        h('div', { class: 'card tint small mt16' }, 'La fiche est masquée dès l’envoi. Nous vérifions ensuite votre demande, par exemple avec le compte Instagram du food truck, puis nous la supprimons définitivement.'),
        err, go);
    }
    function sent() {
      const step = (state, title, text) => h('div', { class: 'row gap12', style: { alignItems: 'flex-start' } },
        h('span', { class: 'step-dot ' + state, 'aria-hidden': 'true' }, state === 'ok' ? icon('check', 14) : ''), h('div', null, h('div', { class: 'bold' }, title), h('div', { class: 'small muted' }, text)));
      body.replaceChildren(
        h('div', { class: 'center mt24' }, h('div', { class: 'big-ok', 'aria-hidden': 'true' }, icon('check', 34)), h('h2', { style: { marginTop: '12px' } }, 'Demande envoyée'),
          h('p', { class: 'muted small' }, 'Merci. Vous n’avez rien d’autre à faire pour le moment.')),
        h('div', { class: 'col gap12 mt24' },
          step('ok', 'Fiche masquée', 'Elle n’apparaît plus sur la carte.'),
          step('', 'Vérification', 'Nous contrôlons que la demande vient bien du food truck.'),
          step('', 'Suppression définitive', 'Nous vous prévenons si besoin, puis la fiche est effacée.')),
        h('button', { class: 'btn primary block lg mt24', onClick: () => App.popAll() }, 'Retour à la carte'));
    }
    form();
    const scr = { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Supprimer la fiche')), body), refresh: () => {}, onMount: () => { if (!done) setTimeout(() => email.focus(), 80); } };
    App.push(scr); return scr;
  };

  /* ---------------------------------------------------------- administration : demandes de suppression de fiches */
  U.listingRemovalCards = function (rebuild) {
    const reqs = store().listingRemovals ? store().listingRemovals() : []; if (!reqs.length) return [];
    const decide = (r, action) => App.guard(async () => {
      const ok = await ui.confirmDialog(action === 'delete'
        ? { title: 'Supprimer définitivement cette fiche ?', text: '« ' + r.name + ' » sera effacée, ainsi que l’adresse e-mail de la demande. Un futur import ne la recréera pas.', okLabel: 'Supprimer', danger: true }
        : { title: 'Refuser la demande ?', text: '« ' + r.name + ' » repasse en ligne et la demande est classée.', okLabel: 'Remettre en ligne' });
      if (!ok) return;
      await store().resolveListingRemoval(me().id, r.id, action); ui.toast(action === 'delete' ? 'Fiche supprimée' : 'Fiche remise en ligne', 'ok'); rebuild();
    });
    const me = () => App.user();
    const igLink = (r) => { const u = r.instagram && C.INSTAGRAM_HANDLE.test(r.instagram) ? C.socialUrl('instagram', r.instagram) : ''; return u ? h('button', { class: 'btn sm', onClick: () => MFT.platform.openExternal(u) }, icon('instagram', 16), '@' + r.instagram) : null; };
    return [h('div', { class: 'sec' }, 'Demandes de suppression de fiches (' + reqs.length + ')'),
      h('div', { class: 'list', style: { marginBottom: '16px' } }, reqs.map((r) => h('div', { class: 'card warn', 'data-listreq': r.id },
        h('div', { class: 'row gap8' }, h('span', { class: 'bold' }, r.name), h('span', { class: 'tag' }, r.role === 'manager' ? 'Gérant' : 'Propriétaire')),
        h('div', { class: 'tiny muted mt4' }, [r.email, 'demandé ' + ui.ago(r.requestedAt)].filter(Boolean).join(' · ')),
        r.message ? h('div', { class: 'small mt8', style: { userSelect: 'text' } }, r.message) : null,
        h('div', { class: 'row gap8 mt12', style: { flexWrap: 'wrap' } }, igLink(r), h('button', { class: 'btn danger sm', onClick: decide(r, 'delete') }, icon('trash', 16), 'Supprimer définitivement'), h('button', { class: 'btn sm', onClick: decide(r, 'restore') }, 'Refuser'))))) ];
  };
})();
