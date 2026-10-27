/* LocalTruck – pages « départements, villes et food trucks » pour Google : /food-trucks/, /food-trucks/<département>/, /food-trucks/<département>/<ville>/ et /food-truck/<nom>/.
 * Fabriquées à partir de la liste des fiches visibles de tous (voir seo-places.js) : aucune donnée personnelle, pas de compte Instagram, pas de téléphone.
 * Le gabarit (page, esc, SITE…) est fourni par build-seo.js. */
'use strict';
const { DEPARTMENTS, REGIONS, slugify, host } = require('./seo-places.js');

/** « à Lorient », « au Trévoux », « aux Sables-d’Olonne », « à La Rochelle ». */
function aVille(city) {
  if (/^Le\s/.test(city)) return 'au ' + city.slice(3);
  if (/^Les\s/.test(city)) return 'aux ' + city.slice(4);
  return 'à ' + city;
}
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,;:(–-]+\S*$/, '') + '…');
const fit = (max, ...c) => c.find((x) => x.length <= max) || clip(c[c.length - 1], max);
const plural = (n, un, plus) => n + ' ' + (n > 1 ? plus : un);
const joinList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1]);

/* Pastille du food truck : initiales et couleur stable (calculée à partir de l'adresse de la fiche). */
const PALETTE = ['#FFC83D', '#3DDC97', '#8DB6FF', '#FF8E68', '#FFD76B', '#5BE3A6', '#C9B6FF'];
const STOP = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'chez', 'et', 'au', 'aux', 'a', 'the']);
function initials(name) {
  const w = String(name).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const k = w.filter((x) => !STOP.has(x.toLowerCase())); const u = k.length ? k : w;
  if (!u.length) return '?';
  return (u[0][0] + (u[1] ? u[1][0] : (u[0][1] || ''))).toUpperCase();
}
const colorOf = (slug) => PALETTE[[...String(slug)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

/* « Autour de » : les food trucks à moins de NEAR_KM d'un point (distance à vol d'oiseau). Les coordonnées ne servent qu'à classer : seule la distance arrondie est écrite. */
const NEAR_KM = 40;
const FAR_KM = 80;        // une ville sans food truck à moins de NEAR_KM garde sa page si un food truck est à moins de FAR_KM (sinon : pas de page vide)
const RAD = Math.PI / 180;
const km = (a, b) => { const x = Math.sin((b.lat - a.lat) * RAD / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin((b.lng - a.lng) * RAD / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const hasGeo = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
const centreOf = (list) => { const g = list.filter(hasGeo); return g.length ? { lat: g.reduce((n, p) => n + p.lat, 0) / g.length, lng: g.reduce((n, p) => n + p.lng, 0) / g.length } : null; };

/** extra.communes : [[nom, département, latitude, longitude], …] — villes qui n'ont pas encore de food truck : elles ont leur page dès qu'un food truck est à moins de NEAR_KM. */
function buildVilles(places, T, today, extra) {
  const { page, esc, SITE } = T;
  const files = {}; const urls = [];
  const dir = (...p) => p.join('/');
  const add = (d, p, priority) => { files[d + '/index.html'] = page(Object.assign({ dir: d }, p)); urls.push({ loc: SITE + '/' + d + '/', priority, ...(today ? { lastmod: today } : {}) }); };
  const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, d], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + '/' + (d ? d + '/' : '') })) });
  const trail = (items) => '<nav class="crumbs" aria-label="Fil d’Ariane">' + items.map(([name, d]) => (d === null ? '<span>' + esc(name) + '</span>' : '<a href="/' + (d ? d + '/' : '') + '">' + esc(name) + '</a>')).join('') + '</nav>';

  // regroupement département → ville → fiches
  const deps = new Map();
  const names = new Map(); // « Saint Malo » et « Saint-Malo » donnent la même adresse : on garde la première écriture
  for (const p0 of places) {
    const k = p0.department + '/' + slugify(p0.city); if (!names.has(k)) names.set(k, p0.city);
    const p = p0.city === names.get(k) ? p0 : Object.assign({}, p0, { city: names.get(k) });
    if (!deps.has(p.department)) deps.set(p.department, new Map());
    const cities = deps.get(p.department);
    if (!cities.has(p.city)) cities.set(p.city, []);
    cities.get(p.city).push(p);
  }
  const all = [...deps.values()].flatMap((c) => [...c.values()].flat());
  /** Les food trucks à moins de NEAR_KM du point `c`, hors `skip(p)`, du plus proche au plus éloigné. */
  const near = (c, skip, max, radius = NEAR_KM) => (c ? all.filter((p) => hasGeo(p) && !skip(p)).map((p) => ({ p, d: km(c, p) })).filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d || a.p.name.localeCompare(b.p.name, 'fr')).slice(0, max) : []);
  // villes sans food truck référencé, avec au moins un food truck à moins de NEAR_KM : une page « à proximité » chacune
  const voisines = new Map(); // département → [{ name, around, nb }]
  const seenV = new Set();
  for (const [name, department, lat, lng] of (extra && Array.isArray(extra.communes) ? extra.communes : [])) {
    const key = department + '/' + slugify(name);
    if (!DEPARTMENTS[department] || !Number.isFinite(lat) || !Number.isFinite(lng) || names.has(key) || seenV.has(key)) continue;
    let radius = NEAR_KM; let found = near({ lat, lng }, () => false, 999, radius);
    if (!found.length) { radius = FAR_KM; found = near({ lat, lng }, () => false, 999, radius); }
    if (!found.length) continue;
    seenV.add(key);
    if (!voisines.has(department)) voisines.set(department, []);
    voisines.get(department).push({ name, around: found.slice(0, 8), nb: found.length, radius });
    if (!deps.has(department)) deps.set(department, new Map()); // département sans food truck mais voisin d'un food truck
  }
  const depSlug = (code) => slugify(DEPARTMENTS[code]);
  const citySlug = (c) => slugify(c);
  const depDir = (code) => dir('food-trucks', depSlug(code));
  const cityDir = (code, c) => dir('food-trucks', depSlug(code), citySlug(c));
  const truckDir = (p) => dir('food-truck', p.slug);
  const depList = [...deps.entries()].sort((a, b) => [...b[1].values()].flat().length - [...a[1].values()].flat().length || DEPARTMENTS[a[0]].localeCompare(DEPARTMENTS[b[0]], 'fr'));
  const count = (cities) => [...cities.values()].reduce((n, l) => n + l.length, 0);
  const regionOf = (code) => REGIONS.find((r) => r.departments.includes(code));
  const regDir = (r) => dir('food-trucks', r.slug);
  /** Fil d'Ariane jusqu'au département (région comprise quand elle a sa page). */
  const up = (code) => [['LocalTruck', ''], ['Food trucks', 'food-trucks']].concat(regionOf(code) ? [[regionOf(code).name, regDir(regionOf(code))]] : [], [[DEPARTMENTS[code], depDir(code)]]);
  /* éléments visuels (même charte que l'application) : le texte et les liens restent ceux que lisent les moteurs de recherche */
  const avatar = (p, cls) => `<span class="avatar${cls ? ' ' + cls : ''}" style="background:${colorOf(p.slug)}" aria-hidden="true">${esc(initials(p.name))}</span>`;
  const nearItem = ({ p, d }) => `<li class="near glass">${avatar(p)}<span class="t"><a class="nm" href="/${truckDir(p)}/">${esc(p.name)}</a><span>${p.cuisine ? esc(p.cuisine) + ' · ' : ''}<a href="/${cityDir(p.department, p.city)}/">${esc(p.city)}</a></span></span>${d != null ? '<span class="km">à ' + Math.max(1, Math.round(d)) + ' km</span>' : ''}</li>`;
  const nears = (items) => '<ul class="nears">' + items.map(nearItem).join('') + '</ul>';
  const truckCard = (p) => `<li class="truck glass"><div class="row">${avatar(p)}<div><h3><a href="/${truckDir(p)}/">${esc(p.name)}</a></h3><div class="tags">${p.cuisine ? '<span class="tag">' + esc(p.cuisine) + '</span>' : ''}<span class="tag unv">Pas encore vérifié</span></div></div></div>`
    + (p.usual.length ? '<div class="usual"><span class="lbl">Habituellement</span>' + p.usual.slice(0, 4).map((u) => '<div>' + esc(u) + '</div>').join('') + '</div>' : '')
    + `<div class="acts"><a class="btn sm" href="/${truckDir(p)}/">Voir la fiche</a><a class="btn sm primary" href="/#/t/${p.slug}">Sur la carte</a></div></li>`;
  const qa = (items) => '<div class="faq">' + items.filter(Boolean).map(([q, a], i) => '<details class="glass"' + (i ? '' : ' open') + '><summary><h3>' + q + '</h3></summary><p>' + a + '</p></details>').join('\n') + '</div>';
  const callout = (h, txt, label, href) => '<section class="callout glass"><div><h2>' + h + '</h2><p>' + txt + '</p></div><a class="btn primary" href="' + (href || '/') + '">' + (label || 'Ouvrir la carte') + '</a></section>';
  const stats = (cells) => '<div class="stats">' + cells.map(([n, l, ac]) => '<div class="stat glass"><div class="n' + (ac ? ' ac' : '') + '">' + n + '</div><span class="lbl">' + l + '</span></div>').join('') + '</div>';
  const proBox = (where) => '<section class="box glass"><span class="lbl">Vous tenez un food truck ?</span><h2>Faites-vous trouver ' + where + '</h2><p>Fiche gratuite, sans commission : annoncez où vous serez, vos habitués sont prévenus.</p><p><a class="btn primary" href="/pour-les-food-trucks/">Créer ma fiche</a></p></section>';
  const chips = (items) => '<ul class="chips">' + items.map(([href, label, n]) => '<li><a class="chip" href="' + href + '">' + esc(label) + (n ? '<em>' + n + '</em>' : '') + '</a></li>').join('') + '</ul>';
  /** « à <span>Quimper</span> », « au <span>Trévoux</span> » : le nom de la ville en orange, le texte reste identique. */
  const accent = (av, name) => { const tail = String(name).replace(/^(Le|Les)\s/, ''); const i = av.lastIndexOf(tail); return i < 0 ? esc(av) : esc(av.slice(0, i)) + '<span class="ac">' + esc(tail) + '</span>' + esc(av.slice(i + tail.length)); };
  const OPEN_TXT = 'Un food truck change souvent de lieu d’un jour à l’autre. La carte LocalTruck affiche <strong>qui est ouvert maintenant, à quelle heure et à quel endroit</strong>, d’après ce que chaque food truck annonce lui-même.';

  const itemList = (list) => ({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: list.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + '/' + truckDir(p) + '/', name: p.name })) });
  const establishment = (p) => ({
    '@context': 'https://schema.org', '@type': 'FoodEstablishment', name: p.name, url: SITE + '/' + truckDir(p) + '/',
    address: { '@type': 'PostalAddress', addressLocality: p.city, addressRegion: DEPARTMENTS[p.department], addressCountry: 'FR' },
    ...(p.cuisine ? { servesCuisine: p.cuisine } : {}),
  });

  const regionsWithPage = REGIONS.filter((r) => depList.some(([code]) => r.departments.includes(code)));
  const regionCount = (r) => depList.filter(([code]) => r.departments.includes(code)).reduce((n, [, c]) => n + count(c), 0);

  /* ---------- /food-trucks/ */
  add('food-trucks', {
    title: 'Food trucks en France : par département et par ville | LocalTruck',
    desc: 'Les food trucks de France par département et par ville : ce qu’ils servent, où les retrouver, et la carte pour savoir qui est ouvert ce soir. Gratuit, sans publicité.',
    h1: 'Food trucks par département et par ville',
    ld: [crumbs([['LocalTruck', ''], ['Food trucks', 'food-trucks']])],
    top: trail([['LocalTruck', ''], ['Food trucks', null]]), body: `
<p class="lead">LocalTruck recense <strong>${plural(places.length, 'food truck', 'food trucks')}</strong> dans <strong>${plural(depList.filter(([, c]) => count(c)).length, 'département', 'départements')}</strong>. Choisissez votre département, puis votre ville : vous verrez ce que chaque food truck sert et où le retrouver.</p>
${regionsWithPage.length ? '<h2>Les régions</h2><ul class="cols">' + regionsWithPage.map((r) => `<li><a href="/${regDir(r)}/">${esc(r.name)}</a> <span class="mu">· ${plural(regionCount(r), 'food truck', 'food trucks')}</span></li>`).join('') + '</ul>' : ''}
<h2>Les départements</h2>
<ul class="cols">${depList.map(([code, cities]) => `<li><a href="/${depDir(code)}/">${esc(DEPARTMENTS[code])} (${code})</a> <span class="mu">· ${count(cities) ? plural(count(cities), 'food truck', 'food trucks') : 'food trucks à proximité'}</span></li>`).join('')}</ul>
<h2>Savoir qui est ouvert ce soir</h2>
<p>Les listes ci-dessus donnent une idée de qui est près de chez vous. Pour voir <strong>qui est ouvert maintenant, à quelle heure et à quel endroit</strong>, ouvrez la carte : elle se base sur votre position (jamais enregistrée) et sur les emplacements annoncés par les food trucks eux-mêmes.</p>
<p class="cta-row"><a class="cta" href="/">Ouvrir la carte</a></p>
${proBox('partout en France')}`,
  }, '0.7');

  /* ---------- départements et villes */
  for (const [code, cities] of depList) {
    const dn = DEPARTMENTS[code]; const nb = count(cities);
    const cityList = [...cities.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'));
    const vois = (voisines.get(code) || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    add(depDir(code), {
      title: fit(70, nb ? 'Food trucks – ' + dn + ' (' + code + ') : liste par ville | LocalTruck' : 'Food trucks – ' + dn + ' (' + code + ') : villes à proximité | LocalTruck', 'Food trucks – ' + dn + ' (' + code + ') | LocalTruck'),
      desc: clip(nb ? plural(nb, 'food truck repéré', 'food trucks repérés') + ' – ' + dn + ' (' + code + '), dans ' + plural(cities.size, 'ville', 'villes') + ' : cuisine, emplacements habituels et carte pour savoir qui est ouvert ce soir.'
        : 'Pas encore de food truck référencé en ' + dn + ' (' + code + '), mais ' + plural(vois.length, 'ville a', 'villes ont') + ' des food trucks à moins de ' + NEAR_KM + ' km : où les trouver et qui est ouvert ce soir.', 170),
      h1: 'Food trucks : ' + dn + ' (' + code + ')', h1Html: 'Food trucks : <span class="ac">' + esc(dn) + '</span> (' + code + ')',
      ld: [crumbs(up(code))],
      top: trail(up(code).slice(0, -1).concat([[dn, null]])), body: `
<p class="lead">${nb ? plural(nb, 'food truck', 'food trucks') + ' repéré' + (nb > 1 ? 's' : '') + ' – ' + esc(dn) + ' (' + code + '), dans ' + plural(cities.size, 'ville', 'villes') + '. Touchez une ville pour voir qui y est et ce qu’il sert.'
  : 'Aucun food truck n’est encore référencé en ' + esc(dn) + ' (' + code + '), mais ' + plural(vois.length, 'ville a', 'villes ont') + ' des food trucks à moins de ' + NEAR_KM + ' km.'}</p>
${cityList.length ? '<h2>Les villes</h2><ul class="cols">' + cityList.map(([c, l]) => `<li><a href="/${cityDir(code, c)}/">${esc(c)}</a> <span class="mu">· ${plural(l.length, 'food truck', 'food trucks')}</span></li>`).join('') + '</ul>' : ''}
${vois.length ? '<h2>Villes proches de food trucks</h2><p class="mu">Pas encore de food truck référencé dans ces villes, mais il y en a à moins de ' + NEAR_KM + ' km.</p><ul class="cols">' + vois.map((v) => `<li><a href="/${cityDir(code, v.name)}/">${esc(v.name)}</a> <span class="mu">· ${plural(v.nb, 'food truck', 'food trucks')} à proximité</span></li>`).join('') + '</ul>' : ''}
${nb ? '<h2>Les food trucks</h2>' + nears([...cities.values()].flat().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((p) => ({ p }))) : ''}
<p class="cta-row"><a class="cta" href="/">Voir la carte en direct</a></p>
${proBox('– ' + esc(dn))}`,
    }, '0.6');

    for (const [city, list] of cityList) {
      const av = aVille(city); const others = cityList.filter(([c]) => c !== city).slice(0, 12);
      const around = near(centreOf(list), (p) => p.department === code && p.city === city, 8);
      const total = list.length + around.length;
      const cuisines = [...new Set(list.concat(around.map((x) => x.p)).flatMap((p) => p.cuisine.split(/\s*,\s*/)).map((c) => c.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
      const here = list.slice(0, 5).map((p) => esc(p.name));
      add(cityDir(code, city), {
        title: fit(70, ...(around.length ? ['Food truck ' + av + ' (' + code + ') : ' + plural(total, 'food truck', 'food trucks') + ' à proximité | LocalTruck'] : []), 'Food truck ' + av + ' (' + code + ') : liste et où les trouver | LocalTruck', 'Food truck ' + av + ' (' + code + ') | LocalTruck'),
        desc: clip(around.length ? plural(total, 'food truck', 'food trucks') + ' ' + av + ' et à moins de ' + NEAR_KM + ' km (' + dn + ') : ce qu’ils servent, où les trouver, et la carte pour savoir qui est ouvert ce soir. Gratuit.'
          : plural(list.length, 'food truck', 'food trucks') + ' ' + av + ' (' + dn + ') : ce qu’ils servent, leurs emplacements habituels, et la carte pour savoir qui est ouvert ce soir. Gratuit.', 170),
        h1: 'Food truck ' + av + ' (' + code + ')', h1Html: 'Food truck ' + accent(av, city) + ' (' + code + ')',
        ld: [crumbs(up(code).concat([[city, cityDir(code, city)]])), itemList(list.concat(around.map((x) => x.p)))],
        top: trail(up(code).concat([[city, null]])), body: `
<p class="lead">Où trouver un food truck ${esc(av)} ? LocalTruck recense <strong>${plural(list.length, 'food truck', 'food trucks')}</strong> ${esc(av)} (${esc(dn)})${around.length ? ' et ' + plural(around.length, 'autre', 'autres') + ' à moins de ' + NEAR_KM + ' km' : ''}. Voici qui ils sont, ce qu’ils servent et, quand ils l’annoncent, où les retrouver.</p>
${stats([[list.length, esc(av), true], [around.length, 'à moins de ' + NEAR_KM + ' km'], ['0 €', 'gratuit, sans compte']])}
${callout('Qui est ouvert ce soir ' + esc(av) + ' ?', OPEN_TXT + ' Vous pouvez aussi suivre vos préférés et être prévenu s’ils changent de lieu.')}
<h2>Food trucks ${esc(av)}</h2>
<ul class="cards two">${list.map(truckCard).join('')}</ul>
${around.length ? '<h2>Food trucks dans les environs (moins de ' + NEAR_KM + ' km)</h2>' + nears(around) : ''}
<h2>Questions fréquentes</h2>
${qa([
  ['Où trouver un food truck ' + esc(av) + ' ?', (list.length > 1 ? 'LocalTruck en recense ' + list.length + ' ' + esc(av) + ' : ' : 'LocalTruck en recense un ' + esc(av) + ' : ') + joinList(here) + (list.length > 5 ? ' et ' + (list.length - 5) + ' autre' + (list.length - 5 > 1 ? 's' : '') : '') + '.' + (around.length ? ' D’autres sont installés à proximité, ' + joinList([...new Set(around.map((x) => esc(x.p.city)))].slice(0, 4)) + ' notamment.' : '')],
  cuisines.length ? ['Que mange-t-on chez les food trucks ' + esc(av) + ' ?', 'Au menu, entre autres : ' + esc(joinList(cuisines)) + '. Chaque fiche détaille ce que le food truck sert.'] : null,
  ['Je tiens un foodtruck ' + esc(av) + ' : comment être visible ?', 'Créez gratuitement votre fiche : vos clients voient où vous serez ce soir et sont prévenus d’un changement de lieu. <a href="/pour-les-food-trucks/">Voir comment faire</a>.'],
])}
${others.length ? '<h2>Autres villes – ' + esc(dn) + '</h2>' + chips(others.map(([c, l]) => ['/' + cityDir(code, c) + '/', c, l.length])) : ''}
${proBox(esc(av))}`,
      }, '0.6');

      for (const p of list) {
        const where = p.usual.length
          ? `<h2>Où le trouver</h2><div class="usual"><span class="lbl">Emplacements habituels${p.usualSource && host(p.usualSource) && !/instagram\.com$/.test(host(p.usualSource)) ? ' (source : ' + esc(host(p.usualSource)) + ')' : ''}</span>${p.usual.map((u) => '<div>' + esc(u) + '</div>').join('')}</div><p class="mu">Ces emplacements peuvent changer : la carte LocalTruck montre ceux annoncés pour aujourd’hui.</p>`
          : '<h2>Où le trouver</h2><p>Les emplacements du jour s’affichent sur la carte LocalTruck dès que le food truck les annonce.</p>';
        add(truckDir(p), {
          title: fit(70, p.name + ' : food truck ' + av + ' | LocalTruck', p.name + ' | food truck ' + av, p.name + ' | LocalTruck'),
          desc: clip(p.name + ', food truck ' + av + ' (' + dn + ')' + (p.cuisine ? ' – ' + p.cuisine : '') + '. Où le trouver ce soir : emplacements habituels et carte en direct.', 170),
          h1: p.name,
          ld: [crumbs(up(code).concat([[city, cityDir(code, city)], [p.name, truckDir(p)]])), establishment(p)],
          top: trail(up(code).concat([[city, cityDir(code, city)], [p.name, null]])) + avatar(p, 'lg'), body: `
<div class="tags">${p.cuisine ? '<span class="tag">' + esc(p.cuisine) + '</span>' : ''}<span class="tag">${esc(p.city)}</span><span class="tag unv">Pas encore vérifié</span></div>
<p class="lead">${esc(p.name)} est un food truck${p.cuisine ? ' (' + esc(p.cuisine.toLowerCase()) + ')' : ''} présent ${esc(av)} (${esc(dn)}).</p>
${where}
<p class="cta-row"><a class="cta" href="/#/t/${p.slug}">Voir la fiche sur la carte</a></p>
${(() => { const nb = near(hasGeo(p) ? p : centreOf(list), (q) => q.slug === p.slug, 5); return nb.length ? '<h2>Autres food trucks à proximité</h2>' + nears(nb) : ''; })()}
<p>Tous les <a href="/${cityDir(code, city)}/">food trucks ${esc(av)}</a> · <a href="/${depDir(code)}/">food trucks – ${esc(dn)}</a></p>
<section class="box glass"><span class="lbl">Vous êtes ${esc(p.name)} ?</span>
<h2>Faites connaître cette page</h2>
<p><a href="/#/t/${p.slug}/reprendre">Reprenez gratuitement votre fiche</a> pour annoncer vos emplacements et prévenir vos clients.</p>
<p>Ajoutez ce lien à votre site ou à la présentation de vos réseaux sociaux : vos clients vous retrouvent plus facilement. Touchez le texte pour le sélectionner, puis copiez-le.</p>
<p><code>${SITE}/${truckDir(p)}/</code></p>
<p class="mu">Pour un site web :</p>
<pre><code>&lt;a href="${SITE}/${truckDir(p)}/"&gt;Retrouvez-nous sur LocalTruck&lt;/a&gt;</code></pre>
</section>`,
        }, '0.5');
      }
    }

    for (const v of vois) {
      const av = aVille(v.name); const r = v.radius;
      add(cityDir(code, v.name), {
        title: fit(70, 'Food truck ' + av + ' (' + code + ') : ' + plural(v.nb, 'food truck', 'food trucks') + ' à proximité | LocalTruck', 'Food truck ' + av + ' (' + code + ') | LocalTruck'),
        desc: clip('Pas encore de food truck référencé ' + av + ', mais ' + plural(v.nb, 'food truck', 'food trucks') + ' à moins de ' + r + ' km (' + dn + ') : ce qu’ils servent, où les trouver et qui est ouvert ce soir. Gratuit.', 170),
        h1: 'Food truck ' + av + ' (' + code + ')', h1Html: 'Food truck ' + accent(av, v.name) + ' (' + code + ')',
        ld: [crumbs(up(code).concat([[v.name, cityDir(code, v.name)]])), itemList(v.around.map((x) => x.p))],
        top: trail(up(code).concat([[v.name, null]])), body: `
<p class="lead">Où trouver un food truck ${esc(av)} ? Aucun food truck n’est encore référencé ${esc(av)} sur LocalTruck, mais <strong>${plural(v.nb, 'food truck', 'food trucks')}</strong> ${v.nb > 1 ? 'sont installés' : 'est installé'} à moins de ${r} km.</p>
${callout('Qui est ouvert ce soir près de ' + esc(v.name) + ' ?', OPEN_TXT.replace('d’un jour à l’autre.', 'd’un jour à l’autre, et certains se déplacent d’une commune à l’autre.'))}
<h2>Les food trucks les plus proches</h2>
${nears(v.around)}
<h2>Questions fréquentes</h2>
${qa([
  ['Y a-t-il un food truck ' + esc(av) + ' ?', 'Pas encore de fiche ' + esc(av) + ' sur LocalTruck. Les plus proches : ' + joinList(v.around.slice(0, 3).map((x) => esc(x.p.name) + ' (' + esc(x.p.city) + ', à environ ' + Math.max(1, Math.round(x.d)) + ' km)')) + '.'],
  ['Je tiens un foodtruck ' + esc(av) + ' : comment être visible ?', 'Créez gratuitement votre fiche : vos clients voient où vous serez ce soir et sont prévenus d’un changement de lieu. <a href="/pour-les-food-trucks/">Voir comment faire</a>.'],
])}
<p>Tous les <a href="/${depDir(code)}/">food trucks – ${esc(dn)}</a></p>
${proBox(esc(av))}`,
      }, '0.4');
    }
  }

  /* ---------- régions */
  for (const r of regionsWithPage) {
    const rd = depList.filter(([code]) => r.departments.includes(code));
    const nbR = regionCount(r); const nbVois = rd.reduce((n, [code]) => n + (voisines.get(code) || []).length, 0);
    const villesR = rd.reduce((n, [, c]) => n + c.size, 0);
    add(regDir(r), {
      title: fit(70, 'Food trucks ' + r.prep + ' : par département et par ville | LocalTruck', 'Food trucks ' + r.prep + ' | LocalTruck'),
      desc: clip('Les food trucks ' + r.prep + ' par département et par ville : ' + plural(nbR, 'food truck repéré', 'food trucks repérés') + (nbVois ? ', et les villes qui en ont à proximité' : '') + '. Ce qu’ils servent, où les trouver, qui est ouvert ce soir. Gratuit.', 170),
      h1: 'Food trucks ' + r.prep, h1Html: 'Food trucks ' + accent(r.prep, r.name),
      ld: [crumbs([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [r.name, regDir(r)]])],
      top: trail([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [r.name, null]]), body: `
<p class="lead">LocalTruck recense <strong>${plural(nbR, 'food truck', 'food trucks')}</strong> ${esc(r.prep)}, dans ${plural(villesR, 'ville', 'villes')}${nbVois ? ', et ' + plural(nbVois, 'autre ville a', 'autres villes ont') + ' des food trucks à proximité' : ''}. Choisissez votre département, puis votre ville.</p>
${rd.map(([code, cities]) => {
        const cl = [...cities.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'));
        return `<h2><a href="/${depDir(code)}/">${esc(DEPARTMENTS[code])} (${code})</a></h2>` + (cl.length ? '<ul class="cols">' + cl.map(([c, l]) => `<li><a href="/${cityDir(code, c)}/">${esc(c)}</a> <span class="mu">· ${plural(l.length, 'food truck', 'food trucks')}</span></li>`).join('') + '</ul>' : '<p class="mu">Pas encore de food truck référencé ; <a href="/' + depDir(code) + '/">voir les villes proches de food trucks</a>.</p>');
      }).join('\n')}
${callout('Qui est ouvert ce soir ?', 'La carte LocalTruck affiche <strong>qui est ouvert maintenant, à quelle heure et à quel endroit</strong>, d’après ce que chaque food truck annonce lui-même.')}
${proBox(esc(r.prep))}`,
    }, '0.7');
  }
  return { files, urls };
}

module.exports = { buildVilles, aVille };
