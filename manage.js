let ledger = null;
let editingId = null;
let saving = false;

const $ = (id) => document.getElementById(id);

const HELP = {
  meal: "Someone paid for food. The bill is split across the people who joined.",
  pot: "People hand cash to whoever is holding the lunch money. Payers go ahead. The holder goes down by the total, and the monthly pot goes up.",
  settle: "Cash moved between people and it was not a meal. Wallets update, but this is not counted as food."
};

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
  return LunchLedger.formatMoney(value, ledger?.settings?.currency || "Rs.", signed);
}

function dateLabel(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
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

function setStatus(message, isError = false) {
  const status = $("saveStatus");
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function setFormError(message) {
  const error = $("formError");
  error.hidden = !message;
  error.textContent = message || "";
}

function defaultMembers() {
  const recentMeal = [...ledger.entries].reverse().find(
    (entry) => entry.type === "meal" && Array.isArray(entry.members) && entry.members.length
  );
  if (recentMeal) return new Set(recentMeal.members.map(Number));
  return new Set(ledger.people.filter((person) => person.active).map((person) => person.id));
}

function selectedMemberIds() {
  return new Set(
    [...document.querySelectorAll("#memberGrid input:checked")].map((input) => Number(input.value))
  );
}

function valueMap(selector) {
  const map = new Map();
  document.querySelectorAll(selector).forEach((input) => {
    map.set(Number(input.dataset.person), input.value);
  });
  return map;
}

function personOptions(selectedId) {
  const options = [`<option value="">Who paid?</option>`];
  for (const person of ledger.people) {
    const selected = Number(selectedId) === person.id ? "selected" : "";
    options.push(`<option value="${person.id}" ${selected}>${escapeHtml(person.name)}</option>`);
  }
  return options.join("");
}

function renderMemberGrid(preselected) {
  const grid = $("memberGrid");
  const selected = preselected
    ? preselected
    : grid.childElementCount
      ? selectedMemberIds()
      : new Set(ledger.people.filter((person) => person.active).map((person) => person.id));

  grid.innerHTML = ledger.people.map((person) => `
    <label class="choice ${person.active ? "" : "is-hidden-person"}">
      <input type="checkbox" value="${person.id}" ${selected.has(person.id) ? "checked" : ""}>
      <span>${escapeHtml(person.name)}${person.active ? "" : " · hidden"}</span>
    </label>
  `).join("");
  renderShareGrid();
}

function renderShareGrid(preset) {
  const grid = $("shareGrid");
  const custom = document.querySelector('input[name="split"]:checked')?.value === "custom";
  if (!custom) {
    grid.hidden = true;
    grid.innerHTML = "";
    return;
  }

  const previous = preset || valueMap("#shareGrid input[data-person]");
  const selected = [...selectedMemberIds()];
  grid.hidden = selected.length > 0;
  grid.innerHTML = selected.map((personId) => `
    <label>
      <span>${escapeHtml(LunchLedger.personName(ledger.people, personId))}</span>
      <input data-person="${personId}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Share" value="${escapeHtml(previous.get(personId) ?? "")}">
    </label>
  `).join("");
}

function renderPotGrid(preset) {
  const previous = preset || valueMap("#potGrid input[data-person]");
  $("potGrid").innerHTML = ledger.people.map((person) => `
    <label>
      <span>${escapeHtml(person.name)}${person.active ? "" : " · hidden"}</span>
      <input data-person="${person.id}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount" value="${escapeHtml(previous.get(person.id) ?? "")}">
    </label>
  `).join("");
}

function renderHeldBy(selected) {
  const select = $("heldBy");
  const value = selected || select.value || String(ledger.settings.budgetPersonId || "");
  select.innerHTML = ledger.people.map((person) => `
    <option value="${person.id}" ${String(person.id) === String(value) ? "selected" : ""}>${escapeHtml(person.name)}</option>
  `).join("");
}

function addPaymentRow(payment = { personId: "", amount: "" }) {
  const row = document.createElement("div");
  row.className = "pay-row";
  row.innerHTML = `
    <select aria-label="Who paid">${personOptions(payment.personId)}</select>
    <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount" aria-label="Amount paid" value="${escapeHtml(payment.amount ?? "")}">
    <button class="button ghost small remove-payer" type="button">Remove</button>
  `;
  $("paymentRows").appendChild(row);
}

function renderPaymentRows(payments) {
  $("paymentRows").innerHTML = "";
  const rows = payments && payments.length ? payments : [{ personId: "", amount: "" }];
  rows.forEach((payment) => addPaymentRow(payment));
}

function refillPaymentOptions() {
  document.querySelectorAll(".pay-row select").forEach((select) => {
    const current = select.value;
    select.innerHTML = personOptions(current);
  });
}

function syncType(options = {}) {
  const type = document.querySelector('input[name="type"]:checked').value;
  $("groupFields").hidden = type === "pot";
  $("potFields").hidden = type !== "pot";
  $("titleChips").hidden = type !== "meal";
  $("typeHelp").textContent = HELP[type];
  const title = document.querySelector('[name="title"]');
  const defaults = ["Lunch", "Snacks", "Breakfast", "Funding", "Exchange", ""];
  const next = { meal: "Lunch", pot: "Funding", settle: "Exchange" }[type];
  if (!options.keepTitle && defaults.includes(title.value)) title.value = next;
}

function readForm(strict) {
  const type = document.querySelector('input[name="type"]:checked').value;
  const date = document.querySelector('[name="date"]').value;
  const title = document.querySelector('[name="title"]').value.trim();
  if (strict && !date) return { error: "Choose a date." };
  if (strict && !title) return { error: "Give this entry a name." };

  if (type === "pot") {
    const heldBy = Number($("heldBy").value);
    const paid = [];
    for (const input of document.querySelectorAll("#potGrid input")) {
      const raw = input.value.trim();
      if (!raw) continue;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { error: "Pot amounts need to be above zero." };
      }
      paid.push({ personId: Number(input.dataset.person), amount });
    }
    if (!paid.length) {
      return { error: strict ? "Enter how much at least one person put in." : "Enter who put money in to see the wallets move." };
    }
    return { entry: { date, title: title || "Funding", type, heldBy, paid } };
  }

  const members = [...selectedMemberIds()];
  const split = document.querySelector('input[name="split"]:checked').value;
  if (!members.length) {
    return { error: strict ? "Choose at least one person." : "Choose who joined to see the split." };
  }

  let shares;
  if (split === "custom") {
    shares = [];
    for (const input of document.querySelectorAll("#shareGrid input")) {
      const raw = input.value.trim();
      if (strict && raw === "") return { error: "Enter a share for each person, or use an equal split." };
      const amount = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(amount) || amount < 0) return { error: "Shares need to be zero or more." };
      shares.push({ personId: Number(input.dataset.person), amount });
    }
  }

  const paid = [];
  for (const row of document.querySelectorAll(".pay-row")) {
    const personId = Number(row.querySelector("select").value);
    const raw = row.querySelector("input").value.trim();
    if (!personId && !raw) continue;
    if (!personId) return { error: "Choose who paid." };
    if (!raw) return { error: "Enter the amount that was paid." };
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Payment amounts need to be above zero." };
    paid.push({ personId, amount });
  }

  if (!paid.length) {
    return { error: strict ? "Add at least one payment." : "Enter who paid and how much to see the split." };
  }

  const entry = { date, title: title || "Meal", type, split, members, paid };
  if (shares) entry.shares = shares;
  return { entry };
}

