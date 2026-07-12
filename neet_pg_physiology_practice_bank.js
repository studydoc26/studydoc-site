const DATA_URL = 'neet_pg_physiology_practice_bank_data.json';
const REPORT_EXAM = 'NEET-PG Physiology Practice Bank';
const REPORT_ENDPOINT = '/api/report';
const STORAGE_KEY = 'studydoc_physiology_practice_attempts_v1';
let DATA = [];
let current = 0;
let subtopic = 'all';
let imageOnly = false;
const SUBTOPIC_ORDER = ["Cardiovascular", "Respiratory", "Acid-base", "Renal", "Neurology", "Endocrine", "Gastrointestinal", "Haematology", "Muscle", "Reproductive", "General", "Community Medicine", "Biostatistics"];
const $ = s => document.querySelector(s);
const ITEM_KEYS = new Set(['number', 'subtopic', 'topic', 'question', 'options', 'answerIndex', 'correctAnswer', 'explanation', 'optionExplanations', 'images', 'references', 'year']);
const IMAGE_KEYS = new Set(['src', 'caption', 'credit', 'source', 'width', 'height']);

function dataError(message) { throw new TypeError(`Invalid Physiology question data: ${message}`); }
function readString(value, field, maxLength, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) dataError(field);
  return value;
}
function optionalString(value, field, maxLength) {
  return value === undefined ? '' : readString(value, field, maxLength, true);
}
function validateKnownKeys(record, allowed, field) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) dataError(field);
  for (const key of Object.keys(record)) if (!allowed.has(key)) dataError(`${field}.${key}`);
}
function normalizeAssetPath(value, field) {
  const path = readString(value, field, 500);
  if (!/^assets\/[A-Za-z0-9._/-]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) dataError(field);
  const url = new URL(path, document.baseURI);
  const root = new URL('assets/', document.baseURI);
  if (url.origin !== window.location.origin || !url.pathname.startsWith(root.pathname) || url.search || url.hash) dataError(field);
  return path;
}
function normalizeImages(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) dataError(field);
  return Object.freeze(value.map((image, index) => {
    const imageField = `${field}[${index}]`;
    if (typeof image === 'string') return normalizeAssetPath(image, imageField);
    validateKnownKeys(image, IMAGE_KEYS, imageField);
    const normalized = { src: normalizeAssetPath(image.src, `${imageField}.src`) };
    for (const key of ['caption', 'credit', 'source']) {
      if (image[key] !== undefined) normalized[key] = readString(image[key], `${imageField}.${key}`, 1000, true);
    }
    for (const key of ['width', 'height']) {
      if (image[key] !== undefined) {
        if (!Number.isSafeInteger(image[key]) || image[key] < 1 || image[key] > 10000) dataError(`${imageField}.${key}`);
        normalized[key] = image[key];
      }
    }
    return Object.freeze(normalized);
  }));
}
function normalizeReferences(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) dataError(field);
  return Object.freeze(value.map((reference, index) => {
    const referenceField = `${field}[${index}]`;
    validateKnownKeys(reference, new Set(['title', 'url']), referenceField);
    const title = readString(reference.title, `${referenceField}.title`, 300);
    const url = new URL(readString(reference.url, `${referenceField}.url`, 2000));
    if (url.protocol !== 'https:' || url.username || url.password) dataError(`${referenceField}.url`);
    return Object.freeze({ title, url: url.href });
  }));
}
function normalizeQuestion(raw, index) {
  const field = `item[${index}]`;
  validateKnownKeys(raw, ITEM_KEYS, field);
  if (!Number.isSafeInteger(raw.number) || raw.number < 1 || raw.number > 10000) dataError(`${field}.number`);
  if (raw.year !== '2026') dataError(`${field}.year`);
  if (!Array.isArray(raw.options) || raw.options.length !== 4) dataError(`${field}.options`);
  const options = Object.freeze(raw.options.map((option, optionIndex) => readString(option, `${field}.options[${optionIndex}]`, 5000)));
  if (!Number.isSafeInteger(raw.answerIndex) || raw.answerIndex < 0 || raw.answerIndex >= options.length) dataError(`${field}.answerIndex`);
  const optionExplanations = raw.optionExplanations === undefined ? [] : raw.optionExplanations;
  if (!Array.isArray(optionExplanations) || optionExplanations.length > options.length) dataError(`${field}.optionExplanations`);
  return Object.freeze({
    number: raw.number,
    year: raw.year,
    subtopic: readString(raw.subtopic, `${field}.subtopic`, 150),
    topic: readString(raw.topic, `${field}.topic`, 300),
    question: readString(raw.question, `${field}.question`, 20000),
    options,
    answerIndex: raw.answerIndex,
    correctAnswer: optionalString(raw.correctAnswer, `${field}.correctAnswer`, 5000),
    explanation: readString(raw.explanation, `${field}.explanation`, 30000),
    optionExplanations: Object.freeze(optionExplanations.map((text, optionIndex) => readString(text, `${field}.optionExplanations[${optionIndex}]`, 5000, true))),
    images: normalizeImages(raw.images, `${field}.images`),
    references: normalizeReferences(raw.references, `${field}.references`)
  });
}
async function loadQuestionData() {
  const url = new URL(DATA_URL, document.baseURI);
  if (url.origin !== window.location.origin) dataError('data URL origin');
  const response = await fetch(url, { mode: 'same-origin', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) dataError('data response');
  const raw = await response.json();
  if (!Array.isArray(raw) || !raw.length || raw.length > 5000) dataError('root');
  const normalized = raw.map(normalizeQuestion);
  const ids = new Set();
  for (const item of normalized) {
    if (ids.has(item.number)) dataError(`duplicate question ${item.number}`);
    ids.add(item.number);
  }
  return Object.freeze(normalized);
}
function loadAttempts() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Map();
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Invalid attempt object');
    const entries = Object.entries(parsed);
    if (entries.length > 5000) throw new TypeError('Too many attempts');
    for (const [key, value] of entries) {
      if (!/^[1-9]\d{0,4}$/.test(key) || !value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.choice) || value.choice < 0 || value.choice > 3 || typeof value.correct !== 'boolean') throw new TypeError('Invalid attempt entry');
    }
    return new Map(entries.map(([key, value]) => [key, { choice: value.choice, correct: value.correct }]));
  } catch (error) {
    console.warn('Discarding invalid Physiology attempt data.', error);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* Storage may be unavailable. */ }
    return new Map();
  }
}
const attempts = loadAttempts();
function reconcileAttempts() {
  const questions = new Map(DATA.map(item => [itemKey(item), item]));
  let changed = false;
  for (const [key, attempt] of attempts) {
    const item = questions.get(key);
    if (!item) { attempts.delete(key); changed = true; continue; }
    const correct = attempt.choice === item.answerIndex;
    if (attempt.correct !== correct) { attempts.set(key, { choice: attempt.choice, correct }); changed = true; }
  }
  if (changed) saveAttempts();
}
function saveAttempts() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(attempts))); }
  catch (error) { console.warn('Could not save Physiology attempt data.', error); }
}
function updateResetAllButton() {
  const resetAll = $('#reset-all');
  if (!resetAll) return;
  resetAll.disabled = attempts.size === 0;
  resetAll.textContent = attempts.size ? `Reset all progress (${attempts.size})` : 'Reset all progress';
}
function resetAllProgress() {
  if (!attempts.size) return;
  const count = attempts.size;
  const suffix = count === 1 ? '' : 's';
  if (!window.confirm(`Reset all saved progress for this question bank? This will clear ${count} attempted answer${suffix}.`)) return;
  attempts.clear();
  localStorage.removeItem(STORAGE_KEY);
  current = 0;
  renderList();
  renderQuiz();
}
function itemKey(item) { return String(item.number); }
function imageList(item) { return item.images || []; }
function isImageBased(item) { return imageList(item).length > 0; }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function answerText(item) { return `${String.fromCharCode(65 + item.answerIndex)}. ${item.options[item.answerIndex] || ''}`; }
function reportPreviewHtml(item, practiceNumber, practiceTotal) { return `<strong>Question being reported</strong><div><span class="qrow-id">Q${practiceNumber}</span></div><div>${escapeHtml(item.question)}</div><ol type="A">${(item.options || []).map(opt => `<li>${escapeHtml(opt)}</li>`).join('')}</ol>`; }
function populateSubtopics() {
  const subtopics = [...new Set(DATA.map(item => item.subtopic || 'Physiology').filter(Boolean))]
    .sort((a, b) => {
      const ai = SUBTOPIC_ORDER.indexOf(a);
      const bi = SUBTOPIC_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    });
  $('#topic-filter').innerHTML = '<option value="all">All Physiology subtopics</option>' + subtopics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}
