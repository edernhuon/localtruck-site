/* LocalTruck – anti-cadre : le site refuse de s'afficher à l'intérieur de la page d'un autre site (technique du « clickjacking » :
 * une page piégée affiche LocalTruck en transparence sous un faux bouton pour pousser à cliquer sur quelque chose qu'on ne voit pas).
 * Dans un cadre étranger : on cache tout, et on essaie d'ouvrir le site en pleine page. Chargé en tout premier (avant tout affichage).
 * (GitHub Pages ne permet pas d'envoyer l'en-tête « frame-ancestors » : cette protection par script est ce qui est possible ici.) */
(function () {
  'use strict';
  try {
    if (window.top === window.self) return;
    document.documentElement.style.display = 'none';
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* cadre d'un autre site : on reste caché */ }
  } catch (e) {
    // accès au cadre parent refusé : on est forcément dans un cadre d'un autre site
    try { document.documentElement.style.display = 'none'; } catch (e2) { /* ignore */ }
  }
})();
