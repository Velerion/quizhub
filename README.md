# 🎓 QuizHub – Quiz Management System

A role-based online quiz management system: a plain HTML/CSS/JavaScript front end (no build step) on a Supabase (PostgreSQL) backend.
Software Engineering (25CS312) micro project.

**Live demo:** https://velerion.github.io/quizhub/

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Teacher | `teacher` | `teacher123` |
| Student | `student` | `student123` |

## Features
- **Backend** – Supabase Postgres. Tables live in a private `app` schema; the browser can only call `api_*` RPC functions, which check a session token and the user's role. Passwords are bcrypt-hashed and quizzes are graded on the server, so students never receive answer keys before submitting.
- **Authentication** – username/password login with 7-day session tokens.
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

All data is shared through the Supabase project, so every device sees the same users, quizzes and results. Only the in-progress attempt (for resume-after-reload) is kept in `localStorage`.
