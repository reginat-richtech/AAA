// Match a proposal's AI-extracted package list (ops.project_proposal.package_list,
// shape [{item, quantity, notes}]) to current inventory SKUs (inventory.cn_sku), so
// the inventory team gets a recommended pick-list: what's needed vs what's in stock.
//
// Heuristic and best-effort — the package text comes from AI extraction, so a match
// is a suggestion the team confirms, not a guarantee. Pure (no I/O).
import { SKU_RE } from './inventory';

// Words that add noise to a product name without identifying it.
const STOP = new Set(['robot', 'robots', 'unit', 'units', 'the', 'a', 'an', 'of', 'for',
  'and', 'with', 'system', 'set', 'pcs', 'pc', 'pack', 'finished', 'goods', 'raw', 'materials', 'parts']);

function toks(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// First SKU-shaped token in a string (e.g. a model code the AI kept in `notes`).
function skuIn(text) {
  for (const w of String(text || '').toUpperCase().split(/[^A-Z0-9.&-]+/)) if (SKU_RE.test(w)) return w;
  return null;
}

// Fraction of the item's tokens that appear in a stock row (name+line+sku).
function score(itemToks, row) {
  if (!itemToks.length) return 0;
  const hay = toks(`${row.product_name} ${row.product_line} ${row.sku}`);
  let hit = 0;
  for (const t of itemToks) if (hay.some((h) => h === t || h.includes(t) || t.includes(h))) hit++;
  return hit / itemToks.length;
}

const MIN_SCORE = 0.5;

// → [{ item, notes, needed, match: {id, sku, product_name, product_line}|null,
//      onHand, shortfall, status, confidence }]
// status: in_stock | short | out | no_match
export function matchPackageList(packageList, stockRows) {
  const stock = Array.isArray(stockRows) ? stockRows : [];
  const bySku = new Map();
  for (const r of stock) if (r.sku) bySku.set(String(r.sku).toUpperCase(), r);

  return (Array.isArray(packageList) ? packageList : []).map((pkg) => {
    const item = String(pkg?.item || '').trim();
    const notes = String(pkg?.notes || '').trim();
    const needed = Number(pkg?.quantity) > 0 ? Number(pkg.quantity) : 1;

    let match = null;
    let confidence = 0;

    // 1) An explicit SKU code in the item/notes wins outright.
    const coded = skuIn(`${item} ${notes}`);
    if (coded && bySku.has(coded)) { match = bySku.get(coded); confidence = 1; }

    // 2) Otherwise the best name match (prefer finished goods, then more in stock).
    if (!match) {
      const itemToks = toks(item);
      const scored = stock
        .map((r) => ({ r, s: score(itemToks, r) }))
        .filter((x) => x.s >= MIN_SCORE)
        .sort((a, b) =>
          b.s - a.s
          || ((b.r.item_class === 'finished_goods') - (a.r.item_class === 'finished_goods'))
          || ((Number(b.r.quantity) || 0) - (Number(a.r.quantity) || 0)));
      if (scored.length) { match = scored[0].r; confidence = scored[0].s; }
    }

    const onHand = match ? (Number(match.quantity) || 0) : 0;
    const shortfall = Math.max(0, needed - onHand);
    const status = !match ? 'no_match' : onHand === 0 ? 'out' : shortfall > 0 ? 'short' : 'in_stock';

    return {
      item, notes, needed,
      match: match ? { id: match.id, sku: match.sku, product_name: match.product_name, product_line: match.product_line } : null,
      onHand, shortfall, status,
      confidence: Math.round(confidence * 100) / 100,
    };
  });
}