function updatePreview() {
  const built = readForm(false);
  const preview = $("preview");
  if (!built.entry) {
    preview.innerHTML = `<p>${escapeHtml(built.error || "Fill in the entry to see how the wallets move.")}</p>`;
    return;
  }

  const described = LunchLedger.describeEntry(
    built.entry,
    ledger.people,
    ledger.settings.currency || "Rs."
  );
  const rows = described.rows.map((row) => `
    <tr>
      <td data-label="Person">${escapeHtml(row.name)}</td>
      <td class="num" data-label="Paid">${row.paid ? money(row.paid) : "—"}</td>
      <td class="num" data-label="Share">${row.share ? money(row.share) : "—"}</td>
      <td class="num ${row.change > 0 ? "positive" : row.change < 0 ? "negative" : ""}" data-label="This entry">${money(row.change, true)}</td>
    </tr>
  `).join("");

  preview.innerHTML = `
    <p>${escapeHtml(described.summary)}</p>
    ${described.warning ? `<p class="form-error">${escapeHtml(described.warning)}</p>` : ""}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Person</th><th>Paid</th><th>Share</th><th>This entry</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted">Positive means this entry puts them ahead. Negative means they owe it.</p>
  `;
}

function resetForm() {
  editingId = null;
  $("formTitle").textContent = "Add an entry";
  $("saveEntry").textContent = "Save entry";
  $("cancelEdit").hidden = true;
  document.querySelector('input[name="type"][value="meal"]').checked = true;
  document.querySelector('input[name="split"][value="equal"]').checked = true;
  document.querySelector('[name="date"]').value = LunchLedger.todayISO();
  document.querySelector('[name="title"]').value = "Lunch";
  syncType({ keepTitle: true });
  renderMemberGrid(defaultMembers());
  renderPotGrid(new Map());
  renderHeldBy(String(ledger.settings.budgetPersonId || ledger.people[0].id));
  renderPaymentRows([{ personId: "", amount: "" }]);
  setFormError("");
  updatePreview();
}

