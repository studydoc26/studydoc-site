const PYT_SUBJECT_DATA = Object.freeze({
  'anaesthesiology': '/assets/neetpg_advanced_2026/data/anaesthesiology.json',
  'anatomy': '/assets/neetpg_advanced_2026/data/anatomy.json',
  'biochemistry': '/assets/neetpg_advanced_2026/data/biochemistry.json',
  'community-medicine-psm': '/assets/neetpg_advanced_2026/data/community-medicine-psm.json',
  'dermatology': '/assets/neetpg_advanced_2026/data/dermatology.json',
  'ent': '/assets/neetpg_advanced_2026/data/ent.json',
  'forensic-medicine': '/assets/neetpg_advanced_2026/data/forensic-medicine.json',
  'microbiology': '/assets/neetpg_advanced_2026/data/microbiology.json',
  'ophthalmology': '/assets/neetpg_advanced_2026/data/ophthalmology.json',
  'orthopedics': '/assets/neetpg_advanced_2026/data/orthopedics.json',
  'pathology': '/assets/neetpg_advanced_2026/data/pathology.json',
  'pharmacology': '/assets/neetpg_advanced_2026/data/pharmacology.json',
  'psychiatry': '/assets/neetpg_advanced_2026/data/psychiatry.json',
  'radiodiagnosis': '/assets/neetpg_advanced_2026/data/radiodiagnosis.json',
});

const REPORT_SOURCES = Object.freeze({
  '/fmge_quiz': {
    data: '/fmge_quiz_data.json',
    exam: 'FMGE',
    matchYear: true,
    matchSession: true,
  },
  '/neet_pg_recall_quiz': {
    data: '/neet_pg_recall_quiz_data.json',
    exam: 'NEET-PG',
    matchYear: true,
  },
  '/neet_pg_medicine_pyt_bank': {
    data: '/neet_pg_medicine_pyt_bank_data.json',
    exam: 'NEET-PG Medicine PYT Bank',
    subject: 'Medicine',
  },
  '/neet_pg_surgery_pyt_bank': {
    data: '/neet_pg_surgery_pyt_bank_data.json',
    exam: 'NEET-PG Surgery PYT Bank',
    subject: 'Surgery',
  },
  '/neet_pg_obgyn_pyt_bank': {
    data: '/neet_pg_obgyn_pyt_bank_data.json',
    exam: 'NEET-PG ObGyn PYT Bank',
    subject: 'ObGyn',
  },
  '/neet_pg_pediatrics_practice_bank': {
    data: '/neet_pg_pediatrics_practice_bank_data.json',
    exam: 'NEET-PG Pediatrics PYT Bank',
    subject: 'Pediatrics',
  },
  '/neet_pg_physiology_practice_bank': {
    data: '/neet_pg_physiology_practice_bank_data.json',
    exam: 'NEET-PG Physiology PYT Bank',
    subject: 'Physiology',
  },
  '/neet_pg_pyt_subject_bank': {
    exam: 'NEET-PG PYT Subject Bank',
    subjectData: PYT_SUBJECT_DATA,
  },
});

const ISSUE_TYPES = new Set([
  'Wrong answer',
  'Wrong image',
  'Missing image',
  'Wrong subject tag',
  'Question or options need correction',
]);

const REPORT_FIELDS = new Set([
  '_gotcha',
  'details',
  'email',
  'issue_type',
  'page_path',
  'practice_number',
  'practice_total',
  'question_number',
  'question_id',
  'session',
  'subject_slug',
  'year',
]);

const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: RESPONSE_HEADERS });
}

function getText(form, name, maximum, required = false) {
  const entry = form.get(name);
  if (entry !== null && typeof entry !== 'string') return null;
  const value = (entry || '').trim();
  if ((required && !value) || value.length > maximum) return null;
  return value;
}

function hasValidFormShape(form) {
  const seen = new Set();
  for (const [name, value] of form.entries()) {
    if (!REPORT_FIELDS.has(name) || seen.has(name) || typeof value !== 'string') return false;
    seen.add(name);
  }
  return true;
}

