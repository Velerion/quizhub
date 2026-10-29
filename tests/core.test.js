'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../core.js');

const quiz = {
  id: 'q', title: 'Q', subject: 'S', duration: 5, teacherId: 't1', published: true,
  questions: [
    { id: 'a', text: 'A?', options: ['1', '2', '3', '4'], answer: 1 },
    { id: 'b', text: 'B?', options: ['1', '2', '3', '4'], answer: 3 }
  ]
};
const admin = { id: 'u1', role: 'admin' }, teacher = { id: 't1', role: 'teacher' }, other = { id: 't2', role: 'teacher' }, student = { id: 's1', role: 'student' };

test('TC01 sha256 matches Node crypto', () => {
  for (const s of ['', 'abc', 'admin123', 'ünïcødé ✔', 'x'.repeat(200)])
    assert.equal(C.sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
});
test('TC02 passwords are salted and verifiable', () => {
  const u = C.makeCreds('secret1'), v = C.makeCreds('secret1');
  assert.notEqual(u.hash, v.hash);
  assert.ok(C.checkPassword(u, 'secret1'));
  assert.ok(!C.checkPassword(u, 'wrong'));
  assert.ok(!C.checkPassword(undefined, 'secret1'));
});
test('TC03 scoring counts only correct answers', () => {
  assert.deepEqual(C.scoreAttempt(quiz, { a: 1, b: 3 }), { score: 2, total: 2 });
  assert.deepEqual(C.scoreAttempt(quiz, { a: 0 }), { score: 0, total: 2 });
  assert.deepEqual(C.scoreAttempt(quiz, {}), { score: 0, total: 2 });
});
test('TC04 percent, grade and average', () => {
  assert.equal(C.percent(1, 3), 33);
  assert.equal(C.percent(0, 0), 0);
  assert.equal(C.grade(70), 'ok'); assert.equal(C.grade(40), 'warn'); assert.equal(C.grade(39), 'bad');
  assert.equal(C.average([{ score: 1, total: 2 }, { score: 2, total: 2 }]), 75);
  assert.equal(C.average([]), 0);
});
test('TC05 quiz validation', () => {
  assert.equal(C.validateQuiz(quiz), null);
  assert.match(C.validateQuiz({ ...quiz, title: ' ' }), /Title/);
  assert.match(C.validateQuiz({ ...quiz, duration: 0 }), /Duration/);
  assert.match(C.validateQuiz({ ...quiz, questions: [] }), /at least one/);
  assert.match(C.validateQuiz({ ...quiz, questions: [{ id: 'x', text: 'X', options: ['a', '', 'c', 'd'], answer: 0 }] }), /empty option/);
  assert.match(C.validateQuiz({ ...quiz, questions: [{ id: 'x', text: 'X', options: ['a', 'A', 'c', 'd'], answer: 0 }] }), /duplicate/);
});
test('TC06 user validation', () => {
  assert.equal(C.validateUser({ name: 'Bob', username: 'bob_1', password: 'secret' }), null);
  assert.match(C.validateUser({ name: '', username: 'bob', password: 'secret' }), /Name/);
  assert.match(C.validateUser({ name: 'Bob', username: 'b!', password: 'secret' }), /Username/);
  assert.match(C.validateUser({ name: 'Bob', username: 'bob', password: '123' }), /Password/);
});
test('TC07 role-based route access', () => {
  assert.ok(C.canView('admin', 'users'));
  assert.ok(!C.canView('teacher', 'users'));
  assert.ok(!C.canView('student', 'edit'));
  assert.ok(C.canView('student', 'take'));
  assert.ok(!C.canView('nobody', 'dash'));
});
test('TC08 quiz ownership and attempt visibility', () => {
  assert.ok(C.canEditQuiz(admin, quiz));
  assert.ok(C.canEditQuiz(teacher, quiz));
  assert.ok(!C.canEditQuiz(other, quiz));
  assert.ok(!C.canEditQuiz(student, quiz));
  const att = { userId: 's1', quizId: 'q' };
  assert.ok(C.canSeeAttempt(student, att, quiz));
  assert.ok(!C.canSeeAttempt({ id: 's2', role: 'student' }, att, quiz));
  assert.ok(C.canSeeAttempt(teacher, att, quiz));
  assert.ok(!C.canSeeAttempt(other, att, quiz));
});
test('TC09 leaderboard keeps best attempt per student', () => {
  const at = [
    { userId: 'x', quizId: 'q', score: 1, total: 2, date: 1 },
    { userId: 'x', quizId: 'q', score: 2, total: 2, date: 2 },
    { userId: 'y', quizId: 'q', score: 2, total: 2, date: 3 },
    { userId: 'z', quizId: 'other', score: 2, total: 2, date: 4 }
  ];
  const lb = C.leaderboard(at, 'q');
  assert.deepEqual(lb.map(a => [a.userId, a.date]), [['x', 2], ['y', 3]]);
});
test('TC10 shuffle is a permutation', () => {
  const src = [1, 2, 3, 4, 5, 6];
  const out = C.shuffle(src);
  assert.deepEqual([...out].sort(), src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6]);
});
test('TC11 CSV escaping and time formatting', () => {
  assert.equal(C.toCSV([['a', 'b,c', 'say "hi"'], [1, null]]), 'a,"b,c","say ""hi"""\n1,');
  assert.equal(C.formatTime(65000), '1:05');
  assert.equal(C.formatTime(-5), '0:00');
});
test('TC12 migration hashes legacy plain-text passwords and recovers from corrupt data', () => {
  const legacy = JSON.stringify({ users: [{ id: 'u', name: 'U', username: 'u', password: 'pw1234', role: 'student' }], quizzes: [], attempts: [] });
  const db = C.migrate(legacy);
  assert.equal(db.users[0].password, undefined);
  assert.ok(C.checkPassword(db.users[0], 'pw1234'));
  assert.equal(db.version, 2);
  assert.equal(C.migrate('{not json').users.length, 3);
  assert.equal(C.migrate(null).quizzes.length, 2);
});
test('TC13 seed data is valid', () => {
  const db = C.seed();
  for (const q of db.quizzes) assert.equal(C.validateQuiz(q), null);
  assert.ok(C.checkPassword(db.users.find(u => u.username === 'admin'), 'admin123'));
});