function clearAmounts() {
  editingId = null;
  $("formTitle").textContent = "Add an entry";
  $("saveEntry").textContent = "Save entry";
  $("cancelEdit").hidden = true;
  document.querySelectorAll("#shareGrid input, #potGrid input, .pay-row input").forEach((input) => {
    input.value = "";
  });
  setFormError("");
  updatePreview();
}

function editEntry(id) {
  const entry = ledger.entries.find((item) => item.id === id);
  if (!entry) return;
  editingId = id;
  $("formTitle").textContent = "Edit this entry";
  $("saveEntry").textContent = "Save changes";
  $("cancelEdit").hidden = false;
  document.querySelector(`input[name="type"][value="${entry.type}"]`).checked = true;
  syncType({ keepTitle: true });
  document.querySelector('[name="date"]').value = entry.date;
  document.querySelector('[name="title"]').value = entry.title;

  if (entry.type === "pot") {
    renderHeldBy(String(entry.heldBy));
    renderPotGrid(new Map((entry.paid || []).map((payment) => [payment.personId, String(payment.amount)])));
  } else {
    document.querySelector(`input[name="split"][value="${entry.split}"]`).checked = true;
    renderMemberGrid(new Set(entry.members || []));
    renderShareGrid(new Map((entry.shares || []).map((share) => [share.personId, String(share.amount)])));
    renderPaymentRows(entry.paid || []);
  }

  setFormError("");
  updatePreview();
  renderEntries();
  $("entryForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function putLedger(next) {
  if (saving) return false;
  const result = LunchLedger.validate(next);
  if (!result.ok) {
    setStatus(result.errors[0], true);
    return false;
  }

  saving = true;
  try {
    const response = await fetch("/api/ledger", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.ledger)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(body.error || "Could not save.", true);
      return false;
    }
    ledger = body.ledger || result.ledger;
    return true;
  } catch {
    setStatus("The local server did not accept the save. Is npm start still running?", true);
    return false;
  } finally {
    saving = false;
  }
}

async function saveEntry(event) {
  event.preventDefault();
  const built = readForm(true);
  if (!built.entry) {
    setFormError(built.error);
    return;
  }

  const id = editingId || LunchLedger.nextEntryId(ledger.entries);
  const wasEdit = Boolean(editingId);
  const entries = ledger.entries.filter((entry) => entry.id !== editingId);
  entries.push({ ...built.entry, id });
  const saved = await putLedger({ ...ledger, entries });
  if (!saved) return;

  setStatus(wasEdit
    ? "Updated data.json. Commit and push when the team should see it."
    : "Saved to data.json. Commit and push when the team should see it.");
  if (wasEdit) resetForm();
  else clearAmounts();
  renderEntries();
}

