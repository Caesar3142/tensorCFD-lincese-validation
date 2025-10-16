import 'dotenv/config';

const PAGE_URL = process.env.LICENSE_LIST_URL;

export function isExpired(endDateStr) {
  // License is considered expired if end_date < today (inclusive end date)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [y, m, d] = String(endDateStr || '').split('-').map(Number);
  if (!y || !m || !d) return true;

  const end = new Date(y, m - 1, d);
  end.setHours(0, 0, 0, 0);

  return end < today;
}

function extractJsonFromHtml(html) {
  // Looks for: <script type="application/json" id="licenses"> ... </script>
  const re = /<script\s+type=["']application\/json["']\s+id=["']licenses["']\s*>([\s\S]*?)<\/script>/i;
  const m = html.match(re);
  if (!m || !m[1]) throw new Error('Licenses JSON not found on page.');
  try {
    return JSON.parse(m[1]);
  } catch {
    throw new Error('Invalid licenses JSON on page.');
  }
}

async function loadLicenses() {
  if (!PAGE_URL) throw new Error('LICENSE_LIST_URL not set in .env');

  // Node 18+ has global fetch. If older, add node-fetch or undici.
  const res = await fetch(PAGE_URL, { method: 'GET' });
  if (!res.ok) throw new Error(`Failed fetching license page: ${res.status}`);

  const html = await res.text();
  const licenses = extractJsonFromHtml(html);

  if (!Array.isArray(licenses)) throw new Error('Licenses JSON must be an array.');
  return licenses;
}

export async function validateLicense(email, productKey) {
  try {
    const licenses = await loadLicenses();
    const normEmail = String(email).trim().toLowerCase();
    const normKey = String(productKey).trim();

    const row = licenses.find(item =>
      String(item.email).trim().toLowerCase() === normEmail &&
      String(item.product_key).trim() === normKey
    );

    if (!row) {
      return { ok: false, message: 'Email or product key is incorrect.' };
    }

    const end = String(row.end_date || '').trim();
    if (!end) return { ok: false, message: 'License end date missing.' };

    if (isExpired(end)) {
      return { ok: false, message: `License expired on ${end}.`, end_date: end };
    }

    return { ok: true, message: 'License valid.', end_date: end };
  } catch (err) {
    const msg = err?.message || String(err);
    return { ok: false, message: `Validation error: ${msg}` };
  }
}
