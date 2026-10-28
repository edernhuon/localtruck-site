/* LocalTruck – écrans d'accueil, connexion et inscription (client / food truck). */
(function () {
  'use strict';
  const MFT = window.MFT; const C = MFT.core; const ui = MFT.ui; const { h, icon } = ui; const App = MFT.App;
  const S = MFT.screens; const store = () => App.store;

  const { TERMS, PRIVACY, NOTICE, REVIEWS, PRO_ATTEST } = MFT.legal;
  function legalSheet(title, blocks) { return ui.openSheet(title, h('div', { class: 'col gap12' }, blocks.map(([t, x]) => h('div', null, h('div', { class: 'bold' }, t), h('div', { class: 'small muted mt4' }, x))))); }
  const legalLinks = () => h('div', { class: 'legal' }, 'En continuant, vous acceptez les ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Conditions d’utilisation', TERMS); } }, 'conditions d’utilisation'), ' et la ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Politique de confidentialité', PRIVACY); } }, 'politique de confidentialité'), '. ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Mentions légales', NOTICE); } }, 'Mentions légales'), '.');
  /** Liens (vraies adresses, lisibles par Google) vers les pages « food truck par ville » ; seulement sur le web : dans l'application Android ou Windows, ces adresses n'existent pas en local. */
  S.siteLinks = () => (MFT.platform && (MFT.platform.isAndroidApp || MFT.platform.isElectron)) ? null
    : h('nav', { class: 'legal site-links', 'aria-label': 'Pages du site', style: { paddingBottom: '0' } }, h('a', { href: '/food-trucks/' }, 'Food trucks par ville'), ' · ', h('a', { href: '/trouver-un-food-truck/' }, 'Trouver un food truck'), ' · ', h('a', { href: '/pour-les-food-trucks/' }, 'Pour les food trucks'));
  S.legalSheet = legalSheet; S.TERMS = TERMS; S.PRIVACY = PRIVACY; S.NOTICE = NOTICE; S.REVIEWS = REVIEWS;
  /** Les quatre documents, ouverts depuis les écrans « Compte » et « Profil » (même liste partout). */
  S.legalButtons = () => [['Conditions d’utilisation', TERMS], ['Politique de confidentialité', PRIVACY], ['Mentions légales', NOTICE], ['Règles des avis', REVIEWS]]
    .map(([title, blocks]) => h('button', { class: 'btn block', onClick: () => legalSheet(title, blocks) }, title));

  /** Réglage « Apparence » (nuit, jour, automatique) : le choix reste sur l'appareil. */
  S.appearanceBlock = () => {
    const T = MFT.theme; if (!T) return [];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Apparence' });
    const draw = () => seg.replaceChildren(...[['dark', 'Nuit', 'moon'], ['light', 'Jour', 'sun'], ['auto', 'Auto', null]].map(([m, label, ic]) =>
      h('button', { type: 'button', class: T.get() === m ? 'on' : '', 'aria-pressed': String(T.get() === m), onClick: () => { T.set(m); draw(); } }, ic ? icon(ic, 16) : null, label)));
    draw();
    return [h('div', { class: 'sec' }, 'Apparence'), h('div', { class: 'card' }, seg, h('div', { class: 'tiny muted mt8' }, '« Auto » suit le réglage de votre téléphone.'))];
  };

  /* ---------------------------------------------------------- accueil : la carte floutée en fond, deux boutons */
  /* Décor : une carte dessinée (rues, rivière) et des repères qui respirent, floutés. Aucune tuile chargée : l'accueil s'affiche tout de suite. */
  const WEL_PINS = [[22, 30, 'open'], [64, 24, 'later'], [44, 46, 'soon'], [16, 58, 'open'], [74, 54, 'open'], [55, 68, 'info'], [30, 78, 'open']];
  function welcomeBg() {
    const bg = h('div', { class: 'wel-bg', 'aria-hidden': 'true' });
    bg.innerHTML = '<svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice"><g stroke="#25252c" stroke-width="20" fill="none" stroke-linecap="round"><path d="M-20 170 C 120 140 260 200 420 150"/><path d="M-20 450 C 140 410 260 480 420 420"/><path d="M110 -20 C 96 260 146 520 110 820"/><path d="M296 -20 C 318 260 250 520 306 820"/></g>'
      + '<g stroke="#1b1b21" stroke-width="8" fill="none"><path d="M-20 300 L 420 318"/><path d="M204 -20 L 214 820"/><path d="M40 -20 L 52 820"/><path d="M-20 620 L 420 596"/></g><path d="M236 820 C 266 700 346 668 420 668 L 420 820 Z" fill="#172434"/></svg>';
    WEL_PINS.forEach(([x, y, st], i) => bg.appendChild(h('span', { class: 'wel-pin ' + st, style: { left: x + '%', top: y + '%', animationDelay: (i * 0.7) + 's' } })));
    return bg;
  }
  /** « Créer mon compte » : client ou food truck. */
  function accountChoice() {
    let sh = null;
    const go = (fn) => () => { if (sh) sh.close(); App.push(fn()); };
    const opt = (cls, emoji, title, sub, fn) => h('button', { class: 'acc-opt ' + cls, type: 'button', onClick: go(fn) },
      h('span', { class: 'acc-ic', 'aria-hidden': 'true' }, emoji), h('span', { class: 'grow' }, h('b', null, title), h('small', null, sub)), icon('right', 20));
    sh = ui.openSheet('Créer mon compte', h('div', { class: 'col acc-sheet' },
      h('p', { class: 'muted small', style: { margin: '0 0 4px' } }, 'Gratuit. Vous êtes…'),
      opt('client', '🍔', 'Je suis client', 'Favoris, alertes quand un food truck arrive, avis', () => S.signupClient()),
      opt('truck', '🚚', 'Je suis food truck', 'Ma fiche gratuite, mon planning, mes clients prévenus', () => S.signupTruck()),
      h('div', { class: 'center small muted mt8' }, 'Déjà un compte ? ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); sh.close(); App.push(S.login()); } }, 'Se connecter'))));
    return sh;
  }
  S.accountChoice = accountChoice;
  S.welcome = function () {
    return { el: h('div', { class: 'col wel' },
      welcomeBg(), h('div', { class: 'wel-shade', 'aria-hidden': 'true' }),
      h('header', { class: 'wel-hd' },
        h('div', { class: 'wel-brand' }, h('img', { src: 'assets/icon.png', alt: '' }), h('span', null, 'Local', h('span', { class: 'accent' }, 'Truck'))),
        h('div', { class: 'row gap8' },
          MFT.theme ? h('button', { class: 'icon-btn fill', 'aria-label': 'Changer l’apparence (nuit ou jour)', onClick: () => MFT.theme.cycle() }, icon('moon', 20)) : null,
          h('button', { class: 'chip wel-login', onClick: () => App.push(S.login()) }, 'Se connecter'))),
      h('main', { class: 'wel-main' },
        h('span', { class: 'lbl' }, 'Food trucks · France'),
        h('h1', { class: 'wel-h1' }, 'Les food trucks qui sont là, ', h('span', { class: 'accent' }, 'ce soir.')),
        MFT.presence ? MFT.presence.badge('wel-live') : null,
        MFT.install ? MFT.install.card({ compact: true, where: 'home' }) : null,
        h('div', { class: 'wel-cta' },
          h('button', { class: 'btn primary lg', onClick: () => App.enterGuest() }, icon('map', 18), 'Voir la carte'),
          h('button', { class: 'btn lg', onClick: () => accountChoice() }, 'Créer mon compte')),
        S.siteLinks(), legalLinks())) };
  };

  /* ---------------------------------------------------------- connexion */
  S.login = function () {
    const email = h('input', { class: 'inp', type: 'email', placeholder: 'vous@exemple.fr', autocomplete: 'username' });
    const pwd = h('input', { class: 'inp', type: 'password', placeholder: 'Votre mot de passe', autocomplete: 'current-password' });
    const err = h('div', { class: 'err' });
    const go = h('button', { class: 'btn primary block lg mt16' }, 'Se connecter');
    const submit = App.guard(async () => {
      err.textContent = ''; go.disabled = true;
      try { await store().login(email.value, pwd.value); App.render(); }
      catch (e) { err.textContent = e.message; go.disabled = false; if (!(e instanceof C.UserError)) throw e; }
    });
    go.addEventListener('click', submit);
    [email, pwd].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Se connecter')),
      h('div', { class: 'scroll pad' }, h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Content de vous revoir. Retrouvez les food trucks de votre quartier.'),
        ui.field('Adresse e-mail', email), ui.field('Mot de passe', ui.pwdField(pwd)),
        typeof store().requestPasswordReset === 'function' ? h('div', { class: 'small mt8' }, h('a', { href: '#', 'data-forgot': '', onClick: (e) => { e.preventDefault(); App.push(S.forgotPassword(email.value)); } }, 'Mot de passe oublié ?')) : null,
        err, go,
        h('div', { class: 'center small muted mt24' }, 'Pas encore de compte ? ', h('span', { class: 'link', onClick: () => { App.pop(); if (App.guest) App.push(S.signupClient()); } }, 'Créer un compte')))),
      onMount: () => setTimeout(() => email.focus(), 60) };
  };

  /* ---------------------------------------------------------- mot de passe oublié : e-mail → code reçu → nouveau mot de passe */
  S.forgotPassword = function (prefill) {
    const COOLDOWN = 60;                                         // secondes avant de pouvoir redemander un code (le service d'envoi l'impose aussi)
    const body = h('div', { class: 'scroll pad' });
    let sentTo = '';
    const email = h('input', { class: 'inp', type: 'email', placeholder: 'vous@exemple.fr', autocomplete: 'username', value: String(prefill || '').trim() });
    const code = h('input', { class: 'inp', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '14', placeholder: '12345678', 'aria-label': 'Code reçu par e-mail' });
    const pwd = h('input', { class: 'inp', type: 'password', placeholder: 'Nouveau mot de passe', autocomplete: 'new-password' });
    const err = h('div', { class: 'err' }); const info = h('p', { class: 'muted small', style: { margin: '4px 0 0' } });

    function stepEmail() {
      err.textContent = ''; info.textContent = 'Saisissez l’adresse e-mail de votre compte : nous vous envoyons un code pour choisir un nouveau mot de passe.';
      const go = h('button', { class: 'btn primary block lg mt16' }, 'Recevoir le code');
      const submit = App.guard(async () => {
        err.textContent = ''; go.disabled = true;
        try { await store().requestPasswordReset(email.value); sentTo = email.value.trim(); stepCode(true); }
        catch (e) { err.textContent = e.message; go.disabled = false; if (!(e instanceof C.UserError)) throw e; }
      });
      go.addEventListener('click', submit); email.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
      body.replaceChildren(info, ui.field('Adresse e-mail', email), err, go);
      setTimeout(() => email.focus(), 60);
    }

    function stepCode(fresh) {
      err.textContent = '';
      info.textContent = 'Si un compte existe avec l’adresse ' + sentTo + ', un code vient d’être envoyé (valable 15 minutes). Pensez à regarder vos courriers indésirables.';
      const go = h('button', { class: 'btn primary block lg mt16' }, 'Changer mon mot de passe');
      const again = h('button', { class: 'btn ghost block mt8', type: 'button' }); let left = fresh ? COOLDOWN : 0;
      const paint = () => { again.disabled = left > 0; again.textContent = left > 0 ? 'Renvoyer un code (' + left + ' s)' : 'Renvoyer un code'; };
      paint();
      const tick = setInterval(() => { if (!body.isConnected) return clearInterval(tick); if (left > 0) { left -= 1; paint(); } }, 1000);
      again.addEventListener('click', App.guard(async () => {
        err.textContent = ''; again.disabled = true;
        try { await store().requestPasswordReset(sentTo); left = COOLDOWN; ui.toast('Nouveau code envoyé', 'ok'); }
        catch (e) { err.textContent = e.message; left = e.code === 'rate' ? COOLDOWN : 0; if (!(e instanceof C.UserError)) throw e; }
        paint();
      }));
      const submit = App.guard(async () => {
        err.textContent = ''; go.disabled = true;
        try { await store().resetPassword({ email: sentTo, code: code.value, password: pwd.value }); ui.toast('Mot de passe enregistré : vous êtes connecté', 'ok'); App.render(); }
        catch (e) { err.textContent = e.message; go.disabled = false; if (!(e instanceof C.UserError)) throw e; }
      });
      go.addEventListener('click', submit); [code, pwd].forEach((i) => { i.onkeydown = (e) => { if (e.key === 'Enter') submit(); }; });
      body.replaceChildren(info, ui.field('Code reçu par e-mail', code), ui.field('Nouveau mot de passe', ui.pwdField(pwd), C.PASSWORD_HINT), err, go, again,
        h('div', { class: 'center small muted mt16' }, 'Mauvaise adresse ? ', h('span', { class: 'link', onClick: () => { code.value = ''; pwd.value = ''; stepEmail(); } }, 'La modifier')));
      setTimeout(() => code.focus(), 60);
    }

    stepEmail();
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Mot de passe oublié')), body) };
  };

  /* ---------------------------------------------------------- inscription client */
  S.signupClient = function () {
    const name = h('input', { class: 'inp', placeholder: 'Votre prénom ou pseudo', maxlength: '40', autocomplete: 'name' });
    const email = h('input', { class: 'inp', type: 'email', placeholder: 'vous@exemple.fr', autocomplete: 'email' });
    const pwd = h('input', { class: 'inp', type: 'password', placeholder: 'Votre mot de passe', autocomplete: 'new-password' });
    const cgu = h('input', { type: 'checkbox' }); const err = h('div', { class: 'err' });
    const go = h('button', { class: 'btn primary block lg mt16' }, 'Créer mon compte');
    go.addEventListener('click', App.guard(async () => {
      err.textContent = '';
      if (!cgu.checked) { err.textContent = 'Acceptez les conditions d’utilisation pour continuer.'; return; }
      go.disabled = true;
      try { await store().signup({ role: 'client', name: name.value, email: email.value, password: pwd.value }); if (MFT.funnel) MFT.funnel.track('signup'); App.render(); }
      catch (e) { go.disabled = false; if (e instanceof C.UserError) err.textContent = e.message; else throw e; }
    }));
    return { el: h('div', { class: 'col' }, h('div', { class: 'topbar' }, App.backBtn(), h('h1', null, 'Compte client')),
      h('div', { class: 'scroll pad' }, h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Trouvez les food trucks autour de vous, suivez vos favoris et recevez des alertes.'),
        ui.field('Prénom ou pseudo', name), ui.field('Adresse e-mail', email), ui.field('Mot de passe', ui.pwdField(pwd), C.PASSWORD_HINT),
        h('label', { class: 'check' }, cgu, h('span', null, 'J’accepte les ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Conditions d’utilisation', TERMS); } }, 'conditions d’utilisation'), ' et la ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Politique de confidentialité', PRIVACY); } }, 'politique de confidentialité'), '.')),
        err, go, h('div', { class: 'center small muted mt24', style: { paddingBottom: '24px' } }, 'Déjà un compte ? ', h('span', { class: 'link', onClick: () => { App.pop(); App.push(S.login()); } }, 'Se connecter')))),
      onMount: () => setTimeout(() => name.focus(), 60) };
  };

  /* ---------------------------------------------------------- inscription food truck (3 étapes) */
  S.signupTruck = function (opts) {
    opts = opts || {}; const me0 = opts.existing ? App.user() : null;
    const d = { step: me0 ? 2 : 1, existing: !!me0, contact: me0 ? me0.name : '', email: me0 ? me0.email : '', password: '', cgu: !!me0, pro: false, name: '', cuisines: [], bio: '', payments: ['Carte bancaire', 'Espèces', 'Sans contact'], logo: null, first: null };
    const claim = opts.claim || null;                                // « C'est mon camion » : on pré-remplit avec ce que l'on sait de la fiche provisoire (jamais l'Instagram : le propriétaire le saisit lui-même)
    if (claim) { d.name = claim.name; d.cuisines = C.listingCuisines(claim).slice(0, 3); }
    // Début de la première annonce : prochaine demi-heure, jamais après 23 h 30 (passé minuit, l'annonce tomberait sur le matin déjà écoulé).
    const now = store().now(); const roundedStart = (() => { const m = Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30, 1410); return C.addMinutesHM('00:00', m); })();
    d.firstTimes = { start: roundedStart, end: C.addMinutesHM(roundedStart, 240) };
    const body = h('div', { class: 'scroll pad' }); const steps = h('div', { class: 'steps' }, h('i'), h('i'), h('i'));
    const title = h('h1', null, ''); const sub = h('div', { class: 'sub' }, '');
    const top = h('div', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'Retour', onClick: () => { if (d.step > (d.existing ? 2 : 1)) { d.step--; draw(); } else App.pop(); } }, icon('back')), h('div', { class: 'grow' }, sub, title));
    const root = h('div', { class: 'col' }, top, steps, body);
    const err = h('div', { class: 'err' });

    function draw() {
      steps.querySelectorAll('i').forEach((x, i) => { x.classList.toggle('on', i < d.step); x.style.display = d.existing && i === 0 ? 'none' : ''; });
      sub.textContent = d.existing ? 'Étape ' + (d.step - 1) + ' sur 2' : 'Étape ' + d.step + ' sur 3'; err.textContent = '';
      [step1, step2, step3][d.step - 1](); body.scrollTop = 0;
    }

    function step1() {
      title.textContent = 'Votre compte';
      const contact = h('input', { class: 'inp', placeholder: 'Prénom et nom du gérant', maxlength: '60', value: d.contact, onInput: (e) => { d.contact = e.target.value; } });
      const email = h('input', { class: 'inp', type: 'email', placeholder: 'contact@monfoodtruck.fr', value: d.email, onInput: (e) => { d.email = e.target.value; } });
      const pwd = h('input', { class: 'inp', type: 'password', placeholder: 'Votre mot de passe', value: d.password, onInput: (e) => { d.password = e.target.value; } });
      const cgu = h('input', { type: 'checkbox', checked: d.cgu, onChange: (e) => { d.cgu = e.target.checked; } });
      body.replaceChildren(h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Annoncez où vous serez ce soir et laissez vos clients vous trouver.'),
        ui.field('Nom du gérant', contact), ui.field('Adresse e-mail', email), ui.field('Mot de passe', ui.pwdField(pwd), C.PASSWORD_HINT),
        h('label', { class: 'check' }, cgu, h('span', null, 'J’accepte les ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Conditions d’utilisation', TERMS); } }, 'conditions d’utilisation'), ' et la ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Politique de confidentialité', PRIVACY); } }, 'politique de confidentialité'), '.')),
        err, h('button', { class: 'btn primary block lg mt16', onClick: () => {
          err.textContent = '';
          if (!d.contact.trim()) return (err.textContent = 'Indiquez le nom du gérant.');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) return (err.textContent = 'Adresse e-mail invalide.');
          { const pb = C.passwordProblem(d.password); if (pb) return (err.textContent = pb); }
          if (store().userByEmail(d.email)) return (err.textContent = 'Un compte existe déjà avec cette adresse e-mail.');
          if (!d.cgu) return (err.textContent = 'Acceptez les conditions d’utilisation pour continuer.');
          d.step = 2; draw();
        } }, 'Continuer'));
    }

    function step2() {
      title.textContent = 'Présentez votre food truck';
      const logo = h('div', { class: 'logo-pick', title: 'Ajouter un logo', onClick: App.guard(async () => { const l = await ui.squareLogo(160); if (l) { d.logo = l; paintLogo(); } }) });
      const paintLogo = () => { logo.style.backgroundImage = d.logo ? 'url(' + d.logo + ')' : ''; logo.replaceChildren(d.logo ? '' : icon('camera', 28)); };
      paintLogo();
      const name = h('input', { class: 'inp', maxlength: '60', placeholder: 'Ex. Burger Atelier', value: d.name, onInput: (e) => { d.name = e.target.value; } });
      const bioCount = h('span', { class: 'hint' }, d.bio.length + ' / 280');
      const bio = h('textarea', { class: 'inp', maxlength: '280', placeholder: 'Ce que vous préparez, vos spécialités, votre histoire…', onInput: (e) => { d.bio = e.target.value; bioCount.textContent = d.bio.length + ' / 280'; } }, d.bio);
      const cu = h('div'); const pay = h('div');
      const pro = h('input', { type: 'checkbox', checked: d.pro, onChange: (e) => { d.pro = e.target.checked; } });
      const multi = (host, options, arr) => host.replaceChildren(ui.chipRow(options, arr, (v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); multi(host, options, arr); }, { wrap: true }));
      multi(cu, C.CUISINES, d.cuisines); multi(pay, C.PAYMENTS, d.payments);
      body.replaceChildren(claim ? h('div', { class: 'card tint small', style: { marginBottom: '8px' } }, 'Vous reprenez la fiche « ' + claim.name + ' ». Nous avons pré-rempli ce que l’on savait : vérifiez et corrigez si besoin.') : null,
        h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Ces informations apparaissent sur votre fiche, visible par tous les clients.'),
        h('div', { class: 'row gap12 mt16' }, logo, h('div', { class: 'grow' }, h('div', { class: 'lbl' }, 'Logo'), h('div', { class: 'hint' }, 'Facultatif. Une lettre colorée sera utilisée à défaut.'))),
        ui.field('Nom du food truck', name),
        h('div', { class: 'field' }, h('label', null, 'Type de cuisine (plusieurs choix)'), cu),
        h('div', { class: 'field' }, h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Présentation'), bioCount), bio),
        h('div', { class: 'field' }, h('label', null, 'Paiements acceptés'), pay, h('div', { class: 'hint' }, 'Information affichée sur votre fiche. Vous encaissez directement vos clients.')),
        h('label', { class: 'check mt16' }, pro, h('span', null, PRO_ATTEST, ' ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); legalSheet('Conditions d’utilisation', TERMS); } }, 'Voir les conditions'), '.')),
        err, h('button', { class: 'btn primary block lg mt16', style: { marginBottom: '24px' }, onClick: () => {
          err.textContent = '';
          if (!d.name.trim()) return (err.textContent = 'Le nom du food truck est obligatoire.');
          if (!d.cuisines.length) return (err.textContent = 'Choisissez au moins un type de cuisine.');
          if (!d.pro) return (err.textContent = 'Cochez la case de certification : l’activité de food truck est réservée aux professionnels déclarés.');
          d.step = 3; draw();
        } }, 'Continuer'));
    }

    function step3() {
      title.textContent = 'Votre fiche est prête';
      const preview = { name: d.name.trim(), logo: d.logo, color: C.AVATAR_COLORS[store().db.trucks.length % C.AVATAR_COLORS.length], cuisines: d.cuisines };
      const first = h('div');
      const times = d.firstTimes;
      const paintFirst = () => {
        const s1 = h('input', { class: 'inp', type: 'time', value: times.start, onChange: (e) => { times.start = e.target.value; } });
        const s2 = h('input', { class: 'inp', type: 'time', value: times.end, onChange: (e) => { times.end = e.target.value; } });
        first.replaceChildren(h('div', { class: 'card' },
          h('div', { class: 'bold' }, 'Où serez-vous ce soir ?'), h('div', { class: 'small muted' }, 'Ajoutez votre première annonce (facultatif, vous pourrez le faire plus tard).'),
          h('button', { class: 'btn block mt12', style: { justifyContent: 'flex-start' }, onClick: () => App.push(S.locationPicker({ title: 'Où serez-vous ce soir ?', confirmLabel: 'Choisir ce lieu', place: d.first, onConfirm: (p) => { d.first = p; paintFirst(); } })) }, icon('pin'), d.first ? d.first.name : 'Choisir le lieu sur la carte'),
          d.first ? h('div', { class: 'row gap12' }, h('div', { class: 'grow' }, ui.field('De', s1)), h('div', { class: 'grow' }, ui.field('à', s2))) : null));
      };
      paintFirst();
      const publish = h('button', { class: 'btn primary block lg mt16', style: { marginBottom: '24px' } }, 'Publier ma fiche');
      publish.addEventListener('click', App.guard(async () => {
        publish.disabled = true;
        try {
          // Si le compte vient d'être créé mais que la fiche n'a pas pu l'être (réseau coupé), on réutilise ce compte au lieu de le recréer.
          let u = store().currentUser();
          if (!(u && u.role === 'truck' && (d.existing || (u.email || '').toLowerCase() === d.email.trim().toLowerCase()))) {
            u = await store().signup({ role: 'truck', name: d.contact.trim(), email: d.email.trim(), password: d.password });
          }
          const t = await store().createTruck(u.id, { name: d.name, cuisines: d.cuisines, bio: d.bio, payments: d.payments, logo: d.logo });
          if (claim) { try { await store().claimListing(claim.slug, t.id); } catch (e) { /* la fiche provisoire reste : l'administration pourra la masquer */ } }
          let msg = 'Votre fiche est publiée';
          if (d.first) { try { await store().setDay(u.id, t.id, C.dateKey(store().now()), { slots: [{ start: times.start, end: times.end, place: d.first, products: [], note: '' }] }); } catch (e) { msg += ' (annonce non ajoutée : ' + e.message + ')'; } }
          App.render(); ui.toast(msg, 'ok');
          const fresh = store().getTruck(t.id); if (S.posterIntro && fresh && fresh.slug && store().posterSupported()) S.posterIntro(t.id, { fresh: true });      // aperçu de l'affiche et lien court
        } catch (e) {
          publish.disabled = false;
          if (e instanceof C.UserError && e.code === 'exists') { d.step = 1; draw(); err.textContent = e.message; return; }
          throw e;
        }
      }));
      body.replaceChildren(h('p', { class: 'muted small', style: { margin: '4px 0 12px' } }, 'Elle sera visible tout de suite par les clients autour de vous.'),
        h('div', { class: 'lbl mb8' }, 'APERÇU CÔTÉ CLIENT'),
        h('div', { class: 'item', style: { cursor: 'default' } }, ui.avatar(preview), h('div', { class: 'grow' }, h('div', { class: 't' }, preview.name), h('div', { class: 'row gap8 mt4' }, h('span', { class: 'tag unv' }, 'Non vérifié')), h('div', { class: 's mt4' }, preview.cuisines.join(', ')))),
        h('div', { class: 'card mt12' }, h('div', { class: 'bold' }, 'Mention « Pas encore vérifié »'), h('div', { class: 'small muted mt4' }, 'Votre fiche est publiée immédiatement. La mention reste affichée tant que LocalTruck n’a pas contrôlé votre inscription.')),
        h('div', { class: 'mt12' }, first), err, publish);
    }
    return { el: root, onMount: draw };
  };
})();
