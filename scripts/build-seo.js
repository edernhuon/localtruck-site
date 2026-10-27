#!/usr/bin/env node
/* LocalTruck – pages statiques pour le référencement (Google, Bing).
 * L'application est une page unique construite par JavaScript : pour exister dans les moteurs de recherche, le site publie aussi de vraies pages
 * HTML (explications pour les clients et les food trucks, textes juridiques), un plan du site (sitemap.xml) et robots.txt.
 * Les textes juridiques viennent de src/renderer/js/legal.js (une seule source). Lancé par scripts/publish-web.sh.
 * Si la liste des fiches visibles est disponible (voir seo-places.js), il publie aussi une page par département, par ville et par food truck
 * (/food-trucks/…, /food-truck/…) : ce sont elles qui répondent aux recherches « food truck <ville> ».
 * usage : node scripts/build-seo.js <dossier de sortie> [--villes-only] [--live] [--file liste.json]
 *   --live         lit la liste des fiches sur Supabase (sinon : fichier --file ou variable SEO_PLACES, sinon pages villes déjà présentes dans le dossier)
 *   --villes-only  ne réécrit que les pages villes et les plans du site (rafraîchissement quotidien, voir .github/workflows/seo.yml) */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../src/renderer/js/legal.js');
const { loadPlaces } = require('./seo-places.js');
const { buildVilles } = require('./seo-villes.js');

const SITE = 'https://localtruck.fr';
const OG = SITE + '/assets/og-image.png';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mail = (s) => esc(s).split(L.LEGAL.contact).join('<a href="mailto:' + L.LEGAL.contact + '">' + L.LEGAL.contact + '</a>');
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ contenu */
const li = (items) => '<ul>' + items.map((x) => '<li>' + x + '</li>').join('') + '</ul>';
const faq = (items) => '<div class="faq">' + items.map(([q, a], i) => '<details class="glass"' + (i ? '' : ' open') + '><summary><h3>' + q + '</h3></summary><p>' + a + '</p></details>').join('\n') + '</div>';
const legalBody = (intro, blocks) => '<p class="lead">' + intro + '</p>' + blocks.map(([t, x]) => '<h2 id="' + slug(t) + '">' + esc(t) + '</h2><p>' + mail(x) + '</p>').join('\n');

