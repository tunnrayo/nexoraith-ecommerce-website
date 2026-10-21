// Small progressive enhancements. The site works fully without JavaScript; the server always recalculates totals.
(function () {
  // Image fallback: if a product image fails to load (e.g. an external demo image host is down), show a neutral placeholder.
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && !img.dataset.fallback) { img.dataset.fallback = '1'; img.src = '/img/placeholder.svg'; img.classList.add('img-fallback'); }
  }, true);
  var btn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
  if (btn && nav) btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Product gallery thumbnails
  var main = document.getElementById('main-img');
  document.querySelectorAll('.thumb').forEach(function (t) {
    t.addEventListener('click', function () { if (main) { main.src = t.dataset.src; main.alt = t.dataset.alt || ''; } });
  });
  // Quantity stepper
  document.querySelectorAll('.step').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = b.parentNode.querySelector('input'); var v = (parseInt(input.value, 10) || 1) + Number(b.dataset.step);
      input.value = Math.max(Number(input.min) || 1, Math.min(Number(input.max) || 20, v));
    });
  });
  // Product page: show the price of the chosen option
  var pp = document.getElementById('pdp-price');
  document.querySelectorAll('input[name="variant_id"]').forEach(function (r) {
    r.addEventListener('change', function () { if (pp && r.dataset.price) pp.textContent = r.dataset.price; });
  });
  // Checkout: preview delivery fee and total for the chosen destination (display only)
  var total = document.getElementById('sum-total'), del = document.getElementById('sum-del');
  if (total && del && window.Intl) {
    var fmt = new Intl.NumberFormat(total.dataset.locale || 'en-NG', { style: 'currency', currency: total.dataset.currency || 'NGN' });
    document.querySelectorAll('input[name="zone_id"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var fee = Number(r.dataset.fee) || 0, sub = Number(total.dataset.sub) || 0;
        del.textContent = fmt.format(fee / 100); total.textContent = fmt.format((sub + fee) / 100);
      });
    });
  }
})();
