'use strict';
// ---------- Storage ----------
const KEY = 'quizhub_db_v1', SES = 'quizhub_session', RUN = 'quizhub_inprogress';
const { uid } = Core;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { toast('Could not save – browser storage is unavailable'); } },
  del: k => { try { localStorage.removeItem(k); } catch { } }
};
let db = Core.migrate(store.get(KEY));
const save = () => store.set(KEY, JSON.stringify(db));
save();
let me = db.users.find(u => u.id === store.get(SES)) || null;
let view = '', timerId = null, ui = {};

const $ = id => document.getElementById(id);
const app = $('app');
let toastT;
function toast(m) { const t = $('toast'); t.textContent = m; t.className = 'show'; clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 2500); }
const byId = (arr, id) => arr.find(x => x.id === id);
const fmt = t => new Date(t).toLocaleString();

// ---------- Auth ----------
function renderLogin(mode = 'login') {
  app.innerHTML = `<div class="login-wrap"><div class="login">
    <h1>🎓 QuizHub</h1><p class="mu" style="text-align:center">Quiz Management System</p>
    <div class="tabs"><button class="${mode === 'login' ? 'on' : ''}" onclick="renderLogin('login')">Login</button>
    <button class="${mode === 'reg' ? 'on' : ''}" onclick="renderLogin('reg')">Register</button></div>
    <form onsubmit="return ${mode === 'login' ? 'doLogin' : 'doRegister'}(event)">
      ${mode === 'reg' ? `<label for="f_name">Full name</label><input id="f_name" required>` : ''}
      <label for="f_user">Username</label><input id="f_user" required autocomplete="username">
      <label for="f_pass">Password</label><input id="f_pass" type="password" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
      ${mode === 'reg' ? `<label for="f_role">I am a</label><select id="f_role"><option value="student">Student</option><option value="teacher">Teacher</option></select>` : ''}
      <button style="width:100%">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
    </form>
    <div class="demo">Demo logins (click to fill):<br>
      <a onclick="fill('admin','admin123')">admin</a> · <a onclick="fill('teacher','teacher123')">teacher</a> · <a onclick="fill('student','student123')">student</a></div>
  </div></div>`;
}
function fill(u, p) { $('f_user').value = u; $('f_pass').value = p; }
function doLogin(e) {
  e.preventDefault();
  const u = db.users.find(x => x.username.toLowerCase() === $('f_user').value.trim().toLowerCase());
  if (!Core.checkPassword(u, $('f_pass').value)) return toast('Invalid username or password'), false;
  me = u; store.set(SES, u.id); view = ''; ui = {}; render(); resumeQuiz(); return false;
}
function doRegister(e) {
  e.preventDefault();
  const data = { name: $('f_name').value.trim(), username: $('f_user').value.trim(), password: $('f_pass').value };
  const err = Core.validateUser(data);
  if (err) return toast(err), false;
  if (db.users.some(x => x.username.toLowerCase() === data.username.toLowerCase())) return toast('Username already taken'), false;
  const role = $('f_role').value === 'teacher' ? 'teacher' : 'student';
  db.users.push({ id: uid(), name: data.name, username: data.username, role, ...Core.makeCreds(data.password) });
  save(); toast('Account created – please log in'); renderLogin('login'); $('f_user').value = data.username; return false;
}
function logout() { clearInterval(timerId); store.del(SES); me = null; view = ''; ui = {}; renderLogin(); }