const PAGES = [
  {
    dir: 'trouver-un-food-truck', updated: '2026-10-26', priority: '0.9',
    title: 'Trouver un food truck près de chez vous, ce soir – LocalTruck',
    desc: 'Où est le food truck ce soir ? La carte des food trucks près de vous : emplacements, horaires, menus et alertes. Gratuit, sans compte, partout en France.',
    h1: 'Trouver un food truck près de chez vous',
    body: `
<p class="lead">LocalTruck est une carte gratuite qui indique <strong>où sont les food trucks, à quelle heure ils ouvrent et ce qu’ils servent</strong>. Chaque food truck annonce lui-même son emplacement du jour : vous voyez d’un coup d’œil qui est ouvert maintenant, qui arrive ce soir et qui sera là demain.</p>
<h2>Comment ça marche</h2>
<ol>
<li><strong>Ouvrez la carte</strong>, sans créer de compte. Si vous acceptez la localisation, elle sert uniquement à afficher les food trucks autour de vous : elle n’est jamais enregistrée.</li>
<li><strong>Choisissez le moment</strong> : maintenant, ce soir, demain ou une date précise, et le type de cuisine (burgers, pizza, tacos, crêpes, asiatique, végé, desserts, boissons).</li>
<li><strong>Touchez une fiche</strong> : carte et prix indicatifs, plat du jour, photos, avis des clients et planning des sept prochains jours.</li>
<li><strong>Lancez l’itinéraire</strong> jusqu’à l’emplacement du food truck.</li>
</ol>
<h2>Ne ratez plus votre food truck préféré</h2>
<p>Avec un compte gratuit, suivez vos food trucks favoris : vous êtes prévenu quand l’un d’eux <strong>change de lieu, prend du retard ou annule</strong>. Vous pouvez aussi choisir une zone (votre quartier, votre ville) pour être alerté quand un food truck s’y installe.</p>
<h2>Installer l’application</h2>
<p>LocalTruck fonctionne directement dans le navigateur de votre téléphone. Vous pouvez l’ajouter à l’écran d’accueil (iPhone et Android) pour l’ouvrir comme une application, ou télécharger l’application Android.</p>
<h2>Questions fréquentes</h2>
${faq([
      ['Où voir les food trucks ouverts ce soir près de chez moi ?', 'Ouvrez la carte LocalTruck : les food trucks ouverts maintenant, ou qui ouvrent ce soir, s’affichent autour de votre position avec leurs horaires.'],
      ['LocalTruck est-il gratuit ?', 'Oui, pour les clients. Il n’y a ni publicité ni commande en ligne : vous réglez directement le food truck sur place.'],
      ['Faut-il créer un compte ?', 'Non pour consulter la carte et les fiches. Un compte gratuit permet de suivre des food trucks, de recevoir des alertes et de donner un avis.'],
      ['Les informations sont-elles fiables ?', 'Les emplacements et horaires sont renseignés par les food trucks eux-mêmes. Une fiche signalée plusieurs fois est marquée d’un point d’exclamation, et les avis suivent des <a href="/regles-des-avis/">règles publiques</a>.'],
      ['Dans quelles villes trouve-t-on des food trucks ?', 'LocalTruck couvre toute la France ; ce que vous voyez dépend des food trucks inscrits près de chez vous. Le vôtre n’y est pas ? Invitez-le à <a href="/pour-les-food-trucks/">créer sa fiche gratuitement</a>.'],
    ])}
<p class="cta-row"><a class="cta" href="/">Ouvrir la carte</a></p>`,
  },
  {
    dir: 'pour-les-food-trucks', updated: '2026-10-26', priority: '0.9',
    title: 'Référencer gratuitement son food truck – LocalTruck',
    desc: 'Annoncez où vous serez ce soir, prévenez vos clients d’un changement de lieu ou d’un retard et gagnez en visibilité. Inscription gratuite pour les food trucks.',
    h1: 'Annoncez où vous serez : vos clients vous trouvent',
    body: `
<p class="lead">LocalTruck est la carte gratuite où vos clients voient <strong>où vous êtes ce soir, à quelle heure et ce que vous servez</strong>. Vous annoncez votre emplacement en quelques secondes, et ceux qui vous suivent sont prévenus automatiquement.</p>
<h2>Ce que vous pouvez faire</h2>
${li([
      '<strong>Annoncer votre emplacement du jour</strong> et votre planning de la semaine, avec plusieurs créneaux par jour, un jour de repos ou une annulation en un geste.',
      '<strong>Prévenir vos abonnés</strong> d’un changement de lieu, d’un retard, d’une annulation ou d’un produit épuisé.',
      '<strong>Présenter votre fiche</strong> : logo, présentation, carte et prix indicatifs, plat du jour, galerie de photos, liens Instagram et Facebook, moyens de paiement acceptés.',
      '<strong>Suivre votre audience</strong> : vues de votre fiche, itinéraires lancés, nouveaux abonnés.',
      '<strong>Répondre aux avis</strong> de vos clients et partager la gestion avec votre équipe.',
    ])}
<h2>Sans commission, sans commande en ligne</h2>
<p>LocalTruck est un service d’information : il ne gère ni paiement, ni commande, ni click and collect. Vous encaissez vos clients comme d’habitude, directement.</p>
<h2>S’inscrire en trois étapes</h2>
<ol>
<li><strong>Votre compte</strong> : nom du gérant, adresse e-mail, mot de passe.</li>
<li><strong>Votre fiche</strong> : nom, type de cuisine, présentation, paiements acceptés.</li>
<li><strong>Votre premier emplacement</strong> : choisissez le lieu sur la carte et les horaires.</li>
</ol>
<p>Comptez quelques minutes. Sur la page d’accueil de l’application, choisissez « Je suis food truck », puis « Créer mon compte food truck ».</p>
<h2>Réservé aux professionnels</h2>
<p>Chaque food truck certifie exercer une activité professionnelle déclarée (numéro SIRET) et respecter la réglementation qui s’y applique : hygiène, allergènes, autorisations d’installation. LocalTruck ne vérifie pas ces points ; voir les <a href="/conditions-utilisation/">conditions d’utilisation</a>.</p>
<h2>Questions fréquentes</h2>
${faq([
      ['L’inscription est-elle gratuite ?', 'Oui, aujourd’hui l’inscription et l’utilisation sont gratuites. Si une offre payante devait un jour être proposée aux food trucks, ils en seraient prévenus à l’avance dans l’application et pourraient supprimer leur fiche avant le changement.'],
      ['Mes clients doivent-ils installer quelque chose ?', 'Non. La carte fonctionne dans le navigateur, sans compte. L’installation sur l’écran d’accueil est facultative.'],
      ['Puis-je gérer plusieurs food trucks ?', 'Oui, un même compte peut gérer plusieurs fiches, et vous pouvez ajouter des personnes de votre équipe qui ont déjà un compte.'],
      ['Comment supprimer ma fiche ?', 'Depuis votre profil, demandez la suppression de votre compte : votre fiche est masquée tout de suite, puis vos données sont effacées au plus tard sous un mois.'],
    ])}
<p class="cta-row"><a class="cta" href="/">Créer ma fiche gratuitement</a></p>`,
  },
  {
    dir: 'mentions-legales', updated: '2026-10-25', priority: '0.3',
    title: 'Mentions légales – LocalTruck', desc: 'Éditeur, hébergeurs et contact de LocalTruck, la carte gratuite des food trucks.',
    h1: 'Mentions légales', body: legalBody('Informations légales sur le site et l’application LocalTruck.', L.NOTICE),
  },
  {
    dir: 'conditions-utilisation', updated: '2026-10-25', priority: '0.3',
    title: 'Conditions d’utilisation – LocalTruck', desc: 'Règles d’utilisation de LocalTruck : informations déclaratives, responsabilité des food trucks, contenus, avis, signalement.',
    h1: 'Conditions d’utilisation', body: legalBody('Ce que fait LocalTruck, ce que chacun garantit, et comment signaler un contenu.', L.TERMS),
  },
  {
    dir: 'confidentialite', updated: '2026-10-25', priority: '0.3',
    title: 'Politique de confidentialité – LocalTruck', desc: 'Quelles données LocalTruck utilise, pourquoi, combien de temps, et comment exercer vos droits.',
    h1: 'Politique de confidentialité', body: legalBody('Vos données personnelles et vos droits (RGPD).', L.PRIVACY),
  },
  {
    dir: 'regles-des-avis', updated: '2026-10-25', priority: '0.3',
    title: 'Règles des avis – LocalTruck', desc: 'Comment les avis sur les food trucks sont publiés, contrôlés, modifiés et retirés sur LocalTruck.',
    h1: 'Règles des avis', body: legalBody('Comment sont traités les avis sur LocalTruck.', L.REVIEWS),
  },
];

