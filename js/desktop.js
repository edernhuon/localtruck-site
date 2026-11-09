/* LocalTruck – version ordinateur : repère les écrans larges (768 px et plus, 600 px de haut au moins : ordinateurs et tablettes) et ajoute à la barre du haut ce qui n'existe pas sur téléphone
 * (apparence, connexion). La mise en page elle-même est dans desktop.css, chargé seulement sur ces écrans. */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const Q = '(min-width: 768px) and (min-height: 600px)';      // tablettes comprises (portrait et paysage) ; un téléphone couché (moins de 600 px de haut) garde la mise en page téléphone
  const mq = window.matchMedia ? window.matchMedia(Q) : null;
  const on = () => !!(mq && mq.matches);

  /** Éléments de la barre du haut (marqués « dk-only » : cachés sur téléphone). Appelé par App.render à chaque construction de la barre. */
  function decorate(nav, mode) {
    const { h, icon } = MFT.ui; const App = MFT.App; const S = MFT.screens;
    nav.append(h('span', { class: 'dk-only dk-spacer' }));
    if (MFT.theme) nav.append(h('button', { class: 'dk-only dk-tool', 'aria-label': 'Changer l’apparence (nuit ou jour)', title: 'Nuit / jour', onClick: () => MFT.theme.cycle() }, icon('moon', 18)));
    if (mode === 'guest') nav.append(
      h('button', { class: 'dk-only chip dk-login', onClick: () => App.push(S.login()) }, 'Se connecter'),
      h('button', { class: 'dk-only btn primary dk-cta', onClick: () => App.push(S.signupTruck()) }, 'Je suis food truck'));
  }

  /** Page d'accueil « ordinateur » (visiteur non connecté) : en-tête, présentation avec aperçu de carte, deux profils, pied de page.
   *  Construite avec l'accueil téléphone mais cachée tant que desktop.css n'est pas actif (voir `.dk-only`). */
  function welcome() {
    const { h, icon } = MFT.ui; const App = MFT.App; const S = MFT.screens;
    const tick = (t) => h('li', null, icon('check', 18), t);
    const ghost = (cls, txt, fn) => h('button', { class: cls, onClick: fn }, txt);
    const card = (num, tag, title, sub, items, btn) => h('article', { class: 'wl-card' },
      h('div', { class: 'wl-card-hd' }, h('span', { class: 'lbl' }, num), tag ? h('span', { class: 'lbl' }, tag) : null),
      h('div', { class: 'wl-card-bd' }, h('h2', null, title), h('p', null, sub), h('ul', null, items.map(tick)), btn));
    const pin = (letter, x, y, cls) => h('div', { class: 'pin ' + (cls || 'later'), style: { left: x + '%', top: y + '%' } }, h('div', { class: 'b' }), h('div', { class: 'l' }, letter));
    const svgNS = 'http://www.w3.org/2000/svg';
    const bg = document.createElementNS(svgNS, 'svg'); bg.setAttribute('viewBox', '0 0 560 490'); bg.setAttribute('preserveAspectRatio', 'xMidYMid slice'); bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<rect x="40" y="60" width="120" height="80" rx="10" class="wl-park"/><rect x="380" y="300" width="110" height="70" rx="10" class="wl-park"/>'
      + '<path d="M-20 250 C80 210 180 290 290 260 S480 200 580 240" fill="none" stroke-width="34" class="wl-water"/>'
      + '<g class="wl-lines" fill="none" stroke-width="1.5"><path d="M0 110H560M0 330H560M0 410H560M90 0V490M210 0V490M360 0V490M470 0V490"/><path d="M-10 60L570 170M-10 380L570 300" stroke-width="2.5"/></g>';
    const truckCard = card('02 · Food truck', '', 'Je suis food truck', 'J’annonce où je serai et quand.',
      ['Planning des 7 prochains jours', 'Ma carte, mes produits, ma présentation', 'Mes vues, mes abonnés, mes alertes'],
      h('button', { class: 'btn', onClick: () => App.push(S.signupTruck()) }, 'Créer mon compte food truck'));
    const legal = (label, title, k) => h('button', { class: 'lbl', onClick: () => S.legalSheet(title, S[k]) }, label);
    return h('div', { class: 'wl-dk dk-only' },
      h('header', { class: 'wl-head' },
        h('div', { class: 'wl-brand' }, h('img', { src: 'assets/icon.png', alt: '' }), h('span', { class: 'lbl' }, 'LocalTruck')),
        h('nav', { class: 'wl-links', 'aria-label': 'Navigation' },
          ghost('wl-link', 'Trouver un food truck', () => App.enterGuest()),
          ghost('wl-link', 'Pour les food trucks', () => truckCard.scrollIntoView({ behavior: 'smooth', block: 'center' }))),
        MFT.theme ? h('button', { class: 'wl-tool', 'aria-label': 'Changer l’apparence (nuit ou jour)', title: 'Nuit / jour', onClick: () => MFT.theme.cycle() }, icon('moon', 18)) : null,
        h('button', { class: 'chip wl-login', onClick: () => App.push(S.login()) }, 'Se connecter')),
      h('section', { class: 'wl-hero' },
        h('div', { class: 'wl-copy' },
          h('span', { class: 'lbl' }, 'Carte des food trucks · France'),
          h('h1', { class: 'wl-h1' }, 'Les food', h('br'), 'trucks qui', h('br'), 'sont là,', h('br'), h('span', { class: 'accent' }, 'ce soir.')),
          h('p', { class: 'wl-lead' }, 'Chaque food truck annonce où il sera et à quelle heure. Vous voyez tout sur une carte, autour de vous.'),
          h('div', { class: 'wl-cta' },
            h('button', { class: 'btn primary lg', onClick: () => App.enterGuest() }, icon('map'), 'Voir la carte'),
            h('button', { class: 'btn lg', onClick: () => App.push(S.signupClient()) }, 'Créer mon compte')),
          h('div', { class: 'wl-chips' }, MFT.presence ? MFT.presence.badge('wl-live') : null, h('span', { class: 'chip on' }, 'Gratuit'), h('span', { class: 'chip' }, 'Sans compte pour consulter'), h('span', { class: 'chip' }, 'Sans publicité'))),
        h('div', { class: 'wl-visual', 'aria-hidden': 'true' },
          h('div', { class: 'wl-map' },
            h('div', { class: 'wl-map-in' }, bg, h('div', { class: 'wl-ring' }), pin('F', 30, 30, 'open'), pin('L', 62, 24, 'soon'), pin('B', 46, 44, 'open sel'), pin('C', 24, 58, 'later'), pin('T', 68, 56, 'open'), h('span', { class: 'chip on wl-map-chip' }, 'Ce soir')),
            h('div', { class: 'wl-truck' },
              h('div', { class: 'wl-truck-top' }, h('span', { class: 'tag open' }, 'Ouvert'), h('span', { class: 'lbl' }, '600 m')),
              h('div', { class: 'wl-truck-row' }, h('span', { class: 'avatar' }, 'B'), h('div', { class: 'wl-truck-name' }, h('h3', null, 'Burger Atelier'), h('span', { class: 'lbl' }, 'Place de la Mairie')), h('div', { class: 'wl-truck-hrs' }, h('b', null, '17:30'), h('span', { class: 'lbl' }, '21:30'))))))),
      h('section', { class: 'wl-cards', 'aria-label': 'Choisir son profil' },
        card('01 · Client', 'Gratuit', 'Je suis client', 'Je cherche un food truck près de moi.',
          ['Carte et liste autour de moi, rayon réglable', 'Planning et carte de chaque food truck', 'Favoris et alertes de proximité'],
          h('button', { class: 'btn primary', onClick: () => App.push(S.signupClient()) }, 'Créer mon compte client')),
        truckCard),
      h('footer', { class: 'wl-foot' },
        h('span', { class: 'lbl' }, 'LocalTruck · gratuit · France · Cartes © contributeurs OpenStreetMap'),
        S.siteLinks && S.siteLinks() ? h('nav', { 'aria-label': 'Pages du site' }, h('a', { class: 'lbl', href: '/food-trucks/' }, 'Food trucks par ville'), h('a', { class: 'lbl', href: '/trouver-un-food-truck/' }, 'Trouver un food truck'), h('a', { class: 'lbl', href: '/pour-les-food-trucks/' }, 'Pour les food trucks')) : null,
        h('nav', { 'aria-label': 'Informations légales' }, legal('Mentions légales', 'Mentions légales', 'NOTICE'), legal('Conditions', 'Conditions d’utilisation', 'TERMS'), legal('Confidentialité', 'Politique de confidentialité', 'PRIVACY'))));
  }

  MFT.desktop = { on, decorate, welcome, query: Q };
})();
