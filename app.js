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
    if (color) color.content = dark ? "#12110e" : "#f3eee4";
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

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function personNote(personId) {
  const food = view.foodByMonth.get(view.current.key)?.get(personId) || 0;
  const typical = view.averageFood.get(personId) || 0;
  const bits = [];
  const tax = view.current.taxByPerson?.get(personId) || 0;
  const tip = view.current.tipByPerson?.get(personId) || 0;
  if (food > 0.009) bits.push(`Ate ${money(food)} this month`);
  if (tax > 0.009) bits.push(`tax ${money(tax)}`);
  if (tip > 0.009) bits.push(`tip ${money(tip)}`);
  if (!view.averageIsCurrentOnly && typical > 0.009) bits.push(`usually ${money(typical)}`);
  return bits.join(" · ");
}

function personButton(person, balance) {
  const phrase = walletPhrase(balance);
  const note = personNote(person.id);
  return `
    <button class="person ${phrase.className}" type="button" data-open-person="${person.id}">
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</span>
      <span class="person-copy">
        <strong>${escapeHtml(person.name)}</strong>
        ${note ? `<span>${escapeHtml(note)}</span>` : ""}
      </span>
      <span class="person-end">
        <span class="tag">${phrase.word}</span>
        <span class="person-amount">${phrase.amount ? money(phrase.amount) : money(0)}</span>
      </span>
    </button>
  `;
}

function renderWallets() {
  const rows = view.people
    .filter((person) => person.active !== false)
    .map((person) => ({ person, balance: view.balances.get(person.id) || 0 }));
  const owes = rows.filter((row) => row.balance < -0.009).sort((a, b) => a.balance - b.balance);
  const ahead = rows.filter((row) => row.balance > 0.009).sort((a, b) => b.balance - a.balance);
  const settled = rows.filter((row) => Math.abs(row.balance) <= 0.009).sort((a, b) => a.person.name.localeCompare(b.person.name));

  const column = (title, hint, items, empty) => `
    <section class="board-col">
      <header>
        <h2>${title}</h2>
        <p>${hint}</p>
      </header>
      <div class="person-list">
        ${items.length ? items.map((row) => personButton(row.person, row.balance)).join("") : `<p class="empty">${empty}</p>`}
      </div>
    </section>
  `;

  $("wallets").innerHTML = `
    <div class="board">
      ${column("Needs to pay", "Largest amount first. Tap a name for the history.", owes, "Nobody owes the group.")}
      ${column("Gets money back", "They paid more than their share.", ahead, "Nobody is ahead.")}
    </div>
    ${settled.length ? `<div class="settled-list">${settled.map((row) => personButton(row.person, row.balance)).join("")}</div>` : ""}
    <p class="book-net">Add every wallet and the book is ${money(view.net, true)}. A number near zero means the book balances.</p>
  `;
}

