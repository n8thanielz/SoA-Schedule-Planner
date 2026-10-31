window.ScheduleApp = window.ScheduleApp || {};

// ── Open modal ────────────────────────────────────────────────────────────────

// section = null → Add mode; section = object → Edit mode
// fileIndex only used in Edit mode to know which schedule owns the section
ScheduleApp.openSectionModal = function(section, fileIndex) {
  _populateModal(section, fileIndex);
  document.getElementById('section-modal').classList.remove('hidden');
};

// ── Modal population ──────────────────────────────────────────────────────────

function _populateModal(section, fileIndex) {
  var isEdit  = !!section;
  var schedules = ScheduleApp.getLoadedSchedules();

  document.getElementById('sm-title').textContent = isEdit ? 'Edit Section' : 'Add Section';

  // Build course dropdown
  var courseSelect = document.getElementById('sm-course');
  courseSelect.innerHTML = '';
  var seen = {};
  schedules.forEach(function(sch, fi) {
    sch.sections.forEach(function(s) {
      if (seen[s.courseNumber]) return;
      seen[s.courseNumber] = { name: s.courseName, fi: fi };
      var opt = document.createElement('option');
      opt.value = s.courseNumber;
      opt.textContent = s.courseNumber + ' – ' + s.courseName;
      opt.dataset.fileIndex = fi;
      courseSelect.appendChild(opt);
    });
  });
  var newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New Course…';
  courseSelect.appendChild(newOpt);

  // Build department dropdown for new course
  var deptSelect = document.getElementById('sm-dept');
  deptSelect.innerHTML = '';
  schedules.forEach(function(sch, fi) {
    if (!sch.dept) return;
    var opt = document.createElement('option');
    opt.value = fi;
    opt.textContent = sch.dept + ' (' + sch.semester + ')';
    deptSelect.appendChild(opt);
  });

  // Build instructor datalist (sorted alphabetically)
  var instList = document.getElementById('sm-instructor-list');
  instList.innerHTML = '';
  var instSeen = {};
  schedules.forEach(function(sch) {
    sch.sections.forEach(function(s) {
      if (!s.instructor || instSeen[s.instructor]) return;
      instSeen[s.instructor] = true;
    });
  });
  var activePlan = ScheduleApp.getActivePlan && ScheduleApp.getActivePlan();
  if (activePlan) {
    activePlan.faculty.forEach(function(f) {
      if (f.active && f.name && !instSeen[f.name]) instSeen[f.name] = true;
    });
  }
  Object.keys(instSeen).sort(function(a, b) {
    if (a === 'Staff') return 1;
    if (b === 'Staff') return -1;
    return a.localeCompare(b);
  }).forEach(function(name) {
    var opt = document.createElement('option');
    opt.value = name;
    instList.appendChild(opt);
  });

  // Populate time presets based on days
  _updateTimePresets([]);

  // Prefill from existing section
  if (isEdit) {
    courseSelect.value = section.courseNumber;
    _toggleNewCourseFields(false);
    document.getElementById('sm-section-num').value  = section.sectionNumber;
    document.getElementById('sm-section-type').value = section.type;
    document.getElementById('sm-instructor').value   = section.instructor;
    document.getElementById('sm-room').value         = section.room || '';
    var editMethod = _inferInstMethod(section);
    document.getElementById('sm-inst-method').value  = editMethod;
    _toggleOnlineFields(editMethod === 'Online');
    document.getElementById('sm-room-cap').value     = section.roomCapRequest || '';
    document.getElementById('sm-session').value      = section.session || 'Regular Academic Session';
    _toggleSessionDates(section.session === 'Miscellaneous');
    if (section.session === 'Miscellaneous') {
      document.getElementById('sm-session-start').value = _iCalToDateInput(section.iCalStart);
      document.getElementById('sm-session-end').value   = _iCalToDateInput(section.iCalEnd);
    }

    // Days
    document.querySelectorAll('#section-modal input[name="sm-day"]').forEach(function(cb) {
      cb.checked = section.days.indexOf(cb.value) !== -1;
    });
    _updateTimePresets(section.days);

    // Try to match time preset
    var presetSel = document.getElementById('sm-time-preset');
    var matchedPreset = false;
    for (var i = 0; i < presetSel.options.length; i++) {
      var opt = presetSel.options[i];
      if (opt.dataset.start === section.startTime && opt.dataset.end === section.endTime) {
        presetSel.value = opt.value;
        matchedPreset = true;
        break;
      }
    }
    if (!matchedPreset) {
      presetSel.value = 'custom';
      document.getElementById('sm-custom-time').classList.remove('hidden');
      document.getElementById('sm-start-time').value = section.startTime;
      document.getElementById('sm-end-time').value   = section.endTime;
    } else {
      document.getElementById('sm-custom-time').classList.add('hidden');
    }

    document.getElementById('sm-delete-btn').classList.remove('hidden');
    document.getElementById('sm-delete-btn').dataset.sectionId = section.id;

    var revertBtn = document.getElementById('sm-revert-btn');
    if (section._isNew) {
      revertBtn.textContent = 'Remove Section';
      revertBtn.classList.remove('hidden');
    } else if (section._original) {
      revertBtn.textContent = 'Revert to Original';
      revertBtn.classList.remove('hidden');
    } else {
      revertBtn.classList.add('hidden');
    }
  } else {
    // Add mode defaults
    _toggleNewCourseFields(false);
    document.getElementById('sm-section-num').value  = '';
    document.getElementById('sm-section-type').value = 'LEC';
    document.getElementById('sm-instructor').value   = '';
    document.getElementById('sm-room').value         = '';
    document.getElementById('sm-inst-method').value  = 'In Person';
    _toggleOnlineFields(false);
    document.getElementById('sm-room-cap').value     = '';
    document.getElementById('sm-session').value      = 'Regular Academic Session';
    _toggleSessionDates(false);
    document.querySelectorAll('#section-modal input[name="sm-day"]').forEach(function(cb) {
      cb.checked = false;
    });
    document.getElementById('sm-time-preset').value = '';
    document.getElementById('sm-custom-time').classList.add('hidden');
    document.getElementById('sm-delete-btn').classList.add('hidden');
    document.getElementById('sm-revert-btn').classList.add('hidden');
  }

  // Store context
  var modal = document.getElementById('section-modal');
  modal.dataset.editId    = isEdit ? section.id : '';
  if (isEdit) {
    modal.dataset.fileIndex = fileIndex;
  } else {
    var firstOpt = courseSelect.options[0];
    modal.dataset.fileIndex = (firstOpt && firstOpt.dataset.fileIndex !== undefined)
      ? firstOpt.dataset.fileIndex : '0';
  }
}

