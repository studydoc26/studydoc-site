const DATA_URL = 'fmge_quiz_data.json';
const YEARS = ["2021", "2022", "2023", "2024", "2025", "2026"];
const SUBJECTS = ["Anatomy", "Physiology", "Biochemistry", "Pharmacology", "Pathology", "Microbiology", "Forensic medicine & toxicology", "PSM", "ENT", "Ophthalmology", "Medicine", "Surgery", "ObGy", "Pediatrics", "Orthopedics", "Anesthesia", "Radiology", "Dermatology", "Psychiatry"];
let year = (function(){
  const p = new URLSearchParams(window.location.search).get('year');
  return (p && YEARS.includes(p)) ? p : YEARS[0];
})();
let subject = 'all';
let session = 'all';
let sortMode = 'number';
let current = 0;
let imageOnly = false;
const REPORT_EXAM = 'FMGE';
const REPORT_ENDPOINT = '/api/report';
let DATA = [];
const attempts = new Map();
const $ = s => document.querySelector(s);
const tabs = [...document.querySelectorAll('.year-tab')];
const ITEM_KEYS = new Set(['session', 'year', 'number', 'question', 'options', 'answerIndex', 'subject', 'subjectTags', 'images', 'imageRef', 'note', 'sourceLocalQuestion', 'references', 'explanation']);
const IMAGE_KEYS = new Set(['src', 'caption', 'credit', 'source', 'width', 'height']);

