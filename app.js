let data = null;

const $ = (id) => document.getElementById(id);

// Initialize theme on page load
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    updateThemeIcon('☀️');
  } else {
    updateThemeIcon('🌙');
  }

  const themeToggle = $('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
}

function toggleTheme() {
  const isDarkMode = document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  updateThemeIcon(isDarkMode ? '☀️' : '🌙');
}

function updateThemeIcon(icon) {
  const themeIcon = document.querySelector('.theme-icon');
  if (themeIcon) {
    themeIcon.textContent = icon;
  }
}

function money(value, signed = false) {
  const n = Number(value) || 0;
  const prefix = signed && n > 0 ? "+" : n < 0 ? "-" : "";

  return `${prefix}${data.settings?.currency || "Rs."} ${Math.abs(
    n
  ).toLocaleString("en-PK", {
    maximumFractionDigits: 2
  })}`;
}

function dateLabel(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[c]
  );
}

function getParticipantIds(participants) {
  if (!Array.isArray(participants)) return [];

  return participants.map((participant) => {
    if (typeof participant === "object" && participant !== null) {
      return participant.personId;
    }

    return participant;
  });
}

function getParticipant(participants, personId) {
  if (!Array.isArray(participants)) return null;

  return (
    participants.find((participant) => {
      if (typeof participant === "object" && participant !== null) {
        return participant.personId === personId;
      }

      return participant === personId;
    }) || null
  );
}

function getParticipantShare(day, personId, total) {
  const participants = Array.isArray(day.participants) ? day.participants : [];

  if (!participants.length) return 0;

  const participant = getParticipant(participants, personId);

  if (!participant) return 0;

  if (typeof participant === "object") {
    if (day.splitType === "custom") {
      return Number(participant.share) || 0;
    }

    return total / participants.length;
  }

  return total / participants.length;
}

function calculate() {
  const people = data.people || [];

  const days = [...(data.days || [])].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const balances = new Map(
    people.map((p) => [p.id, Number(p.initialBalance) || 0])
  );

  const dailyByDate = new Map();

  for (const day of days) {
    const participants = Array.isArray(day.participants)
      ? day.participants
      : [];

    const participantIds = getParticipantIds(participants);

    const expenses = Array.isArray(day.expenses) ? day.expenses : [];

    const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const perHead = participantIds.length ? total / participantIds.length : 0;

    const paid = new Map();

    for (const expense of expenses) {
      const id = expense.paidBy;
      const amount = Number(expense.amount) || 0;

      paid.set(id, (paid.get(id) || 0) + amount);
    }

    const changes = new Map();
    const shares = new Map();

    for (const p of people) {
      const isParticipant = participantIds.includes(p.id);

      const personPaid = paid.get(p.id) || 0;

      const personShare = isParticipant
        ? getParticipantShare(day, p.id, total)
        : 0;

      shares.set(p.id, personShare);

      const change = isParticipant ? personPaid - personShare : 0;

      changes.set(p.id, change);

      balances.set(p.id, (balances.get(p.id) || 0) + change);
    }

    const transaction = {
      day,
      participants,
      participantIds,
      expenses,
      total,
      perHead,
      paid,
      shares,
      changes
    };

    const grouped = dailyByDate.get(day.date) || {
      day: { date: day.date },
      participants: [],
      participantIds: [],
      expenses: [],
      total: 0,
      participantSlots: 0,
      paid: new Map(),
      shares: new Map(),
      changes: new Map(),
      transactions: []
    };

    grouped.transactions.push(transaction);
    grouped.total += total;
    grouped.participantSlots += participantIds.length;
    grouped.participantIds = [...new Set([...grouped.participantIds, ...participantIds])];
    grouped.participants = grouped.participantIds;
    grouped.expenses.push(...expenses);

    for (const [personId, amount] of paid) {
      grouped.paid.set(personId, (grouped.paid.get(personId) || 0) + amount);
    }
    for (const [personId, share] of shares) {
      grouped.shares.set(personId, (grouped.shares.get(personId) || 0) + share);
    }
    for (const [personId, change] of changes) {
      grouped.changes.set(personId, (grouped.changes.get(personId) || 0) + change);
    }
    grouped.perHead = grouped.participantSlots ? grouped.total / grouped.participantSlots : 0;
    dailyByDate.set(day.date, grouped);
  }

  const daily = [...dailyByDate.values()].sort((a, b) => a.day.date.localeCompare(b.day.date));

  return {
    people,
    days,
    daily,
    balances
  };
}

