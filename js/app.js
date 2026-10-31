var uploadView    = document.getElementById('upload-view');
var scheduleView  = document.getElementById('schedule-view');
var pdfInput      = document.getElementById('pdf-input');
var addFileInput  = document.getElementById('add-file-input');
var addFileBtn    = document.getElementById('add-file-btn');
var uploadError   = document.getElementById('upload-error');
var uploadLoading = document.getElementById('upload-loading');
var scheduleTitle = document.getElementById('schedule-title');
var scheduleGrid  = document.getElementById('schedule-grid');
var courseSidebar = document.getElementById('course-sidebar');
var onlinePanel   = document.getElementById('online-panel');
var newUploadBtn      = document.getElementById('new-upload-btn');
var toggleOnlineBtn   = document.getElementById('toggle-online-btn');
var calendarBtn       = document.getElementById('calendar-btn');
var editModeBtn       = document.getElementById('edit-mode-btn');
var exportCsvBtn      = document.getElementById('export-csv-btn');
var exportXlsxBtn     = document.getElementById('export-xlsx-btn');
var addSectionBtn     = document.getElementById('add-section-btn');
var icalModal         = document.getElementById('ical-modal');
var icalModalBody     = document.getElementById('ical-modal-body');
var icalModalConfirm  = document.getElementById('ical-modal-confirm');
var icalModalCancel   = document.getElementById('ical-modal-cancel');
var exportNameModal   = document.getElementById('export-name-modal');
var exportNameInput   = document.getElementById('export-name-input');
var exportNameExt     = document.getElementById('export-name-ext');
var exportNameTitle   = document.getElementById('export-name-title');
var exportNameConfirm = document.getElementById('export-name-confirm');
var exportNameCancel  = document.getElementById('export-name-cancel');
var conflictModal        = document.getElementById('conflict-modal');
var conflictModalBody    = document.getElementById('conflict-modal-body');
var conflictModalConfirm = document.getElementById('conflict-modal-confirm');
var conflictModalCancel  = document.getElementById('conflict-modal-cancel');

var loadedSchedules    = [];
var _customTitle       = null;
var _conflictPairs     = [];
var _roomConflictPairs = [];
var _activePlan        = null;
var _activeTab         = 'schedule';
var _planTabsInited    = false;

// Bridge functions for editor modules
ScheduleApp.getLoadedSchedules    = function() { return loadedSchedules; };
ScheduleApp.getActivePlan         = function() { return _activePlan; };
ScheduleApp.triggerRenderAll      = function() { renderAll(); };
ScheduleApp.showExportNamePrompt  = function(title, defaultName, ext, cb) { _showExportNamePrompt(title, defaultName, ext, cb); };
ScheduleApp.defaultExportPrefix   = function() { return _defaultExportPrefix(); };

function buildTitle() {
  if (_customTitle) return _customTitle;
  if (!loadedSchedules.length) return 'Schedule';
  if (loadedSchedules.length === 1) return loadedSchedules[0].semester;
  var prefix = loadedSchedules[0].semPrefix ? loadedSchedules[0].semPrefix + ' ' : '';
  var depts = [];
  for (var i = 0; i < loadedSchedules.length; i++) {
    var d = loadedSchedules[i].dept;
    if (d && depts.indexOf(d) === -1) depts.push(d);
  }
  return depts.length ? prefix + depts.join(' + ') + ' Schedule' : 'Combined Schedule';
}

function _halfSemesterExcludes(a, b) {
  return (a.session === '1st Half' && b.session === '2nd Half') ||
         (a.session === '2nd Half' && b.session === '1st Half');
}

