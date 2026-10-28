/* LocalTruck – mises à jour : à chaque ouverture ou reprise de l'application, on vérifie si une nouvelle version existe.
 *  - application Android : compare sa version à celle annoncée par le site (https://localtruck.fr/version.json, écrit à chaque publication du site ; à l'ouverture, à chaque reprise après mise en veille ou
 *    passage en arrière-plan, puis toutes les 30 min). S'il y en a une, une fenêtre sans bouton « Plus tard » bloque l'application et
 *    propose de télécharger le nouvel APK (il s'installe par-dessus l'ancien : même application, même signature) : OBLIGATOIRE ;
 *  - site web (et application installée depuis le navigateur) : AUCUNE fenêtre. Le service worker détecte la nouvelle publication, la
 *    prend en charge tout seul, et la page se recharge sans rien demander quand cela ne fait rien perdre (voir « softReload »).
 * Hors connexion ou si le site ne répond pas : on ne bloque jamais (la vérification se refait à la prochaine reprise).
 * Seule requête envoyée : celle au site localtruck.fr (adresse IP comme pour tout site) — voir « Mises à jour » dans la politique de confidentialité. */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const INFO = 'https://localtruck.fr/version.json';                      // { "version": "0.3.30", "url": "https://localtruck.fr/LocalTruck.apk" }
  const APK_URL = /^https:\/\/localtruck\.fr\/LocalTruck\.apk$/;
  const P = () => MFT.platform || {};
  const state = { version: String(MFT.VERSION || ''), versionKnown: false, pending: null, reg: null, lock: null, obs: null, soft: false, reloading: false, lastTry: 0, running: false, started: false, t0: Date.now() };
  const U = (MFT.updates = { state, START_DELAY: 1000, MIN_GAP: 15000, POLL_MS: 400, FRESH_MS: 15000 });

  /* ---------------------------------------------------------- numéros de version */
  const parse = (v) => { const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || '')); return m ? [+m[1], +m[2], +(m[3] || 0)] : null; };
  const newer = (a, b) => { const x = parse(a), y = parse(b); if (!x || !y) return false; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  U.newer = newer;

  const webOk = () => 'serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) && !P().isAndroidApp && !P().isElectron;
  /** Les mises à jour automatiques existent-elles ici ? (non : fichier .exe, page ouverte hors https) */
  U.supported = () => !!P().isAndroidApp || webOk();
  /** Faut-il un bouton « Rechercher une mise à jour » ? Seulement dans l'application Android : le site se met à jour sans rien demander. */
  U.manual = () => !!P().isAndroidApp;
  /** Numéro affiché en bas des écrans « Compte » (celui de l'APK dans l'application Android). */
  U.label = () => state.version;
  /** Une mise à jour est-elle connue ? */
  U.pending = () => state.pending;
  /** La fenêtre de mise à jour obligatoire est-elle affichée ? (le bouton « retour » d'Android ne doit alors rien fermer) */
  U.blocking = () => !!state.lock;

  /* ---------------------------------------------------------- fenêtre obligatoire */
  const root = () => (MFT.ui && MFT.ui.appRoot ? MFT.ui.appRoot() : document.getElementById('app'));
  /** Tout ce qui est derrière la fenêtre devient inerte : ni clic, ni tabulation, ni lecteur d'écran. */
  function inertAll() { const r = root(); if (r) r.querySelectorAll('.screen, .nav, .overlay:not(.locked)').forEach((e) => e.setAttribute('inert', '')); }
  function freeze() {
    inertAll();
    if (!state.obs && window.MutationObserver) { state.obs = new MutationObserver(() => { if (state.lock) inertAll(); }); state.obs.observe(root(), { childList: true }); }
  }
  function unlock() {
    if (!state.lock) return;
    state.lock.ov.remove(); state.lock = null;
    if (state.obs) { state.obs.disconnect(); state.obs = null; }
    const r = root(); if (r) r.querySelectorAll('[inert]').forEach((e) => e.removeAttribute('inert'));
  }
  /** App.render() refait les écrans : la fenêtre reste, et les nouveaux écrans sont rendus inertes. */
  U.syncLock = function () { if (state.lock) { if (!root().contains(state.lock.ov)) root().appendChild(state.lock.ov); inertAll(); } };

  function lockOffer(o) {
    const ui = MFT.ui; const h = ui.h; if (!ui.h) return;
    if (state.lock) { if (state.lock.key === o.key) return; unlock(); }
    const status = h('div', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
    const go = h('button', { class: 'btn primary block', type: 'button', onClick: () => o.go(status, go) }, ui.icon('refresh'), o.goLabel);
    const ov = h('div', { class: 'overlay center locked', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'upd-title', 'aria-describedby': 'upd-desc' },
      h('div', { class: 'dialog' },
        h('h2', { id: 'upd-title' }, o.title),
        h('p', { id: 'upd-desc', style: { color: 'var(--tx)' } }, o.text),
        o.note ? h('p', { class: 'small', style: { marginTop: '10px' } }, o.note) : null,
        h('div', { class: 'col gap12', style: { marginTop: '16px' } }, go, status)));
    root().appendChild(ov); state.lock = { ov, key: o.key };
    freeze(); try { go.focus(); } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------- application Android : dernière version annoncée par le site */
  async function readVersion() {
    try {
      const cap = window.Capacitor; const app = cap && cap.Plugins && cap.Plugins.App;
      if (app && app.getInfo) { const i = await app.getInfo(); if (i && parse(i.version)) { state.version = String(i.version); state.versionKnown = true; } }
    } catch (e) { /* version inconnue : on ne bloque rien plutôt que de bloquer à tort */ }
  }
  async function latestRelease() {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(INFO, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); const version = String(j.version || '').replace(/^v/i, '');
      if (!parse(version)) throw new Error('numéro de version illisible');
      return { version, url: APK_URL.test(String(j.url || '')) ? j.url : null };     // pas d'adresse d'APK valide : la publication n'est pas terminée
    } finally { clearTimeout(t); }
  }
  async function checkApk() {
    if (!state.versionKnown) await readVersion();
    if (!state.versionKnown) throw new Error('version de l’application inconnue');
    const latest = await latestRelease();
    if (!newer(latest.version, state.version)) { state.pending = null; unlock(); return { status: 'uptodate', version: state.version }; }
    if (!latest.url) return { status: 'preparing', version: latest.version };
    state.pending = latest; offerApk(latest);
    return { status: 'newer', version: latest.version };
  }
  /** Extension native Android « ApkUpdater » (mobile/native/) : télécharge l'APK dans l'application et ouvre l'installateur d'Android. Absente : on retombe sur le navigateur. */
  const nativePlugin = () => { try { const c = window.Capacitor; const p = c && c.Plugins && c.Plugins.ApkUpdater; return p && typeof p.start === 'function' ? p : null; } catch (e) { return null; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DOWNLOAD_MAX_MS = 10 * 60 * 1000;
  function browserDownload(latest, status) {
    status.textContent = 'Téléchargement lancé : ouvrez le fichier depuis les notifications de votre navigateur.';
    MFT.platform.openExternal(latest.url).then((ok) => { if (!ok) status.textContent = 'Impossible d’ouvrir le téléchargement : réessayez.'; });
  }
  /** Télécharge (avec le pourcentage), puis ouvre l'installateur d'Android. Un second appui reprend où on en est (fichier déjà téléchargé, autorisation donnée…). */
  async function nativeUpdate(latest, status, btn, pl) {
    const ui = MFT.ui; const say = (t) => { status.textContent = t; };
    const label = (t) => { btn.replaceChildren(ui.icon('refresh'), t); };
    btn.disabled = true;
    try {
      let st = await pl.status();
      if (!st || !st.ready) {
        say('Téléchargement… 0 %'); await pl.start({ url: latest.url });
        const t0 = Date.now();
        for (;;) {
          await sleep(U.POLL_MS);
          st = await pl.status();
          if (st.state === 'error') throw new Error(st.error || 'téléchargement impossible');
          if (st.state === 'done' || st.ready) break;
          if (Date.now() - t0 > DOWNLOAD_MAX_MS) throw new Error('trop long');
          say('Téléchargement… ' + (st.total > 0 ? Math.min(99, Math.floor(100 * st.loaded / st.total)) + ' %' : (Math.round(st.loaded / 100000) / 10) + ' Mo'));
        }
      }
      const r = await pl.install();
      if (r && r.status === 'needs_permission') { say('Android vient d’ouvrir un réglage : autorisez LocalTruck à installer des applications, puis revenez ici et appuyez sur « Installer ».'); label('Installer'); }
      else { say('Téléchargement terminé : Android va vous demander de confirmer l’installation. Si vous annulez, appuyez de nouveau sur « Installer ». Si Android parle d’un « conflit », désinstallez LocalTruck puis réinstallez-le (vos données sont dans votre compte).'); label('Installer'); }
    } catch (e) {
      say('Le téléchargement dans l’application a échoué (' + String((e && (e.message || e.errorMessage)) || e).slice(0, 80) + ') : ouverture du navigateur…');
      setTimeout(() => browserDownload(latest, status), 600);
    } finally { btn.disabled = false; }
  }
  function offerApk(latest) {
    const pl = nativePlugin();
    lockOffer({
      key: 'apk-' + latest.version,
      title: 'Mise à jour obligatoire',
      text: 'LocalTruck ' + latest.version + ' est disponible (vous utilisez la ' + state.version + '). Pour continuer à utiliser l’application, installez la nouvelle version.',
      note: pl
        ? 'Appuyez sur « Mettre à jour » : le téléchargement se fait ici, puis Android vous demande de confirmer l’installation. Votre compte et vos données sont conservés. La première fois, Android peut demander d’autoriser LocalTruck à installer des applications : acceptez, puis revenez ici.'
        : 'Appuyez sur « Télécharger », ouvrez le fichier téléchargé puis choisissez « Installer » : votre compte et vos données sont conservés. Si Android demande l’autorisation d’installer depuis votre navigateur, acceptez.',
      goLabel: pl ? 'Mettre à jour maintenant' : 'Télécharger la mise à jour',
      go: (status, btn) => { if (pl && btn) nativeUpdate(latest, status, btn, pl); else browserDownload(latest, status); },
    });
  }
  /** Vérification à chaque ouverture / reprise ; jamais plus d'une toutes les MIN_GAP ms, sauf demande explicite. */
  async function run(force) {
    if (state.running) return;
    if (!force && Date.now() - state.lastTry < U.MIN_GAP) return;
    state.running = true; state.lastTry = Date.now();
    try { await checkApk(); } catch (e) { /* hors connexion : pas de blocage */ } finally { state.running = false; }
  }

  /* ---------------------------------------------------------- site web (PWA) : mise à jour silencieuse */
  /* Une nouvelle publication s'installe et prend la main toute seule (le service worker s'active dès son installation, voir sw.js).
   * La page, elle, se recharge sans fenêtre ni question, mais seulement quand cela ne fait rien perdre : aucune saisie en cours
   * (champ actif ou déjà rempli). Moments choisis : juste après l'ouverture (rien n'a encore été fait), ou quand la personne
   * quitte la page (autre onglet, autre application, écran verrouillé). Sinon on attend : la page suivante sera la bonne. */
  const typing = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || !!a.isContentEditable); };
  const filled = () => Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), textarea')).some((e) => String(e.value || '').trim() !== '');
  const quiet = () => !typing() && !filled();
  function reload() { if (state.reloading) return; state.reloading = true; location.reload(); }
  function softReload() {
    if (state.reloading || state.soft) return;
    state.soft = true; state.pending = { web: true };
    if (Date.now() - state.t0 < U.FRESH_MS && quiet()) return reload();
    document.addEventListener('visibilitychange', () => { if (document.hidden && quiet()) reload(); });
  }
  /** Vérification demandée explicitement (console, tests) : on attend que la nouvelle version soit active, puis on recharge tout de suite. */
  async function checkWeb() {
    const reg = state.reg; if (!reg) return { status: 'unsupported' };
    await reg.update();
    const w = reg.installing || reg.waiting;
    if (!w) return { status: 'uptodate' };
    await new Promise((res) => {
      if (w.state === 'activated') return res();
      const t = setTimeout(res, 10000);
      w.addEventListener('statechange', () => { if (w.state === 'activated' || w.state === 'redundant') { clearTimeout(t); res(); } });
    });
    if (w.state === 'activated' && navigator.serviceWorker.controller) { state.pending = { web: true }; reload(); return { status: 'newer' }; }
    return { status: 'uptodate' };
  }
  function registerWorker() {
    let had = !!navigator.serviceWorker.controller;     // la toute première installation (sans version précédente) ne recharge rien
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) softReload(); had = true; });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      state.reg = reg;
      const poll = (force) => {
        if (!force && Date.now() - state.lastTry < U.MIN_GAP) return;
        state.lastTry = Date.now(); reg.update().catch(() => {});
      };
      poll(true);
      setInterval(() => poll(true), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(false); });
    }).catch(() => { /* pas de service worker : l'application fonctionne quand même */ });
  }

  /* ---------------------------------------------------------- points d'entrée */
  /** Lancé une fois au démarrage de l'application. */
  U.start = function () {
    if (state.started) return; state.started = true;
    if (P().isAndroidApp) {
      setTimeout(() => run(true), U.START_DELAY);
      setInterval(() => run(true), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) run(false); });
      try {
        const cap = window.Capacitor; const app = cap && cap.Plugins && cap.Plugins.App;
        if (app && app.addListener) { app.addListener('resume', () => run(false)); app.addListener('appStateChange', (s) => { if (s && s.isActive) run(false); }); }
      } catch (e) { /* ignore */ }
    } else if (webOk()) setTimeout(registerWorker, 1000);
  };
  /** Bouton « Rechercher une mise à jour » : dit toujours ce qui se passe. */
  U.checkNow = async function () {
    const ui = MFT.ui;
    try {
      const r = P().isAndroidApp ? await checkApk() : await checkWeb();
      if (r.status === 'unsupported') ui.toast('Les mises à jour automatiques ne sont pas disponibles ici.');
      else if (r.status === 'preparing') ui.toast('La version ' + r.version + ' est en cours de préparation : réessayez dans quelques minutes.');
      else if (r.status === 'uptodate') ui.toast('Vous avez déjà la dernière version' + (state.versionKnown ? ' (' + state.version + ')' : '') + '.', 'ok');
      return r;
    } catch (e) {
      ui.toast('Impossible de vérifier pour le moment : vérifiez votre connexion.', 'err');
      return { status: 'error' };
    }
  };
})();
