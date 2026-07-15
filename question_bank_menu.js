class StudyQuestionBankMenu extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready === 'true') return;
    this.dataset.ready = 'true';
    const subjects = [
      ['Anatomy', 'neet_pg_pyt_subject_bank.html?subject=anatomy', '200 · 80 image/data'],
      ['Physiology', 'neet_pg_physiology_practice_bank.html', '333 · 105 image/data'],
      ['Biochemistry', 'neet_pg_pyt_subject_bank.html?subject=biochemistry', '200 · 80 image/data'],
      ['Pathology', 'neet_pg_pyt_subject_bank.html?subject=pathology', '200 · 80 image/data'],
      ['Pharmacology', 'neet_pg_pyt_subject_bank.html?subject=pharmacology', '200 · 80 image/data'],
      ['Microbiology', 'neet_pg_pyt_subject_bank.html?subject=microbiology', '200 · 80 image/data'],
      ['Forensic Medicine', 'neet_pg_pyt_subject_bank.html?subject=forensic-medicine', '200 · 80 image/data'],
      ['Community Medicine (PSM)', 'neet_pg_pyt_subject_bank.html?subject=community-medicine-psm', '200 · 80 image/data'],
      ['Medicine', 'neet_pg_medicine_pyt_bank.html', '460 · 215 image/data'],
      ['Pediatrics', 'neet_pg_pediatrics_practice_bank.html', '342 · 111 image/data'],
      ['Dermatology', 'neet_pg_pyt_subject_bank.html?subject=dermatology', '200 · 80 image/data'],
      ['Psychiatry', 'neet_pg_pyt_subject_bank.html?subject=psychiatry', '200 · 80 image/data'],
      ['Surgery', 'neet_pg_surgery_pyt_bank.html', '463 · 235 image/data'],
      ['Orthopedics', 'neet_pg_pyt_subject_bank.html?subject=orthopedics', '200 · 80 image/data'],
      ['Radiodiagnosis', 'neet_pg_pyt_subject_bank.html?subject=radiodiagnosis', '200 · 80 image/data'],
      ['Anaesthesiology', 'neet_pg_pyt_subject_bank.html?subject=anaesthesiology', '200 · 80 image/data'],
      ['Ophthalmology', 'neet_pg_pyt_subject_bank.html?subject=ophthalmology', '200 · 80 image/data'],
      ['ENT', 'neet_pg_pyt_subject_bank.html?subject=ent', '200 · 80 image/data'],
      ['Obstetrics & Gynaecology', 'neet_pg_obgyn_pyt_bank.html', '437 · 209 image/data']
    ];
    const subjectLinks = subjects.map(([name, href, meta]) => `
      <a class="qb-menu-subject" href="${href}"><b>${name}</b><small>${meta}</small></a>`).join('');
    this.innerHTML = `
      <details class="qb-menu">
        <summary aria-label="Open all 19 PYT question-bank subjects">
          <span class="qb-menu-label-full">Question Bank</span>
          <span class="qb-menu-label-short">QBank</span>
          <span class="qb-menu-caret" aria-hidden="true">&#9662;</span>
        </summary>
        <div class="qb-menu-panel">
          <a class="qb-menu-all" href="pyt_based_question_bank.html"><b>PYT-Based Question Bank</b><small>19 subjects · 4,835 MCQs · 1,995 image/data</small></a>
          <div class="qb-menu-subjects" aria-label="All 19 question-bank subjects">${subjectLinks}</div>
        </div>
      </details>`;

    const details = this.querySelector('details');
    const summary = details.querySelector('summary');
    let openedByHover = false;
    details.addEventListener('mouseenter', () => {
      if (!window.matchMedia('(hover: hover)').matches || details.open) return;
      openedByHover = true;
      details.open = true;
    });
    details.addEventListener('mouseleave', () => {
      if (!openedByHover) return;
      openedByHover = false;
      details.open = false;
    });
    summary.addEventListener('click', event => {
      if (!openedByHover) return;
      event.preventDefault();
      openedByHover = false;
      details.open = true;
    });
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        openedByHover = false;
        details.removeAttribute('open');
        summary.focus();
      }
    });
    document.addEventListener('click', event => {
      if (!this.contains(event.target)) {
        openedByHover = false;
        details.removeAttribute('open');
      }
    });
  }
}

if (!customElements.get('study-qbank-menu')) {
  customElements.define('study-qbank-menu', StudyQuestionBankMenu);
}
