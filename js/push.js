/* LocalTruck – notifications « application fermée » (Web Push, gratuit) pour le site installé ou ouvert dans un navigateur.
 * Rien n'est activé sans un geste explicite de la personne. Le navigateur nous donne une adresse de livraison + deux clés publiques ;
 * elles sont enregistrées sur son compte (script SQL 5) et retirées à la déconnexion, à la désactivation ou à la suppression du compte.
 * Indisponible : application Android (APK) et Windows (elles gardent leurs notifications internes), iPhone tant que le site n'est pas
 * ajouté à l'écran d'accueil, et tant que la fonction d'envoi du serveur n'est pas en service. */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const KEY = 'mft.push'; const DECLINED = 'mft.push.declined';                       // { user, endpoint, at } : qui a activé les notifications sur CET appareil, et quand elles ont été renvoyées au serveur
  const RESAVE = 24 * 3600e3;
  let serverKey; let keyLoading = null;         // undefined = pas encore su · null = serveur pas prêt · texte = clé publique du serveur
  let active = false; let syncedFor = null; let syncing = null;

  const ls = () => { try { return window.localStorage; } catch (e) { return null; } };
  const read = () => { try { const s = ls(); return (s && JSON.parse(s.getItem(KEY) || 'null')) || null; } catch (e) { return null; } };
  const write = (o) => { try { const s = ls(); if (s) { if (o) s.setItem(KEY, JSON.stringify(o)); else s.removeItem(KEY); } } catch (e) { /* ignore */ } };
  const P = () => MFT.platform || {};
  const store = () => MFT.App && MFT.App.store;
  const me = () => { try { return MFT.App && MFT.App.user && MFT.App.user(); } catch (e) { return null; } };
  const ua = () => (window.navigator && window.navigator.userAgent) || '';
  const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (window.navigator && window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  const standalone = () => !!(MFT.funnel && MFT.funnel.standalone());
  const err = (m) => { const E = (MFT.core && MFT.core.UserError) || Error; return new E(m); };

  /** Le navigateur sait-il recevoir des notifications application fermée ? */
  function capable() {
    try {
      if (P().isAndroidApp || P().isElectron) return false;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
      return location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    } catch (e) { return false; }
  }
  const cloud = () => { const s = store(); return !!(s && s.isCloud && typeof s.savePushSubscription === 'function'); };
  /** iPhone / iPad : les notifications n'existent qu'une fois le site ajouté à l'écran d'accueil. */
  function needsInstall() { return !P().isAndroidApp && !P().isElectron && isIOS() && !standalone() && !('PushManager' in window); }
  function supported() { return capable() && cloud(); }
  function permission() { try { return 'Notification' in window ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; } }

  /** Clé publique du serveur (créée par la fonction d'envoi) ; null tant que le serveur n'est pas prêt. */
  function loadKey() {
    if (serverKey !== undefined) return Promise.resolve(serverKey);
    if (!keyLoading) {
      const s = store();
      keyLoading = (s && typeof s.pushKey === 'function' ? s.pushKey() : Promise.resolve(null))
        .then((k) => { serverKey = typeof k === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(k) ? k : null; return serverKey; })
        .catch(() => { keyLoading = null; return null; });      // réseau coupé : on réessaiera
    }
    return keyLoading;
  }
  /** Peut-on proposer d'activer les notifications ? (navigateur compatible, serveur prêt) */
  function ready() { return supported() && !!serverKey; }
  /** Les notifications sont-elles activées sur cet appareil pour le compte connecté ? (réponse immédiate) */
  function isActive() { return active; }
  const declinedBy = () => { try { const s = ls(); return s ? s.getItem(DECLINED) : null; } catch (e) { return null; } };
  const setDeclined = (uid) => { try { const s = ls(); if (s) { if (uid) s.setItem(DECLINED, uid); else s.removeItem(DECLINED); } } catch (e) { /* ignore */ } };
  /** Faut-il le proposer maintenant ? (compatible, serveur prêt, pas déjà actif, pas bloqué dans le navigateur, pas désactivé par la personne elle-même) */
  function offerable() { const u = me(); return !!u && ready() && !active && permission() !== 'denied' && declinedBy() !== u.id; }

  const b64ToBytes = (s) => { const pad = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; };
  const sameKey = (sub, key) => {
    try { const a = new Uint8Array(sub.options.applicationServerKey); const b = b64ToBytes(key); return a.length === b.length && a.every((v, i) => v === b[i]); } catch (e) { return true; }
  };
  const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

  async function registration(create) {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg && create) reg = await navigator.serviceWorker.register('sw.js');
    if (!reg) return null;
    if (!reg.active) await Promise.race([navigator.serviceWorker.ready, timeout(10000)]);
    return reg;
  }
  async function currentSubscription() {
    const reg = await registration(false); return reg ? reg.pushManager.getSubscription() : null;
  }
  async function saveToServer(sub, uid) {
    const j = sub.toJSON(); if (!j || !j.endpoint || !j.keys) throw err('Ce navigateur n’a pas pu activer les notifications.');
    await store().savePushSubscription({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
    write({ user: uid, endpoint: j.endpoint, at: Date.now() });
  }

  /** Active les notifications (à appeler depuis un geste : toucher un bouton). Lève une erreur lisible si impossible. */
  async function enable() {
    const u = me(); if (!u) throw err('Connectez-vous pour activer les notifications.');
    if (needsInstall()) throw err('Sur iPhone, ajoutez d’abord LocalTruck à l’écran d’accueil (Partager > Sur l’écran d’accueil), puis ouvrez-le depuis l’écran d’accueil.');
    if (!supported()) throw err('Les notifications ne sont pas disponibles sur cet appareil.');
    if (permission() === 'denied') throw err('Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du navigateur, puis réessayez.');
    const key = serverKey || await loadKey();
    if (!key) throw err('Les notifications ne sont pas encore disponibles. Réessayez un peu plus tard.');
    if (permission() !== 'granted') {
      const r = await Notification.requestPermission();
      if (r !== 'granted') throw err(r === 'denied' ? 'Notifications refusées. Vous pourrez les autoriser dans les réglages du navigateur.' : 'Notifications non activées.');
    }
    let sub;
    try {
      const reg = await registration(true); if (!reg) throw new Error('no worker');
      sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, key)) { try { await sub.unsubscribe(); } catch (e) { /* ignore */ } sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    } catch (e) {
      if (e && e.name === 'NotAllowedError') throw err('Notifications refusées. Vous pourrez les autoriser dans les réglages du navigateur.');
      throw err('Ce navigateur n’a pas pu activer les notifications. Vérifiez votre connexion et réessayez.');
    }
    await saveToServer(sub, u.id);
    setDeclined(null); active = true; syncedFor = u.id; changed();
    return true;
  }

  /** Désactive les notifications sur cet appareil (le navigateur et le serveur oublient l'appareil). */
  async function disable() {
    const sub = await currentSubscription().catch(() => null);
    if (sub && store() && store().removePushSubscription) await store().removePushSubscription(sub.endpoint);
    if (sub) { try { await sub.unsubscribe(); } catch (e) { /* ignore */ } }
    write(null); const u = me(); if (u) setDeclined(u.id); active = false; changed();
  }

  /** Appelée juste avant la déconnexion : le serveur oublie cet appareil pour ce compte (le suivant ne recevra pas ses alertes). */
  function forgetDevice() {
    const f = read(); if (!f || !f.endpoint) return;
    try { if (store() && store().removePushSubscription) store().removePushSubscription(f.endpoint); } catch (e) { /* ignore */ }
    write({ user: f.user, endpoint: f.endpoint, at: 0 });      // on garde la trace de la personne (elle retrouve ses notifications à sa prochaine connexion), mais le serveur ne connaît plus l'appareil
    active = false; syncedFor = null;
  }

  /** Remet l'appareil en règle à l'ouverture et à la connexion (abonnement perdu, rattachement au bon compte). */
  function sync() {
    const u = me();
    if (!u) { active = false; syncedFor = null; return Promise.resolve(false); }
    if (syncedFor === u.id) return Promise.resolve(active);
    if (syncing) return syncing;
    syncing = (async () => {
      await null;                                   // (le « finally » ci-dessous ne doit jamais s'exécuter avant l'affectation de « syncing »)
      try {
        if (!supported()) { active = false; return false; }
        const key = await loadKey();
        const flag = read();
        if (!key || permission() !== 'granted' || !flag || flag.user !== u.id) { active = false; return false; }
        let sub = await currentSubscription();
        if (sub && !sameKey(sub, key)) { try { await sub.unsubscribe(); } catch (e) { /* ignore */ } sub = null; }
        if (!sub) {                                   // le navigateur a perdu l'abonnement : permission déjà accordée, on le refait sans rien demander
          const reg = await registration(true);
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
          await saveToServer(sub, u.id);
        } else if (flag.endpoint !== sub.endpoint || !flag.at || Date.now() - flag.at > RESAVE) await saveToServer(sub, u.id);
        active = true; return true;
      } catch (e) { active = false; return false; }
      finally { syncedFor = serverKey === undefined ? null : ((me() || {}).id || null); syncing = null; changed(); }      // clé pas encore connue (réseau) : on réessaiera
    })();
    const run = syncing;
    run.then((ok) => { if (!ok && MFT.install && MFT.install.nudge) MFT.install.nudge(); });      // application installée, notifications pas encore activées : une proposition
    return run;
  }

  /** État pour l'écran « Profil ». */
  function state() {
    if (!capable() || !cloud()) return needsInstall() && cloud() ? 'install' : 'unsupported';
    if (!serverKey) return serverKey === undefined ? 'loading' : 'unavailable';
    if (permission() === 'denied') return 'blocked';
    return active ? 'on' : 'off';
  }

  const listeners = new Set();
  function changed() { listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** Appelée une fois au démarrage. */
  function start() {
    if (!capable() || !cloud()) return;                  // (la clé du serveur n'est demandée qu'une fois la personne connectée : voir sync())
    try {
      // un clic sur une notification pendant que l'application est ouverte : le service worker nous demande d'ouvrir la fiche
      navigator.serviceWorker.addEventListener('message', (ev) => {
        const d = ev && ev.data; if (!d || d.type !== 'open' || typeof d.url !== 'string') return;
        const App = MFT.App; if (!App) return;
        if (/^#\/truck\/[0-9a-fA-F-]{36}$/.test(d.url)) { location.hash = d.url; if (App.openFromHash) App.openFromHash(); }
        else if (App.tabs && App.tabs.alerts && App.setTab) App.setTab('alerts');
      });
    } catch (e) { /* ignore */ }
  }

  MFT.push = { start, sync, supported, capable, ready, offerable, isActive, state, permission, needsInstall, enable, disable, forgetDevice, onChange, loadKey, _reset: () => { serverKey = undefined; keyLoading = null; active = false; syncedFor = null; syncing = null; } };
})();
