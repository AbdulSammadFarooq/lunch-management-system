let view = null;
let showAllActivity = false;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function money(value, signed = false) {
  return LunchLedger.formatMoney(value, view?.currency || "Rs.", signed);
}

function dateLabel(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function personName(personId) {
  return LunchLedger.personName(view.people, personId);
}

function setupTheme() {
  const button = $("themeToggle");
  const color = $("themeColor");
  const paint = () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    button.textContent = dark ? "Light" : "Dark";
    if (color) color.content = dark ? "#0e171c" : "#e7eef0";
  };
  paint();
  button.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    if (dark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    }
    paint();
  });
}

function walletPhrase(balance) {
  if (balance > 0.009) return { word: "Ahead", className: "is-ahead", amount: balance };
  if (balance < -0.009) return { word: "Owes", className: "is-owes", amount: Math.abs(balance) };
  return { word: "Settled", className: "is-settled", amount: 0 };
}

function renderWallets() {
  const cards = view.people
    .filter((person) => person.active !== false)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => {
      const balance = view.balances.get(person.id) || 0;
      const phrase = walletPhrase(balance);
      const food = view.foodByMonth.get(view.current.key)?.get(person.id) || 0;
      const typical = view.averageFood.get(person.id) || 0;
      const typicalLine = view.averageIsCurrentOnly || !typical
        ? ""
        : `<p class="wallet-meta">${escapeHtml(view.averageLabel)} ${money(typical)}</p>`;

      return `
        <button class="wallet ${phrase.className}" type="button" data-open-person="${person.id}">
          <h3>${escapeHtml(person.name)}</h3>
          <p class="balance">${phrase.word}${phrase.amount ? ` ${money(phrase.amount)}` : ""}</p>
          <p class="wallet-meta">This month ${money(food)}</p>
          ${typicalLine}
        </button>
      `;
    })
    .join("");

  $("wallets").innerHTML = `
    <div class="section-head">
      <h2>Wallets</h2>
      <p>Green means the group owes them. Red means they owe the group. Open a name to see why.</p>
    </div>
    <div class="wallets">${cards || `<p class="empty">No one is on the shared page yet.</p>`}</div>
    <p class="book-net">All wallets together: ${money(view.net, true)}. That includes each person's opening balance.</p>
  `;
}

function renderMonth() {
  const current = view.current;
  const available = current.collected + current.carriedIn;
  const ratio = available > 0 ? current.groupSpend / available : current.groupSpend > 0 ? 1 : 0;
  const percent = Math.max(0, Math.min(100, ratio * 100));
  const over = current.left < -0.009;
  let lead = "The pot is exactly used up.";
  if (current.left > 0.009) lead = `${money(current.left)} is left in the pot.`;
  if (over) lead = `The pot is short by ${money(Math.abs(current.left))}.`;

  let pace = "";
  if (current.left > 0.009 && current.groupPace > 0 && current.daysOfPot !== null) {
    const days = Math.max(0, Math.floor(current.daysOfPot));
    pace = `So far everyone else has used ${money(current.groupPace)} a day, which covers about ${days} more ${days === 1 ? "day" : "days"}.`;
    if (current.daysLeft > 0) {
      pace += ` To last the month, keep the next ${current.daysLeft} ${current.daysLeft === 1 ? "day" : "days"} under ${money(current.dailyRoom)} a day.`;
    }
  } else if (current.left > 0.009 && current.daysLeft > 0) {
    pace = `${money(current.dailyRoom)} a day would use what is left evenly over the next ${current.daysLeft} ${current.daysLeft === 1 ? "day" : "days"}.`;
  }

  const own = current.ownShare
    ? `${escapeHtml(view.budgetPersonName)}'s own food this month is ${money(current.ownShare)} and is not taken out of the pot.`
    : "";
  const history = view.overall.days
    ? `All recorded spending is ${money(view.overall.spent)}, from ${dateLabel(view.overall.firstDate)} to ${dateLabel(view.overall.lastDate)}.`
    : "";

  $("month").innerHTML = `
    <article class="month-card">
      <p class="eyebrow">${escapeHtml(current.label)}</p>
      <p class="month-lead">${lead}</p>
      <div class="month-facts">
        <div><span>Collected</span><strong>${money(current.collected)}</strong></div>
        <div><span>Brought forward</span><strong>${money(current.carriedIn)}</strong></div>
        <div><span>Charged to everyone else</span><strong>${money(current.groupSpend)}</strong></div>
      </div>
      <div class="bar ${over || ratio > 1 ? "is-over" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(0)}" aria-label="Pot used this month">
        <span style="width: ${percent}%"></span>
      </div>
      ${pace ? `<p class="month-note">${pace}</p>` : ""}
      ${own ? `<p class="month-note">${own}</p>` : ""}
      ${history ? `<p class="month-note">${history}</p>` : ""}
    </article>
  `;
}