function _markInstructorConflicts() {
  _conflictPairs = [];
  var checkable = [];
  loadedSchedules.forEach(function(sch) {
    sch.sections.forEach(function(s) {
      s._instructorConflict = false;
      if (!s._deleted && s.days.length && s.startTime && s.endTime &&
          s.instructor && s.instructor !== 'Staff') {
        checkable.push(s);
      }
    });
  });
  for (var i = 0; i < checkable.length; i++) {
    for (var j = i + 1; j < checkable.length; j++) {
      var a = checkable[i], b = checkable[j];
      if (a.instructor !== b.instructor) continue;
      var sharedDay = a.days.some(function(d) { return b.days.indexOf(d) !== -1; });
      if (!sharedDay) continue;
      if (_halfSemesterExcludes(a, b)) continue;
      var aStart = ScheduleApp.timeToMinutes(a.startTime);
      var aEnd   = ScheduleApp.timeToMinutes(a.endTime);
      var bStart = ScheduleApp.timeToMinutes(b.startTime);
      var bEnd   = ScheduleApp.timeToMinutes(b.endTime);
      var dateRangesOverlap = true;
      if (a.iCalStart && a.iCalEnd && b.iCalStart && b.iCalEnd) {
        dateRangesOverlap = parseInt(a.iCalStart) <= parseInt(b.iCalEnd) &&
                            parseInt(a.iCalEnd)   >= parseInt(b.iCalStart);
      }
      if (aStart < bEnd && aEnd > bStart && dateRangesOverlap) {
        a._instructorConflict = true;
        b._instructorConflict = true;
        _conflictPairs.push({ a: a, b: b });
      }
    }
  }
}

function _markRoomConflicts() {
  _roomConflictPairs = [];
  var checkable = [];
  loadedSchedules.forEach(function(sch) {
    sch.sections.forEach(function(s) {
      s._roomConflict = false;
      if (!s._deleted && s.days.length && s.startTime && s.endTime &&
          s.room && !/^(ONLINE|CANVAS)$/i.test(s.room) && !/^Request/i.test(s.room) &&
          /\d/.test(s.room)) {
        checkable.push(s);
      }
    });
  });
  for (var i = 0; i < checkable.length; i++) {
    for (var j = i + 1; j < checkable.length; j++) {
      var a = checkable[i], b = checkable[j];
      if (a.room.toLowerCase() !== b.room.toLowerCase()) continue;
      var sharedDay = a.days.some(function(d) { return b.days.indexOf(d) !== -1; });
      if (!sharedDay) continue;
      if (_halfSemesterExcludes(a, b)) continue;
      var aStart = ScheduleApp.timeToMinutes(a.startTime);
      var aEnd   = ScheduleApp.timeToMinutes(a.endTime);
      var bStart = ScheduleApp.timeToMinutes(b.startTime);
      var bEnd   = ScheduleApp.timeToMinutes(b.endTime);
      var dateRangesOverlap = true;
      if (a.iCalStart && a.iCalEnd && b.iCalStart && b.iCalEnd) {
        dateRangesOverlap = parseInt(a.iCalStart) <= parseInt(b.iCalEnd) &&
                            parseInt(a.iCalEnd)   >= parseInt(b.iCalStart);
      }
      if (aStart < bEnd && aEnd > bStart && dateRangesOverlap) {
        a._roomConflict = true;
        b._roomConflict = true;
        _roomConflictPairs.push({ a: a, b: b });
      }
    }
  }
}

function _showConflictWarning(callback) {
  if (!_conflictPairs.length && !_roomConflictPairs.length) { callback(); return; }

  function pairRow(a, b, label) {
    var shared = a.days.filter(function(d) { return b.days.indexOf(d) !== -1; }).join('/');
    return '<li><strong>' + label + '</strong>: ' +
      a.courseNumber + '-' + a.sectionNumber +
      ' (' + ScheduleApp.formatTime(a.startTime) + '–' + ScheduleApp.formatTime(a.endTime) + ')' +
      ' &amp; ' +
      b.courseNumber + '-' + b.sectionNumber +
      ' (' + ScheduleApp.formatTime(b.startTime) + '–' + ScheduleApp.formatTime(b.endTime) + ')' +
      ' on ' + shared + '</li>';
  }

  var html = '<p>The following conflicts were detected. Resolve before exporting or proceed anyway.</p>';

  if (_conflictPairs.length) {
    html += '<p class="conflict-section-label">Instructor Conflicts</p><ul class="conflict-list">';
    _conflictPairs.forEach(function(pair) {
      html += pairRow(pair.a, pair.b, pair.a.instructor);
    });
    html += '</ul>';
  }

  if (_roomConflictPairs.length) {
    html += '<p class="conflict-section-label">Room Conflicts</p><ul class="conflict-list">';
    _roomConflictPairs.forEach(function(pair) {
      html += pairRow(pair.a, pair.b, pair.a.room);
    });
    html += '</ul>';
  }

  conflictModalBody.innerHTML = html;
  conflictModal._callback = callback;
  conflictModal.classList.remove('hidden');
}

