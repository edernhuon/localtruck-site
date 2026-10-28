/* LocalTruck – espace administration : signalements, fiches, carte, journal d'activité, compte. */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui; const App = MFT.App;
  const S = MFT.screens; const U = MFT.util; const store = () => App.store; const me = () => App.user();
  const reasonLabel = (id, type) => ((type === 'review' ? C.REVIEW_REPORT_REASONS : C.REPORT_REASONS).find((r) => r.id === id) || { label: id }).label;

  /* Demandes de suppression de compte : l'administrateur valide (données effacées) ou refuse (compte réactivé). */
  U.deletionCards = function (rebuild) {
    const reqs = store().deletionRequests ? store().deletionRequests() : []; if (!reqs.length) return [];
    const decide = (r, action) => App.guard(async () => {
      const ok = await ui.confirmDialog(action === 'approve'
        ? { title: 'Supprimer définitivement ce compte ?', text: '« ' + r.name + ' » : toutes ses données' + (r.trucks.length ? ' et ses fiches (' + r.trucks.join(', ') + ')' : '') + ' seront effacées. Cette action est irréversible.', okLabel: 'Supprimer définitivement', danger: true }
        : { title: 'Refuser la demande ?', text: '« ' + r.name + ' » retrouvera son compte' + (r.trucks.length ? ' et ses fiches visibles' : '') + ' et en sera informé.', okLabel: 'Refuser la demande' });
      if (!ok) return;
      await store().decideDeletion(me().id, r.id, action); ui.toast(action === 'approve' ? 'Compte supprimé' : 'Demande refusée', 'ok'); rebuild();
    });
    return [h('div', { class: 'sec' }, 'Demandes de suppression de compte (' + reqs.length + ')'),
      h('div', { class: 'list', style: { marginBottom: '16px' } }, reqs.map((r) => h('div', { class: 'card warn', 'data-delreq': r.id },
        h('div', { class: 'row gap8' }, h('span', { class: 'bold' }, r.name), h('span', { class: 'tag' }, r.role === 'truck' ? 'Food truck' : 'Client')),
        h('div', { class: 'tiny muted mt4' }, [r.email, 'demandé ' + ui.ago(r.requestedAt)].filter(Boolean).join(' · ')),
        h('div', { class: 'small mt8' }, (r.trucks.length ? 'Fiche : ' + r.trucks.join(', ') + ' · ' : '') + r.reviews + ' avis'),
        h('div', { class: 'row gap8 mt12' }, h('button', { class: 'btn danger sm', onClick: decide(r, 'approve') }, icon('trash', 16), 'Valider la suppression'), h('button', { class: 'btn sm', onClick: decide(r, 'refuse') }, 'Refuser')))))];
  };

  S.admin_reports = function () {
    const body = h('div', { class: 'scroll pad' });
    function build() {
      const keep = body.scrollTop; const reports = store().openReports(); const groups = new Map(); const delCards = U.deletionCards(build).concat(U.listingRemovalCards ? U.listingRemovalCards(build) : [], []);
      reports.forEach((r) => { const k = r.targetType + ':' + r.targetId; if (!groups.has(k)) groups.set(k, { type: r.targetType, id: r.targetId, items: [] }); groups.get(k).items.push(r); });
      const cards = [...groups.values()].map((g) => {
        let head, actions = [];
        if (g.type === 'truck') {
          const t = store().getTruck(g.id); if (!t) return null; const n = store().reportCount(t.id);
          head = h('div', { class: 'row gap12' }, ui.avatar(t, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'row gap8' }, h('span', { class: 'bold' }, t.name), n > C.SUSPECT_THRESHOLD ? ui.suspectIcon() : null), h('div', { class: 'tiny muted' }, 'Fiche food truck' + (t.hidden ? ' · masquée' : ''))), h('span', { class: 'tag ' + (n > C.SUSPECT_THRESHOLD ? 'sus' : '') }, n + ' signalement' + (n > 1 ? 's' : '')));
          actions = [h('button', { class: 'btn sm', onClick: () => S.openFiche(t.id) }, icon('eye', 16), 'Voir la fiche'), h('button', { class: 'btn sm', onClick: App.guard(async () => { await store().resolveReports(me().id, 'truck', t.id, 'dismiss'); ui.toast('Signalements classés : le point d’exclamation est retiré'); }) }, 'Classer sans suite'), h('button', { class: 'btn danger sm', onClick: App.guard(async () => { await store().resolveReports(me().id, 'truck', t.id, 'hide'); ui.toast('Fiche masquée'); }) }, 'Masquer la fiche')];
        } else if (g.type === 'review') {
          const r = store().db.reviews.find((x) => x.id === g.id); if (!r) return null; const t = store().getTruck(r.truckId);
          head = h('div', null, h('div', { class: 'row gap8' }, ui.stars(r.rating, 15), h('span', { class: 'small bold' }, r.userName), h('span', { class: 'tiny muted' }, '· avis sur ' + (t ? t.name : '?'))), h('div', { class: 'small mt4', style: { userSelect: 'text' } }, r.text || '(sans texte)'));
          actions = [h('button', { class: 'btn danger sm', onClick: App.guard(async () => { await store().resolveReports(me().id, 'review', r.id, 'delete'); ui.toast('Avis supprimé'); }) }, icon('trash', 16), 'Supprimer l’avis'), h('button', { class: 'btn sm', onClick: App.guard(async () => { await store().resolveReports(me().id, 'review', r.id, 'dismiss'); }) }, 'Classer sans suite')];
        } else {
          const e = store().db.events.find((x) => x.id === g.id); if (!e) return null;
          head = h('div', null, h('div', { class: 'bold' }, e.name), h('div', { class: 'tiny muted' }, 'Événement · ' + C.fmtDayLong(e.date) + ' · ' + e.place.name));
          actions = [h('button', { class: 'btn danger sm', onClick: App.guard(async () => { await store().resolveReports(me().id, 'event', e.id, 'delete'); ui.toast('Événement supprimé'); }) }, 'Supprimer l’événement'), h('button', { class: 'btn sm', onClick: App.guard(async () => { await store().resolveReports(me().id, 'event', e.id, 'dismiss'); }) }, 'Classer sans suite')];
        }
        return h('div', { class: 'card' }, head, h('div', { class: 'mt12 col gap8' }, g.items.map((r) => h('div', { class: 'small', style: { borderLeft: '3px solid var(--bd)', paddingLeft: '10px' } }, h('b', null, reasonLabel(r.reason, g.type)), h('span', { class: 'muted' }, ' · ' + r.userName + ' · ' + ui.ago(r.createdAt, store().now())), r.comment ? h('div', { class: 'muted', style: { userSelect: 'text' } }, r.comment) : null))), h('div', { class: 'row gap8 mt12', style: { flexWrap: 'wrap' } }, actions));
      }).filter(Boolean);
      body.replaceChildren(...delCards, h('p', { class: 'muted small', style: { margin: '4px 0 12px' } }, 'Une fiche signalée par plus de ' + C.SUSPECT_THRESHOLD + ' utilisateurs différents affiche automatiquement un point d’exclamation « suspect » aux clients.'),
        cards.length ? h('div', { class: 'list' }, cards) : ui.empty('✅', 'Aucun signalement en attente', 'Tout est calme. Les signalements de fiches, d’avis et d’événements arriveront ici.'), h('div', { style: { height: '24px' } }));
      body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Signalements')), body), refresh: build, onMount: build };
  };

  S.admin_trucks = function () {
    let q = ''; const body = h('div', { class: 'scroll pad' }); const list = h('div', { class: 'list mt12' });
    const input = h('input', { type: 'search', placeholder: 'Rechercher une fiche', onInput: (e) => { q = C.norm(e.target.value); draw(); } });
    function draw() {
      const trucks = store().db.trucks.filter((t) => !q || C.norm(t.name + ' ' + t.cuisines.join(' ')).includes(q));
      list.replaceChildren(...(trucks.length ? trucks.map((t) => { const n = store().reportCount(t.id); const owner = store().getUser(t.ownerId);
        return h('div', { class: 'item', onClick: () => S.openFiche(t.id) }, ui.avatar(t, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'row gap8' }, h('span', { class: 't ell' }, t.name), n > C.SUSPECT_THRESHOLD ? ui.suspectIcon() : null), h('div', { class: 's ell' }, (owner && (owner.email || owner.name)) || (t.demo ? 'démo' : '')), h('div', { class: 'row gap8 mt4', style: { flexWrap: 'wrap' } }, t.verified ? h('span', { class: 'tag ver' }, 'Vérifié') : h('span', { class: 'tag unv' }, 'Non vérifié'), t.hidden ? h('span', { class: 'tag cancelled' }, 'Masquée') : null, n ? h('span', { class: 'tag' + (n > C.SUSPECT_THRESHOLD ? ' sus' : '') }, n + ' signalement' + (n > 1 ? 's' : '')) : null, t.demo ? h('span', { class: 'tag' }, 'démo') : null)), icon('right')); }) : [ui.empty('🚚', 'Aucune fiche', q ? 'Aucun résultat pour cette recherche.' : 'Les fiches des food trucks apparaîtront ici.')]));
    }
    function build() { draw(); }
    body.append(h('div', { class: 'searchbar', style: { marginTop: '4px' } }, icon('search', 20), input), list);
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Fiches')), body), refresh: build, onMount: build };
  };

  /* ---- Audience : compteurs anonymes (ouvertures, comptes, installations…) et zones « Prévenez-moi » */
  const FUNNEL_STEPS = [
    ['visit', 'Ouvertures'], ['fiche', 'Fiches consultées'], ['wall', 'Compte demandé (sans compte)'], ['signup', 'Comptes clients créés'],
    ['follow', 'Food trucks suivis'], ['zone', 'Zones « Prévenez-moi »'], ['install_shown', 'Installation proposée'], ['install_click', 'Installation touchée'], ['installed', 'Installations terminées'],
  ];
  const PLATFORM_NAMES = { web: 'site', pwa: 'site installé', apk: 'APK' };
  const pct = (a, b) => (b ? (Math.round(a / b * 1000) / 10).toString().replace('.', ',') + ' %' : '–');
  U.audienceCard = function () {
    const a = store().audience && store().audience(); if (!a) return null;
    const rows = a.funnel || []; const sum = (step, k) => rows.filter((r) => r.step === step).reduce((t, r) => t + (r[k] || 0), 0);
    const split = (step) => ['web', 'pwa', 'apk'].map((p) => [p, rows.filter((r) => r.step === step && r.platform === p).reduce((t, r) => t + (r.d30 || 0), 0)]).filter(([, n]) => n).map(([p, n]) => PLATFORM_NAMES[p] + ' ' + n).join(' · ');
    const cell = (txt, bold) => h(bold ? 'b' : 'span', { class: bold ? '' : 'small muted', style: { width: '44px', textAlign: 'right', flex: 'none' } }, txt);
    const line = ([step, label]) => h('div', { class: 'kv', style: { alignItems: 'flex-start', gap: '6px' }, 'data-step': step },
      h('span', { class: 'muted grow', style: { minWidth: 0 } }, label, split(step) ? h('div', { class: 'tiny' }, split(step)) : null), cell(sum(step, 'd7')), cell(sum(step, 'd30'), true));
    const zones = a.zone_top || [];
    return h('div', null,
      h('div', { class: 'sec' }, 'Audience (anonyme)'),
      h('div', { class: 'card' },
        h('div', { class: 'kv', style: { gap: '6px', paddingTop: 0 } }, h('span', { class: 'grow' }), cell('7 j'), cell('30 j')),
        FUNNEL_STEPS.map(line),
        h('div', { class: 'sep', style: { margin: '10px 0' } }),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Ouvertures → comptes créés (30 j)'), h('b', null, pct(sum('signup', 'd30'), sum('visit', 'd30')))),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Abonnements aux food trucks (total)'), h('b', null, (a.follows || 0) + ' pour ' + (a.clients || 0) + ' client' + ((a.clients || 0) > 1 ? 's' : ''))),
        h('div', { class: 'tiny muted mt8' }, 'Chaque appareil compte au plus une fois par jour et par étape. Aucun identifiant n’est enregistré.')),
      h('div', { class: 'sec' }, 'Clients qui attendent un food truck'),
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Zones « Prévenez-moi »'), h('b', null, a.zones || 0)),
        zones.length ? zones.map((z) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, z.label), h('b', null, z.n))) : h('div', { class: 'small muted' }, 'Aucune zone pour l’instant. Les villes les plus demandées apparaîtront ici : elles disent où recruter des food trucks.')));
  };

  /* ---- Présence en direct : combien de personnes sont là, quels COMPTES sont connectés, et l'affluence (réservé à l'administration) */
  const PRES_ROLE = { client: 'Client', truck: 'Food truck', admin: 'Administrateur' };
  const PRES_PLAT = { web: 'site', pwa: 'site installé', apk: 'APK' };
  const presCache = { at: 0, data: null, busy: null };
  /** Dernier état connu (relu au plus toutes les 10 s) : sert à la carte du compte et à la page « En ligne ». */
  async function loadPresence(force) {
    if (!force && presCache.data && Date.now() - presCache.at < 10000) return presCache.data;
    if (presCache.busy) return presCache.busy;
    presCache.busy = store().adminPresence().then((d) => { presCache.data = d; presCache.at = Date.now(); return d; }).finally(() => { presCache.busy = null; });
    return presCache.busy;
  }
  const presMissing = (e) => e && !e.network && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
  const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);

  U.presenceCard = function () {
    if (!store().isCloud) return null;
    const big = h('div', { class: 'disp', style: { fontSize: '34px', lineHeight: 1 } }, '…'); const sub = h('div', { class: 'small muted mt4' }, 'Lecture en cours…');
    const card = h('div', { class: 'card', 'data-presence': '' }, h('div', { class: 'row gap12' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('div', { class: 'grow' }, big, sub), h('button', { class: 'btn sm', onClick: () => App.push(S.admin_presence()) }, 'Détail', icon('right', 16))));
    loadPresence().then((d) => { big.textContent = String(d.total); sub.textContent = plural(d.accounts, 'compte', 'comptes') + ' · ' + plural(d.guests, 'visiteur sans compte', 'visiteurs sans compte'); })
      .catch((e) => { big.textContent = '–'; sub.textContent = presMissing(e) ? 'Script « 10-presence.sql » pas encore exécuté dans Supabase.' : 'Indisponible pour le moment.'; });
    return h('div', null, h('div', { class: 'sec' }, 'En ligne en ce moment'), card);
  };

  S.admin_presence = function () {
    let data = null; let state = 'loading'; let timer = 0; let alive = true;
    const body = h('div', { class: 'scroll pad' });
    async function load() {
      try { data = await loadPresence(true); state = 'ok'; } catch (e) { state = presMissing(e) ? 'missing' : (data ? 'ok' : 'error'); }
      if (alive) draw();
    }
    const hm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ' h'; };
    function chart(items, label, valueOf) {
      const max = Math.max(1, ...items.map(valueOf));
      return h('div', { class: 'bars', style: { height: '120px', gap: items.length > 14 ? '3px' : '8px' } }, items.map((it) => h('div', { class: 'bar' },
        items.length > 14 ? null : h('b', null, valueOf(it) || ''),
        h('i', { style: { height: Math.max(3, valueOf(it) / max * 72) + 'px', opacity: valueOf(it) ? 1 : .25 } }), label(it))));
    }
    function draw() {
      const keep = body.scrollTop; const nodes = [];
      if (state === 'missing') nodes.push(ui.empty('🛠️', 'Présence pas encore activée', 'Exécutez le script « 10-presence.sql » dans le SQL Editor de Supabase, puis revenez ici.'));
      else if (state === 'error' || !data) nodes.push(ui.empty(state === 'loading' ? '⏳' : '📡', state === 'loading' ? 'Chargement…' : 'Indisponible pour le moment', state === 'loading' ? '' : 'Vérifiez la connexion ; la page se remet à jour toute seule.'));
      else {
        const d = data; const now = Date.parse(d.at) || Date.now();
        nodes.push(h('div', { class: 'card', 'data-pres-total': d.total },
          h('div', { class: 'row gap12' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('div', { class: 'grow' }, h('div', { class: 'disp', style: { fontSize: '40px', lineHeight: 1 } }, String(d.total)), h('div', { class: 'small muted mt4' }, d.total > 1 ? 'personnes en ligne' : 'personne en ligne'))),
          h('div', { class: 'sep', style: { margin: '12px 0 4px' } }),
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Comptes connectés'), h('b', null, d.accounts)),
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Visiteurs sans compte'), h('b', null, d.guests))));
        nodes.push(h('div', { class: 'sec' }, 'Comptes connectés (' + d.users.length + ')'));
        nodes.push(d.users.length
          ? h('div', { class: 'list' }, d.users.map((u) => h('div', { class: 'item', 'data-pres-user': u.id, style: { cursor: 'default' } },
            h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'row gap8' }, h('span', { class: 't ell', style: { userSelect: 'text' } }, u.name || 'Sans nom'), h('span', { class: 'tag' }, PRES_ROLE[u.role] || u.role)),
              h('div', { class: 'tiny muted mt4' }, 'Connecté depuis ' + Math.max(1, Math.round((now - Date.parse(u.since)) / 60000)) + ' min · ' + (PRES_PLAT[u.platform] || u.platform) + ' · actif ' + ui.ago(Date.parse(u.last_seen), now))))))
          : h('div', { class: 'card small muted' }, 'Aucun compte connecté pour l’instant.'));
        // 24 dernières heures : une barre par heure (pic de la tranche)
        const startH = new Date(now); startH.setMinutes(0, 0, 0); const hours = [];
        for (let i = 23; i >= 0; i--) { const t = startH.getTime() - i * 3600000; const row = (d.hours || []).find((x) => Math.abs(Date.parse(x.h) - t) < 1800000); hours.push({ t, total: row ? row.total : 0, accounts: row ? row.accounts : 0 }); }
        const peak = hours.reduce((m, x) => (x.total > m.total ? x : m), hours[0]);
        nodes.push(h('div', { class: 'sec' }, 'Affluence, dernières 24 h'));
        nodes.push(h('div', { class: 'card', 'data-pres-hours': '' }, chart(hours, (x) => ((new Date(x.t).getHours()) % 6 === 0 ? String(new Date(x.t).getHours()) : ''), (x) => x.total),
          h('div', { class: 'tiny muted mt8' }, peak.total ? 'Pic : ' + plural(peak.total, 'personne', 'personnes') + ' vers ' + hm(peak.t) + '.' : 'Pas encore d’affluence enregistrée.')));
        // 14 derniers jours
        const days = []; const today = C.dateKey(store().now());
        for (let i = 13; i >= 0; i--) { const k = C.addDaysKey(today, -i); const row = (d.days || []).find((x) => x.day === k); days.push({ k, total: row ? row.total : 0 }); }
        nodes.push(h('div', { class: 'sec' }, 'Pic par jour, 14 derniers jours'));
        nodes.push(h('div', { class: 'card', 'data-pres-days': '' }, chart(days, (x) => C.DOW_SHORT[C.parseKey(x.k).getDay()].slice(0, 1), (x) => x.total)));
      }
      nodes.push(h('p', { class: 'tiny muted', style: { margin: '16px 0 24px' } }, 'Seuls les comptes connectés sont nommés, et uniquement ici. Les visiteurs sans compte ne sont comptés que par un nombre : aucun nom, aucune adresse IP, aucune position. Une personne est « en ligne » si son appli a envoyé un signal dans les 2 min 30 ; la page se met à jour toutes les 15 secondes.'));
      body.replaceChildren(...nodes); body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'En ligne')), body),
      onMount: () => { draw(); load(); timer = setInterval(load, 15000); }, destroy: () => { alive = false; clearInterval(timer); } };
  };

  /* ---------------------------------------------------------- sécurité : alertes urgentes (script SQL 11) */
  const secCache = { at: 0, data: null, busy: null };
  async function loadSecurity(force) {
    if (!force && secCache.data && Date.now() - secCache.at < 10000) return secCache.data;
    if (secCache.busy) return secCache.busy;
    secCache.busy = store().adminSecurity().then((d) => { secCache.data = d; secCache.at = Date.now(); return d; }).finally(() => { secCache.busy = null; });
    return secCache.busy;
  }
  const SEC_LABELS = [[/^cap:/, 'Plafond atteint'], [/^signups$/, 'Inscriptions en masse'], [/^emails$/, 'E-mails en rafale'], [/^flood:/, 'Afflux d’appels'], [/^quota-db$/, 'Base de données presque pleine'],
    [/^quota-mau$/, 'Utilisateurs actifs : plafond proche'], [/^presence-rows$/, 'Table des présences'], [/^reports$/, 'Signalements en rafale'], [/^admin-role:/, 'Nouvel administrateur'], [/^test$/, 'Alerte test']];
  const secLabel = (k) => { const m = SEC_LABELS.find((x) => x[0].test(String(k))); return m ? m[1] : 'Alerte'; };

  U.securityCard = function () {
    if (!store().isCloud) return null;
    const big = h('div', { class: 'disp', style: { fontSize: '22px', lineHeight: 1.1 } }, '…'); const sub = h('div', { class: 'small muted mt4' }, 'Lecture en cours…');
    const card = h('div', { class: 'card', 'data-security': '' }, h('div', { class: 'row gap12' }, icon('bell', 22), h('div', { class: 'grow' }, big, sub), h('button', { class: 'btn sm', onClick: () => App.push(S.admin_security()) }, 'Détail', icon('right', 16))));
    loadSecurity().then((d) => {
      const week = (d.alerts || []).filter((a) => Date.now() - Date.parse(a.at) < 7 * 86400000 && a.kind !== 'test');
      big.textContent = week.length ? plural(week.length, 'alerte cette semaine', 'alertes cette semaine') : 'Aucune alerte';
      sub.textContent = d.devices ? 'Alertes urgentes reçues sur ' + plural(d.devices, 'appareil', 'appareils') + '.' : 'Aucun appareil abonné : vous ne recevrez pas les alertes en urgence.';
    }).catch((e) => { big.textContent = '–'; sub.textContent = presMissing(e) ? 'Script « 11-securite.sql » pas encore exécuté dans Supabase.' : 'Indisponible pour le moment.'; });
    return h('div', null, h('div', { class: 'sec' }, 'Sécurité'), card);
  };

  S.admin_security = function () {
    let data = null; let state = 'loading'; let alive = true; let sending = false;
    const body = h('div', { class: 'scroll pad' });
    async function load() {
      try { data = await loadSecurity(true); state = 'ok'; } catch (e) { state = presMissing(e) ? 'missing' : (data ? 'ok' : 'error'); }
      if (alive) draw();
    }
    const sendTest = App.guard(async () => {
      if (sending) return; sending = true; draw();
      try { await store().adminTestAlert(); ui.toast('Alerte test envoyée : vous la recevez dans quelques secondes.', 'ok'); await load(); } finally { sending = false; if (alive) draw(); }
    });
    function draw() {
      const keep = body.scrollTop; const nodes = [];
      if (state === 'missing') nodes.push(ui.empty('🛠️', 'Sécurité pas encore activée', 'Exécutez le script « 11-securite.sql » dans le SQL Editor de Supabase, puis revenez ici.'));
      else if (state === 'error' || !data) nodes.push(ui.empty(state === 'loading' ? '⏳' : '📡', state === 'loading' ? 'Chargement…' : 'Indisponible pour le moment', state === 'loading' ? '' : 'Vérifiez la connexion, puis revenez sur cette page.'));
      else {
        const d = data; const now = Date.parse(d.at) || Date.now();
        nodes.push(h('div', { class: 'card', 'data-sec-status': '' },
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Surveillance (chaque minute)'), h('b', null, d.watching ? 'Active' : 'À activer')),
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Appareils abonnés aux alertes'), h('b', null, String(d.devices))),
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Plafonds par minute'), h('b', null, d.caps && d.caps.presence ? d.caps.presence + ' · ' + d.caps.funnel : '–')),
          d.devices ? null : h('p', { class: 'small', style: { margin: '10px 0 0', color: 'var(--rd-tx)' } }, 'Aucun appareil de ce compte n’est abonné aux notifications : vous ne recevrez PAS les alertes en urgence. Ouvrez le site installé sur votre téléphone, connectez-vous avec ce compte et activez les notifications.'),
          d.watching ? null : h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, 'La surveillance par minute n’est pas planifiée (extension pg_cron absente) : les plafonds fonctionnent, mais pas les détections.'),
          h('button', { class: 'btn primary block mt12', disabled: sending, onClick: sendTest }, icon('bell'), sending ? 'Envoi…' : 'Envoyer une alerte test')));
        nodes.push(h('div', { class: 'sec' }, 'Dernières alertes (' + (d.alerts || []).length + ')'));
        nodes.push((d.alerts || []).length
          ? h('div', { class: 'list' }, d.alerts.map((a) => h('div', { class: 'item', 'data-sec-alert': a.kind, style: { cursor: 'default' } },
            h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'row gap8' }, h('span', { class: 't', style: { userSelect: 'text' } }, secLabel(a.kind)), h('span', { class: 'tiny muted' }, ui.ago(Date.parse(a.at), now))),
              h('div', { class: 'small mt4', style: { userSelect: 'text', whiteSpace: 'normal' } }, a.detail)))))
          : h('div', { class: 'card small muted' }, 'Aucune alerte pour l’instant. C’est bon signe.'));
        nodes.push(h('p', { class: 'tiny muted', style: { margin: '16px 0 24px' } }, 'Surveillé chaque minute : inscriptions en masse, rafales d’e-mails de confirmation, afflux d’appels, plafonds du forfait gratuit (base de données, utilisateurs actifs), vague de signalements, nouveau compte administrateur. Les tentatives de connexion répétées (brute force) ne laissent pas de trace dans la base : elles sont freinées par les limites de Supabase et visibles dans Supabase › Logs › Auth.'));
      }
      body.replaceChildren(...nodes); body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Sécurité')), body),
      onMount: () => { draw(); load(); }, destroy: () => { alive = false; } };
  };

  S.admin_account = function () {
    const body = h('div', { class: 'scroll pad' });
    function build() {
      const db = store().db; const common = S.accountCommon(); const keep = body.scrollTop;
      body.replaceChildren(...common.rows,
        h('div', { class: 'sec' }, 'Plateforme'),
        h('div', { class: 'card' }, (store().isCloud
          ? (() => { const a = store().adminStats || {}; return [['Comptes clients', a.clients || 0], ['Comptes food trucks', a.truck_accounts || 0], ['Food trucks', a.trucks || 0], ['Dont masqués', a.hidden || 0], ['Dont suspects', a.suspect || 0], ['Avis', a.reviews || 0], ['Événements à venir', a.events || 0], ['Signalements en attente', a.open_reports || 0]]; })()
          : [['Comptes', db.users.filter((u) => !u.demo).length], ['Food trucks', db.trucks.length], ['Avis', db.reviews.length], ['Événements à venir', store().upcomingEvents().length], ['Signalements en attente', store().openReports().length]]).map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('b', null, v)))),
        U.securityCard(),
        U.presenceCard(),
        U.audienceCard(),
        App.myTrucks().length ? h('div', { class: 'sec' }, 'Mon food truck') : null,
        App.myTrucks().length ? h('div', { class: 'card' }, h('div', { class: 'small muted' }, 'Votre compte possède ' + (App.myTrucks().length > 1 ? 'des fiches' : 'la fiche « ' + App.myTrucks()[0].name + ' »') + '. Passez dans l’espace food truck pour modifier le planning, la carte et les réglages, puis revenez ici.'), h('button', { class: 'btn primary block mt12', onClick: () => { App.adminAsTruck = true; App.viewAsClient = false; App.render(); } }, icon('truck'), 'Passer en mode food truck')) : null,
        ...U.testSection(),
        ...S.appearanceBlock(),
        U.updateCard(),
        h('div', { class: 'col gap8 mt16', style: { paddingBottom: '24px' } }, h('button', { class: 'btn block', onClick: () => S.passwordSheet() }, 'Changer le mot de passe'), h('button', { class: 'btn block', onClick: () => { store().logout(); App.render(); } }, icon('logout'), 'Se déconnecter')));
      body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Administration')), body), refresh: build, onMount: build };
  };

  /* ================================================================ JOURNAL D'ACTIVITÉ */
  // type d'évènement → [groupe de filtre, icône, couleur]
  const ACT = {
    signup_client: ['accounts', 'user', 'blue'], signup_truck: ['accounts', 'truck', 'blue'], account_deleted: ['accounts', 'trash', 'grey'],
    truck_created: ['trucks', 'plus', 'green'], product_added: ['trucks', 'list', 'green'], product_removed: ['trucks', 'list', 'grey'], team_added: ['trucks', 'users', 'green'], truck_deleted: ['trucks', 'trash', 'grey'],
    announce: ['places', 'pin', 'orange'], event_created: ['places', 'calendar', 'orange'],
    review: ['reports', 'check', 'blue'], report: ['reports', 'flag', 'red'], truck_suspect: ['reports', 'alert', 'red'],
    truck_hidden: ['admin', 'eye', 'red'], truck_shown: ['admin', 'eye', 'green'], truck_verified: ['admin', 'shield', 'green'], truck_unverified: ['admin', 'shield', 'grey'],
    deletion_requested: ['accounts', 'trash', 'red'], deletion_cancelled: ['accounts', 'trash', 'grey'], deletion_refused: ['admin', 'trash', 'grey'],
  };
  const ACT_FILTERS = [['all', 'Tout'], ['accounts', 'Inscriptions'], ['trucks', 'Fiches et cartes'], ['places', 'Lieux et événements'], ['reports', 'Avis et signalements'], ['admin', 'Modération']];
  const ACT_COLORS = { blue: ['var(--ver-bg)', 'var(--ver-tx)'], green: ['var(--gr-bg)', 'var(--gr-tx)'], orange: ['var(--ac-tint)', 'var(--ac-tx)'], red: ['var(--rd-bg)', 'var(--rd-tx)'], grey: ['var(--s2)', 'var(--mu)'] };

  S.admin_activity = function () {
    let filter = 'all'; let loadingMore = false; let exhausted = false;
    const chips = h('div', { class: 'chips', style: { padding: '0 12px 8px' } });
    const body = h('div', { class: 'scroll pad' });
    const dayLabel = (ts) => {
      const k = C.dateKey(new Date(ts)); const today = C.dateKey(store().now());
      return k === today ? 'Aujourd’hui' : k === C.addDaysKey(today, -1) ? 'Hier' : C.fmtDayLong(k);
    };
    function drawChips() {
      chips.replaceChildren(...ACT_FILTERS.map(([id, label]) => h('button', { class: 'chip' + (filter === id ? ' on' : ''), onClick: () => { filter = id; drawChips(); build(); } }, label)));
    }
    function row(a) {
      const [, ic, col] = ACT[a.kind] || ['all', 'info', 'grey']; const [bg, fg] = ACT_COLORS[col];
      const canOpen = a.truckId && store().getTruck(a.truckId);
      return h('div', { class: 'item', style: { cursor: canOpen ? 'pointer' : 'default', alignItems: 'flex-start' }, onClick: () => { if (canOpen) S.openFiche(a.truckId); } },
        h('div', { style: { width: '36px', height: '36px', borderRadius: '12px', background: bg, color: fg, display: 'grid', placeItems: 'center', flex: 'none' } }, icon(ic, 18)),
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'small', style: { color: 'var(--tx)', userSelect: 'text', lineHeight: 1.35 } }, a.text),
          h('div', { class: 'tiny muted mt4' }, ui.ago(a.at, store().now()), a.city ? ' · ' + a.city : '')),
        canOpen ? icon('right', 18) : null);
    }
    function build() {
      const keep = body.scrollTop; const st = store(); const feed = st.activityFeed();
      const shown = feed.filter((a) => filter === 'all' || (ACT[a.kind] || ['all'])[0] === filter);
      const nodes = [];
      if (!st.isCloud) nodes.push(ui.empty('📜', 'Journal disponible en ligne', 'Le journal d’activité est tenu par la base de données en ligne ; la version locale de test n’en a pas.'));
      else if (st.activityState === 'missing') nodes.push(ui.empty('🛠️', 'Journal pas encore activé', 'Exécutez le script « 3-activity.sql » dans le SQL Editor de Supabase pour activer le journal, puis revenez ici.'));
      else if (!shown.length) nodes.push(ui.empty('🕊️', feed.length ? 'Rien dans cette catégorie' : 'Aucune activité pour l’instant', feed.length ? 'Essayez un autre filtre, ou chargez des évènements plus anciens.' : 'Les inscriptions, nouvelles fiches, produits ajoutés et annonces d’emplacement apparaîtront ici.'));
      else {
        let last = null; let group = null;
        shown.forEach((a) => {
          const d = dayLabel(a.at);
          if (d !== last) { last = d; nodes.push(h('div', { class: 'sec' }, d)); group = h('div', { class: 'list' }); nodes.push(group); }
          group.append(row(a));
        });
      }
      if (st.isCloud && st.activityState === 'ok' && feed.length >= 100 && !exhausted) {
        nodes.push(h('button', { class: 'btn block mt12', disabled: loadingMore, onClick: App.guard(async () => {
          loadingMore = true; try { const n = await st.loadMoreActivity(); if (n < 100) exhausted = true; } finally { loadingMore = false; build(); }
        }) }, 'Afficher les évènements plus anciens'));
      }
      nodes.push(h('p', { class: 'tiny muted', style: { margin: '16px 0 24px' } }, 'Ce journal n’est visible que de l’administration. Il garde 90 jours d’historique et ne contient aucune position de client.'));
      body.replaceChildren(...nodes); body.scrollTop = keep;
    }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Activité')), chips, body), refresh: build, onMount: () => { drawChips(); build(); } };
  };

  /* ================================================================ CARTE DE TOUTES LES FICHES */
  S.admin_map = function () {
    let moment = 'any'; let selectedId = null; let results = []; let fitted = false;
    const map = new MFT.MapView({ lat: 46.6, lng: 2.4, zoom: 6, zoomControls: true });
    map.el.style.position = 'absolute'; map.el.style.inset = '0';
    const mapHost = h('div', { class: 'admin-map' }, map.el);
    const chips = h('div', { class: 'chips' });
    const count = h('div', { class: 'small muted' });
    const list = h('div', { class: 'list' });
    const panel = h('div', { class: 'admin-list' }, h('div', { class: 'row', style: { padding: '10px 16px 4px' } }, h('div', { class: 'bold grow' }, 'Fiches sur la carte'), count), h('div', { style: { padding: '0 12px 16px' } }, list));
    const MOMENTS = [['any', '7 jours'], ['now', 'Maintenant'], ['tonight', 'Ce soir'], ['tomorrow', 'Demain']];
    function drawChips() { chips.replaceChildren(...MOMENTS.map(([id, label]) => h('button', { class: 'chip' + (moment === id ? ' on' : ''), onClick: () => { moment = id; fitted = false; drawChips(); refresh(); } }, label))); }
    function compute() {
      results = store().queryTrucks({ moment, center: null, includeHidden: true });
      if (selectedId && !results.some((r) => r.truck.id === selectedId)) selectedId = null;
    }
    function select(id, pan) { selectedId = id; draw(); const r = results.find((x) => x.truck.id === id); if (r && pan) map.panTo(r.slot.place.lat, r.slot.place.lng); const row = list.querySelector('.item.sel'); if (row) row.scrollIntoView({ block: 'nearest' }); }
    function draw() {
      count.textContent = results.length + ' fiche' + (results.length > 1 ? 's' : '') + ' avec annonce';
      map.setMarkers(results.map((r) => { const sel = r.truck.id === selectedId; return { id: r.truck.id, lat: r.slot.place.lat, lng: r.slot.place.lng, selected: sel, sig: [r.status, sel, r.suspect, r.truck.hidden, r.truck.name.charAt(0)].join('|'), el: MFT.pins.truckPin(r.truck, r.status, { selected: sel, suspect: r.suspect }), onClick: () => select(r.truck.id, false) }; }));
      list.replaceChildren();
      if (!results.length) { list.append(ui.empty('🗺️', 'Aucune annonce', 'Aucune fiche n’a d’emplacement annoncé sur cette période.')); return; }
      results.forEach((r) => {
        const sel = r.truck.id === selectedId;
        const row = U.truckRow(r, { selected: sel, onClick: () => select(r.truck.id, true),
          actions: sel ? [h('button', { class: 'btn primary sm', onClick: (e) => { e.stopPropagation(); S.openFiche(r.truck.id); } }, 'Voir la fiche')] : null });
        if (r.truck.hidden) { const t = row.querySelector('.row'); if (t) t.append(h('span', { class: 'tag cancelled' }, 'Masquée')); }
        list.append(row);
      });
    }
    function fit() {
      if (!results.length) return;
      map.fitBounds(results.map((r) => ({ lat: r.slot.place.lat, lng: r.slot.place.lng })), { top: 24, bottom: 24, left: 30, right: 30 }, 14, true);
    }
    function refresh() { compute(); draw(); if (!fitted && results.length) { fitted = true; fit(); } }
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar', style: { paddingLeft: '16px' } }, h('h1', null, 'Carte')), h('div', { style: { padding: '0 12px 8px' } }, chips), mapHost, panel),
      map, destroy: () => map.destroy(), refresh, onShow: () => map.invalidate(), onMount: () => { drawChips(); map.invalidate(); refresh(); } };
  };
})();
