'use strict';

const CATALOG_URL = 'assets/neetpg_advanced_2026/catalog.json';
const REPORT_ENDPOINT = '/api/report';
const REPORT_PAGE_PATH = '/neet_pg_pyt_subject_bank';
const REPORT_SESSION = 'NEET-PG PYT 2026';
const STORAGE_KEY = 'studydoc_neetpg_pyt_progress_v1';
const STORAGE_VERSION = 1;
const $ = selector => document.querySelector(selector);

const CATALOG_KEYS = new Set(['schemaVersion', 'releaseYear', 'title', 'subjectCount', 'questionCount', 'imageQuestionCount', 'uniqueImageCount', 'topicCount', 'subjects']);
const SUBJECT_KEYS = new Set(['id', 'slug', 'name', 'code', 'questionCount', 'imageQuestionCount', 'topicCount', 'dataPath', 'topics']);
const TOPIC_KEYS = new Set(['id', 'name', 'rank', 'frequency', 'sourceQuestionCount']);
const QUESTION_KEYS = new Set(['id', 'number', 'year', 'subject', 'subjectSlug', 'topic', 'topicId', 'difficulty', 'question', 'options', 'answerIndex', 'explanation', 'integratedSubjects', 'imageBased', 'image', 'references']);
const IMAGE_KEYS = new Set(['src', 'width', 'height', 'neutralCredit', 'license', 'licenseUrl', 'sourcePage', 'sourceTitle', 'originalSha256', 'webAssetSha256', 'renderingNote']);
const REFERENCE_KEYS = new Set(['title', 'url']);
const VALID_DIFFICULTIES = new Set(['easy', 'moderate', 'hard']);
const VALID_STATUSES = new Set(['all', 'unanswered', 'correct', 'wrong', 'bookmarked']);
const VALID_ISSUE_TYPES = new Set(['Wrong answer', 'Wrong image', 'Missing image', 'Wrong subject tag', 'Question or options need correction']);
const EXISTING_SUBJECT_ROUTES = Object.freeze({
  medicine: 'neet_pg_medicine_pyt_bank.html',
  surgery: 'neet_pg_surgery_pyt_bank.html',
  obgyn: 'neet_pg_obgyn_pyt_bank.html',
  pediatrics: 'neet_pg_pediatrics_practice_bank.html',
  physiology: 'neet_pg_physiology_practice_bank.html'
});

let catalog = null;
let subjectMeta = null;
let data = [];
let visibleItems = [];
let currentId = '';
let imageOnly = false;
let imageReady = true;
let reportItem = null;
let overlayReturnFocus = null;
let searchTimer = null;

const attempts = new Map();
const bookmarks = new Set();
const lastBySubject = new Map();

function dataError(message) {
  throw new TypeError(`Invalid PYT question bank data: ${message}`);
}

function validateKnownKeys(record, allowed, field) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) dataError(field);
  for (const key of Object.keys(record)) if (!allowed.has(key)) dataError(`${field}.${key}`);
}

function readString(value, field, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) dataError(field);
  return value;
}

function readInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) dataError(field);
  return value;
}

function normalizeHttpsUrl(value, field, allowEmpty = false) {
  const text = readString(value, field, 2400, allowEmpty).trim();
  if (!text && allowEmpty) return '';
  let url;
  try { url = new URL(text); } catch { dataError(field); }
  if (url.protocol !== 'https:' || url.username || url.password) dataError(field);
  return url.href;
}