function _inferInstMethod(section) {
  if (section.isOnline) return 'Online';
  if (/hybrid/i.test(section.notes)) return 'Hybrid';
  if (/remote real-time/i.test(section.notes)) return 'Remote Real-Time';
  return 'In Person';
}

function _toggleNewCourseFields(show) {
  document.getElementById('sm-new-course-fields').classList.toggle('hidden', !show);
}

function _toggleSessionDates(show) {
  document.getElementById('sm-session-dates').classList.toggle('hidden', !show);
}

function _toggleOnlineFields(isOnline) {
  document.getElementById('sm-days-group').classList.toggle('hidden', isOnline);
  document.getElementById('sm-time-group').classList.toggle('hidden', isOnline);
}

function _snapshotSection(s) {
  return {
    courseNumber:   s.courseNumber,
    courseName:     s.courseName,
    sectionNumber:  s.sectionNumber,
    type:           s.type,
    instructor:     s.instructor,
    days:           s.days.slice(),
    startTime:      s.startTime,
    endTime:        s.endTime,
    room:           s.room,
    isOnline:       s.isOnline,
    doesNotMeet:    s.doesNotMeet,
    notes:          s.notes,
    session:        s.session,
    roomCapRequest: s.roomCapRequest,
    iCalStart:      s.iCalStart,
    iCalEnd:        s.iCalEnd
  };
}
ScheduleApp.snapshotSection = _snapshotSection;

function _iCalToDateInput(val) {
  if (!val || val.length !== 8) return '';
  return val.slice(0, 4) + '-' + val.slice(4, 6) + '-' + val.slice(6, 8);
}

