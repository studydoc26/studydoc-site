#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPayload = JSON.parse(fs.readFileSync(path.join(root, 'assets/neetpg_advanced_2026/catalog.json'), 'utf8'));
const dataBySlug = Object.fromEntries(catalogPayload.subjects.map(subject => [
  subject.slug,
  JSON.parse(fs.readFileSync(path.join(root, subject.dataPath), 'utf8'))
]));

const controls = {
  '#search': { value: '' },
  '#topic-filter': { value: 'all' },
  '#difficulty-filter': { value: 'all' },
  '#status-filter': { value: 'all' }
};
const storage = new Map();
const documentMock = {
  baseURI: 'https://studydoc.test/neet_pg_pyt_subject_bank.html?subject=anatomy',
  querySelector(selector) { return controls[selector] || null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};
const context = vm.createContext({
  console,
  URL,
  URLSearchParams,
  TextDecoder,
  document: documentMock,
  history: { replaceState() {} },
  window: {
    location: { origin: 'https://studydoc.test' },
    confirm() { return true; }
  },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  requestAnimationFrame(callback) { callback(); },
  setTimeout,
  clearTimeout,
  CSS: { escape(value) { return String(value); } },
  fetch: async () => { throw new Error('Unexpected network request in verifier'); }
});

let runtimeSource = fs.readFileSync(path.join(root, 'neet_pg_pyt_subject_bank.js'), 'utf8');
runtimeSource = runtimeSource.replace(/\ninitialize\(\);\s*$/, '\n');
runtimeSource += `
globalThis.__verifyBank = {
  validate(catalogPayload, dataBySlug) {
    const normalizedCatalog = normalizeCatalog(catalogPayload);
    let questionCount = 0;
    let imageCount = 0;
    let referenceCount = 0;
    const ids = new Set();
    for (const meta of normalizedCatalog.subjects) {
      const raw = dataBySlug[meta.slug];
      if (!Array.isArray(raw) || raw.length !== meta.questionCount) throw new Error(meta.slug + ': data count');
      const normalized = raw.map((question, index) => normalizeQuestion(question, index, meta));
      if (normalized.filter(question => question.imageBased).length !== meta.imageQuestionCount) throw new Error(meta.slug + ': image count');
      for (const question of normalized) {
        if (ids.has(question.id)) throw new Error('duplicate ' + question.id);
        ids.add(question.id);
        questionCount += 1;
        imageCount += Number(question.imageBased);
        referenceCount += question.references.length;
      }
    }
    return { subjects: normalizedCatalog.subjects.length, questionCount, imageCount, referenceCount, uniqueIds: ids.size };
  },
  testUnansweredFeedback(catalogPayload, dataBySlug) {
    catalog = normalizeCatalog(catalogPayload);
    subjectMeta = catalog.subjects[0];
    data = Object.freeze(dataBySlug[subjectMeta.slug].map((question, index) => normalizeQuestion(question, index, subjectMeta)));
    visibleItems = data.slice(0, 2);
    currentId = visibleItems[0].id;
    imageReady = true;
    attempts.clear();
    document.querySelector('#status-filter').value = 'unanswered';
    const calls = { stats: 0, list: 0, question: 0, apply: 0 };
    const originalSave = saveProgress;
    const originalStats = renderStats;
    const originalList = renderQuestionList;
    const originalQuestion = renderQuestion;
    const originalApply = applyFilters;
    saveProgress = () => {};
    renderStats = () => { calls.stats += 1; };
    renderQuestionList = () => { calls.list += 1; };
    renderQuestion = () => { calls.question += 1; };
    applyFilters = () => { calls.apply += 1; };
    answerQuestion(visibleItems[0], visibleItems[0].answerIndex);
    const attempted = attempts.has(visibleItems[0].id);
    selectVisibleIndex(1, true);
    saveProgress = originalSave;
    renderStats = originalStats;
    renderQuestionList = originalList;
    renderQuestion = originalQuestion;
    applyFilters = originalApply;
    document.querySelector('#status-filter').value = 'all';
    return { attempted, calls };
  },
  testFiltersAndPersistence(catalogPayload, dataBySlug) {
    catalog = normalizeCatalog(catalogPayload);
    subjectMeta = catalog.subjects.find(subject => subject.slug === 'pediatrics');
    data = Object.freeze(dataBySlug[subjectMeta.slug].map((question, index) => normalizeQuestion(question, index, subjectMeta)));
    attempts.clear(); bookmarks.clear(); lastBySubject.clear(); localStorage.removeItem(STORAGE_KEY);
    document.querySelector('#search').value = '';
    document.querySelector('#topic-filter').value = 'all';
    document.querySelector('#difficulty-filter').value = 'all';
    document.querySelector('#status-filter').value = 'all';
    imageOnly = false;
    const baseline = filteredQuestions().length;
    imageOnly = true;
    const images = filteredQuestions().length;
    imageOnly = false;
    const first = data[0];
    const second = data[1];
    const third = data[2];
    attempts.set(first.id, first.answerIndex);
    attempts.set(second.id, (second.answerIndex + 1) % 4);
    bookmarks.add(third.id);
    lastBySubject.set(subjectMeta.slug, third.id);
    document.querySelector('#status-filter').value = 'correct';
    const correct = filteredQuestions().map(question => question.id);
    document.querySelector('#status-filter').value = 'wrong';
    const wrong = filteredQuestions().map(question => question.id);
    document.querySelector('#status-filter').value = 'bookmarked';
    const bookmarked = filteredQuestions().map(question => question.id);
    document.querySelector('#status-filter').value = 'all';
    document.querySelector('#topic-filter').value = first.topicId;
    const topic = filteredQuestions();
    document.querySelector('#topic-filter').value = 'all';
    document.querySelector('#difficulty-filter').value = 'moderate';
    const moderate = filteredQuestions();
    document.querySelector('#difficulty-filter').value = 'all';
    document.querySelector('#search').value = first.topic;
    const searched = filteredQuestions();
    document.querySelector('#search').value = '';
    saveProgress();
    attempts.clear(); bookmarks.clear(); lastBySubject.clear();
    loadProgress();
    const persisted = attempts.get(first.id) === first.answerIndex && attempts.has(second.id) && bookmarks.has(third.id) && lastBySubject.get(subjectMeta.slug) === third.id;
    localStorage.removeItem(STORAGE_KEY);
    attempts.clear(); bookmarks.clear(); lastBySubject.clear();
    return {
      baseline,
      images,
      correct,
      wrong,
      bookmarked,
      topicCount: topic.length,
      topicValid: topic.every(question => question.topicId === first.topicId),
      moderateCount: moderate.length,
      moderateValid: moderate.every(question => question.difficulty === 'moderate'),
      searchCount: searched.length,
      persisted
    };
  }
};
`;
vm.runInContext(runtimeSource, context, { filename: 'neet_pg_pyt_subject_bank.js' });

const validated = context.__verifyBank.validate(catalogPayload, dataBySlug);
assert.equal(validated.subjects, 19);
assert.equal(validated.questionCount, 3800);
assert.equal(validated.imageCount, 1520);
assert.equal(validated.referenceCount, 3728);
assert.equal(validated.uniqueIds, 3800);

const unanswered = context.__verifyBank.testUnansweredFeedback(catalogPayload, dataBySlug);
assert.equal(unanswered.attempted, true);
assert.equal(unanswered.calls.stats, 1);
assert.equal(unanswered.calls.list, 1);
assert.equal(unanswered.calls.question, 1);
assert.equal(unanswered.calls.apply, 1, 'The unanswered filter should reapply only after navigation.');

const filters = context.__verifyBank.testFiltersAndPersistence(catalogPayload, dataBySlug);
assert.equal(filters.baseline, 200);
assert.equal(filters.images, 80);
assert.equal(filters.correct.length, 1);
assert.equal(filters.wrong.length, 1);
assert.equal(filters.bookmarked.length, 1);
assert.ok(filters.topicCount > 0 && filters.topicValid);
assert.ok(filters.moderateCount > 0 && filters.moderateValid);
assert.ok(filters.searchCount > 0);
assert.equal(filters.persisted, true);

const verifyWorkerReports = async () => {
  const source = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
  const workerModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const delivered = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    delivered.push({ url: String(url), form: init.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const env = {
    FORMSPREE_ENDPOINT: 'https://formspree.io/f/Verifier123',
    REPORT_RATE_LIMITER: { async limit() { return { success: true }; } },
    ASSETS: {
      async fetch(request) {
        const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, '');
        const target = path.resolve(root, pathname);
        if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) return new Response('Not found', { status: 404 });
        return new Response(fs.readFileSync(target), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
  };
  const makeRequest = payload => new Request('https://studydoc.test/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://studydoc.test', 'CF-Connecting-IP': '127.0.0.1' },
    body: JSON.stringify(payload)
  });
  try {
    const legacySlugs = new Set(['medicine', 'surgery', 'obgyn', 'pediatrics', 'physiology']);
    for (const subject of catalogPayload.subjects.filter(item => !legacySlugs.has(item.slug))) {
      const question = dataBySlug[subject.slug][0];
      const response = await workerModule.default.fetch(makeRequest({
        _gotcha: '',
        details: 'Verifier correction details',
        email: 'qa@example.com',
        issue_type: 'Wrong answer',
        page_path: '/neet_pg_pyt_subject_bank',
        practice_number: '1',
        practice_total: '200',
        question_number: String(question.number),
        question_id: question.id,
        session: 'NEET-PG PYT 2026',
        subject_slug: subject.slug,
        year: '2026'
      }), env);
      assert.equal(response.status, 200, subject.slug);
      const forwarded = delivered.at(-1).form;
      assert.equal(forwarded.get('question_id'), question.id);
      assert.equal(forwarded.get('subject_slug'), subject.slug);
      assert.equal(forwarded.get('page_url'), `https://studydoc.test/neet_pg_pyt_subject_bank?subject=${subject.slug}`);
    }
    const legacyQuestion = JSON.parse(fs.readFileSync(path.join(root, 'neet_pg_medicine_pyt_bank_data.json'), 'utf8'))[0];
    const legacyBody = new URLSearchParams({
      _gotcha: '', details: 'Legacy verifier details', email: 'qa@example.com', issue_type: 'Wrong answer',
      page_path: '/neet_pg_medicine_pyt_bank', practice_number: '1', practice_total: '460',
      question_number: String(legacyQuestion.number), session: '', year: '2026'
    });
    const legacyResponse = await workerModule.default.fetch(new Request('https://studydoc.test/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://studydoc.test', 'CF-Connecting-IP': '127.0.0.2' },
      body: legacyBody
    }), env);
    assert.equal(legacyResponse.status, 200);
    assert.equal(delivered.at(-1).form.get('exam'), 'NEET-PG Medicine PYT Bank');
    const anatomy = dataBySlug.anatomy[0];
    const rejected = await workerModule.default.fetch(makeRequest({
      _gotcha: '', details: 'Mismatch check', email: 'qa@example.com', issue_type: 'Wrong answer',
      page_path: '/neet_pg_pyt_subject_bank', practice_number: '1', practice_total: '200',
      question_number: String(anatomy.number), question_id: 'ANAT-200', session: 'NEET-PG PYT 2026',
      subject_slug: 'anatomy', year: '2026'
    }), env);
    assert.equal(rejected.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return 'passed:14-new-subject-routes:5-legacy-routes';
};

const workerReports = await verifyWorkerReports();

let httpRoutes = 'not-requested';
if (process.argv[2]) {
  const base = new URL(process.argv[2]);
  if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.protocol !== 'http:') {
    throw new Error('The optional route check is restricted to a local HTTP preview.');
  }
  const fetchChecked = async (assetPath, expectedType, method = 'GET') => {
    const response = await fetch(new URL(assetPath, base), { method });
    assert.equal(response.status, 200, assetPath);
    assert.match(response.headers.get('content-type') || '', expectedType, assetPath);
    assert.ok(Number(response.headers.get('content-length') || 0) > 0, assetPath);
    return response;
  };
  await fetchChecked('pyt_based_question_bank.html', /text\/html/);
  await fetchChecked('neet_pg_pyt_subject_bank.html?subject=anatomy', /text\/html/);
  await fetchChecked('neet_pg_pyt_subject_bank.js', /javascript/);
  await fetchChecked('assets/neetpg_advanced_2026/catalog.json', /application\/json/);
  for (const subject of catalogPayload.subjects) {
    const response = await fetchChecked(subject.dataPath, /application\/json/);
    const payload = await response.json();
    assert.equal(payload.length, 200, subject.slug);
  }
  const imagePaths = Object.values(dataBySlug).flat().filter(question => question.imageBased).map(question => question.image.src);
  const uniqueImagePaths = [...new Set(imagePaths)];
  assert.equal(uniqueImagePaths.length, 760);
  for (let offset = 0; offset < uniqueImagePaths.length; offset += 25) {
    await Promise.all(uniqueImagePaths.slice(offset, offset + 25).map(assetPath => fetchChecked(assetPath, /image\/jpeg/, 'HEAD')));
  }
  httpRoutes = `passed:${catalogPayload.subjects.length}-data:${uniqueImagePaths.length}-images`;
}

console.log(JSON.stringify({ status: 'passed', ...validated, filters: 'passed', persistence: 'passed', unansweredFeedback: 'preserved-until-navigation', workerReports, httpRoutes }));
