'use strict';
// ---------- QuizHub core: pure, DOM-free logic (shared by the browser app and the unit tests) ----------
(function (root) {
  // Compact synchronous SHA-256 (UTF-8 input, hex output)
  function sha256(msg) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const bytes = Array.from(unescape(encodeURIComponent(msg)), c => c.charCodeAt(0));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < bytes.length; off += 64) {
      const w = new Array(64);
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  const uid = () => Math.random().toString(36).slice(2, 10);
  const hashPassword = (password, salt) => sha256(salt + ':' + password);
  const makeCreds = password => { const salt = uid() + uid(); return { salt, hash: hashPassword(password, salt) }; };
  const checkPassword = (user, password) => !!user && hashPassword(password, user.salt) === user.hash;

  // Scoring
  const percent = (score, total) => total > 0 ? Math.round(score / total * 100) : 0;
  const grade = p => p >= 70 ? 'ok' : p >= 40 ? 'warn' : 'bad';
  function scoreAttempt(quiz, answers) {
    const score = quiz.questions.filter(q => answers[q.id] === q.answer).length;
    return { score, total: quiz.questions.length };
  }
  const average = attempts => attempts.length ? Math.round(attempts.reduce((s, a) => s + percent(a.score, a.total), 0) / attempts.length) : 0;

  // Best attempt per student for a quiz, highest first (ties: earlier attempt wins)
  function leaderboard(attempts, quizId) {
    const best = {};
    for (const a of attempts.filter(x => x.quizId === quizId)) {
      const b = best[a.userId], p = percent(a.score, a.total);
      if (!b || p > percent(b.score, b.total) || (p === percent(b.score, b.total) && a.date < b.date)) best[a.userId] = a;
    }
    return Object.values(best).sort((x, y) => percent(y.score, y.total) - percent(x.score, x.total) || x.date - y.date);
  }

  // Validation
  function validateQuiz(d) {
    if (!d.title || !d.title.trim()) return 'Title is required';
    if (!(d.duration >= 1 && d.duration <= 300)) return 'Duration must be between 1 and 300 minutes';
    if (!d.questions.length) return 'Add at least one question';
    for (let i = 0; i < d.questions.length; i++) {
      const q = d.questions[i];
      if (!q.text.trim()) return `Question ${i + 1} has no text`;
      if (q.options.some(o => !o.trim())) return `Question ${i + 1} has an empty option`;
      if (new Set(q.options.map(o => o.trim().toLowerCase())).size !== q.options.length) return `Question ${i + 1} has duplicate options`;
      if (!(q.answer >= 0 && q.answer < q.options.length)) return `Question ${i + 1} has no correct answer`;
    }
    return null;
  }
  function validateUser({ name, username, password }) {
    if (!name || !name.trim()) return 'Name is required';
    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username || '')) return 'Username must be 3–20 letters, digits, _ or .';
    if (!password || password.length < 6) return 'Password must be at least 6 characters';
    return null;
  }

  // Role-based access control
  const ROUTES = {
    admin: ['dash', 'users', 'quizzes', 'edit', 'results', 'review', 'board', 'profile'],
    teacher: ['dash', 'myq', 'edit', 'results', 'review', 'board', 'profile'],
    student: ['dash', 'avail', 'take', 'results', 'review', 'board', 'profile']
  };
  const canView = (role, view) => (ROUTES[role] || []).includes(view);
  const canEditQuiz = (user, quiz) => !!user && !!quiz && (user.role === 'admin' || (user.role === 'teacher' && quiz.teacherId === user.id));
  function canSeeAttempt(user, attempt, quiz) {
    if (!user || !attempt) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'student') return attempt.userId === user.id;
    return !!quiz && quiz.teacherId === user.id;
  }

  // Utilities
  function shuffle(arr, rnd = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');
  const formatTime = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // Data
  function seed() {
    const user = (id, name, username, password, role) => ({ id, name, username, role, ...makeCreds(password) });
    return {
      version: 2,
      users: [
        user('u1', 'Administrator', 'admin', 'admin123', 'admin'),
        user('u2', 'Prof. Smith', 'teacher', 'teacher123', 'teacher'),
        user('u3', 'Alice Student', 'student', 'student123', 'student')
      ],
      quizzes: [{
        id: 'q1', title: 'General Knowledge Basics', subject: 'General', duration: 5, teacherId: 'u2', published: true, shuffle: false,
        questions: [
          { id: 'a', text: 'What is the capital of France?', options: ['Berlin', 'Paris', 'Rome', 'Madrid'], answer: 1 },
          { id: 'b', text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Jupiter', 'Mars', 'Saturn'], answer: 2 },
          { id: 'c', text: 'What is 12 x 12?', options: ['124', '144', '122', '154'], answer: 1 }
        ]
      }, {
        id: 'q2', title: 'Software Engineering Fundamentals', subject: 'Software Engineering', duration: 10, teacherId: 'u2', published: true, shuffle: true,
        questions: [
          { id: 'a', text: 'Which SDLC model proceeds strictly phase by phase?', options: ['Waterfall', 'Scrum', 'Spiral', 'Kanban'], answer: 0 },
          { id: 'b', text: 'Which UML diagram shows interactions between objects over time?', options: ['Class diagram', 'Sequence diagram', 'Deployment diagram', 'Component diagram'], answer: 1 },
          { id: 'c', text: 'Testing individual functions in isolation is called…', options: ['System testing', 'Acceptance testing', 'Unit testing', 'Regression testing'], answer: 2 },
          { id: 'd', text: 'Which document captures what a system must do?', options: ['Test plan', 'SRS', 'User manual', 'Release notes'], answer: 1 },
          { id: 'e', text: 'Cohesion should ideally be…', options: ['Low', 'High', 'Zero', 'Irrelevant'], answer: 1 }
        ]
      }],
      attempts: []
    };
  }

  // Load stored data, upgrading old (v1, plain-text password) databases. Returns a fresh seed if data is missing or corrupt.
  function migrate(raw) {
    let db;
    try { db = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { db = null; }
    if (!db || !Array.isArray(db.users) || !Array.isArray(db.quizzes) || !Array.isArray(db.attempts)) return seed();
    for (const u of db.users) {
      if (u.password !== undefined) { Object.assign(u, makeCreds(u.password)); delete u.password; }
    }
    for (const q of db.quizzes) if (q.shuffle === undefined) q.shuffle = false;
    db.version = 2;
    return db;
  }

  const api = {
    sha256, uid, hashPassword, makeCreds, checkPassword, percent, grade, scoreAttempt, average, leaderboard,
    validateQuiz, validateUser, ROUTES, canView, canEditQuiz, canSeeAttempt, shuffle, toCSV, formatTime, seed, migrate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