function mergeSchedules() {
  var allSections = [];
  for (var i = 0; i < loadedSchedules.length; i++) {
    allSections = allSections.concat(loadedSchedules[i].sections.filter(function(s) { return !s._deleted; }));
  }
  return { semester: buildTitle(), sections: allSections };
}

function renderAll() {
  _markInstructorConflicts();
  _markRoomConflicts();
  var merged = mergeSchedules();
  scheduleTitle.textContent = merged.semester;
  ScheduleApp.renderSchedule(scheduleGrid, merged);

  // Apply persisted hide-online preference before the panel renders so it
  // picks up wasUserHidden correctly inside renderOnlinePanel.
  try { if (localStorage.getItem('sv_hide_online') === '1') onlinePanel.dataset.userHidden = 'true'; } catch(e) {}

  ScheduleApp.renderOnlinePanel(onlinePanel, merged);
  ScheduleApp.renderSidebar(courseSidebar, merged, loadedSchedules, removeFile);
  ScheduleApp.attachEditorBlockListeners();

  if (_activePlan) {
    PlanTabs.renderScheduleLoadPanel(_activePlan);
  } else {
    var slp = document.getElementById('schedule-load-panel');
    if (slp) slp.classList.add('hidden');
  }

  // Sync toolbar button with actual panel state after render
  var isHidden = onlinePanel.dataset.userHidden === 'true';
  toggleOnlineBtn.textContent = isHidden ? 'Show Online' : 'Hide Online';
  toggleOnlineBtn.classList.toggle('active', isHidden);
}

function removeFile(index) {
  loadedSchedules.splice(index, 1);
  if (!loadedSchedules.length) {
    scheduleView.classList.add('hidden');
    uploadView.classList.remove('hidden');
    scheduleGrid.innerHTML = '';
    onlinePanel.innerHTML  = '';
    courseSidebar.innerHTML = '';
    addFileBtn.classList.add('hidden');
    return;
  }
  renderAll();
}

async function loadFile(file) {
  var schedule = await ScheduleApp.parseCSV(file);

  if (_activePlan) {
    var term = PlanData.termCode(schedule.semester);
    if (term) {
      var results = PlanData.reconcileCsv(_activePlan, schedule.sections, term);

      // Record import metadata in the plan
      _activePlan.termMeta = _activePlan.termMeta || {};
      _activePlan.termMeta[term] = {
        label:          schedule.semester,
        csvImportedOn:  new Date().toISOString().slice(0, 10)
      };

      // Build a schedule object from the now-populated plan assignments
      var reconciledSchedule = PlanData.termToSchedule(_activePlan, term);

      // Append CSV rows that had no matching plan assignment as new sections
      results.newSections.forEach(function(s) { s._isNew = true; });
      reconciledSchedule.sections = reconciledSchedule.sections.concat(results.newSections);

      var fi = loadedSchedules.length;
      reconciledSchedule.sections.forEach(function(s) { s._fileIndex = fi; });
      loadedSchedules.push(reconciledSchedule);

      if (results.staffMatched.length || results.newSections.length || results.unscheduled.length) {
        _showReconcileNotice(results, term);
      }
      return;
    }
  }

  // No plan loaded — standard CSV path
  var fi = loadedSchedules.length;
  schedule.sections.forEach(function(s) { s._fileIndex = fi; });
  loadedSchedules.push(schedule);
}

function _showReconcileNotice(results, term) {
  var parts = [];
  var label = PlanData.semesterLabel(term);

  if (results.staffMatched.length) {
    var n = results.staffMatched.length;
    parts.push(n + ' section' + (n !== 1 ? 's' : '') +
      ' showed Staff in CLSS but have a plan assignment — plan instructor shown');
  }

  var notInPlan = results.newSections.filter(function(s) { return s._planStatus === 'not-in-plan'; });
  if (notInPlan.length) {
    var n = notInPlan.length;
    parts.push(n + ' section' + (n !== 1 ? 's' : '') +
      ' in the CSV have an instructor not in the plan — shown as-is');
  }

  var open = results.newSections.filter(function(s) { return s._planStatus === 'open'; });
  if (open.length) {
    var n = open.length;
    parts.push(n + ' open section' + (n !== 1 ? 's' : '') +
      ' in CLSS have no plan assignment');
  }

  if (results.unscheduled.length) {
    var n = results.unscheduled.length;
    parts.push(n + ' planned section' + (n !== 1 ? 's' : '') +
      ' in ' + label + ' have no matching CLSS entry — see Checks tab');
  }

  if (parts.length) console.info('[Reconciliation — ' + label + '] ' + parts.join('; ') + '.');
}

