/* app.js - Hospital Management System (educational prototype) */
'use strict';

// ---------- Setup & state ----------
const cfg = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);
const state = { patients: [], doctors: [], appointments: [] };
const STATUSES = ['Scheduled', 'Completed', 'Cancelled'];
const PHONE_RE = /^[0-9+()\- ]{7,20}$/;
const APPT_COLS = 'id, appointment_date, status, patient_id, doctor_id, patients(full_name), doctors(full_name, specialization)';
const TITLES = { dashboard: 'Dashboard', patients: 'Patients', doctors: 'Doctors', appointments: 'Appointments' };
let db = null;            // Supabase client
let currentUserId = null; // logged-in user id
let loginNotice = '';     // message to show on the login screen

// ---------- Small DOM helpers (safe: never uses innerHTML) ----------
function el(tag, opts = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(opts)) {
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k.startsWith('aria-') || k === 'role') n.setAttribute(k, v);
    else n[k] = v;
  }
  kids.forEach((c) => n.append(c));
  return n;
}
const blank = (v) => (v === null || v === undefined || v === '' ? '—' : v);
const td = (v) => el('td', { text: blank(v) });
const badge = (s) => el('span', { class: 'badge badge-' + String(s).toLowerCase(), text: s });
const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Show/hide a message paragraph. type: 'info' | 'error' | 'success'
function setMsg(id, text, type = 'error') {
  const n = $(id);
  n.textContent = text || '';
  n.className = 'status ' + type;
  n.hidden = !text;
}