// ---------- Shell ----------
const NAV = {
  admin: [['dash', '📊 Dashboard'], ['users', '👥 Users'], ['quizzes', '📝 All Quizzes'], ['edit', '➕ New Quiz'], ['results', '🏆 All Results'], ['profile', '⚙️ Profile']],
  teacher: [['dash', '📊 Dashboard'], ['myq', '📝 My Quizzes'], ['edit', '➕ New Quiz'], ['results', '🏆 Results'], ['profile', '⚙️ Profile']],
  student: [['dash', '📊 Dashboard'], ['avail', '📚 Available Quizzes'], ['results', '🏆 My Results'], ['profile', '⚙️ Profile']]
};
function go(v, extra) {
  if (view === 'take' && v !== 'take' && v !== 'review' && !confirm('Leave this quiz? Your progress will be kept until the timer runs out.')) return;
  clearInterval(timerId); view = v; ui = extra || {}; render();
}
function render() {
  if (!me) return renderLogin();
  if (!view || !Core.canView(me.role, view)) { view = 'dash'; ui = {}; }
  const nav = NAV[me.role].map(([k, l]) => `<button class="${view === k ? 'on' : ''}" onclick="go('${k}')">${l}</button>`).join('');
  app.innerHTML = `<div class="layout"><aside class="side"><h2>🎓 QuizHub</h2>
    <div><span class="role">${me.role}</span><div>${esc(me.name)}</div></div><br>${nav}<div class="sp"></div>
    <button onclick="logout()">🚪 Logout</button></aside><main class="main" id="main"></main></div>`;
  const fn = { dash, users, quizzes, results, myq, edit, avail, take, review, board, profile }[view];
  let html;
  try { html = fn(); } catch (err) { console.error(err); view = 'dash'; ui = {}; html = dash(); toast('That page could not be opened'); }
  $('main').innerHTML = html;
}
function denied(msg = 'You do not have access to that item') { toast(msg); view = 'dash'; ui = {}; return dash(); }

// ---------- Helpers ----------
const pct = a => Core.percent(a.score, a.total);
const badge = a => `<span class="badge ${Core.grade(pct(a))}">${pct(a)}%</span>`;
const stat = (n, l) => `<div class="stat"><b>${n}</b>${l}</div>`;
const avg = Core.average;
const visibleAttempts = () => db.attempts.filter(a => Core.canSeeAttempt(me, a, byId(db.quizzes, a.quizId)));

// ---------- Dashboard ----------
function dash() {
  if (me.role === 'admin') return `<h1>Admin Dashboard</h1><div class="grid">
    ${stat(db.users.filter(u => u.role === 'student').length, 'Students')}${stat(db.users.filter(u => u.role === 'teacher').length, 'Teachers')}
    ${stat(db.quizzes.length, 'Quizzes')}${stat(db.attempts.length, 'Attempts')}${stat(avg(db.attempts) + '%', 'Average score')}</div>
    <div class="card" style="margin-top:1rem"><h3>Recent attempts</h3>${attemptTable(db.attempts.slice(-8).reverse(), true)}</div>`;
  if (me.role === 'teacher') {
    const mine = db.quizzes.filter(q => q.teacherId === me.id), att = db.attempts.filter(a => mine.some(q => q.id === a.quizId));
    return `<h1>Welcome, ${esc(me.name)}</h1><div class="grid">${stat(mine.length, 'My quizzes')}${stat(mine.filter(q => q.published).length, 'Published')}
    ${stat(att.length, 'Submissions')}${stat(avg(att) + '%', 'Class average')}</div>
    <div class="card" style="margin-top:1rem"><h3>Latest submissions</h3>${attemptTable(att.slice(-8).reverse(), true)}</div>`;
  }
  const mine = db.attempts.filter(a => a.userId === me.id);
  const run = getRun();
  return `<h1>Hello, ${esc(me.name)} 👋</h1>
    ${run ? `<div class="card notice row between"><span>You have a quiz in progress: <b>${esc(byId(db.quizzes, run.id)?.title)}</b></span><button onclick="resumeQuiz()">Resume</button></div>` : ''}
    <div class="grid">${stat(mine.length, 'Quizzes taken')}${stat(avg(mine) + '%', 'Average score')}
    ${stat(db.quizzes.filter(q => q.published && !mine.some(a => a.quizId === q.id)).length, 'Quizzes to do')}</div>
    <div class="card" style="margin-top:1rem"><h3>Recent results</h3>${attemptTable(mine.slice(-5).reverse(), false)}</div>`;
}
function attemptTable(list, showUser) {
  if (!list.length) return '<p class="mu">Nothing here yet.</p>';
  return `<div class="tw"><table><tr>${showUser ? '<th>Student</th>' : ''}<th>Quiz</th><th>Score</th><th>Result</th><th>Date</th><th></th></tr>${list.map(a => {
    const q = byId(db.quizzes, a.quizId), u = byId(db.users, a.userId);
    return `<tr>${showUser ? `<td>${esc(u?.name || '?')}</td>` : ''}<td>${esc(q?.title || '(deleted)')}</td><td>${a.score}/${a.total}</td><td>${badge(a)}</td><td>${fmt(a.date)}</td>
    <td>${q ? `<button class="sm sec" onclick="go('review',{id:'${a.id}'})">Review</button>` : ''}</td></tr>`;
  }).join('')}</table></div>`;
}