pdfInput.addEventListener('change', async function(e) {
  var file = e.target.files[0];
  if (!file) return;

  uploadError.classList.add('hidden');
  uploadLoading.classList.remove('hidden');
  pdfInput.disabled = true;

  try {
    loadedSchedules = [];
    var files = e.target.files;
    for (var i = 0; i < files.length; i++) {
      await loadFile(files[i]);
    }
    renderAll();
    uploadView.classList.add('hidden');
    scheduleView.classList.remove('hidden');
    addFileBtn.classList.remove('hidden');
    if (_activePlan) {
      planTabBar.classList.remove('hidden');
      switchTab('schedule');
    }
  } catch (err) {
    console.error(err);
    uploadError.textContent = 'Could not parse file: ' + err.message;
    uploadError.classList.remove('hidden');
  } finally {
    uploadLoading.classList.add('hidden');
    pdfInput.disabled = false;
    pdfInput.value = '';
  }
});

addFileBtn.addEventListener('click', function() {
  addFileInput.click();
});

addFileInput.addEventListener('change', async function(e) {
  var file = e.target.files[0];
  if (!file) return;

  addFileBtn.disabled = true;
  addFileBtn.textContent = '…';

  try {
    await loadFile(file);
    renderAll();
  } catch (err) {
    console.error(err);
    alert('Could not parse file: ' + err.message);
  } finally {
    addFileBtn.disabled = false;
    addFileBtn.textContent = '+ Add File';
    addFileInput.value = '';
  }
});

var planTabBar = document.getElementById('plan-tab-bar');
var planInput  = document.getElementById('plan-input');
var planStatus = document.getElementById('plan-status');

function switchTab(tab) {
  _activeTab = tab;

  document.querySelectorAll('.plan-tab-btn').forEach(function (btn) {
    btn.classList.toggle('plan-tab-btn--active', btn.dataset.tab === tab);
  });

  // Schedule tab shows the normal grid; plan tabs show their panels
  document.querySelector('.schedule-body').classList.toggle('hidden', tab !== 'schedule');
  ['assignments', 'faculty', 'courses', 'checks'].forEach(function (t) {
    var panel = document.getElementById('plan-tab-' + t);
    if (panel) panel.classList.toggle('hidden', tab !== t);
  });

  if (_activePlan && tab !== 'schedule') {
    if (!_planTabsInited) {
      PlanTabs.init(_activePlan);
      _planTabsInited = true;
    }
    switch (tab) {
      case 'assignments': PlanTabs.renderAssignments(_activePlan); break;
      case 'faculty':     PlanTabs.renderFaculty(_activePlan);     break;
      case 'courses':     PlanTabs.renderCourses(_activePlan);     break;
      case 'checks':      PlanTabs.renderChecks(_activePlan);      break;
    }
  }
}

planTabBar.addEventListener('click', function (e) {
  var btn = e.target.closest('.plan-tab-btn');
  if (btn && btn.dataset.tab) switchTab(btn.dataset.tab);
});