async function deleteEntry(id) {
  const entry = ledger.entries.find((item) => item.id === id);
  if (!entry) return;
  if (!window.confirm(`Remove ${entry.title} on ${dateLabel(entry.date)}?`)) return;
  const entries = ledger.entries.filter((item) => item.id !== id);
  const saved = await putLedger({ ...ledger, entries });
  if (!saved) return;
  if (editingId === id) resetForm();
  renderEntries();
  setStatus("Removed from data.json. Commit and push when the team should see it.");
}

function renderEntries() {
  const query = $("entrySearch").value.trim().toLowerCase();
  const effects = LunchLedger.compute(ledger).effects.slice().reverse();
  const filtered = effects.filter((effect) => {
    if (!query) return true;
    const entry = effect.entry;
    const names = [
      ...(entry.members || []),
      ...(entry.paid || []).map((payment) => payment.personId),
      entry.heldBy
    ].map((personId) => LunchLedger.personName(ledger.people, personId));
    return [entry.date, entry.title, entry.type, ...names].join(" ").toLowerCase().includes(query);
  });

  const groups = new Map();
  for (const effect of filtered) {
    if (!groups.has(effect.entry.date)) groups.set(effect.entry.date, []);
    groups.get(effect.entry.date).push(effect);
  }

  $("entryCount").textContent = `${ledger.entries.length} saved`;
  $("entryList").innerHTML = [...groups.entries()].map(([date, group]) => `
    <div class="activity-day">
      <h3>${dateLabel(date)} <span>${group.length}</span></h3>
      ${group.map((effect) => {
        const entry = effect.entry;
        const kind = entry.type === "pot" ? "Pot" : entry.type === "settle" ? "Transfer" : "Meal";
        return `
          <article class="entry-card ${editingId === entry.id ? "is-editing" : ""}">
            <div class="entry-top">
              <strong>${escapeHtml(entry.title)}</strong>
              <strong>${money(effect.total)}</strong>
            </div>
            <p><span class="badge">${kind}</span></p>
            <div class="entry-actions">
              <button class="button ghost small" type="button" data-edit="${escapeHtml(entry.id)}">Edit</button>
              <button class="button danger small" type="button" data-delete="${escapeHtml(entry.id)}">Remove</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `).join("") || `<p class="empty">No entries match.</p>`;
}

function personIsUsed(personId) {
  return ledger.entries.some((entry) =>
    Number(entry.heldBy) === personId ||
    (entry.members || []).map(Number).includes(personId) ||
    (entry.shares || []).some((share) => Number(share.personId) === personId) ||
    (entry.paid || []).some((payment) => Number(payment.personId) === personId)
  );
}

function renderPeople() {
  const computed = LunchLedger.compute(ledger);
  $("bookNet").textContent = `All wallets together: ${money(computed.net, true)}.`;
  $("peopleList").innerHTML = ledger.people.map((person) => {
    const used = personIsUsed(person.id);
    return `
      <form class="person-row" data-id="${person.id}">
        <label>Name
          <input name="name" type="text" value="${escapeHtml(person.name)}" required>
        </label>
        <label>Opening
          <input name="openingBalance" type="number" step="0.01" value="${escapeHtml(person.openingBalance)}">
        </label>
        <label class="show-check">
          <input name="active" type="checkbox" ${person.active ? "checked" : ""}>
          Show
        </label>
        <button class="button small" type="submit">Save</button>
        ${used ? "" : `<button class="button danger small delete-person" type="button">Remove</button>`}
      </form>
    `;
  }).join("");
}

function refreshPeopleUi() {
  const members = selectedMemberIds();
  const shares = valueMap("#shareGrid input[data-person]");
  const pot = valueMap("#potGrid input[data-person]");
  const payments = [...document.querySelectorAll(".pay-row")].map((row) => ({
    personId: row.querySelector("select").value,
    amount: row.querySelector("input").value
  }));
  const heldBy = $("heldBy").value;
  renderPeople();
  renderMemberGrid(members);
  renderShareGrid(shares);
  renderPotGrid(pot);
  renderHeldBy(heldBy);
  renderPaymentRows(payments);
  renderEntries();
  updatePreview();
}

async function savePerson(form) {
  const id = Number(form.dataset.id);
  const name = form.name.value.trim();
  const openingBalance = Number(form.openingBalance.value);
  if (!name) {
    setStatus("A person needs a name.", true);
    return;
  }
  if (!Number.isFinite(openingBalance)) {
    setStatus("Opening balance must be a number.", true);
    return;
  }
  const people = ledger.people.map((person) =>
    person.id === id
      ? { ...person, name, openingBalance, active: form.active.checked }
      : person
  );
  const saved = await putLedger({ ...ledger, people });
  if (!saved) return;
  refreshPeopleUi();
  setStatus(`${name} saved.`);
}

async function addPerson(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const openingBalance = Number(form.openingBalance.value || 0);
  if (!name) return;
  if (!Number.isFinite(openingBalance)) {
    setStatus("Opening balance must be a number.", true);
    return;
  }
  const person = {
    id: LunchLedger.nextPersonId(ledger.people),
    name,
    openingBalance,
    active: true
  };
  const saved = await putLedger({ ...ledger, people: [...ledger.people, person] });
  if (!saved) return;
  form.reset();
  form.openingBalance.value = "0";
  refreshPeopleUi();
  setStatus(`${name} added.`);
}

async function deletePerson(personId) {
  const person = ledger.people.find((item) => item.id === personId);
  if (!person || personIsUsed(personId)) return;
  if (!window.confirm(`Remove ${person.name}?`)) return;
  const people = ledger.people.filter((item) => item.id !== personId);
  const saved = await putLedger({ ...ledger, people });
  if (!saved) return;
  refreshPeopleUi();
  setStatus(`${person.name} removed.`);
}

function onFormEdit(event) {
  setFormError("");
  if (event.target.name === "type") syncType();
  if (event.target.closest("#memberGrid") || event.target.name === "split") renderShareGrid();
  updatePreview();
}

function bindPage() {
  const form = $("entryForm");
  form.addEventListener("input", onFormEdit);
  form.addEventListener("change", onFormEdit);
  form.addEventListener("submit", saveEntry);
  $("cancelEdit").addEventListener("click", resetForm);
  $("addPayer").addEventListener("click", () => {
    addPaymentRow();
    updatePreview();
  });
  $("paymentRows").addEventListener("click", (event) => {
    const button = event.target.closest(".remove-payer");
    if (!button) return;
    const rows = $("paymentRows").querySelectorAll(".pay-row");
    if (rows.length === 1) {
      rows[0].querySelector("select").value = "";
      rows[0].querySelector("input").value = "";
    } else {
      button.closest(".pay-row").remove();
    }
    updatePreview();
  });
  $("selectAll").addEventListener("click", () => {
    renderMemberGrid(new Set(ledger.people.filter((person) => person.active).map((person) => person.id)));
    updatePreview();
  });
  $("selectNone").addEventListener("click", () => {
    renderMemberGrid(new Set());
    updatePreview();
  });
  $("titleChips").addEventListener("click", (event) => {
    const button = event.target.closest("[data-title]");
    if (!button) return;
    document.querySelector('[name="title"]').value = button.dataset.title;
    updatePreview();
  });
  $("entrySearch").addEventListener("input", renderEntries);
  $("entryList").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit]");
    const remove = event.target.closest("[data-delete]");
    if (edit) editEntry(edit.dataset.edit);
    if (remove) deleteEntry(remove.dataset.delete);
  });
  $("addPersonForm").addEventListener("submit", addPerson);
  $("peopleList").addEventListener("submit", (event) => {
    const form = event.target.closest(".person-row");
    if (!form) return;
    event.preventDefault();
    savePerson(form);
  });
  $("peopleList").addEventListener("click", (event) => {
    const button = event.target.closest(".delete-person");
    if (!button) return;
    deletePerson(Number(button.closest(".person-row").dataset.id));
  });
}

async function init() {
  setupTheme();
  bindPage();
  try {
    const response = await fetch("/api/ledger", { cache: "no-store" });
    if (!response.ok) throw new Error("missing");
    ledger = await response.json();
  } catch {
    $("offline").hidden = false;
    return;
  }
  $("workspace").hidden = false;
  resetForm();
  renderPeople();
  renderEntries();
}

init();
