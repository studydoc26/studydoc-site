class StudyQuestionBankMenu extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready === 'true') return;
    this.dataset.ready = 'true';
    const subjects = [
      ['Anatomy', 'neet_pg_pyt_subject_bank.html?subject=anatomy'],
      ['Physiology', 'neet_pg_physiology_practice_bank.html'],
      ['Biochemistry', 'neet_pg_pyt_subject_bank.html?subject=biochemistry'],
      ['Pathology', 'neet_pg_pyt_subject_bank.html?subject=pathology'],
      ['Pharmacology', 'neet_pg_pyt_subject_bank.html?subject=pharmacology'],
      ['Microbiology', 'neet_pg_pyt_subject_bank.html?subject=microbiology'],
      ['Forensic Medicine', 'neet_pg_pyt_subject_bank.html?subject=forensic-medicine'],
      ['Community Medicine (PSM)', 'neet_pg_pyt_subject_bank.html?subject=community-medicine-psm'],
      ['Medicine', 'neet_pg_medicine_pyt_bank.html'],
      ['Pediatrics', 'neet_pg_pediatrics_practice_bank.html'],
      ['Dermatology', 'neet_pg_pyt_subject_bank.html?subject=dermatology'],
      ['Psychiatry', 'neet_pg_pyt_subject_bank.html?subject=psychiatry'],
      ['Surgery', 'neet_pg_surgery_pyt_bank.html'],
      ['Orthopedics', 'neet_pg_pyt_subject_bank.html?subject=orthopedics'],
      ['Radiodiagnosis', 'neet_pg_pyt_subject_bank.html?subject=radiodiagnosis'],
      ['Anaesthesiology', 'neet_pg_pyt_subject_bank.html?subject=anaesthesiology'],
      ['Ophthalmology', 'neet_pg_pyt_subject_bank.html?subject=ophthalmology'],
      ['ENT', 'neet_pg_pyt_subject_bank.html?subject=ent'],
      ['Obstetrics & Gynaecology', 'neet_pg_obgyn_pyt_bank.html']
    ];
    const subjectLinks = subjects.map(([name, href]) => `
      <a class="qb-menu-subject" href="${href}"><b>${name}</b></a>`).join('');
    this.innerHTML = `
      <details class="qb-menu">
        <summary aria-label="Open all 19 PYT question-bank subjects">
          <span class="qb-menu-label-full">Question Bank</span>
          <span class="qb-menu-label-short">QBank</span>
          <span class="qb-menu-caret" aria-hidden="true">&#9662;</span>
        </summary>
        <div class="qb-menu-panel">
          <a class="qb-menu-all" href="pyt_based_question_bank.html"><b>All PYT banks</b><small>4,835 questions</small></a>
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