function jsonFormData(rawBody) {
  const payload = JSON.parse(new TextDecoder().decode(rawBody));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid JSON report');
  const form = new FormData();
  for (const [name, value] of Object.entries(payload)) {
    if (typeof value !== 'string') throw new Error('JSON report values must be strings');
    form.append(name, value);
  }
  return form;
}

function formspreeEndpoint(env) {
  if (typeof env.FORMSPREE_ENDPOINT !== 'string') return null;
  try {
    const endpoint = new URL(env.FORMSPREE_ENDPOINT.trim());
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.hostname !== 'formspree.io' ||
      endpoint.port ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !/^\/f\/[A-Za-z0-9]+$/.test(endpoint.pathname)
    ) return null;
    return endpoint.href;
  } catch {
    return null;
  }
}

function normalizeReportPath(value) {
  if (!value || value.length > 120 || !value.startsWith('/') || value.includes('..')) return null;
  const normalized = value.replace(/\/+$/, '').replace(/\.html$/i, '') || '/';
  return Object.hasOwn(REPORT_SOURCES, normalized) ? normalized : null;
}

function answerText(item) {
  if (!Number.isSafeInteger(item.answerIndex) || !Array.isArray(item.options) || typeof item.options[item.answerIndex] !== 'string') return '';
  return `${String.fromCharCode(65 + item.answerIndex)}. ${item.options[item.answerIndex]}`;
}

function optionLines(item) {
  if (!Array.isArray(item.options)) return [];
  return item.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${String(option)}`);
}

function subjectText(item, fallback) {
  if (Array.isArray(item.subjectTags) && item.subjectTags.length) {
    return item.subjectTags.filter(tag => typeof tag === 'string').slice(0, 6).join(', ').slice(0, 180);
  }
  return String(item.subject || fallback || '').slice(0, 180);
}

async function loadQuestion(requestUrl, env, config, form) {
  const number = getText(form, 'question_number', 12, true);
  const year = getText(form, 'year', 8, Boolean(config.matchYear));
  const session = getText(form, 'session', 80, Boolean(config.matchSession));
  const subjectScoped = Boolean(config.subjectData);
  const subjectSlug = getText(form, 'subject_slug', 40, subjectScoped);
  const questionId = getText(form, 'question_id', 32, subjectScoped);
  if (!number || !/^\d+$/.test(number) || year === null || session === null || subjectSlug === null || questionId === null) return null;

  let dataPath = config.data;
  if (subjectScoped) {
    if (
      !subjectSlug ||
      !questionId ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subjectSlug) ||
      !/^[A-Z][A-Z0-9]{1,11}-\d{3}$/.test(questionId) ||
      !Object.hasOwn(config.subjectData, subjectSlug)
    ) return null;
    dataPath = config.subjectData[subjectSlug];
  }
  if (typeof dataPath !== 'string') throw new Error('Question data path unavailable');

  const dataUrl = new URL(dataPath, requestUrl);
  if (dataUrl.origin !== requestUrl.origin) throw new Error('Question data must be same-origin');
  const response = await env.ASSETS.fetch(new Request(dataUrl, { method: 'GET' }));
  if (!response.ok) throw new Error(`Question data unavailable: ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Question data must be an array');

  const matches = data.filter(item => {
    if (!item || !Number.isSafeInteger(item.number) || String(item.number) !== number) return false;
    if (subjectScoped && (item.subjectSlug !== subjectSlug || item.id !== questionId)) return false;
    if (config.matchYear && String(item.year || '') !== year) return false;
    if (config.matchSession && String(item.session || '') !== session) return false;
    return typeof item.question === 'string' && Array.isArray(item.options) && item.options.every(option => typeof option === 'string');
  });
  return matches.length === 1 ? matches[0] : null;
}