/* ------------------------------------------------------------------ gabarit */
const CSS = `@font-face{font-family:"Archivo";src:url("/assets/fonts/archivo-var.woff") format("woff");font-weight:100 900;font-stretch:62% 125%;font-display:swap}
:root{--bg:#0B0B0D;--tx:#F7F5F1;--mu:rgba(247,245,241,.72);--mu2:rgba(247,245,241,.5);--ln:rgba(255,255,255,.14);--bd:rgba(255,255,255,.22);
--glass:linear-gradient(145deg,rgba(255,255,255,.12),rgba(255,255,255,.04));--hi:inset 0 1px 0 rgba(255,255,255,.22);--shadow:0 16px 40px rgba(0,0,0,.42);
--s1:rgba(255,255,255,.06);--s2:rgba(255,255,255,.1);--ac:#FF6A3D;--ac-tx:#FF8E68;--ac-tint:rgba(255,106,61,.16);--ac-bd:rgba(255,106,61,.55);--ac-glow:rgba(255,106,61,.35);
--font:"Archivo",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
*{box-sizing:border-box}html{background:var(--bg)}
body{margin:0;color:var(--tx);font:400 16px/1.6 var(--font);-webkit-font-smoothing:antialiased;
background:url("/assets/grain.png"),url("/assets/blueprint-dark.svg") no-repeat right -90px top 60px/420px auto,radial-gradient(circle at 0% -4%,rgba(255,106,61,.3),transparent 46%) no-repeat,var(--bg)}
a{color:var(--ac-tx);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:980px;margin:0 auto;padding:0 18px}
h1,h2,.wide,.avatar,.stat .n,.km{font-weight:800;font-stretch:125%;font-variation-settings:"wdth" 125;text-transform:uppercase;letter-spacing:-.005em}
.lbl,.crumbs a,.crumbs span,.btn,.tag,.chip{font-weight:700;font-stretch:118%;font-variation-settings:"wdth" 118;text-transform:uppercase;letter-spacing:.1em}
.lbl{font-size:10.5px;color:var(--mu);letter-spacing:.13em}
.glass{background:var(--glass);border:1px solid var(--bd);border-radius:22px;box-shadow:var(--shadow),var(--hi)}
.top{position:sticky;top:0;z-index:5;padding:12px 0;background:linear-gradient(rgba(11,11,13,.88),rgba(11,11,13,.6));-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--ln)}
.top .wrap{display:flex;align-items:center;gap:12px}.top .sp{flex:1}
.brand{display:flex;align-items:center;gap:10px;color:var(--tx);font-size:17px;font-weight:800;font-stretch:125%;font-variation-settings:"wdth" 125;text-transform:uppercase}
.brand:hover{text-decoration:none}.brand img{width:34px;height:34px;border-radius:10px}.brand .ac{color:var(--ac)}
.btn,.cta{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:8px 20px;border-radius:16px;font-size:12.5px;color:var(--tx);background:var(--s2);border:1px solid var(--bd);white-space:nowrap;text-decoration:none}
.btn:hover,.cta:hover{text-decoration:none}
.btn.primary,.cta{background:var(--ac);color:#0B0B0D;border-color:var(--ac);box-shadow:0 10px 28px var(--ac-glow);font-weight:700;font-stretch:118%;font-variation-settings:"wdth" 118;text-transform:uppercase;letter-spacing:.1em}
.btn.sm{min-height:38px;padding:4px 14px;font-size:11px;border-radius:13px}
.crumbs{display:flex;flex-wrap:wrap;gap:6px 8px;margin:26px 0 16px}
.crumbs a,.crumbs span{font-size:10.5px;color:var(--mu);padding:6px 11px;border-radius:999px;background:var(--s1);border:1px solid var(--ln)}
.crumbs span{color:var(--tx);border-color:var(--ac-bd);background:var(--ac-tint)}
h1{margin:0;font-size:clamp(30px,8vw,60px);line-height:1.04}main>h1:first-child{margin-top:32px}h1 .ac{color:var(--ac)}
h2{font-size:19px;line-height:1.2;margin:40px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--ln)}
h2 a{color:var(--tx)}h3{font-size:17px;line-height:1.3;margin:20px 0 4px}
p,li{color:var(--mu)}strong{color:var(--tx)}.lead{font-size:17.5px;margin:16px 0 0;max-width:680px}
.mu{color:var(--mu2);font-size:14.5px}ul,ol{padding-left:22px}li{margin:6px 0}
.cta-row{margin:28px 0}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,200px));gap:10px;margin:24px 0 0}
.stat{padding:14px 14px 12px;border-radius:18px}.stat .n{font-size:30px;line-height:1}.stat .n.ac{color:var(--ac)}.stat .lbl{display:block;margin-top:8px;font-size:10px;letter-spacing:.1em;overflow-wrap:anywhere}
.callout{margin:18px 0 0;padding:18px 20px;display:flex;align-items:center;gap:18px;background:linear-gradient(145deg,var(--ac-tint),rgba(255,106,61,.04));border-color:var(--ac-bd)}
.callout>div{flex:1}.callout h2{margin:0 0 4px;padding:0;border:0;font-size:16px}.callout p{margin:0;font-size:14.5px}
.cards,.nears{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.cards>*,.nears>*{min-width:0;margin:0}
.truck{padding:18px}.truck .row{display:flex;align-items:center;gap:14px}.truck h3{margin:0;font-size:18px;line-height:1.15}
.truck h3 a,.near .nm{color:var(--tx);font-weight:800;font-stretch:125%;font-variation-settings:"wdth" 125;text-transform:uppercase}
.avatar{width:56px;height:56px;border-radius:17px;display:grid;place-items:center;font-size:21px;color:#0B0B0D;flex:none}
.avatar.lg{width:84px;height:84px;font-size:32px;border-radius:24px;margin-bottom:16px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.tag{font-size:10px;padding:4px 9px;border-radius:999px;background:var(--s2);border:1px solid var(--ln);color:var(--mu)}.tag.unv{color:var(--mu2);border-style:dashed}
.usual{margin:14px 0 0;padding:12px 14px;border-radius:14px;background:var(--s1);border:1px solid var(--ln);font-size:14.5px}
.usual .lbl{display:block;margin-bottom:6px;font-size:9.5px}.usual div{color:var(--mu)}
.acts{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}.acts .btn{flex:1}
.near{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:18px}.near .avatar{width:42px;height:42px;border-radius:13px;font-size:16px}
.near .t{flex:1;min-width:0}.near .nm{display:block;font-size:14px;line-height:1.25;overflow-wrap:anywhere}.near .t span{font-size:13.5px;color:var(--mu)}.near .t span a{color:var(--mu);text-decoration:underline}
.km{font-size:12px;padding:6px 10px;border-radius:12px;background:var(--ac-tint);border:1px solid var(--ac-bd);color:var(--ac-tx);white-space:nowrap;text-transform:none}
.faq details{margin-bottom:10px;border-radius:18px}.faq summary{list-style:none;cursor:pointer;padding:15px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.faq summary::-webkit-details-marker{display:none}.faq summary h3{margin:0;font-size:16px;color:var(--tx)}
.faq summary::after{content:"+";color:var(--ac);font-size:22px;line-height:1}.faq details[open] summary::after{content:"\\2013"}
.faq details p{margin:0;padding:0 18px 16px}
ul.cols{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
ul.cols li{margin:0;padding:11px 14px;border-radius:14px;background:var(--s1);border:1px solid var(--ln);font-size:15px}ul.cols li a{color:var(--tx);font-weight:700}ul.cols .mu{font-size:13px}
.chips{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}.chips li{margin:0}
.chip{display:inline-block;font-size:10.5px;padding:10px 14px;border-radius:999px;background:var(--s2);border:1px solid var(--bd);color:var(--tx)}.chip:hover{text-decoration:none;border-color:var(--ac-bd)}.chip em{font-style:normal;color:var(--ac-tx);margin-left:6px}
.box{margin-top:40px;padding:22px}.box h2{margin:6px 0 10px;padding:0;border:0}.box p{margin:8px 0}
code,pre{background:rgba(0,0,0,.35);border:1px solid var(--ln);border-radius:10px;padding:2px 6px;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;color:var(--tx);user-select:all;-webkit-user-select:all;word-break:break-all}
pre{padding:12px;overflow-x:auto;white-space:pre-wrap}pre code{border:0;padding:0;background:none}
footer{margin-top:56px;padding:26px 0 40px;border-top:1px solid var(--ln);color:var(--mu2);font-size:13.5px}
footer nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin-bottom:14px}footer nav a{color:var(--mu);font-weight:600}
@media (min-width:760px){.cards.two,.nears{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
@media (max-width:520px){.callout{flex-direction:column;align-items:stretch}.top .btn{padding:4px 10px;font-size:10px}.brand{font-size:15px}}`;