// ---------- Admin: users ----------
function users() {
  return `<h1>User Management</h1><div class="card"><div class="tw"><table><tr><th>Name</th><th>Username</th><th>Role</th><th>Actions</th></tr>
  ${db.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td>
  <td><select aria-label="Role" style="margin:0;width:auto" onchange="setRole('${u.id}',this.value)" ${u.id === me.id ? 'disabled' : ''}>
  ${['student', 'teacher', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
  <td><div class="row"><button class="sm sec" onclick="resetPw('${u.id}')">Reset password</button>
  ${u.id !== me.id ? `<button class="sm danger" onclick="delUser('${u.id}')">Delete</button>` : ''}</div></td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>Add user</h3><form onsubmit="return addUser(event)" class="row">
  <input id="n_name" placeholder="Full name" aria-label="Full name" required style="flex:1"><input id="n_user" placeholder="Username" aria-label="Username" required style="flex:1">
  <input id="n_pass" placeholder="Password" aria-label="Password" required style="flex:1"><select id="n_role" aria-label="Role" style="flex:1"><option>student</option><option>teacher</option><option>admin</option></select>
  <button>Add</button></form></div>`;
}
function setRole(id, r) {
  if (id === me.id || !['student', 'teacher', 'admin'].includes(r)) return;
  byId(db.users, id).role = r; save(); toast('Role updated');
}
function resetPw(id) {
  const p = prompt('New password (min 6 characters):');
  if (p === null) return;
  if (p.length < 6) return toast('Password must be at least 6 characters');
  Object.assign(byId(db.users, id), Core.makeCreds(p)); save(); toast('Password reset');
}
function delUser(id) {
  if (id === me.id || !confirm('Delete this user and their attempts? Their quizzes will be transferred to you.')) return;
  db.users = db.users.filter(u => u.id !== id);
  db.attempts = db.attempts.filter(a => a.userId !== id);
  db.quizzes.forEach(q => { if (q.teacherId === id) q.teacherId = me.id; });
  save(); render(); toast('User deleted');
}
function addUser(e) {
  e.preventDefault();
  const data = { name: $('n_name').value.trim(), username: $('n_user').value.trim(), password: $('n_pass').value };
  const err = Core.validateUser(data);
  if (err) return toast(err), false;
  if (db.users.some(u => u.username.toLowerCase() === data.username.toLowerCase())) return toast('Username taken'), false;
  db.users.push({ id: uid(), name: data.name, username: data.username, role: $('n_role').value, ...Core.makeCreds(data.password) });
  save(); render(); toast('User added'); return false;
}

// ---------- Profile ----------
function profile() {
  return `<h1>My Profile</h1><div class="card" style="max-width:480px"><p><b>${esc(me.name)}</b><br><span class="mu">@${esc(me.username)} · ${me.role}</span></p>
  <h3>Change password</h3><form onsubmit="return changePw(event)">
  <label for="p_old">Current password</label><input id="p_old" type="password" required autocomplete="current-password">
  <label for="p_new">New password</label><input id="p_new" type="password" required autocomplete="new-password">
  <label for="p_new2">Confirm new password</label><input id="p_new2" type="password" required autocomplete="new-password">
  <button>Update password</button></form></div>`;
}
function changePw(e) {
  e.preventDefault();
  if (!Core.checkPassword(me, $('p_old').value)) return toast('Current password is incorrect'), false;
  const p = $('p_new').value;
  if (p.length < 6) return toast('Password must be at least 6 characters'), false;
  if (p !== $('p_new2').value) return toast('Passwords do not match'), false;
  Object.assign(me, Core.makeCreds(p)); save(); toast('Password updated'); render(); return false;
}

