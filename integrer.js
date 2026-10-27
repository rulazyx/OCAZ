// Ancienne adresse du code d'intégration (ocaz.re/integrer.js, avant le 27/10/2026), déjà collée sur des sites de garages.
// Le site public est maintenant sur reseau.ocaz.re : même code que reseau.ocaz.re/integrer.js, avec l'adresse écrite en dur.
(function () {
  var s = document.currentScript;
  if (!s) return;
  var slug = s.getAttribute('data-garage') || '';
  var base = 'https://reseau.ocaz.re/';
  var f = document.createElement('iframe');
  f.src = base + 'vitrine?g=' + encodeURIComponent(slug) + '&integre=1';
  f.title = 'Nos véhicules d\'occasion';
  f.loading = 'lazy';
  f.setAttribute('allow', 'clipboard-write; web-share');
  f.style.cssText = 'display:block;width:100%;height:700px;border:0;background:transparent;color-scheme:normal';
  var cible = document.getElementById(s.getAttribute('data-cible') || 'zx-vitrine');
  if (cible) cible.appendChild(f); else s.parentNode.insertBefore(f, s);

  var ecran = function () { f.contentWindow && f.contentWindow.postMessage({ zx: 'ecran', h: window.innerHeight }, '*'); };
  f.addEventListener('load', ecran);
  window.addEventListener('resize', ecran);
  window.addEventListener('message', function (e) {
    if (e.source !== f.contentWindow || !e.data || typeof e.data !== 'object') return;
    if (e.data.zx === 'hauteur') f.style.height = Math.max(300, Math.ceil(e.data.h)) + 'px';
    if (e.data.zx === 'fiche') {
      var haut = f.getBoundingClientRect().top + window.pageYOffset + (e.data.y || 0) - 12;
      window.scrollTo({ top: haut, behavior: 'smooth' });
    }
  });
})();
