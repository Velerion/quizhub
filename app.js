'use strict';
// ---------- Backend (Supabase) ----------
// The publishable key only allows calling the api_* RPC functions; every function checks the session token and role server-side.
const SUPABASE_URL = 'https://qgkplcyrpehnwoftbeqh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_udjYYHyXpWrr3iGtjuUQMg_oY0rpzY1';
const TOKEN = 'quizhub_token', RUN = 'quizhub_inprogress';
const { uid } = Core;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { } },
  del: k => { try { localStorage.removeItem(k); } catch { } }
};
let db = { users: [], quizzes: [], attempts: [] };
let me = null, view = '', timerId = null, ui = {}, busy = false;

async function rpc(fn, args = {}, withToken = true) {
  const body = withToken ? { p_token: store.get(TOKEN), ...args } : args;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch { throw new Error('Cannot reach the server. Check your connection.'); }
  const text = await res.text(), data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (data?.code === '28000') { store.del(TOKEN); me = null; renderLogin(); }
    throw new Error(data?.message || 'Something went wrong');
  }
  return data;
}
async function sync() {
  const s = await rpc('api_state');
  me = s.me; db = { users: s.users, quizzes: s.quizzes, attempts: s.attempts };
}
// Run a server action with a busy guard; errors become a toast.
async function act(fn) {
  if (busy) return;
  busy = true; document.body.classList.add('busy');
  try { await fn(); } catch (err) { toast(err.message); } finally { busy = false; document.body.classList.remove('busy'); }
}

const $ = id => document.getElementById(id);
const app = $('app');
let toastT;
function toast(m) { const t = $('toast'); t.textContent = m; t.className = 'show'; clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 3000); }
const byId = (arr, id) => arr.find(x => x.id === id);
const fmt = t => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t));

// ---------- Auth ----------
function renderLogin(mode = 'login') {
  const reg = mode === 'reg';
  app.innerHTML = `<div class="entry">
    <section class="entry-art">
      <p class="wordmark">QuizHub</p>
      <h1>Quizzes that mark themselves.</h1>
      <p class="lede">Teachers publish timed multiple-choice quizzes; students sit them in any browser and see their score and every correct answer the moment they submit.</p>
      <dl class="facts"><div><dt>Grading</dt><dd>On the server, instantly</dd></div><div><dt>Roles</dt><dd>Admin, teacher, student</dd></div><div><dt>Results</dt><dd>Leaderboards and CSV export</dd></div></dl>
    </section>
    <section class="entry-form">
      <div class="form-box">
        <h2>${reg ? 'Create an account' : 'Sign in'}</h2>
        <p class="note">${reg ? 'Already registered?' : 'New here?'} <button type="button" class="link" onclick="renderLogin('${reg ? 'login' : 'reg'}')">${reg ? 'Sign in' : 'Create an account'}</button></p>
        <form onsubmit="return ${reg ? 'doRegister' : 'doLogin'}(event)">
          ${reg ? `<label for="f_name">Full name</label><input id="f_name" name="name" autocomplete="name" required>` : ''}
          <label for="f_user">Username</label><input id="f_user" name="username" autocomplete="username" spellcheck="false" autocapitalize="none" required>
          <label for="f_pass">Password</label><input id="f_pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required>
          ${reg ? `<label for="f_role">I am a</label><select id="f_role" name="role"><option value="student">Student</option><option value="teacher">Teacher</option></select>` : ''}
          <button class="wide">${reg ? 'Create account' : 'Sign in'}</button>
        </form>
        ${reg ? '' : `<div class="demo"><p>Try a demo account</p><div class="row">
          <button type="button" class="sec sm" onclick="fill('admin','admin123')">Admin</button>
          <button type="button" class="sec sm" onclick="fill('teacher','teacher123')">Teacher</button>
          <button type="button" class="sec sm" onclick="fill('student','student123')">Student</button></div></div>`}
      </div>
    </section></div>`;
}
function fill(u, p) { $('f_user').value = u; $('f_pass').value = p; }
function doLogin(e) {
  e.preventDefault();
  act(async () => {
    const { token } = await rpc('api_login', { p_username: $('f_user').value, p_password: $('f_pass').value }, false);
    store.set(TOKEN, token); await sync(); view = ''; ui = {}; render(); resumeQuiz();
  });
  return false;
}
function doRegister(e) {
  e.preventDefault();
  const data = { name: $('f_name').value.trim(), username: $('f_user').value.trim(), password: $('f_pass').value };
  const err = Core.validateUser(data);
  if (err) return toast(err), false;
  act(async () => {
    await rpc('api_register', { p_name: data.name, p_username: data.username, p_password: data.password, p_role: $('f_role').value }, false);
    toast('Account created. Sign in to continue.'); renderLogin('login'); $('f_user').value = data.username; $('f_pass').focus();
  });
  return false;
}
function logout() {
  clearInterval(timerId); rpc('api_logout').catch(() => { });
  store.del(TOKEN); me = null; view = ''; ui = {}; db = { users: [], quizzes: [], attempts: [] }; renderLogin();
}