function paidText(effect) {
  return [...effect.paid.entries()]
    .filter(([, amount]) => amount)
    .map(([personId, amount]) => `${personName(personId)} ${money(amount)}`)
    .join(", ");
}

function renderLatest() {
  const latest = view.effects[view.effects.length - 1];
  if (!latest) {
    $("latest").innerHTML = `<section class="panel"><h2>Latest day</h2><p class="empty">No entries yet.</p></section>`;
    return;
  }

  const date = latest.entry.date;
  const effects = view.effects.filter((effect) => effect.entry.date === date);
  const isToday = date === LunchLedger.todayISO();
  let spent = 0;
  let collected = 0;
  const paid = new Map();
  const shares = new Map();
  const changes = new Map();

  for (const effect of effects) {
    if (effect.entry.type === "pot") collected += effect.total;
    else spent += effect.total;
    for (const [personId, amount] of effect.paid) paid.set(personId, (paid.get(personId) || 0) + amount);
    for (const [personId, amount] of effect.shares) shares.set(personId, (shares.get(personId) || 0) + amount);
    for (const [personId, amount] of effect.changes) changes.set(personId, (changes.get(personId) || 0) + amount);
  }

  const lines = effects.map((effect) => {
    const kind = effect.entry.type === "pot" ? "Pot" : effect.entry.type === "settle" ? "Transfer" : "Meal";
    return `
      <div class="day-line">
        <span><span class="badge">${kind}</span> ${escapeHtml(effect.entry.title)}</span>
        <strong>${money(effect.total)}</strong>
      </div>
    `;
  }).join("");

  const people = [...new Set([...paid.keys(), ...shares.keys()])].sort((a, b) =>
    personName(a).localeCompare(personName(b))
  );
  const cards = people.map((personId) => {
    const change = changes.get(personId) || 0;
    const balance = view.balances.get(personId) || 0;
    const tone = change > 0 ? "positive" : change < 0 ? "negative" : "";
    return `
      <article class="today-person">
        <button class="linkish" type="button" data-open-person="${personId}">${escapeHtml(personName(personId))}</button>
        <p><span>Paid</span><strong>${paid.get(personId) ? money(paid.get(personId)) : "—"}</strong></p>
        <p><span>Share</span><strong>${shares.get(personId) ? money(shares.get(personId)) : "—"}</strong></p>
        <p class="${tone}"><span>Change</span><strong>${money(change, true)}</strong></p>
        <p><span>Wallet</span><strong class="${balance > 0 ? "positive" : balance < 0 ? "negative" : ""}">${money(balance, true)}</strong></p>
      </article>
    `;
  }).join("");

  const totals = [
    spent ? `${money(spent)} spent` : "",
    collected ? `${money(collected)} put into the pot` : ""
  ].filter(Boolean).join(" · ");

  $("latest").innerHTML = `
    <section class="panel today-panel">
      <div class="today-head">
        <p class="eyebrow">${isToday ? "Today" : "Latest day"}</p>
        <h2>${dateLabel(date)}</h2>
        <p class="muted">${totals}</p>
      </div>
      <div class="day-lines">${lines}</div>
      <div class="today-people">${cards}</div>
    </section>
  `;
}

