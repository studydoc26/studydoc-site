const ATLAS_DATA_PATH = 'video_atlas_data.json?v=20260715-v2';
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_URL_PATTERN = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})(?:&t=(\d+)s)?$/;
const STRING_FIELDS = [
  'title',
  'subject',
  'segment',
  'source',
  'summary',
  'identify',
  'examAngle',
  'management',
  'quickRevision',
  'youtubeUrl',
  'youtubeId'
];
const OPTIONAL_STRING_FIELDS = ['differentiation', 'clipType'];

let ATLAS = [];

const grid = document.getElementById('atlasGrid');
const searchInput = document.getElementById('searchInput');
const subjectFilter = document.getElementById('subjectFilter');
const resultCount = document.getElementById('resultCount');
const noResults = document.getElementById('noResults');
const videoFrame = document.getElementById('videoFrame');
const nowTitle = document.getElementById('nowTitle');
const nowMeta = document.getElementById('nowMeta');
const nowDesc = document.getElementById('nowDesc');
const nowYoutube = document.getElementById('nowYoutube');
const videoStat = document.getElementById('videoStat');

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  "'":'&#39;',
  '"':'&quot;'
}[char]));

function assertStringArray(value, field, index) {
  if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string' && entry.trim())) {
    throw new TypeError(`Atlas entry ${index + 1} has an invalid ${field} array.`);
  }
}

function validateAtlas(payload) {
  if (!Array.isArray(payload)) throw new TypeError('Atlas data must be an array.');

  const seenNumbers = new Set();
  payload.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`Atlas entry ${index + 1} must be an object.`);
    }
    if (!Number.isSafeInteger(item.number) || item.number < 1 || seenNumbers.has(item.number)) {
      throw new TypeError(`Atlas entry ${index + 1} has an invalid or duplicate number.`);
    }
    seenNumbers.add(item.number);

    STRING_FIELDS.forEach(field => {
      if (typeof item[field] !== 'string') {
        throw new TypeError(`Atlas entry ${index + 1} has an invalid ${field} field.`);
      }
    });
    OPTIONAL_STRING_FIELDS.forEach(field => {
      if (field in item && (typeof item[field] !== 'string' || !item[field].trim())) {
        throw new TypeError(`Atlas entry ${index + 1} has an invalid ${field} field.`);
      }
    });
    if (!item.title.trim() || !item.subject.trim() || !item.source.trim() || !item.youtubeId.trim()) {
      throw new TypeError(`Atlas entry ${index + 1} is missing a required string value.`);
    }

    assertStringArray(item.tags, 'tags', index);
    assertStringArray(item.anchors, 'anchors', index);

    if (!Array.isArray(item.differentials) || !item.differentials.every(differential => (
      differential &&
      typeof differential === 'object' &&
      !Array.isArray(differential) &&
      typeof differential.name === 'string' &&
      differential.name.trim() &&
      typeof differential.clue === 'string' &&
      differential.clue.trim()
    ))) {
      throw new TypeError(`Atlas entry ${index + 1} has invalid differentials.`);
    }

    if (!YOUTUBE_ID_PATTERN.test(item.youtubeId)) {
      throw new TypeError(`Atlas entry ${index + 1} has an invalid YouTube ID.`);
    }
    const youtubeMatch = item.youtubeUrl.match(YOUTUBE_URL_PATTERN);
    if (!youtubeMatch || youtubeMatch[1] !== item.youtubeId) {
      throw new TypeError(`Atlas entry ${index + 1} has an invalid YouTube URL.`);
    }
    if (youtubeMatch[2] && !Number.isSafeInteger(Number(youtubeMatch[2]))) {
      throw new TypeError(`Atlas entry ${index + 1} has an invalid YouTube start time.`);
    }
  });

  return Object.freeze(payload.slice());
}

async function loadAtlas() {
  const dataUrl = new URL(ATLAS_DATA_PATH, window.location.href);
  if (dataUrl.origin !== window.location.origin) {
    throw new TypeError('Atlas data URL must be same-origin.');
  }
  const response = await fetch(dataUrl, {
    method:'GET',
    mode:'same-origin',
    credentials:'same-origin',
    redirect:'error',
    headers:{ Accept:'application/json' }
  });
  if (!response.ok) throw new Error(`Atlas data request failed with status ${response.status}.`);
  return validateAtlas(await response.json());
}

function populateSubjects() {
  const subjects = Array.from(new Set(ATLAS.flatMap(item => item.tags.length ? item.tags : [item.subject]))).filter(Boolean).sort();
  document.getElementById('subjectStat').textContent = subjects.length;
  subjects.forEach(subject => {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    subjectFilter.appendChild(option);
  });
}

function parseStartSeconds(url) {
  const match = String(url || '').match(/[?&]t=(\d+)s?/i);
  return match ? Number(match[1]) : 0;
}

function parseClock(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => (total * 60) + part, 0);
}

function parseSegmentRange(segment) {
  const [startText, endText] = String(segment || '').split('-');
  return { start:parseClock(startText), end:parseClock(endText) };
}

