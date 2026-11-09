/* LocalTruck – compteurs d'audience ANONYMES : « combien de personnes ouvrent l'appli, regardent une fiche, créent un compte, l'installent ».
 * Chaque étape envoie au plus un « +1 » par appareil et par jour, avec seulement le nom de l'étape et la plateforme (site, appli installée, APK).
 * Aucun identifiant, aucune adresse, aucun compte n'est joint à l'envoi : le serveur additionne des nombres par jour (voir supabase/4-audience.sql). */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const KEY = 'mft.funnel';
  const EVERY_TIME = new Set(['signup']);               // une inscription = un compte réel : jamais dédoublonnée
  const ONCE_EVER = new Set(['installed']);             // une installation se compte une seule fois par appareil

  const ls = () => { try { return window.localStorage; } catch (e) { return null; } };
  const read = () => { try { const s = ls(); return (s && JSON.parse(s.getItem(KEY) || '{}')) || {}; } catch (e) { return {}; } };
  const write = (o) => { try { const s = ls(); if (s) s.setItem(KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function standalone() {
    try { return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true); } catch (e) { return false; }
  }
  /** apk = application Android · pwa = site installé sur l'écran d'accueil · web = navigateur */
  function platform() {
    const P = MFT.platform || {};
    if (P.isAndroidApp) return 'apk';
    return standalone() ? 'pwa' : 'web';
  }

  /** Compte une étape (silencieux : un compteur ne doit jamais gêner l'application). */
  function track(step) {
    try {
      const App = MFT.App; const st = App && App.store; if (!st || !st.isCloud || typeof st.trackFunnel !== 'function') return false;
      if (!EVERY_TIME.has(step)) {
        const seen = read(); const k = ONCE_EVER.has(step) ? 'ever' : today();
        if (seen[step] === k) return false;
        seen[step] = k; write(seen);
      }
      st.trackFunnel(step, platform());
      return true;
    } catch (e) { return false; }
  }

  /** Une « ouverture » par appareil et par jour, y compris quand l'application revient au premier plan. */
  function start() {
    track('visit');
    try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') track('visit'); }); } catch (e) { /* ignore */ }
  }

  MFT.funnel = { track, platform, standalone, start };
})();