function _dateInputToICal(val) {
  return val ? val.replace(/-/g, '') : null;
}

function _updateTimePresets(days) {
  var presetSel = document.getElementById('sm-time-preset');
  var prevVal   = presetSel.value;
  presetSel.innerHTML = '';

  var hasMW  = days.indexOf('M') !== -1 || days.indexOf('W') !== -1 || days.indexOf('F') !== -1;
  var hasTTh = days.indexOf('T') !== -1 || days.indexOf('Th') !== -1;

  var blocks = [];
  if (hasMW  && !hasTTh) blocks = ScheduleApp.SNAP_BLOCKS.MW;
  if (hasTTh && !hasMW)  blocks = ScheduleApp.SNAP_BLOCKS.TTh;
  if (hasMW  &&  hasTTh) blocks = ScheduleApp.SNAP_BLOCKS.MW.concat(ScheduleApp.SNAP_BLOCKS.TTh);

  if (!blocks.length) {
    var ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Select days first…';
    presetSel.appendChild(ph);
  }

  blocks.forEach(function(b, idx) {
    var opt = document.createElement('option');
    opt.value = 'block_' + idx;
    opt.textContent = ScheduleApp.formatTime(b.start) + ' – ' + ScheduleApp.formatTime(b.end);
    opt.dataset.start = b.start;
    opt.dataset.end   = b.end;
    presetSel.appendChild(opt);
  });

  var customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = 'Custom…';
  presetSel.appendChild(customOpt);

  // Restore previous selection if still valid
  if (prevVal) presetSel.value = prevVal;
}

// ── Event wiring (called once on DOMContentLoaded) ────────────────────────────

ScheduleApp.initEditorModal = function() {
  var modal     = document.getElementById('section-modal');
  var courseEl  = document.getElementById('sm-course');
  var presetEl  = document.getElementById('sm-time-preset');
  var cancelBtn = document.getElementById('sm-cancel-btn');
  var saveBtn   = document.getElementById('sm-save-btn');
  var deleteBtn = document.getElementById('sm-delete-btn');
  var revertBtn = document.getElementById('sm-revert-btn');

  // Close on overlay click — confirm if there's content to avoid accidental data loss
  modal.addEventListener('click', function(e) {
    if (e.target !== modal) return;
    var editId = modal.dataset.editId;
    var secNum = document.getElementById('sm-section-num').value.trim();
    if ((editId || secNum) && !confirm('Close without saving?')) return;
    modal.classList.add('hidden');
  });

  cancelBtn.addEventListener('click', function() {
    var editId = modal.dataset.editId;
    var secNum = document.getElementById('sm-section-num').value.trim();
    if ((editId || secNum) && !confirm('Close without saving?')) return;
    modal.classList.add('hidden');
  });

  // Course select → show/hide new course fields
  courseEl.addEventListener('change', function() {
    var isNew = courseEl.value === '__new__';
    _toggleNewCourseFields(isNew);
    if (!isNew) {
      // Update fileIndex to match selected course's origin file
      var opt = courseEl.options[courseEl.selectedIndex];
      if (opt.dataset.fileIndex !== undefined) {
        modal.dataset.fileIndex = opt.dataset.fileIndex;
      }
    }
  });

  // Day checkboxes → update time presets
  document.querySelectorAll('#section-modal input[name="sm-day"]').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var days = _getSelectedDays();
      _updateTimePresets(days);
    });
  });

  // Quick day buttons
  document.querySelectorAll('.sm-day-quick').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var daysToSet = (btn.dataset.days || '').split(',');
      document.querySelectorAll('#section-modal input[name="sm-day"]').forEach(function(cb) {
        cb.checked = daysToSet.indexOf(cb.value) !== -1;
      });
      _updateTimePresets(daysToSet);
    });
  });

  // Delivery method → show/hide day/time fields; clear "ONLINE" room when switching away
  document.getElementById('sm-inst-method').addEventListener('change', function() {
    var isOnline = this.value === 'Online';
    _toggleOnlineFields(isOnline);
    if (!isOnline) {
      var roomEl = document.getElementById('sm-room');
      if (/^ONLINE$/i.test(roomEl.value.trim())) roomEl.value = '';
    }
  });

  // Session → show/hide custom date inputs
  document.getElementById('sm-session').addEventListener('change', function() {
    _toggleSessionDates(this.value === 'Miscellaneous');
  });

  // Time preset → show/hide custom inputs
  presetEl.addEventListener('change', function() {
    var isCustom = presetEl.value === 'custom';
    document.getElementById('sm-custom-time').classList.toggle('hidden', !isCustom);
  });

  // Save
  saveBtn.addEventListener('click', _handleSave);

  // Delete
  deleteBtn.addEventListener('click', _handleDelete);

  // Revert
  revertBtn.addEventListener('click', _handleRevert);
};

