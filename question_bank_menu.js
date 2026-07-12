class StudyQuestionBankMenu extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready === 'true') return;
    this.dataset.ready = 'true';
    this.innerHTML = `
      <details class="qb-menu">
        <summary aria-label="Open Question Bank subjects">
          <span class="qb-menu-label-full">Question Bank</span>
          <span class="qb-menu-label-short">QBank</span>
          <span class="qb-menu-caret" aria-hidden="true">&#9662;</span>
        </summary>
        <div class="qb-menu-panel">
          <a class="qb-menu-all" href="pyt_based_question_bank.html"><b>All PYT banks</b><small>1,035 topic-wise MCQs</small></a>
          <a href="neet_pg_medicine_pyt_bank.html"><b>Medicine</b><small>260 questions · 135 image/data</small></a>
          <a href="neet_pg_surgery_pyt_bank.html"><b>Surgery</b><small>263 questions · 155 image/data</small></a>
          <a href="neet_pg_obgyn_pyt_bank.html"><b>ObGyn</b><small>237 questions · 129 image/data</small></a>
          <a href="neet_pg_pediatrics_practice_bank.html"><b>Pediatrics</b><small>142 questions · 31 image/data</small></a>
          <a href="neet_pg_physiology_practice_bank.html"><b>Physiology</b><small>133 questions · 25 image/data</small></a>
        </div>
      </details>`;

    const details = this.querySelector('details');
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        details.removeAttribute('open');
        details.querySelector('summary').focus();
      }
    });
    document.addEventListener('click', event => {
      if (!this.contains(event.target)) details.removeAttribute('open');
    });
  }
}

if (!customElements.get('study-qbank-menu')) {
  customElements.define('study-qbank-menu', StudyQuestionBankMenu);
}
