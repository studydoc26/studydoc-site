(function () {
  const year = new URLSearchParams(window.location.search).get('year');
  if (/^202[1-5]$/.test(year || '')) {
    window.location.assign('neet_pg_recall_quiz.html?year=' + encodeURIComponent(year));
  }
})();