function renderMonth() {
  const current = view.current;
  const available = current.collected + current.carriedIn;
  const ratio = available > 0 ? current.groupSpend / available : current.groupSpend > 0 ? 1 : 0;
  const percent = Math.max(0, Math.min(100, ratio * 100));
  const over = current.left < -0.009;
  let lead = "The pot is used up.";
  let story = "What was collected has been spent.";
  if (current.left > 0.009) {
    lead = `${money(current.left)} left`;
    story = "This is still available for lunches.";
  }
  if (over) {
    lead = `Short ${money(Math.abs(current.left))}`;
    story = current.collected <= 0.009 && current.groupSpend <= 0.009
      ? "Nothing has been added or spent this month. The gap is what last month left behind."
      : "Lunches have used more than the money in the pot.";
  }

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

  const carried = current.carriedIn < -0.009
    ? `Short ${money(Math.abs(current.carriedIn))}`
    : money(current.carriedIn);
  const showBar = available > 0.009 || current.groupSpend > 0.009;

  $("month").innerHTML = `
    <article class="hero ${over ? "is-short" : "is-ok"}">
      <div class="hero-main">
        <p class="eyebrow">${escapeHtml(current.label)}</p>
        <p class="hero-lead">${lead}</p>
        <p class="hero-story">${story}</p>
        ${showBar ? `
          <div class="bar ${over || ratio > 1 ? "is-over" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(0)}" aria-label="Pot used this month">
            <span style="width: ${percent}%"></span>
          </div>
        ` : ""}
      </div>
      <dl class="hero-facts">
        <div><dt>Added this month</dt><dd>${money(current.collected)}</dd></div>
        <div><dt>From last month</dt><dd>${carried}</dd></div>
        <div><dt>Other people's lunches</dt><dd>${money(current.groupSpend)}</dd></div>
      </dl>
      ${pace ? `<p class="hero-note">${pace}</p>` : ""}
      ${own ? `<p class="hero-note">${own}</p>` : ""}
      ${history ? `<p class="hero-note">${history}</p>` : ""}
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
  let tax = 0;
  let tip = 0;
  const paid = new Map();
  const shares = new Map();
  const changes = new Map();

  for (const effect of effects) {
    if (effect.entry.type === "pot") collected += effect.total;
    else if (effect.entry.type === "tax") tax += effect.total;
    else if (effect.entry.type === "tip") tip += effect.total;
    else spent += effect.total;
    for (const [personId, amount] of effect.paid) paid.set(personId, (paid.get(personId) || 0) + amount);
    for (const [personId, amount] of effect.shares) shares.set(personId, (shares.get(personId) || 0) + amount);
    for (const [personId, amount] of effect.changes) changes.set(personId, (changes.get(personId) || 0) + amount);
  }

  const lines = effects.map((effect) => {
    const kind = entryKind(effect.entry);
    return `
      <div class="day-line">
        <span class="badge">${kind}</span>
        <span>${escapeHtml(effect.entry.title)}</span>
        <strong>${money(effect.total)}</strong>
      </div>
    `;
  }).join("");

  const people = [...new Set([...paid.keys(), ...shares.keys()])].sort((a, b) =>
    (changes.get(b) || 0) - (changes.get(a) || 0)
  );
  const cards = people.map((personId) => {
    const change = changes.get(personId) || 0;
    const balance = view.balances.get(personId) || 0;
    const tone = change > 0 ? "positive" : change < 0 ? "negative" : "";
    const name = personName(personId);
    return `
      <button class="receipt-row" type="button" data-open-person="${personId}">
        <span class="avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>
        <span class="receipt-who">
          <strong>${escapeHtml(name)}</strong>
          <span>Paid ${paid.get(personId) ? money(paid.get(personId)) : "nothing"} · share ${shares.get(personId) ? money(shares.get(personId)) : "none"}</span>
        </span>
        <span class="receipt-end">
          <strong class="${tone}">${money(change, true)}</strong>
          <span>Wallet ${money(balance, true)}</span>
        </span>
      </button>
    `;
  }).join("");

  const totals = [
    spent ? `${money(spent)} spent` : "",
    collected ? `${money(collected)} put into the pot` : "",
    tax ? `${money(tax)} tax` : "",
    tip ? `${money(tip)} tip` : ""
  ].filter(Boolean).join(" · ");

  $("latest").innerHTML = `
    <section class="panel receipt">
      <div class="today-head">
        <p class="eyebrow">${isToday ? "Today" : "Latest lunch"}</p>
        <h2>${dateLabel(date)}</h2>
        <p class="muted">${totals}. Green went up, red went down.</p>
      </div>
      <div class="day-lines">${lines}</div>
      <div class="receipt-list">${cards}</div>
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

function entryKind(entry) {
  if (entry.type === "pot") return "Pot";
  if (entry.type === "settle") return "Transfer";
  if (entry.type === "tax") return "Tax";
  if (entry.type === "tip") return "Tip";
  return entry.split === "custom" ? "Custom" : "Equal";
}

function entryCard(effect) {
  const entry = effect.entry;
  const kind = entryKind(entry);
  let detail = "";
  if (entry.type === "tax" || entry.type === "tip") {
    detail = (entry.charges || [])
      .map((charge) => `${personName(charge.personId)} ${money(charge.amount)}`)
      .join(", ");
  } else if (entry.type === "pot") {
    detail = `${paidText(effect) || "No payments"} · held by ${personName(entry.heldBy)}`;
  } else {
    const count = (entry.members || []).length;
    detail = `${count} ${count === 1 ? "person" : "people"} · ${paidText(effect) || "nobody paid"}`;
  }

  return `
    <article class="entry-line">
      <span class="badge">${kind}</span>
      <span class="entry-copy">
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(detail)}</span>
      </span>
      <strong class="entry-amount">${money(effect.total)}</strong>
    </article>
  `;
}

function renderActivity() {
  const groups = groupedEffects();
  const visible = showAllActivity ? groups : groups.slice(0, 12);
  const wasOpen = $("activity").querySelector("details")?.open ?? false;
  const days = visible.map(([date, effects]) => `
    <div class="activity-day">
      <h3>${dateLabel(date)} <span>${effects.length} ${effects.length === 1 ? "entry" : "entries"}</span></h3>
      <div class="entry-list">${effects.map(entryCard).join("")}</div>
    </div>
  `).join("");

  const more = !showAllActivity && groups.length > 12
    ? `<button id="showOlder" class="button ghost" type="button">Show older entries</button>`
    : "";

  $("activity").hidden = false;
  $("activity").innerHTML = `
    <details class="panel fold" ${wasOpen ? "open" : ""}>
      <summary><h2>Activity</h2><span>Every meal, collection, and transfer</span></summary>
      ${days || `<p class="empty">No entries yet.</p>`}
      ${more}
    </details>
  `;
}

function renderMonths() {
  const monthCards = [...view.months].reverse().map((month) => {
    const short = month.left < -0.009;
    const status = short ? `Short ${money(Math.abs(month.left))}` : month.left > 0.009 ? `${money(month.left)} left` : "Used up";
    const carried = month.carriedIn < -0.009 ? `Short ${money(Math.abs(month.carriedIn))}` : money(month.carriedIn);
    return `
      <article class="month-tile">
        <header>
          <h3>${escapeHtml(month.label)}</h3>
          <strong class="${short ? "negative" : "positive"}">${status}</strong>
        </header>
        <p><span>Added</span><b>${money(month.collected)}</b></p>
        <p><span>From previous</span><b>${carried}</b></p>
        <p><span>Other people's lunches</span><b>${money(month.groupSpend)}</b></p>
        <p><span>Tax</span><b>${money(month.tax || 0)}</b></p>
        <p><span>Tip</span><b>${money(month.tip || 0)}</b></p>
      </article>
    `;
  }).join("");

  const foodKeys = [...view.foodByMonth.keys()].sort((a, b) => b.localeCompare(a));
  const foodCards = foodKeys.map((key) => {
    const food = view.foodByMonth.get(key);
    const rows = [...food.entries()]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1]);
    const max = rows.reduce((highest, [, amount]) => Math.max(highest, amount), 0) || 1;
    const lines = rows.map(([personId, amount]) => `
      <div class="food-row">
        <span>${escapeHtml(personName(personId))}</span>
        <b>${money(amount)}</b>
        <span class="food-track"><span style="width: ${(amount / max) * 100}%"></span></span>
      </div>
    `).join("");
    return `
      <article class="food-card">
        <h3>${escapeHtml(LunchLedger.monthLabel(key))}</h3>
        ${lines || `<p class="empty">No food.</p>`}
      </article>
    `;
  }).join("");

  $("months").innerHTML = `
    <details class="panel fold">
      <summary><h2>Each month</h2><span>Added, carried, and what was left</span></summary>
      <div class="month-list">${monthCards}</div>
    </details>
    <details class="panel fold">
      <summary><h2>Food by person</h2><span>Meals only. Transfers and pot money are not food.</span></summary>
      <div class="food-list">${foodCards || `<p class="empty">No food recorded.</p>`}</div>
    </details>
  `;
}