function _getSelectedDays() {
  var days = [];
  document.querySelectorAll('#section-modal input[name="sm-day"]').forEach(function(cb) {
    if (cb.checked) days.push(cb.value);
  });
  return days;
}

function _handleSave() {
  var modal     = document.getElementById('section-modal');
  var courseEl  = document.getElementById('sm-course');
  var presetEl  = document.getElementById('sm-time-preset');
  var editId    = modal.dataset.editId;
  var isEdit    = !!editId;
  var schedules = ScheduleApp.getLoadedSchedules();

  // Resolve course
  var courseNumber, courseName, fileIndex;
  if (courseEl.value === '__new__') {
    courseNumber = document.getElementById('sm-new-course-num').value.trim().toUpperCase();
    courseName   = document.getElementById('sm-new-course-name').value.trim();
    fileIndex    = parseInt(document.getElementById('sm-dept').value);
    if (!courseNumber || !courseName) { alert('Please enter a course number and name.'); return; }
  } else {
    courseNumber = courseEl.value;
    fileIndex    = parseInt(modal.dataset.fileIndex) || 0;
    // Find course name
    for (var fi = 0; fi < schedules.length; fi++) {
      var match = schedules[fi].sections.find(function(s) { return s.courseNumber === courseNumber; });
      if (match) { courseName = match.courseName; break; }
    }
  }

  var secNum   = document.getElementById('sm-section-num').value.trim();
  var secType  = document.getElementById('sm-section-type').value;
  var instName = document.getElementById('sm-instructor').value.trim() || 'Staff';
  var room     = document.getElementById('sm-room').value.trim();
  var method   = document.getElementById('sm-inst-method').value;
  var roomCap  = document.getElementById('sm-room-cap').value.trim();
  var days     = _getSelectedDays();

  if (!secNum)         { alert('Please enter a section number.'); return; }

  // Pad purely numeric section numbers to 3 digits
  if (/^\d+$/.test(secNum)) {
    secNum = ('00' + parseInt(secNum, 10)).slice(-3);
    document.getElementById('sm-section-num').value = secNum;
  }

  // Check for duplicate section number on the same course
  var proposedId = courseNumber + '-' + secNum;
  var existing   = ScheduleApp.findSection(proposedId);
  if (existing && !existing.section._deleted && (!isEdit || existing.section.id !== editId)) {
    alert('Section ' + secNum + ' already exists for ' + courseNumber + '. Please use a different section number.');
    return;
  }

  // Resolve time and days — not required for Online sections
  var startTime, endTime;
  if (method === 'Online') {
    days      = [];
    startTime = '';
    endTime   = '';
  } else {
    if (!days.length) { alert('Please select at least one day.'); return; }
    if (presetEl.value === 'custom' || presetEl.value === '') {
      startTime = document.getElementById('sm-start-time').value.trim();
      endTime   = document.getElementById('sm-end-time').value.trim();
      if (!startTime || !endTime) { alert('Please enter start and end times.'); return; }
    } else {
      var opt = presetEl.options[presetEl.selectedIndex];
      startTime = opt.dataset.start;
      endTime   = opt.dataset.end;
    }
  }

  var session     = document.getElementById('sm-session').value;
  var sessionStart = session === 'Miscellaneous' ? _dateInputToICal(document.getElementById('sm-session-start').value) : null;
  var sessionEnd   = session === 'Miscellaneous' ? _dateInputToICal(document.getElementById('sm-session-end').value)   : null;

  if (session === 'Miscellaneous' && (!sessionStart || !sessionEnd)) {
    alert('Please enter start and end dates for the Miscellaneous session.');
    return;
  }

  var notes = '';
  if (method === 'Hybrid')           notes = 'Hybrid';
  if (method === 'Remote Real-Time') notes = 'Remote Real-Time';

  if (isEdit) {
    // Update existing section
    var result = ScheduleApp.findSection(editId);
    if (!result) return;
    var s = result.section;
    if (!s._isNew && !s._original) s._original = _snapshotSection(s);
    s.courseNumber  = courseNumber;
    s.courseName    = courseName;
    s.sectionNumber = secNum;
    s.type          = secType;
    s.instructor    = instName;
    s.days          = days;
    s.startTime     = startTime;
    s.endTime       = endTime;
    s.room          = room;
    s.isOnline        = method === 'Online';
    s.doesNotMeet     = method === 'Online';
    s.notes           = notes;
    s.session         = session;
    s.roomCapRequest  = roomCap;
    if (session === 'Miscellaneous') { s.iCalStart = sessionStart; s.iCalEnd = sessionEnd; }
    s._modified       = true;
    // Update the section id to reflect any secNum change
    s.id = courseNumber + '-' + secNum;
  } else {
    // Add new section
    var newSection = {
      id:            courseNumber + '-' + secNum,
      courseNumber:  courseNumber,
      courseName:    courseName,
      sectionNumber: secNum,
      type:          secType,
      instructor:    instName,
      days:          days,
      startTime:     startTime,
      endTime:       endTime,
      room:          room,
      isOnline:        method === 'Online',
      doesNotMeet:     method === 'Online',
      dateRange:       '',
      iCalStart:       sessionStart,
      iCalEnd:         sessionEnd,
      notes:           notes,
      session:         session,
      roomCapRequest:  roomCap,
      _rowIndex:     -1,
      _fileIndex:    fileIndex,
      _modified:     false,
      _deleted:      false,
      _isNew:        true,
      _multiSession: false
    };
    schedules[fileIndex].sections.push(newSection);
  }

  ScheduleApp.markDirty();
  modal.classList.add('hidden');
  ScheduleApp.triggerRenderAll();
}

