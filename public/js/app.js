// Small progressive enhancements. The site works without JavaScript.
(function () {
  var btn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
  if (btn && nav) btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  var main = document.getElementById('main-img');
  document.querySelectorAll('.thumb').forEach(function (t) {
    t.addEventListener('click', function () { if (main) { main.src = t.dataset.src; main.alt = t.dataset.alt || ''; } });
  });
})();