function dataError(message) { throw new TypeError(`Invalid FMGE question data: ${message}`); }
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
function normalizeStringList(value, field) {
  if (!Array.isArray(value) || !value.length || value.length > 10) dataError(field);
  return Object.freeze(value.map((entry, index) => readString(entry, `${field}[${index}]`, 150)));
}
function normalizeQuestion(raw, index) {
  const field = `item[${index}]`;
  validateKnownKeys(raw, ITEM_KEYS, field);
  if (!YEARS.includes(raw.year)) dataError(`${field}.year`);
  if (!Number.isSafeInteger(raw.number) || raw.number < 1 || raw.number > 10000) dataError(`${field}.number`);
  if (!Array.isArray(raw.options) || raw.options.length !== 4) dataError(`${field}.options`);
  const options = Object.freeze(raw.options.map((option, optionIndex) => readString(option, `${field}.options[${optionIndex}]`, 5000)));
  if (!Number.isSafeInteger(raw.answerIndex) || raw.answerIndex < 0 || raw.answerIndex >= options.length) dataError(`${field}.answerIndex`);
  const imageRef = raw.imageRef === undefined ? false : raw.imageRef;
  if (typeof imageRef !== 'boolean') dataError(`${field}.imageRef`);
  return Object.freeze({
    year: raw.year,
    session: readString(raw.session, `${field}.session`, 200),
    number: raw.number,
    question: readString(raw.question, `${field}.question`, 20000),
    options,
    answerIndex: raw.answerIndex,
    subject: readString(raw.subject, `${field}.subject`, 150),
    subjectTags: normalizeStringList(raw.subjectTags, `${field}.subjectTags`),
    images: normalizeImages(raw.images, `${field}.images`),
    imageRef,
    note: optionalString(raw.note, `${field}.note`, 5000),
    sourceLocalQuestion: optionalString(raw.sourceLocalQuestion, `${field}.sourceLocalQuestion`, 1000),
    explanation: optionalString(raw.explanation, `${field}.explanation`, 30000),
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
    const id = [item.year, item.session, item.number].join('::');
    if (ids.has(id)) dataError(`duplicate question ${id}`);
    ids.add(id);
  }
  return Object.freeze(normalized);
}
const IMAGE_STEM_RE = /(\b(image|picture|photograph|figure|diagram)\b|\b(as shown|shown below|given below|depicted)\b|\bshown\s+(in|below|above)\b|\b(shown|given)\s+(image|picture|photograph|figure|diagram)\b|\b(marked|labelled|labeled)\b|\b(this|given|shown)\s+(instrument|lesion|structure|sign|pattern|device|chart|waveform)\b|\bidentify\s+(the\s+)?(given|shown|following|marked)?\s*(instrument|lesion|structure|sign|pattern|device|cell|area)\b|\bbased on (the )?(given )?(radiographic|x-?ray|ct|mri|ecg|fundoscopic) findings\b|\blooking at this picture\b)/i;
function imageList(item) {
  return (item.images || []).map(img => typeof img === 'string' ? img : img && img.src).filter(Boolean);
}
function isImageBased(item) {
  const hasInlineImages = imageList(item).length > 0;
  const hasAssetRef = item.imageRef === true;
  return hasInlineImages || hasAssetRef;
}
function itemKey(item) {
  return [String(item.year), item.session || item.source || '', item.number].join('::');
}
function reportPreviewHtml(item) {
  const options = item.options || [];
  const optionsHtml = options.length ? `<ol type="A">${options.map(opt => `<li>${escapeHtml(opt)}</li>`).join('')}</ol>` : '';
  return `<strong>Question being reported</strong><div>${escapeHtml(item.question || '')}</div>${optionsHtml}`;
}
function openReport(item, practiceNumber, practiceTotal) {
  const form = $('#report-form');
  const summary = `${REPORT_EXAM} ${item.session} Q${item.number}`;
  form.reset();
  form.elements.year.value = item.year;
  form.elements.question_number.value = String(item.number);
  form.elements.practice_number.value = String(practiceNumber);
  form.elements.practice_total.value = String(practiceTotal);
  form.elements.session.value = item.session;
  form.elements.page_path.value = window.location.pathname;
  $('#report-summary').textContent = `${summary}. Tell us what needs correction.`;
  $('#report-question-preview').innerHTML = reportPreviewHtml(item);
  $('#report-status').textContent = '';
  $('#report-modal').hidden = false;
  setTimeout(() => form.elements.issue_type.focus(), 0);
}
function closeReport() {
  $('#report-modal').hidden = true;
}
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
  if (!email) {
    status.textContent = 'Enter your email before sending.';
    emailField.focus();
    return;
  }
  if (!emailField.checkValidity()) {
    status.textContent = 'Enter a valid email address before sending.';
    emailField.reportValidity();
    emailField.focus();
    return;
  }
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
function populateSubjects() {
  const select = $('#subject-filter');
  if (!select) return;
  select.innerHTML = '<option value="all">All subjects</option>' + SUBJECTS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}
const MONTH_ORDER = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
function sessionsForYear(y) {
  const set = new Set(DATA.filter(it => String(it.year) === String(y)).map(it => it.session).filter(Boolean));
  return [...set].sort((a, b) => (MONTH_ORDER[a.split(' ')[0]] || 0) - (MONTH_ORDER[b.split(' ')[0]] || 0));
}
function populateSessions() {
  const select = $('#session-filter');
  if (!select) return;
  const list = sessionsForYear(year);
  select.innerHTML = '<option value="all">All sessions</option>' + list.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (!list.includes(session)) session = 'all';
  select.value = session;
  select.style.display = list.length > 1 ? '' : 'none';
}
function toggleImageFilter() {
  imageOnly = !imageOnly;
  document.getElementById('img-toggle').classList.toggle('active', imageOnly);
  document.getElementById('img-state').textContent = imageOnly ? 'On' : 'Off';
  current = 0; renderList(); renderQuiz();
}
function sortItems(items) {
  return items.slice().sort((a, b) => {
    if (sortMode === 'subject') {
      const bySubject = String(a.subject || '').localeCompare(String(b.subject || ''));
      if (bySubject) return bySubject;
    }
    return Number(a.number) - Number(b.number);
  });
}
function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  const f = $('#filter').value;
  const items = DATA.filter(item => String(item.year) === String(year) && (session === 'all' || item.session === session)).filter(item => {
    const hay = [item.question, (item.options || []).join(' '), item.subject || '', (item.subjectTags || []).join(' ')].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (subject !== 'all' && !(item.subjectTags || [item.subject]).includes(subject)) return false;
    if (imageOnly && !isImageBased(item)) return false;
    const key = itemKey(item);
    if (f === 'unanswered') return !attempts.has(key);
    if (f === 'wrong') { const a = attempts.get(key); return a && !a.correct; }
    return true;
  });
  return sortItems(items);
}
function renderList() {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.year === String(year)));
  const items = filtered();
  if (!items[current]) current = 0;
  $('#count').textContent = items.length;
  const visible = new Set(items.map(itemKey));
  let score = 0, answered = 0;
  for (const [key, val] of attempts) {
    if (visible.has(key)) { answered++; if (val.correct) score++; }
  }
  $('#answered').textContent = answered;
  $('#score').textContent = score;
  $('#qlist').innerHTML = items.map((item, idx) => {
    const imgBadge = isImageBased(item) ? '<span class="qrow-img">Image-based</span>' : '';
    const tagText = (item.subjectTags && item.subjectTags.length ? item.subjectTags : [item.subject || 'Medicine']).join(', ');
    const meta = `<div class="qrow-meta"><span class="qrow-subject">${escapeHtml(tagText)}</span>${imgBadge}</div>`;
    return `<button class="qrow ${idx === current ? 'active' : ''}" data-idx="${idx}"><b>Q${escapeHtml(item.number)}</b> ${escapeHtml(item.question).slice(0,120)}${meta}</button>`;
  }).join('');
  [...document.querySelectorAll('.qrow')].forEach(btn => btn.onclick = () => { current = Number(btn.dataset.idx); renderQuiz(); renderList(); });
}
function renderQuiz() {
  const items = filtered();
  const item = items[current];
  if (!item) { $('#quiz').innerHTML = '<p class="empty-state">No questions match this filter.</p>'; return; }
  const key = itemKey(item);
  const att = attempts.get(key);
  const canCheck = item.answerIndex !== null && item.answerIndex !== undefined;
  const images = imageList(item);
  const imgNote = images.length
    ? `<div class="qimages">${images.map((src, i) => `<figure><img src="${escapeHtml(src)}" alt="Question image ${i + 1}"></figure>`).join('')}</div>`
    : '';
  const opts = (item.options || []).map((opt, idx) => {
    let cls = '';
    if (att && canCheck) cls = idx === item.answerIndex ? ' correct' : (idx === att.choice ? ' wrong' : '');
    return `<button class="option${cls}" data-choice="${idx}"><b>${String.fromCharCode(65 + idx)}.</b> ${escapeHtml(opt)}</button>`;
  }).join('');
  let feedback = '';
  if (att && canCheck) feedback = `<div class="feedback ${att.correct ? 'ok' : 'bad'}">${att.correct ? 'Correct.' : 'Wrong.'} Correct answer: ${String.fromCharCode(65 + item.answerIndex)}. ${escapeHtml(item.options[item.answerIndex])}</div>`;
  const explanation = att && item.explanation
    ? `<section class="explanation" aria-label="Answer explanation"><h3>Explanation</h3><p>${escapeHtml(item.explanation)}</p></section>`
    : '';
  const remaining = Math.max(items.length - current - 1, 0);
  const progress = items.length ? Math.round(((current + 1) / items.length) * 100) : 0;
  const subjectPill = `<span class="pill topic">${escapeHtml((item.subjectTags && item.subjectTags[0]) || item.subject || 'FMGE')}</span>`;
  const progressMeter = `<span class="remaining-meter" role="meter" aria-label="${remaining} questions remaining" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${current + 1}"><span class="remaining-track"><span class="remaining-fill" style="width:${progress}%"></span></span><span class="remaining-count">${remaining} left</span></span>`;
  $('#quiz').innerHTML = `<div class="qtop">${subjectPill}${progressMeter}</div><h2 class="question">Q${escapeHtml(item.number)}. ${escapeHtml(item.question)}</h2>${imgNote}<div class="options">${opts}</div>${feedback}${explanation}<div class="nav"><button id="prev">Previous</button><button id="next">Next</button><button id="reset">Reset this answer</button><button id="report-question" class="report-btn" type="button">Report this question</button></div>`;
  [...document.querySelectorAll('.option')].forEach(btn => btn.onclick = () => {
    if (!canCheck) return;
    const choice = Number(btn.dataset.choice);
    attempts.set(key, {choice, correct: choice === item.answerIndex});
    renderQuiz(); renderList();
  });
  $('#prev').onclick = () => { current = Math.max(0, current - 1); renderQuiz(); renderList(); };
  $('#next').onclick = () => { current = Math.min(items.length - 1, current + 1); renderQuiz(); renderList(); };
  $('#reset').onclick = () => { attempts.delete(key); renderQuiz(); renderList(); };
  $('#report-question').onclick = () => openReport(item, current + 1, items.length);
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
tabs.forEach(t => t.onclick = () => { year = t.dataset.year; session = 'all'; current = 0; populateSessions(); renderList(); renderQuiz(); });
$('#search').oninput = () => { current = 0; renderList(); renderQuiz(); };
$('#filter').onchange = () => { current = 0; renderList(); renderQuiz(); };
$('#subject-filter').onchange = e => { subject = e.target.value; current = 0; renderList(); renderQuiz(); };
$('#session-filter').onchange = e => { session = e.target.value; current = 0; renderList(); renderQuiz(); };
$('#sort').onchange = e => { sortMode = e.target.value; current = 0; renderList(); renderQuiz(); };
$('#img-toggle').onclick = toggleImageFilter;
$('#report-form').addEventListener('submit', submitReport);
$('#report-close').onclick = closeReport;
$('#report-cancel').onclick = closeReport;
$('#report-modal').addEventListener('click', e => { if (e.target.id === 'report-modal') closeReport(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#report-modal').hidden) closeReport(); });
async function initialize() {
  try {
    DATA = await loadQuestionData();
    populateSubjects();
    populateSessions();
    renderList();
    renderQuiz();
  } catch (error) {
    console.error('FMGE questions could not be loaded safely.', error);
    $('#qlist').replaceChildren();
    $('#quiz').replaceChildren();
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = 'Questions could not be loaded safely. Please refresh or try again later.';
    $('#quiz').append(message);
  }
}
initialize();
