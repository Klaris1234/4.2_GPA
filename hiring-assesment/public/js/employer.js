const list = document.getElementById("candidateList");

fetch("/api/employer-feed")
  .then(res => res.json())
  .then(data => {
    renderStats(data);
    renderCandidates(data);
  });

function renderStats(data) {
  document.getElementById("totalCount").textContent = data.length;

  if (data.length === 0) return;

  const scores = data.map(d => d.score);
  const top = Math.max(...scores);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  document.getElementById("topScore").textContent = top;
  document.getElementById("avgScore").textContent = avg;
}

function renderCandidates(data) {
  list.innerHTML = "";

  data.forEach(c => {
    const card = document.createElement("div");
    card.className = "candidate-card";

    card.innerHTML = `
      <div class="candidate-header">
        <div>
          <h3>${c.candidateCode}</h3>
          <p class="muted">${c.role}</p>
        </div>
        <div class="score-badge ${getScoreClass(c.score)}">
          ${c.score}
        </div>
      </div>

      <div class="answer-box">
        ${c.answer || "<i>No answer provided</i>"}
      </div>

      <div class="card-actions">
        <button class="shortlist-btn">⭐ Shortlist</button>
      </div>
    `;

    const btn = card.querySelector(".shortlist-btn");

    btn.addEventListener("click", async () => {
      try {
        await fetch("/api/shortlist", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ attemptId: c.id })
        });

        btn.textContent = "✅ Shortlisted";
        btn.disabled = true;

        loadShortlisted();

      } catch (err) {
        console.error(err);
        alert("Failed to shortlist candidate");
      }
    });

    list.appendChild(card);
  });
}

function getScoreClass(score) {
  if (score >= 85) return "score-good";
  if (score >= 60) return "score-mid";
  return "score-bad";
}

async function loadShortlisted() {
  const res = await fetch("/api/shortlisted");
  const data = await res.json();

  const list = document.getElementById("shortlistedList");
  list.innerHTML = "";

  data.forEach(c => {
    const div = document.createElement("div");
    div.className = "history-card";

    div.innerHTML = `
      <h3>${c.candidateCode}</h3>
      <p class="muted">${c.role}</p>
      <strong>Score: ${c.score}</strong>
      <p>${c.answer}</p>
    `;

    list.appendChild(div);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadShortlisted();
});