function getMonthKey(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCurrentMonthTotal(daily) {
  const currentMonthKey = getMonthKey(new Date().toISOString().slice(0, 10));

  return daily.reduce((sum, day) => {
    const dayKey = getMonthKey(day.day.date);

    return dayKey === currentMonthKey ? sum + (Number(day.total) || 0) : sum;
  }, 0);
}

function render() {
  const calc = calculate();

  const today = calc.daily[calc.daily.length - 1] || {
    day: {
      date: new Date().toISOString().slice(0, 10)
    },
    participants: [],
    participantIds: [],
    expenses: [],
    total: 0,
    perHead: 0,
    paid: new Map(),
    shares: new Map(),
    changes: new Map(),
    transactions: []
  };

  $("currentDate").textContent = dateLabel(today.day.date);
  $('lunchDateHeading').textContent = dateLabel(today.day.date);
  $("todayExpense").textContent = money(today.total);

  $("perHead").textContent = money(today.perHead);

  $("peopleAte").textContent = today.participantIds.length;

  $("peoplePaid").textContent = `${today.paid.size} people paid`;

  $("todayParticipants").textContent =
    `${today.participantIds.length} participants`;

  const currentMonthTotal = getCurrentMonthTotal(calc.daily);
  const currentMonthLabel = new Date().toLocaleDateString("en-PK", {
    month: "long",
    year: "numeric"
  });

  $("thisMonthExpense").textContent = money(currentMonthTotal);
  $("thisMonthLabel").textContent = currentMonthLabel;

  $("todayBadge").textContent = `${today.participantIds.length} people`;

  $("summaryExpense").textContent = money(today.total);

  $("summaryParticipants").textContent = today.participantIds.length;

  $("summaryPerHead").textContent = money(today.perHead);

  const net = [...calc.balances.values()].reduce((a, b) => a + b, 0);

  $("netWallet").textContent = money(net, true);

  renderPeople(calc, today);
  renderWallets(calc);
  renderExpenses(today, calc.people);
  renderMonthlyExpenses(calc);
  renderMonthlyTotals(calc);
  renderHistory(calc.daily);
}

function status(balance) {
  if (balance > 0) {
    return ["Credit", "status-credit"];
  }

  if (balance < 0) {
    return ["Due", "status-due"];
  }

  return ["Settled", "status-settled"];
}

function renderPeople(calc, today) {
  $("peopleTable").innerHTML =
    calc.people
      .filter((p) => today.participantIds.includes(p.id))
      .map((p) => {
        const paid = today.paid.get(p.id) || 0;

        const share = today.shares.get(p.id) || 0;

        const change = today.changes.get(p.id) || 0;

        const current = calc.balances.get(p.id) || 0;

        const [label, cls] = status(current);

        const isPositiveUser = current > 0;

        return `
      <tr class="${isPositiveUser ? "positive-user" : ""}">
        <td data-label="Id">${escapeHtml(p.id)}</td>

        <td class="person" data-label="Person">
          ${escapeHtml(p.name)}
          ${isPositiveUser ? `
            <span class="positive-mark" aria-hidden="true">In the green</span>
            <span class="confetti" aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i><i></i>
            </span>
          ` : ""}
        </td>

        <td data-label="Paid Today">
          ${paid ? money(paid) : "—"}
        </td>

        <td data-label="Share">
          ${share ? money(share) : "—"}
        </td>

        <td data-label="Today's Change" class="${
          change > 0 ? "positive" : change < 0 ? "negative" : "zero"
        }">
          ${money(change, true)}
        </td>

        <td data-label="Current Wallet" class="${
          current > 0 ? "positive" : current < 0 ? "negative" : "zero"
        }">
          ${money(current, true)}
        </td>

        <td data-label="Status">
          <span class="pill ${cls}">
            ${label}
          </span>
        </td>
      </tr>
    `;
      })
      .join("") ||
    `
    <tr>
      <td colspan="6" class="empty">
        No people participated today.
      </td>
    </tr>
  `;
}

function renderWallets(calc) {
  $("walletList").innerHTML =
    [...calc.people]
      .sort(
        (a, b) =>
          (calc.balances.get(b.id) || 0) - (calc.balances.get(a.id) || 0)
      )
      .map((p) => {
        const balance = calc.balances.get(p.id) || 0;

        const isPositiveWallet = balance > 0;

        return `
      <div class="wallet-item ${isPositiveWallet ? "positive-wallet" : ""}">
        <div>
          <span class="wallet-name">
            ${escapeHtml(p.name)}
            ${isPositiveWallet ? `
              <span class="positive-mark" aria-hidden="true">In the green</span>
              <span class="confetti" aria-hidden="true">
                <i></i><i></i><i></i><i></i><i></i><i></i>
              </span>
            ` : ""}
          </span>

          <span class="wallet-sub">
            Initial: ${money(p.initialBalance || 0, true)}
          </span>
        </div>

        <span class="wallet-value ${
          balance > 0 ? "positive" : balance < 0 ? "negative" : "zero"
        }">
          ${money(balance, true)}
        </span>
      </div>
    `;
      })
      .join("") ||
    `
    <div class="empty">
      No people configured.
    </div>
  `;
}

function renderExpenses(today, people) {
  const names = new Map(people.map((p) => [p.id, p.name]));

  $("expenseList").innerHTML =
    today.transactions
      .map(
        (transaction, index) => `
    <div class="transaction-item">
      <div class="transaction-heading">
        <span class="expense-name">${escapeHtml(transaction.day.label || transaction.day.type || `Transaction ${index + 1}`)}</span>
        <span class="expense-amount">${money(transaction.total)}</span>
      </div>
      ${transaction.expenses.map((expense) => `
        <div class="expense-item">
          <div>
            <span class="expense-name">${escapeHtml(names.get(expense.paidBy) || "Unknown")}</span>
            <span class="expense-sub">Paid for this transaction</span>
          </div>
          <span class="expense-amount">${money(expense.amount)}</span>
        </div>
      `).join("")}
    </div>
  `
      )
      .join("") ||
    `
    <div class="empty">
      No expenses recorded for today.
    </div>
  `;
}

function renderMonthlyExpenses(calc) {
  const names = new Map((data.people || []).map((person) => [person.id, person.name]));
  
  // Group expenses by month and person
  const monthlyData = {};
  
  for (const day of calc.daily) {
    const date = new Date(`${day.day.date}T00:00:00`);
    const monthKey = date.toLocaleDateString("en-PK", { year: "numeric", month: "long" });
    
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {};
      for (const person of calc.people) {
        monthlyData[monthKey][person.id] = 0;
      }
    }
    
    // Add paid amounts for each person
    for (const [personId, amount] of day.paid) {
      monthlyData[monthKey][personId] = (monthlyData[monthKey][personId] || 0) + amount;
    }
  }

  const monthlyHtml = Object.entries(monthlyData)
    .reverse()
    .map(([month, personExpenses]) => {
      const rows = [...calc.people]
        .map(person => {
          const amount = personExpenses[person.id] || 0;
          return { person, amount };
        })
        .sort((a, b) => {
          if (b.amount !== a.amount) {
            return b.amount - a.amount;
          }

          return (a.person.name || "").localeCompare(b.person.name || "");
        })
        .map(({ person, amount }) => `
        <tr>
          <td class="person" data-label="Person">${escapeHtml(person.name)}</td>
          <td class="${amount > 0 ? "positive" : "zero"}" data-label="Total Paid">
            ${money(amount)}
          </td>
        </tr>
      `)
        .join("");

      return `
      <div class="monthly-card">
        <div class="monthly-month">${month}</div>
        <table class="monthly-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Total Paid</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
    })
    .join("");

  $("monthlyExpenses").innerHTML = monthlyHtml || `
    <div class="empty">
      No expense data available.
    </div>
  `;
}

function renderMonthlyTotals(calc) {
  // Group expenses by month
  const monthlyTotals = {};
  
  for (const day of calc.daily) {
    const date = new Date(`${day.day.date}T00:00:00`);
    const monthKey = date.toLocaleDateString("en-PK", { year: "numeric", month: "long" });
    
    if (!monthlyTotals[monthKey]) {
      monthlyTotals[monthKey] = 0;
    }
    
    monthlyTotals[monthKey] += day.total;
  }

  const monthlyHtml = Object.entries(monthlyTotals)
    .reverse()
    .map(([month, total]) => {
      return `
      <div class="monthly-total-card">
        <div class="monthly-total-month">${month}</div>
        <div class="monthly-total-amount">${money(total)}</div>
      </div>
    `;
    })
    .join("");

  $("monthlyTotals").innerHTML = monthlyHtml || `
    <div class="empty">
      No expense data available.
    </div>
  `;
}

function renderHistory(days) {
  const names = new Map((data.people || []).map((person) => [person.id, person.name]));

  // Show only last 10 days
  const lastTenDays = [...days].reverse().slice(0, 10).reverse();

  $("history").innerHTML =
    [...lastTenDays]
      .reverse()
      .map((x) => {
        const splitLabel =
          x.day.splitType === "custom" ? "Custom split" : "Equal split";
        const participants = x.participantIds
          .map((personId) => names.get(personId) || "Unknown")
          .map(escapeHtml)
          .join(", ");
        const payers = [...x.paid.entries()]
          .map(
            ([personId, amount]) =>
              `${escapeHtml(names.get(personId) || "Unknown")} (${money(amount)})`
          )
          .join(", ");

        return `
      <article class="history-card">
        <div class="history-date">
          ${dateLabel(x.day.date)}
        </div>

        <div class="history-row">
          <span>Participants</span>
          <strong>${participants || "None"}</strong>
        </div>

        <div class="history-row">
          <span>Paid by</span>
          <strong>${payers || "None"}</strong>
        </div>

        <div class="history-row">
          <span>Total expense</span>
          <strong>${money(x.total)}</strong>
        </div>

        <div class="history-row">
          <span>Split</span>
          <strong>${splitLabel}</strong>
        </div>

        <div class="history-row">
          <span>Per head</span>
          <strong>${money(x.perHead)}</strong>
        </div>
      </article>
    `;
      })
      .join("") ||
    `
    <div class="empty">
      No lunch history available.
    </div>
  `;
}

async function init() {
  try {
    initializeTheme();

    const response = await fetch("data.json");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    data = await response.json();

    render();
  } catch (err) {
    document.querySelector("main").innerHTML = `
      <div class="error">
        <strong>Could not load data.json.</strong>
        <br>
        Run this project with VS Code Live Server
        (or another local HTTP server)
        instead of opening index.html directly.
      </div>
    `;

    console.error(err);
  }
}

init();
