# 🎓 QuizHub – Quiz Management System

A role-based online quiz management system built with plain HTML, CSS and JavaScript (no build step, no server).
Software Engineering (25CS312) micro project.

**Live demo:** https://velerion.github.io/quizhub/

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Teacher | `teacher` | `teacher123` |
| Student | `student` | `student123` |

## Features
- **Authentication** – login / registration with salted SHA-256 password hashes.
- **Role-based access control** – Admin, Teacher and Student each get their own menu; routes and actions are checked against the user's role and ownership.
- **Admin** – manage users (add, change role, reset password, delete), view and manage every quiz and result.
- **Teacher** – create / edit / reorder questions, publish or unpublish quizzes, optional per-student question shuffling, view submissions, leaderboards and CSV export.
- **Student** – search available quizzes, timed attempts with a question navigator, auto-submit at time-out, resume after reload, instant review with correct answers, leaderboards and personal results.
- **Profile** – every user can change their own password.

## Project structure
```
index.html        page shell
style.css         styling (responsive)
core.js           pure business logic: hashing, scoring, validation, access control, migration
app.js            UI / controller layer (views, events, storage)
tests/core.test.js unit tests (Node's built-in test runner)
```

## Run locally
```bash
npm start      # serves on http://localhost:5173  (or open index.html directly)
npm test       # runs the unit tests
```

Data is stored in the browser's `localStorage`, so each browser has its own independent copy.