async function handleReport(request, env) {
  const requestUrl = new URL(request.url);
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST', ...RESPONSE_HEADERS } });
  }
  if (request.headers.get('Origin') !== requestUrl.origin) return jsonResponse(403, { error: 'Invalid origin' });

  const upstreamEndpoint = formspreeEndpoint(env);
  if (!upstreamEndpoint) return jsonResponse(503, { error: 'Report delivery is temporarily unavailable' });

  const contentType = request.headers.get('Content-Type') || '';
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'multipart/form-data' && mediaType !== 'application/x-www-form-urlencoded' && mediaType !== 'application/json') {
    return jsonResponse(415, { error: 'Unsupported form encoding' });
  }
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 32768)) {
    return jsonResponse(413, { error: 'Report is too large' });
  }

  if (!env.REPORT_RATE_LIMITER || typeof env.REPORT_RATE_LIMITER.limit !== 'function') {
    return jsonResponse(503, { error: 'Report protection is temporarily unavailable' });
  }
  try {
    const actor = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.REPORT_RATE_LIMITER.limit({ key: `report:${actor}` });
    if (!success) return jsonResponse(429, { error: 'Too many reports. Please try again later.' });
  } catch {
    return jsonResponse(503, { error: 'Report protection is temporarily unavailable' });
  }

  let rawBody;
  try {
    rawBody = await request.arrayBuffer();
  } catch {
    return jsonResponse(400, { error: 'Malformed report form' });
  }
  if (rawBody.byteLength > 32768) return jsonResponse(413, { error: 'Report is too large' });

  let form;
  try {
    form = mediaType === 'application/json'
      ? jsonFormData(rawBody)
      : await new Request(request.url, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: rawBody,
        }).formData();
  } catch {
    return jsonResponse(400, { error: 'Malformed report form' });
  }
  if (getText(form, '_gotcha', 200)) return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  if (!hasValidFormShape(form)) return jsonResponse(400, { error: 'Invalid report fields' });

  const pagePath = normalizeReportPath(getText(form, 'page_path', 120, true));
  const issueType = getText(form, 'issue_type', 80, true);
  const details = getText(form, 'details', 2000, true);
  const email = getText(form, 'email', 254, true);
  if (!pagePath || !issueType || !ISSUE_TYPES.has(issueType) || !details || details.length < 3 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { error: 'Invalid report fields' });
  }

  const config = REPORT_SOURCES[pagePath];
  let item;
  try {
    item = await loadQuestion(requestUrl, env, config, form);
  } catch {
    return jsonResponse(503, { error: 'Question data is temporarily unavailable' });
  }
  if (!item) return jsonResponse(400, { error: 'Unknown question' });

  const year = String(item.year || getText(form, 'year', 8) || '2026').slice(0, 8);
  const session = String(item.session || '').slice(0, 80);
  const options = optionLines(item);
  const contextLabel = config.subjectData ? item.id : `Q${item.number}`;
  const subjectSlug = typeof item.subjectSlug === 'string' ? item.subjectSlug : '';
  const pageUrl = config.subjectData && subjectSlug
    ? `${requestUrl.origin}${pagePath}?subject=${encodeURIComponent(subjectSlug)}`
    : `${requestUrl.origin}${pagePath}`;
  const upstream = new FormData();
  upstream.set('exam', config.exam);
  upstream.set('year', year);
  upstream.set('session', session);
  upstream.set('question_number', String(item.number));
  if (config.subjectData) {
    upstream.set('question_id', contextLabel);
    upstream.set('subject_slug', subjectSlug);
  }
  upstream.set('subject', subjectText(item, config.subject));
  upstream.set('page_url', pageUrl);
  upstream.set('answer', answerText(item));
  upstream.set('question', item.question);
  upstream.set('options', options.join('\n'));
  upstream.set('question_with_options', `Question:\n${item.question}\n\nOptions:\n${options.join('\n')}`);
  upstream.set('issue_type', issueType);
  upstream.set('details', details);
  upstream.set('email', email);
  upstream.set('_subject', `[StudyDoc report] ${config.exam} ${year} ${contextLabel}`);

  let response;
  try {
    response = await fetch(upstreamEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: upstream,
    });
  } catch {
    return jsonResponse(502, { error: 'Report delivery failed' });
  }
  if (!response.ok) return jsonResponse(502, { error: 'Report delivery failed' });
  return jsonResponse(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/report') return handleReport(request, env);
    return env.ASSETS.fetch(request);
  },
};