function toast(msg, type = 'info') {
  const t = el('div', { class: 'toast toast-' + type, text: msg, role: 'status' });
  $('toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}

// Fill a <tbody>; shows an empty-state row when there is nothing to display
function fillTable(tbodyId, rows, cols, emptyText, buildRow) {
  const tb = $(tbodyId);
  tb.replaceChildren();
  if (!rows.length) {
    tb.append(el('tr', {}, [el('td', { colSpan: cols, class: 'empty', text: emptyText })]));
    return;
  }
  rows.forEach((r) => tb.append(buildRow(r)));
}

function actionsCell(onEdit, onDelete) {
  return el('td', {}, [el('div', { class: 'row-actions' }, [
    el('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Edit', onclick: onEdit }),
    el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Delete', onclick: onDelete }),
  ])]);
}

function fillSelect(id, rows, placeholder, label) {
  $(id).replaceChildren(
    el('option', { value: '', text: placeholder }),
    ...rows.map((r) => el('option', { value: r.id, text: label(r) }))
  );
}

// Promise-based confirmation dialog
function confirmAction(message) {
  return new Promise((resolve) => {
    const dlg = $('confirm-dialog');
    $('confirm-text').textContent = message;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    dlg.showModal();
  });
}

// ---------- Error handling ----------
const isAuthError = (e) => e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt/i.test(e.message || '');

function describeError(e) {
  if (isAuthError(e)) return 'Your session has expired. Please sign in again.';
  if (e.code === '42501') return 'Permission denied: your account is not allowed to do this.';
  if (/failed to fetch|network/i.test(e.message || '')) return 'Network error. Check your connection and try again.';
  return e.message || 'Something went wrong. Please try again.';
}

// Show an error in an element (targetId) or as a toast; log out if the session expired
function fail(error, targetId) {
  console.error(error);
  const msg = describeError(error);
  if (targetId) setMsg(targetId, msg, 'error'); else toast(msg, 'error');
  if (isAuthError(error)) forceLogout(msg);
}

async function forceLogout(msg) {
  loginNotice = msg;
  await db.auth.signOut();
}

// ---------- Validation ----------
const validateName = (v, label = 'Name') => (v.length < 2 || v.length > 100 ? `${label} must be 2-100 characters.` : '');
const validatePhone = (v) => (PHONE_RE.test(v) ? '' : 'Phone must be 7-20 characters: digits, spaces, +, - or ( ).');

// ---------- Authentication & views ----------
function showLogin() {
  currentUserId = null;
  state.patients = []; state.doctors = []; state.appointments = [];
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $('boot').hidden = true; $('app-view').hidden = true; $('login-view').hidden = false;
  if (loginNotice) { setMsg('login-error', loginNotice); loginNotice = ''; }
}

function showApp() {
  $('boot').hidden = true; $('login-view').hidden = true; $('app-view').hidden = false;
}

// Decide what to show for a session; the user must have a valid profile row
async function routeSession(session) {
  if (!session) { showLogin(); return; }
  if (currentUserId === session.user.id) return; // already loaded
  currentUserId = session.user.id;
  const { data, error } = await db.from('profiles').select('full_name, role').eq('id', session.user.id).maybeSingle();
  if (error || !data) {
    currentUserId = null;
    loginNotice = error ? describeError(error) : 'This account has no staff access. Ask an administrator.';
    await db.auth.signOut();
    return;
  }
  $('user-label').textContent = `${data.full_name || session.user.email} (${data.role})`;
  showApp();
  showSection('dashboard');
}

async function onLogin(e) {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email || !password) return setMsg('login-error', 'Enter your email and password.');
  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'Signing in…'; setMsg('login-error', '');
  const { error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (error) setMsg('login-error', error.status === 400 ? 'Invalid email or password.' : describeError(error));
  else $('login-password').value = '';
}

// ---------- Navigation ----------
function showSection(name) {
  document.querySelectorAll('.section').forEach((s) => s.classList.toggle('active', s.id === 'sec-' + name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
  $('page-title').textContent = TITLES[name];
  $('sidebar').classList.remove('open');
  ({ dashboard: loadDashboard, patients: loadPatients, doctors: loadDoctors, appointments: loadAppointments })[name]();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  setMsg('dash-status', 'Loading dashboard…', 'info');
  ['patients', 'doctors', 'appointments'].forEach((k) => ($('stat-' + k).textContent = '…'));
  try {
    const count = (t) => db.from(t).select('*', { count: 'exact', head: true });
    const [p, d, a, latest] = await Promise.all([
      count('patients'), count('doctors'), count('appointments'),
      db.from('appointments').select(APPT_COLS).order('created_at', { ascending: false }).limit(5),
    ]);
    const err = [p, d, a, latest].find((r) => r.error);
    if (err) throw err.error;
    $('stat-patients').textContent = p.count ?? 0;
    $('stat-doctors').textContent = d.count ?? 0;
    $('stat-appointments').textContent = a.count ?? 0;
    fillTable('dash-body', latest.data, 4, 'No appointments yet.', (x) => el('tr', {}, [
      td(fmtDate(x.appointment_date)), td(x.patients?.full_name), td(x.doctors?.full_name),
      el('td', {}, [badge(x.status)]),
    ]));
    setMsg('dash-status', '');
  } catch (e) {
    ['patients', 'doctors', 'appointments'].forEach((k) => ($('stat-' + k).textContent = '—'));
    fail(e, 'dash-status');
  }
}

// ---------- Generic save & delete ----------
async function submitRecord(table, id, rec, dialogId, errId, reload) {
  setMsg(errId, '');
  const q = id ? db.from(table).update(rec).eq('id', id) : db.from(table).insert(rec);
  const { error } = await q;
  if (error) return fail(error, errId);
  $(dialogId).close();
  toast(id ? 'Record updated.' : 'Record added.', 'success');
  await reload();
  loadDashboard();
}

async function deleteRecord(table, id, label, reload) {
  const ok = await confirmAction(`Delete "${label}"? Their appointments will also be deleted. This cannot be undone.`);
  if (!ok) return;
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) return fail(error);
  toast('Record deleted.', 'success');
  await reload();
  loadDashboard();
}

// ---------- Patients ----------
async function loadPatients() {
  setMsg('patients-status', 'Loading patients…', 'info');
  const { data, error } = await db.from('patients').select('id, full_name, age, gender, phone').order('full_name');
  if (error) return fail(error, 'patients-status');
  state.patients = data;
  setMsg('patients-status', '');
  renderPatients();
}

function renderPatients() {
  const q = $('patient-search').value.trim().toLowerCase();
  const rows = state.patients.filter((p) =>
    [p.full_name, p.phone, p.gender, p.age].join(' ').toLowerCase().includes(q));
  fillTable('patients-body', rows, 6, q ? 'No patients match your search.' : 'No patients yet. Click "Add Patient".',
    (p) => el('tr', {}, [
      td(p.id), td(p.full_name), td(p.age), td(p.gender), td(p.phone),
      actionsCell(() => openPatientDialog(p), () => deleteRecord('patients', p.id, p.full_name, loadPatients)),
    ]));
}

function openPatientDialog(p = null) {
  $('patient-dialog-title').textContent = p ? 'Edit Patient' : 'Add Patient';
  $('p-id').value = p ? p.id : '';
  $('p-name').value = p?.full_name ?? '';
  $('p-age').value = p?.age ?? '';
  $('p-gender').value = p?.gender ?? '';
  $('p-phone').value = p?.phone ?? '';
  setMsg('p-error', '');
  $('patient-dialog').showModal();
}

async function onPatientSubmit(e) {
  e.preventDefault();
  const ageText = $('p-age').value.trim();
  const rec = {
    full_name: $('p-name').value.trim(),
    age: ageText === '' ? NaN : Number(ageText),
    gender: $('p-gender').value,
    phone: $('p-phone').value.trim(),
  };
  const problem = validateName(rec.full_name)
    || (!Number.isInteger(rec.age) || rec.age < 0 || rec.age > 130 ? 'Age must be a whole number from 0 to 130.' : '')
    || (!rec.gender ? 'Please select a gender.' : '')
    || validatePhone(rec.phone);
  if (problem) return setMsg('p-error', problem);
  await submitRecord('patients', $('p-id').value, rec, 'patient-dialog', 'p-error', loadPatients);
}

// ---------- Doctors ----------
async function loadDoctors() {
  setMsg('doctors-status', 'Loading doctors…', 'info');
  const { data, error } = await db.from('doctors').select('id, full_name, specialization, phone').order('full_name');
  if (error) return fail(error, 'doctors-status');
  state.doctors = data;
  setMsg('doctors-status', '');
  renderDoctors();
}

function renderDoctors() {
  const q = $('doctor-search').value.trim().toLowerCase();
  const rows = state.doctors.filter((d) =>
    [d.full_name, d.specialization, d.phone].join(' ').toLowerCase().includes(q));
  fillTable('doctors-body', rows, 5, q ? 'No doctors match your search.' : 'No doctors yet. Click "Add Doctor".',
    (d) => el('tr', {}, [
      td(d.id), td(d.full_name), td(d.specialization), td(d.phone),
      actionsCell(() => openDoctorDialog(d), () => deleteRecord('doctors', d.id, d.full_name, loadDoctors)),
    ]));
}

function openDoctorDialog(d = null) {
  $('doctor-dialog-title').textContent = d ? 'Edit Doctor' : 'Add Doctor';
  $('d-id').value = d ? d.id : '';
  $('d-name').value = d?.full_name ?? '';
  $('d-spec').value = d?.specialization ?? '';
  $('d-phone').value = d?.phone ?? '';
  setMsg('d-error', '');
  $('doctor-dialog').showModal();
}

async function onDoctorSubmit(e) {
  e.preventDefault();
  const rec = {
    full_name: $('d-name').value.trim(),
    specialization: $('d-spec').value.trim(),
    phone: $('d-phone').value.trim(),
  };
  const problem = validateName(rec.full_name) || validateName(rec.specialization, 'Specialization') || validatePhone(rec.phone);
  if (problem) return setMsg('d-error', problem);
  await submitRecord('doctors', $('d-id').value, rec, 'doctor-dialog', 'd-error', loadDoctors);
}

// ---------- Appointments ----------
async function loadAppointments() {
  setMsg('appointments-status', 'Loading appointments…', 'info');
  const { data, error } = await db.from('appointments').select(APPT_COLS).order('appointment_date', { ascending: false });
  if (error) return fail(error, 'appointments-status');
  state.appointments = data;
  setMsg('appointments-status', '');
  renderAppointments();
}

function renderAppointments() {
  const f = $('appt-filter').value;
  const rows = state.appointments.filter((a) => !f || a.status === f);
  fillTable('appointments-body', rows, 5, 'No appointments found.', (a) => {
    const sel = el('select', { class: 'status-select', 'aria-label': 'Change status' },
      STATUSES.map((s) => el('option', { value: s, text: s })));
    sel.value = a.status;
    sel.addEventListener('change', () => changeStatus(a.id, sel.value));
    const doctor = a.doctors ? `${a.doctors.full_name} (${a.doctors.specialization})` : null;
    return el('tr', {}, [
      td(fmtDate(a.appointment_date)), td(a.patients?.full_name), td(doctor),
      el('td', {}, [badge(a.status)]),
      el('td', {}, [el('div', { class: 'row-actions' }, [
        sel,
        el('button', {
          class: 'btn btn-danger btn-sm', type: 'button', text: 'Cancel',
          disabled: a.status === 'Cancelled', onclick: () => cancelAppointment(a.id),
        }),
      ])]),
    ]);
  });
}

async function changeStatus(id, status) {
  const { error } = await db.from('appointments').update({ status }).eq('id', id);
  if (error) fail(error); else toast(`Status set to ${status}.`, 'success');
  await loadAppointments();
  loadDashboard();
}

async function cancelAppointment(id) {
  if (await confirmAction('Cancel this appointment?')) changeStatus(id, 'Cancelled');
}

async function openAppointmentDialog() {
  await Promise.all([loadPatients(), loadDoctors()]); // fresh lists for the dropdowns
  if (!state.patients.length || !state.doctors.length) {
    return toast('Add at least one patient and one doctor first.', 'error');
  }
  fillSelect('a-patient', state.patients, 'Select patient…', (p) => `${p.full_name} (ID ${p.id})`);
  fillSelect('a-doctor', state.doctors, 'Select doctor…', (d) => `${d.full_name} - ${d.specialization}`);
  $('a-date').min = toLocalInput(new Date());
  $('a-date').value = '';
  $('a-status').value = 'Scheduled';
  setMsg('a-error', '');
  $('appointment-dialog').showModal();
}

async function onAppointmentSubmit(e) {
  e.preventDefault();
  if (!$('a-patient').value) return setMsg('a-error', 'Please select a patient.');
  if (!$('a-doctor').value) return setMsg('a-error', 'Please select a doctor.');
  if (!$('a-date').value) return setMsg('a-error', 'Please choose a date and time.');
  const when = new Date($('a-date').value);
  if (isNaN(when) || when < new Date(Date.now() - 60000)) {
    return setMsg('a-error', 'Appointment date cannot be in the past.');
  }
  const rec = {
    patient_id: Number($('a-patient').value),
    doctor_id: Number($('a-doctor').value),
    appointment_date: when.toISOString(),
    status: $('a-status').value,
  };
  await submitRecord('appointments', null, rec, 'appointment-dialog', 'a-error', loadAppointments);
}

// ---------- Event wiring & startup ----------
function bindEvents() {
  $('login-form').addEventListener('submit', onLogin);
  $('logout-btn').addEventListener('click', async () => { setMsg('login-error', ''); await db.auth.signOut(); });
  $('menu-btn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.addEventListener('click', () => showSection(b.dataset.section)));
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => $(b.dataset.close).close()));
  $('patient-search').addEventListener('input', renderPatients);
  $('doctor-search').addEventListener('input', renderDoctors);
  $('appt-filter').addEventListener('change', renderAppointments);
  $('add-patient-btn').addEventListener('click', () => openPatientDialog());
  $('add-doctor-btn').addEventListener('click', () => openDoctorDialog());
  $('add-appt-btn').addEventListener('click', openAppointmentDialog);
  $('patient-form').addEventListener('submit', onPatientSubmit);
  $('doctor-form').addEventListener('submit', onDoctorSubmit);
  $('appointment-form').addEventListener('submit', onAppointmentSubmit);
}

function init() {
  bindEvents();
  const missing = !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY
    || cfg.SUPABASE_URL.includes('YOUR_') || cfg.SUPABASE_KEY.includes('YOUR_');
  if (missing) {
    showLogin();
    setMsg('login-error', 'Open config.js and paste your Supabase project URL and publishable key.');
    $('login-btn').disabled = true;
    return;
  }
  db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  // setTimeout avoids calling Supabase inside its own auth callback (can deadlock)
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') setTimeout(() => routeSession(session), 0);
    else if (event === 'SIGNED_OUT') showLogin();
  });
}

init();