planInput.addEventListener('change', async function(e) {
  var file = e.target.files[0];
  if (!file) return;

  uploadError.classList.add('hidden');
  planStatus.classList.add('hidden');

  try {
    var text = await file.text();
    var raw  = JSON.parse(text);
    _activePlan = PlanData.migrate(raw);

    var totalAssignments = _activePlan.assignments.length;
    var totalFaculty     = _activePlan.faculty.filter(function(f) { return f.active; }).length;
    var totalCourses     = _activePlan.courses.filter(function(c) { return c.active; }).length;
    var scheduledTerms   = PlanData.scheduledTerms(_activePlan);

    if (scheduledTerms.length) {
      // Plan already has schedule data — load it straight into the editor
      loadedSchedules = [];
      scheduledTerms.forEach(function(term) {
        var sch = PlanData.termToSchedule(_activePlan, term);
        var fi  = loadedSchedules.length;
        sch.sections.forEach(function(s) { s._fileIndex = fi; });
        loadedSchedules.push(sch);
      });
      renderAll();
      uploadView.classList.add('hidden');
      scheduleView.classList.remove('hidden');
      addFileBtn.classList.remove('hidden');
      planTabBar.classList.remove('hidden');
      switchTab('schedule');
    } else {
      // Plan has no schedule data yet — stay on upload view, show status
      planStatus.innerHTML =
        '<strong>Plan loaded:</strong> ' +
        totalFaculty + ' faculty, ' +
        totalCourses + ' courses, ' +
        totalAssignments + ' assignments. ' +
        'Import a CSV to add schedule details.';
      planStatus.classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
    uploadError.textContent = 'Could not load plan file: ' + err.message;
    uploadError.classList.remove('hidden');
  } finally {
    planInput.value = '';
  }
});

toggleOnlineBtn.addEventListener('click', function() {
  var hidden = onlinePanel.dataset.userHidden === 'true';
  if (hidden) {
    delete onlinePanel.dataset.userHidden;
    onlinePanel.classList.remove('hidden');
    toggleOnlineBtn.textContent = 'Hide Online';
    toggleOnlineBtn.classList.remove('active');
    try { localStorage.setItem('sv_hide_online', '0'); } catch(e) {}
  } else {
    onlinePanel.dataset.userHidden = 'true';
    onlinePanel.classList.add('hidden');
    toggleOnlineBtn.textContent = 'Show Online';
    toggleOnlineBtn.classList.add('active');
    try { localStorage.setItem('sv_hide_online', '1'); } catch(e) {}
  }
});

newUploadBtn.addEventListener('click', function() {
  ScheduleApp.promptIfDirty(function() {
    ScheduleApp.exitEditMode();
    loadedSchedules = [];
    _customTitle    = null;
    _activePlan      = null;
    _planTabsInited  = false;
    _activeTab       = 'schedule';
    planTabBar.classList.add('hidden');
    scheduleView.classList.add('hidden');
    uploadView.classList.remove('hidden');
    scheduleGrid.innerHTML = '';
    onlinePanel.innerHTML  = '';
    delete onlinePanel.dataset.userHidden;
    courseSidebar.innerHTML = '';
    addFileBtn.classList.add('hidden');
    toggleOnlineBtn.textContent = 'Hide Online';
    toggleOnlineBtn.classList.remove('active');
    planStatus.classList.add('hidden');
    var slp = document.getElementById('schedule-load-panel');
    if (slp) slp.classList.add('hidden');
  });
});

calendarBtn.addEventListener('click', function() {
  if (!ScheduleApp._activeSections || !ScheduleApp._activeSections.length) {
    alert('No schedule loaded.');
    return;
  }

  // Determine current filter visibility (mirrors applyAllVisibility logic)
  var courseVisible = {};
  document.querySelectorAll('.course-filter-cb').forEach(function(cb) {
    courseVisible[cb.dataset.course] = cb.checked;
  });
  var instVisible = {};
  var instFilterExists = document.querySelector('.instructor-filter-cb') !== null;
  if (instFilterExists) {
    document.querySelectorAll('.instructor-filter-cb').forEach(function(cb) {
      instVisible[cb.dataset.instructor] = cb.checked;
    });
  }

  var visibleSections = ScheduleApp._activeSections.filter(function(s) {
    var courseOk = courseVisible[s.courseNumber] !== false;
    var instOk   = !instFilterExists || instVisible[s.instructor] !== false;
    return courseOk && instOk;
  });

  var exportable = visibleSections.filter(function(s) {
    return s.iCalStart && s.iCalEnd;
  });
  var skipped = visibleSections.length - exportable.length;

  var html = '<p>This will export <strong>' + exportable.length + ' section' +
    (exportable.length !== 1 ? 's' : '') + '</strong> from the current view as a calendar file (.ics).</p>';

  if (skipped > 0) {
    html += '<p class="modal-note">' + skipped + ' section' + (skipped !== 1 ? 's' : '') +
      ' will be skipped — no date range data available. Date ranges are included in CSV exports but not PDF exports.</p>';
  }

  html += '<p>Each event repeats weekly for its full session date range and includes the instructor and room.</p>';

  icalModalBody.innerHTML = html;
  icalModalConfirm.disabled = exportable.length === 0;

  icalModal._exportable = exportable;
  icalModal._semId  = ScheduleApp._semId || '';
  icalModal._title  = scheduleTitle.textContent;

  icalModal.classList.remove('hidden');
});

icalModalConfirm.addEventListener('click', function() {
  icalModal.classList.add('hidden');
  ScheduleApp.exportGridICal(icalModal._exportable, icalModal._semId, icalModal._title);
});

icalModalCancel.addEventListener('click', function() {
  icalModal.classList.add('hidden');
});

icalModal.addEventListener('click', function(e) {
  if (e.target === icalModal) icalModal.classList.add('hidden');
});

editModeBtn.addEventListener('click', function() {
  ScheduleApp.toggleEditMode();
});

var _pendingExport = null;

function _defaultExportPrefix() {
  return loadedSchedules[0] && loadedSchedules[0].semPrefix
    ? loadedSchedules[0].semPrefix.replace(/\s+/g, '_') : 'schedule';
}

function _showExportNamePrompt(title, defaultName, ext, callback) {
  exportNameTitle.textContent = title;
  exportNameInput.value = defaultName;
  exportNameExt.textContent = ext;
  _pendingExport = callback;
  exportNameModal.classList.remove('hidden');
  exportNameInput.focus();
  exportNameInput.select();
}

exportNameConfirm.addEventListener('click', function() {
  var name = exportNameInput.value.trim();
  if (!name || !_pendingExport) return;
  exportNameModal.classList.add('hidden');
  var cb = _pendingExport;
  _pendingExport = null;
  cb(name);
});

exportNameCancel.addEventListener('click', function() {
  exportNameModal.classList.add('hidden');
  _pendingExport = null;
});

exportNameModal.addEventListener('click', function(e) {
  if (e.target === exportNameModal) {
    exportNameModal.classList.add('hidden');
    _pendingExport = null;
  }
});

exportNameInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter')  exportNameConfirm.click();
  if (e.key === 'Escape') exportNameCancel.click();
});

