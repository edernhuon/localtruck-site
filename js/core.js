/* LocalTruck – cœur métier (sans dépendance, testable sous Node et dans Electron).
 * Toutes les données sont locales : un seul objet JSON (« db ») persisté par un adaptateur.
 * LocalTruck est un intermédiaire d'information : aucune notion de paiement, commande ou fidélité. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.MFT = root.MFT || {}; root.MFT.core = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ constantes */
  const CUISINES = ['Burgers', 'Pizza', 'Tacos', 'Crêpes', 'Asiatique', 'Végé', 'Desserts', 'Boissons', 'Autre'];
  const PAYMENTS = ['Carte bancaire', 'Espèces', 'Sans contact', 'Titres-restaurant'];
  const REPORT_REASONS = [
    { id: 'wrong_place', label: 'Emplacement faux' },
    { id: 'fraud', label: 'Faux food truck / fiche frauduleuse' },
    { id: 'abusive', label: 'Contenu abusif' },
    { id: 'other', label: 'Autre' },
  ];
  // Motifs proposés pour signaler un AVIS (mêmes identifiants que REPORT_REASONS : le serveur n'en accepte pas d'autres)
  const REVIEW_REPORT_REASONS = [
    { id: 'fraud', label: 'Faux avis : cette personne n’est pas cliente' },
    { id: 'abusive', label: 'Propos abusifs ou injurieux' },
    { id: 'other', label: 'Autre' },
  ];
  const REVIEW_REPORT_REASONS_PRO = [   // vu par le food truck concerné (article D111-17 : signalement gratuit d'un doute sur l'authenticité)
    { id: 'fraud', label: 'Avis douteux : cette personne n’est pas venue' },
    { id: 'abusive', label: 'Propos abusifs ou injurieux' },
    { id: 'other', label: 'Autre' },
  ];
  /** Prévient l'auteur d'un avis retiré (même texte que supabase/9-moderation.sql). */
  const reviewRemovedText = (truckName) => ('Votre avis sur ' + (truckName || 'ce food truck') + ' a été retiré par l’administration : il ne respectait pas les règles des avis (signalement jugé fondé). Pour le contester, écrivez à l’adresse indiquée dans les mentions légales.').slice(0, 300);
  const SUSPECT_THRESHOLD = 3;        // « signalé plus de 3 fois » => suspect
  const NEARBY_WARN_M = 150;
  const MAX_SLOTS_PER_DAY = 4;
  const MAX_PHOTOS = 6;
  const ADMIN_EMAIL = 'admin@localtruck.fr';
  const ADMIN_PASSWORD = 'admin1234';
  /** Règle des mots de passe (création et changement ; jamais à la connexion : les anciens comptes gardent leur mot de passe).
   *  6 caractères minimum, avec au moins 1 chiffre et 1 caractère spécial (ni lettre, ni chiffre, ni espace). */
  const PASSWORD_RULE = 'Le mot de passe doit contenir au moins 6 caractères, 1 chiffre et 1 caractère spécial (par exemple ! ? # @ -).';
  const PASSWORD_HINT = '6 caractères minimum, avec 1 chiffre et 1 caractère spécial (! ? # @ -…).';
  function passwordProblem(p) {
    p = String(p == null ? '' : p);
    return p.length >= 6 && /[0-9]/.test(p) && /[^\p{L}\p{N}\s]/u.test(p) ? null : PASSWORD_RULE;
  }
  const BAD_WORDS = ['connard', 'connasse', 'salope', 'enculé', 'encule', 'pute', 'fdp', 'ntm', 'nique ta', 'merde', 'batard', 'bâtard', 'pd '];

  /* ------------------------------------------------------------------ utilitaires */
  class UserError extends Error { constructor(msg, code) { super(msg); this.name = 'UserError'; this.code = code || 'user'; } }
  const fail = (msg, code) => { throw new UserError(msg, code); };

  const cryptoObj = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle)
    ? globalThis.crypto
    : (typeof require === 'function' ? require('crypto').webcrypto : null);

  function uid(prefix) {
    const b = new Uint8Array(8);
    cryptoObj.getRandomValues(b);
    return (prefix || 'id') + '_' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 11);
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds()); return x; }
  function addDaysKey(k, n) { return dateKey(addDays(parseKey(k), n)); }
  function weekdayOf(k) { return parseKey(k).getDay(); } // 0 = dimanche
  const DOW_SHORT = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
  const DOW_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function fmtDayLong(k) { const d = parseKey(k); return DOW_LONG[d.getDay()][0].toUpperCase() + DOW_LONG[d.getDay()].slice(1) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function fmtDateShort(ts) { const d = new Date(ts); return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtDayShort(k) { const d = parseKey(k); return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]; }

  /* ---------------------------------------------------------------- abonnement des food trucks (éteint par défaut)
   * Reproduit EXACTEMENT la règle de supabase/7-billing.sql (mft_billing_covered) pour dire au propriétaire où il en est.
   * cfg = { enabled, price_cents, free_until: 'AAAA-MM-JJ', grace_days, payment_link, portal_link } ; sub = { status, periodEnd(ms|0) } ou null. */
  const parisDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const fmtDateFr = (ms) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtEuros = (cents) => { const n = (Number(cents) || 0) / 100; return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €'; };
  function billingView(cfg, sub, truck, nowMs) {
    const off = { show: false, state: 'off', covered: true, text: '' };
    if (!cfg || !cfg.enabled || !truck) return off;
    if (truck.demo) return { ...off, state: 'exempt' };
    const price = fmtEuros(cfg.price_cents) + ' par mois'; const grace = (Number(cfg.grace_days) || 0) * 86400e3;
    const base = { show: true, price, paymentLink: cfg.payment_link || null, portalLink: cfg.portal_link || null, until: 0 };
    const end = sub && sub.periodEnd ? +sub.periodEnd : 0;
    if (cfg.free_until && parisDay(nowMs) <= cfg.free_until) {
      const fu = new Date(cfg.free_until + 'T12:00:00Z').getTime();
      return { ...base, state: 'free', covered: true, until: fu, text: 'Gratuit jusqu’au ' + fmtDateFr(fu) + '. Ensuite : ' + price + '.' };
    }
    if (sub && sub.status === 'free' && (!end || end > nowMs)) return { ...base, state: 'offered', covered: true, until: end, text: end ? 'Accès offert jusqu’au ' + fmtDateFr(end) + '.' : 'Accès offert par LocalTruck.' };
    if (sub && ['active', 'trialing', 'past_due'].includes(sub.status) && end && end + grace > nowMs) {
      if (sub.status === 'past_due' || end <= nowMs) return { ...base, state: 'late', covered: true, until: end + grace, text: 'Votre dernier paiement n’est pas passé. Réglez-le avant le ' + fmtDateFr(end + grace) + ' pour que votre fiche reste sur la carte.' };
      return { ...base, state: 'paid', covered: true, until: end, text: (sub.status === 'trialing' ? 'Période d’essai' : 'Abonnement actif') + ' · prochaine échéance le ' + fmtDateFr(end) + '.' };
    }
    if (sub && sub.status === 'canceled' && end > nowMs) return { ...base, state: 'canceled', covered: true, until: end, text: 'Abonnement résilié : votre fiche reste visible jusqu’au ' + fmtDateFr(end) + '.' };
    const hidden = !!truck.hiddenByBilling;
    return { ...base, state: 'due', covered: false, hidden, text: (hidden ? 'Votre fiche est masquée de la carte faute d’abonnement. Elle réapparaît dès le paiement. ' : 'Un abonnement est nécessaire pour rester sur la carte. ') + 'Tarif : ' + price + ', sans engagement.' };
  }

  function minutesOf(hm) { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); }
  function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function fmtHM(s) { if (s === '00:00') return 'minuit'; const [h, m] = String(s).split(':'); return Number(h) + 'h' + (Number(m) ? pad2(Number(m)) : ''); }
  function fmtHours(slot) { return fmtHM(slot.start) + ' – ' + fmtHM(slot.end); }
  function validHM(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s)); }
  function addMinutesHM(s, min) { const t = (minutesOf(s) + min) % 1440; const v = (t + 1440) % 1440; return pad2(Math.floor(v / 60)) + ':' + pad2(v % 60); }

  function slotInterval(key, slot) {
    const day = parseKey(key);
    const s = minutesOf(slot.start), e = minutesOf(slot.end);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, s).getTime();
    let end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, e <= s ? e + 1440 : e).getTime();
    if (slot.endedAt) end = Math.min(end, slot.endedAt);
    return { start, end };
  }
  /** Fenêtre du déjeuner d'un jour (11h–15h) et jour concerné par « Ce midi » : aujourd'hui tant qu'il n'est pas 15h, sinon demain. */
  /* Rayon de recherche : de 100 m (voir un food truck précis en ville) à 50 km, par paliers (plus fins près de zéro). */
  const RADIUS_STEPS = [0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7, 10, 12, 15, 20, 30, 40, 50];
  const radiusIndex = (km) => { let best = 0; RADIUS_STEPS.forEach((s, i) => { if (Math.abs(s - km) < Math.abs(RADIUS_STEPS[best] - km)) best = i; }); return best; };
  const fmtRadius = (km) => (km < 1 ? Math.round(km * 1000) + ' m' : String(Math.round(km * 100) / 100).replace('.', ',') + ' km');
  const LUNCH_FROM = 11 * 60, LUNCH_TO = 15 * 60;
  function lunchWindow(key) { const d = parseKey(key); const at = (m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m).getTime(); return [at(LUNCH_FROM), at(LUNCH_TO)]; }
  function lunchKey(now) { const today = dateKey(now); return +now < lunchWindow(today)[1] ? today : addDaysKey(today, 1); }
  function slotStatus(slot, key, now) {
    if (slot.cancelled) return 'cancelled';
    const { start, end } = slotInterval(key, slot);
    const t = +now;
    if (slot.endedAt || t >= end) return 'done';
    if (t >= start) return 'open';
    if (start - t <= 3 * 3600e3) return 'soon';
    return 'later';
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371.0088, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function fmtDist(km) {
    if (km == null || !isFinite(km)) return '';
    if (km < 1) return Math.max(10, Math.round(km * 100) * 10) + ' m';
    if (km < 10) return km.toFixed(1).replace('.', ',') + ' km';
    return Math.round(km) + ' km';
  }

  /* Projection Web Mercator (tuiles OpenStreetMap, 256 px) */
  const TILE = 256;
  function project(lat, lng, z) {
    const s = TILE * Math.pow(2, z);
    const sin = Math.sin(clamp(lat, -85.0511, 85.0511) * Math.PI / 180);
    return { x: (lng + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
  }
  function unproject(x, y, z) {
    const s = TILE * Math.pow(2, z);
    const lng = x / s * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / s;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
  }
  function tileOf(lat, lng, z) { const p = project(lat, lng, z); return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE), z }; }

  /* France (métropole, Corse et outre-mer) – boîtes englobantes approximatives */
  const FRANCE_BOXES = [
    [41.0, 51.3, -5.5, 9.8],        // métropole + Corse
    [15.8, 16.6, -61.9, -60.9],     // Guadeloupe
    [14.3, 14.95, -61.3, -60.7],    // Martinique
    [2.0, 5.9, -54.7, -51.5],       // Guyane
    [-21.5, -20.8, 55.1, 55.9],     // La Réunion
    [-13.1, -12.5, 44.9, 45.4],     // Mayotte
  ];
  function isInFrance(lat, lng) { return FRANCE_BOXES.some(([a, b, c, d]) => lat >= a && lat <= b && lng >= c && lng <= d); }

  async function hashPassword(password, salt, iter) {
    const enc = new TextEncoder();
    const key = await cryptoObj.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await cryptoObj.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256);
    return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ------------------------------------------------------------------ Store */
  const DB_VERSION = 1;
  function emptyDb() {
    return { v: DB_VERSION, users: [], trucks: [], reports: [], reviews: [], events: [], notifications: [], log: [], session: { userId: null }, meta: { createdAt: Date.now() } };
  }

  class Store {
    constructor(opts) {
      opts = opts || {};
      this.isCloud = false;
      this.adapter = opts.adapter || { load: async () => null, save: async () => {} };
      this.now = opts.now || (() => new Date());
      this.iter = opts.iterations || 120000;
      this.db = emptyDb();
      this.listeners = new Set();
      this._saveTimer = null;
    }

    /* ---- persistance */
    async init() {
      let raw = null;
      try { raw = await this.adapter.load(); } catch (e) { raw = null; }
      if (raw) {
        try { this.db = Object.assign(emptyDb(), JSON.parse(raw)); }
        catch (e) { this.db = emptyDb(); this.corrupted = true; }
      }
      if (!this.db.users.some((u) => u.role === 'admin')) await this._seedAdmin();
      this._persistNow();
      return this;
    }
    async _seedAdmin() {
      const salt = uid('s');
      this.db.users.push({
        id: uid('u'), role: 'admin', name: 'Administration', email: ADMIN_EMAIL, salt, iter: this.iter,
        hash: await hashPassword(ADMIN_PASSWORD, salt, this.iter), createdAt: +this.now(), favorites: [], prefs: {},
      });
    }
    _persistNow() { clearTimeout(this._saveTimer); this._saveTimer = null; try { return Promise.resolve(this.adapter.save(JSON.stringify(this.db))); } catch (e) { return Promise.resolve(); } }
    _changed() {
      this.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
      if (!this._saveTimer) this._saveTimer = setTimeout(() => this._persistNow(), 150);
    }
    flush() { return this._persistNow(); }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    async resetAll() { this.db = emptyDb(); await this._seedAdmin(); this._persistNow(); this._changed(); }

    /* ---- comptes */
    currentUser() { const id = this.db.session.userId; return id ? this.db.users.find((u) => u.id === id) || null : null; }
    getUser(id) { return this.db.users.find((u) => u.id === id) || null; }
    userByEmail(email) { const e = norm(email); return this.db.users.find((u) => norm(u.email) === e && u.email) || null; }
    async signup({ role, name, email, password }) {
      name = String(name || '').trim(); email = String(email || '').trim();
      if (!['client', 'truck'].includes(role)) fail('Type de compte inconnu.');
      if (!name) fail('Indiquez votre nom ou pseudo.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Adresse e-mail invalide.');
      { const pb = passwordProblem(password); if (pb) fail(pb); }
      if (this.userByEmail(email)) fail('Un compte existe déjà avec cette adresse e-mail.');
      const salt = uid('s');
      const user = {
        id: uid('u'), role, name, email, salt, iter: this.iter, hash: await hashPassword(password, salt, this.iter),
        createdAt: +this.now(), favorites: [], prefs: { radiusKm: 12, alertKm: 3, alertsEnabled: true, nativeNotifs: true },
        seenNotifAt: 0,
      };
      this.db.users.push(user);
      this.db.session.userId = user.id;
      this._changed();
      return user;
    }
    async login(email, password) {
      const u = this.userByEmail(email);
      const bad = () => fail('E-mail ou mot de passe incorrect.', 'auth');
      if (!u || !u.hash) bad();
      const h = await hashPassword(String(password || ''), u.salt, u.iter);
      if (h !== u.hash) bad();
      this.db.session.userId = u.id;
      this._changed();
      return u;
    }
    logout() { this.db.session.userId = null; this._changed(); }
    /** Mode « sans compte » : rien à faire en local (les données sont déjà sur l'appareil). */
    setGuest() {}
    updateUser(id, patch) {
      const u = this.getUser(id); if (!u) fail('Compte introuvable.');
      if (patch.name !== undefined) { const n = String(patch.name).trim(); if (!n) fail('Le nom ne peut pas être vide.'); u.name = n; }
      if (patch.prefs) u.prefs = Object.assign({}, u.prefs, patch.prefs);
      this._changed(); return u;
    }
    async changePassword(id, oldPwd, newPwd) {
      const u = this.getUser(id);
      if (await hashPassword(oldPwd, u.salt, u.iter) !== u.hash) fail('Mot de passe actuel incorrect.');
      { const pb = passwordProblem(newPwd); if (pb) fail(pb); }
      u.salt = uid('s'); u.iter = this.iter; u.hash = await hashPassword(newPwd, u.salt, u.iter);
      this._changed();
    }
    /* Suppression du compte en deux temps : la personne DEMANDE (compte masqué, annulable), l'administration VALIDE
       (données effacées, fiches dont il est propriétaire supprimées) ou REFUSE (le compte redevient actif). */
    requestDeletion(id) {
      const u = this.getUser(id); if (!u) return;
      if (u.role === 'admin') fail('Le compte administrateur ne peut pas être supprimé.');
      if (u.deletionRequestedAt) return;
      u.deletionRequestedAt = +this.now();
      this.db.trucks.forEach((t) => { if (t.ownerId === id && !t.hidden) { t.hidden = true; t.hiddenByDeletion = true; } });
      this._changed();
    }
    cancelDeletion(id) {
      const u = this.getUser(id); if (!u || !u.deletionRequestedAt) return;
      u.deletionRequestedAt = 0; this._restoreHidden(id); this._changed();
    }
    _restoreHidden(ownerId) { this.db.trucks.forEach((t) => { if (t.ownerId === ownerId && t.hiddenByDeletion) { t.hidden = false; t.hiddenByDeletion = false; } }); }
    billing() { return (this.db && this.db.billing) || { enabled: false }; }
    subscriptionOf(truckId) { return ((this.db && this.db.subscriptions) || {})[truckId] || null; }
    billingFor(truck) {
      const owner = truck && this.getUser(truck.ownerId);
      return billingView(this.billing(), this.subscriptionOf(truck && truck.id), owner && owner.role === 'admin' ? { ...truck, demo: true } : truck, +this.now());   // la fiche de l'administrateur est toujours couverte
    }
    async refreshBilling() { return false; }
    /* fiches provisoires : seulement avec la base en ligne (le magasin local n'en connaît aucune) */
    listingsNear() { return []; }
    getListing() { return null; }
    async fetchListing() { return null; }
    async claimListing() { return false; }
    async requestListingRemoval() { fail('Cette fonction demande la connexion au service en ligne.'); }
    listingRemovals() { return []; }
    async resolveListingRemoval() { return false; }
    /* adresses courtes et affiches : seulement avec la base en ligne */
    async resolveSlug() { return null; }
    posterSupported() { return false; }
    posterRequests() { return []; }
    async allListings() { return []; }
    async loadPosterRequests() { return false; }
    async requestPoster() { fail('Cette fonction demande la connexion au service en ligne.'); }
    async cancelPoster() { fail('Cette fonction demande la connexion au service en ligne.'); }
    posterAdmin() { return []; }
    async loadAdminPosters() { return false; }
    async setPosterStatus() { fail('Cette fonction demande la connexion au service en ligne.'); }
    deletionRequests() {
      return this.db.users.filter((u) => u.deletionRequestedAt).sort((a, b) => a.deletionRequestedAt - b.deletionRequestedAt).map((u) => ({
        id: u.id, name: u.name, role: u.role, email: u.email || '', requestedAt: u.deletionRequestedAt,
        trucks: this.db.trucks.filter((t) => t.ownerId === u.id).map((t) => t.name), reviews: this.db.reviews.filter((r) => r.userId === u.id).length,
      }));
    }
    decideDeletion(adminId, userId, action) {
      const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.');
      if (action !== 'approve' && action !== 'refuse') fail('Action inconnue.');
      const u = this.getUser(userId); if (!u || !u.deletionRequestedAt) fail('Aucune demande de suppression pour ce compte.');
      if (u.role === 'admin') fail('Le compte administrateur ne peut pas être supprimé.');
      if (action === 'refuse') {
        u.deletionRequestedAt = 0; this._restoreHidden(userId);
        this.db.notifications.push({ id: uid('n'), userId, truckId: null, type: 'message', text: 'Votre demande de suppression de compte a été annulée par l’administration : votre compte est de nouveau actif.', createdAt: +this.now(), read: false, key: null });
        this._changed(); return;
      }
      this._purgeUser(userId);
    }
    _purgeUser(id) {
      const u = this.getUser(id); if (!u) return;
      const db = this.db;
      const owned = db.trucks.filter((t) => t.ownerId === id).map((t) => t.id);
      owned.forEach((tid) => this._dropTruck(tid));
      db.trucks.forEach((t) => { t.team = (t.team || []).filter((x) => x !== id); });
      db.reviews = db.reviews.filter((r) => r.userId !== id);
      db.reports = db.reports.filter((r) => r.userId !== id);
      db.notifications = db.notifications.filter((n) => n.userId !== id);
      db.events = db.events.filter((e) => e.createdBy !== id);
      db.users = db.users.filter((x) => x.id !== id);
      if (db.session.userId === id) db.session.userId = null;
      this._changed();
    }
    _dropTruck(tid) {
      const db = this.db;
      db.trucks = db.trucks.filter((t) => t.id !== tid);
      db.reviews = db.reviews.filter((r) => r.truckId !== tid);
      db.reports = db.reports.filter((r) => !(r.targetType === 'truck' && r.targetId === tid));
      db.notifications = db.notifications.filter((n) => n.truckId !== tid);
      db.log = db.log.filter((l) => l.truckId !== tid);
      db.users.forEach((u) => { u.favorites = (u.favorites || []).filter((x) => x !== tid); });
      db.events.forEach((e) => { e.truckIds = (e.truckIds || []).filter((x) => x !== tid); });
    }

    /* ---- food trucks */
    getTruck(id) { return this.db.trucks.find((t) => t.id === id) || null; }
    managedTrucks(userId) { return this.db.trucks.filter((t) => t.ownerId === userId || (t.team || []).includes(userId)); }
    canManage(userId, truck) { const u = this.getUser(userId); return !!(u && truck && (u.role === 'admin' || truck.ownerId === userId || (truck.team || []).includes(userId))); }
    _mustManage(userId, truckId) { const t = this.getTruck(truckId); if (!t) fail('Food truck introuvable.'); if (!this.canManage(userId, t)) fail('Action réservée aux gérants de ce food truck.'); return t; }
    _cleanTruckFields(p, t) {
      if (p.name !== undefined) { const n = String(p.name).trim(); if (!n) fail('Le nom du food truck est obligatoire.'); if (n.length > 60) fail('Nom trop long (60 caractères maximum).'); t.name = n; }
      if (p.cuisines !== undefined) { t.cuisines = p.cuisines.filter((c) => CUISINES.includes(c)); if (!t.cuisines.length) fail('Choisissez au moins un type de cuisine.'); }
      if (p.bio !== undefined) { const b = String(p.bio).trim(); if (b.length > 280) fail('Présentation trop longue (280 caractères maximum).'); t.bio = b; }
      if (p.payments !== undefined) t.payments = p.payments.filter((c) => PAYMENTS.includes(c));
      if (p.phone !== undefined) t.phone = String(p.phone).trim().slice(0, 30);
      for (const k of ['instagram', 'facebook']) if (p[k] !== undefined) {
        const u = socialUrl(k, p[k]);
        if (u === null) fail(k === 'instagram' ? 'Adresse Instagram non reconnue : saisissez votre @pseudo ou le lien de votre profil Instagram.' : 'Adresse Facebook non reconnue : saisissez le lien de votre page Facebook (facebook.com/…).');
        t[k] = u;
      }
      if (p.logo !== undefined) t.logo = p.logo || null;
      if (p.color !== undefined) t.color = p.color;
    }
    createTruck(ownerId, p) {
      const owner = this.getUser(ownerId); if (!owner) fail('Compte introuvable.');
      const t = { id: uid('t'), ownerId, team: [], name: '', cuisines: [], bio: '', payments: [], phone: '', instagram: '', facebook: '', logo: null, color: null,
        verified: false, hidden: false, products: [], gallery: [], dish: null, planning: {}, weekly: {}, createdAt: +this.now() };
      this._cleanTruckFields(p, t);
      if (!t.name) fail('Le nom du food truck est obligatoire.');
      if (!t.cuisines.length) fail('Choisissez au moins un type de cuisine.');
      if (!t.color) t.color = AVATAR_COLORS[this.db.trucks.length % AVATAR_COLORS.length];
      this.db.trucks.push(t); this._changed(); return t;
    }
    updateTruck(actorId, truckId, patch) { const t = this._mustManage(actorId, truckId); this._cleanTruckFields(patch, t); this._changed(); return t; }
    addTeamMember(actorId, truckId, email) {
      const t = this._mustManage(actorId, truckId);
      if (t.ownerId !== actorId && this.getUser(actorId).role !== 'admin') fail('Seul le propriétaire peut gérer l’équipe.');
      const u = this.userByEmail(email);
      if (!u) fail('Aucun compte LocalTruck avec cette adresse. La personne doit d’abord créer son compte.');
      if (u.role === 'admin') fail('Ce compte ne peut pas rejoindre une équipe.');
      if (u.id === t.ownerId || t.team.includes(u.id)) fail('Cette personne gère déjà ce food truck.');
      t.team.push(u.id); this._changed(); return u;
    }
    removeTeamMember(actorId, truckId, memberId) {
      const t = this._mustManage(actorId, truckId);
      if (t.ownerId !== actorId && actorId !== memberId && this.getUser(actorId).role !== 'admin') fail('Seul le propriétaire peut retirer un membre.');
      t.team = t.team.filter((x) => x !== memberId); this._changed();
    }
    deleteTruck(actorId, truckId) { const t = this._mustManage(actorId, truckId); if (t.ownerId !== actorId && this.getUser(actorId).role !== 'admin') fail('Seul le propriétaire peut supprimer la fiche.'); this._dropTruck(truckId); this._changed(); }

    /* ---- carte / produits / galerie */
    upsertProduct(actorId, truckId, p) {
      const t = this._mustManage(actorId, truckId);
      const name = String(p.name || '').trim(); if (!name) fail('Le nom du produit est obligatoire.');
      const price = Number(String(p.price).replace(',', '.'));
      if (!isFinite(price) || price < 0 || price > 999) fail('Prix indicatif invalide.');
      let prod = p.id ? t.products.find((x) => x.id === p.id) : null;
      if (!prod) { prod = { id: uid('p'), available: true }; t.products.push(prod); }
      Object.assign(prod, { name, desc: String(p.desc || '').trim().slice(0, 120), price: Math.round(price * 100) / 100, veg: !!p.veg, allergens: (p.allergens || []).filter(Boolean) });
      this._changed(); return prod;
    }
    removeProduct(actorId, truckId, productId) {
      const t = this._mustManage(actorId, truckId);
      t.products = t.products.filter((p) => p.id !== productId);
      Object.values(t.planning).forEach((d) => (d.slots || []).forEach((s) => { s.products = (s.products || []).filter((x) => x !== productId); }));
      this._changed();
    }
    setProductAvailable(actorId, truckId, productId, available, notify) {
      const t = this._mustManage(actorId, truckId);
      const p = t.products.find((x) => x.id === productId); if (!p) fail('Produit introuvable.');
      const was = p.available; p.available = !!available;
      let n = 0;
      if (notify !== false && was && !available) n = this.notifyFollowers(t, 'stock', 'Plus de « ' + p.name + ' » chez ' + t.name + '.');
      this._changed(); return n;
    }
    addPhoto(actorId, truckId, dataUrl) {
      const t = this._mustManage(actorId, truckId);
      if (t.gallery.length >= MAX_PHOTOS) fail('Galerie pleine (' + MAX_PHOTOS + ' photos maximum).');
      if (!/^data:image\//.test(dataUrl)) fail('Image invalide.');
      t.gallery.push(dataUrl); this._changed();
    }
    removePhoto(actorId, truckId, idx) { const t = this._mustManage(actorId, truckId); t.gallery.splice(idx, 1); if (t.dish && t.dish.photo === idx) t.dish.photo = null; this._changed(); }
    setDish(actorId, truckId, dish) {
      const t = this._mustManage(actorId, truckId);
      if (!dish || !String(dish.name || '').trim()) { t.dish = null; }
      else t.dish = { name: String(dish.name).trim().slice(0, 60), desc: String(dish.desc || '').trim().slice(0, 120), price: dish.price === '' || dish.price == null ? null : Number(String(dish.price).replace(',', '.')), photo: dish.photo == null ? null : dish.photo, date: dateKey(this.now()) };
      this._changed();
    }
    dishOfDay(truck) { return truck.dish && truck.dish.date === dateKey(this.now()) ? truck.dish : null; }

    /* ---- planning */
    weekKeys(from) { const k = from || dateKey(this.now()); return Array.from({ length: 7 }, (_, i) => addDaysKey(k, i)); }
    getDay(truck, key) {
      const explicit = truck.planning[key];
      if (explicit) return Object.assign({ source: 'explicit' }, explicit);
      const w = truck.weekly && truck.weekly[weekdayOf(key)];
      if (w) return { source: 'weekly', rest: !!w.rest, note: w.note || '', slots: (w.slots || []).map((s) => Object.assign({}, clone(s), { id: s.id + '@' + key })) };
      return null;
    }
    _validateSlot(s) {
      if (!validHM(s.start) || !validHM(s.end)) fail('Horaires invalides.');
      if (s.start === s.end) fail('L’heure de fin doit être différente de l’heure de début.');
      const pl = s.place;
      if (!pl || !String(pl.name || pl.address || '').trim()) fail('Choisissez un lieu pour chaque créneau.');
      if (typeof pl.lat !== 'number' || typeof pl.lng !== 'number') fail('Choisissez un lieu sur la carte ou via une adresse.');
      if (!isInFrance(pl.lat, pl.lng)) fail('LocalTruck est disponible en France uniquement pour l’instant.');
    }
    setDay(actorId, truckId, key, day, opts) {
      const t = this._mustManage(actorId, truckId); opts = opts || {};
      if (key < dateKey(this.now())) fail('Impossible de modifier un jour passé.');
      if (key > addDaysKey(dateKey(this.now()), 6)) fail('Le planning couvre les 7 prochains jours.');
      const rest = !!day.rest;
      const slots = rest ? [] : (day.slots || []).map((s) => ({
        id: (s.id && !String(s.id).includes('@')) ? s.id : uid('sl'), start: s.start, end: s.end,
        place: { name: String(s.place && s.place.name || '').trim(), address: String(s.place && s.place.address || '').trim(), lat: s.place && s.place.lat, lng: s.place && s.place.lng },
        products: (s.products || []).filter((pid) => t.products.some((p) => p.id === pid)), note: String(s.note || '').trim().slice(0, 140),
        cancelled: !!s.cancelled, live: !!s.live, endedAt: s.endedAt || undefined, delayMin: s.delayMin || undefined, moved: s.moved || undefined,
      }));
      if (!rest && !slots.length) fail('Ajoutez au moins un créneau, ou marquez ce jour comme repos.');
      if (slots.length > MAX_SLOTS_PER_DAY) fail('Quatre créneaux maximum par jour.');
      slots.forEach((s) => this._validateSlot(s));
      const iv = slots.map((s) => slotInterval(key, s)).sort((a, b) => a.start - b.start);
      for (let i = 1; i < iv.length; i++) if (iv[i].start < iv[i - 1].end) fail('Deux créneaux de la même journée se chevauchent.');
      const entry = { rest, slots, note: String(day.note || '').trim().slice(0, 200) };
      t.planning[key] = entry;
      if (opts.repeat === true) t.weekly[weekdayOf(key)] = clone({ rest, slots, note: entry.note });
      else if (opts.repeat === false) delete t.weekly[weekdayOf(key)];
      let notified = 0;
      if (opts.notify) {
        const label = rest ? 'sera en repos' : 'sera à ' + slots.map((s) => s.place.name || s.place.address).join(' puis ') + ' (' + slots.map(fmtHours).join(', ') + ')';
        notified = this.notifyFollowers(t, 'planning', t.name + ' ' + label + ' ' + this.relDay(key) + '.');
      }
      this._changed(); return { day: entry, notified };
    }
    clearDay(actorId, truckId, key) { const t = this._mustManage(actorId, truckId); delete t.planning[key]; this._changed(); }
    duplicateDay(actorId, truckId, fromKey, toKeys) {
      const t = this._mustManage(actorId, truckId);
      const src = this.getDay(t, fromKey); if (!src) fail('Le jour à copier n’est pas planifié.');
      toKeys.filter((k) => k !== fromKey).forEach((k) => {
        t.planning[k] = { rest: src.rest, note: src.note || '', slots: src.slots.map((s) => Object.assign(clone(s), { id: uid('sl'), cancelled: false, live: false, endedAt: undefined, delayMin: undefined, moved: undefined })) };
      });
      this._changed();
    }
    relDay(key) {
      const today = dateKey(this.now());
      if (key === today) return 'aujourd’hui';
      if (key === addDaysKey(today, 1)) return 'demain';
      return 'le ' + fmtDayLong(key).toLowerCase();
    }
    /* Alerte « autre food truck à proximité » au moment de choisir un emplacement. */
    nearbySlots(truckId, key, start, end, lat, lng, radiusM) {
      radiusM = radiusM || NEARBY_WARN_M;
      const probe = slotInterval(key, { start, end });
      const out = [];
      this.db.trucks.forEach((t) => {
        if (t.id === truckId || t.hidden) return;
        const d = this.getDay(t, key); if (!d || d.rest) return;
        d.slots.forEach((s) => {
          if (s.cancelled || typeof s.place.lat !== 'number') return;
          const iv = slotInterval(key, s);
          if (iv.start >= probe.end || iv.end <= probe.start) return;
          const m = haversine(lat, lng, s.place.lat, s.place.lng) * 1000;
          if (m <= radiusM) out.push({ truck: t, slot: s, meters: Math.round(m) });
        });
      });
      return out.sort((a, b) => a.meters - b.meters);
    }

    /* ---- actions en direct */
    _todaySlots(t) {
      const today = dateKey(this.now()), yest = addDaysKey(today, -1);
      const out = [];
      [yest, today].forEach((k) => { const d = t.planning[k] || (k === today ? this.getDay(t, k) : null); if (d && !d.rest) d.slots.forEach((s) => out.push({ key: k, slot: s })); });
      return out;
    }
    _ensureToday(t) {
      const key = dateKey(this.now());
      if (!t.planning[key]) { const d = this.getDay(t, key); t.planning[key] = d ? { rest: d.rest, note: d.note || '', slots: d.slots.map((s) => Object.assign(clone(s), { id: uid('sl') })) } : { rest: false, slots: [], note: '' }; }
      if (t.planning[key].rest) { t.planning[key].rest = false; }
      return t.planning[key];
    }
    currentSlot(t) {
      const now = this.now();
      return this._todaySlots(t).find(({ key, slot }) => slotStatus(slot, key, now) === 'open') || null;
    }
    goLive(actorId, truckId, { place, endTime, notify }) {
      const t = this._mustManage(actorId, truckId); const now = this.now();
      if (!place || typeof place.lat !== 'number') fail('Choisissez où vous êtes (adresse ou position sur la carte).');
      if (!isInFrance(place.lat, place.lng)) fail('LocalTruck est disponible en France uniquement pour l’instant.');
      const today = this._ensureToday(t);
      const end = endTime && validHM(endTime) ? endTime : addMinutesHM(hm(now), 180);
      const open = this.currentSlot(t);
      const soonSlot = open ? null : this._todaySlots(t).find(({ key, slot: sl }) => key === dateKey(now) && slotStatus(sl, key, now) === 'soon');
      let slot;
      if (open) { slot = open.slot; const real = t.planning[open.key].slots.find((s) => s.id === slot.id) || slot; slot = real; }
      else if (soonSlot) {          // on arrive en avance : le créneau prévu commence maintenant, au lieu d'en créer un second
        slot = t.planning[soonSlot.key].slots.find((s) => s.id === soonSlot.slot.id) || soonSlot.slot;
        slot.start = hm(now); if (!(endTime && validHM(endTime))) slot.end = slot.end;
      } else {
        slot = { id: uid('sl'), start: hm(now), end, place: {}, products: [], note: '', cancelled: false, adhoc: true };
        today.slots.push(slot);
      }
      slot.place = { name: place.name || place.address || 'Ici', address: place.address || '', lat: place.lat, lng: place.lng };
      slot.live = true; slot.end = (soonSlot && !(endTime && validHM(endTime))) ? slot.end : end; slot.cancelled = false; slot.endedAt = undefined;
      if (slot.start === slot.end) slot.end = addMinutesHM(slot.end, 1);
      let n = 0;
      if (notify !== false) n = this.notifyFollowers(t, 'live', t.name + ' est en service à ' + slot.place.name + ' jusqu’à ' + fmtHM(slot.end) + '.');
      this._changed(); return { slot, notified: n };
    }
    moveLive(actorId, truckId, place, notify) {
      const t = this._mustManage(actorId, truckId);
      if (!place || typeof place.lat !== 'number') fail('Choisissez le nouvel endroit.');
      if (!isInFrance(place.lat, place.lng)) fail('LocalTruck est disponible en France uniquement pour l’instant.');
      const cur = this.currentSlot(t); if (!cur) fail('Vous n’êtes pas en service en ce moment.');
      const slot = t.planning[cur.key].slots.find((s) => s.id === cur.slot.id) || cur.slot;
      slot.place = { name: place.name || place.address || 'Ici', address: place.address || '', lat: place.lat, lng: place.lng };
      slot.moved = true;
      let n = 0;
      if (notify !== false) n = this.notifyFollowers(t, 'moved', t.name + ' a changé d’endroit : désormais à ' + slot.place.name + '.');
      this._changed(); return { slot, notified: n };
    }
    delayService(actorId, truckId, minutes, notify) {
      const t = this._mustManage(actorId, truckId); const now = this.now();
      const cand = this._todaySlots(t).filter(({ key, slot }) => ['soon', 'later'].includes(slotStatus(slot, key, now))).sort((a, b) => slotInterval(a.key, a.slot).start - slotInterval(b.key, b.slot).start)[0];
      if (!cand) fail('Aucun créneau à venir aujourd’hui à décaler.');
      const slot = t.planning[cand.key].slots.find((s) => s.id === cand.slot.id) || cand.slot;
      slot.start = addMinutesHM(slot.start, minutes); slot.end = addMinutesHM(slot.end, minutes);
      slot.delayMin = (slot.delayMin || 0) + minutes;
      let n = 0;
      if (notify !== false) n = this.notifyFollowers(t, 'delay', t.name + ' a du retard (+' + minutes + ' min) : ouverture à ' + fmtHM(slot.start) + ' à ' + slot.place.name + '.');
      this._changed(); return { slot, notified: n };
    }
    endService(actorId, truckId) {
      const t = this._mustManage(actorId, truckId);
      const cur = this.currentSlot(t); if (!cur) fail('Vous n’êtes pas en service en ce moment.');
      const day = t.planning[cur.key]; const slot = day.slots.find((s) => s.id === cur.slot.id) || cur.slot;
      if (slot.adhoc && +this.now() - slotInterval(cur.key, slot).start < 120000) { day.slots = day.slots.filter((s) => s.id !== slot.id); this._changed(); return slot; }   // service de quelques secondes : on n'en garde pas de trace
      slot.endedAt = +this.now(); slot.live = false; slot.end = hm(this.now());
      this._changed(); return slot;
    }
    /* « Fermé ce soir (météo) » en un tap. */
    cancelTonight(actorId, truckId, reason, notify) {
      const t = this._mustManage(actorId, truckId); const now = this.now();
      let count = 0;
      this._todaySlots(t).forEach(({ key, slot }) => {
        if (['open', 'soon', 'later'].includes(slotStatus(slot, key, now))) {
          if (!t.planning[key]) this._ensureToday(t);
          const real = t.planning[key].slots.find((s) => s.id === slot.id) || slot;
          real.cancelled = true; real.cancelReason = reason || ''; real.live = false; count++;
        }
      });
      if (!count) fail('Rien à annuler aujourd’hui : aucun créneau en cours ou à venir.');
      let n = 0;
      if (notify !== false) n = this.notifyFollowers(t, 'cancel', t.name + ' est fermé ce soir' + (reason ? ' (' + reason + ')' : '') + '.');
      this._changed(); return { cancelled: count, notified: n };
    }
    restoreTonight(actorId, truckId) {
      const t = this._mustManage(actorId, truckId); const today = dateKey(this.now());
      const d = t.planning[today]; if (!d) return 0; let c = 0;
      d.slots.forEach((s) => { if (s.cancelled) { s.cancelled = false; s.cancelReason = ''; c++; } });
      this._changed(); return c;
    }

    /* ---- lecture / recherche */
    isSuspect(truckId) { return this.reportCount(truckId) > SUSPECT_THRESHOLD; }
    reportCount(truckId) {
      return new Set(this.db.reports.filter((r) => r.targetType === 'truck' && r.targetId === truckId && !r.resolved).map((r) => r.userId)).size;
    }
    rating(truckId) {
      const rs = this.db.reviews.filter((r) => r.truckId === truckId);
      if (!rs.length) return { avg: 0, count: 0 };
      return { avg: rs.reduce((a, r) => a + r.rating, 0) / rs.length, count: rs.length };
    }
    followerIds(truckId) { return this.db.users.filter((u) => (u.favorites || []).includes(truckId)).map((u) => u.id); }
    followerCount(truckId) { return this.followerIds(truckId).length; }

    /** Créneaux du food truck correspondant à un « moment ». */
    matchSlots(t, moment, key) {
      const now = this.now(); const today = dateKey(now), yest = addDaysKey(today, -1), tomorrow = addDaysKey(today, 1);
      const out = [];
      const add = (k, filter) => { const d = this.getDay(t, k); if (!d || d.rest) return; d.slots.forEach((s) => { const st = slotStatus(s, k, now); if (filter(st, s)) out.push({ key: k, slot: s, status: st }); }); };
      if (moment === 'now') { add(yest, (s) => s === 'open'); add(today, (s) => s === 'open'); }
      else if (moment === 'tonight') { add(yest, (s) => s === 'open'); add(today, (s) => ['open', 'soon', 'later'].includes(s)); }
      else if (moment === 'tomorrow') add(tomorrow, (s) => s !== 'cancelled');
      else if (moment === 'noon') {      // « Ce midi » : les créneaux qui chevauchent le déjeuner (11h–15h) d'aujourd'hui, ou de demain une fois 15h passées
        const k = lunchKey(now); const [ls, le] = lunchWindow(k);
        add(k, (st, sl) => (k === today ? ['open', 'soon', 'later'].includes(st) : st !== 'cancelled') && slotInterval(k, sl).start < le && slotInterval(k, sl).end > ls);
      }
      else if (moment === 'date') add(key, (s) => key === today ? ['open', 'soon', 'later'].includes(s) : s !== 'cancelled');
      else if (moment === 'any') this.weekKeys().forEach((k) => add(k, (s) => ['open', 'soon', 'later'].includes(s) || k !== today && s !== 'cancelled'));
      const rank = { open: 0, soon: 1, later: 2, done: 3, cancelled: 4 };
      return out.sort((a, b) => rank[a.status] - rank[b.status] || slotInterval(a.key, a.slot).start - slotInterval(b.key, b.slot).start);
    }
    /** Résumé d'un food truck pour l'affichage (créneau en cours ou prochain, sur 7 jours). */
    summary(t) {
      const now = this.now(); const today = dateKey(now);
      let cur = null, cancelled = null;
      for (const k of [addDaysKey(today, -1), ...this.weekKeys()]) {
        const d = this.getDay(t, k); if (!d || d.rest) continue;
        for (const s of d.slots) {
          const st = slotStatus(s, k, now);
          if (st === 'cancelled') { if (k === today && !cancelled && slotInterval(k, s).end > +now) cancelled = { key: k, slot: s, status: 'cancelled' }; continue; }
          if (!['open', 'soon', 'later'].includes(st)) continue;
          const better = !cur || rank3(st) < rank3(cur.status) || (rank3(st) === rank3(cur.status) && slotInterval(k, s).start < slotInterval(cur.key, cur.slot).start);
          if (better) cur = { key: k, slot: s, status: st };
        }
      }
      // un créneau annulé aujourd'hui l'emporte sur un créneau seulement « plus tard »
      if (cancelled && (!cur || cur.status === 'later' || cur.key !== today)) return cancelled;
      return cur;
    }
    queryTrucks(q) {
      q = Object.assign({ moment: 'tonight', radiusKm: 12, cuisine: 'Tout', text: '', center: null, veg: false, includeHidden: false }, q || {});
      const text = norm(q.text); const out = [];
      this.db.trucks.forEach((t) => {
        if (t.hidden && !q.includeHidden) return;
        if (q.cuisine && q.cuisine !== 'Tout' && !t.cuisines.includes(q.cuisine)) return;
        if (q.veg && !(t.cuisines.includes('Végé') || t.products.some((p) => p.veg))) return;
        const matches = this.matchSlots(t, q.moment, q.dateKey);
        if (!matches.length) return;
        if (text) {
          const hay = norm([t.name, t.cuisines.join(' '), t.bio, t.products.map((p) => p.name + ' ' + p.desc).join(' '), matches.map((m) => m.slot.place.name + ' ' + m.slot.place.address).join(' ')].join(' '));
          if (!text.split(/\s+/).every((w) => hay.includes(w))) return;
        }
        let best = matches[0], dist = null;
        if (q.center) {
          matches.forEach((m) => { m.dist = haversine(q.center.lat, q.center.lng, m.slot.place.lat, m.slot.place.lng); });
          const inRange = matches.filter((m) => m.dist <= q.radiusKm);
          if (!inRange.length) return;
          best = inRange[0]; dist = best.dist;
        }
        out.push({ truck: t, key: best.key, slot: best.slot, status: best.status, dist, suspect: this.isSuspect(t.id) });
      });
      const rank = { open: 0, soon: 1, later: 2 };
      return out.sort((a, b) => (rank[a.status] - rank[b.status]) || ((a.dist ?? 0) - (b.dist ?? 0)) || a.truck.name.localeCompare(b.truck.name, 'fr'));
    }
    /** Points « emplacements de la semaine » pour la mini-carte de la fiche. */
    weekPlaces(t) {
      const now = this.now(); const pts = [];
      this.weekKeys().forEach((k) => { const d = this.getDay(t, k); if (!d || d.rest) return; d.slots.forEach((s) => { if (!s.cancelled && slotStatus(s, k, now) !== 'done') pts.push({ key: k, slot: s }); }); });
      return pts;
    }

    /* ---- audience : compteurs anonymes (inutiles hors ligne) et zone « Prévenez-moi » */
    trackFunnel() { /* mode local : rien n'est envoyé nulle part */ }
    audience() { return null; }
    myZone() { const u = this.currentUser(); return u && u.zone ? Object.assign({}, u.zone) : null; }
    setZone(userId, z) {
      const u = this.getUser(userId); if (!u) fail('Compte introuvable.');
      if (!z || !isInFrance(z.lat, z.lng)) fail('LocalTruck est disponible en France uniquement pour l’instant.');
      u.zone = { lat: Math.round(z.lat * 100) / 100, lng: Math.round(z.lng * 100) / 100, radiusKm: clamp(Math.round(z.radiusKm || 2), 1, 10), label: String(z.label || '').trim().slice(0, 60) };
      this._changed(); return Object.assign({}, u.zone);
    }
    clearZone(userId) { const u = this.getUser(userId); if (u) { delete u.zone; this._changed(); } }

    /* ---- favoris, notifications */
    toggleFollow(userId, truckId) {
      const u = this.getUser(userId); const t = this.getTruck(truckId); if (!u || !t) fail('Action impossible.');
      u.favorites = u.favorites || [];
      const i = u.favorites.indexOf(truckId);
      if (i >= 0) { u.favorites.splice(i, 1); this.track(truckId, 'unfollow'); } else { u.favorites.push(truckId); this.track(truckId, 'follow'); }
      this._changed(); return i < 0;
    }
    isFollowing(userId, truckId) { const u = this.getUser(userId); return !!(u && (u.favorites || []).includes(truckId)); }
    notifyFollowers(truck, type, text, key) {
      let n = 0; const ts = +this.now();
      this.followerIds(truck.id).forEach((uid_) => {
        const u = this.getUser(uid_);
        if (u.prefs && u.prefs.alertsEnabled === false) return;
        if (key && this.db.notifications.some((x) => x.userId === uid_ && x.key === key)) return;
        this.db.notifications.push({ id: uid('n'), userId: uid_, truckId: truck.id, type, text, createdAt: ts, read: false, key: key || null });
        n++;
      });
      return n;
    }
    manualNotify(actorId, truckId, text) {
      const t = this._mustManage(actorId, truckId);
      text = String(text || '').trim(); if (!text) fail('Écrivez un court message pour vos abonnés.');
      const n = this.notifyFollowers(t, 'message', t.name + ' : ' + text.slice(0, 140));
      this._changed(); return n;
    }
    notificationsOf(userId) { return this.db.notifications.map((n, i) => [n, i]).filter(([n]) => n.userId === userId).sort((a, b) => b[0].createdAt - a[0].createdAt || b[1] - a[1]).map(([n]) => n); }
    unreadCount(userId) { return this.db.notifications.filter((n) => n.userId === userId && !n.read).length; }
    markAllRead(userId) { this.db.notifications.forEach((n) => { if (n.userId === userId) n.read = true; }); this._changed(); }
    /** Alertes de proximité : un favori s'installe à moins de X km de la position (jamais enregistrée). */
    proximityAlerts(userId, pos) {
      const u = this.getUser(userId); if (!u || !pos || u.prefs.alertsEnabled === false) return [];
      const maxKm = u.prefs.alertKm || 3; const created = []; const now = this.now();
      (u.favorites || []).forEach((tid) => {
        const t = this.getTruck(tid); if (!t || t.hidden) return;
        const m = this.matchSlots(t, 'tonight').find((x) => ['open', 'soon'].includes(x.status)); if (!m) return;
        const d = haversine(pos.lat, pos.lng, m.slot.place.lat, m.slot.place.lng);
        if (d > maxKm) return;
        const key = 'prox:' + u.id + ':' + m.slot.id + ':' + m.key;
        if (this.db.notifications.some((n) => n.key === key)) return;
        const n = { id: uid('n'), userId: u.id, truckId: t.id, type: 'proximity', createdAt: +now, read: false, key,
          text: t.name + ' s’installe à ' + fmtDist(d) + ' de vous : ' + m.slot.place.name + ', ' + fmtHours(m.slot) + '.' };
        this.db.notifications.push(n); created.push(n);
      });
      if (created.length) this._changed();
      return created;
    }

    /* ---- avis */
    reviewsOf(truckId) {
      const me = this.getUser(this.db.session.userId); const seeAll = !!(me && me.role === 'admin');
      return this.db.reviews.filter((r) => r.truckId === truckId && (seeAll || (me && r.userId === me.id) || !(this.getUser(r.userId) || {}).deletionRequestedAt)).sort((a, b) => b.createdAt - a.createdAt);
    }
    addReview(userId, truckId, rating, text) {
      const u = this.getUser(userId); const t = this.getTruck(truckId); if (!u || !t) fail('Action impossible.');
      if (this.canManage(userId, t)) fail('Vous ne pouvez pas noter votre propre food truck.');
      rating = Math.round(Number(rating)); if (!(rating >= 1 && rating <= 5)) fail('Choisissez une note de 1 à 5 étoiles.');
      text = String(text || '').trim(); if (text.length > 300) fail('Avis trop long (300 caractères maximum).');
      const n = ' ' + norm(text).replace(/[^a-z0-9 ]/g, ' ') + ' ';
      if (BAD_WORDS.some((w) => n.includes(' ' + norm(w).trim() + ' '))) fail('Votre avis contient des termes interdits. Merci de rester courtois.');
      let r = this.db.reviews.find((x) => x.userId === userId && x.truckId === truckId);
      if (r) { r.rating = rating; r.text = text; r.editedAt = +this.now(); }
      else { r = { id: uid('r'), truckId, userId, userName: u.name, rating, text, createdAt: +this.now(), reply: null }; this.db.reviews.push(r); }
      this._changed(); return r;
    }
    replyReview(actorId, reviewId, text) {
      const r = this.db.reviews.find((x) => x.id === reviewId); if (!r) fail('Avis introuvable.');
      this._mustManage(actorId, r.truckId);
      text = String(text || '').trim(); r.reply = text ? { text: text.slice(0, 300), at: +this.now() } : null; this._changed();
    }
    deleteReview(actorId, reviewId) {
      const r = this.db.reviews.find((x) => x.id === reviewId); if (!r) return;
      const a = this.getUser(actorId);
      if (!(a && (a.role === 'admin' || r.userId === actorId))) fail('Action non autorisée.');
      this.db.reviews = this.db.reviews.filter((x) => x.id !== reviewId);
      this.db.reports = this.db.reports.filter((x) => !(x.targetType === 'review' && x.targetId === reviewId));
      this._changed();
    }

    /* ---- signalements et modération */
    report(userId, { targetType, targetId, reason, comment }) {
      const u = this.getUser(userId); if (!u) fail('Connectez-vous pour signaler.');
      if (!['truck', 'review', 'event'].includes(targetType)) fail('Cible inconnue.');
      if (!REPORT_REASONS.some((r) => r.id === reason)) fail('Choisissez un motif.');
      if (targetType === 'truck') { const t = this.getTruck(targetId); if (!t) fail('Food truck introuvable.'); if (this.canManage(userId, t)) fail('Vous ne pouvez pas signaler votre propre fiche.'); }
      if (this.db.reports.some((r) => r.userId === userId && r.targetType === targetType && r.targetId === targetId && !r.resolved)) fail('Vous avez déjà signalé ceci. Merci, nous allons regarder.');
      this.db.reports.push({ id: uid('rp'), userId, userName: u.name, targetType, targetId, reason, comment: String(comment || '').trim().slice(0, 300), createdAt: +this.now(), resolved: false });
      this._changed();
      return targetType === 'truck' ? { count: this.reportCount(targetId), suspect: this.isSuspect(targetId) } : {};
    }
    openReports() { return this.db.reports.filter((r) => !r.resolved).sort((a, b) => b.createdAt - a.createdAt); }
    resolveReports(adminId, targetType, targetId, action) {
      const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.');
      this.db.reports.forEach((r) => { if (r.targetType === targetType && r.targetId === targetId && !r.resolved) r.resolved = true; });
      if (action === 'hide' && targetType === 'truck') { const t = this.getTruck(targetId); if (t) t.hidden = true; }
      if (action === 'delete' && targetType === 'review') {
        const rv = this.db.reviews.find((x) => x.id === targetId); const tr = rv && this.getTruck(rv.truckId);
        this.deleteReview(adminId, targetId);
        if (rv) this.db.notifications.push({ id: uid('n'), userId: rv.userId, truckId: rv.truckId, type: 'message', text: reviewRemovedText(tr && tr.name), createdAt: +this.now(), read: false, key: 'review-removed:' + rv.id });
      }
      if (action === 'delete' && targetType === 'event') this.deleteEvent(adminId, targetId);
      this._changed();
    }
    setHidden(adminId, truckId, hidden) {
      const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.');
      const t = this.getTruck(truckId);
      if (!hidden && t.hiddenByDeletion) fail('Le propriétaire a demandé la suppression de son compte : validez ou refusez la demande avant de réafficher la fiche.');
      t.hidden = !!hidden; this._changed();
    }
    setVerified(adminId, truckId, v) { const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.'); this.getTruck(truckId).verified = !!v; this._changed(); }

    /* ---- événements */
    createEvent(actorId, p) {
      const u = this.getUser(actorId); if (!u) fail('Connectez-vous.');
      if (!(u.role === 'admin' || this.managedTrucks(actorId).length)) fail('Seuls les food trucks peuvent créer un événement.');
      const name = String(p.name || '').trim(); if (!name) fail('Donnez un nom à l’événement.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) fail('Date invalide.');
      if (p.date < dateKey(this.now())) fail('La date est passée.');
      if (!validHM(p.start) || !validHM(p.end)) fail('Horaires invalides.');
      const pl = p.place; if (!pl || typeof pl.lat !== 'number') fail('Choisissez le lieu de l’événement.');
      if (!isInFrance(pl.lat, pl.lng)) fail('LocalTruck est disponible en France uniquement pour l’instant.');
      const ev = { id: uid('e'), name: name.slice(0, 80), date: p.date, start: p.start, end: p.end, description: String(p.description || '').trim().slice(0, 400),
        place: { name: pl.name || pl.address, address: pl.address || '', lat: pl.lat, lng: pl.lng }, createdBy: actorId, truckIds: [], createdAt: +this.now() };
      this.db.events.push(ev);
      const mine = this.managedTrucks(actorId)[0]; if (mine) ev.truckIds.push(mine.id);
      this._changed(); return ev;
    }
    deleteEvent(actorId, eventId) {
      const e = this.db.events.find((x) => x.id === eventId); if (!e) return; const a = this.getUser(actorId);
      if (!(a && (a.role === 'admin' || e.createdBy === actorId))) fail('Action non autorisée.');
      this.db.events = this.db.events.filter((x) => x.id !== eventId);
      this.db.reports = this.db.reports.filter((x) => !(x.targetType === 'event' && x.targetId === eventId));
      this._changed();
    }
    toggleEventTruck(actorId, eventId, truckId) {
      const e = this.db.events.find((x) => x.id === eventId); if (!e) fail('Événement introuvable.');
      this._mustManage(actorId, truckId);
      const i = e.truckIds.indexOf(truckId);
      if (i >= 0) e.truckIds.splice(i, 1); else e.truckIds.push(truckId);
      this._changed(); return i < 0;
    }
    upcomingEvents() {
      const today = dateKey(this.now());
      return this.db.events.filter((e) => e.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    }

    /* ---- statistiques (vues, itinéraires, abonnés, meilleurs emplacements) */
    track(truckId, type, extra) {
      const t = this.getTruck(truckId); if (!t) return;
      const me = this.currentUser();
      if (me && this.canManage(me.id, t) && type !== 'follow' && type !== 'unfollow') return; // pas de stats sur ses propres consultations
      const now = this.now();
      let place = null; const cur = this.summary(t);
      if (cur && ['open', 'soon'].includes(cur.status)) place = cur.slot.place.name;
      this.db.log.push(Object.assign({ t: +now, day: dateKey(now), type, truckId, place }, extra || {}));
      if (this.db.log.length > 6000) this.db.log.splice(0, this.db.log.length - 6000);
      this._changed();
    }
    statsFor(truckId) {
      const now = this.now(); const keys = Array.from({ length: 7 }, (_, i) => addDaysKey(dateKey(now), i - 6));
      const logs = this.db.log.filter((l) => l.truckId === truckId && keys.includes(l.day));
      const count = (type) => logs.filter((l) => l.type === type).length;
      const perDay = keys.map((k) => ({ key: k, views: logs.filter((l) => l.day === k && l.type === 'view').length, routes: logs.filter((l) => l.day === k && l.type === 'route').length }));
      const places = {};
      logs.filter((l) => (l.type === 'view' || l.type === 'route') && l.place).forEach((l) => { places[l.place] = (places[l.place] || 0) + (l.type === 'route' ? 3 : 1); });
      const topPlaces = Object.entries(places).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 4);
      return { views: count('view'), routes: count('route'), shares: count('share'), followers: this.followerCount(truckId), newFollowers: count('follow') - count('unfollow'), perDay, topPlaces };
    }

    /* ---- jeu de données de démonstration (autour d'un point) */
    seedDemo(center, opts) {
      opts = opts || {};
      this.removeDemo();
      const now = this.now(); const today = dateKey(now);
      const owners = []; const fans = [];
      for (let i = 0; i < 6; i++) fans.push({ id: uid('u'), role: 'client', name: ['Camille', 'Yanis', 'Inès', 'Hugo', 'Léa', 'Malik'][i], email: '', demo: true, favorites: [], prefs: {}, createdAt: +now });
      const defs = [
        ['Burger Atelier', ['Burgers'], 'Des burgers smash préparés minute, bœuf de producteurs locaux, pain brioché artisanal. Sauces maison, option végétarienne.', [['Smash classique', 9.5, 0, 'Bœuf, cheddar, oignons, pickles'], ['Double cheese', 12, 0, 'Double steak, sauce maison'], ['Burger végé', 10, 1, 'Galette de pois chiches, avocat'], ['Frites maison', 4, 1, 'Pommes de terre locales']]],
        ['Crêp’Errante', ['Crêpes', 'Desserts'], 'Crêpes et galettes bretonnes au beurre salé, farine de blé noir bio.', [['Complète', 8, 0, 'Jambon, œuf, emmental'], ['Beurre-sucre', 3.5, 1, 'La classique'], ['Caramel beurre salé', 5, 1, 'Maison']]],
        ['Tacos Volcan', ['Tacos'], 'Tacos français XXL, sauces piquantes maison.', [['Tacos poulet', 8.5, 0, 'Poulet mariné, frites, sauce fromagère'], ['Tacos végé', 8, 1, 'Falafels, crudités']]],
        ['Fiamma Pizza', ['Pizza'], 'Pizzas au feu de bois, pâte maturée 48 h.', [['Margherita', 10, 1, 'Tomate, mozzarella, basilic'], ['Reine', 12, 0, 'Jambon, champignons'], ['Calzone', 12.5, 0, 'Jambon, ricotta']]],
        ['Bao Bao', ['Asiatique'], 'Petits pains vapeur et street food asiatique.', [['Bao porc laqué', 6.5, 0, 'Pickles, coriandre'], ['Bao tofu', 6, 1, 'Sauce hoisin'], ['Nems (x4)', 5, 0, '']]],
        ['Green Wheels', ['Végé', 'Boissons'], '100 % végétal, bowls et jus pressés.', [['Bowl du jour', 11, 1, 'Légumes de saison'], ['Jus pressé', 4.5, 1, 'Orange, pomme ou carotte']]],
        ['Le Camion à Gaufres', ['Desserts'], 'Gaufres de Liège, chantilly maison.', [['Gaufre nature', 3, 1, ''], ['Gaufre chocolat', 4.5, 1, 'Chocolat noir fondu']]],
        ['Smoky Joe BBQ', ['Burgers'], 'Pulled pork et ribs fumés 12 h.', [['Pulled pork burger', 11, 0, 'Sauce BBQ, coleslaw'], ['Ribs (demi)', 14, 0, '']]],
        ['Mama Taco', ['Tacos', 'Boissons'], 'Cuisine mexicaine, guacamole maison.', [['Burrito', 9, 0, 'Bœuf épicé'], ['Quesadilla', 8, 1, 'Fromage, poivrons'], ['Limonade maison', 3.5, 1, '']]],
        ['Pizza Express 77', ['Pizza'], 'Pizzas à emporter, cuites en 90 secondes.', [['4 fromages', 11, 1, ''], ['Chorizo', 12, 0, '']]],
        ['Wok & Roll', ['Asiatique'], 'Nouilles sautées minute.', [['Nouilles poulet', 9.5, 0, ''], ['Nouilles légumes', 8.5, 1, '']]],
        ['Chez Mystère', ['Burgers'], 'Le meilleur burger de la ville (selon lui).', [['Burger mystère', 7, 0, '']]],
      ];
      const hmAt = (offsetMin) => { const d = new Date(+now + offsetMin * 60000); return hm(d); };
      const spots = ['Place de la Mairie', 'Quai du Port', 'Parc des Expositions', 'Stade municipal', 'Gare', 'Marché couvert', 'Place du Marché', 'Campus', 'Esplanade', 'Rue Piétonne', 'Zone d’activités', 'Parvis de la cathédrale'];
      const dest = (dKm, bearing) => { const r = 6371, br = bearing * Math.PI / 180, la1 = center.lat * Math.PI / 180, lo1 = center.lng * Math.PI / 180, dd = dKm / r; const la2 = Math.asin(Math.sin(la1) * Math.cos(dd) + Math.cos(la1) * Math.sin(dd) * Math.cos(br)); const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(dd) * Math.cos(la1), Math.cos(dd) - Math.sin(la1) * Math.sin(la2)); return { lat: la2 * 180 / Math.PI, lng: lo2 * 180 / Math.PI }; };
      defs.forEach((def, i) => {
        const owner = { id: uid('u'), role: 'truck', name: def[0], email: '', demo: true, favorites: [], prefs: {}, createdAt: +now }; owners.push(owner);
        const t = { id: uid('t'), ownerId: owner.id, team: [], name: def[0], cuisines: def[1], bio: def[2], payments: ['Carte bancaire', 'Espèces', 'Sans contact'], phone: '', instagram: '', facebook: '', logo: null, color: AVATAR_COLORS[i % AVATAR_COLORS.length],
          verified: i === 0, hidden: false, demo: true, products: [], gallery: [], dish: null, planning: {}, weekly: {}, createdAt: +now - i * 86400e3 };
        def[3].forEach((p) => t.products.push({ id: uid('p'), name: p[0], price: p[1], veg: !!p[2], desc: p[3], allergens: [], available: true }));
        if (i === 0) t.products[3].available = false;
        if (i === 1) t.dish = { name: 'Galette saucisse', desc: 'Le grand classique du marché', price: 5.5, photo: null, date: today };
        this.db.trucks.push(t);
        const keys = this.weekKeys();
        keys.forEach((k, di) => {
          if ((i + di) % 7 === 3) { t.planning[k] = { rest: true, slots: [], note: '' }; return; }
          const seedAng = (i * 47 + di * 31) % 360, dKm = 0.6 + ((i * 1.7 + di * 2.3) % 9);
          const p = dest(dKm, seedAng); const spot = spots[(i + di * 3) % spots.length];
          let start, end;
          if (di === 0) {
            if (i % 4 === 0 || i === 11) { start = hmAt(-90); end = hmAt(150); }
            else if (i % 4 === 1) { start = hmAt(-30); end = hmAt(200); }
            else if (i % 4 === 2) { start = hmAt(60); end = hmAt(300); }
            else { start = hmAt(110); end = hmAt(330); }
          } else { start = ['11:30', '18:00', '19:00', '18:30'][(i + di) % 4]; end = addMinutesHM(start, [150, 240, 270, 210][(i + di) % 4]); }
          t.planning[k] = { rest: false, note: '', slots: [{ id: uid('sl'), start, end, place: { name: spot, address: spot, lat: p.lat, lng: p.lng }, products: t.products.map((x) => x.id), note: '' }] };
        });
        if (i < 6) fans[i].favorites = []; // abonnés
        for (let f = 0; f < 3; f++) { fans[(i + f) % 6].favorites.push(t.id); }
        for (let f = 0; f < 3; f++) this.db.reviews.push({ id: uid('r'), truckId: t.id, userId: fans[(i + f) % 6].id, userName: fans[(i + f) % 6].name, rating: 3 + ((i + f * 2) % 3), text: ['Très bon, service rapide !', 'Généreux et bien assaisonné.', 'On y retourne la semaine prochaine.', ''][(i + f) % 4], createdAt: +now - (f + 1) * 86400e3, reply: null });
        if (def[0] === 'Chez Mystère') {
          for (let r = 0; r < 4; r++) { const fan = fans[r]; this.db.reports.push({ id: uid('rp'), userId: fan.id, userName: fan.name, targetType: 'truck', targetId: t.id, reason: r % 2 ? 'fraud' : 'wrong_place', comment: 'Personne sur place à l’adresse indiquée.', createdAt: +now - r * 3600e3, resolved: false }); }
        }
        for (let l = 0; l < 14; l++) this.db.log.push({ t: +now - l * 3600e3 * 5, day: dateKey(new Date(+now - l * 3600e3 * 5)), type: l % 4 === 0 ? 'route' : 'view', truckId: t.id, place: spots[l % 3] });
      });
      this.db.users.push(...owners, ...fans);
      const ev = { id: uid('e'), name: 'Soirée Food Trucks', date: addDaysKey(today, 2), start: '18:00', end: '23:00', description: 'Une dizaine de food trucks réunis sur l’esplanade, musique live.', place: Object.assign({ name: 'Esplanade', address: 'Esplanade' }, dest(2.2, 120)), createdBy: owners[0].id, truckIds: this.db.trucks.filter((t) => t.demo).slice(0, 5).map((t) => t.id), createdAt: +now, demo: true };
      this.db.events.push(ev);
      this._changed();
      return this.db.trucks.filter((t) => t.demo).length;
    }
    removeDemo() {
      const demoUsers = new Set(this.db.users.filter((u) => u.demo).map((u) => u.id));
      const demoTrucks = this.db.trucks.filter((t) => t.demo).map((t) => t.id);
      demoTrucks.forEach((id) => this._dropTruck(id));
      this.db.users = this.db.users.filter((u) => !u.demo);
      this.db.reviews = this.db.reviews.filter((r) => !demoUsers.has(r.userId));
      this.db.reports = this.db.reports.filter((r) => !demoUsers.has(r.userId));
      this.db.events = this.db.events.filter((e) => !e.demo);
      this.db.notifications = this.db.notifications.filter((n) => !demoUsers.has(n.userId));
      this.db.users.forEach((u) => { u.favorites = (u.favorites || []).filter((id) => !demoTrucks.includes(id)); });
      this._changed();
    }
    hasDemo() { return this.db.trucks.some((t) => t.demo); }

    /* ---- points d'extension (version en ligne : CloudStore) */
    markRead(id) { const n = this.db.notifications.find((x) => x.id === id); if (n && !n.read) { n.read = true; this._changed(); } }
    ensureArea() {}
    async fetchTruck(id) { return this.getTruck(id); }
    refreshTruck() { return Promise.resolve(); }
    activityFeed() { return []; }                       // journal d'activité de l'administration (en ligne uniquement)
    async loadMoreActivity() { return 0; }
  }

  const DEPARTMENTS = { '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
    '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente', '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2A': 'Corse-du-Sud', '2B': 'Haute-Corse', '21': 'Côte-d’Or', '22': 'Côtes-d’Armor', '23': 'Creuse',
    '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre',
    '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère',
    '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord', '60': 'Oise', '61': 'Orne',
    '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire',
    '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie', '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var',
    '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne',
    '95': 'Val-d’Oise', '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte' };
  /* ---- fiches « pas encore reprises » : camions repérés à partir d'informations publiques (SQL 12). Pas de planning daté : seulement des habitudes. */
  const LISTING_CUISINES = [['Crêpes', /crepe|galette|sarrasin/], ['Burgers', /burger|hot-?dog|frites/], ['Pizza', /pizza|fougasse|italien/], ['Tacos', /tacos|kebab|mexic/],
    ['Asiatique', /asiat|sushi|bao|japon|wok|thai|vietnam|onigiri/], ['Végé', /vege/], ['Desserts', /dessert|glace|sorbet|gaufre|cookie|patisser/], ['Boissons', /biere|brasserie|cafe|boisson|jus/]];
  /** Types de cuisine (ceux des filtres) qui correspondent au texte libre d'une fiche provisoire. */
  function listingCuisines(l) {
    const s = norm(l && l.cuisine); const out = LISTING_CUISINES.filter((x) => x[1].test(s)).map((x) => x[0]);
    return out.length ? out : ['Autre'];
  }
  /** Position d'affichage : le centre de la commune, décalé de 150 à 450 m (toujours pareil pour un même camion) pour que deux camions d'une même ville ne se superposent pas. */
  function listingPinPos(l) {
    let hsh = 0; const s = String((l && (l.slug || l.name)) || '');
    for (let i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) >>> 0;
    const ang = (hsh % 360) * Math.PI / 180; const km = 0.15 + ((hsh >>> 9) % 300) / 1000;
    return { lat: l.lat + (km * Math.cos(ang)) / 111.32, lng: l.lng + (km * Math.sin(ang)) / (111.32 * Math.cos(l.lat * Math.PI / 180)) };
  }
  /* ---------- habitudes d'une fiche provisoire (« Mer. soir (dès 18 h) : Plomeur ») → créneaux de la semaine
   * Jours : « lun. », « mardi », « mer., jeu. et ven. », « mar. à jeu. ». Heures : « 11 h 30 – 14 h », « dès 18 h », sinon « midi » (11h30–14h),
   * « soir » (18h30–21h30) ou, sans aucune précision, la journée (10h–18h). Une ligne sans jour reconnu est ignorée. */
  const USUAL_DAY = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
  const DAY_TOK = '(lun|mar|mer|jeu|ven|sam|dim)(?:\\.|di\\b|credi\\b|dredi\\b|edi\\b|anche\\b|\\b)';
  function usualSlots(usual) {
    const out = [];
    for (const raw of Array.isArray(usual) ? usual : []) {
      const s = norm(raw); const i = s.indexOf(' : ');
      const left = (i >= 0 ? s.slice(0, i) : s).replace(/\([^)]*\)/g, (m) => (/des\s+\d/.test(m) ? m : ' '));
      const days = new Set();
      for (const m of left.matchAll(new RegExp(DAY_TOK + '\\s*(?:a|au)\\s+' + DAY_TOK, 'g'))) {
        for (let d = USUAL_DAY[m[1]], n = 0; n < 7; d = (d + 1) % 7, n++) { days.add(d); if (d === USUAL_DAY[m[2]]) break; }
      }
      for (const m of left.matchAll(new RegExp('\\b' + DAY_TOK, 'g'))) days.add(USUAL_DAY[m[1]]);
      if (!days.size) continue;
      const ranges = [];
      for (const m of s.matchAll(/(\d{1,2})\s*h\s*(\d{2})?\s*[–-]\s*(\d{1,2})\s*h\s*(\d{2})?/g)) {
        const a = +m[1] * 60 + (+m[2] || 0), b = +m[3] * 60 + (+m[4] || 0); if (a < 1440 && b <= 1440 && a !== b) ranges.push([a, b]);
      }
      if (!ranges.length) {
        const des = /des\s+(\d{1,2})\s*h\s*(\d{2})?/.exec(left);
        if (des) ranges.push([+des[1] * 60 + (+des[2] || 0), Math.min(1440, +des[1] * 60 + (+des[2] || 0) + 210)]);
        else {
          if (/\bmidi\b/.test(left)) ranges.push([690, 840]);
          if (/\bsoir\b/.test(left)) ranges.push([1110, 1290]);
          if (!ranges.length) ranges.push([600, 1080]);
        }
      }
      out.push({ days: [...days].sort(), ranges });
    }
    return out;
  }
  /** État d'une fiche provisoire d'après ses habitudes : { status: 'open'|'soon'|'later', start, end } (prochain créneau sur 8 jours), null si aucune habitude exploitable. */
  function listingStatus(l, now) {
    const slots = usualSlots(l && l.usual); if (!slots.length) return null;
    const t = +now; const base = new Date(+now); base.setHours(0, 0, 0, 0);
    let best = null;
    for (let off = -1; off <= 7; off++) {
      const day = new Date(base); day.setDate(base.getDate() + off); const dow = day.getDay();
      for (const sl of slots) {
        if (!sl.days.includes(dow)) continue;
        for (const [a, b] of sl.ranges) {
          const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, a).getTime();
          const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, b <= a ? b + 1440 : b).getTime();
          if (end <= t) continue;
          const status = t >= start ? 'open' : start - t <= 3 * 3600e3 ? 'soon' : 'later';
          if (!best || rank3(status) < rank3(best.status) || (status === best.status && start < best.start)) best = { status, start, end };
        }
      }
    }
    return best;
  }
  /** Étiquette d'heure d'un repère : « 18 H 30 » aujourd'hui, « DEMAIN 11 H 30 », sinon « VEN. 18 H ». */
  function pinTime(start, now) {
    const d = new Date(start); const today = new Date(+now); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0); const diff = Math.round((day - today) / 864e5);
    const hh = d.getHours() + ' H' + (d.getMinutes() ? ' ' + pad2(d.getMinutes()) : '');
    return diff <= 0 ? hh : diff === 1 ? 'DEMAIN ' + hh : DOW_SHORT[d.getDay()].toUpperCase().replace(/\.?$/, '.') + ' ' + hh;
  }
  /** « DANS 20 MIN », « DANS 1 H 10 ». */
  function pinUntil(start, now) {
    const m = Math.max(1, Math.round((start - now) / 60000));
    return m < 60 ? 'DANS ' + m + ' MIN' : 'DANS ' + Math.floor(m / 60) + ' H' + (m % 60 ? ' ' + pad2(m % 60) : '');
  }
  /** Deux lettres pour l'avatar (« Globe Trucker » → « GT »). */
  function listingInitials(name) {
    const w = String(name || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((x) => x && !/^(le|la|les|l|de|du|des|d|et|au|aux|un|une)$/i.test(x));
    return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
  }
  /** Adresse sans « https:// » ni « www. » de la source des habitudes (« globetrucker.fr »). */
  function sourceHost(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  const INSTAGRAM_HANDLE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._]{1,30}$/;

  /** Lien Instagram / Facebook d'un food truck. Accepte un pseudo (« @monpseudo »), une adresse sans « https:// » ou un lien complet (y compris copié depuis l'appli).
   *  Renvoie l'adresse propre et unique (« https://www.instagram.com/pseudo/ », « https://www.facebook.com/page »), '' si le champ est vide, null si l'adresse n'est pas reconnue.
   *  Mêmes règles que les contraintes de supabase/8-social.sql : on ne garde jamais un autre site, un « javascript: » ou des paramètres de suivi. */
  function socialUrl(kind, raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (s.length > 300 || /\s/.test(s)) return null;
    const ig = kind === 'instagram';
    if (!ig && kind !== 'facebook') return null;
    const handleOk = (x) => (ig ? /^(?=.*[A-Za-z0-9])[A-Za-z0-9._]{1,30}$/ : /^(?=.*[A-Za-z0-9])[A-Za-z0-9.\-]{5,50}$/).test(x);
    const build = (x) => (ig ? 'https://www.instagram.com/' + x + '/' : 'https://www.facebook.com/' + x);
    if (s[0] === '@') s = s.slice(1);
    if (!/^(www\.|m\.)?(instagram|facebook|fb)\.(com|me)$/i.test(s) && handleOk(s)) return build(s);
    let u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    const segs = u.pathname.split('/').filter(Boolean);
    if (ig) {
      if (!/^(www\.|m\.)?instagram\.com$/.test(host) || !segs.length) return null;
      const name = segs[0];
      if (['p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'stories', 'direct', 'about', 'web'].includes(name.toLowerCase()) || !handleOk(name)) return null;
      return build(name);
    }
    if (!/^((www|m|web|mbasic|mobile|[a-z]{2}-[a-z]{2})\.)?facebook\.com$/.test(host) && !/^(www\.)?(fb\.com|fb\.me)$/.test(host)) return null;
    if (segs.length === 1 && segs[0].toLowerCase() === 'profile.php') {
      const id = u.searchParams.get('id'); return id && /^[0-9]{5,20}$/.test(id) ? 'https://www.facebook.com/profile.php?id=' + id : null;
    }
    if (!segs.length || segs.length > 4 || ['sharer', 'sharer.php', 'share', 'dialog', 'login', 'plugins', 'l.php'].includes(segs[0].toLowerCase())) return null;
    if (!segs.every((x) => /^[A-Za-z0-9._%+-]+$/.test(x))) return null;
    const out = build(segs.join('/'));
    return out.length <= 200 ? out : null;
  }
  /** Texte court affiché à la place de l'adresse (« @pseudo » / « facebook.com/page »). */
  function socialLabel(kind, url) {
    const u = socialUrl(kind, url); if (!u) return '';
    return kind === 'instagram' ? '@' + u.replace(/^https:\/\/www\.instagram\.com\//, '').replace(/\/$/, '') : u.replace(/^https:\/\/www\./, '');
  }

  const AVATAR_COLORS = ['#FF6A3D', '#3DDC97', '#4C8DFF', '#FFC83D', '#C77DFF', '#FF5C8A', '#2EC4B6', '#F4A261'];
  function rank3(s) { return { open: 0, soon: 1, later: 2, cancelled: 3 }[s] ?? 4; }

  return {
    Store, UserError, passwordProblem, PASSWORD_RULE, PASSWORD_HINT, lunchKey, RADIUS_STEPS, radiusIndex, fmtRadius, CUISINES, PAYMENTS, REPORT_REASONS, REVIEW_REPORT_REASONS, REVIEW_REPORT_REASONS_PRO, reviewRemovedText, SUSPECT_THRESHOLD, NEARBY_WARN_M, MAX_SLOTS_PER_DAY, MAX_PHOTOS, ADMIN_EMAIL, ADMIN_PASSWORD, AVATAR_COLORS,
    uid, norm, clamp, clone, dateKey, parseKey, addDays, addDaysKey, weekdayOf, DOW_SHORT, DOW_LONG, MONTHS, fmtDayLong, fmtDayShort,
    billingView, fmtEuros, fmtDateShort, socialUrl, socialLabel, DEPARTMENTS, listingCuisines, listingPinPos, listingInitials, usualSlots, listingStatus, pinTime, pinUntil, sourceHost, INSTAGRAM_HANDLE, minutesOf, hm, fmtHM, fmtHours, validHM, addMinutesHM, slotInterval, slotStatus, haversine, fmtDist, project, unproject, tileOf, TILE, isInFrance, hashPassword,
  };
});