const NAV = [['/trouver-un-food-truck/', 'Trouver un food truck'], ['/pour-les-food-trucks/', 'Pour les food trucks'], ['/regles-des-avis/', 'Règles des avis'],
  ['/conditions-utilisation/', 'Conditions d’utilisation'], ['/confidentialite/', 'Confidentialité'], ['/mentions-legales/', 'Mentions légales']];
const NAV_VILLES = ['/food-trucks/', 'Food trucks par ville'];
let withVilles = false; // vrai quand les pages villes existent : le lien du pied de page n'est ajouté que dans ce cas

const HEADER = '<header class="top"><div class="wrap"><a class="brand" href="/"><img src="/assets/icon-192.png" alt="" width="34" height="34"><span>Local<span class=\"ac\">Truck</span></span></a><span class="sp"></span><a class="btn primary sm" href="/">Ouvrir la carte</a></div></header>';

function page({ dir, title, desc, h1, h1Html, body, top, ld: more }) {
  const url = SITE + '/' + dir + '/';
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url, inLanguage: 'fr', isPartOf: { '@type': 'WebSite', name: 'LocalTruck', url: SITE + '/' } };
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#0B0B0D">
<meta property="og:type" content="website"><meta property="og:site_name" content="LocalTruck"><meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${OG}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${OG}">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/png" href="/assets/favicon-96.png" sizes="96x96"><link rel="icon" type="image/png" href="/assets/icon-192.png" sizes="192x192"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
${[ld].concat(more || []).map((x) => '<script type="application/ld+json">' + JSON.stringify(x) + '</script>').join('\n')}
<link rel="preload" href="/assets/fonts/archivo-var.woff" as="font" type="font/woff" crossorigin>
<style>${CSS}</style>
</head>
<body>
${HEADER}
<main class="wrap">
${top || ''}<h1>${h1Html || esc(h1)}</h1>
${body}
</main>
<footer><div class="wrap">
<nav aria-label="Pages du site"><a href="/">Application</a>${(withVilles ? [NAV[0], NAV_VILLES].concat(NAV.slice(1)) : NAV).map(([h, t]) => '<a href="' + h + '">' + esc(t) + '</a>').join('')}</nav>
<div>LocalTruck : la carte gratuite des food trucks, partout en France. Contact : <a href="mailto:${L.LEGAL.contact}">${L.LEGAL.contact}</a></div>
</div></footer>
</body>
</html>
`;
}

function notFound() {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Page introuvable – LocalTruck</title><style>${CSS}</style>
<script>/* lien court d'un food truck (https://localtruck.fr/t/nom, …/t/nom/reprendre) : GitHub Pages sert cette page, on renvoie vers l'application */
(function(){var m=/^\\/t\\/([a-z0-9]+(?:-[a-z0-9]+)*)(\\/reprendre)?\\/?$/i.exec(location.pathname);if(m&&m[1].length<=60)location.replace('/#/t/'+m[1].toLowerCase()+(m[2]?'/reprendre':''));})();</script></head>
<body>${HEADER}
<main class="wrap"><h1>Page introuvable</h1><p class="lead">Cette adresse n’existe pas (ou plus).</p><p class="cta-row"><a class="cta" href="/">Ouvrir la carte des food trucks</a></p></main></body></html>
`;
}