function _handleRevert() {
  var modal  = document.getElementById('section-modal');
  var editId = modal.dataset.editId;
  if (!editId) return;

  var result = ScheduleApp.findSection(editId);
  if (!result) return;
  var s = result.section;

  if (s._isNew) {
    if (!confirm('Remove this new section entirely?')) return;
    var schedules = ScheduleApp.getLoadedSchedules();
    var arr = schedules[s._fileIndex].sections;
    var idx = arr.indexOf(s);
    if (idx !== -1) arr.splice(idx, 1);
  } else if (s._original) {
    if (!confirm('Revert this section to its original state?')) return;
    var orig = s._original;
    s.courseNumber   = orig.courseNumber;
    s.courseName     = orig.courseName;
    s.sectionNumber  = orig.sectionNumber;
    s.type           = orig.type;
    s.instructor     = orig.instructor;
    s.days           = orig.days.slice();
    s.startTime      = orig.startTime;
    s.endTime        = orig.endTime;
    s.room           = orig.room;
    s.isOnline       = orig.isOnline;
    s.doesNotMeet    = orig.doesNotMeet;
    s.notes          = orig.notes;
    s.session        = orig.session;
    s.roomCapRequest = orig.roomCapRequest;
    s.iCalStart      = orig.iCalStart;
    s.iCalEnd        = orig.iCalEnd;
    s._modified      = false;
    s._deleted       = false;
    delete s._original;
  }

  modal.classList.add('hidden');
  ScheduleApp.triggerRenderAll();
}

function _handleDelete() {
  var modal  = document.getElementById('section-modal');
  var editId = modal.dataset.editId;
  if (!editId) return;
  if (!confirm('Mark this section as Cancelled in the CSV export?')) return;

  var result = ScheduleApp.findSection(editId);
  if (result) {
    result.section._deleted  = true;
    result.section._modified = false;
    ScheduleApp.markDirty();
  }

  modal.classList.add('hidden');
  ScheduleApp.triggerRenderAll();
}
