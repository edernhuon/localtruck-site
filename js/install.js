/* LocalTruck – proposition d'installer l'application et d'activer les notifications, au bon moment (quand on vient de suivre un food truck ou de choisir une zone).
 * Notifications « application fermée » : un bouton, jamais sans un geste de la personne (voir js/push.js).
 * Android (Chrome) : installation du site en un geste · iPhone : mode d'emploi « Sur l'écran d'accueil » · sinon : lien vers l'application Android.
 * Jamais plus d'une fois par semaine, jamais dans l'application déjà installée, toujours avec « Plus tard ». */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {}); const ui = MFT.ui; const { h, icon } = ui; const App = () => MFT.App;
  const ASK_KEY = 'mft.install.asked'; const GAP = 7 * 24 * 3600e3;
  const APK_URL = 'https://localtruck.fr/LocalTruck.apk';      // copie de la dernière release servie par le site (voir scripts/publish-web.sh) : pas de redirection vers GitHub
  let deferred = null; let open = null;

  const ls = () => { try { return window.localStorage; } catch (e) { return null; } };
  const ua = () => (window.navigator && window.navigator.userAgent) || '';
  const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (window.navigator && window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  const isAndroid = () => /Android/i.test(ua());
  const installed = () => !!((MFT.platform && (MFT.platform.isAndroidApp || MFT.platform.isElectron)) || (MFT.funnel && MFT.funnel.standalone()));
  const track = (s) => { if (MFT.funnel) MFT.funnel.track(s); };
  const apkUrl = () => (window.MFT_CONFIG && window.MFT_CONFIG.apkUrl) || APK_URL;
  /** Les alertes « application fermée » ne sont promises que si les notifications du site sont réellement en service. */
  const pushReady = () => !!(MFT.push && MFT.push.ready && MFT.push.ready());
  const pushOfferable = () => !!(MFT.push && MFT.push.offerable && MFT.push.offerable());

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { deferred = null; track('installed'); if (open && document.body.contains(open.el)) open.close(); open = null; });

  /** Peut-on proposer quelque chose ? (hors application installée, sur téléphone ou si le navigateur sait installer) */
  function available() { return !installed() && (isIOS() || isAndroid() || !!deferred); }
  /** Quelque chose à proposer : l'installation et/ou l'activation des notifications. */
  function worthOffering() { return available() || pushOfferable(); }
  function askedRecently() { try { const s = ls(); const t = s && Number(s.getItem(ASK_KEY)); return !!t && Date.now() - t < GAP; } catch (e) { return false; } }
  function markAsked() { try { const s = ls(); if (s) s.setItem(ASK_KEY, String(Date.now())); } catch (e) { /* ignore */ } }

  /** Ouvre la fenêtre. opts.force ignore la limite d'une fois par semaine. Renvoie la fenêtre, ou null si rien à proposer. */
  function offer(opts) {
    opts = opts || {};
    if ((open && document.body.contains(open.el)) || !worthOffering() || (!opts.force && askedRecently())) return null;
    const canInstall = available(); const canPush = pushOfferable();
    markAsked(); if (canInstall) track('install_shown');
    const lead = opts.lead || (canPush
      ? 'Activez les notifications : vous êtes prévenu dès qu’un food truck annonce un emplacement, un retard ou une annulation, même application fermée.'
      : 'Installez LocalTruck sur votre téléphone : vos food trucks s’ouvrent en un geste depuis l’écran d’accueil'
        + (pushReady() ? ', et vous êtes prévenu dès qu’ils annoncent un emplacement, même application fermée.' : '.'));
    const kids = [h('p', { class: 'muted small', style: { margin: 0 } }, lead)];
    const hint = (t) => h('div', { class: 'tiny muted', style: { margin: '-6px 2px 0' } }, t);
    let sh;
    const later = h('button', { class: 'btn ghost block', onClick: () => sh.close() }, 'Plus tard');
    if (canPush) kids.push(h('button', { class: 'btn primary block', onClick: App().guard(async () => {
      await MFT.push.enable(); sh.close(); ui.toast('Notifications activées sur cet appareil', 'ok');
    }) }, icon('bell'), 'Activer les notifications'));
    if (canInstall) {
      if (isIOS()) {
        kids.push(h('ol', { class: 'small', style: { margin: '4px 0 0', paddingLeft: '20px', lineHeight: 1.6 } },
          h('li', null, 'Touchez le bouton ', h('b', null, 'Partager'), ' de Safari (le carré avec une flèche).'),
          h('li', null, 'Choisissez ', h('b', null, '« Sur l’écran d’accueil »'), '.'),
          h('li', null, 'Touchez ', h('b', null, 'Ajouter'), ' : LocalTruck apparaît comme une application.'),
          h('li', null, 'Ouvrez-le depuis l’écran d’accueil, reconnectez-vous et activez les notifications dans « Profil ».')));
      } else if (isAndroid()) {
        /* Android : l'application d'abord (bouton principal), le simple raccourci du site en second choix, juste en dessous. */
        kids.push(h('a', { class: 'btn' + (canPush ? '' : ' primary') + ' block', href: apkUrl(), download: 'LocalTruck.apk', rel: 'noopener noreferrer', onClick: () => track('install_click') }, icon('download'), 'Télécharger l’application Android'));
        kids.push(hint('Application complète, gratuite. Android vous demandera d’autoriser l’installation (une seule fois).'));
        if (deferred) kids.push(h('button', { class: 'btn block', onClick: async () => {
          track('install_click'); const ev = deferred; deferred = null;
          try { ev.prompt(); await ev.userChoice; } catch (e) { /* ignore */ }
          sh.close();
        } }, icon('home'), 'Ajouter un raccourci'));
        else kids.push(h('div', { class: 'small' }, 'Ou, pour un simple raccourci : dans le menu ', h('b', null, '⋮'), ' de votre navigateur, choisissez ', h('b', null, '« Ajouter à l’écran d’accueil »'), '.'));
        if (deferred) kids.push(hint('Un simple raccourci vers le site' + (pushReady() || pushOfferable() ? ', avec les alertes même application fermée.' : '.')));
      } else {
        if (deferred) kids.push(h('button', { class: 'btn' + (canPush ? '' : ' primary') + ' block', onClick: async () => {
          track('install_click'); const ev = deferred; deferred = null;
          try { ev.prompt(); await ev.userChoice; } catch (e) { /* ignore */ }
          sh.close();
        } }, icon('down'), 'Installer l’application'));
      }
    }
    kids.push(later);
    sh = ui.openSheet(opts.title || (canPush ? 'Soyez prévenu, même application fermée' : 'Gardez vos food trucks à portée de main'), h('div', { class: 'col gap12' }, kids), { onClose: () => { open = null; } });
    open = sh;
    return sh;
  }

  /* ---------------------------------------------------------- invitations permanentes : écran d'accueil, carte, profil
   * Toujours un bouton visible quand l'installation est possible (téléphone ou navigateur qui sait installer) et que l'application n'est pas déjà là. */
  const BANNER_KEY = 'mft.install.banner'; const BANNER_GAP = 3 * 24 * 3600e3;
  const bannerHidden = () => { try { const s = ls(); const t = s && Number(s.getItem(BANNER_KEY)); return !!t && Date.now() - t < BANNER_GAP; } catch (e) { return false; } };
  const openFromPromo = () => { const sh = offer({ force: true, title: isAndroid() ? 'LocalTruck sur votre téléphone' : 'Installer LocalTruck', lead: isAndroid() ? 'Téléchargez l’application Android, ou ajoutez simplement un raccourci vers le site.' : isIOS() ? 'Ajoutez LocalTruck à votre écran d’accueil : il s’ouvre comme une application, avec les alertes de vos food trucks.' : 'Installez LocalTruck sur votre téléphone : vos food trucks à un geste, et les alertes même application fermée.' }); if (!sh) ui.toast('Installation indisponible sur cet appareil.', 'err'); };
  /** Carte « Installer l'application » (écran d'accueil, profil). null si l'application est déjà installée ou si rien n'est possible ici. */
  function card(opts) {
    opts = opts || {}; if (!available()) return null;
    const cls = 'card tint' + (opts.compact ? '' : ' mt12'); const row = { display: 'flex', gap: '12px', alignItems: 'center' };
    if (isAndroid()) return h('div', { class: cls, style: row }, icon('download'),
      h('div', { class: 'grow' }, h('div', { class: 'bold small' }, 'Télécharger l’application Android'),
        h('div', { class: 'tiny muted' }, 'Gratuite, installation directe. ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); openFromPromo(); } }, 'Ajouter un raccourci à la place'))),
      h('a', { class: 'btn primary sm', href: apkUrl(), download: 'LocalTruck.apk', rel: 'noopener noreferrer', onClick: () => track('install_click') }, 'Télécharger'));
    return h('div', { class: cls, style: row }, icon('down'),
      h('div', { class: 'grow' }, h('div', { class: 'bold small' }, 'Installer l’application'), h('div', { class: 'tiny muted' }, 'Sur votre écran d’accueil, avec les alertes même application fermée.')),
      h('button', { class: 'btn primary sm', type: 'button', onClick: () => openFromPromo() }, 'Installer'));
  }
  /** Bandeau discret au-dessus de la carte : se range 3 jours quand on le ferme. */
  function banner() {
    if (!available() || bannerHidden()) return null;
    const close = (el) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onClick: () => { try { const s = ls(); if (s) s.setItem(BANNER_KEY, String(Date.now())); } catch (e) { /* ignore */ } el.remove(); } }, icon('close', 16));
    const el = isAndroid()
      ? h('div', { class: 'install-banner' }, icon('download', 18), h('div', { class: 'grow' }, h('b', null, 'Télécharger l’application Android')),
        h('a', { class: 'btn primary sm', href: apkUrl(), download: 'LocalTruck.apk', rel: 'noopener noreferrer', onClick: () => track('install_click') }, 'Télécharger'))
      : h('div', { class: 'install-banner' }, icon('down', 18), h('div', { class: 'grow' }, h('b', null, 'Installer l’application'), ' · alertes même fermée'),
        h('button', { class: 'btn primary sm', type: 'button', onClick: () => openFromPromo() }, 'Installer'));
    el.appendChild(close(el));
    return el;
  }

  /** Appelée juste après qu'un client a suivi un food truck. */
  function afterFollow() { if (!worthOffering() || askedRecently()) return; setTimeout(() => { try { offer({ title: 'Soyez prévenu de ses annonces' }); } catch (e) { /* ignore */ } }, 1200); }
  /** Appelée juste après le choix d'une zone « Prévenez-moi » : sans notification, l'alerte ne s'affiche que dans l'application ouverte. */
  function afterZone() {
    if (!worthOffering()) return;
    const needsHome = MFT.push && MFT.push.needsInstall && MFT.push.needsInstall();
    const lead = pushOfferable() ? 'Pour être prévenu dès qu’un food truck s’installe près de chez vous, même application fermée, activez les notifications.'
      : needsHome ? 'Sur iPhone, les alertes de zone arrivent une fois LocalTruck ajouté à l’écran d’accueil.' : null;
    if (!lead) return;
    setTimeout(() => { try { offer({ title: 'Recevoir l’alerte sur ce téléphone', lead, force: true }); } catch (e) { /* ignore */ } }, 2200);      // (après la confirmation « C’est noté », pour ne pas la superposer)
  }
  /** Application déjà installée et ouverte par quelqu'un qui suit des food trucks ou a une zone : on lui propose une fois les notifications. */
  function nudge() {
    if (!pushOfferable() || askedRecently() || !installed()) return;
    const App2 = App(); const st = App2.store; const u = App2.user && App2.user(); if (!u || u.role === 'admin') return;
    const wants = (u.favorites && u.favorites.length) || (st.myZone && st.myZone()) || (App2.myTrucks && App2.myTrucks().length);
    if (!wants) return;
    setTimeout(() => { try { offer({ title: 'Activez les notifications' }); } catch (e) { /* ignore */ } }, 2500);
  }

  MFT.install = { offer, card, banner, afterFollow, afterZone, nudge, available, installed, isIOS, isAndroid, apkUrl, _reset: () => { deferred = null; open = null; } };
})();