/* ------------------------------------------------------------------ écriture */
const xml = (urls) => '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + urls.map((u) => '  <url><loc>' + u.loc + '</loc>' + (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '<priority>' + u.priority + '</priority></url>').join('\n') + '\n</urlset>\n';

/** opts.places : liste des fiches visibles (seo-places.js) ; absente → on garde les pages villes déjà présentes dans `out`, s'il y en a.
 *  opts.villesOnly : ne réécrit que les pages villes et les plans du site. */
function build(out, opts) {
  opts = opts || {};
  const write = (rel, txt) => { const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };
  const home = '2026-10-26';
  let villes = [];

  if (opts.places) {
    // liste fournie : elle remplace les pages villes existantes ; liste vide (plus aucune fiche visible) : on les retire, rien ne reste en ligne
    for (const d of ['food-trucks', 'food-truck', 'sitemap-villes.xml']) fs.rmSync(path.join(out, d), { recursive: true, force: true });
  }
  if (opts.places && opts.places.length) {
    withVilles = opts.places.length > 0; // avant la génération : le pied de page des pages villes porte aussi le lien
    const r = buildVilles(opts.places, { page, esc, SITE }, null, { communes: opts.communes });
    for (const [rel, html] of Object.entries(r.files)) write(rel, html);
    write('sitemap-villes.xml', xml(r.urls));
    villes = r.urls.map((u) => u.loc);
  } else if (fs.existsSync(path.join(out, 'sitemap-villes.xml'))) {
    villes = [...fs.readFileSync(path.join(out, 'sitemap-villes.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  }
  withVilles = villes.length > 0;

  const urls = [{ loc: SITE + '/', lastmod: home, priority: '1.0' }].concat(PAGES.map((p) => ({ loc: SITE + '/' + p.dir + '/', lastmod: p.updated, priority: p.priority })));
  if (!opts.villesOnly) {
    for (const p of PAGES) write(p.dir + '/index.html', page(p));
    write('404.html', notFound());
    write('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE + '/sitemap.xml\n');
    write('sitemap-pages.xml', xml(urls));
  }
  // sitemap.xml = index : les pages du site + (s'il y en a) les pages départements, villes et food trucks
  write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + '  <sitemap><loc>' + SITE + '/sitemap-pages.xml</loc><lastmod>' + PAGES.map((p) => p.updated).concat(home).sort().pop() + '</lastmod></sitemap>\n'
    + (withVilles ? '  <sitemap><loc>' + SITE + '/sitemap-villes.xml</loc></sitemap>\n' : '') + '</sitemapindex>\n');
  return { pages: PAGES.map((p) => p.dir), urls: urls.map((u) => u.loc), villes };
}

/** Communes (nom|département|latitude|longitude, une par ligne) qui ont leur page « à proximité » même sans food truck chez elles. Fichier absent ou illisible : liste vide. */
function loadCommunes(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => { const [n, d, la, lo] = l.split('|'); return [n, d, Number(la), Number(lo)]; });
  } catch (e) { return []; }
}

module.exports = { build, loadCommunes, PAGES, SITE };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2); const out = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--file');
    if (!out) { console.error('usage : node scripts/build-seo.js <dossier de sortie> [--villes-only] [--live] [--file liste.json]'); process.exit(2); }
    const dest = path.resolve(out); const fi = args.indexOf('--file');
    const live = args.includes('--live'); const villesOnly = args.includes('--villes-only');
    const places = await loadPlaces(path.join(__dirname, '..'), { live, file: fi >= 0 ? args[fi + 1] : undefined });
    if (villesOnly && !places) { console.error('SEO : liste des food trucks indisponible, rien n\'a été modifié'); process.exit(1); }
    if (places) {
      // garde-fou : une lecture presque vide (panne, mauvaise réponse) ne doit pas effacer des pages qui existent
      const before = (() => { try { return fs.readdirSync(path.join(dest, 'food-truck')).length; } catch (e) { return 0; } })();
      if (before >= 10 && places.length < before / 2) { console.error('SEO : ' + places.length + ' fiches lues pour ' + before + ' pages existantes : arrêt par précaution'); process.exit(1); }
    }
    const r = build(dest, { places, villesOnly, communes: loadCommunes(path.join(__dirname, 'communes-bretagne.txt')) });
    console.log('SEO : ' + r.pages.length + ' pages' + (r.villes.length ? ', ' + r.villes.length + ' pages villes' + (places ? ' (' + places.length + ' food trucks)' : ' (reprises telles quelles)') : ', pas de pages villes')
      + ', sitemap de ' + (r.urls.length + r.villes.length) + ' adresses');
  })().catch((e) => { console.error('SEO : ' + (e && e.message || e)); process.exit(1); });
}
