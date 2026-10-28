/* LocalTruck – application : routeur, position, notifications, démarrage. */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui;

  const App = (MFT.App = {
    store: null, stack: [], tabs: {}, tabName: null, tabDefs: [], nav: null, mode: null,
    pos: null, posListeners: [], filters: { moment: 'tonight', dateKey: null, cuisine: 'Tout', text: '', radiusKm: 12, veg: false },
    geoTried: false, activeTruckId: null, shown: new Set(), _refreshQueued: false, guest: false, adminAsTruck: false,
  });
  const $root = () => document.getElementById('app');

  /* ---------------------------------------------------------- démarrage */
  App.startTs = Date.now();
  App.start = async function () {
    const cfg = window.MFT_CONFIG || {}; const P = MFT.platform;
    const cloud = !!(cfg.supabaseUrl && cfg.supabaseKey && MFT.cloud) && !P.forceLocal;
    if (cloud) App.store = new MFT.cloud.CloudStore({ url: cfg.supabaseUrl, key: cfg.supabaseKey, onError: (m) => ui.toast(m, 'err'), onSyncState: (s) => App.syncBanner(s) });
    else App.store = new C.Store({ adapter: { load: () => P.load(), save: (s) => P.save(s) } });
    await App.store.init();
    App.store.subscribe(() => App.queueRefresh());
    window.addEventListener('beforeunload', () => App.store.flush());
    if (cloud) App.store.startSync();
    setInterval(() => App.tick(), 30000);
    App.render();
    window.addEventListener('hashchange', () => App.openFromHash());
    App.openFromHash();
    if (MFT.updates) MFT.updates.start();
    if (MFT.funnel) MFT.funnel.start();
    if (MFT.presence) MFT.presence.start();
    if (MFT.push) MFT.push.start();
  };
  /** Bandeau « hors connexion » : les modifications sont gardées et renvoyées dès que le réseau revient. */
  App.syncBanner = function (state) {
    const old = document.getElementById('offline-banner');
    if (state === 'offline') { if (!old) $root().appendChild(h('div', { id: 'offline-banner', class: 'offline-banner' }, 'Hors connexion · envoi dès le retour du réseau')); }
    else if (old) old.remove();
  };
  /** Lien de partage d'une fiche : https://localtruck.fr/t/<adresse courte> (ou, sans adresse courte, https://…/#/truck/<id>). Il ouvre directement la fiche. */
  App.shareLink = function (truck) {
    const cfg = window.MFT_CONFIG || {}; const web = /^https?:/.test(location.protocol) && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
    if (truck && truck.slug) return (cfg.shareBase || (web ? location.origin + '/' : 'https://localtruck.fr/')) + 't/' + truck.slug;
    const base = cfg.shareBase || (web ? location.origin + location.pathname : 'localtruck://');
    return base + (base.endsWith('//') ? '' : '') + '#/truck/' + truck.id;
  };
  /** Lien court d'une fiche repérée sans compte : https://localtruck.fr/t/<nom> (la page 404 de GitHub Pages renvoie vers #/t/<nom>) ; …/reprendre ouvre directement la reprise. */
  App.openListingFromHash = function () {
    const m = /^#\/t\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/reprendre)?$/.exec(location.hash || ''); if (!m || m[1].length > 60) return false;
    if (!App.user() && !App.guest) { App.guest = true; App.render(); return true; }
    history.replaceState(null, '', location.pathname + location.search);
    const slug = m[1]; const claim = !!m[2]; const st = App.store;
    Promise.resolve(st.resolveSlug(slug)).then((r) => {
      if (!r) return ui.toast('Cette fiche n’existe plus.', 'err');
      if (r.kind === 'truck') return MFT.screens.openFiche(r.id);                       // food truck inscrit (ou fiche provisoire reprise)
      MFT.screens.openListing(slug); if (claim) MFT.screens.claimListing(r.listing);
    });
    return true;
  };
  App.openFromHash = function () {
    if (App.openListingFromHash()) return;
    const m = /^#\/truck\/([0-9a-fA-F-]{36})$/.exec(location.hash || ''); if (!m) return;
    if (!App.user() && !App.guest) { App.guest = true; App.render(); return; }      // lien partagé : la fiche s'ouvre sans exiger de compte (App.render rappelle cette fonction)
    history.replaceState(null, '', location.pathname + location.search);
    MFT.screens.openFiche(m[1]);
  };
  /** « Voir sans compte » : consultation seule (carte, fiches, avis, événements). */
  App.enterGuest = function () { App.guest = true; App.render(); };
  App.tick = function () { App.refreshAll(); App.checkProximity(); if (MFT.push) MFT.push.sync(); };

  /* ---------------------------------------------------------- routeur */
  App.user = () => App.store.currentUser();
  App.myTrucks = () => { const u = App.user(); return u ? App.store.managedTrucks(u.id) : []; };
  App.activeTruck = () => {
    const l = App.myTrucks(); if (!l.length) return null;
    return l.find((t) => t.id === App.activeTruckId) || l[0];
  };

  App.render = function () {
    const root = $root(); root.querySelectorAll('#seo-fallback, #splash, .screen, .nav, .overlay:not(.locked)').forEach((e) => e.remove());      // #seo-fallback et #splash : texte et animation affichés avant le démarrage (voir index.html)
    Object.values(App.tabs).forEach((t) => t.destroy && t.destroy());
    App.tabs = {}; App.stack.forEach((s) => s.destroy && s.destroy()); App.stack = []; App.tabName = null; App.nav = null;
    const u = App.user();
    if (u) App.guest = false;
    App.store.setGuest(!u && App.guest);
    if (!u && !App.guest) { App.mode = null; App.viewAsClient = false; App.adminAsTruck = false; App.shown = new Set(); App.push(MFT.screens.welcome()); if (MFT.updates) MFT.updates.syncLock(); return; }
    // un compte admin qui possède un food truck peut basculer vers son espace food truck (adminAsTruck), puis en vue client
    if (!u) App.mode = 'guest';
    else if (u.role === 'admin') App.mode = App.adminAsTruck && App.myTrucks().length ? (App.viewAsClient ? 'client' : 'truck') : 'admin';
    else App.mode = (App.myTrucks().length && !App.viewAsClient) ? 'truck' : 'client';
    App.shown = new Set(u ? App.store.notificationsOf(u.id).map((n) => n.key || n.id) : []);
    const defs = {
      guest: [['map', 'Carte', 'map'], ['events', 'Événements', 'calendar'], ['account', 'Compte', 'user']],
      client: [['map', 'Carte', 'map'], ['favorites', 'Favoris', 'heart'], ['alerts', 'Alertes', 'bell'], ['profile', 'Profil', 'user']],
      truck: [['home', 'Accueil', 'home'], ['planning', 'Planning', 'calendar'], ['menu', 'Ma carte', 'list'], ['stats', 'Stats', 'chart'], ['account', 'Compte', 'user']],
      admin: [['reports', 'Signalements', 'flag'], ['trucks', 'Fiches', 'truck'], ['posters', 'Affiches', 'qr'], ['map', 'Carte', 'map'], ['activity', 'Activité', 'clock'], ['account', 'Compte', 'user']],
    }[App.mode];
    App.tabDefs = defs;
    App.nav = h('nav', { class: 'nav' }, defs.map(([id, label, ic]) => h('button', { 'data-tab': id, title: label, 'aria-label': label, onClick: () => App.setTab(id) }, icon(ic), h('span', null, label), id === 'alerts' ? h('span', { class: 'dot hide' }) : null)));
    root.appendChild(App.nav);
    if (MFT.desktop) MFT.desktop.decorate(App.nav, App.mode);      // version ordinateur : apparence et connexion dans la barre du haut
    App.setTab(defs[0][0]);
    const unread = App.mode === 'client' && u ? App.store.unreadCount(u.id) : 0;
    if (unread) ui.toast('Vous avez ' + unread + ' alerte' + (unread > 1 ? 's' : '') + ' non lue' + (unread > 1 ? 's' : ''));
    App.updateBadge();
    App.checkProximity();
    App.openFromHash();
    if (MFT.updates) MFT.updates.syncLock();
  };
  App.setTab = function (id) {
    if (App.stack.length) App.popAll();
    App.tabName = id;
    Object.entries(App.tabs).forEach(([k, t]) => { t.el.style.display = k === id ? '' : 'none'; });
    if (!App.tabs[id]) {
      const scr = MFT.screens[App.mode + '_' + id]();
      scr.el.classList.add('screen', 'with-nav'); scr.el.style.zIndex = 1;
      $root().insertBefore(scr.el, App.nav); App.tabs[id] = scr; if (scr.onMount) scr.onMount();
    }
    App.nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    const t = App.tabs[id]; if (t.onShow) t.onShow(); if (t.refresh) t.refresh();
  };
  App.push = function (scr) {
    scr.el.classList.add('screen'); scr.el.style.zIndex = 40 + App.stack.length;
    $root().appendChild(scr.el); App.stack.push(scr); if (scr.onMount) scr.onMount(); if (scr.onShow) scr.onShow();
    return scr;
  };
  App.pop = function () {
    const s = App.stack.pop(); if (!s) return; if (s.destroy) s.destroy(); s.el.remove();
    const top = App.stack[App.stack.length - 1] || App.tabs[App.tabName]; if (top) { if (top.onShow) top.onShow(); if (top.refresh) top.refresh(); }
  };
  /** Retour (bouton du téléphone) : ferme la feuille ouverte, sinon l'écran du dessus, sinon revient à l'onglet d'accueil. */
  App.back = function () {
    const ovs = document.querySelectorAll('#app .overlay');
    if (ovs.length) { ovs[ovs.length - 1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true; }
    if (App.stack.length > (App.mode === null ? 1 : 0)) { App.pop(); return true; }      // l'accueil (écran de départ sans compte) ne se ferme pas
    if (App.tabDefs.length && App.tabName && App.tabName !== App.tabDefs[0][0]) { App.setTab(App.tabDefs[0][0]); return true; }
    return false;
  };
  App.popAll = function () { while (App.stack.length) { const s = App.stack.pop(); if (s.destroy) s.destroy(); s.el.remove(); } };
  App.backBtn = (label) => h('button', { class: 'icon-btn', 'aria-label': label || 'Retour', onClick: () => App.pop() }, icon('back'));

  App.queueRefresh = function () { if (App._refreshQueued) return; App._refreshQueued = true; queueMicrotask(() => { App._refreshQueued = false; App.refreshAll(); }); };
  App.refreshAll = function () {
    if (!App.store.currentUser() && !App.guest) return;
    if (MFT.push) MFT.push.sync();
    const list = [...App.stack]; if (App.tabs[App.tabName]) list.unshift(App.tabs[App.tabName]);
    list.forEach((s) => { try { if (s.refresh) s.refresh(); } catch (e) { console.error(e); } });
    App.updateBadge(); App.fireNative();
  };
  App.updateBadge = function () {
    const u = App.user(); if (!u || !App.nav) return;
    const dot = App.nav.querySelector('[data-tab="alerts"] .dot'); if (!dot) return;
    const n = App.store.unreadCount(u.id); dot.textContent = n > 9 ? '9+' : n; dot.classList.toggle('hide', !n);
  };
  App.fireNative = function () {
    const u = App.user(); if (!u) return;
    App.store.notificationsOf(u.id).forEach((n) => {
      const k = n.key || n.id; if (App.shown.has(k)) return; App.shown.add(k);
      if (App.store.isCloud && n.createdAt < App.startTs - 120000) return;          // alerte arrivée avant l'ouverture : déjà signalée par le badge
      if (u.prefs && u.prefs.nativeNotifs === false) return;
      if (document.hasFocus()) ui.toast(n.text);
      else if (!(MFT.push && MFT.push.isActive())) MFT.platform.notify('LocalTruck', n.text);          // avec les notifications « application fermée », le serveur l'a déjà envoyée : pas de doublon
    });
  };

  /* ---------------------------------------------------------- position et géocodage (jamais enregistrées) */
  App.setPos = function (pos) {
    App.pos = pos ? { lat: pos.lat, lng: pos.lng, label: pos.label || '', source: pos.source || 'manual' } : null;
    App.posListeners.forEach((fn) => fn(App.pos)); App.checkProximity();
  };
  App.onPos = (fn) => { App.posListeners.push(fn); return () => { App.posListeners = App.posListeners.filter((x) => x !== fn); }; };
  App.locate = function () {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Géolocalisation indisponible.'));
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, source: 'gps' }), (e) => reject(e), { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
    });
  };
  App.geoSearch = async function (q) {
    try { return await MFT.geo.search(q); } catch (e) { ui.toast('Recherche d’adresse indisponible : vérifiez votre connexion.', 'err'); return []; }
  };
  App.reverse = async function (lat, lng) { try { return await MFT.geo.reverse(lat, lng); } catch (e) { return null; } };
  App.placeFromGeo = function (r) {
    const a = r.address || {}; const road = a.road || a.pedestrian || a.square || a.footway || a.path || a.cycleway || '';
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || '';
    const name = (r.name && r.name !== road ? r.name : '') || road || a.neighbourhood || a.suburb || city || (r.label || '').split(',')[0];
    const address = [a.house_number, road, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || r.label || '';
    return { name, address, lat: r.lat, lng: r.lng, city };
  };
  App.checkProximity = function () {
    const u = App.user(); if (!u || App.mode === 'admin' || !App.pos) return;
    const created = App.store.proximityAlerts(u.id, App.pos);
    if (created.length) App.updateBadge();
  };
  App.directionsUrl = function (slot) {
    const to = slot.place.lat + ',' + slot.place.lng; const from = App.pos ? App.pos.lat.toFixed(5) + ',' + App.pos.lng.toFixed(5) : '';
    const km = App.pos ? C.haversine(App.pos.lat, App.pos.lng, slot.place.lat, slot.place.lng) : 5;
    return 'https://www.openstreetmap.org/directions?engine=' + (km < 2 ? 'fossgis_osrm_foot' : 'fossgis_osrm_car') + '&route=' + from + ';' + to;
  };
  App.openRoute = function (truck, slot) {
    App.store.track(truck.id, 'route'); MFT.platform.openExternal(App.directionsUrl(slot)).then((ok) => { if (!ok) ui.toast('Impossible d’ouvrir l’itinéraire.', 'err'); });
  };
  App.shareText = function (truck) {
    const s = App.store.summary(truck); let when = '';
    if (s && s.slot) when = (s.key === C.dateKey(App.store.now()) ? 'ce soir' : App.store.relDay(s.key)) + ' à ' + (s.slot.place.name || s.slot.place.address) + ', ' + C.fmtHours(s.slot);
    return truck.name + (when ? ' sera ' + when + '. ' : '. ') + 'Retrouvez-le sur LocalTruck : ' + App.shareLink(truck);
  };

  /* Gestion centralisée des erreurs métier */
  App.guard = function (fn) {
    return async function (...a) {
      try { return await fn.apply(this, a); }
      catch (e) { if (e instanceof C.UserError) ui.toast(e.message, 'err'); else { console.error(e); ui.toast('Une erreur est survenue : ' + (e && e.message || e), 'err'); } }
    };
  };

  document.addEventListener('DOMContentLoaded', () => { App.start().catch((e) => { console.error(e); document.body.textContent = 'Erreur au démarrage : ' + e.message; }); });
})();