function chargeLines(byPerson) {
  const rows = [...(byPerson || new Map()).entries()]
    .filter(([, amount]) => amount > 0.009)
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return `<p class="levy-empty">Nothing charged yet.</p>`;
  return `<ul class="levy-people">${rows.map(([personId, amount]) => `
    <li>
      <button type="button" data-open-person="${personId}">${escapeHtml(personName(personId))}</button>
      <b>${money(amount)}</b>
    </li>
  `).join("")}</ul>`;
}

function renderLevies() {
  const current = view.current;
  const months = [...view.months].reverse().map((month) => `
    <article class="month-tile">
      <header>
        <h3>${escapeHtml(month.label)}</h3>
      </header>
      <p><span>Tax</span><b>${money(month.tax || 0)}</b></p>
      <p><span>Tip</span><b>${money(month.tip || 0)}</b></p>
    </article>
  `).join("");

  $("levies").innerHTML = `
    <div class="levy">
      <article class="levy-card is-tax">
        <p class="eyebrow">${escapeHtml(current.label)}</p>
        <h2>Tax</h2>
        <strong>${money(current.tax || 0)}</strong>
        <p>Taken off wallets this month. Not lunch, and not taken from the pot.</p>
        ${chargeLines(current.taxByPerson)}
      </article>
      <article class="levy-card is-tip">
        <p class="eyebrow">${escapeHtml(current.label)}</p>
        <h2>Tip</h2>
        <strong>${money(current.tip || 0)}</strong>
        <p>Taken off wallets this month. Not lunch, and not taken from the pot.</p>
        ${chargeLines(current.tipByPerson)}
      </article>
    </div>
    <details class="panel fold">
      <summary><h2>Tax and tip by month</h2><span>Every month in the book</span></summary>
      <div class="month-list">${months}</div>
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
  const phrase = walletPhrase(balance);
  $("personTitle").textContent = person.name;
  $("personMath").textContent = `${phrase.word}${phrase.amount ? ` ${money(phrase.amount)}` : ""}. Now = what they started with + what they paid − their share.`;
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
    renderLevies();
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
