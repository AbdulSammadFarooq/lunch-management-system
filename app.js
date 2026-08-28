let data = null;

const $ = (id) => document.getElementById(id);

function money(value, signed = false) {
  const n = Number(value) || 0;
  const prefix = signed && n > 0 ? "+" : n < 0 ? "-" : "";
  return `${prefix}${data.settings?.currency || "Rs."} ${Math.abs(n).toLocaleString("en-PK", {maximumFractionDigits: 2})}`;
}

function dateLabel(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-PK", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function calculate() {
  const people = data.people || [];
  const days = [...(data.days || [])].sort((a,b) => a.date.localeCompare(b.date));
  const balances = new Map(people.map(p => [p.id, Number(p.initialBalance) || 0]));
  const daily = [];

  for (const day of days) {
    const participants = Array.isArray(day.participants) ? day.participants : [];
    const expenses = Array.isArray(day.expenses) ? day.expenses : [];
    const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const perHead = participants.length ? total / participants.length : 0;
    const paid = new Map();

    for (const expense of expenses) {
      const id = expense.paidBy;
      paid.set(id, (paid.get(id) || 0) + (Number(expense.amount) || 0));
    }

    const changes = new Map();
    for (const p of people) {
      const change = participants.includes(p.id) ? (paid.get(p.id) || 0) - perHead : 0;
      changes.set(p.id, change);
      balances.set(p.id, (balances.get(p.id) || 0) + change);
    }

    daily.push({ day, participants, expenses, total, perHead, paid, changes });
  }

  return { people, days, daily, balances };
}

function render() {
  const calc = calculate();
  const today = calc.daily[calc.daily.length - 1] || {
    day: {date: new Date().toISOString().slice(0,10)}, participants: [], expenses: [],
    total: 0, perHead: 0, paid: new Map(), changes: new Map()
  };

  $("currentDate").textContent = dateLabel(today.day.date);
  $("todayExpense").textContent = money(today.total);
  $("perHead").textContent = money(today.perHead);
  $("peopleAte").textContent = today.participants.length;
  $("peoplePaid").textContent = `${today.paid.size} people paid`;
  $("todayParticipants").textContent = `${today.participants.length} participants`;
  $("todayBadge").textContent = `${today.participants.length} people`;
  $("summaryExpense").textContent = money(today.total);
  $("summaryParticipants").textContent = today.participants.length;
  $("summaryPerHead").textContent = money(today.perHead);

  const net = [...calc.balances.values()].reduce((a,b) => a+b, 0);
  $("netWallet").textContent = money(net, true);

  renderPeople(calc, today);
  renderWallets(calc);
  renderExpenses(today, calc.people);
  renderHistory(calc.daily);
}

function status(balance) {
  if (balance > 0) return ["Credit", "status-credit"];
  if (balance < 0) return ["Due", "status-due"];
  return ["Settled", "status-settled"];
}

function renderPeople(calc, today) {
  $("peopleTable").innerHTML = calc.people.map(p => {
    const ate = today.participants.includes(p.id);
    const paid = today.paid.get(p.id) || 0;
    const change = today.changes.get(p.id) || 0;
    const current = calc.balances.get(p.id) || 0;
    const [label, cls] = status(current);
    return `<tr>
      <td class="person">${escapeHtml(p.name)}</td>
      <td><span class="pill ${ate ? "yes" : "no"}">${ate ? "✓ Yes" : "— No"}</span></td>
      <td>${paid ? money(paid) : "—"}</td>
      <td class="${change > 0 ? "positive" : change < 0 ? "negative" : "zero"}">${money(change, true)}</td>
      <td class="${current > 0 ? "positive" : current < 0 ? "negative" : "zero"}">${money(current, true)}</td>
      <td><span class="pill ${cls}">${label}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No people configured.</td></tr>`;
}

function renderWallets(calc) {
  $("walletList").innerHTML = calc.people.map(p => {
    const balance = calc.balances.get(p.id) || 0;
    return `<div class="wallet-item">
      <div><span class="wallet-name">${escapeHtml(p.name)}</span><span class="wallet-sub">Initial: ${money(p.initialBalance || 0, true)}</span></div>
      <span class="wallet-value ${balance > 0 ? "positive" : balance < 0 ? "negative" : "zero"}">${money(balance, true)}</span>
    </div>`;
  }).join("") || `<div class="empty">No people configured.</div>`;
}

function renderExpenses(today, people) {
  const names = new Map(people.map(p => [p.id, p.name]));
  $("expenseList").innerHTML = today.expenses.map(e => `
    <div class="expense-item">
      <div><span class="expense-name">${escapeHtml(names.get(e.paidBy) || "Unknown")}</span><span class="expense-sub">Paid toward today's lunch</span></div>
      <span class="expense-amount">${money(e.amount)}</span>
    </div>
  `).join("") || `<div class="empty">No expenses recorded for today.</div>`;
}

function renderHistory(days) {
  $("history").innerHTML = [...days].reverse().map(x => `
    <article class="history-card">
      <div class="history-date">${dateLabel(x.day.date)}</div>
      <div class="history-row"><span>Participants</span><strong>${x.participants.length}</strong></div>
      <div class="history-row"><span>Total expense</span><strong>${money(x.total)}</strong></div>
      <div class="history-row"><span>Per head</span><strong>${money(x.perHead)}</strong></div>
    </article>
  `).join("") || `<div class="empty">No lunch history available.</div>`;
}

async function init() {
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    render();
  } catch (err) {
    document.querySelector("main").innerHTML =
      `<div class="error"><strong>Could not load data.json.</strong><br>
      Run this project with VS Code Live Server (or another local HTTP server) instead of opening index.html directly.</div>`;
    console.error(err);
  }
}

init();