exportCsvBtn.addEventListener('click', function() {
  _showConflictWarning(function() {
    _showExportNamePrompt('Export CSV', _defaultExportPrefix(), '.csv', function(name) {
      ScheduleApp.exportCSVByDept(loadedSchedules, name);
    });
  });
});

exportXlsxBtn.addEventListener('click', function() {
  _showConflictWarning(function() {
    _showExportNamePrompt('Export Excel', _defaultExportPrefix() + '_schedule_changes', '.xlsx', function(name) {
      ScheduleApp.exportXLSX(loadedSchedules, name);
    });
  });
});

conflictModalConfirm.addEventListener('click', function() {
  conflictModal.classList.add('hidden');
  var cb = conflictModal._callback;
  conflictModal._callback = null;
  if (cb) cb();
});

conflictModalCancel.addEventListener('click', function() {
  conflictModal.classList.add('hidden');
  conflictModal._callback = null;
});

conflictModal.addEventListener('click', function(e) {
  if (e.target === conflictModal) {
    conflictModal.classList.add('hidden');
    conflictModal._callback = null;
  }
});

addSectionBtn.addEventListener('click', function() {
  ScheduleApp.openSectionModal(null, null);
});

window.addEventListener('beforeunload', function(e) {
  if (ScheduleApp._isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

scheduleTitle.addEventListener('click', function() {
  if (!document.body.classList.contains('edit-mode')) return;
  if (scheduleTitle.querySelector('#schedule-title-input')) return;

  var current = scheduleTitle.textContent;
  var input = document.createElement('input');
  input.type = 'text';
  input.id   = 'schedule-title-input';
  input.value = current;
  scheduleTitle.textContent = '';
  scheduleTitle.appendChild(input);
  input.focus();
  input.select();

  var committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    var val = input.value.trim();
    if (!val) {
      _customTitle = null;
    } else if (val !== current) {
      _customTitle = val;
      loadedSchedules.forEach(function(sch) { sch.semPrefix = val; });
      ScheduleApp.markDirty();
    }
    renderAll();
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') {
      committed = true;
      scheduleTitle.textContent = current;
    }
  });
});

// Init editor modal event listeners once
ScheduleApp.initEditorModal();