// ---------- Shell ----------
const NAV = {
  admin: [['dash', 'Dashboard'], ['users', 'Users'], ['quizzes', 'All quizzes'], ['edit', 'New quiz'], ['results', 'All results'], ['profile', 'Profile']],
  teacher: [['dash', 'Dashboard'], ['myq', 'My quizzes'], ['edit', 'New quiz'], ['results', 'Results'], ['profile', 'Profile']],
  student: [['dash', 'Dashboard'], ['avail', 'Quizzes'], ['results', 'My results'], ['profile', 'Profile']]
};
const LIVE = ['dash', 'results', 'avail', 'board', 'quizzes', 'myq'];
function go(v, extra) {
  if (view === 'take' && v !== 'take' && v !== 'review' && !confirm('Leave this quiz? Your answers are kept until the timer runs out.')) return;
  if (view === 'edit' && ui.dirty && !confirm('Discard your unsaved changes to this quiz?')) return;
  clearInterval(timerId); view = v; ui = extra || {}; render();
  if (!extra && location.hash !== '#' + v) history.pushState(null, '', '#' + v);
  // Refresh read-only screens in the background so they show other people's latest changes.
  if (LIVE.includes(v)) sync().then(() => { if (view === v && !busy) render(); }).catch(() => { });
}
function render() {
  if (!me) return renderLogin();
  if (!view || !Core.canView(me.role, view)) { view = 'dash'; ui = {}; }
  const nav = NAV[me.role].map(([k, l]) => `<a href="#${k}" class="${view === k ? 'on' : ''}" ${view === k ? 'aria-current="page"' : ''} onclick="go('${k}');return false">${l}</a>`).join('');
  app.innerHTML = `<a class="skip" href="#main">Skip to content</a><div class="layout"><aside class="side"><p class="wordmark">QuizHub</p>
    <div class="who"><b>${esc(me.name)}</b><span>${me.role[0].toUpperCase() + me.role.slice(1)}</span></div>
    <nav aria-label="Main">${nav}</nav><div class="sp"></div>
    <button class="ghost" onclick="logout()">Sign out</button></aside><main class="main" id="main" tabindex="-1"></main></div>`;
  const fn = { dash, users, quizzes, results, myq, edit, avail, take, review, board, profile }[view];
  let html;
  try { html = fn(); } catch (err) { console.error(err); view = 'dash'; ui = {}; html = dash(); toast('That page could not be opened'); }
  $('main').innerHTML = html;
}
function denied(msg = 'You do not have access to that item') { toast(msg); view = 'dash'; ui = {}; return dash(); }

