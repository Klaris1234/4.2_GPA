# Zero-Network Hiring

A working MVP for a proof-of-work hiring platform.

## What it does
- lets candidates choose a role
- shows a role-specific task and dataset
- accepts a written submission
- scores the submission automatically
- ranks candidates anonymously
- provides a recruiter view without identity data

## Roles included
- Data Analyst
- Marketing Associate
- Product Intern

## Run locally
```bash
cd zero-network-hiring
npm install
npm start
```

Then open:
```bash
http://localhost:3000
```

## Tech stack
- HTML
- CSS
- Vanilla JavaScript
- Node.js
- Express

## Project structure
- `server.js` -> backend API and scoring logic
- `public/index.html` -> UI
- `public/styles.css` -> styling
- `public/app.js` -> frontend logic
- `data/submissions.json` -> local storage for submissions

## Notes
This is a deterministic MVP, not a production hiring system. The scoring model is rule-based and designed for hackathon/demo use.