// ---------- Quizzes list (admin & teacher) ----------
const quizzes = () => quizList(db.quizzes, 'All Quizzes');
const myq = () => quizList(db.quizzes.filter(q => q.teacherId === me.id), 'My Quizzes');
function quizList(list, title) {
  const n = id => db.attempts.filter(a => a.quizId === id).length;
  return `<h1>${title}</h1><p><button onclick="go('edit')">➕ New quiz</button></p>
  <div class="card">${!list.length ? '<p class="mu">No quizzes yet.</p>' : `<div class="tw"><table><tr><th>Title</th><th>Subject</th><th>Qs</th><th>Time</th><th>Author</th><th>Attempts</th><th>Status</th><th></th></tr>
  ${list.map(q => `<tr><td>${esc(q.title)}</td><td>${esc(q.subject)}</td><td>${q.questions.length}</td><td>${q.duration} min</td>
  <td>${esc(byId(db.users, q.teacherId)?.name || '?')}</td><td>${n(q.id)}</td><td><span class="badge ${q.published ? 'ok' : 'warn'}">${q.published ? 'Published' : 'Draft'}</span></td>
  <td><div class="row"><button class="sm sec" onclick="togglePub('${q.id}')">${q.published ? 'Unpublish' : 'Publish'}</button>
  <button class="sm sec" onclick="go('board',{id:'${q.id}'})">Leaderboard</button>
  <button class="sm sec" onclick="go('edit',{id:'${q.id}'})">Edit</button><button class="sm danger" onclick="delQuiz('${q.id}')">Delete</button></div></td></tr>`).join('')}</table></div>`}</div>`;
}
function togglePub(id) {
  const q = byId(db.quizzes, id);
  if (!Core.canEditQuiz(me, q)) return toast('You can only manage your own quizzes');
  q.published = !q.published; save(); render(); toast(q.published ? 'Quiz published' : 'Quiz unpublished');
}
function delQuiz(id) {
  if (!Core.canEditQuiz(me, byId(db.quizzes, id))) return toast('You can only manage your own quizzes');
  if (!confirm('Delete quiz and its results?')) return;
  db.quizzes = db.quizzes.filter(q => q.id !== id); db.attempts = db.attempts.filter(a => a.quizId !== id); save(); render(); toast('Quiz deleted');
}

// ---------- Quiz editor ----------
function edit() {
  if (!ui.draft) {
    const q = ui.id && byId(db.quizzes, ui.id);
    if (ui.id && !Core.canEditQuiz(me, q)) return denied('You can only edit your own quizzes');
    ui.draft = q ? JSON.parse(JSON.stringify(q)) : { id: uid(), title: '', subject: '', duration: 10, teacherId: me.id, published: false, shuffle: false, questions: [newQ()] };
  }
  const d = ui.draft, taken = db.attempts.some(a => a.quizId === d.id);
  return `<h1>${ui.id ? 'Edit' : 'New'} Quiz</h1>
  ${taken ? '<div class="card notice">⚠️ This quiz already has submissions. Changing answers will not re-grade earlier attempts.</div>' : ''}
  <div class="card">
  <label for="e_title">Title</label><input id="e_title" value="${esc(d.title)}"><label for="e_subj">Subject</label><input id="e_subj" value="${esc(d.subject)}">
  <label for="e_dur">Duration (minutes)</label><input id="e_dur" type="number" min="1" max="300" value="${d.duration}">
  <label class="chk"><input id="e_shuf" type="checkbox" ${d.shuffle ? 'checked' : ''}> Shuffle question order for each student</label>
  <label class="chk"><input id="e_pub" type="checkbox" ${d.published ? 'checked' : ''}> Published (visible to students)</label></div>
  ${d.questions.map((q, i) => `<div class="qedit"><div class="row between"><b>Question ${i + 1}</b>
  <span class="row">${i > 0 ? `<button class="sm sec" onclick="mvQ(${i},-1)" aria-label="Move up">↑</button>` : ''}${i < d.questions.length - 1 ? `<button class="sm sec" onclick="mvQ(${i},1)" aria-label="Move down">↓</button>` : ''}
  <button class="sm danger" onclick="rmQ(${i})">Remove</button></span></div>
  <label>Question text</label><input value="${esc(q.text)}" oninput="ui.draft.questions[${i}].text=this.value">
  ${q.options.map((o, j) => `<div class="row"><input type="radio" aria-label="Mark option ${j + 1} correct" name="ans${i}" style="width:auto;margin:0" ${q.answer === j ? 'checked' : ''} onchange="ui.draft.questions[${i}].answer=${j}">
  <input value="${esc(o)}" placeholder="Option ${j + 1}" oninput="ui.draft.questions[${i}].options[${j}]=this.value" style="flex:1"></div>`).join('')}
  <span class="mu">Select the radio button beside the correct answer.</span></div>`).join('')}
  <div class="row"><button class="sec" onclick="addQ()">➕ Add question</button><button onclick="saveQuiz()">💾 Save quiz</button>
  <button class="sec" onclick="go('${me.role === 'admin' ? 'quizzes' : 'myq'}')">Cancel</button></div>`;
}
const newQ = () => ({ id: uid(), text: '', options: ['', '', '', ''], answer: 0 });
function syncHead() {
  const d = ui.draft; d.title = $('e_title').value; d.subject = $('e_subj').value; d.duration = +$('e_dur').value;
  d.shuffle = $('e_shuf').checked; d.published = $('e_pub').checked;
}
function addQ() { syncHead(); ui.draft.questions.push(newQ()); render(); }
function rmQ(i) { syncHead(); ui.draft.questions.splice(i, 1); render(); }
function mvQ(i, d) { syncHead(); const a = ui.draft.questions; [a[i], a[i + d]] = [a[i + d], a[i]]; render(); }
function saveQuiz() {
  syncHead(); const d = ui.draft;
  d.title = d.title.trim(); d.subject = d.subject.trim();
  const err = Core.validateQuiz(d);
  if (err) return toast(err);
  const i = db.quizzes.findIndex(q => q.id === d.id);
  if (i >= 0) { if (!Core.canEditQuiz(me, db.quizzes[i])) return toast('You can only edit your own quizzes'); db.quizzes[i] = d; }
  else db.quizzes.push(d);
  save(); toast('Quiz saved'); go(me.role === 'admin' ? 'quizzes' : 'myq');
}