// ---------- Helpers ----------
const pct = a => Core.percent(a.score, a.total);
const badge = a => `<span class="badge ${Core.grade(pct(a))}">${pct(a)}%</span>`;
const stats = list => `<div class="stats">${list.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('')}</div>`;
const avg = Core.average;
const visibleAttempts = () => db.attempts.filter(a => Core.canSeeAttempt(me, a, byId(db.quizzes, a.quizId)));
const head = (title, side = '') => `<header class="page-head"><h1>${title}</h1>${side}</header>`;

// ---------- Dashboard ----------
function dash() {
  if (me.role === 'admin') return head('Overview') + stats([
    [db.users.filter(u => u.role === 'student').length, 'Students'], [db.users.filter(u => u.role === 'teacher').length, 'Teachers'],
    [db.quizzes.length, 'Quizzes'], [db.attempts.length, 'Attempts'], [avg(db.attempts) + '%', 'Average score']]) +
    `<section class="panel"><h2>Recent attempts</h2>${attemptTable(db.attempts.slice(-8).reverse(), true)}</section>`;
  if (me.role === 'teacher') {
    const mine = db.quizzes.filter(q => q.teacherId === me.id), att = db.attempts.filter(a => mine.some(q => q.id === a.quizId));
    return head(`Welcome, ${esc(me.name)}`, `<button onclick="go('edit')">New quiz</button>`) +
      stats([[mine.length, 'Quizzes'], [mine.filter(q => q.published).length, 'Published'], [att.length, 'Submissions'], [avg(att) + '%', 'Class average']]) +
      `<section class="panel"><h2>Latest submissions</h2>${attemptTable(att.slice(-8).reverse(), true)}</section>`;
  }
  const mine = db.attempts.filter(a => a.userId === me.id);
  const run = getRun();
  return head(`Hello, ${esc(me.name.split(' ')[0])}`, `<button onclick="go('avail')">Find a quiz</button>`) +
    (run ? `<div class="notice"><span>You have a quiz in progress: <b>${esc(byId(db.quizzes, run.id)?.title)}</b></span><button onclick="resumeQuiz()">Resume</button></div>` : '') +
    stats([[mine.length, 'Quizzes taken'], [avg(mine) + '%', 'Average score'], [db.quizzes.filter(q => !mine.some(a => a.quizId === q.id)).length, 'Still to do']]) +
    `<section class="panel"><h2>Recent results</h2>${attemptTable(mine.slice(-5).reverse(), false)}</section>`;
}
function attemptTable(list, showUser) {
  if (!list.length) return '<p class="empty">No attempts yet.</p>';
  return `<div class="tw"><table><thead><tr>${showUser ? '<th scope="col">Student</th>' : ''}<th scope="col">Quiz</th><th scope="col" class="num">Score</th><th scope="col">Result</th><th scope="col">Date</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${list.map(a => {
    const q = byId(db.quizzes, a.quizId), u = byId(db.users, a.userId);
    return `<tr>${showUser ? `<td>${esc(u?.name || 'Unknown')}</td>` : ''}<td class="clip">${esc(q?.title || '(deleted)')}</td><td class="num">${a.score}/${a.total}</td><td>${badge(a)}</td><td>${fmt(a.date)}</td>
    <td class="end">${q ? `<button class="sm sec" onclick="go('review',{id:'${a.id}'})">Review</button>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// ---------- Admin: users ----------
function users() {
  return head('Users') + `<section class="panel"><div class="tw"><table><thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>
  ${db.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td>
  <td><select aria-label="Role for ${esc(u.name)}" class="inline" onchange="setRole('${u.id}',this.value)" ${u.id === me.id ? 'disabled' : ''}>
  ${['student', 'teacher', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></td>
  <td class="end"><div class="row end"><button class="sm sec" onclick="resetPw('${u.id}')">Reset password</button>
  ${u.id !== me.id ? `<button class="sm danger" onclick="delUser('${u.id}')">Delete</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel"><h2>Add a user</h2><form onsubmit="return addUser(event)" class="grid-form">
  <div><label for="n_name">Full name</label><input id="n_name" name="name" autocomplete="off" required></div>
  <div><label for="n_user">Username</label><input id="n_user" name="username" autocomplete="off" spellcheck="false" required></div>
  <div><label for="n_pass">Password</label><input id="n_pass" name="password" type="password" autocomplete="new-password" required></div>
  <div><label for="n_role">Role</label><select id="n_role" name="role"><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></div>
  <div class="align-end"><button>Add user</button></div></form></section>`;
}
function setRole(id, r) { act(async () => { await rpc('api_set_role', { p_user: id, p_role: r }); await sync(); render(); toast('Role updated'); }); }
function resetPw(id) {
  const p = prompt('New password (at least 6 characters):');
  if (p === null) return;
  act(async () => { await rpc('api_reset_password', { p_user: id, p_password: p }); toast('Password reset'); });
}
function delUser(id) {
  if (!confirm('Delete this user and their attempts? Their quizzes will be transferred to you.')) return;
  act(async () => { await rpc('api_delete_user', { p_user: id }); await sync(); render(); toast('User deleted'); });
}
function addUser(e) {
  e.preventDefault();
  const data = { name: $('n_name').value.trim(), username: $('n_user').value.trim(), password: $('n_pass').value };
  const err = Core.validateUser(data);
  if (err) return toast(err), false;
  act(async () => {
    await rpc('api_add_user', { p_name: data.name, p_username: data.username, p_password: data.password, p_role: $('n_role').value });
    await sync(); render(); toast('User added');
  });
  return false;
}

// ---------- Profile ----------
function profile() {
  return head('Profile') + `<section class="panel narrow"><p class="who-line"><b>${esc(me.name)}</b> · @${esc(me.username)} · ${me.role}</p>
  <h2>Change password</h2><form onsubmit="return changePw(event)">
  <label for="p_old">Current password</label><input id="p_old" type="password" required autocomplete="current-password">
  <label for="p_new">New password</label><input id="p_new" type="password" required autocomplete="new-password">
  <label for="p_new2">Confirm new password</label><input id="p_new2" type="password" required autocomplete="new-password">
  <button>Update password</button></form></section>`;
}
function changePw(e) {
  e.preventDefault();
  const p = $('p_new').value;
  if (p !== $('p_new2').value) return toast('The new passwords do not match'), false;
  act(async () => { await rpc('api_change_password', { p_old: $('p_old').value, p_new: p }); toast('Password updated'); render(); });
  return false;
}

// ---------- Quizzes list (admin & teacher) ----------
const quizzes = () => quizList(db.quizzes, 'All quizzes');
const myq = () => quizList(db.quizzes.filter(q => q.teacherId === me.id), 'My quizzes');
function quizList(list, title) {
  const n = id => db.attempts.filter(a => a.quizId === id).length, author = me.role === 'admin';
  return head(title, `<button onclick="go('edit')">New quiz</button>`) +
  `<section class="panel">${!list.length ? '<p class="empty">No quizzes yet. Create the first one.</p>' : `<div class="tw"><table><thead><tr><th scope="col">Title</th><th scope="col">Subject</th><th scope="col" class="num">Questions</th><th scope="col" class="num">Time</th>${author ? '<th scope="col">Author</th>' : ''}<th scope="col" class="num">Attempts</th><th scope="col">Status</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>
  ${list.map(q => `<tr><td class="clip">${esc(q.title)}</td><td>${esc(q.subject)}</td><td class="num">${q.questions.length}</td><td class="num">${q.duration} min</td>
  ${author ? `<td>${esc(byId(db.users, q.teacherId)?.name || 'Unknown')}</td>` : ''}<td class="num">${n(q.id)}</td><td><span class="badge ${q.published ? 'ok' : 'warn'}">${q.published ? 'Published' : 'Draft'}</span></td>
  <td class="end"><div class="row end nowrap"><button class="sm sec" onclick="togglePub('${q.id}')">${q.published ? 'Unpublish' : 'Publish'}</button>
  <button class="sm sec" onclick="go('board',{id:'${q.id}'})">Leaderboard</button>
  <button class="sm sec" onclick="go('edit',{id:'${q.id}'})">Edit</button><button class="sm danger" onclick="delQuiz('${q.id}')">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`}</section>`;
}
function togglePub(id) {
  const q = byId(db.quizzes, id);
  act(async () => { await rpc('api_set_published', { p_id: id, p_published: !q.published }); await sync(); render(); toast(!q.published ? 'Quiz published' : 'Quiz unpublished'); });
}
function delQuiz(id) {
  if (!confirm('Delete this quiz and all of its results?')) return;
  act(async () => { await rpc('api_delete_quiz', { p_id: id }); await sync(); render(); toast('Quiz deleted'); });
}

// ---------- Quiz editor ----------
function edit() {
  if (!ui.draft) {
    const q = ui.id && byId(db.quizzes, ui.id);
    if (ui.id && !Core.canEditQuiz(me, q)) return denied('You can only edit your own quizzes');
    ui.draft = q ? JSON.parse(JSON.stringify(q)) : { id: uid(), title: '', subject: '', duration: 10, teacherId: me.id, published: false, shuffle: false, questions: [newQ()] };
  }
  const d = ui.draft, taken = db.attempts.some(a => a.quizId === d.id);
  return head(ui.id ? 'Edit quiz' : 'New quiz') +
  (taken ? '<div class="notice"><span>This quiz already has submissions. Changing answers will not re-grade earlier attempts.</span></div>' : '') +
  `<section class="panel"><div class="grid-form three">
  <div class="span2"><label for="e_title">Title</label><input id="e_title" value="${esc(d.title)}" placeholder="e.g. Software Engineering Fundamentals…"></div>
  <div><label for="e_dur">Duration (minutes)</label><input id="e_dur" type="number" inputmode="numeric" min="1" max="300" value="${d.duration}"></div>
  <div class="span2"><label for="e_subj">Subject</label><input id="e_subj" value="${esc(d.subject)}" placeholder="e.g. Software Engineering…"></div></div>
  <label class="chk"><input id="e_shuf" type="checkbox" ${d.shuffle ? 'checked' : ''}> Shuffle question order for each student</label>
  <label class="chk"><input id="e_pub" type="checkbox" ${d.published ? 'checked' : ''}> Published, so students can see it</label></section>
  ${d.questions.map((q, i) => `<fieldset class="qedit"><legend>Question ${i + 1}</legend><div class="row end q-tools">
  ${i > 0 ? `<button class="sm sec" onclick="mvQ(${i},-1)" aria-label="Move question ${i + 1} up">Move up</button>` : ''}${i < d.questions.length - 1 ? `<button class="sm sec" onclick="mvQ(${i},1)" aria-label="Move question ${i + 1} down">Move down</button>` : ''}
  <button class="sm danger" onclick="rmQ(${i})">Remove</button></div>
  <label for="q_${i}">Question text</label><input id="q_${i}" value="${esc(q.text)}" oninput="ui.draft.questions[${i}].text=this.value">
  <p class="hint">Choose the correct answer with the button beside it.</p>
  ${q.options.map((o, j) => `<div class="optrow"><input type="radio" aria-label="Option ${j + 1} is correct" name="ans${i}" ${q.answer === j ? 'checked' : ''} onchange="ui.draft.questions[${i}].answer=${j}">
  <input aria-label="Option ${j + 1}" value="${esc(o)}" placeholder="Option ${j + 1}" oninput="ui.draft.questions[${i}].options[${j}]=this.value"></div>`).join('')}</fieldset>`).join('')}
  <div class="row"><button class="sec" onclick="addQ()">Add question</button><button onclick="saveQuiz()">Save quiz</button>
  <button class="ghost" onclick="go('${me.role === 'admin' ? 'quizzes' : 'myq'}')">Cancel</button></div>`;
}
const newQ = () => ({ id: uid(), text: '', options: ['', '', '', ''], answer: 0 });
function syncHead() {
  const d = ui.draft; d.title = $('e_title').value; d.subject = $('e_subj').value; d.duration = +$('e_dur').value;
  d.shuffle = $('e_shuf').checked; d.published = $('e_pub').checked;
}
function addQ() { syncHead(); ui.draft.questions.push(newQ()); render(); $(`q_${ui.draft.questions.length - 1}`).focus(); }
function rmQ(i) { syncHead(); ui.draft.questions.splice(i, 1); render(); }
function mvQ(i, d) { syncHead(); const a = ui.draft.questions; [a[i], a[i + d]] = [a[i + d], a[i]]; render(); }
function saveQuiz() {
  syncHead(); const d = ui.draft;
  d.title = d.title.trim(); d.subject = d.subject.trim();
  const err = Core.validateQuiz(d);
  if (err) return toast(err);
  act(async () => { await rpc('api_save_quiz', { p_quiz: d }); await sync(); ui.dirty = false; toast('Quiz saved'); go(me.role === 'admin' ? 'quizzes' : 'myq'); });
}

// ---------- Results ----------
function results() {
  const list = visibleAttempts();
  return head(me.role === 'student' ? 'My results' : 'Results', list.length ? '<button class="sec" onclick="exportCSV()">Export CSV</button>' : '') +
    `<section class="panel">${attemptTable(list.slice().reverse(), me.role !== 'student')}</section>`;
}
function exportCSV() {
  const rows = [['Student', 'Username', 'Quiz', 'Score', 'Total', 'Percent', 'Date']].concat(visibleAttempts().map(a => {
    const u = byId(db.users, a.userId), q = byId(db.quizzes, a.quizId);
    return [u?.name, u?.username, q?.title, a.score, a.total, pct(a), new Date(a.date).toISOString()];
  }));
  const url = URL.createObjectURL(new Blob([Core.toCSV(rows)], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'quizhub-results.csv' });
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function board() {
  const q = byId(db.quizzes, ui.id);
  if (!q || (me.role === 'student' ? !q.published : !Core.canEditQuiz(me, q))) return denied();
  const list = Core.leaderboard(db.attempts, q.id);
  return head(`Leaderboard: ${esc(q.title)}`, `<button class="ghost" onclick="go('${me.role === 'student' ? 'avail' : me.role === 'admin' ? 'quizzes' : 'myq'}')">Back</button>`) +
    `<section class="panel">${!list.length ? '<p class="empty">No attempts yet. Be the first.</p>' :
    `<div class="tw"><table><thead><tr><th scope="col" class="num">Rank</th><th scope="col">Student</th><th scope="col" class="num">Best score</th><th scope="col">Result</th><th scope="col">Date</th></tr></thead><tbody>${list.map((a, i) => {
      const u = byId(db.users, a.userId);
      return `<tr class="${a.userId === me.id ? 'mine' : ''}"><td class="num rank">${i + 1}</td><td>${esc(u?.name || 'Unknown')}${a.userId === me.id ? ' (you)' : ''}</td><td class="num">${a.score}/${a.total}</td><td>${badge(a)}</td><td>${fmt(a.date)}</td></tr>`;
    }).join('')}</tbody></table></div>`}</section>`;
}

// ---------- Student ----------
function avail() {
  const term = (ui.q || '').toLowerCase();
  const list = db.quizzes.filter(q => q.published && q.questions.length && (q.title + ' ' + q.subject).toLowerCase().includes(term));
  return head('Quizzes') + `<label for="s_q" class="sr">Search quizzes</label><input id="s_q" type="search" class="search" placeholder="Search by title or subject…" autocomplete="off" value="${esc(ui.q || '')}"
  oninput="ui.q=this.value;const p=this.selectionStart;render();$('s_q').focus();$('s_q').setSelectionRange(p,p)">
  <div class="quiz-list">${list.map(q => {
    const best = Core.leaderboard(db.attempts.filter(a => a.userId === me.id), q.id)[0];
    return `<article class="quiz"><div><p class="subject">${esc(q.subject)}</p><h2>${esc(q.title)}</h2>
    <p class="meta">${q.questions.length} questions · ${q.duration} minutes${best ? ` · your best ${badge(best)}` : ''}</p></div>
    <div class="row"><button onclick="startQuiz('${q.id}')">${best ? 'Retake' : 'Start'} quiz</button>
    <button class="sec" onclick="go('board',{id:'${q.id}'})">Leaderboard</button></div></article>`;
  }).join('') || '<p class="empty">No quizzes match your search.</p>'}</div>`;
}
// An in-progress attempt is persisted so a page reload or accidental navigation doesn't lose answers.
function getRun() {
  try {
    const r = JSON.parse(store.get(RUN) || 'null'), q = r && byId(db.quizzes, r.id);
    return r && me && r.userId === me.id && q && q.published ? r : null;
  } catch { return null; }
}
const saveRun = () => store.set(RUN, JSON.stringify({ userId: me.id, id: ui.id, answers: ui.answers, idx: ui.idx, end: ui.end, order: ui.order }));
function startQuiz(id) {
  const q = byId(db.quizzes, id);
  if (!q || !q.published || !q.questions.length) return toast('This quiz is not available');
  const run = getRun();
  if (run && run.id !== id && !confirm('You have another quiz in progress. Discard it and start this one?')) return;
  const ids = q.questions.map(x => x.id);
  begin({ id, answers: {}, idx: 0, end: Date.now() + q.duration * 60000, order: q.shuffle ? Core.shuffle(ids) : ids });
}
function resumeQuiz() { const r = getRun(); if (r) begin(r); }
function begin(state) {
  clearInterval(timerId); view = 'take'; ui = state;
  const q = byId(db.quizzes, ui.id);
  ui.order = (ui.order || []).filter(id => byId(q.questions, id)); // drop questions removed since the attempt started
  q.questions.forEach(x => { if (!ui.order.includes(x.id)) ui.order.push(x.id); });
  ui.idx = Math.min(ui.idx || 0, ui.order.length - 1);
  saveRun(); render(); tick();
  timerId = setInterval(tick, 500);
}
function tick() {
  if (view !== 'take') return clearInterval(timerId);
  const left = ui.end - Date.now(), el = $('timer');
  if (el) { el.textContent = Core.formatTime(left); el.className = 'timer' + (left < 30000 ? ' low' : ''); }
  if (left <= 0) { clearInterval(timerId); toast("Time's up. Your quiz was submitted."); submitQuiz(); }
}
function take() {
  const q = byId(db.quizzes, ui.id), n = ui.order.length, cur = byId(q.questions, ui.order[ui.idx]);
  const done = Object.keys(ui.answers).length;
  return `<header class="page-head take-head"><div><p class="subject">${esc(q.subject)}</p><h1>${esc(q.title)}</h1></div>
  <p class="clock"><span class="sr">Time left </span><span id="timer" class="timer" role="timer" aria-live="off"></span></p></header>
  <div class="bar" role="progressbar" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${ui.idx + 1}" aria-label="Question progress"><i style="transform:scaleX(${(ui.idx + 1) / n})"></i></div>
  <nav class="dots" aria-label="Questions">${ui.order.map((id, i) => `<button class="dot ${i === ui.idx ? 'cur' : ''} ${ui.answers[id] !== undefined ? 'done' : ''}" onclick="jump(${i})" aria-label="Question ${i + 1}${ui.answers[id] !== undefined ? ', answered' : ''}" ${i === ui.idx ? 'aria-current="step"' : ''}>${i + 1}</button>`).join('')}</nav>
  <section class="question"><p class="count">Question ${ui.idx + 1} of ${n} · ${done} answered</p><h2>${esc(cur.text)}</h2>
  <div class="opts" role="radiogroup" aria-label="Answers">${cur.options.map((o, j) => `<button class="opt ${ui.answers[cur.id] === j ? 'sel' : ''}" role="radio" aria-checked="${ui.answers[cur.id] === j}" onclick="pick('${cur.id}',${j})"><span class="letter">${String.fromCharCode(65 + j)}</span>${esc(o)}</button>`).join('')}</div></section>
  <div class="row"><button class="sec" ${ui.idx === 0 ? 'disabled' : ''} onclick="jump(ui.idx-1)">Previous</button>
  ${ui.idx < n - 1 ? `<button onclick="jump(ui.idx+1)">Next</button>` : ''}
  <button class="${ui.idx < n - 1 ? 'ghost' : ''}" onclick="confirmSubmit()">Submit quiz</button></div>`;
}
function pick(qid, j) { ui.answers[qid] = j; saveRun(); render(); tick(); }
function jump(i) { if (i < 0 || i >= ui.order.length) return; ui.idx = i; saveRun(); render(); tick(); }
function confirmSubmit() {
  const left = ui.order.length - Object.keys(ui.answers).length;
  if (confirm(left ? `You have ${left} unanswered question${left > 1 ? 's' : ''}. Submit anyway?` : 'Submit your answers?')) submitQuiz();
}
// Grading happens on the server; the client never holds the answer key before submitting.
function submitQuiz() {
  clearInterval(timerId);
  const run = { ...ui };
  act(async () => {
    const res = await rpc('api_submit', { p_quiz_id: run.id, p_answers: run.answers });
    store.del(RUN); await sync();
    view = 'review'; ui = { id: res.id, fresh: true }; render();
  }).then(() => { if (view === 'take') timerId = setInterval(tick, 500); }); // submission failed: keep the attempt running
}
function review() {
  const a = byId(db.attempts, ui.id), q = a && byId(db.quizzes, a.quizId);
  if (!q || !Core.canSeeAttempt(me, a, q)) return denied();
  const u = byId(db.users, a.userId);
  return head(ui.fresh ? 'Submitted' : 'Review') + `<section class="score ${Core.grade(pct(a))}"><p class="subject">${esc(q.title)}</p>
  <p class="big">${a.score}<span>/${a.total}</span></p><p class="meta">${pct(a)}% · ${me.role !== 'student' ? esc(u?.name || 'Unknown') + ' · ' : ''}${fmt(a.date)}</p></section>
  <ol class="answers">${q.questions.map(x => `<li><h2>${esc(x.text)}</h2>${x.options.map((o, j) => {
    const right = j === x.answer, mine = a.answers[x.id] === j;
    return `<div class="opt ${right ? 'right' : mine ? 'wrong' : ''}">${esc(o)}${right ? '<span class="tag">Correct answer</span>' : mine ? '<span class="tag">Your answer</span>' : ''}</div>`;
  }).join('')}${a.answers[x.id] === undefined ? '<span class="badge warn">Not answered</span>' : ''}</li>`).join('')}</ol>
  <div class="row"><button onclick="go('results')">Back to results</button>${me.role === 'student' ? `<button class="sec" onclick="go('board',{id:'${q.id}'})">Leaderboard</button>` : ''}</div>`;
}

// ---------- Start ----------
document.addEventListener('input', () => { if (view === 'edit') ui.dirty = true; });
window.addEventListener('beforeunload', e => { if (view === 'edit' && ui.dirty) e.preventDefault(); });
// Plain screens are addressable by hash (#results, #avail…) so they can be bookmarked and the back button works.
const fromHash = () => location.hash.slice(1);
window.addEventListener('popstate', () => { const v = fromHash(); if (me && v && v !== view && Core.canView(me.role, v) && v !== 'take') { view = v; ui = {}; render(); } });
(async () => {
  if (!store.get(TOKEN)) return renderLogin();
  app.innerHTML = '<p class="loading">Loading…</p>';
  try {
    await sync(); const v = fromHash();
    view = v && v !== 'take' && v !== 'review' && v !== 'board' ? v : ''; render(); resumeQuiz();
  } catch { store.del(TOKEN); renderLogin(); }
})();