function normalizeAssetPath(value, field, kind) {
  const path = readString(value, field, 700).replace(/^\//, '');
  const expected = kind === 'data'
    ? /^assets\/neetpg_advanced_2026\/data\/[a-z0-9-]+\.json$/
    : /^assets\/neetpg_advanced_2026\/images\/[A-Za-z0-9._-]+$/;
  if (!expected.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) dataError(field);
  const url = new URL(path, document.baseURI);
  const root = new URL(`assets/neetpg_advanced_2026/${kind === 'data' ? 'data' : 'images'}/`, document.baseURI);
  if (url.origin !== window.location.origin || !url.pathname.startsWith(root.pathname) || url.search || url.hash) dataError(field);
  return path;
}

function normalizeTopic(raw, index, subjectSlug) {
  const field = `catalog.subjects.${subjectSlug}.topics[${index}]`;
  validateKnownKeys(raw, TOPIC_KEYS, field);
  const id = readString(raw.id, `${field}.id`, 100);
  if (!/^[a-z0-9-]+$/.test(id)) dataError(`${field}.id`);
  return Object.freeze({
    id,
    name: readString(raw.name, `${field}.name`, 300),
    rank: readInteger(raw.rank, `${field}.rank`, 1, 500),
    frequency: readString(raw.frequency, `${field}.frequency`, 80),
    sourceQuestionCount: readInteger(raw.sourceQuestionCount, `${field}.sourceQuestionCount`, 0, 10000)
  });
}

function normalizeSubject(raw, index) {
  const field = `catalog.subjects[${index}]`;
  validateKnownKeys(raw, SUBJECT_KEYS, field);
  const slug = readString(raw.slug, `${field}.slug`, 80);
  if (!/^[a-z0-9-]+$/.test(slug) || raw.id !== slug) dataError(`${field}.slug`);
  if (!Array.isArray(raw.topics) || !raw.topics.length || raw.topics.length > 100) dataError(`${field}.topics`);
  const topics = Object.freeze(raw.topics.map((topic, topicIndex) => normalizeTopic(topic, topicIndex, slug)));
  if (new Set(topics.map(topic => topic.id)).size !== topics.length) dataError(`${field}.topics duplicate id`);
  const topicCount = readInteger(raw.topicCount, `${field}.topicCount`, 1, 100);
  if (topics.length !== topicCount) dataError(`${field}.topicCount mismatch`);
  return Object.freeze({
    id: slug,
    slug,
    name: readString(raw.name, `${field}.name`, 180),
    code: readString(raw.code, `${field}.code`, 20),
    questionCount: readInteger(raw.questionCount, `${field}.questionCount`, 1, 5000),
    imageQuestionCount: readInteger(raw.imageQuestionCount, `${field}.imageQuestionCount`, 0, 5000),
    topicCount,
    dataPath: normalizeAssetPath(raw.dataPath, `${field}.dataPath`, 'data'),
    topics
  });
}

function normalizeCatalog(raw) {
  validateKnownKeys(raw, CATALOG_KEYS, 'catalog');
  if (raw.schemaVersion !== '1.0' || raw.releaseYear !== '2026') dataError('catalog version');
  if (!Array.isArray(raw.subjects) || !raw.subjects.length || raw.subjects.length > 50) dataError('catalog.subjects');
  const subjects = Object.freeze(raw.subjects.map(normalizeSubject));
  if (new Set(subjects.map(subject => subject.slug)).size !== subjects.length) dataError('duplicate catalog subject');
  const subjectCount = readInteger(raw.subjectCount, 'catalog.subjectCount', 1, 50);
  if (subjectCount !== subjects.length) dataError('catalog subject count mismatch');
  const questionCount = readInteger(raw.questionCount, 'catalog.questionCount', 1, 10000);
  const imageQuestionCount = readInteger(raw.imageQuestionCount, 'catalog.imageQuestionCount', 0, questionCount);
  if (subjects.reduce((sum, subject) => sum + subject.questionCount, 0) !== questionCount) dataError('catalog question total mismatch');
  if (subjects.reduce((sum, subject) => sum + subject.imageQuestionCount, 0) !== imageQuestionCount) dataError('catalog image total mismatch');
  return Object.freeze({
    schemaVersion: raw.schemaVersion,
    releaseYear: raw.releaseYear,
    title: readString(raw.title, 'catalog.title', 300),
    subjectCount,
    questionCount,
    imageQuestionCount,
    uniqueImageCount: readInteger(raw.uniqueImageCount, 'catalog.uniqueImageCount', 0, 10000),
    topicCount: readInteger(raw.topicCount, 'catalog.topicCount', 1, 2000),
    subjects
  });
}

function normalizeImage(raw, field) {
  validateKnownKeys(raw, IMAGE_KEYS, field);
  const originalSha256 = readString(raw.originalSha256, `${field}.originalSha256`, 64);
  const webAssetSha256 = readString(raw.webAssetSha256, `${field}.webAssetSha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(originalSha256) || !/^[a-f0-9]{64}$/.test(webAssetSha256)) dataError(`${field}.sha256`);
  return Object.freeze({
    src: normalizeAssetPath(raw.src, `${field}.src`, 'image'),
    width: readInteger(raw.width, `${field}.width`, 1, 20000),
    height: readInteger(raw.height, `${field}.height`, 1, 20000),
    neutralCredit: readString(raw.neutralCredit, `${field}.neutralCredit`, 1200, true),
    license: readString(raw.license, `${field}.license`, 120, true),
    licenseUrl: normalizeHttpsUrl(raw.licenseUrl, `${field}.licenseUrl`, true),
    sourcePage: normalizeHttpsUrl(raw.sourcePage, `${field}.sourcePage`),
    sourceTitle: readString(raw.sourceTitle, `${field}.sourceTitle`, 1000, true),
    originalSha256,
    webAssetSha256,
    renderingNote: readString(raw.renderingNote, `${field}.renderingNote`, 1600, true)
  });
}

function normalizeReferences(raw, field) {
  if (!Array.isArray(raw) || raw.length > 3) dataError(field);
  return Object.freeze(raw.map((reference, index) => {
    const referenceField = `${field}[${index}]`;
    validateKnownKeys(reference, REFERENCE_KEYS, referenceField);
    return Object.freeze({
      title: readString(reference.title, `${referenceField}.title`, 300),
      url: normalizeHttpsUrl(reference.url, `${referenceField}.url`)
    });
  }));
}

function normalizeQuestion(raw, index, meta) {
  const field = `question[${index}]`;
  validateKnownKeys(raw, QUESTION_KEYS, field);
  const id = readString(raw.id, `${field}.id`, 40);
  if (!/^[A-Z0-9-]+$/.test(id)) dataError(`${field}.id`);
  if (raw.year !== '2026' || raw.subject !== meta.name || raw.subjectSlug !== meta.slug) dataError(`${field}.subject`);
  const topicIds = new Set(meta.topics.map(topic => topic.id));
  const topicId = readString(raw.topicId, `${field}.topicId`, 100);
  if (!topicIds.has(topicId)) dataError(`${field}.topicId`);
  if (!VALID_DIFFICULTIES.has(raw.difficulty)) dataError(`${field}.difficulty`);
  if (!Array.isArray(raw.options) || raw.options.length !== 4) dataError(`${field}.options`);
  const options = Object.freeze(raw.options.map((option, optionIndex) => readString(option, `${field}.options[${optionIndex}]`, 5000)));
  const answerIndex = readInteger(raw.answerIndex, `${field}.answerIndex`, 0, 3);
  if (!Array.isArray(raw.integratedSubjects) || !raw.integratedSubjects.length || raw.integratedSubjects.length > 10) dataError(`${field}.integratedSubjects`);
  const integratedSubjects = Object.freeze(raw.integratedSubjects.map((name, integratedIndex) => readString(name, `${field}.integratedSubjects[${integratedIndex}]`, 180)));
  if (typeof raw.imageBased !== 'boolean') dataError(`${field}.imageBased`);
  const image = raw.image === null ? null : normalizeImage(raw.image, `${field}.image`);
  if (raw.imageBased !== Boolean(image)) dataError(`${field}.imageBased mismatch`);
  return Object.freeze({
    id,
    number: readInteger(raw.number, `${field}.number`, 1, meta.questionCount),
    year: raw.year,
    subject: raw.subject,
    subjectSlug: raw.subjectSlug,
    topic: readString(raw.topic, `${field}.topic`, 300),
    topicId,
    difficulty: raw.difficulty,
    question: readString(raw.question, `${field}.question`, 25000),
    options,
    answerIndex,
    explanation: readString(raw.explanation, `${field}.explanation`, 30000),
    integratedSubjects,
    imageBased: raw.imageBased,
    image,
    references: normalizeReferences(raw.references, `${field}.references`)
  });
}

async function fetchJson(path, label) {
  const url = new URL(path, document.baseURI);
  if (url.origin !== window.location.origin) dataError(`${label} origin`);
  const response = await fetch(url, { mode: 'same-origin', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) dataError(`${label} response`);
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function validStoredId(value) {
  return typeof value === 'string' && /^[A-Z0-9-]{3,40}$/.test(value);
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== STORAGE_VERSION) throw new TypeError('version');
    const storedAttempts = parsed.attempts && typeof parsed.attempts === 'object' && !Array.isArray(parsed.attempts) ? Object.entries(parsed.attempts) : [];
    const storedBookmarks = Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [];
    const storedLast = parsed.lastBySubject && typeof parsed.lastBySubject === 'object' && !Array.isArray(parsed.lastBySubject) ? Object.entries(parsed.lastBySubject) : [];
    if (storedAttempts.length > 5000 || storedBookmarks.length > 5000 || storedLast.length > 50) throw new TypeError('size');
    for (const [id, choice] of storedAttempts) {
      if (!validStoredId(id) || !Number.isSafeInteger(choice) || choice < 0 || choice > 3) throw new TypeError('attempt');
      attempts.set(id, choice);
    }
    for (const id of storedBookmarks) {
      if (!validStoredId(id)) throw new TypeError('bookmark');
      bookmarks.add(id);
    }
    for (const [slug, id] of storedLast) {
      if (!/^[a-z0-9-]{1,80}$/.test(slug) || !validStoredId(id)) throw new TypeError('last question');
      lastBySubject.set(slug, id);
    }
  } catch (error) {
    console.warn('Discarded invalid PYT-bank progress.', error);
    attempts.clear(); bookmarks.clear(); lastBySubject.clear();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage can be unavailable. */ }
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      attempts: Object.fromEntries(attempts),
      bookmarks: [...bookmarks],
      lastBySubject: Object.fromEntries(lastBySubject)
    }));
  } catch (error) {
    console.warn('Could not save PYT-bank progress.', error);
  }
}

function currentItem() {
  return visibleItems.find(item => item.id === currentId) || null;
}

function attemptState(item) {
  if (!attempts.has(item.id)) return 'unanswered';
  return attempts.get(item.id) === item.answerIndex ? 'correct' : 'wrong';
}

function filteredQuestions() {
  const search = $('#search').value.trim().toLocaleLowerCase();
  const topic = $('#topic-filter').value;
  const difficulty = $('#difficulty-filter').value;
  const status = $('#status-filter').value;
  return data.filter(item => {
    if (search) {
      const haystack = [item.question, item.options.join(' '), item.topic, item.integratedSubjects.join(' ')].join(' ').toLocaleLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (topic !== 'all' && item.topicId !== topic) return false;
    if (difficulty !== 'all' && item.difficulty !== difficulty) return false;
    if (imageOnly && !item.imageBased) return false;
    if (status === 'bookmarked') return bookmarks.has(item.id);
    if (status !== 'all' && attemptState(item) !== status) return false;
    return true;
  });
}

function renderStats() {
  let attempted = 0;
  let correct = 0;
  for (const item of visibleItems) {
    if (attempts.has(item.id)) {
      attempted += 1;
      if (attempts.get(item.id) === item.answerIndex) correct += 1;
    }
  }
  $('#visible-count').textContent = String(visibleItems.length);
  $('#attempted-count').textContent = String(attempted);
  $('#correct-count').textContent = String(correct);
  $('#list-summary').textContent = `${visibleItems.length} shown`;
  const subjectIds = new Set(data.map(item => item.id));
  const savedCount = [...subjectIds].filter(id => attempts.has(id) || bookmarks.has(id)).length;
  const reset = $('#reset-subject');
  reset.disabled = savedCount === 0;
  reset.textContent = savedCount ? `Reset subject progress (${savedCount})` : 'Reset subject progress';
}

function renderQuestionList() {
  const list = $('#question-list');
  list.innerHTML = visibleItems.map(item => {
    const state = attemptState(item);
    const stateClass = state === 'unanswered' ? '' : ` done ${state}`;
    const stateLabel = state === 'unanswered' ? 'Unanswered' : state === 'correct' ? 'Answered correctly' : 'Answered incorrectly';
    const imageMark = item.imageBased ? '<span title="Image-based" aria-label="Image-based">&#9638;</span>' : '';
    const bookmarkMark = bookmarks.has(item.id) ? '<span class="qrow-star" title="Bookmarked" aria-label="Bookmarked">&#9733;</span>' : '';
    return `<button class="qrow${stateClass}${item.id === currentId ? ' active' : ''}" type="button" role="listitem" data-question-id="${escapeHtml(item.id)}"${item.id === currentId ? ' aria-current="true"' : ''} aria-label="Question ${item.number}. ${stateLabel}${bookmarks.has(item.id) ? '. Bookmarked' : ''}"><span class="qrow-top"><span class="qrow-number">Q${item.number}</span><span class="qrow-signs">${imageMark}${bookmarkMark}</span></span><span class="qrow-stem">${escapeHtml(item.question)}</span><span class="qrow-meta"><span>${escapeHtml(item.topic)}</span></span></button>`;
  }).join('');
}

function explanationHtml(item) {
  const paragraphs = item.explanation.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
  const attribution = item.image ? `<div class="attribution"><strong>Image attribution</strong>${escapeHtml(item.image.neutralCredit || 'Licensed educational image')}${item.image.sourceTitle ? ` &middot; <a href="${escapeHtml(item.image.sourcePage)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.image.sourceTitle)}</a>` : ` &middot; <a href="${escapeHtml(item.image.sourcePage)}" target="_blank" rel="noopener noreferrer">Open source page</a>`}${item.image.licenseUrl ? ` &middot; <a href="${escapeHtml(item.image.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.image.license || 'License')}</a>` : item.image.license ? ` &middot; ${escapeHtml(item.image.license)}` : ''}</div>` : '';
  const references = item.references.length ? `<div class="references"><strong>Guidance and further reading</strong><ul>${item.references.map(reference => `<li><a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference.title)}</a></li>`).join('')}</ul></div>` : '';
  return `<section class="explanation" aria-label="Answer explanation"><h3>Why this is the answer</h3>${paragraphs}${attribution}${references}</section>`;
}

function renderQuestion() {
  const panel = $('#quiz-panel');
  panel.setAttribute('aria-busy', 'false');
  const item = currentItem();
  if (!item) {
    panel.innerHTML = `<div class="empty-state"><strong>No questions match these filters.</strong><br>Change or clear a filter to continue.<br><button class="action-btn" id="clear-filters" type="button">Clear filters</button></div>`;
    $('#clear-filters').onclick = clearFilters;
    return;
  }
  const index = visibleItems.findIndex(entry => entry.id === item.id);
  const answered = attempts.has(item.id);
  const chosen = answered ? attempts.get(item.id) : null;
  const correct = answered && chosen === item.answerIndex;
  imageReady = !item.imageBased;
  const integrated = item.integratedSubjects.map(subject => `<span class="integrated-chip">${escapeHtml(subject)}</span>`).join('');
  const image = item.image ? `<figure class="question-figure"><button class="image-open" id="image-open" type="button" aria-label="Enlarge the question image"><img class="question-image" id="question-image" src="${escapeHtml(item.image.src)}" width="${item.image.width}" height="${item.image.height}" alt="Clinical question image for ${escapeHtml(item.subject)} question ${escapeHtml(item.id)}" decoding="async"></button><figcaption class="image-caption">${escapeHtml(item.image.neutralCredit || 'Source attribution is shown after answering.')}</figcaption><div class="image-error" id="image-error" role="alert" hidden>The question image could not be loaded. Answering is paused because this question depends on the image.<br><button id="retry-image" type="button">Retry image</button><button id="report-missing-image" type="button">Report missing image</button></div></figure>` : '';
  const options = item.options.map((option, optionIndex) => {
    let classes = 'option';
    if (answered) {
      classes += ' locked';
      if (optionIndex === item.answerIndex) classes += ' correct';
      else if (optionIndex === chosen) classes += ' wrong';
    }
    const disabled = answered || item.imageBased;
    return `<button class="${classes}" type="button" role="radio" aria-checked="${chosen === optionIndex ? 'true' : 'false'}" data-choice="${optionIndex}"${disabled ? ' disabled' : ''}><span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span><span>${escapeHtml(option)}</span></button>`;
  }).join('');
  const feedback = answered ? `<div class="feedback ${correct ? 'ok' : 'bad'}" id="answer-feedback" role="status" aria-live="polite" tabindex="-1"><strong>${correct ? 'Correct.' : 'Not quite.'}</strong>Correct answer: ${String.fromCharCode(65 + item.answerIndex)}. ${escapeHtml(item.options[item.answerIndex])}</div>` : '';
  panel.innerHTML = `<div class="question-top"><span class="pill topic">${escapeHtml(item.topic)}</span><span class="pill difficulty">${escapeHtml(item.difficulty)}</span>${item.imageBased ? '<span class="pill image">Image-based</span>' : ''}<span class="question-position">Question ${index + 1} of ${visibleItems.length}</span></div><h2 class="question-title" id="question-heading" tabindex="-1">Q${item.number}. ${escapeHtml(item.question)}</h2><div class="integrated-row"><span>Integrated with:</span>${integrated}</div>${image}<div class="options" role="radiogroup" aria-labelledby="question-heading">${options}</div>${item.imageBased && !answered ? '<div class="image-guard" id="image-guard">Answer choices unlock when the question image has loaded.</div>' : ''}${feedback}${answered ? explanationHtml(item) : ''}<div class="question-actions"><button class="action-btn${bookmarks.has(item.id) ? ' bookmarked' : ''}" id="bookmark-question" type="button" aria-pressed="${bookmarks.has(item.id)}">${bookmarks.has(item.id) ? '★ Bookmarked' : '☆ Bookmark'}</button><button class="action-btn danger" id="reset-question" type="button"${answered ? '' : ' disabled'}>Reset this answer</button><button class="action-btn" id="report-question" type="button">Report this question</button></div><nav class="sticky-nav" aria-label="Question navigation"><button id="previous-question" type="button"${index === 0 ? ' disabled' : ''}>&larr; Previous</button><span class="nav-count">${index + 1} / ${visibleItems.length}</span><button id="next-question" type="button"${index === visibleItems.length - 1 ? ' disabled' : ''}>Next &rarr;</button></nav>`;
  wireQuestionControls(item, index, answered);
}

function wireQuestionControls(item, index, answered) {
  document.querySelectorAll('.option').forEach(button => {
    button.addEventListener('click', () => answerQuestion(item, Number(button.dataset.choice)));
  });
  $('#bookmark-question').onclick = () => toggleBookmark(item);
  $('#reset-question').onclick = () => resetQuestion(item);
  $('#report-question').onclick = () => openReport(item);
  $('#previous-question').onclick = () => selectVisibleIndex(index - 1, true);
  $('#next-question').onclick = () => selectVisibleIndex(index + 1, true);
  if (item.image) {
    const image = $('#question-image');
    const loaded = () => {
      if (currentId !== item.id) return;
      imageReady = true;
      $('#image-error').hidden = true;
      const guard = $('#image-guard'); if (guard) guard.hidden = true;
      if (!answered) document.querySelectorAll('.option').forEach(button => { button.disabled = false; });
    };
    const failed = () => {
      if (currentId !== item.id) return;
      imageReady = false;
      $('#image-error').hidden = false;
      document.querySelectorAll('.option').forEach(button => { button.disabled = true; });
    };
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
    if (image.complete) image.naturalWidth > 0 ? loaded() : failed();
    $('#image-open').onclick = () => { if (imageReady) openLightbox(item, answered); };
    $('#retry-image').onclick = () => {
      $('#image-error').hidden = true;
      image.src = '';
      requestAnimationFrame(() => { image.src = item.image.src; });
    };
    $('#report-missing-image').onclick = () => openReport(item, 'Missing image');
  }
}

function applyFilters(options = {}) {
  visibleItems = filteredQuestions();
  if (!visibleItems.some(item => item.id === currentId)) {
    const remembered = lastBySubject.get(subjectMeta.slug);
    currentId = visibleItems.some(item => item.id === remembered) ? remembered : (visibleItems[0]?.id || '');
  }
  if (currentId) {
    lastBySubject.set(subjectMeta.slug, currentId);
    saveProgress();
  }
  renderStats();
  renderQuestionList();
  renderQuestion();
  if (options.focusQuestion) requestAnimationFrame(() => $('#question-heading')?.focus());
}

function selectVisibleIndex(index, focusQuestion = false) {
  if (index < 0 || index >= visibleItems.length) return;
  currentId = visibleItems[index].id;
  lastBySubject.set(subjectMeta.slug, currentId);
  saveProgress();
  if ($('#status-filter').value === 'unanswered' && visibleItems.some(item => attempts.has(item.id))) {
    applyFilters({ focusQuestion });
    return;
  }
  renderQuestionList();
  renderQuestion();
  document.querySelector(`.qrow[data-question-id="${CSS.escape(currentId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focusQuestion) requestAnimationFrame(() => $('#question-heading')?.focus());
}

function answerQuestion(item, choice) {
  if (item.id !== currentId || attempts.has(item.id) || !Number.isSafeInteger(choice) || choice < 0 || choice > 3) return;
  if (item.imageBased && !imageReady) return;
  attempts.set(item.id, choice);
  saveProgress();
  if ($('#status-filter').value === 'unanswered') {
    renderStats();
    renderQuestionList();
    renderQuestion();
  } else {
    applyFilters();
  }
  requestAnimationFrame(() => $('#answer-feedback')?.focus());
}

function toggleBookmark(item) {
  bookmarks.has(item.id) ? bookmarks.delete(item.id) : bookmarks.add(item.id);
  saveProgress();
  applyFilters();
}

function resetQuestion(item) {
  if (!attempts.has(item.id)) return;
  if (!window.confirm(`Reset your answer for ${item.id}?`)) return;
  attempts.delete(item.id);
  saveProgress();
  applyFilters();
}

function resetSubject() {
  const ids = new Set(data.map(item => item.id));
  const attemptCount = [...ids].filter(id => attempts.has(id)).length;
  const bookmarkCount = [...ids].filter(id => bookmarks.has(id)).length;
  if (!attemptCount && !bookmarkCount) return;
  if (!window.confirm(`Reset all saved progress for ${subjectMeta.name}? This removes ${attemptCount} answer${attemptCount === 1 ? '' : 's'} and ${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'}.`)) return;
  for (const id of ids) { attempts.delete(id); bookmarks.delete(id); }
  lastBySubject.delete(subjectMeta.slug);
  currentId = data[0]?.id || '';
  saveProgress();
  applyFilters();
}

function clearFilters() {
  $('#search').value = '';
  $('#topic-filter').value = 'all';
  $('#difficulty-filter').value = 'all';
  $('#status-filter').value = 'all';
  imageOnly = false;
  $('#image-toggle').setAttribute('aria-pressed', 'false');
  $('#image-toggle-state').textContent = 'Off';
  currentId = lastBySubject.get(subjectMeta.slug) || data[0]?.id || '';
  applyFilters();
}

function reportPreviewHtml(item) {
  return `<strong>${escapeHtml(item.id)} &middot; ${escapeHtml(item.subject)}</strong><div>${escapeHtml(item.question)}</div><ol type="A">${item.options.map(option => `<li>${escapeHtml(option)}</li>`).join('')}</ol>`;
}

function openReport(item, presetIssue = '') {
  reportItem = item;
  overlayReturnFocus = document.activeElement;
  const form = $('#report-form');
  form.reset();
  if (presetIssue && VALID_ISSUE_TYPES.has(presetIssue)) form.elements.issue_type.value = presetIssue;
  $('#report-summary').textContent = `${item.subject} ${item.id}. Tell us what needs correction.`;
  $('#report-preview').innerHTML = reportPreviewHtml(item);
  $('#report-status').textContent = '';
  $('#report-modal').hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => form.elements.issue_type.focus());
}

function closeReport() {
  $('#report-modal').hidden = true;
  document.body.classList.remove('modal-open');
  reportItem = null;
  overlayReturnFocus?.focus?.();
  overlayReturnFocus = null;
}

async function submitReport(event) {
  event.preventDefault();
  if (!reportItem) return;
  const form = event.currentTarget;
  const status = $('#report-status');
  const issueType = form.elements.issue_type.value;
  const details = form.elements.details.value.trim();
  const email = form.elements.email.value.trim();
  const gotcha = form.elements._gotcha.value;
  if (!VALID_ISSUE_TYPES.has(issueType) || details.length < 3 || !form.elements.email.checkValidity()) {
    status.textContent = 'Complete the issue, details and a valid email address.';
    form.reportValidity();
    return;
  }
  const index = visibleItems.findIndex(item => item.id === reportItem.id);
  const payload = {
    _gotcha: String(gotcha),
    details: String(details),
    email: String(email),
    issue_type: String(issueType),
    page_path: REPORT_PAGE_PATH,
    practice_number: String(index >= 0 ? index + 1 : reportItem.number),
    practice_total: String(visibleItems.length || subjectMeta.questionCount),
    question_number: String(reportItem.number),
    session: REPORT_SESSION,
    year: '2026',
    subject_slug: String(reportItem.subjectSlug),
    question_id: String(reportItem.id)
  };
  const submit = form.querySelector('.submit');
  submit.disabled = true;
  status.textContent = 'Sending report…';
  try {
    const response = await fetch(REPORT_ENDPOINT, { method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`Report failed (${response.status})`);
    status.textContent = 'Thanks, report sent.';
    form.reset();
    setTimeout(closeReport, 900);
  } catch (error) {
    console.error('Report submission failed.', error);
    status.textContent = 'Could not send the report. Please try again.';
  } finally {
    submit.disabled = false;
  }
}

function openLightbox(item, answered) {
  if (!item.image) return;
  overlayReturnFocus = document.activeElement;
  const image = $('#lightbox-image');
  image.src = item.image.src;
  image.alt = `Enlarged clinical question image for ${item.subject} question ${item.id}`;
  $('#lightbox-caption').textContent = answered && item.image.sourceTitle ? `${item.image.neutralCredit} · ${item.image.sourceTitle}` : (item.image.neutralCredit || 'Licensed educational image');
  $('#image-lightbox').hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => $('#lightbox-close').focus());
}

function closeLightbox() {
  $('#image-lightbox').hidden = true;
  $('#lightbox-image').removeAttribute('src');
  document.body.classList.remove('modal-open');
  overlayReturnFocus?.focus?.();
  overlayReturnFocus = null;
}

function focusableElements(container) {
  return [...container.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden && element.getClientRects().length);
}

function trapOverlayFocus(event, container) {
  const focusable = focusableElements(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function populateCatalogControls() {
  $('#subject-select').innerHTML = catalog.subjects.map(subject => `<option value="${escapeHtml(subject.slug)}">${escapeHtml(subject.name)}</option>`).join('');
  $('#subject-select').value = subjectMeta.slug;
  $('#topic-filter').innerHTML = '<option value="all">All topics</option>' + subjectMeta.topics.map(topic => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</option>`).join('');
  $('#subject-title').textContent = `${subjectMeta.name} PYT Question Bank`;
  $('#subject-subtitle').textContent = `${subjectMeta.questionCount} integrated questions across ${subjectMeta.topicCount} high-yield themes, with immediate feedback and full explanations.`;
  $('#header-question-count').textContent = String(subjectMeta.questionCount);
  $('#header-image-count').textContent = String(subjectMeta.imageQuestionCount);
  document.title = `${subjectMeta.name} PYT Question Bank 2026 | StudyDoc`;
}

function wirePageControls() {
  $('#subject-select').addEventListener('change', event => {
    const slug = event.target.value;
    if (!catalog.subjects.some(subject => subject.slug === slug)) return;
    window.location.assign(EXISTING_SUBJECT_ROUTES[slug] || `neet_pg_pyt_subject_bank.html?subject=${encodeURIComponent(slug)}`);
  });
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentId = ''; applyFilters(); }, 100);
  });
  for (const id of ['topic-filter', 'difficulty-filter', 'status-filter']) {
    $( `#${id}` ).addEventListener('change', event => {
      if (id === 'status-filter' && !VALID_STATUSES.has(event.target.value)) event.target.value = 'all';
      currentId = '';
      applyFilters();
    });
  }
  $('#image-toggle').addEventListener('click', () => {
    imageOnly = !imageOnly;
    $('#image-toggle').setAttribute('aria-pressed', String(imageOnly));
    $('#image-toggle-state').textContent = imageOnly ? 'On' : 'Off';
    currentId = '';
    applyFilters();
  });
  $('#reset-subject').addEventListener('click', resetSubject);
  $('#question-list').addEventListener('click', event => {
    const button = event.target.closest('.qrow');
    if (!button) return;
    const index = visibleItems.findIndex(item => item.id === button.dataset.questionId);
    selectVisibleIndex(index, true);
  });
  $('#report-form').addEventListener('submit', submitReport);
  $('#report-close').addEventListener('click', closeReport);
  $('#report-cancel').addEventListener('click', closeReport);
  $('#report-modal').addEventListener('click', event => { if (event.target === $('#report-modal')) closeReport(); });
  $('#lightbox-close').addEventListener('click', closeLightbox);
  $('#image-lightbox').addEventListener('click', event => { if (event.target === $('#image-lightbox')) closeLightbox(); });
  document.addEventListener('keydown', handleKeyboard);
}

function handleKeyboard(event) {
  if (!$('#report-modal').hidden) {
    if (event.key === 'Escape') { event.preventDefault(); closeReport(); }
    else if (event.key === 'Tab') trapOverlayFocus(event, $('#report-modal'));
    return;
  }
  if (!$('#image-lightbox').hidden) {
    if (event.key === 'Escape') { event.preventDefault(); closeLightbox(); }
    else if (event.key === 'Tab') trapOverlayFocus(event, $('#image-lightbox'));
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest('input,select,textarea,button,a')) return;
  const item = currentItem();
  if (!item) return;
  const index = visibleItems.findIndex(entry => entry.id === item.id);
  if (event.key === 'ArrowLeft') { event.preventDefault(); selectVisibleIndex(index - 1, true); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); selectVisibleIndex(index + 1, true); }
  else if (/^[1-4]$/.test(event.key) && !attempts.has(item.id)) { event.preventDefault(); answerQuestion(item, Number(event.key) - 1); }
  else if (event.key.toLowerCase() === 'b') { event.preventDefault(); toggleBookmark(item); }
}

async function initialize() {
  loadProgress();
  wirePageControls();
  try {
    catalog = normalizeCatalog(await fetchJson(CATALOG_URL, 'catalog'));
    const requested = new URLSearchParams(window.location.search).get('subject') || catalog.subjects[0].slug;
    if (EXISTING_SUBJECT_ROUTES[requested]) {
      window.location.replace(EXISTING_SUBJECT_ROUTES[requested]);
      return;
    }
    subjectMeta = catalog.subjects.find(subject => subject.slug === requested) || catalog.subjects[0];
    if (requested !== subjectMeta.slug) history.replaceState(null, '', `?subject=${encodeURIComponent(subjectMeta.slug)}`);
    populateCatalogControls();
    const raw = await fetchJson(subjectMeta.dataPath, `${subjectMeta.slug} data`);
    if (!Array.isArray(raw) || raw.length !== subjectMeta.questionCount) dataError(`${subjectMeta.slug} root`);
    data = Object.freeze(raw.map((question, index) => normalizeQuestion(question, index, subjectMeta)));
    if (new Set(data.map(item => item.id)).size !== data.length || new Set(data.map(item => item.number)).size !== data.length) dataError(`${subjectMeta.slug} duplicate id or number`);
    if (data.filter(item => item.imageBased).length !== subjectMeta.imageQuestionCount) dataError(`${subjectMeta.slug} image count mismatch`);
    currentId = data.some(item => item.id === lastBySubject.get(subjectMeta.slug)) ? lastBySubject.get(subjectMeta.slug) : data[0].id;
    applyFilters();
  } catch (error) {
    console.error('PYT question bank could not be loaded safely.', error);
    $('#quiz-panel').setAttribute('aria-busy', 'false');
    $('#quiz-panel').innerHTML = '<div class="fatal-state"><strong>This subject bank could not be loaded safely.</strong><br>Please refresh or return to the subject overview and try again.<br><a class="action-btn" href="pyt_based_question_bank.html">Return to all subjects</a></div>';
    $('#question-list').replaceChildren();
  }
}

initialize();
