/* LocalTruck – fonctions de la plateforme : Electron (préchargement), navigateur / application Android (valeurs par défaut web). */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const native = window.mft || {};
  const ls = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const web = {
    isElectron: false, forceLocal: false,
    async load() { try { return ls ? ls.getItem('mft.local.db') : null; } catch (e) { return null; } },
    async save(s) { try { if (ls) ls.setItem('mft.local.db', s); return !!ls; } catch (e) { return false; } },
    async notify(title, body) {
      try { if ('Notification' in window && Notification.permission === 'granted') { new Notification(String(title || 'LocalTruck'), { body: String(body || ''), icon: 'assets/icon.png' }); return true; } } catch (e) { /* ignore */ }
      return false;
    },
    askNotifyPermission() {
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { /* ignore */ }
    },
    async openExternal(url) {
      if (!/^https?:\/\//i.test(String(url))) return false;
      try { const w = window.open(url, '_blank', 'noopener,noreferrer'); return !!w || true; } catch (e) { return false; }
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(String(text)); return true; } catch (e) { /* repli ci-dessous */ }
      try {
        const ta = document.createElement('textarea'); ta.value = String(text); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e) { return false; }
    },
  };
  const cap = window.Capacitor;
  const isAndroidApp = !!(cap && (cap.isNativePlatform ? cap.isNativePlatform() : (cap.getPlatform && cap.getPlatform() !== 'web')));
  MFT.platform = Object.assign(web, native, { isElectron: !!native.load, forceLocal: !!native.forceLocal, isAndroidApp });

  /* Application Android (Capacitor) : le bouton « retour » du téléphone revient en arrière dans l'application au lieu de la fermer. */
  try {
    const capApp = cap && cap.Plugins && cap.Plugins.App;
    if (isAndroidApp && capApp && capApp.addListener) capApp.addListener('backButton', () => {
      const blocked = !!(MFT.updates && MFT.updates.blocking && MFT.updates.blocking());   // mise à jour obligatoire affichée : retour = quitter
      const handled = !blocked && MFT.App && MFT.App.back && MFT.App.back();
      if (!handled && capApp.exitApp) capApp.exitApp();
    });
  } catch (e) { /* ignore */ }

  /* Le service worker du site web (ouverture hors réseau) et les propositions de mise à jour sont gérés par js/updates.js. */
})();
