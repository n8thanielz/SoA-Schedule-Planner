var PlanTabs = (function () {

  var _year = null;

  // ── Term / year utilities ─────────────────────────────────────────────────

  function _termsOf(y) {
    var m = y && y.match(/^(\d{4})-(\d{2})$/);
    if (!m) return [];
    var a = parseInt(m[1]) % 100;
    var b = (a + 1) % 100;
    return ['FA' + _p2(a), 'SP' + _p2(b), 'SU' + _p2(b)];
  }

  function _p2(n) { return n < 10 ? '0' + n : String(n); }

  function _currentAY() {
    var d = new Date(), y = d.getFullYear();
    var start = d.getMonth() >= 7 ? y : y - 1;
    return start + '-' + _p2((start + 1) % 100);
  }

  function _defaultYear(plan) {
    var ay = _currentAY();
    if (plan.years && plan.years.indexOf(ay) !== -1) return ay;
    return (plan.years && plan.years.length) ? plan.years[plan.years.length - 1] : ay;
  }

  // ── Data helpers ──────────────────────────────────────────────────────────

  function _credit(plan, a) {
    if (a.credits != null) return a.credits;
    var c = _findId(plan.courses, a.courseId);
    return c ? (c.credits || 0) : 0;
  }

  function _loadOf(plan, facultyId, year) {
    var terms = _termsOf(year);
    return plan.assignments
      .filter(function (a) { return a.facultyId === facultyId && terms.indexOf(a.term) !== -1; })
      .reduce(function (s, a) { return s + _credit(plan, a); }, 0);
  }

  function _contractOf(fac, year) {
    if (!fac.contracts) return null;
    var v = fac.contracts[year];
    return (v == null) ? null : v;
  }

  function _cellAssignments(plan, courseId, term) {
    return plan.assignments.filter(function (a) {
      return a.courseId === courseId && a.term === term;
    });
  }

  function _need(plan, courseId, term) {
    return (plan.needs && plan.needs[courseId] && plan.needs[courseId][term]) || 0;
  }

  function _visibleCourses(plan, year) {
    var terms = _termsOf(year);
    return plan.courses.filter(function (c) {
      if (!c.active) return false;
      var hasNeed = terms.some(function (t) { return _need(plan, c.id, t) > 0; });
      var hasAsg  = plan.assignments.some(function (a) {
        return a.courseId === c.id && terms.indexOf(a.term) !== -1;
      });
      return hasNeed || hasAsg;
    });
  }

  // ── Assignments tab ───────────────────────────────────────────────────────

  function renderAssignments(plan) {
    _renderYearNav(plan);
    _renderSummaryCards(plan);
    _renderCoverageGrid(plan);
    _renderFacultyLoadPanel(plan);
  }

  function _renderYearNav(plan) {
    var el = document.getElementById('plan-year-nav');
    if (!el) return;
    var years = plan.years || [];
    var idx   = years.indexOf(_year);

    var html = '<div class="pyn-inner">';
    html += '<button class="pyn-btn" id="pyn-prev"' + (idx <= 0 ? ' disabled' : '') + '>&#8592;</button>';
    html += '<select class="pyn-select" id="pyn-select">';
    years.forEach(function (y) {
      html += '<option value="' + y + '"' + (y === _year ? ' selected' : '') + '>' + y + '</option>';
    });
    html += '</select>';
    html += '<button class="pyn-btn" id="pyn-next"' + (idx >= years.length - 1 ? ' disabled' : '') + '>&#8594;</button>';
    html += '</div>';
    el.innerHTML = html;

    document.getElementById('pyn-prev').addEventListener('click', function () {
      var i = (plan.years || []).indexOf(_year);
      if (i > 0) { _year = plan.years[i - 1]; renderAssignments(plan); }
    });
    document.getElementById('pyn-next').addEventListener('click', function () {
      var i = (plan.years || []).indexOf(_year);
      if (i < plan.years.length - 1) { _year = plan.years[i + 1]; renderAssignments(plan); }
    });
    document.getElementById('pyn-select').addEventListener('change', function () {
      _year = this.value; renderAssignments(plan);
    });
  }

  function _renderSummaryCards(plan) {
    var el = document.getElementById('plan-summary-cards');
    if (!el) return;
    var terms = _termsOf(_year);

    var totalNeeds = 0, totalCovered = 0, creditsNeeded = 0, contractTotal = 0;

    plan.courses.forEach(function (c) {
      if (!c.active || !c.assignable) return;
      terms.forEach(function (t) {
        var n = _need(plan, c.id, t);
        var a = _cellAssignments(plan, c.id, t).length;
        totalNeeds   += n;
        totalCovered += Math.min(a, n);
        creditsNeeded += n * (c.credits || 3);
      });
    });

    plan.faculty.forEach(function (f) {
      if (f.active && f.contracts && f.contracts[_year]) {
        contractTotal += f.contracts[_year];
      }
    });

    var open = totalNeeds - totalCovered;
    var gap  = creditsNeeded - contractTotal;

    el.innerHTML =
      _card(String(totalNeeds),    'Sections planned',   open > 0 ? open + ' open' : 'All covered',  open > 0 ? 'problem' : 'ok') +
      _card(String(creditsNeeded), 'Credit hours needed', '',                                         '') +
      _card(String(contractTotal), 'Contract hours',      '',                                         '') +
      _card((gap > 0 ? '+' : '') + gap, 'Hour gap',
        gap > 0 ? 'Shortage' : gap < 0 ? 'Surplus' : 'Balanced',
        gap > 0 ? 'problem' : gap < 0 ? 'ok' : '');
  }

  function _card(value, label, sub, state) {
    return '<div class="psc-card' + (state ? ' psc-card--' + state : '') + '">' +
      '<div class="psc-value">' + value + '</div>' +
      '<div class="psc-label">' + label + '</div>' +
      (sub ? '<div class="psc-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function _renderCoverageGrid(plan) {
    var el = document.getElementById('plan-coverage-grid');
    if (!el) return;
    var terms   = _termsOf(_year);
    var courses = _visibleCourses(plan, _year);

    // Group by category
    var groups = {}, order = [];
    courses.forEach(function (c) {
      var cat = c.category || 'OTHER';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(c);
    });

    // Pre-compute faculty loads for this year (avoid recalculating per chip)
    var loadCache = {};
    plan.faculty.forEach(function (f) {
      loadCache[f.id] = _loadOf(plan, f.id, _year);
    });

    var html = '<table class="pcg-table"><thead><tr>';
    html += '<th class="pcg-course-col">Course</th>';
    terms.forEach(function (t, idx) {
      html += '<th class="pcg-term-col pcg-col-' + idx + '">' + PlanData.semesterLabel(t) + '</th>';
    });
    html += '</tr></thead><tbody>';

    order.forEach(function (cat) {
      html += '<tr class="pcg-group-row"><td colspan="' + (terms.length + 1) + '">' + cat + '</td></tr>';
      groups[cat].forEach(function (course) {
        html += '<tr class="pcg-course-row">';
        html += '<td class="pcg-course-name" title="' + _esc(course.title) + '">' + course.code + '</td>';
        terms.forEach(function (term, idx) {
          var asgList = _cellAssignments(plan, course.id, term);
          var n       = _need(plan, course.id, term);
          var open    = Math.max(0, n - asgList.length);
          html += '<td class="pcg-cell pcg-col-' + idx + '"><div class="pcg-chips">';
          asgList.forEach(function (a, i) {
            var fac      = _findId(plan.faculty, a.facultyId);
            var name     = fac ? _shortName(fac.name) : '?';
            var inactive = fac && !fac.active;
            var over     = i >= n;
            var con      = fac ? _contractOf(fac, _year) : null;
            var overload = con != null && con > 0 && loadCache[a.facultyId] > con;
            var cls = inactive ? 'pcg-chip--inactive' : over ? 'pcg-chip--over' : overload ? 'pcg-chip--overload' : 'pcg-chip--ok';
            html += '<span class="pcg-chip ' + cls + '" title="' + _esc(fac ? fac.name : '') + '">' + name + '</span>';
          });
          for (var i = 0; i < open; i++) {
            html += '<span class="pcg-chip pcg-chip--open">Open</span>';
          }
          if (!n && !asgList.length) html += '<span class="pcg-cell-dash">&mdash;</span>';
          html += '</div></td>';
        });
        html += '</tr>';
      });
    });

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function _renderFacultyLoadPanel(plan) {
    var el = document.getElementById('plan-faculty-load');
    if (!el) return;
    var active = plan.faculty.filter(function (f) { return f.active; });

    var html = '<div class="pfl-title">Faculty Load &mdash; ' + _year + '</div>';
    active.forEach(function (f) {
      var load     = _loadOf(plan, f.id, _year);
      var contract = _contractOf(f, _year);
      var pct      = contract ? Math.min(100, Math.round(load / contract * 100)) : (load ? 100 : 0);
      var over     = contract != null && contract > 0 && load > contract;
      var nocon    = contract == null || contract === 0;
      var statusCls = over ? 'pfl-nums--over' : nocon ? 'pfl-nums--nocon' : load < (contract || 0) ? 'pfl-nums--under' : 'pfl-nums--ok';

      html += '<div class="pfl-row">';
      html += '<div class="pfl-name">' + _esc(_shortName(f.name)) + '</div>';
      html += '<div class="pfl-bar-wrap"><div class="pfl-bar' + (over ? ' pfl-bar--over' : '') + '" style="width:' + pct + '%"></div></div>';
      html += '<div class="pfl-nums ' + statusCls + '">' + load + (contract != null ? '/' + contract : '') + '</div>';
      html += '</div>';
    });

    el.innerHTML = html;
  }

  // ── Faculty tab ───────────────────────────────────────────────────────────

  function renderFaculty(plan) {
    var el = document.getElementById('plan-faculty-table');
    if (!el) return;
    var years = plan.years || [];

    var html = '<table class="pft-table"><thead><tr><th>Name</th><th>Track</th>';
    years.forEach(function (y) {
      html += '<th>' + y + '</th>';
    });
    html += '</tr></thead><tbody>';

    plan.faculty
      .filter(function (f) { return f.active; })
      .forEach(function (f) {
        html += '<tr><td>' + _esc(f.name) + '</td>';
        html += '<td>' + _esc(f.track || '—') + '</td>';
        years.forEach(function (y) {
          var con  = _contractOf(f, y);
          var load = _loadOf(plan, f.id, y);
          var over = con != null && con > 0 && load > con;
          var under = con != null && con > 0 && load < con;
          var cls  = over ? ' class="pft-over"' : under ? ' class="pft-under"' : '';
          html += '<td' + cls + '>' + load + (con != null ? '/' + con : '') + '</td>';
        });
        html += '</tr>';
      });

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ── Courses tab ───────────────────────────────────────────────────────────

  function renderCourses(plan) {
    var el = document.getElementById('plan-courses-table');
    if (!el) return;

    var html = '<table class="pct-table"><thead><tr>';
    html += '<th>Code</th><th>Title</th><th>Credits</th><th>Category</th><th>Total sections assigned</th>';
    html += '</tr></thead><tbody>';

    plan.courses.forEach(function (c) {
      var count = plan.assignments.filter(function (a) { return a.courseId === c.id; }).length;
      html += '<tr' + (c.active ? '' : ' class="pct-inactive"') + '>';
      html += '<td>' + _esc(c.code) + '</td>';
      html += '<td>' + _esc(c.title) + '</td>';
      html += '<td>' + (c.credits != null ? c.credits : '—') + '</td>';
      html += '<td>' + _esc(c.category || '—') + '</td>';
      html += '<td>' + count + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ── Checks tab ────────────────────────────────────────────────────────────

  function renderChecks(plan) {
    var el = document.getElementById('plan-checks-content');
    if (!el) return;
    var checks = _computeChecks(plan);

    var html = '';

    if (checks.problems > 0) {
      html += '<div class="pch-group">';
      html += '<div class="pch-label pch-label--problem">Problems (' + checks.problems + ')</div>';
      html += '<ul class="pch-list">';
      checks.open.forEach(function (x) {
        html += '<li>' + x.n + ' open section' + (x.n > 1 ? 's' : '') + ': ' +
          _esc(x.c.code) + ' &mdash; ' + PlanData.semesterLabel(x.t) + '</li>';
      });
      checks.over.forEach(function (x) {
        html += '<li>Over-planned by ' + x.n + ': ' + _esc(x.c.code) +
          ' &mdash; ' + PlanData.semesterLabel(x.t) + ' (plan: ' + x.planned + ')</li>';
      });
      checks.inactive.forEach(function (x) {
        if (x.kind === 'fac') {
          html += '<li>Inactive instructor has assignments: ' + _esc(x.f.name) + '</li>';
        } else {
          html += '<li>Inactive course has assignments: ' + _esc(x.c.code) + '</li>';
        }
      });
      html += '</ul></div>';
    }

    var infoCount = checks.overload.length + checks.under.length + checks.nocontract.length + checks.override.length;
    if (infoCount > 0) {
      html += '<div class="pch-group">';
      html += '<div class="pch-label pch-label--info">Info (' + infoCount + ')</div>';
      html += '<ul class="pch-list">';
      checks.overload.forEach(function (x) {
        html += '<li>Overload: ' + _esc(x.f.name) + ' (' + x.ld + '/' + x.con + ' credits)</li>';
      });
      checks.under.forEach(function (x) {
        html += '<li>Under contract: ' + _esc(x.f.name) + ' (' + x.ld + '/' + x.con + ' credits)</li>';
      });
      checks.nocontract.forEach(function (x) {
        html += '<li>Teaching with no contract entered: ' + _esc(x.f.name) + ' (' + x.ld + ' credits)</li>';
      });
      checks.override.forEach(function (x) {
        html += '<li>Custom credits on non-variable course: ' + _esc(x.f ? x.f.name : '?') +
          ' &rarr; ' + _esc(x.c ? x.c.code : '?') + ' (' + x.a.credits + ' cr)</li>';
      });
      html += '</ul></div>';
    }

    if (!checks.problems && !infoCount) {
      html = '<div class="pch-empty">No issues found for ' + _year + '.</div>';
    }

    el.innerHTML = html;

    // Update badge on tab button
    var badge = document.getElementById('plan-checks-badge');
    if (badge) {
      if (checks.problems > 0) {
        badge.textContent = String(checks.problems);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  function _computeChecks(plan) {
    var terms   = _termsOf(_year);
    var courses = _visibleCourses(plan, _year);
    var out = { open: [], over: [], overload: [], under: [], nocontract: [], inactive: [], override: [], problems: 0 };

    courses.forEach(function (c) {
      terms.forEach(function (t) {
        var n = _need(plan, c.id, t);
        var a = _cellAssignments(plan, c.id, t).length;
        if (n > a) out.open.push({ c: c, t: t, n: n - a });
        if (a > n) out.over.push({ c: c, t: t, n: a - n, planned: n });
      });
    });

    var activeFacIds = new Set(
      plan.assignments
        .filter(function (a) { return terms.indexOf(a.term) !== -1; })
        .map(function (a) { return a.facultyId; })
    );

    plan.faculty.forEach(function (f) {
      var ld  = _loadOf(plan, f.id, _year);
      var con = _contractOf(f, _year);
      if (con != null && ld > con)               out.overload.push({ f: f, ld: ld, con: con });
      else if (con != null && con > 0 && ld < con && f.active) out.under.push({ f: f, ld: ld, con: con });
      if (con == null && activeFacIds.has(f.id)) out.nocontract.push({ f: f, ld: ld });
      if (!f.active && activeFacIds.has(f.id))  out.inactive.push({ kind: 'fac', f: f });
    });

    var seenInactive = {};
    plan.assignments
      .filter(function (a) { return terms.indexOf(a.term) !== -1; })
      .forEach(function (a) {
        var c = _findId(plan.courses, a.courseId);
        if (c && !c.active && !seenInactive[c.id]) {
          seenInactive[c.id] = true;
          out.inactive.push({ kind: 'course', c: c });
        }
        if (a.credits != null && c && !c.variable) {
          out.override.push({ a: a, c: c, f: _findId(plan.faculty, a.facultyId) });
        }
      });

    out.problems = out.open.length + out.over.length + out.inactive.length;
    return out;
  }

  // ── Private utilities ─────────────────────────────────────────────────────

  function _findId(arr, id) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }

  // "Zwart, Nathaniel" → "Zwart, N."
  function _shortName(name) {
    if (!name) return '?';
    var parts = name.split(',');
    if (parts.length >= 2) return parts[0].trim() + ', ' + parts[1].trim().charAt(0) + '.';
    return name.split(' ')[0] || name;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    init: function (plan) {
      _year = _defaultYear(plan);
    },
    getYear:           function () { return _year; },
    setYear:           function (y) { _year = y; },
    renderAssignments: renderAssignments,
    renderFaculty:     renderFaculty,
    renderCourses:     renderCourses,
    renderChecks:      renderChecks
  };

})();