function embedUrl(item) {
  const range = parseSegmentRange(item.segment);
  const start = parseStartSeconds(item.youtubeUrl) || range.start;
  const params = new URLSearchParams({ rel:'0', playsinline:'1' });
  if (start > 0) params.set('start', String(start));
  if (range.end > start) params.set('end', String(range.end));
  return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.youtubeId) + '?' + params.toString();
}

function cardMarkup(item) {
  const anchors = item.anchors.map(anchor => `<span>${esc(anchor)}</span>`).join('');
  const differentials = item.differentials.map(differential => `<div class="differential-row"><strong>${esc(differential.name)}</strong><span>${esc(differential.clue)}</span></div>`).join('');
  const differentiation = item.differentiation || '';
  const differentialSearch = item.differentials.flatMap(differential => [differential.name, differential.clue]);
  const searchText = [item.title, item.subject, item.summary, item.identify, item.examAngle, item.management, item.quickRevision, item.source, item.clipType || '', differentiation, ...item.anchors, ...differentialSearch].join(' ');
  return `<article class="atlas-card" data-search="${esc(searchText.toLowerCase())}" data-subject="${esc(item.tags.join('|'))}">
    <div class="card-top">
      <span class="topic-num">${String(item.number).padStart(3, '0')}</span>
      <div class="topic-meta">
        <div class="subject-line">${esc(item.subject)}</div>
        <h2 class="topic-title"><button class="topic-title-button" type="button" data-number="${item.number}">${esc(item.title)}</button></h2>
      </div>
      ${item.segment ? `<span class="segment-chip">${esc(item.segment)}</span>` : ''}
    </div>
    <p class="topic-summary"><strong>What to watch for:</strong> ${esc(item.summary || item.identify)}</p>
    ${item.identify && item.identify !== item.summary ? `<p class="look-for"><strong>Visual clue:</strong> ${esc(item.identify)}</p>` : ''}
    ${anchors ? `<div><p class="mini-label">High-yield facts</p><div class="anchor-list">${anchors}</div></div>` : ''}
    ${item.examAngle && item.examAngle !== item.management ? `<p class="exam-angle"><strong>Exam focus:</strong> ${esc(item.examAngle)}</p>` : ''}
    ${item.management ? `<p class="exam-angle"><strong>Clinical relevance:</strong> ${esc(item.management)}</p>` : ''}
    ${differentiation ? `<details class="differential-panel"><summary>Diagnosis and differentiation</summary><div class="differential-list"><div class="differential-row"><strong>Clinical approach</strong><span>${esc(differentiation)}</span></div></div></details>` : ''}
    ${differentials ? `<details class="differential-panel"><summary>Closest differentials (${item.differentials.length})</summary><div class="differential-list">${differentials}</div></details>` : ''}
    ${item.source ? `<p class="source-credit">Source: ${esc(item.source)}</p>` : ''}
    <div class="card-actions">
      <button class="watch-button" type="button" data-number="${item.number}">Watch here</button>
      <a class="youtube-link" href="${esc(item.youtubeUrl)}" target="_blank" rel="noopener">YouTube link</a>
    </div>
  </article>`;
}

function selectVideo(number, shouldScroll = false) {
  const item = ATLAS.find(entry => entry.number === Number(number));
  if (!item) return;
  const playerPanel = document.getElementById('playerPanel');
  playerPanel.classList.remove('is-hidden');
  videoFrame.src = embedUrl(item);
  videoFrame.title = item.title + ' clinical video';
  nowTitle.textContent = item.title;
  nowMeta.textContent = [item.subject, item.clipType, item.segment].filter(Boolean).join(' · ');
  nowDesc.textContent = item.summary || item.identify || '';
  nowYoutube.href = item.youtubeUrl;
  nowYoutube.textContent = 'YouTube link';
  if (shouldScroll) playerPanel.scrollIntoView({ behavior:'smooth', block:'start' });
}

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const subject = subjectFilter.value;
  const filtered = ATLAS.filter(item => {
    const differentialSearch = item.differentials.flatMap(differential => [differential.name, differential.clue]);
    const haystack = [item.title, item.subject, item.summary, item.identify, item.examAngle, item.management, item.quickRevision, item.source, item.clipType || '', item.differentiation || '', ...item.anchors, ...item.tags, ...differentialSearch].join(' ').toLowerCase();
    const subjectMatch = subject === 'all' || item.tags.includes(subject) || item.subject === subject;
    return subjectMatch && (!term || haystack.includes(term));
  });
  grid.innerHTML = filtered.map(cardMarkup).join('');
  resultCount.textContent = filtered.length + (filtered.length === 1 ? ' video' : ' videos');
  noResults.classList.toggle('show', filtered.length === 0);
}

grid.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const trigger = event.target.closest('.watch-button, .topic-title-button');
  if (!trigger) return;
  selectVideo(trigger.dataset.number, true);
});
searchInput.addEventListener('input', render);
subjectFilter.addEventListener('change', render);

loadAtlas()
  .then(atlas => {
    ATLAS = atlas;
    if (videoStat) videoStat.textContent = ATLAS.length;
    populateSubjects();
    render();
  })
  .catch(error => {
    console.error('Unable to load video atlas.', error);
    resultCount.textContent = '0 videos';
    noResults.textContent = 'Unable to load the video atlas.';
    noResults.classList.add('show');
  });
