/* LocalTruck – apparence : nuit, jour ou automatique (suit le téléphone). Chargé dans <head> pour éviter tout flash au démarrage.
 * Le choix reste sur l'appareil (localStorage) ; il n'est jamais envoyé au serveur. */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const KEY = 'lt_theme'; const MODES = ['dark', 'light', 'auto']; const COLORS = { dark: '#0B0B0D', light: '#E4E9F0' };
  let mode = 'dark';
  try { const v = localStorage.getItem(KEY); if (MODES.indexOf(v) >= 0) mode = v; } catch (e) { /* stockage indisponible : on garde « nuit » */ }
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  const resolved = () => (mode === 'auto' ? (mq && mq.matches ? 'light' : 'dark') : mode);
  function apply() {
    const r = resolved(); document.documentElement.setAttribute('data-theme', r);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', COLORS[r]);
  }
  function set(m) {
    if (MODES.indexOf(m) < 0) return; mode = m;
    try { localStorage.setItem(KEY, m); } catch (e) { /* tant pis : le choix vaut pour cette session */ }
    apply();
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (mode === 'auto') apply(); });
  MFT.theme = { get: () => mode, resolved, set, MODES, cycle: () => set(resolved() === 'dark' ? 'light' : 'dark'), apply };
  apply();
  // la balise theme-color est lue après <head> : on la corrige dès que le document est prêt
  document.addEventListener('DOMContentLoaded', apply);
})();
