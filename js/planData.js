var PlanData = (function () {

  var CURRENT_VERSION = 3;

  // ── Term utilities ────────────────────────────────────────────────────────

  // "Spring 2027 ACCOUNTING All Class Schedule" → "SP27"
  // "Fall 2026 ..." → "FA26"   "Summer 2027 ..." → "SU27"
  function termCode(semesterStr) {
    if (!semesterStr) return null;
    var m = semesterStr.match(/\b(Spring|Fall|Summer)\s+(\d{4})\b/i);
    if (!m) return null;
    var season = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    var yy = String(parseInt(m[2])).slice(2);
    var prefix = season === 'Spring' ? 'SP' : season === 'Fall' ? 'FA' : 'SU';
    return prefix + yy;
  }

  // "SP27" → "Spring 2027"   "FA26" → "Fall 2026"   "SU27" → "Summer 2027"
  function semesterLabel(term) {
    var m = term && term.match(/^(FA|SP|SU)(\d{2})$/);
    if (!m) return term || '';
    var season = m[1] === 'FA' ? 'Fall' : m[1] === 'SP' ? 'Spring' : 'Summer';
    return season + ' ' + (2000 + parseInt(m[2]));
  }

  // "SP27" → "2026-27"   "FA26" → "2026-27"   "SU27" → "2026-27"
  function yearForTerm(term) {
    var m = term && term.match(/^(FA|SP|SU)(\d{2})$/);
    if (!m) return '';
    var yy = parseInt(m[2]);
    var year = 2000 + yy;
    // Fall starts an AY; Spring/Summer close one
    return m[1] === 'FA'
      ? year + '-' + String(year + 1).slice(2)
      : (year - 1) + '-' + String(year).slice(2);
  }

  // ── Schema migration ──────────────────────────────────────────────────────

  function migrate(raw) {
    var plan = JSON.parse(JSON.stringify(raw));

    // Normalise very old formats that predate versioning
    if (!plan.version) plan.version = 1;

    // v1 → v2: ensure required arrays exist
    if (plan.version < 2) {
      plan.courses     = plan.courses     || [];
      plan.faculty     = plan.faculty     || [];
      plan.needs       = plan.needs       || {};
      plan.assignments = plan.assignments || [];
      plan.years       = plan.years       || [];
      plan.version = 2;
    }

    // v2 → v3: add termMeta; schedule fields on assignments are optional and
    // added only during CSV reconciliation, so no structural changes needed.
    if (plan.version === 2) {
      plan.termMeta = plan.termMeta || {};
      plan.version = 3;
    }

    return plan;
  }

  function createEmpty() {
    return {
      version:     CURRENT_VERSION,
      years:       [],
      courses:     [],
      faculty:     [],
      needs:       {},
      assignments: [],
      termMeta:    {}
    };
  }

  // ── Lookup helpers ────────────────────────────────────────────────────────

  // Find course by code string, e.g. "ACCTG 2100". Returns first active match.
  function findCourseByCode(plan, code) {
    if (!code) return null;
    var norm = code.trim().toUpperCase();
    // Prefer active exact match first, then any exact match
    var found = null;
    for (var i = 0; i < plan.courses.length; i++) {
      var c = plan.courses[i];
      if (c.code && c.code.trim().toUpperCase() === norm) {
        if (c.active) return c;
        if (!found) found = c;
      }
    }
    return found;
  }

  // Find faculty by exact name string, e.g. "Smith, John".
  function findFacultyByName(plan, name) {
    if (!name) return null;
    var norm = name.trim().toLowerCase();
    for (var i = 0; i < plan.faculty.length; i++) {
      if (plan.faculty[i].name && plan.faculty[i].name.trim().toLowerCase() === norm) {
        return plan.faculty[i];
      }
    }
    return null;
  }

  // ── Conversion: assignment → section ─────────────────────────────────────

  // Converts a plan assignment (with optional schedule fields) into the section
  // object shape the Schedule Editor's render/edit pipeline expects.
  function assignmentToSection(plan, assignment) {
    var course  = _findById(plan.courses,  assignment.courseId)  || {};
    var faculty = _findById(plan.faculty,  assignment.facultyId) || {};
    var secNum  = assignment.sectionNumber || '';

    return {
      id:             (course.code || assignment.courseId) + (secNum ? '-' + secNum : ''),
      courseNumber:   course.code  || assignment.courseId || '',
      courseName:     course.title || '',
      sectionNumber:  secNum,
      type:           assignment.type     || 'LEC',
      instructor:     faculty.name        || '',
      room:           assignment.room     || '',
      roomCapRequest: assignment.roomCapRequest || 0,
      days:           assignment.days     || [],
      startTime:      assignment.startTime || '',
      endTime:        assignment.endTime   || '',
      session:        assignment.session   || 'Regular Academic Session',
      dateRange:      assignment.dateRange || null,
      iCalStart:      assignment.iCalStart || null,
      iCalEnd:        assignment.iCalEnd   || null,
      notes:          assignment.deliveryMethod || '',
      isOnline:       !!assignment.isOnline,
      doesNotMeet:    !!assignment.doesNotMeet,
      // back-reference so edits can propagate to the plan
      _planAssignmentId:  assignment.id,
      // runtime-only fields (not persisted)
      _instructorConflict: false,
      _roomConflict:       false,
      _deleted:            false,
      _modified:           false,
      _isNew:              false,
      _original:           null,
      _rowIndex:           -1,
      _multiSession:       false
    };
  }

  // Converts all assignments for a term into a loadedSchedule object compatible
  // with the Schedule Editor's renderAll / exporters.
  function termToSchedule(plan, term) {
    var assignments = assignmentsForTerm(plan, term);
    var sections    = assignments.map(function (a) { return assignmentToSection(plan, a); });
    var meta        = (plan.termMeta && plan.termMeta[term]) || {};
    var label       = meta.label || semesterLabel(term);

    // Infer dept prefix from first active course code
    var dept = '';
    if (plan.courses && plan.courses.length) {
      var first = plan.courses.find(function (c) { return c.active && c.code; });
      if (first) dept = first.code.split(' ')[0];
    }

    return {
      semester:   label,
      semPrefix:  semesterLabel(term),
      dept:       dept,
      sections:   sections,
      _term:      term,
      _fromPlan:  true,
      _rawRows:   [],
      _colMap:    {}
    };
  }

  // ── CSV reconciliation ────────────────────────────────────────────────────

  // Matches parsed CSV sections against existing plan assignments for the given
  // term. Mutates plan assignments in-place to add schedule fields.
  //
  // Returns:
  //   matched      — assignments that were updated with schedule data
  //   newSections  — CSV sections with no matching plan assignment
  //   unscheduled  — plan assignments with no matching CSV section
  function reconcileCsv(plan, parsedSections, term) {
    var results = { matched: [], newSections: [], unscheduled: [] };

    var termAssignments = assignmentsForTerm(plan, term);

    // Group plan assignments by "courseId|facultyId" so multiple sections of
    // the same course by the same person are matched in order.
    var groups = {};
    termAssignments.forEach(function (a) {
      var key = a.courseId + '|' + a.facultyId;
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });

    parsedSections.forEach(function (section) {
      var courseObj  = findCourseByCode(plan, section.courseNumber);
      var facultyObj = section.instructor ? findFacultyByName(plan, section.instructor) : null;

      if (!courseObj || !facultyObj) {
        results.newSections.push(section);
        return;
      }

      var key   = courseObj.id + '|' + facultyObj.id;
      var group = groups[key];

      if (!group || !group.length) {
        results.newSections.push(section);
        return;
      }

      // Take the next unmatched assignment for this course+faculty combo
      var match = group.shift();
      _fillScheduleFields(match, section);
      results.matched.push(match);
    });

    // Remaining entries in groups have no CSV row — they are planned but unscheduled
    Object.keys(groups).forEach(function (key) {
      groups[key].forEach(function (a) { results.unscheduled.push(a); });
    });

    return results;
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  function assignmentsForTerm(plan, term) {
    return plan.assignments.filter(function (a) { return a.term === term; });
  }

  function scheduledAssignments(plan, term) {
    return assignmentsForTerm(plan, term).filter(function (a) {
      return a.days && a.days.length > 0 && a.startTime;
    });
  }

  // Returns every term that appears in assignments (sorted chronologically)
  function allTerms(plan) {
    var seen = {};
    plan.assignments.forEach(function (a) { seen[a.term] = true; });
    return Object.keys(seen).sort(_termSort);
  }

  // Returns terms that have at least one scheduled assignment
  function scheduledTerms(plan) {
    return allTerms(plan).filter(function (t) {
      return scheduledAssignments(plan, t).length > 0;
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  function _findById(arr, id) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }

  function _fillScheduleFields(assignment, section) {
    assignment.sectionNumber  = section.sectionNumber  || '';
    assignment.type           = section.type           || 'LEC';
    assignment.room           = section.room           || '';
    assignment.roomCapRequest = section.roomCapRequest || 0;
    assignment.days           = section.days           || [];
    assignment.startTime      = section.startTime      || '';
    assignment.endTime        = section.endTime        || '';
    assignment.session        = section.session        || 'Regular Academic Session';
    assignment.dateRange      = section.dateRange      || null;
    assignment.iCalStart      = section.iCalStart      || null;
    assignment.iCalEnd        = section.iCalEnd        || null;
    assignment.deliveryMethod = section.notes          || 'In Person';
    assignment.isOnline       = !!section.isOnline;
    assignment.doesNotMeet    = !!section.doesNotMeet;
  }

  // Chronological sort for term codes: FA < SP < SU within a year
  function _termSort(a, b) {
    var order = { FA: 0, SP: 1, SU: 2 };
    var ma = a.match(/^(FA|SP|SU)(\d{2})$/);
    var mb = b.match(/^(FA|SP|SU)(\d{2})$/);
    if (!ma || !mb) return 0;
    var yearDiff = parseInt(ma[2]) - parseInt(mb[2]);
    if (yearDiff !== 0) return yearDiff;
    return (order[ma[1]] || 0) - (order[mb[1]] || 0);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    CURRENT_VERSION:   CURRENT_VERSION,
    termCode:          termCode,
    semesterLabel:     semesterLabel,
    yearForTerm:       yearForTerm,
    migrate:           migrate,
    createEmpty:       createEmpty,
    findCourseByCode:  findCourseByCode,
    findFacultyByName: findFacultyByName,
    assignmentToSection: assignmentToSection,
    termToSchedule:    termToSchedule,
    reconcileCsv:      reconcileCsv,
    assignmentsForTerm: assignmentsForTerm,
    scheduledAssignments: scheduledAssignments,
    allTerms:          allTerms,
    scheduledTerms:    scheduledTerms
  };

})();