// ---------- Results ----------
function results() {
  const list = visibleAttempts();
  return `<div class="row between"><h1>${me.role === 'student' ? 'My Results' : 'Results'}</h1>
  ${list.length ? '<button class="sec" onclick="exportCSV()">⬇ Export CSV</button>' : ''}</div>
  <div class="card">${attemptTable(list.slice().reverse(), me.role !== 'student')}</div>`;
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
  return `<h1>🏅 Leaderboard: ${esc(q.title)}</h1><div class="card">${!list.length ? '<p class="mu">No attempts yet.</p>' :
    `<div class="tw"><table><tr><th>#</th><th>Student</th><th>Best score</th><th>Result</th><th>Date</th></tr>${list.map((a, i) => {
      const u = byId(db.users, a.userId);
      return `<tr class="${a.userId === me.id ? 'mine' : ''}"><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td>${esc(u?.name || '?')}</td><td>${a.score}/${a.total}</td><td>${badge(a)}</td><td>${fmt(a.date)}</td></tr>`;
    }).join('')}</table></div>`}</div>
  <button class="sec" onclick="go('${me.role === 'student' ? 'avail' : me.role === 'admin' ? 'quizzes' : 'myq'}')">← Back</button>`;
}

// ---------- Student ----------
function avail() {
  const term = (ui.q || '').toLowerCase();
  const list = db.quizzes.filter(q => q.published && q.questions.length && (q.title + ' ' + q.subject).toLowerCase().includes(term));
  return `<h1>Available Quizzes</h1><input id="s_q" placeholder="🔍 Search by title or subject" aria-label="Search quizzes" value="${esc(ui.q || '')}"
  oninput="ui.q=this.value;const p=this.selectionStart;render();$('s_q').focus();$('s_q').setSelectionRange(p,p)">
  <div class="grid">${list.map(q => {
    const best = Core.leaderboard(db.attempts.filter(a => a.userId === me.id), q.id)[0];
    return `<div class="card"><h3>${esc(q.title)}</h3><p class="mu">${esc(q.subject)} · ${q.questions.length} questions · ${q.duration} min</p>
    ${best ? `<p>Best: ${badge(best)}</p>` : ''}<div class="row"><button onclick="startQuiz('${q.id}')">${best ? 'Retake' : 'Start'} quiz</button>
    <button class="sec" onclick="go('board',{id:'${q.id}'})">Leaderboard</button></div></div>`;
  }).join('') || '<p class="mu">No quizzes found.</p>'}</div>`;
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
  if (el) { el.textContent = '⏱ ' + Core.formatTime(left); el.className = 'timer' + (left < 30000 ? ' low' : ''); }
  if (left <= 0) { toast("Time's up! Your quiz was submitted."); submitQuiz(); }
}
function take() {
  const q = byId(db.quizzes, ui.id), n = ui.order.length, cur = byId(q.questions, ui.order[ui.idx]);
  const done = Object.keys(ui.answers).length;
  return `<div class="row between"><h1>${esc(q.title)}</h1><span id="timer" class="timer"></span></div>
  <div class="bar"><i style="width:${(ui.idx + 1) / n * 100}%"></i></div>
  <div class="dots">${ui.order.map((id, i) => `<button class="dot ${i === ui.idx ? 'cur' : ''} ${ui.answers[id] !== undefined ? 'done' : ''}" onclick="jump(${i})" aria-label="Question ${i + 1}">${i + 1}</button>`).join('')}</div>
  <div class="card"><p class="mu">Question ${ui.idx + 1} of ${n} · ${done} answered</p><h3>${esc(cur.text)}</h3>
  ${cur.options.map((o, j) => `<button class="opt ${ui.answers[cur.id] === j ? 'sel' : ''}" onclick="pick('${cur.id}',${j})">${String.fromCharCode(65 + j)}. ${esc(o)}</button>`).join('')}</div>
  <div class="row"><button class="sec" ${ui.idx === 0 ? 'disabled' : ''} onclick="jump(ui.idx-1)">← Previous</button>
  ${ui.idx < n - 1 ? `<button onclick="jump(ui.idx+1)">Next →</button>` : ''}
  <button class="${ui.idx < n - 1 ? 'sec' : ''}" onclick="confirmSubmit()">Submit ✔</button></div>`;
}
function pick(qid, j) { ui.answers[qid] = j; saveRun(); render(); tick(); }
function jump(i) { if (i < 0 || i >= ui.order.length) return; ui.idx = i; saveRun(); render(); tick(); }
function confirmSubmit() {
  const left = ui.order.length - Object.keys(ui.answers).length;
  if (confirm(left ? `You have ${left} unanswered question(s). Submit anyway?` : 'Submit quiz?')) submitQuiz();
}
function submitQuiz() {
  clearInterval(timerId);
  const q = byId(db.quizzes, ui.id);
  const { score, total } = Core.scoreAttempt(q, ui.answers);
  const a = { id: uid(), userId: me.id, quizId: q.id, score, total, answers: ui.answers, date: Date.now() };
  db.attempts.push(a); save(); store.del(RUN);
  view = 'review'; ui = { id: a.id, fresh: true }; render();
}
function review() {
  const a = byId(db.attempts, ui.id), q = a && byId(db.quizzes, a.quizId);
  if (!q || !Core.canSeeAttempt(me, a, q)) return denied();
  const u = byId(db.users, a.userId);
  return `<h1>${ui.fresh ? 'Quiz complete 🎉' : 'Review'}: ${esc(q.title)}</h1><div class="card"><div class="big">${a.score}/${a.total} (${pct(a)}%)</div>
  <p class="mu" style="text-align:center">${me.role !== 'student' ? esc(u?.name || '?') + ' · ' : ''}${fmt(a.date)}</p></div>
  ${q.questions.map((x, i) => `<div class="card"><b>${i + 1}. ${esc(x.text)}</b>${x.options.map((o, j) =>
    `<div class="opt ${j === x.answer ? 'right' : a.answers[x.id] === j ? 'wrong' : ''}">${esc(o)}${j === x.answer ? ' ✔' : a.answers[x.id] === j ? ' ✖ (your answer)' : ''}</div>`).join('')}
    ${a.answers[x.id] === undefined ? '<span class="badge warn">Unanswered</span>' : ''}</div>`).join('')}
  <div class="row"><button onclick="go('results')">Back to results</button>${me.role === 'student' ? `<button class="sec" onclick="go('board',{id:'${q.id}'})">Leaderboard</button>` : ''}</div>`;
}

render();
if (me) resumeQuiz();
