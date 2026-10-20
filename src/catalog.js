'use strict';
const { q } = require('./db');
const cfg = require('./config');
// Sample (development) products are hidden from the public site when they are not allowed to be sold.
const devOk = () => (cfg.allowDevProducts ? '1=1' : 'p.is_development=0');
const PAGE_SIZE = 12;
const SORTS = {
  newest: 'p.id DESC', price_asc: 'min_price ASC, p.name', price_desc: 'min_price DESC, p.name', name: 'p.name COLLATE NOCASE ASC',
};
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// PUBLIC listing: selects only customer-facing fields (never supplier tables).
function listProducts({ search = '', category = '', sort = 'newest', page = 1 } = {}) {
  const where = ["p.status='published'", devOk()]; const args = [];
  if (search) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')"); const s = `%${likeEscape(search.slice(0, 80))}%`; args.push(s, s); }
  if (category) { where.push('c.slug=?'); args.push(category); }
  const order = SORTS[sort] || SORTS.newest;
  const base = `FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')}`;
  const total = q.get(`SELECT COUNT(*) n ${base}`, ...args).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);
  const items = q.all(`SELECT p.id, p.slug, p.name, p.currency, p.is_development, c.name category_name, c.slug category_slug,
      (SELECT MIN(price_minor) FROM variants v WHERE v.product_id=p.id) min_price,
      (SELECT MAX(price_minor) FROM variants v WHERE v.product_id=p.id) max_price,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id=p.id AND v.availability='available') n_available,
      (SELECT url FROM product_images i WHERE i.product_id=p.id ORDER BY sort_order,id LIMIT 1) image,
      (SELECT alt FROM product_images i WHERE i.product_id=p.id ORDER BY sort_order,id LIMIT 1) image_alt
    ${base} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${(pg - 1) * PAGE_SIZE}`, ...args);
  return { items, total, page: pg, pages };
}
function categories() {
  return q.all(`SELECT c.slug, c.name, COUNT(p.id) n FROM categories c JOIN products p ON p.category_id=c.id AND p.status='published' AND ${devOk()} GROUP BY c.id ORDER BY c.sort_order, c.name`);
}
function getProduct(slug) {
  const p = q.get(`SELECT p.id, p.slug, p.name, p.description, p.currency, p.is_development, c.name category_name, c.slug category_slug
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=? AND p.status='published' AND ${devOk()}`, slug);
  if (!p) return null;
  p.images = q.all('SELECT url, alt FROM product_images WHERE product_id=? ORDER BY sort_order,id', p.id);
  p.variants = q.all('SELECT id, sku, label, options_json, price_minor, availability, stock_qty FROM variants WHERE product_id=? ORDER BY sort_order,id', p.id)
    .map((v) => ({ ...v, options: JSON.parse(v.options_json || '{}') }));
  return p;
}
function related(product, n = 4) {
  return q.all(`SELECT p.slug, p.name, p.currency, p.is_development, (SELECT MIN(price_minor) FROM variants v WHERE v.product_id=p.id) min_price,
    (SELECT url FROM product_images i WHERE i.product_id=p.id ORDER BY sort_order,id LIMIT 1) image, (SELECT alt FROM product_images i WHERE i.product_id=p.id ORDER BY sort_order,id LIMIT 1) image_alt
    FROM products p WHERE p.status='published' AND ${devOk()} AND p.id<>? AND p.category_id=(SELECT category_id FROM products WHERE id=?) LIMIT ?`, product.id, product.id, n);
}
const featured = (n = 4) => listProducts({ sort: 'newest' }).items.slice(0, n);
module.exports = { listProducts, categories, getProduct, related, featured, PAGE_SIZE, SORTS };