function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  const f = $('#filter').value;
  return DATA.filter(item => {
    const hay = [item.question, (item.options || []).join(' '), item.subtopic, item.topic, item.explanation].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (subtopic !== 'all' && (item.subtopic || 'Physiology') !== subtopic) return false;
    if (imageOnly && !isImageBased(item)) return false;
    const key = itemKey(item);
    if (f === 'unanswered') return !attempts.has(key);
    if (f === 'wrong') { const a = attempts.get(key); return a && !a.correct; }
    return true;
  });
}
function renderList() {
  const items = filtered();
  if (!items[current]) current = 0;
  $('#count').textContent = items.length;
  const visible = new Set(items.map(itemKey));
  let score = 0, answered = 0;
  for (const [key, val] of attempts) { if (visible.has(key)) { answered++; if (val.correct) score++; } }
  $('#answered').textContent = answered;
  $('#score').textContent = score;
  updateResetAllButton();
  $('#qlist').innerHTML = items.map((item, idx) => {
    const imgBadge = isImageBased(item) ? '<span class="qrow-img">Image/data</span>' : '';
    const done = attempts.has(itemKey(item)) ? ' done' : '';
    return `<button class="qrow${idx === current ? ' active' : ''}${done}" data-idx="${idx}"><b>Q${idx + 1}.</b> ${escapeHtml(item.question).slice(0,118)}<div class="qrow-meta"><span class="qrow-topic">${escapeHtml(item.subtopic || 'Physiology')}</span>${imgBadge}</div></button>`;
  }).join('');
  [...document.querySelectorAll('.qrow')].forEach(btn => btn.onclick = () => { current = Number(btn.dataset.idx); renderQuiz(); renderList(); });
}
function renderQuiz() {
  const items = filtered();
  const item = items[current];
  if (!item) { $('#quiz').innerHTML = '<p class="empty-state">No questions match this filter.</p>'; return; }
  const key = itemKey(item);
  const att = attempts.get(key);
  const imageNote = '';
  const images = imageList(item).length ? `<div class="qimages">${imageList(item).map((im, i) => { const s = typeof im === 'string' ? im : im.src; return `<figure><img src="${escapeHtml(s)}" alt="Figure ${i + 1} for question ${current + 1}" loading="lazy"></figure>`; }).join('')}</div>` : '';
  const opts = item.options.map((opt, idx) => {
    let cls = '';
    if (att) cls = idx === item.answerIndex ? ' correct' : (idx === att.choice ? ' wrong' : '');
    return `<button class="option${cls}" data-choice="${idx}"><b>${String.fromCharCode(65 + idx)}.</b> ${escapeHtml(opt)}</button>`;
  }).join('');
  let feedback = '';
  let explanation = '';
  if (att) {
    feedback = `<div class="feedback ${att.correct ? 'ok' : 'bad'}">${att.correct ? 'Correct.' : 'Wrong.'} Correct answer: ${escapeHtml(answerText(item))}</div>`;
    const optionNoteItems = (item.optionExplanations || []).map((note, idx) => ({ note: String(note || '').trim(), idx })).filter(entry => entry.note);
    const optionNotes = optionNoteItems.length ? `<div class="option-notes">${optionNoteItems.map(({note, idx}) => `<div class="option-note"><b>${String.fromCharCode(65 + idx)}.</b> ${escapeHtml(note)}</div>`).join('')}</div>` : '';
    const imageAttributions = imageList(item).map((im, idx) => ({ idx, text: typeof im === 'object' ? [im.caption, im.credit].filter(Boolean).join(' \u2014 ') : '' })).filter(entry => entry.text);
    const imageSources = imageAttributions.length ? `<div class="image-attributions"><h4>Image attribution</h4>${imageAttributions.map(({idx, text}) => `<div class="image-attribution"><b>Figure ${idx + 1}:</b> ${escapeHtml(text)}</div>`).join('')}</div>` : '';
    explanation = `<div class="explanation"><h3>Why this is the answer</h3><p>${escapeHtml(item.explanation)}</p>${optionNotes}${imageSources}</div>`;
  }
  const remaining = Math.max(items.length - current - 1, 0);
  const progress = items.length ? Math.round(((current + 1) / items.length) * 100) : 0;
  const progressMeter = `<span class="remaining-meter" role="meter" aria-label="${remaining} questions remaining" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${current + 1}"><span class="remaining-track"><span class="remaining-fill" style="width:${progress}%"></span></span><span class="remaining-count">${remaining} left</span></span>`;
  $('#quiz').innerHTML = `<div class="qtop"><span class="pill topic">${escapeHtml(item.subtopic || 'Physiology')}</span>${progressMeter}</div><h2 class="question">Q${current + 1}. ${escapeHtml(item.question)}</h2>${imageNote}${images}<div class="options">${opts}</div>${feedback}${explanation}<div class="nav"><button id="prev">Previous</button><button id="next">Next</button><button id="reset">Reset this answer</button><button id="report-question" class="report-btn" type="button">Report this question</button></div>`;
  [...document.querySelectorAll('.option')].forEach(btn => btn.onclick = () => {
    const choice = Number(btn.dataset.choice);
    attempts.set(key, {choice, correct: choice === item.answerIndex});
    saveAttempts();
    renderQuiz(); renderList();
  });
  $('#prev').onclick = () => { current = Math.max(0, current - 1); renderQuiz(); renderList(); };
  $('#next').onclick = () => { current = Math.min(items.length - 1, current + 1); renderQuiz(); renderList(); };
  $('#reset').onclick = () => { attempts.delete(key); saveAttempts(); renderQuiz(); renderList(); };
  $('#report-question').onclick = () => openReport(item, current + 1, items.length);
}
function openReport(item, practiceNumber, practiceTotal) {
  const form = $('#report-form');
  const summary = `${REPORT_EXAM} Q${practiceNumber}`;
  form.reset();
  form.elements.year.value = item.year;
  form.elements.question_number.value = String(item.number);
  form.elements.practice_number.value = String(practiceNumber);
  form.elements.practice_total.value = String(practiceTotal);
  form.elements.session.value = REPORT_EXAM;
  form.elements.page_path.value = window.location.pathname;
  $('#report-summary').textContent = `${summary}. Tell us what needs correction.`;
  $('#report-question-preview').innerHTML = reportPreviewHtml(item, practiceNumber, practiceTotal);
  $('#report-status').textContent = '';
  $('#report-modal').hidden = false;
  setTimeout(() => form.elements.issue_type.focus(), 0);
}
function closeReport() { $('#report-modal').hidden = true; }
async function submitReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $('#report-status');
  if (form.elements._gotcha.value) {
    status.textContent = 'Thanks, report sent.';
    form.reset();
    setTimeout(closeReport, 900);
    return;
  }
  const emailField = form.elements.email;
  const email = emailField.value.trim();
  emailField.value = email;
  if (!email) { status.textContent = 'Enter your email before sending.'; emailField.focus(); return; }
  if (!emailField.checkValidity()) { status.textContent = 'Enter a valid email address before sending.'; emailField.reportValidity(); emailField.focus(); return; }
  const submit = form.querySelector('.submit-report');
  status.textContent = 'Sending report...';
  submit.disabled = true;
  try {
    const response = await fetch(REPORT_ENDPOINT, { method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' }, body: new FormData(form) });
    if (!response.ok) throw new Error('Report submission failed');
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
$('#search').oninput = () => { current = 0; renderList(); renderQuiz(); };
$('#filter').onchange = () => { current = 0; renderList(); renderQuiz(); };
$('#topic-filter').onchange = e => { subtopic = e.target.value; current = 0; renderList(); renderQuiz(); };
$('#img-toggle').onclick = () => { imageOnly = !imageOnly; $('#img-toggle').classList.toggle('active', imageOnly); $('#img-state').textContent = imageOnly ? 'On' : 'Off'; current = 0; renderList(); renderQuiz(); };
$('#reset-all').onclick = resetAllProgress;
$('#report-form').addEventListener('submit', submitReport);
$('#report-close').onclick = closeReport;
$('#report-cancel').onclick = closeReport;
$('#report-modal').addEventListener('click', e => { if (e.target.id === 'report-modal') closeReport(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#report-modal').hidden) closeReport(); });
async function initialize() {
  try {
    DATA = await loadQuestionData();
    reconcileAttempts();
    populateSubtopics();
    renderList();
    renderQuiz();
  } catch (error) {
    console.error('Physiology question bank could not be loaded safely.', error);
    $('#qlist').replaceChildren();
    $('#quiz').replaceChildren();
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = 'Questions could not be loaded safely. Please refresh or try again later.';
    $('#quiz').append(message);
  }
}
initialize();
