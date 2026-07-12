'use strict';

const DATA_URL = 'neet_pg_obgyn_pyt_bank_data.json';
const REPORT_EXAM = 'NEET-PG ObGyn PYT Bank';
const REPORT_ENDPOINT = '/api/report';
const STORAGE_KEY = 'studydoc_obgyn_pyt_attempts_v1';
let DATA = [];
let attempts = new Map();
let current = 0;
let subtopic = 'all';
let imageOnly = false;
const SUBTOPIC_ORDER = ["Obstetrics", "High-Risk Pregnancy", "Fetal Medicine", "Labor & Delivery", "Postpartum & Puerperium", "Gynecology", "Reproductive Medicine", "Contraception", "Gynecologic Oncology", "Urogynecology", "Infections", "Instruments & Procedures", "General ObGyn"];
const $ = s => document.querySelector(s);

function createSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `session-${Date.now().toString(36)}`;
}
const SESSION_ID = createSessionId();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isSafeImagePath(path) {
  if (typeof path !== 'string' || !path.startsWith('assets/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\') || path.includes('?') || path.includes('#')) return false;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  if (decoded !== path) return false;
  const segments = path.split('/');
  if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..')) return false;
  const pageBase = new URL('.', window.location.href);
  const assetsBase = new URL('assets/', pageBase);
  const resolved = new URL(path, pageBase);
  return resolved.origin === window.location.origin && resolved.pathname.startsWith(assetsBase.pathname) && !resolved.search && !resolved.hash;
}
function validateQuestionData(value) {
  if (!Array.isArray(value)) throw new Error('Question data must be an array.');
  const seenNumbers = new Set();
  value.forEach((item, index) => {
    const label = `Question data item ${index + 1}`;
    if (!isPlainObject(item)) throw new Error(`${label} must be an object.`);
    if (!Number.isSafeInteger(item.number) || item.number < 1 || seenNumbers.has(item.number)) throw new Error(`${label} has an invalid or duplicate number.`);
    seenNumbers.add(item.number);
    if (typeof item.question !== 'string') throw new Error(`${label} has an invalid question.`);
    if (!Array.isArray(item.options) || item.options.length === 0 || !item.options.every(option => typeof option === 'string')) throw new Error(`${label} has invalid options.`);
    if (!Number.isSafeInteger(item.answerIndex) || item.answerIndex < 0 || item.answerIndex >= item.options.length) throw new Error(`${label} has an invalid answer index.`);
    if (typeof item.explanation !== 'string') throw new Error(`${label} has an invalid explanation.`);
    if (!Array.isArray(item.images) || !item.images.every(isSafeImagePath)) throw new Error(`${label} has an unsafe image path.`);
    if (item.subtopic !== undefined && typeof item.subtopic !== 'string') throw new Error(`${label} has an invalid subtopic.`);
    if (item.optionExplanations !== undefined && (!Array.isArray(item.optionExplanations) || !item.optionExplanations.every(note => typeof note === 'string'))) throw new Error(`${label} has invalid option explanations.`);
  });
  return value;
}
async function loadQuestionData() {
  const dataUrl = new URL(DATA_URL, window.location.href);
  if (dataUrl.origin !== window.location.origin) throw new Error('Question data URL must be same-origin.');
  const response = await fetch(dataUrl.href, {
    credentials: 'same-origin',
    redirect: 'error',
    headers: { 'Accept': 'application/json' }
  });
  if (!response.ok) throw new Error(`Question data request failed (${response.status}).`);
  if (new URL(response.url).origin !== window.location.origin) throw new Error('Question data response must be same-origin.');
  return validateQuestionData(await response.json());
}
function validateAttempts(value) {
  if (!isPlainObject(value)) return null;
  const questionsByKey = new Map(DATA.map(item => [String(item.number), item]));
  const entries = Object.entries(value);
  for (const [key, attempt] of entries) {
    const question = questionsByKey.get(key);
    if (!question || !isPlainObject(attempt)) return null;
    const fields = Object.keys(attempt).sort();
    if (fields.length !== 2 || fields[0] !== 'choice' || fields[1] !== 'correct') return null;
    if (!Number.isSafeInteger(attempt.choice) || attempt.choice < 0 || attempt.choice >= question.options.length) return null;
    if (typeof attempt.correct !== 'boolean' || attempt.correct !== (attempt.choice === question.answerIndex)) return null;
  }
  return new Map(entries);
}
function loadAttempts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const validated = validateAttempts(JSON.parse(raw));
    if (!validated) throw new Error('Saved progress has an invalid shape.');
    return validated;
  } catch (error) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage can be unavailable. */ }
    console.warn('Discarded invalid saved progress.', error);
    return new Map();
  }
}
function saveAttempts() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(attempts))); }
  catch (error) { console.warn('Could not save quiz progress.', error); }
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
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage can be unavailable. */ }
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
  const subtopics = [...new Set(DATA.map(item => item.subtopic || 'ObGyn').filter(Boolean))]
    .sort((a, b) => {
      const ai = SUBTOPIC_ORDER.indexOf(a);
      const bi = SUBTOPIC_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    });
  $('#topic-filter').innerHTML = '<option value="all">All ObGyn subtopics</option>' + subtopics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}