function groupedEffects() {
  const groups = new Map();
  for (const effect of view.effects) {
    if (!groups.has(effect.entry.date)) groups.set(effect.entry.date, []);
    groups.get(effect.entry.date).push(effect);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function entryCard(effect) {
  const entry = effect.entry;
  const kind = entry.type === "pot" ? "Pot" : entry.type === "settle" ? "Transfer" : entry.split === "custom" ? "Custom" : "Equal";
  let detail = "";
  if (entry.type === "pot") {
    detail = `Held by ${personName(entry.heldBy)}. ${paidText(effect) || "No payments"}.`;
  } else {
    const members = (entry.members || []).map(personName).join(", ");
    detail = `${members || "No one"}. Paid by ${paidText(effect) || "no one"}.`;
  }

  return `
    <article class="entry-card">
      <div class="entry-top">
        <strong>${escapeHtml(entry.title)}</strong>
        <strong>${money(effect.total)}</strong>
      </div>
      <p><span class="badge">${kind}</span></p>
      <p class="muted">${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderActivity() {
  const groups = groupedEffects();
  const visible = showAllActivity ? groups : groups.slice(0, 12);
  const wasOpen = $("activity").querySelector("details")?.open ?? true;
  const days = visible.map(([date, effects]) => `
    <div class="activity-day">
      <h3>${dateLabel(date)} <span>${effects.length} ${effects.length === 1 ? "entry" : "entries"}</span></h3>
      <div class="history-grid">${effects.map(entryCard).join("")}</div>
    </div>
  `).join("");

  const more = !showAllActivity && groups.length > 12
    ? `<button id="showOlder" class="button ghost" type="button">Show older entries</button>`
    : "";

  $("activity").hidden = false;
  $("activity").innerHTML = `
    <details class="panel" ${wasOpen ? "open" : ""}>
      <summary><h2>Activity</h2></summary>
      <p class="muted">Every meal, pot collection, and transfer.</p>
      ${days || `<p class="empty">No entries yet.</p>`}
      ${more}
    </details>
  `;
}

function renderMonths() {
  const monthCards = [...view.months].reverse().map((month) => `
    <article class="month-block">
      <h3>${escapeHtml(month.label)}</h3>
      <p>Collected ${money(month.collected)}</p>
      <p>Brought forward ${money(month.carriedIn)}</p>
      <p>Charged to everyone else ${money(month.groupSpend)}</p>
      <p class="${month.left < 0 ? "negative" : "positive"}">Left ${money(month.left, true)}</p>
    </article>
  `).join("");

  const foodKeys = [...view.foodByMonth.keys()].sort((a, b) => b.localeCompare(a));
  const foodCards = foodKeys.map((key) => {
    const food = view.foodByMonth.get(key);
    const rows = [...food.entries()]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([personId, amount]) => `<tr><td data-label="Person">${escapeHtml(personName(personId))}</td><td class="num" data-label="Food">${money(amount)}</td></tr>`)
      .join("");
    return `
      <article class="food-card">
        <h3>${escapeHtml(LunchLedger.monthLabel(key))}</h3>
        <table><tbody>${rows}</tbody></table>
      </article>
    `;
  }).join("");

  $("months").innerHTML = `
    <details class="panel">
      <summary><h2>Each month</h2></summary>
      <div class="month-list">${monthCards}</div>
    </details>
    <details class="panel">
      <summary><h2>Food by person</h2></summary>
      <p class="muted">Meals only. Transfers and pot money are not food.</p>
      <div class="food-list">${foodCards || `<p class="empty">No food recorded.</p>`}</div>
    </details>
  `;
}

function openPerson(personId) {
  const person = view.people.find((item) => item.id === personId);
  if (!person) return;

  const rows = [];
  let paidTotal = 0;
  let shareTotal = 0;
  for (const effect of view.effects) {
    const paid = effect.paid.get(personId) || 0;
    const share = effect.shares.get(personId) || 0;
    const change = (effect.changes.get(personId) || 0);
    if (!paid && !share && !change) continue;
    paidTotal += paid;
    shareTotal += share;
    rows.push({ effect, paid, share, change });
  }
  rows.reverse();

  const balance = view.balances.get(personId) || 0;
  $("personTitle").textContent = person.name;
  $("personMath").textContent = "Now = opening balance + what they paid − their share.";
  $("personSummary").innerHTML = `
    <div><span>Opening</span><strong>${money(person.openingBalance, true)}</strong></div>
    <div><span>Paid</span><strong>${money(paidTotal)}</strong></div>
    <div><span>Share</span><strong>${money(shareTotal)}</strong></div>
    <div><span>Now</span><strong class="${balance > 0 ? "positive" : balance < 0 ? "negative" : ""}">${money(balance, true)}</strong></div>
  `;
  $("personRows").innerHTML = rows.map(({ effect, paid, share, change }) => `
    <tr>
      <td data-label="Date">${dateLabel(effect.entry.date)}</td>
      <td data-label="Entry">${escapeHtml(effect.entry.title)}</td>
      <td class="num" data-label="Paid">${paid ? money(paid) : "—"}</td>
      <td class="num" data-label="Share">${share ? money(share) : "—"}</td>
      <td class="num ${change > 0 ? "positive" : change < 0 ? "negative" : ""}" data-label="Change">${money(change, true)}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No entries yet.</td></tr>`;

  const modal = $("personModal");
  modal.hidden = false;
  $("closePerson").focus();
}

function closePerson() {
  $("personModal").hidden = true;
}

function bindPage() {
  document.body.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-person]");
    if (trigger) openPerson(Number(trigger.dataset.openPerson));
    if (event.target.id === "showOlder") {
      showAllActivity = true;
      renderActivity();
    }
  });

  $("closePerson").addEventListener("click", closePerson);
  $("personModal").addEventListener("click", (event) => {
    if (event.target === $("personModal")) closePerson();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("personModal").hidden) closePerson();
  });
}

async function init() {
  setupTheme();
  bindPage();
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") $("manageLink").hidden = false;

  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const ledger = await response.json();
    view = LunchLedger.compute(ledger);
    $("loading").hidden = true;
    renderWallets();
    renderMonth();
    renderLatest();
    renderActivity();
    renderMonths();
  } catch (error) {
    $("loading").innerHTML = `
      <strong>The book could not be loaded.</strong>
      From this folder run <code>npm start</code>, then open <code>http://127.0.0.1:5501</code>.
    `;
    console.error(error);
  }
}

init();
