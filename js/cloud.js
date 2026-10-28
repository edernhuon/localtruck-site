/* LocalTruck – couche « en ligne » : petit client Supabase (sans dépendance) + CloudStore.
 *
 * CloudStore hérite du Store local (core.js) : la logique métier et les messages sont identiques.
 *  - Les modifications de fiche (planning, carte, direct…) sont appliquées tout de suite sur l'appareil puis envoyées
 *    au serveur en arrière-plan (file d'attente par fiche, nouvelle tentative si le réseau coupe).
 *  - Les actions qui dépendent du serveur (inscription, avis, signalement, équipe, événements…) sont asynchrones.
 *  - Le serveur revérifie tout : les règles de sécurité sont dans supabase/1-schema.sql.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else { root.MFT = root.MFT || {}; root.MFT.cloud = factory(root.MFT.core); }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const { Store, UserError } = C;
  const fail = (msg, code) => { throw new UserError(msg, code); };

  /* ------------------------------------------------------------------ erreurs */
  class ApiError extends Error {
    constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status || 0; this.code = ''; this.errorCode = ''; this.network = false; }
  }
  function toApiError(status, body) {
    const b = body && typeof body === 'object' ? body : {};
    const e = new ApiError(String(b.message || b.msg || b.error_description || b.error || (typeof body === 'string' ? body : '') || 'HTTP ' + status), status);
    e.code = typeof b.code === 'string' ? b.code : '';          // PostgREST : P0001, 42501…
    e.errorCode = b.error_code || (typeof b.error === 'string' && /^[a-z_]+$/.test(b.error) ? b.error : '');   // GoTrue : user_already_exists…
    e.details = b.details || null;
    return e;
  }
  const isTransient = (e) => e instanceof ApiError && (e.network || e.status >= 500 || e.status === 429 || e.status === 408);

  /** Traduit une erreur technique en message utilisable par l'interface. */
  function friendly(e) {
    if (e instanceof UserError) return e;
    if (!(e instanceof ApiError)) return e;
    if (e.network) return new UserError('Connexion impossible. Vérifiez votre réseau et réessayez.', 'network');
    if (e.code === 'P0001') return new UserError(String(e.message).replace(/MyFoodtruck/g, 'LocalTruck'), 'server');      // messages écrits en français par le serveur (l'ancien nom est remplacé tant que le script SQL n'a pas été rejoué)
    const g = e.errorCode, m = e.message || '';
    if (g === 'user_already_exists' || g === 'email_exists') return new UserError('Un compte existe déjà avec cette adresse e-mail.', 'exists');
    if (g === 'invalid_credentials') return new UserError('E-mail ou mot de passe incorrect.', 'auth');
    if (g === 'email_not_confirmed') return new UserError('Confirmez votre adresse e-mail avant de vous connecter.', 'auth');
    if (g === 'weak_password') return new UserError(C.PASSWORD_RULE);
    if (g === 'same_password') return new UserError('Le nouveau mot de passe doit être différent de l’ancien.');
    if (g === 'validation_failed' || g === 'email_address_invalid' || /unable to validate email/i.test(m)) return new UserError('Adresse e-mail invalide.');
    if (g === 'signup_disabled') return new UserError('Les inscriptions sont fermées pour le moment.');
    if (g === 'over_request_rate_limit' || g === 'over_email_send_rate_limit' || g === 'over_sms_send_rate_limit' || e.status === 429) return new UserError('Trop de tentatives. Réessayez dans quelques minutes.', 'rate');
    if (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303') return new UserError('Session expirée. Reconnectez-vous.', 'auth');
    if (g === 'otp_expired' || g === 'otp_disabled') return new UserError('Code incorrect ou expiré. Demandez un nouveau code.', 'code');
    if (e.code === '42501' || e.status === 403) return new UserError('Action non autorisée.');
    if (e.code === '23505') return new UserError('Cet élément existe déjà.');
    if (e.code === '23514' || e.code === '22P02' || e.code === '22023' || e.code === '23502' || e.code === '22001') return new UserError('Données invalides : vérifiez les champs saisis.');
    if (e.status >= 500) return new UserError('Le service est momentanément indisponible. Réessayez dans un instant.', 'network');
    return new UserError('Une erreur est survenue. Réessayez.', 'unknown');
  }

  /* ------------------------------------------------------------------ stockage local (jeton de session) */
  function makeStorage(s) {
    const mem = new Map();
    const ls = s || (typeof localStorage !== 'undefined' ? localStorage : null);
    return {
      get(k) { try { if (ls) return ls.getItem(k); } catch (e) { /* ignore */ } return mem.has(k) ? mem.get(k) : null; },
      set(k, v) { try { if (ls) { ls.setItem(k, v); return; } } catch (e) { /* ignore */ } mem.set(k, v); },
      remove(k) { try { if (ls) ls.removeItem(k); } catch (e) { /* ignore */ } mem.delete(k); },
    };
  }

  const qs = (query) => {
    const p = new URLSearchParams();
    Object.entries(query || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) p.append(k, String(v)); });
    const s = p.toString(); return s ? '?' + s : '';
  };
  const timeoutSignal = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const nowSec = () => Math.floor(Date.now() / 1000);

  function dataUrlToBytes(dataUrl) {
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!m) throw new UserError('Image invalide.');
    const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, type: m[1].toLowerCase() };
  }

  /* ------------------------------------------------------------------ client API */
  class Api {
    constructor(o) {
      this.url = String(o.url || '').replace(/\/+$/, ''); this.key = o.key || '';
      this.fetch = o.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
      this.publicBase = (o.publicBase || (this.url + '/storage/v1/object/public')).replace(/\/+$/, '');
      this.session = null; this.onSession = null; this.onSignedOut = null; this._refreshing = null;
    }
    setSession(s) { this.session = s || null; if (this.onSession) this.onSession(this.session); }
    async token() {
      const s = this.session; if (!s) return null;
      if (s.expires_at - nowSec() < 60) { try { await this.refresh(); } catch (e) { if (!isTransient(e)) throw e; } }
      return this.session ? this.session.access_token : null;
    }
    refresh(force) {
      if (!this.session) return Promise.resolve(null);
      if (this._refreshing) return this._refreshing;
      const rt = this.session.refresh_token;
      this._refreshing = (async () => {
        try {
          const r = await this.request('POST', '/auth/v1/token', { query: { grant_type: 'refresh_token' }, body: { refresh_token: rt }, auth: false });
          this._takeSession(r.data); return this.session;
        } catch (e) {
          if (e instanceof ApiError && !isTransient(e) && e.status >= 400 && e.status < 500) { this.setSession(null); if (this.onSignedOut) this.onSignedOut(); }
          throw e;
        } finally { this._refreshing = null; }
      })();
      return this._refreshing;
    }
    _takeSession(d) {
      if (!d || !d.access_token) throw new ApiError('Réponse inattendue du serveur.', 500);
      const user = d.user || (this.session && this.session.user) || {};
      this.setSession({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || (nowSec() + (d.expires_in || 3600)), user: { id: user.id, email: user.email } });
    }
    async request(method, path, o) {
      o = o || {};
      const url = this.url + path + qs(o.query);
      const send = async (token) => {
        const headers = { apikey: this.key };
        if (token) headers.Authorization = 'Bearer ' + token;
        let body;
        if (o.raw !== undefined) body = o.raw; else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body); }
        Object.assign(headers, o.headers || {});
        let res;
        try { res = await this.fetch(url, { method, headers, body, signal: timeoutSignal(o.timeout || 25000) }); }
        catch (e) { const er = new ApiError('network', 0); er.network = true; throw er; }
        const text = await res.text(); let data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!res.ok) throw toApiError(res.status, data);
        return { data, status: res.status };
      };
      const token = o.auth === false ? null : await this.token();
      try { return await send(token); }
      catch (e) {
        if (e instanceof ApiError && e.status === 401 && token && !o._retried && this.session && (e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt/i.test(e.message))) {
          await this.refresh(true); return send(this.session && this.session.access_token);
        }
        throw e;
      }
    }
    /* --- REST */
    async select(table, query) { const r = await this.request('GET', '/rest/v1/' + table, { query }); return Array.isArray(r.data) ? r.data : []; }
    async insert(table, row) { const r = await this.request('POST', '/rest/v1/' + table, { body: row, headers: { Prefer: 'return=representation' } }); return Array.isArray(r.data) ? r.data : []; }
    async patch(table, filters, body) { const r = await this.request('PATCH', '/rest/v1/' + table, { query: filters, body, headers: { Prefer: 'return=representation' } }); return Array.isArray(r.data) ? r.data : []; }
    async del(table, filters) { await this.request('DELETE', '/rest/v1/' + table, { query: filters }); }
    async rpc(fn, args) { const r = await this.request('POST', '/rest/v1/rpc/' + fn, { body: args || {} }); return r.data === '' ? null : r.data; }
    /* --- comptes */
    async signUp(email, password, data) { const r = await this.request('POST', '/auth/v1/signup', { body: { email, password, data }, auth: false }); return r.data; }
    async signIn(email, password) { const r = await this.request('POST', '/auth/v1/token', { query: { grant_type: 'password' }, body: { email, password }, auth: false }); return r.data; }
    async updatePassword(password) { await this.request('PUT', '/auth/v1/user', { body: { password } }); }
    /** Mot de passe oublié : envoie un code par e-mail (réponse identique que le compte existe ou non). */
    async recover(email) { await this.request('POST', '/auth/v1/recover', { body: { email }, auth: false }); }
    /** Vérifie le code reçu : renvoie une session (la personne peut alors choisir un nouveau mot de passe). */
    async verifyRecovery(email, token) { const r = await this.request('POST', '/auth/v1/verify', { body: { type: 'recovery', email, token }, auth: false }); return r.data; }
    async signOut() { try { await this.request('POST', '/auth/v1/logout', { query: { scope: 'local' } }); } catch (e) { /* ignore */ } }
    /* --- photos */
    publicUrl(path) { return this.publicBase + '/media/' + path; }
    async upload(path, bytes, type) {
      await this.request('POST', '/storage/v1/object/media/' + path, { raw: bytes, headers: { 'Content-Type': type, 'x-upsert': 'false', 'cache-control': 'max-age=31536000' }, timeout: 60000 });
      return this.publicUrl(path);
    }
    async removeObject(path) { try { await this.request('DELETE', '/storage/v1/object/media/' + path); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------------------------------------------ correspondance serveur ⇄ appli */
  const COLS = ['name', 'cuisines', 'bio', 'payments', 'phone', 'instagram', 'facebook', 'logo', 'color', 'gallery', 'dish', 'products', 'planning', 'weekly'];
  const ms = (s) => { const t = Date.parse(s); return isFinite(t) ? t : 0; };

  function mapTruck(r) {
    return {
      id: r.id, ownerId: r.owner_id, team: [], name: r.name || '', cuisines: r.cuisines || [], bio: r.bio || '', payments: r.payments || [], phone: r.phone || '', instagram: r.instagram || '', facebook: r.facebook || '',
      logo: r.logo || null, color: r.color || null, verified: !!r.verified, hidden: !!r.hidden, hiddenByBilling: !!r.hidden_by_billing, suspect: !!r.suspect, reportCount: r.report_count || 0,
      ratingAvg: Number(r.rating_avg) || 0, ratingCount: r.rating_count || 0, followerCount: r.follower_count || 0, slug: r.slug || '',
      products: r.products || [], gallery: r.gallery || [], dish: r.dish || null, planning: r.planning || {}, weekly: r.weekly || {},
      createdAt: ms(r.created_at), demo: !!r.is_demo,
    };
  }
  const SERVER_FIELDS = ['verified', 'hidden', 'hiddenByBilling', 'suspect', 'reportCount', 'ratingAvg', 'ratingCount', 'followerCount'];
  const colJson = (t, c) => JSON.stringify(t[c] === undefined ? null : t[c]);
  const mapNotif = (n) => ({ id: n.id, userId: n.user_id, truckId: n.truck_id, type: n.type, text: n.text, key: n.key || null, read: !!n.read, createdAt: ms(n.created_at) });
  const mapPoster = (r) => ({ id: r.id, truckId: r.truck_id, truckName: r.truck_name || '', slug: r.slug || '', status: r.status, format: ['A4', 'A5', 'A6'].includes(r.format) ? r.format : 'A4', recipient: r.recipient || '', address: r.address || '', address2: r.address2 || '', postcode: r.postcode || '', city: r.city || '', phone: r.phone || '', tracking: r.tracking || '', createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) });
  const mapReview = (r) => ({ id: r.id, truckId: r.truck_id, userId: r.user_id, userName: r.user_name, rating: r.rating, text: r.text || '', reply: r.reply || null, createdAt: ms(r.created_at), editedAt: r.edited_at ? ms(r.edited_at) : undefined });
  const mapActivity = (a) => ({ id: Number(a.id), at: ms(a.at), kind: a.kind, actorName: a.actor_name || '', truckId: a.truck_id || null, truckName: a.truck_name || '', city: a.city || '', text: a.text });
  const mapReport = (r) => ({ id: r.id, userId: r.reporter_id, userName: r.reporter_name, targetType: r.target_type, targetId: r.target_id, reason: r.reason, comment: r.comment || '', createdAt: ms(r.created_at), resolved: !!r.resolved });
  const mapEvent = (e) => ({
    id: e.id, name: e.name, date: e.event_date, start: e.start_time, end: e.end_time, description: e.description || '', place: e.place || {},
    createdBy: e.created_by, createdAt: ms(e.created_at), truckIds: (e.event_trucks || e.truck_ids || []).map((x) => (typeof x === 'string' ? x : x.truck_id)),
  });
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const sig = (o) => JSON.stringify(o);

  const AREA_TTL = 10 * 60e3, MAX_AREAS = 3, SAVE_KEY = 'mft.cloud.v1';

  /* ------------------------------------------------------------------ CloudStore */
  class CloudStore extends Store {
    constructor(opts) {
      super(opts || {});
      opts = opts || {};
      this.isCloud = true;
      this.store = makeStorage(opts.storage);
      this.api = opts.api || new Api({ url: opts.url, key: opts.key, fetch: opts.fetch, publicBase: opts.publicBase });
      this.api.onSession = () => this._save();
      this.api.onSignedOut = () => this._localLogout();
      this.onError = opts.onError || ((m) => { if (typeof console !== 'undefined') console.warn('[LocalTruck]', m); });
      this.onSyncState = opts.onSyncState || null;
      this.syncState = 'ok';
      this.adminStats = null; this.audienceData = null; this.activityState = 'unknown'; this._actLast = 0; this._zone = null; this._delReq = []; this._listings = new Map(); this._listAreas = []; this._listAt = 0; this._listMissing = false; this._listRem = []; this._billing = null; this._subs = new Map(); this._billAt = 0; this._posters = []; this._posterAt = 0; this._posterMissing = false; this._posterAdm = [];
      this._me = null; this._guest = false; this._memberOf = new Set(); this._favSet = new Set();
      this._trucks = new Map(); this._managed = new Set(); this._admin = new Set(); this._extra = new Set(); this._areas = [];
      this._srv = new Map(); this._pend = new Map(); this._dirty = new Set(); this._chains = new Map();
      this._reviewsAt = new Map(); this._statsCache = new Map(); this._proxSent = new Set();
      this._eventsAt = 0; this._teamAt = new Map(); this._notifSince = ''; this._timers = new Set();
      this._retryN = 0; this._areaFailAt = 0; this._syncing = false; this._mineSince = ''; this._srvUpdated = new Map(); this._fullAt = Date.now();
    }

    /* ---- persistance : on ne garde que le jeton et le profil, jamais les mots de passe */
    _save() {
      try {
        if (!this.api.session) { this.store.remove(SAVE_KEY); return; }
        this.store.set(SAVE_KEY, JSON.stringify({ session: this.api.session, me: this._me }));
      } catch (e) { /* ignore */ }
    }
    _persistNow() { return Promise.resolve(); }
    _changed() { this.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
    flush() { return this.idle(); }
    async idle() {
      for (let i = 0; i < 30; i++) {
        const snap = [...this._chains.values()]; if (!snap.length) return;
        await Promise.all(snap);
        const now = [...this._chains.values()]; if (now.length === snap.length && now.every((p, j) => p === snap[j])) return;
      }
    }
    _timer(fn, ms) { const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms); if (t && t.unref) t.unref(); this._timers.add(t); return t; }
    close() { this._timers.forEach(clearTimeout); this._timers.clear(); clearInterval(this._poll); this._poll = null; }
    _setSync(state) { if (state && state !== this.syncState) { this.syncState = state; if (this.onSyncState) this.onSyncState(state); } }
    _chain(key, fn) {
      const prev = this._chains.get(key) || Promise.resolve();
      const next = prev.then(fn, fn).catch(() => {});
      this._chains.set(key, next); return next;
    }
    async _try(fn) { try { return await fn(); } catch (e) { throw friendly(e); } }

    /* ---- démarrage : reprend la session enregistrée */
    async init() {
      let saved = null;
      try { const raw = this.store.get(SAVE_KEY); if (raw) saved = JSON.parse(raw); } catch (e) { saved = null; }
      if (saved && saved.session && saved.me && saved.me.id) {
        this.api.session = saved.session; this._setMe(saved.me);
        try {
          await Promise.race([this.loadAll(), new Promise((_, rej) => { const t = setTimeout(() => rej(Object.assign(new ApiError('timeout'), { network: true })), 9000); if (t && t.unref) t.unref(); })]);
        } catch (e) {
          if (!isTransient(e)) this._localLogout();
          else this._setSync('offline');
        }
      }
      return this;
    }
    startSync(everyMs) {
      if (this._poll) return;
      this._poll = setInterval(() => { this.sync().catch(() => {}); }, everyMs || 45000);
      if (this._poll.unref) this._poll.unref();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.sync().catch(() => {}); });
      if (typeof window !== 'undefined') window.addEventListener('online', () => { this._retryN = 0; this._retryDirty(); this.sync().catch(() => {}); });
    }

    /** Mode « sans compte » : lecture seule de ce qui est public (food trucks autour de soi, fiches, avis, événements). */
    setGuest(on) { on = !!on; if (on === this._guest) return; this._guest = on; if (on && !this._me) this.sync().catch(() => {}); }

    /* ---- compte courant */
    _setMe(me) {
      this._me = { id: me.id, role: me.role || 'client', name: me.name || 'Utilisateur', email: me.email || '', favorites: me.favorites || [], prefs: me.prefs || {}, seenNotifAt: me.seenNotifAt || 0, createdAt: me.createdAt || 0, deletionRequestedAt: me.deletionRequestedAt || 0 };
      this._favSet = new Set(this._me.favorites);
      this.db.users = [this._me].concat(this.db.users.filter((u) => u.id !== this._me.id)); this.db.session.userId = this._me.id;
    }
    _localLogout() {
      this.api.session = null; this._me = null; this._memberOf = new Set(); this._favSet = new Set();
      this._trucks.clear(); this._managed.clear(); this._admin.clear(); this._extra.clear(); this._areas = [];
      this._srv.clear(); this._pend.clear(); this._dirty.clear(); this._chains.clear(); this._reviewsAt.clear(); this._statsCache.clear(); this._proxSent.clear();
      this._eventsAt = 0; this._teamAt.clear(); this._notifSince = ''; this._mineSince = ''; this._srvUpdated = new Map(); this.adminStats = null; this.audienceData = null; this._zone = null; this.activityState = 'unknown'; this._actLast = 0; this._delReq = []; this._billing = null; this._subs = new Map(); this._billAt = 0;
      this._listRem = []; this._posters = []; this._posterAt = 0; this._posterAdm = [];
      this.db.activity = []; this.db.users = []; this.db.trucks = []; this.db.reviews = []; this.db.reports = []; this.db.events = []; this.db.notifications = []; this.db.session.userId = null;
      try { this.store.remove(SAVE_KEY); } catch (e) { /* ignore */ }
      this._setSync('ok'); this._changed();
    }
    async _adopt(sess, extra) {
      this.api.setSession(sess);
      this._setMe(Object.assign({ id: sess.user.id, email: sess.user.email }, extra || {}));
      try { await this.loadAll(); }
      catch (e) { this._localLogout(); throw friendly(e); }
      return this.currentUser();
    }
    /** Adresse « protégée » (liste tenue à la main dans la base, jamais dans le code public) : l'inscription ne dit pas si un compte existe.
     *  Liste absente (script SQL 11 pas encore lancé) ou serveur injoignable : inscription normale. */
    async _isProtected(email) { try { return (await this.api.rpc('signup_is_protected', { p_email: email })) === true; } catch (e) { return false; } }
    async signup({ role, name, email, password }) {
      name = String(name || '').trim(); email = String(email || '').trim();
      if (!['client', 'truck'].includes(role)) fail('Type de compte inconnu.');
      if (!name) fail('Indiquez votre nom ou pseudo.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Adresse e-mail invalide.');
      { const pb = C.passwordProblem(password); if (pb) fail(pb); }
      if (await this._isProtected(email)) fail('Une erreur est survenue. Réessayez.', 'unknown');      // adresse protégée : réponse identique que le compte existe ou non
      const d = await this._try(() => this.api.signUp(email, password, { role, name: name.slice(0, 60) }));
      if (!d || !d.access_token) fail('Votre compte est créé. Ouvrez le lien reçu par e-mail pour le confirmer, puis connectez-vous.', 'confirm');
      this.api._takeSession(d);
      return this._adopt(this.api.session);
    }
    async login(email, password) {
      email = String(email || '').trim();
      if (!email || !password) fail('E-mail ou mot de passe incorrect.', 'auth');
      const d = await this._try(() => this.api.signIn(email, String(password)));
      this.api._takeSession(d);
      return this._adopt(this.api.session);
    }
    logout() {
      const had = !!this.api.session;
      if (had) {                                          // ces deux requêtes partent avec la session encore en place, puis on efface tout
        try { const m = typeof globalThis !== 'undefined' ? globalThis.MFT : null; if (m && m.push) m.push.forgetDevice(); } catch (e) { /* ignore */ }
        this.api.signOut();
      }
      this._localLogout();
    }
    userByEmail() { return null; }                        // jamais exposé : évite de deviner les comptes existants
    updateUser(id, patch) {
      const u = this.getUser(id); if (!u || u !== this._me) fail('Compte introuvable.');
      super.updateUser(id, patch);
      const body = {}; if (patch.name !== undefined) body.name = u.name; if (patch.prefs) body.prefs = u.prefs;
      this._chain('profile', async () => {
        try { await this.api.patch('profiles', { id: 'eq.' + u.id }, body); this._save(); }
        catch (e) { this.onError(friendly(e).message); }
      });
      this._save(); return u;
    }
    async changePassword(id, oldPwd, newPwd) {
      { const pb = C.passwordProblem(newPwd); if (pb) fail(pb); }
      const email = this._me && this._me.email; if (!email) fail('Compte introuvable.');
      try { const d = await this.api.signIn(email, String(oldPwd || '')); this.api._takeSession(d); }
      catch (e) { if (e instanceof ApiError && e.errorCode === 'invalid_credentials') fail('Mot de passe actuel incorrect.'); throw friendly(e); }
      await this._try(() => this.api.updatePassword(String(newPwd)));
    }
    /* ---- mot de passe oublié : un code (8 chiffres chez Supabase) arrive par e-mail ; avec ce code on choisit un nouveau mot de passe (et on est connecté) */
    async requestPasswordReset(email) {
      email = String(email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Adresse e-mail invalide.');
      await this._try(() => this.api.recover(email));                      // aucune indication sur l'existence du compte
    }
    async resetPassword({ email, code, password }) {
      email = String(email || '').trim(); code = String(code || '').replace(/\s+/g, '');
      if (!/^\d{6,10}$/.test(code)) fail('Saisissez le code reçu par e-mail (des chiffres uniquement).', 'code');
      { const pb = C.passwordProblem(password); if (pb) fail(pb); }
      const d = await this._try(() => this.api.verifyRecovery(email, code));
      this.api._takeSession(d);
      try { await this.api.updatePassword(String(password)); }
      catch (e) {
        if (e instanceof ApiError && e.errorCode === 'same_password') { /* c'était déjà ce mot de passe : le code a prouvé l'accès à la boîte mail, on connecte simplement la personne */ }
        else { this.api.setSession(null); throw friendly(e); }            // pas de demi-connexion si le mot de passe est refusé
      }
      return this._adopt(this.api.session);
    }
    /* Suppression en deux temps : la personne demande (compte masqué, annulable), l'administration valide ou refuse. */
    async requestDeletion(id) {
      if (this._me && this._me.role === 'admin') fail('Le compte administrateur ne peut pas être supprimé.');
      await this._try(() => this.api.rpc('request_account_deletion'));
      this._me.deletionRequestedAt = Date.now();
      this.db.trucks.forEach((t) => { if (t.ownerId === this._me.id && !t.hidden) t.hidden = true; });
      this._save(); this._changed();
    }
    async cancelDeletion(id) {
      await this._try(() => this.api.rpc('cancel_account_deletion'));
      this._me.deletionRequestedAt = 0;
      this.db.trucks.forEach((t) => { if (t.ownerId === this._me.id) this._reloadTruck(t.id); });
      this._save(); this._changed();
    }
    /* ---- abonnement des food trucks (script SQL 7) : éteint tant que la configuration dit « enabled: false » ou que le script n'est pas exécuté */
    billing() { return this._billing || { enabled: false }; }
    subscriptionOf(truckId) { return this._subs.get(truckId) || null; }
    billingFor(truck) {
      const owner = truck && this.getUser(truck.ownerId);
      return C.billingView(this.billing(), this.subscriptionOf(truck && truck.id), owner && owner.role === 'admin' ? { ...truck, demo: true } : truck, +this.now());
    }
    async _loadBilling() {
      this._billAt = Date.now();
      const [cfg, rows] = await Promise.all([
        this.api.rpc('billing_public').catch(() => null),
        this.api.select('subscriptions', { select: 'truck_id,status,period_end', limit: 500 }).catch(() => null),
      ]);
      if (cfg === null && rows === null) this._billAt = Date.now() + 25 * 60000;   // script SQL 7 pas exécuté (ou réseau coupé) : on ne redemande pas avant 30 minutes
      let changed = false;
      if (cfg && typeof cfg === 'object' && sig(cfg) !== sig(this._billing)) { this._billing = cfg; changed = true; }
      if (Array.isArray(rows)) {
        const m = new Map(rows.map((r) => [r.truck_id, { status: r.status, periodEnd: r.period_end ? ms(r.period_end) : 0 }]));
        if (sig([...m]) !== sig([...this._subs])) { this._subs = m; changed = true; }
      }
      return changed;
    }
    /** Après un paiement : relit tout de suite l'abonnement et l'état des fiches (sinon la mise à jour attend la prochaine synchronisation). */
    async refreshBilling() {
      const c = await this._loadBilling();
      await Promise.all([...this._managed].map((id) => this._reloadTruck(id)));
      if (c) this._changed();
      return c;
    }
    /* ---- fiches « pas encore reprises » (SQL 12) : camions repérés à partir d'informations publiques, sans compte */
    _mapListing(r) {
      return { id: r.id, slug: String(r.slug || ''), name: String(r.name || ''), cuisine: String(r.cuisine || ''), instagram: String(r.instagram || ''), city: String(r.city || ''), department: String(r.department || ''),
        lat: +r.lat, lng: +r.lng, usual: Array.isArray(r.usual) ? r.usual.map(String).slice(0, 10) : [], usualSource: String(r.usual_source || '') };
    }
    /** Fiches proches (depuis ce que l'appareil a déjà chargé) : [{ listing, dist }], la plus proche d'abord. */
    listingsNear(center, radiusKm, o) {
      if (!center || !this._listings.size) return [];
      o = o || {}; const q = o.text ? C.norm(o.text) : ''; const out = [];
      for (const l of this._listings.values()) {
        const dist = C.haversine(center.lat, center.lng, l.lat, l.lng); if (dist > radiusKm) continue;
        if (q && !C.norm(l.name + ' ' + l.cuisine + ' ' + l.city).includes(q)) continue;
        const cu = C.listingCuisines(l);
        if (o.veg && !cu.includes('Végé')) continue;
        if (o.cuisine && o.cuisine !== 'Tout' && !cu.includes(o.cuisine)) continue;
        out.push({ listing: l, dist });
      }
      return out.sort((a, b) => a.dist - b.dist).slice(0, 60);
    }
    getListing(slug) { return this._listings.get(String(slug || '').toLowerCase()) || null; }
    /** Administration (affiches) : toutes les fiches provisoires de France, lues par grands cercles de 300 km (maximum accepté par nearby_listings). */
    async allListings() {
      const CIRCLES = [[48.86, 2.35], [48.11, -1.68], [48.39, -4.49], [50.63, 3.06], [48.57, 7.75], [45.76, 4.84], [43.3, 5.37], [43.6, 1.44], [44.84, -0.58], [47.22, -1.55], [43.7, 7.26], [41.92, 8.74], [47.32, 5.04]];
      if (this._listMissing) return [];
      for (const [lat, lng] of CIRCLES) {
        try { const rows = await this.api.rpc('nearby_listings', { p_lat: lat, p_lng: lng, p_radius_km: 300 }); (Array.isArray(rows) ? rows : []).forEach((x) => { const l = this._mapListing(x); this._listings.set(l.slug, l); }); }
        catch (e) { if (e instanceof ApiError && !e.network && (e.status === 404 || e.status === 400)) { this._listMissing = true; return []; } }
      }
      return [...this._listings.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }
    async fetchListing(slug) {
      slug = String(slug || '').toLowerCase(); if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return null;
      if (this._listings.has(slug)) return this._listings.get(slug);
      try {
        const r = await this.api.rpc('get_listing', { p_slug: slug }); if (!r || !r.slug) return null;
        const l = this._mapListing(r); this._listings.set(l.slug, l); this._changed(); return l;
      } catch (e) { return null; }
    }
    async _loadListings(center, R) {
      if (this._listMissing) return false;
      let rows;
      try { rows = await this.api.rpc('nearby_listings', { p_lat: center.lat, p_lng: center.lng, p_radius_km: R }); }
      catch (e) {
        if (e instanceof ApiError && !e.network && (e.status === 404 || e.status === 400)) this._listMissing = true;      // script SQL 12 pas encore exécuté : on s'en passe
        return false;
      }
      const list = (Array.isArray(rows) ? rows : []).map((r) => this._mapListing(r)); const fresh = new Set(list.map((l) => l.slug));
      const before = sig([...this._listings.keys()].sort());
      for (const [k, l] of this._listings) if (!fresh.has(k) && C.haversine(center.lat, center.lng, l.lat, l.lng) <= R) this._listings.delete(k);      // reprise ou suppression entre-temps
      list.forEach((l) => this._listings.set(l.slug, l));
      this._listAreas = this._listAreas.filter((a) => C.haversine(a.lat, a.lng, center.lat, center.lng) > 1).concat([{ lat: center.lat, lng: center.lng, R }]).slice(-4);
      this._listAt = Date.now();
      return before !== sig([...this._listings.keys()].sort()) || list.length > 0;
    }
    async _refreshListings() {
      let changed = false;
      for (const a of this._listAreas.slice()) { if (await this._loadListings({ lat: a.lat, lng: a.lng }, a.R)) changed = true; }
      this._listAt = Date.now(); return changed;
    }
    /** « C'est mon camion » : la fiche provisoire quitte la carte, la vraie fiche prend sa place. Faux si elle n'existe plus. */
    async claimListing(slug, truckId) {
      const ok = await this._try(() => this.api.rpc('claim_listing', { p_slug: String(slug || ''), p_truck: truckId }));
      this._listings.delete(String(slug || '').toLowerCase()); this._changed();
      if (ok === true) await this._reloadTruck(truckId);                      // le food truck prend l'adresse courte de la fiche reprise
      return ok === true;
    }
    /** Une adresse courte (localtruck.fr/t/<adresse>) : { kind: 'truck', id } ou { kind: 'listing', listing } ; null si elle n'existe pas (ou plus). */
    async resolveSlug(slug) {
      slug = String(slug || '').toLowerCase(); if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return null;
      for (const t of this._trucks.values()) if (t.slug === slug) return { kind: 'truck', id: t.id };
      if (this._listings.has(slug)) return { kind: 'listing', listing: this._listings.get(slug) };
      let r;
      try { r = await this.api.rpc('resolve_slug', { p_slug: slug }); }
      catch (e) {
        if (e instanceof ApiError && !e.network && (e.status === 404 || e.status === 400)) { const l = await this.fetchListing(slug); return l ? { kind: 'listing', listing: l } : null; }      // script SQL 13 pas encore exécuté
        return null;
      }
      if (!r || !r.kind) return null;
      if (r.kind === 'truck' && r.id) return { kind: 'truck', id: String(r.id) };
      if (r.kind === 'listing' && r.listing && r.listing.slug) { const l = this._mapListing(r.listing); this._listings.set(l.slug, l); this._changed(); return { kind: 'listing', listing: l }; }
      return null;
    }
    /* ---- affiches : demandes du food truck (adresse postale lisible seulement par lui et l'administration, effacée à la livraison) */
    posterSupported() { return !this._posterMissing; }
    posterRequests(truckId) { return this._posters.filter((p) => p.truckId === truckId); }
    async loadPosterRequests(force) { if (!this._me || (!force && Date.now() - this._posterAt < 20000)) return false; const ch = await this._loadPosters(); if (ch) this._changed(); return ch; }
    async _loadPosters() {
      if (this._posterMissing || !this._me) return false;
      let rows;
      try { rows = await this.api.rpc('my_poster_requests'); }
      catch (e) { if (e instanceof ApiError && !e.network && (e.status === 404 || e.status === 400)) this._posterMissing = true; return false; }      // script SQL 13 pas encore exécuté : pas d'affiche
      this._posterAt = Date.now(); const list = (Array.isArray(rows) ? rows : []).map(mapPoster);
      if (sig(list) === sig(this._posters)) return false; this._posters = list; return true;
    }
    async requestPoster(actorId, truckId, f) {
      const t = this._mustManage(actorId, truckId); f = f || {};
      const v = { recipient: String(f.recipient || '').trim(), address: String(f.address || '').trim(), address2: String(f.address2 || '').trim(), postcode: String(f.postcode || '').trim(), city: String(f.city || '').trim(), phone: String(f.phone || '').trim() };
      if (v.recipient.length < 2) fail('Indiquez le nom du destinataire.');
      if (v.address.length < 3) fail('Indiquez l’adresse (numéro et rue).');
      if (!/^[0-9]{5}$/.test(v.postcode)) fail('Le code postal comporte 5 chiffres.');
      if (v.city.length < 2) fail('Indiquez la ville.');
      if (v.phone && !/^[0-9 +.()-]{6,20}$/.test(v.phone)) fail('Numéro de téléphone invalide.');
      if (!t.slug) fail('Adresse courte indisponible. Réessayez dans un instant.');
      const fmt = ['A4', 'A5', 'A6'].includes(f.format) ? f.format : 'A4';
      const args = { p_truck: truckId, p_recipient: v.recipient, p_address: v.address, p_address2: v.address2, p_postcode: v.postcode, p_city: v.city, p_phone: v.phone };
      let r;
      try { r = await this.api.rpc('request_poster', Object.assign({ p_format: fmt }, args)); }
      catch (e) {      // script SQL 14 pas encore exécuté : la base ne connaît pas encore le format, la demande part en A4
        if (!(e instanceof ApiError) || e.network || !(e.status === 404 || e.code === 'PGRST202')) throw friendly(e);
        if (fmt !== 'A4') fail('Ce format n’est pas encore disponible. Choisissez l’A4 ou réessayez plus tard.');
        r = await this._try(() => this.api.rpc('request_poster', args));
      }
      const p = mapPoster(r); this._posters = [p].concat(this._posters.filter((x) => x.id !== p.id)); this._posterAt = Date.now(); this._changed(); return p;
    }
    async cancelPoster(actorId, id) {
      const cur = this._posters.find((p) => p.id === id); if (!cur) fail('Demande introuvable.'); this._mustManage(actorId, cur.truckId);
      const r = await this._try(() => this.api.rpc('cancel_poster', { p_id: id }));
      const p = mapPoster(r); this._posters = this._posters.map((x) => (x.id === id ? p : x)); this._changed(); return p;
    }
    posterAdmin() { return this._posterAdm; }
    async _loadAdminPosters() {
      let rows; try { rows = await this.api.rpc('admin_poster_requests'); } catch (e) { return false; }          // script SQL 13 pas encore exécuté : on s'en passe
      const list = (Array.isArray(rows) ? rows : []).map(mapPoster);
      if (sig(list) === sig(this._posterAdm)) return false; this._posterAdm = list; return true;
    }
    async loadAdminPosters() { const ch = await this._loadAdminPosters(); if (ch) this._changed(); return ch; }
    async setPosterStatus(adminId, id, status, tracking) {
      const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.');
      const r = await this._try(() => this.api.rpc('admin_set_poster', { p_id: id, p_status: status, p_tracking: tracking ? String(tracking).trim().slice(0, 40) : null }));
      const p = mapPoster(r); this._posterAdm = this._posterAdm.map((x) => (x.id === id ? p : x)); this._changed(); return p;
    }
    /** Demande de suppression (sans compte) : la fiche est masquée tout de suite, l'administration vérifie ensuite. */
    async requestListingRemoval(slug, role, email, message) {
      email = String(email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) fail('Adresse e-mail invalide.');
      await this._try(() => this.api.rpc('request_listing_removal', { p_slug: String(slug || ''), p_role: role === 'manager' ? 'manager' : 'owner', p_email: email, p_message: String(message || '').trim().slice(0, 300) }));
      this._listings.delete(String(slug || '').toLowerCase()); this._changed(); return true;
    }
    listingRemovals() { return this._listRem || []; }
    async resolveListingRemoval(adminId, id, action) {
      const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.');
      await this._try(() => this.api.rpc('resolve_listing_removal', { p_id: id, p_action: action === 'delete' ? 'delete' : 'restore' }));
      this._listRem = (this._listRem || []).filter((r) => r.id !== id); this._changed(); return true;
    }
    deletionRequests() { return this._delReq || []; }
    async decideDeletion(adminId, userId, action) {
      const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.');
      await this._try(() => this.api.rpc('admin_decide_deletion', { p_user: userId, p_action: action }));
      this._delReq = (this._delReq || []).filter((r) => r.id !== userId);
      this._admin.forEach((tid) => this._reloadTruck(tid));
      this._changed();
    }

    /* ---- chargement complet après connexion */
    async loadAll() {
      const uid = this._me.id; const a = this.api;
      const [prof, follows, members, owned, notifs] = await Promise.all([
        a.select('profiles', { id: 'eq.' + uid, select: 'id,role,name,prefs,seen_notif_at,created_at,deletion_requested_at' }),
        a.select('follows', { select: 'truck_id', user_id: 'eq.' + uid }),
        a.select('truck_members', { select: 'truck_id', user_id: 'eq.' + uid }),
        a.select('trucks', { select: '*', owner_id: 'eq.' + uid, order: 'created_at.asc' }),
        a.select('notifications', { select: '*', user_id: 'eq.' + uid, order: 'created_at.desc', limit: 100 }),
      ]);
      if (!prof[0]) throw new ApiError('Profil introuvable.', 404);
      const p = prof[0];
      this._setMe({ id: uid, email: this._me.email, role: p.role, name: p.name, prefs: p.prefs || {}, seenNotifAt: p.seen_notif_at || 0, createdAt: ms(p.created_at), deletionRequestedAt: p.deletion_requested_at ? ms(p.deletion_requested_at) : 0, favorites: follows.map((f) => f.truck_id) });
      this._memberOf = new Set(members.map((m) => m.truck_id));
      this._managed = new Set(); owned.forEach((r) => { this._upsert(r, true); this._managed.add(r.id); });
      const memberIds = [...this._memberOf].filter((id) => !this._managed.has(id));
      for (const part of chunk(memberIds, 40)) (await a.select('trucks', { select: '*', id: 'in.(' + part.join(',') + ')' })).forEach((r) => { this._upsert(r, true); this._managed.add(r.id); });
      const favIds = this._me.favorites.filter((id) => !this._managed.has(id));
      for (const part of chunk(favIds, 40)) (await a.select('trucks', { select: '*', id: 'in.(' + part.join(',') + ')' })).forEach((r) => { this._upsert(r, true); this._extra.add(r.id); });
      this._notifSince = ''; this._setNotifs(notifs, true);
      await Promise.all([this._loadEvents(true), this._loadTeams(true), this._loadZone(), this._loadBilling(), this._me.role === 'admin' ? this._loadAdmin() : null, this._managed.size ? this._loadPosters() : null]);
      this._mineSince = [...this._managed, ...this._favSet].map((id) => this._srvUpdated && this._srvUpdated.get(id) || '').reduce((a, b) => (a > b ? a : b), '');
      this._gc(); this._save(); this._setSync('ok'); this._changed();
    }

    /* ---- fiches : cache commun, une seule copie par identifiant */
    _busy(id) { return (this._pend.get(id) || 0) > 0 || this._dirty.has(id); }
    _upsert(row, force) {
      const next = mapTruck(row); const id = next.id; const cur = this._trucks.get(id);
      if (row.updated_at) { this._srvUpdated = this._srvUpdated || new Map(); this._srvUpdated.set(id, row.updated_at); }
      if (!cur) { this._trucks.set(id, next); this._srv.set(id, this._snap(next)); return true; }
      const before = sig([cur.name, cur.cuisines, cur.bio, cur.payments, cur.phone, cur.instagram, cur.facebook, cur.logo, cur.color, cur.gallery, cur.dish, cur.products, cur.planning, cur.weekly, SERVER_FIELDS.map((f) => cur[f])]);
      if (!force && this._busy(id)) SERVER_FIELDS.forEach((f) => { cur[f] = next[f]; });
      else { const team = cur.team; Object.assign(cur, next); cur.team = team; this._srv.set(id, this._snap(next)); }
      const after = sig([cur.name, cur.cuisines, cur.bio, cur.payments, cur.phone, cur.instagram, cur.facebook, cur.logo, cur.color, cur.gallery, cur.dish, cur.products, cur.planning, cur.weekly, SERVER_FIELDS.map((f) => cur[f])]);
      return before !== after;
    }
    _snap(t) { const o = {}; COLS.forEach((c) => { o[c] = colJson(t, c); }); return o; }
    _gc() {
      const keep = new Set([...this._managed, ...this._admin, ...this._extra]);
      this._favSet.forEach((id) => { if (this._trucks.has(id)) keep.add(id); });
      this._areas.forEach((a) => a.ids.forEach((id) => keep.add(id)));
      [...this._trucks.keys()].forEach((id) => { if (!keep.has(id) && !this._busy(id)) { this._trucks.delete(id); this._srv.delete(id); } });
      this.db.trucks = [...this._trucks.values()];
    }
    getTruck(id) { return this._trucks.get(id) || null; }
    async fetchTruck(id) {
      if (this._trucks.has(id)) return this._trucks.get(id);
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
      try {
        const rows = await this.api.select('trucks', { select: '*', id: 'eq.' + id });
        if (!rows[0]) return null;
        this._upsert(rows[0]); this._extra.add(id); this._gc(); this._changed(); return this._trucks.get(id);
      } catch (e) { return null; }
    }
    refreshTruck(id) { return this._busy(id) ? Promise.resolve() : this._reloadTruck(id); }
    async _reloadTruck(id) {
      try {
        const rows = await this.api.select('trucks', { select: '*', id: 'eq.' + id });
        if (!rows[0]) { this._managed.delete(id); this._extra.delete(id); this._areas.forEach((a) => a.ids.delete(id)); this._trucks.delete(id); this._srv.delete(id); }
        else { this._dirty.delete(id); this._upsert(rows[0], true); }
        this._gc(); this._changed();
      } catch (e) { /* on réessaiera à la prochaine synchro */ }
    }
    managedTrucks(userId) { return this.db.trucks.filter((t) => t.ownerId === userId || this._memberOf.has(t.id) || (t.team || []).includes(userId)); }
    canManage(userId, truck) { const u = this.getUser(userId); return !!(u && truck && (u.role === 'admin' || truck.ownerId === userId || this._memberOf.has(truck.id) || (truck.team || []).includes(userId))); }
    isSuspect(id) { const t = this.getTruck(id); return !!(t && t.suspect); }
    reportCount(id) { const t = this.getTruck(id); return t ? t.reportCount : 0; }
    rating(id) { const t = this.getTruck(id); return t && t.ratingCount ? { avg: t.ratingAvg, count: t.ratingCount } : { avg: 0, count: 0 }; }
    followerCount(id) { const t = this.getTruck(id); return t ? t.followerCount : 0; }
    followerIds() { return []; }

    /* ---- recherche autour d'un point */
    ensureArea(center, radiusKm) {
      if (!center || !isFinite(center.lat) || !isFinite(center.lng) || !C.isInFrance(center.lat, center.lng)) return;
      const need = Math.max(Number(radiusKm) || 12, 5); const now = Date.now();
      const hit = this._areas.find((a) => now - a.fullAt < AREA_TTL && C.haversine(a.center.lat, a.center.lng, center.lat, center.lng) + need <= a.R);
      if (hit) { hit.used = now; return; }
      if (now - this._areaFailAt < 15000 || this._areaBusy) return;
      clearTimeout(this._areaTimer);
      this._areaTimer = this._timer(() => this._loadArea(center, need), 300);
    }
    async _loadArea(center, need) {
      if (!this._me && !this._guest) return;
      this._areaBusy = true; const R = Math.min(300, Math.max(need * 1.5, 15));
      try {
        const rows = await this.api.rpc('nearby_trucks', { p_lat: center.lat, p_lng: center.lng, p_radius_km: R });
        const list = Array.isArray(rows) ? rows : [];
        const ids = new Set(); let since = '';
        list.forEach((r) => { this._upsert(r, true); ids.add(r.id); if (r.updated_at > since) since = r.updated_at; });
        this._areas = this._areas.filter((a) => !(C.haversine(a.center.lat, a.center.lng, center.lat, center.lng) < 1 && Math.abs(a.R - R) < 1));
        this._areas.push({ center: { lat: center.lat, lng: center.lng }, R, ids, since: since || '1970-01-01T00:00:00Z', fullAt: Date.now(), used: Date.now() });
        this._areas.sort((a, b) => b.used - a.used); this._areas = this._areas.slice(0, MAX_AREAS);
        this._gc(); this._changed();
      } catch (e) { this._areaFailAt = Date.now(); if (isTransient(e)) this._setSync('offline'); }
      finally { this._areaBusy = false; }
      this._loadListings(center, R).then((c) => { if (c) this._changed(); }).catch(() => { /* la carte marche sans */ });
    }
    async _syncAreas() {
      let changed = false;
      for (const a of this._areas) {
        const dlat = a.R / 111, dlng = a.R / (111 * Math.max(Math.cos(a.center.lat * Math.PI / 180), 0.01));
        const rows = await this.api.select('trucks', {
          select: '*', updated_at: 'gt.' + a.since, bbox_max_lat: 'gte.' + (a.center.lat - dlat), bbox_min_lat: 'lte.' + (a.center.lat + dlat),
          bbox_max_lng: 'gte.' + (a.center.lng - dlng), bbox_min_lng: 'lte.' + (a.center.lng + dlng), order: 'updated_at.asc', limit: 300,
        });
        rows.forEach((r) => { if (this._upsert(r)) changed = true; a.ids.add(r.id); if (r.updated_at > a.since) a.since = r.updated_at; });
      }
      return changed;
    }

    /* ---- synchronisation périodique (seulement ce qui a changé) */
    async sync(opts) {
      const guest = !this._me && this._guest;
      if ((!this._me && !guest) || this._syncing) return; this._syncing = true;
      const full = !!(opts && opts.full) || Date.now() - this._fullAt > 300000;
      try {
        this._retryDirty();
        let changed = false;
        const jobs = [this._syncAreas().then((c) => { changed = changed || c; })];
        if (!guest) {
          jobs.push(this._syncNotifs().then((c) => { changed = changed || c; }));
          // les demandes d'affiche se chargent une fois les fiches gérées connues (juste après la connexion, _managed est encore vide au départ)
          jobs.push(this._syncMine(full).then(async (c) => {
            changed = changed || c;
            if (this._managed.size && Date.now() - this._posterAt > 120000) { try { if (await this._loadPosters()) changed = true; } catch (e) { /* sans importance : nouvel essai à la prochaine synchro */ } }
          }));
        }
        if (this._listAreas.length && Date.now() - this._listAt > 600000) jobs.push(this._refreshListings().then((c) => { changed = changed || c; }).catch(() => false));
        if (Date.now() - this._eventsAt > 120000) jobs.push(this._loadEvents().then((c) => { changed = changed || c; }));
        if (!guest && Date.now() - this._teamAt.get('all') > 300000) jobs.push(this._loadTeams().then((c) => { changed = changed || c; }));
        if (!guest && Date.now() - this._billAt > (this._billing && this._billing.enabled ? 60000 : 300000)) jobs.push(this._loadBilling().then((c) => { changed = changed || c; }));
        if (!guest && this._me.role === 'admin') jobs.push(this._loadAdmin().then((c) => { changed = changed || c; }));
        await Promise.all(jobs);
        if (full) this._fullAt = Date.now();
        if (changed) { this._gc(); this._changed(); } else this._gc();
        this._setSync('ok');
      } catch (e) {
        if (isTransient(e)) this._setSync('offline');
        else if (e instanceof ApiError && e.status === 401) { /* session expirée : gérée par l'API */ }
      } finally { this._syncing = false; }
    }
    async _syncMine(full) {
      let changed = false; const ids = [...new Set([...this._managed, ...this._favSet])].filter((id) => !this._busy(id));
      for (const part of chunk(ids, 40)) {
        const q = { select: '*', id: 'in.(' + part.join(',') + ')' }; if (this._mineSince && !full) q.updated_at = 'gt.' + this._mineSince;
        const rows = await this.api.select('trucks', q);
        rows.forEach((r) => { if (this._upsert(r)) changed = true; if (r.updated_at > (this._mineSince || '')) this._mineSince = r.updated_at; });
        if (full) { // une fiche suivie qui n'est plus renvoyée a été masquée ou supprimée : on l'oublie
          const seen = new Set(rows.map((r) => r.id));
          part.forEach((id) => { if (!seen.has(id) && !this._managed.has(id)) { this._extra.delete(id); this._areas.forEach((a) => a.ids.delete(id)); this._trucks.delete(id); this._srv.delete(id); changed = true; } });
        }
      }
      // profil (rôle, nom…) et abonnements modifiés depuis un autre appareil
      const [prof, follows] = await Promise.all([
        this.api.select('profiles', { id: 'eq.' + this._me.id, select: 'id,role,name,prefs,seen_notif_at,deletion_requested_at' }),
        this.api.select('follows', { select: 'truck_id', user_id: 'eq.' + this._me.id }),
      ]);
      const favs = follows.map((f) => f.truck_id).sort(); const p = prof[0];
      const delAt = p && p.deletion_requested_at ? ms(p.deletion_requested_at) : 0;
      if (p && (p.role !== this._me.role || p.name !== this._me.name || delAt !== (this._me.deletionRequestedAt || 0) || sig(favs) !== sig([...this._me.favorites].sort()))) {
        const missing = favs.filter((id) => !this._trucks.has(id));
        for (const part of chunk(missing, 40)) (await this.api.select('trucks', { select: '*', id: 'in.(' + part.join(',') + ')' })).forEach((r) => { this._upsert(r, true); this._extra.add(r.id); });
        this._setMe(Object.assign({}, this._me, { role: p.role, name: p.name, deletionRequestedAt: delAt, favorites: favs })); this._save(); changed = true;
      }
      return changed;
    }

    /* ---- alertes */
    _setNotifs(rows, full) {
      const list = rows.map(mapNotif); const before = sig(this.db.notifications.map((n) => [n.id, n.read]));
      rows.forEach((r) => { if (!this._notifSince || r.created_at > this._notifSince) this._notifSince = r.created_at; });
      const byId = new Map(); if (!full) this.db.notifications.filter((n) => !String(n.id).startsWith('local:')).forEach((n) => byId.set(n.id, n));
      list.forEach((n) => byId.set(n.id, n));
      const keys = new Set([...byId.values()].filter((n) => n.key).map((n) => n.key));
      this.db.notifications.filter((n) => String(n.id).startsWith('local:') && !keys.has(n.key)).forEach((n) => byId.set(n.id, n));
      this.db.notifications = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 150);
      return before !== sig(this.db.notifications.map((n) => [n.id, n.read]));
    }
    async _syncNotifs() {
      const q = { select: '*', user_id: 'eq.' + this._me.id, order: 'created_at.desc', limit: 100 };
      if (this._notifSince) q.created_at = 'gt.' + this._notifSince;
      const rows = await this.api.select('notifications', q);
      return rows.length ? this._setNotifs(rows, false) : false;
    }
    markRead(id) {
      const n = this.db.notifications.find((x) => x.id === id); if (!n || n.read) return; n.read = true; this._changed();
      if (!String(id).startsWith('local:')) this._chain('notifs', async () => { try { await this.api.patch('notifications', { id: 'eq.' + id }, { read: true }); } catch (e) { /* ignore */ } });
    }
    markAllRead(userId) {
      let any = false; this.db.notifications.forEach((n) => { if (n.userId === userId && !n.read) { n.read = true; any = true; } });
      if (any) this._chain('notifs', async () => { try { await this.api.patch('notifications', { user_id: 'eq.' + userId, read: 'eq.false' }, { read: true }); } catch (e) { /* ignore */ } });
      this._changed();
    }
    /** Un favori s'installe près de la position (calculé sur l'appareil, la position n'est jamais envoyée). */
    proximityAlerts(userId, pos) {
      const u = this.getUser(userId); if (!u || !pos || (u.prefs && u.prefs.alertsEnabled === false)) return [];
      const maxKm = (u.prefs && u.prefs.alertKm) || 3; const created = []; const now = this.now();
      (u.favorites || []).forEach((tid) => {
        const t = this.getTruck(tid); if (!t || t.hidden) return;
        const m = this.matchSlots(t, 'tonight').find((x) => ['open', 'soon'].includes(x.status)); if (!m) return;
        const d = C.haversine(pos.lat, pos.lng, m.slot.place.lat, m.slot.place.lng); if (d > maxKm) return;
        const key = ('prox:' + u.id + ':' + m.slot.id + ':' + m.key).slice(0, 160);
        if (this._proxSent.has(key) || this.db.notifications.some((n) => n.key === key)) return;
        this._proxSent.add(key);
        const text = (t.name + ' s’installe à ' + C.fmtDist(d) + ' de vous : ' + m.slot.place.name + ', ' + C.fmtHours(m.slot) + '.').slice(0, 300);
        const n = { id: 'local:' + key, userId: u.id, truckId: t.id, type: 'proximity', createdAt: +now, read: false, key, text };
        this.db.notifications.unshift(n); created.push(n);
        this._chain('prox', async () => { try { await this.api.rpc('add_proximity_alert', { p_truck: t.id, p_key: key, p_text: text }); } catch (e) { /* ignore */ } });
      });
      if (created.length) this._changed();
      return created;
    }
    /** Prévenir les abonnés : envoyé après l'enregistrement de la fiche, idempotent (clé unique par envoi). */
    notifyFollowers(truck, type, text, key) {
      const k = key || ('n:' + C.uid('k'));
      Promise.resolve().then(() => this._chain('t:' + truck.id, async () => {
        for (let i = 0; i < 4; i++) {
          try { await this.api.rpc('notify_followers', { p_truck: truck.id, p_type: type, p_text: text, p_key: k }); return; }
          catch (e) { if (!isTransient(e) || i === 3) { this.onError(friendly(e).message); return; } await new Promise((r) => this._timer(r, 1500 * (i + 1))); }
        }
      }));
      return truck.followerCount || 0;
    }
    async manualNotify(actorId, truckId, text) {
      const t = this._mustManage(actorId, truckId);
      text = String(text || '').trim(); if (!text) fail('Écrivez un court message pour vos abonnés.');
      const n = await this._try(() => this.api.rpc('notify_followers', { p_truck: truckId, p_type: 'message', p_text: (t.name + ' : ' + text.slice(0, 140)).slice(0, 300), p_key: 'n:' + C.uid('k') }));
      return Number(n) || 0;
    }

    /* ---- envoi des modifications d'une fiche */
    _diff(t) {
      const srv = this._srv.get(t.id) || {}; const patch = {}; let any = false;
      COLS.forEach((c) => { const j = colJson(t, c); if (j !== srv[c]) { patch[c] = JSON.parse(j); any = true; } });
      return any ? patch : null;
    }
    _pushTruck(id) {
      this._pend.set(id, (this._pend.get(id) || 0) + 1);
      this._chain('t:' + id, async () => { try { await this._doPush(id); } finally { this._pend.set(id, Math.max(0, (this._pend.get(id) || 1) - 1)); } });
    }
    async _doPush(id) {
      const t = this._trucks.get(id); if (!t) return;
      const patch = this._diff(t); if (!patch) return;
      const sent = {}; Object.keys(patch).forEach((c) => { sent[c] = JSON.stringify(patch[c]); });
      try {
        const rows = await this.api.patch('trucks', { id: 'eq.' + id }, patch);
        if (!rows[0]) throw Object.assign(new ApiError('Action non autorisée.', 403), { code: '42501' });
        const next = mapTruck(rows[0]); const srv = this._srv.get(id) || {};
        COLS.forEach((c) => { srv[c] = colJson(next, c); }); this._srv.set(id, srv);
        Object.keys(patch).forEach((c) => { if (colJson(t, c) === sent[c]) t[c] = next[c]; });
        SERVER_FIELDS.forEach((f) => { t[f] = next[f]; });
        this._dirty.delete(id); this._retryN = 0; this._setSync('ok'); this._changed();
      } catch (e) {
        if (isTransient(e)) { this._dirty.add(id); this._setSync('offline'); this._scheduleRetry(); return; }
        this.onError(friendly(e).message); this._dirty.delete(id); await this._reloadTruck(id);
      }
    }
    _scheduleRetry() {
      if (this._retryTimer) return; const wait = [2000, 5000, 15000, 30000, 60000][Math.min(this._retryN, 4)]; this._retryN++;
      this._retryTimer = this._timer(() => { this._retryTimer = null; this._retryDirty(); }, wait);
    }
    _retryDirty() { [...this._dirty].forEach((id) => this._pushTruck(id)); }

    /* ---- fiche : édition (appliquée localement puis envoyée) */
    _after(truckId, res) { this._pushTruck(truckId); return res; }
    async _logoUrl(truckId, dataUrl) {
      if (!dataUrl || !/^data:image\//.test(dataUrl)) return dataUrl || null;
      const { bytes, type } = dataUrlToBytes(dataUrl);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) fail('Image invalide (JPEG, PNG ou WebP).');
      if (bytes.length > 600000) fail('Image trop volumineuse (600 Ko maximum).');
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      return this._try(() => this.api.upload(truckId + '/' + C.uid('f').replace('_', '-') + '.' + ext, bytes, type));
    }
    _mediaPath(url) { const p = this.api.publicUrl(''); return typeof url === 'string' && url.startsWith(p) ? url.slice(p.length) : null; }
    async createTruck(ownerId, p) {
      if (!this._me || ownerId !== this._me.id) fail('Compte introuvable.');
      const t = { name: '', cuisines: [], bio: '', payments: [], phone: '', instagram: '', facebook: '', logo: null, color: null };
      this._cleanTruckFields(p, t);
      if (!t.name) fail('Le nom du food truck est obligatoire.');
      if (!t.cuisines.length) fail('Choisissez au moins un type de cuisine.');
      const color = t.color || C.AVATAR_COLORS[this.db.trucks.length % C.AVATAR_COLORS.length];
      const rows = await this._try(() => this.api.insert('trucks', Object.assign({ owner_id: ownerId, name: t.name, cuisines: t.cuisines, bio: t.bio, payments: t.payments, phone: t.phone, color }, t.instagram ? { instagram: t.instagram } : {}, t.facebook ? { facebook: t.facebook } : {})));
      if (!rows[0]) fail('Création impossible. Réessayez.');
      this._upsert(rows[0], true); this._managed.add(rows[0].id); this._gc();
      const truck = this._trucks.get(rows[0].id);
      if (t.logo) {
        try { truck.logo = await this._logoUrl(truck.id, t.logo); this._pushTruck(truck.id); }
        catch (e) { this.onError('Fiche créée, mais le logo n’a pas pu être envoyé : ' + friendly(e).message); }
      }
      this._changed(); return truck;
    }
    async updateTruck(actorId, truckId, patch) {
      this._mustManage(actorId, truckId);
      const p = Object.assign({}, patch); const old = this.getTruck(truckId).logo;
      if (p.logo && /^data:image\//.test(p.logo)) p.logo = await this._logoUrl(truckId, p.logo);
      const t = super.updateTruck(actorId, truckId, p);
      const oldPath = old && old !== t.logo ? this._mediaPath(old) : null;
      this._pushTruck(truckId);
      if (oldPath) this._chain('t:' + truckId, async () => { await this.api.removeObject(oldPath); });
      return t;
    }
    upsertProduct(a, tid, p) { return this._after(tid, super.upsertProduct(a, tid, p)); }
    removeProduct(a, tid, pid) { return this._after(tid, super.removeProduct(a, tid, pid)); }
    setProductAvailable(a, tid, pid, v, notify) { return this._after(tid, super.setProductAvailable(a, tid, pid, v, notify)); }
    async addPhoto(actorId, truckId, dataUrl) {
      const t = this._mustManage(actorId, truckId);
      if (t.gallery.length >= C.MAX_PHOTOS) fail('Galerie pleine (' + C.MAX_PHOTOS + ' photos maximum).');
      if (!/^data:image\//.test(dataUrl)) fail('Image invalide.');
      const url = await this._logoUrl(truckId, dataUrl);
      t.gallery.push(url); this._changed(); this._pushTruck(truckId);
    }
    removePhoto(actorId, truckId, idx) {
      const t = this._mustManage(actorId, truckId); const url = t.gallery[idx];
      super.removePhoto(actorId, truckId, idx); this._pushTruck(truckId);
      const path = this._mediaPath(url); if (path) this._chain('t:' + truckId, async () => { await this.api.removeObject(path); });
    }
    setDish(a, tid, d) { return this._after(tid, super.setDish(a, tid, d)); }
    setDay(a, tid, key, day, opts) { return this._after(tid, super.setDay(a, tid, key, day, opts)); }
    clearDay(a, tid, key) { return this._after(tid, super.clearDay(a, tid, key)); }
    duplicateDay(a, tid, f, to) { return this._after(tid, super.duplicateDay(a, tid, f, to)); }
    goLive(a, tid, o) { return this._after(tid, super.goLive(a, tid, o)); }
    moveLive(a, tid, pl, n) { return this._after(tid, super.moveLive(a, tid, pl, n)); }
    delayService(a, tid, m, n) { return this._after(tid, super.delayService(a, tid, m, n)); }
    endService(a, tid) { return this._after(tid, super.endService(a, tid)); }
    cancelTonight(a, tid, r, n) { return this._after(tid, super.cancelTonight(a, tid, r, n)); }
    restoreTonight(a, tid) { return this._after(tid, super.restoreTonight(a, tid)); }

    /* ---- équipe */
    async _loadTeams() {
      let changed = false;
      for (const id of this._managed) {
        const rows = await this.api.rpc('team_of', { p_truck: id }); const t = this._trucks.get(id); if (!t || !Array.isArray(rows)) continue;
        const team = rows.filter((r) => !r.is_owner).map((r) => r.user_id);
        if (sig(team) !== sig(t.team)) { t.team = team; changed = true; }
        rows.forEach((r) => { if (r.user_id !== this._me.id && !this.db.users.some((u) => u.id === r.user_id)) this.db.users.push({ id: r.user_id, role: 'client', name: r.name, email: '', favorites: [], prefs: {} }); });
      }
      this._teamAt.set('all', Date.now()); return changed;
    }
    async addTeamMember(actorId, truckId, email) {
      const t = this._mustManage(actorId, truckId);
      if (t.ownerId !== actorId && this.getUser(actorId).role !== 'admin') fail('Seul le propriétaire peut gérer l’équipe.');
      email = String(email || '').trim(); if (!email) fail('Indiquez l’adresse e-mail du membre.');
      const m = await this._try(() => this.api.rpc('add_team_member', { p_truck: truckId, p_email: email }));
      if (!t.team.includes(m.id)) t.team.push(m.id);
      if (!this.db.users.some((u) => u.id === m.id)) this.db.users.push({ id: m.id, role: 'client', name: m.name, email: '', favorites: [], prefs: {} });
      this._changed(); return { id: m.id, name: m.name };
    }
    async removeTeamMember(actorId, truckId, memberId) {
      const t = this._mustManage(actorId, truckId);
      await this._try(() => this.api.rpc('remove_team_member', { p_truck: truckId, p_member: memberId }));
      t.team = t.team.filter((x) => x !== memberId);
      if (memberId === this._me.id) { this._memberOf.delete(truckId); this._managed.delete(truckId); this._gc(); }
      this._changed();
    }
    async deleteTruck(actorId, truckId) {
      this._mustManage(actorId, truckId);
      await this._try(() => this.api.rpc('delete_truck', { p_truck: truckId }));
      this._managed.delete(truckId); this._extra.delete(truckId); this._admin.delete(truckId); this._areas.forEach((a) => a.ids.delete(truckId)); this._favSet.delete(truckId);
      this._me.favorites = this._me.favorites.filter((x) => x !== truckId);
      this.db.reviews = this.db.reviews.filter((r) => r.truckId !== truckId); this._trucks.delete(truckId); this._srv.delete(truckId); this._gc(); this._changed();
    }

    /* ---- favoris */
    toggleFollow(userId, truckId) {
      const u = this.getUser(userId); const t = this.getTruck(truckId); if (!u || !t) fail('Action impossible.');
      const i = u.favorites.indexOf(truckId); const adding = i < 0;
      if (adding) u.favorites.push(truckId); else u.favorites.splice(i, 1);
      this._favSet = new Set(u.favorites); t.followerCount = Math.max(0, (t.followerCount || 0) + (adding ? 1 : -1));
      this._changed();
      this._chain('follow', async () => {
        try {
          const now = await this.api.rpc('toggle_follow', { p_truck: truckId });
          if (typeof now === 'boolean' && now !== this._favSet.has(truckId)) { // le serveur dit autre chose : on s'aligne
            if (now) u.favorites.push(truckId); else u.favorites = u.favorites.filter((x) => x !== truckId);
            this._favSet = new Set(u.favorites); this._changed();
          }
          this._save();
        } catch (e) {
          if (isTransient(e)) { this.onError('Connexion perdue : l’abonnement n’a pas été enregistré.'); }
          else this.onError(friendly(e).message);
          if (adding) u.favorites = u.favorites.filter((x) => x !== truckId); else u.favorites.push(truckId);
          this._favSet = new Set(u.favorites); this._reloadTruck(truckId); this._changed();
        }
      });
      this._save(); return adding;
    }

    /* ---- avis */
    reviewsOf(truckId) {
      const at = this._reviewsAt.get(truckId) || 0;
      if (Date.now() - at > 30000 && (this._me || this._guest)) { this._reviewsAt.set(truckId, Date.now()); this._loadReviews(truckId); }
      return this.db.reviews.filter((r) => r.truckId === truckId).sort((a, b) => b.createdAt - a.createdAt);
    }
    async _loadReviews(truckId) {
      try {
        const rows = await this.api.select('reviews', { select: '*', truck_id: 'eq.' + truckId, order: 'created_at.desc', limit: 60 });
        const next = rows.map(mapReview); const old = this.db.reviews.filter((r) => r.truckId === truckId);
        if (sig(old.map((r) => [r.id, r.rating, r.text, r.reply, r.editedAt]).sort()) === sig(next.map((r) => [r.id, r.rating, r.text, r.reply, r.editedAt]).sort())) return;
        this.db.reviews = this.db.reviews.filter((r) => r.truckId !== truckId).concat(next); this._changed();
      } catch (e) { this._reviewsAt.set(truckId, 0); }
    }
    async addReview(userId, truckId, rating, text) {
      const u = this.getUser(userId); const t = this.getTruck(truckId); if (!u || !t) fail('Action impossible.');
      if (this.canManage(userId, t)) fail('Vous ne pouvez pas noter votre propre food truck.');
      rating = Math.round(Number(rating)); if (!(rating >= 1 && rating <= 5)) fail('Choisissez une note de 1 à 5 étoiles.');
      text = String(text || '').trim(); if (text.length > 300) fail('Avis trop long (300 caractères maximum).');
      const row = await this._try(() => this.api.rpc('upsert_review', { p_truck: truckId, p_rating: rating, p_text: text }));
      const r = mapReview(row); this.db.reviews = this.db.reviews.filter((x) => x.id !== r.id && !(x.truckId === truckId && x.userId === userId)).concat([r]);
      this._reviewsAt.set(truckId, Date.now()); this._reloadTruck(truckId); this._changed(); return r;
    }
    async replyReview(actorId, reviewId, text) {
      const r = this.db.reviews.find((x) => x.id === reviewId); if (!r) fail('Avis introuvable.');
      this._mustManage(actorId, r.truckId);
      await this._try(() => this.api.rpc('reply_review', { p_review: reviewId, p_text: String(text || '') }));
      text = String(text || '').trim(); r.reply = text ? { text: text.slice(0, 300), at: Date.now() } : null; this._changed();
    }
    async deleteReview(actorId, reviewId) {
      const r = this.db.reviews.find((x) => x.id === reviewId); if (!r) return;
      await this._try(() => this.api.del('reviews', { id: 'eq.' + reviewId }));
      this.db.reviews = this.db.reviews.filter((x) => x.id !== reviewId); this.db.reports = this.db.reports.filter((x) => !(x.targetType === 'review' && x.targetId === reviewId));
      this._reloadTruck(r.truckId); this._changed();
    }

    /* ---- signalements et modération */
    async report(userId, { targetType, targetId, reason, comment }) {
      if (!this.getUser(userId)) fail('Connectez-vous pour signaler.');
      if (!['truck', 'review', 'event'].includes(targetType)) fail('Cible inconnue.');
      if (!C.REPORT_REASONS.some((r) => r.id === reason)) fail('Choisissez un motif.');
      const res = await this._try(() => this.api.rpc('report_target', { p_type: targetType, p_id: targetId, p_reason: reason, p_comment: String(comment || '').trim().slice(0, 300) }));
      if (targetType === 'truck') this._reloadTruck(targetId);
      return targetType === 'truck' ? { count: res && res.count || 0, suspect: !!(res && res.suspect) } : {};
    }
    openReports() { return this.db.reports.filter((r) => !r.resolved).sort((a, b) => b.createdAt - a.createdAt); }
    async resolveReports(adminId, targetType, targetId, action) {
      const a = this.getUser(adminId); if (!a || a.role !== 'admin') fail('Action réservée à l’administration.');
      await this._try(() => this.api.rpc('resolve_reports', { p_type: targetType, p_id: targetId, p_action: action || 'dismiss' }));
      this.db.reports = this.db.reports.filter((r) => !(r.targetType === targetType && r.targetId === targetId));
      if (action === 'hide' && targetType === 'truck') { const t = this.getTruck(targetId); if (t) t.hidden = true; }
      if (action === 'delete' && targetType === 'review') this.db.reviews = this.db.reviews.filter((r) => r.id !== targetId);
      if (action === 'delete' && targetType === 'event') this.db.events = this.db.events.filter((e) => e.id !== targetId);
      if (targetType === 'truck') this._reloadTruck(targetId);
      this._changed();
    }
    async setHidden(adminId, truckId, hidden) { await this._try(() => this.api.rpc('set_hidden', { p_truck: truckId, p_hidden: !!hidden })); const t = this.getTruck(truckId); if (t) t.hidden = !!hidden; this._changed(); }
    async setVerified(adminId, truckId, v) { await this._try(() => this.api.rpc('set_verified', { p_truck: truckId, p_verified: !!v })); const t = this.getTruck(truckId); if (t) t.verified = !!v; this._changed(); }
    async _loadAdmin() {
      const [reports, trucks, overview, audience, delReq, listAdmin] = await Promise.all([
        this.api.select('reports', { select: '*', resolved: 'eq.false', order: 'created_at.desc', limit: 300 }),
        this.api.select('trucks', { select: '*', order: 'created_at.desc', limit: 500 }),
        this.api.rpc('admin_overview'),
        this.api.rpc('admin_audience').catch(() => null),          // script SQL 4 pas encore exécuté : on s'en passe
        this.api.rpc('admin_deletion_requests').catch(() => null), // script SQL 6 pas encore exécuté : on s'en passe
        this.api.rpc('admin_listings').catch(() => null),          // script SQL 12 pas encore exécuté : on s'en passe
      ]);
      let changed = false;
      if (await this._loadAdminPosters().catch(() => false)) changed = true;
      if (Array.isArray(delReq)) {
        const list = delReq.map((r) => ({ id: r.id, name: r.name, role: r.role, email: r.email || '', requestedAt: ms(r.requested_at), trucks: r.trucks || [], reviews: +r.reviews || 0 }));
        if (sig(list) !== sig(this._delReq || [])) { this._delReq = list; changed = true; }
      }
      if (listAdmin && Array.isArray(listAdmin.removals)) {
        const lr = listAdmin.removals.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, name: r.name, role: r.role, email: r.email || '', message: r.message || '', instagram: r.instagram || '', slug: r.slug || '', requestedAt: ms(r.created_at) }));
        if (sig(lr) !== sig(this._listRem || [])) { this._listRem = lr; changed = true; }
      }
      this._admin = new Set(trucks.map((r) => r.id)); trucks.forEach((r) => { if (this._upsert(r, true)) changed = true; });
      const rep = reports.map(mapReport); if (sig(rep) !== sig(this.db.reports)) { this.db.reports = rep; changed = true; }
      const revIds = [...new Set(rep.filter((r) => r.targetType === 'review').map((r) => r.targetId))].filter((id) => !this.db.reviews.some((x) => x.id === id));
      for (const part of chunk(revIds, 40)) { const rows = await this.api.select('reviews', { select: '*', id: 'in.(' + part.join(',') + ')' }); this.db.reviews.push(...rows.map(mapReview)); changed = true; }
      const owners = [...new Set(trucks.map((t) => t.owner_id))].filter((id) => !this.db.users.some((u) => u.id === id));
      for (const part of chunk(owners, 40)) { const rows = await this.api.select('profiles', { select: 'id,name,role', id: 'in.(' + part.join(',') + ')' }); rows.forEach((p) => this.db.users.push({ id: p.id, role: p.role, name: p.name, email: '', favorites: [], prefs: {} })); changed = true; }
      if (overview && sig(overview) !== sig(this.adminStats)) { this.adminStats = overview; changed = true; }
      if (audience && sig(audience) !== sig(this.audienceData)) { this.audienceData = audience; changed = true; }
      if (await this._loadActivity().catch(() => false)) changed = true;
      return changed;
    }

    /* ---- journal d'activité (administration) : lignes écrites par la base, lues par l'administrateur uniquement */
    async _loadActivity() {
      if (!this.db.activity) this.db.activity = [];
      const q = { select: '*', order: 'id.desc', limit: 100 }; if (this._actLast) q.id = 'gt.' + this._actLast;
      let rows;
      try { rows = await this.api.select('activity_log', q); }
      catch (e) {
        if (e instanceof ApiError && !e.network && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) { this.activityState = 'missing'; return false; }   // script SQL 3 pas encore exécuté
        throw e;
      }
      const was = this.activityState; this.activityState = 'ok';
      if (!rows.length) return was !== 'ok';
      const list = rows.map(mapActivity); this._actLast = Math.max(this._actLast || 0, ...list.map((a) => a.id));
      const have = new Set(this.db.activity.map((a) => a.id));
      this.db.activity = [...list.filter((a) => !have.has(a.id)), ...this.db.activity].sort((a, b) => b.id - a.id).slice(0, 600);
      return true;
    }
    activityFeed() { return this.db.activity || []; }
    async loadMoreActivity() {
      if (!this.db.activity) this.db.activity = [];
      const last = this.db.activity[this.db.activity.length - 1]; if (!last) return 0;
      const rows = await this._try(() => this.api.select('activity_log', { select: '*', order: 'id.desc', limit: 100, id: 'lt.' + last.id }));
      const have = new Set(this.db.activity.map((a) => a.id));
      this.db.activity.push(...rows.map(mapActivity).filter((a) => !have.has(a.id)));
      this._changed(); return rows.length;
    }

    /* ---- événements */
    async _loadEvents(silent) {
      const today = C.dateKey(this.now());
      const rows = await this.api.select('events', { select: '*,event_trucks(truck_id)', event_date: 'gte.' + today, order: 'event_date.asc,start_time.asc', limit: 200 });
      this._eventsAt = Date.now();
      const next = rows.map(mapEvent); const changed = sig(next) !== sig(this.db.events); this.db.events = next;
      const missing = [...new Set(next.flatMap((e) => e.truckIds))].filter((id) => !this._trucks.has(id)).slice(0, 60);
      for (const part of chunk(missing, 40)) (await this.api.select('trucks', { select: '*', id: 'in.(' + part.join(',') + ')' })).forEach((r) => { this._upsert(r, true); this._extra.add(r.id); });
      if (!silent && changed) this._changed();
      return changed;
    }
    upcomingEvents() { const today = C.dateKey(this.now()); return this.db.events.filter((e) => e.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)); }
    async createEvent(actorId, p) {
      const u = this.getUser(actorId); if (!u) fail('Connectez-vous.');
      if (!(u.role === 'admin' || this.managedTrucks(actorId).length)) fail('Seuls les food trucks peuvent créer un événement.');
      const name = String(p.name || '').trim(); if (!name) fail('Donnez un nom à l’événement.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) fail('Date invalide.');
      if (p.date < C.dateKey(this.now())) fail('La date est passée.');
      if (!C.validHM(p.start) || !C.validHM(p.end)) fail('Horaires invalides.');
      const pl = p.place; if (!pl || typeof pl.lat !== 'number') fail('Choisissez le lieu de l’événement.');
      if (!C.isInFrance(pl.lat, pl.lng)) fail('LocalTruck est disponible en France uniquement pour l’instant.');
      const row = await this._try(() => this.api.rpc('create_event', { p_name: name.slice(0, 80), p_date: p.date, p_start: p.start, p_end: p.end, p_description: String(p.description || '').trim().slice(0, 400), p_place: { name: pl.name || pl.address, address: pl.address || '', lat: pl.lat, lng: pl.lng } }));
      const ev = mapEvent(row); this.db.events.push(ev); this._changed(); return ev;
    }
    async deleteEvent(actorId, eventId) {
      const e = this.db.events.find((x) => x.id === eventId); if (!e) return;
      await this._try(() => this.api.rpc('delete_event', { p_event: eventId }));
      this.db.events = this.db.events.filter((x) => x.id !== eventId); this.db.reports = this.db.reports.filter((x) => !(x.targetType === 'event' && x.targetId === eventId)); this._changed();
    }
    async toggleEventTruck(actorId, eventId, truckId) {
      const e = this.db.events.find((x) => x.id === eventId); if (!e) fail('Événement introuvable.');
      this._mustManage(actorId, truckId);
      const now = await this._try(() => this.api.rpc('toggle_event_truck', { p_event: eventId, p_truck: truckId }));
      e.truckIds = e.truckIds.filter((x) => x !== truckId); if (now) e.truckIds.push(truckId); this._changed(); return !!now;
    }

    /* ---- présence en direct : signal anonyme (numéro de séance au hasard, jamais de nom ni de position) ; le serveur déduit le compte du jeton */
    touchPresence(sid, platform) { return this.api.rpc('touch_presence', { p_sid: sid, p_platform: platform }); }
    async presenceNow() { const n = await this.api.rpc('presence_now'); return Math.max(0, +n || 0); }
    adminPresence() { return this.api.rpc('admin_presence'); }
    adminSecurity() { return this.api.rpc('admin_security'); }
    async adminTestAlert() { await this.api.rpc('admin_test_alert'); }

    /* ---- audience : compteurs anonymes (aucun identifiant n'est envoyé) et zone « Prévenez-moi » */
    trackFunnel(step, platform) { this.api.rpc('track_funnel', { p_step: step, p_platform: platform }).catch(() => {}); }
    audience() { return this.audienceData; }
    myZone() { return this._zone ? Object.assign({}, this._zone) : null; }
    async _loadZone() {
      const uid = this._me && this._me.id; if (!uid) return;
      try {
        const rows = await this.api.select('user_zones', { select: 'lat,lng,radius_km,label', user_id: 'eq.' + uid });
        this._zone = rows[0] ? { lat: rows[0].lat, lng: rows[0].lng, radiusKm: rows[0].radius_km, label: rows[0].label || '' } : null;
      } catch (e) { if (e instanceof ApiError && e.network) throw e; /* script SQL 4 pas encore exécuté : pas de zone */ }
    }
    async setZone(userId, z) {
      if (!this._me || this._me.id !== userId) fail('Compte introuvable.');
      if (!z || !C.isInFrance(z.lat, z.lng)) fail('LocalTruck est disponible en France uniquement pour l’instant.');
      const row = await this._try(() => this.api.rpc('set_zone', { p_lat: z.lat, p_lng: z.lng, p_radius_km: Math.round(z.radiusKm || 2), p_label: String(z.label || '').trim().slice(0, 60) }));
      this._zone = { lat: row.lat, lng: row.lng, radiusKm: row.radius_km, label: row.label || '' }; this._changed(); return this.myZone();
    }
    async clearZone(userId) {
      if (!this._me || this._me.id !== userId) return;
      await this._try(() => this.api.rpc('clear_zone')); this._zone = null; this._changed();
    }

    /* ---- notifications « application fermée » (script SQL 5) : l'appareil de la personne, jamais lisible depuis l'application */
    async pushKey() { try { const k = await this.api.rpc('push_public_key'); return typeof k === 'string' && k ? k : null; } catch (e) { if (e && e.network) throw e; return null; } }      // réseau coupé : on réessaiera ; script SQL 5 absent : pas de clé
    async savePushSubscription(sub) {
      await this._try(() => this.api.rpc('save_push_subscription', { p_endpoint: String(sub.endpoint), p_p256dh: String(sub.p256dh), p_auth: String(sub.auth) }));
    }
    async removePushSubscription(endpoint) { try { await this.api.rpc('remove_push_subscription', { p_endpoint: String(endpoint) }); } catch (e) { /* ignore */ } }

    /* ---- statistiques */
    track(truckId, type, extra) {
      const t = this.getTruck(truckId); const me = this._me; if (!t || !me || !['view', 'route', 'share'].includes(type)) return;
      if (this.canManage(me.id, t)) return;
      let place = ''; const cur = this.summary(t); if (cur && ['open', 'soon'].includes(cur.status)) place = cur.slot.place.name || '';
      this.api.rpc('track_truck', { p_truck: truckId, p_type: type, p_place: String(place).slice(0, 60) }).catch(() => {});
    }
    statsFor(truckId) {
      const c = this._statsCache.get(truckId);
      if ((!c || Date.now() - c.at > 60000) && this._me && !(c && c.loading)) {
        this._statsCache.set(truckId, { rows: c ? c.rows : [], at: c ? c.at : 0, loading: true });
        const from = C.addDaysKey(C.dateKey(this.now()), -6);
        this.api.select('truck_stats', { select: 'day,type,place,n', truck_id: 'eq.' + truckId, day: 'gte.' + from, limit: 1000 }).then((rows) => {
          const prev = this._statsCache.get(truckId); this._statsCache.set(truckId, { rows, at: Date.now(), loading: false });
          if (!prev || sig(prev.rows) !== sig(rows)) this._changed();
        }).catch(() => { this._statsCache.set(truckId, { rows: c ? c.rows : [], at: Date.now() - 45000, loading: false }); });
      }
      const rows = (this._statsCache.get(truckId) || { rows: [] }).rows;
      const keys = Array.from({ length: 7 }, (_, i) => C.addDaysKey(C.dateKey(this.now()), i - 6));
      const sum = (f) => rows.filter(f).reduce((a, r) => a + r.n, 0);
      const perDay = keys.map((k) => ({ key: k, views: sum((r) => r.day === k && r.type === 'view'), routes: sum((r) => r.day === k && r.type === 'route') }));
      const places = {};
      rows.filter((r) => (r.type === 'view' || r.type === 'route') && r.place).forEach((r) => { places[r.place] = (places[r.place] || 0) + r.n * (r.type === 'route' ? 3 : 1); });
      const topPlaces = Object.entries(places).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 4);
      return { views: sum((r) => r.type === 'view'), routes: sum((r) => r.type === 'route'), shares: sum((r) => r.type === 'share'), followers: this.followerCount(truckId), newFollowers: sum((r) => r.type === 'follow') - sum((r) => r.type === 'unfollow'), perDay, topPlaces };
    }

    /* ---- outils de démonstration : inexistants en ligne */
    hasDemo() { return false; }
    seedDemo() { fail('Les données de démonstration ne sont pas disponibles en ligne.'); }
    removeDemo() {}
    async resetAll() { fail('Action impossible en ligne.'); }
  }

  return { Api, CloudStore, ApiError, friendly, isTransient, mapTruck, dataUrlToBytes, makeStorage };
});