function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  const f = $('#filter').value;
  return DATA.filter(item => {
    const hay = [item.question, (item.options || []).join(' '), item.subtopic, item.topic, item.explanation].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (subtopic !== 'all' && (item.subtopic || 'ObGyn') !== subtopic) return false;
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
    return `<button class="qrow${idx === current ? ' active' : ''}${done}" data-idx="${idx}"><b>Q${idx + 1}.</b> ${escapeHtml(item.question).slice(0,118)}<div class="qrow-meta"><span class="qrow-topic">${escapeHtml(item.subtopic || 'ObGyn')}</span>${imgBadge}</div></button>`;
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
  const images = imageList(item).length ? `<div class="qimages">${imageList(item).map((src, i) => `<figure><img src="${escapeHtml(src)}" alt="ObGyn PYT image ${i + 1} for question ${current + 1}"></figure>`).join('')}</div>` : '';
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
    explanation = `<div class="explanation"><h3>Why this is the answer</h3><p>${escapeHtml(item.explanation)}</p>${optionNotes}</div>`;
  }
  const remaining = Math.max(items.length - current - 1, 0);
  const progress = items.length ? Math.round(((current + 1) / items.length) * 100) : 0;
  const progressMeter = `<span class="remaining-meter" role="meter" aria-label="${remaining} questions remaining" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${current + 1}"><span class="remaining-track"><span class="remaining-fill" style="width:${progress}%"></span></span><span class="remaining-count">${remaining} left</span></span>`;
  $('#quiz').innerHTML = `<div class="qtop"><span class="pill topic">${escapeHtml(item.subtopic || 'ObGyn')}</span>${progressMeter}</div><h2 class="question">Q${current + 1}. ${escapeHtml(item.question)}</h2>${imageNote}${images}<div class="options">${opts}</div>${feedback}${explanation}<div class="nav"><button id="prev">Previous</button><button id="next">Next</button><button id="reset">Reset this answer</button><button id="report-question" class="report-btn" type="button">Report this question</button></div>`;
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
  form.elements.year.value = item.year || '2026';
  form.elements.question_number.value = item.number;
  form.elements.practice_number.value = practiceNumber;
  form.elements.practice_total.value = practiceTotal;
  form.elements.session.value = SESSION_ID;
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
  const emailField = form.elements.email;
  const email = emailField.value.trim();
  emailField.value = email;
  if (!email) { status.textContent = 'Enter your email before sending.'; emailField.focus(); return; }
  if (!emailField.checkValidity()) { status.textContent = 'Enter a valid email address before sending.'; emailField.reportValidity(); emailField.focus(); return; }
  const submit = form.querySelector('.submit-report');
  status.textContent = 'Sending report...';
  submit.disabled = true;
  try {
    const response = await fetch(REPORT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'Accept': 'application/json' },
      body: new FormData(form)
    });
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
function bindEvents() {
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
}
async function init() {
  try {
    DATA = await loadQuestionData();
    attempts = loadAttempts();
    bindEvents();
    populateSubtopics();
    renderList();
    renderQuiz();
  } catch (error) {
    console.error('Could not initialize the question bank.', error);
    const quiz = $('#quiz');
    quiz.textContent = 'This question bank could not be loaded. Please refresh the page and try again.';
  }
}

void init();
