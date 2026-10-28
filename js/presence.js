/* LocalTruck – présence en direct : « combien de personnes sont sur l'appli en ce moment ».
 * Chaque appli ouverte envoie un signal par minute, TANT QUE LA PAGE EST OUVERTE (au premier plan ou en arrière-plan, dans un autre onglet)
 * avec un numéro de séance tiré au hasard à l'ouverture (conservé si la page se recharge, pour ne pas compter la personne deux fois) ;
 * aucun nom, aucune position, aucune adresse : si la personne est connectée, c'est le serveur qui rattache son compte (voir supabase/10-presence.sql).
 * Le nombre affiché est le VRAI nombre de personnes présentes, et il n'apparaît que lorsqu'au moins deux personnes sont là (vous et quelqu'un d'autre). */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const BEAT_MS = 60000;           // un signal par minute
  const SHOW_FROM = 2;             // pas de compteur s'il n'y a personne d'autre que soi
  let sid = null; let timer = null; let count = 0; let known = false; let missing = false; let started = false;
  const subs = new Set();

  const KEY = 'mft.presence.sid';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function newSid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* ignore */ }
    const b = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(b); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const x = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  }
  /** Numéro de séance de CET onglet : le même après un rechargement, un autre dans un nouvel onglet (sessionStorage : effacé à la fermeture). */
  function ownSid() {
    try { const v = window.sessionStorage.getItem(KEY); if (v && UUID.test(v)) return v; } catch (e) { /* ignore */ }
    const v = newSid(); try { window.sessionStorage.setItem(KEY, v); } catch (e) { /* ignore */ }
    return v;
  }
  const store = () => MFT.App && MFT.App.store;
  const online = () => { const s = store(); return !!(s && s.isCloud && typeof s.touchPresence === 'function'); };
  const emit = () => subs.forEach((fn) => { try { fn(count); } catch (e) { /* ignore */ } });
  const visible = () => known && count >= SHOW_FROM;

  async function beat() {
    if (missing || !online()) return;
    try {
      const s = store();
      await s.touchPresence(sid, MFT.funnel ? MFT.funnel.platform() : 'web');
      if (document.visibilityState === 'hidden') return;           // en arrière-plan : on signale seulement qu'on est là, sans relire le nombre (personne ne le regarde)
      const n = await s.presenceNow(); const first = !known; known = true;
      if (first || n !== count) { count = n; emit(); }
    } catch (e) {
      // 4xx (hors 401/429) : le script SQL « 10-presence.sql » n'est pas encore exécuté → on arrête là, sans rien afficher. Réseau ou 5xx : prochaine minute.
      if (e && !e.network && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) { missing = true; known = false; emit(); }
    }
  }

  function start() {
    if (started) return; started = true; sid = ownSid();
    beat(); timer = setInterval(beat, BEAT_MS);
    try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); }); } catch (e) { /* ignore */ }
  }

  /** Petit indicateur « ● 12 personnes en ligne en ce moment » : caché tant que le compteur n'a pas lieu d'être. */
  function badge(cls) {
    const { h } = MFT.ui;
    const txt = h('span', null); const el = h('div', { class: 'presence ' + (cls || ''), role: 'status', hidden: true }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), txt);
    let attached = false;
    const paint = () => { const v = visible(); el.hidden = !v; if (v) txt.textContent = count + ' personnes en ligne en ce moment'; };
    const fn = () => {
      if (el.isConnected) attached = true; else if (attached) { subs.delete(fn); return; }   // l'écran a été fermé : on arrête de le mettre à jour
      paint();
    };
    subs.add(fn); paint(); return el;
  }

  MFT.presence = { start, badge, beat, count: () => (visible() ? count : 0), visible, SHOW_FROM };
})();
