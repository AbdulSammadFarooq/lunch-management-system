(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LunchLedger = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  // Three kinds of entry:
  // meal       someone paid a bill and it is split across the people who joined
  // pot        people hand cash to the person holding the lunch money
  // settle     cash moved between people and it was not food
  //
  // A wallet moves by: amount they paid minus their share.
  // The monthly pot falls only by everyone except the budget person's share.
  // That person's own food is counted on both sides, so it does not reduce the pot.

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function formatMoney(value, currency = "Rs.", signed = false) {
    const amount = Number(value) || 0;
    const body = Math.abs(amount).toLocaleString("en-PK", {
      maximumFractionDigits: 2
    });
    if (!signed) {
      return `${amount < 0 ? "−" : ""}${currency} ${body}`;
    }
    if (amount > 0) return `+${currency} ${body}`;
    if (amount < 0) return `−${currency} ${body}`;
    return `${currency} ${body}`;
  }

  function monthKey(dateValue) {
    return String(dateValue || "").slice(0, 7);
  }

  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric"
    });
  }

  function todayISO() {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function peopleById(people) {
    return new Map((people || []).map((person) => [Number(person.id), person]));
  }

  function personName(people, personId) {
    return peopleById(people).get(Number(personId))?.name || "Unknown";
  }

  function totalOf(entry) {
    return (entry.paid || []).reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0
    );
  }

  function paidMap(entry) {
    const paid = new Map();
    for (const payment of entry.paid || []) {
      const personId = Number(payment.personId);
      const amount = Number(payment.amount) || 0;
      paid.set(personId, (paid.get(personId) || 0) + amount);
    }
    return paid;
  }

  function shareMap(entry) {
    const shares = new Map();
    if (entry.type === "pot") {
      shares.set(Number(entry.heldBy), totalOf(entry));
      return shares;
    }

    const members = (entry.members || []).map(Number);
    if (entry.split === "custom") {
      for (const share of entry.shares || []) {
        shares.set(Number(share.personId), Number(share.amount) || 0);
      }
      for (const personId of members) {
        if (!shares.has(personId)) shares.set(personId, 0);
      }
      return shares;
    }

    const each = members.length ? totalOf(entry) / members.length : 0;
    for (const personId of members) shares.set(personId, each);
    return shares;
  }

  function entryEffect(entry) {
    const paid = paidMap(entry);
    const shares = shareMap(entry);
    const changes = new Map();
    const personIds = new Set([...paid.keys(), ...shares.keys()]);

    for (const personId of personIds) {
      changes.set(personId, (paid.get(personId) || 0) - (shares.get(personId) || 0));
    }

    return {
      entry,
      total: totalOf(entry),
      paid,
      shares,
      changes
    };
  }

  function describeEntry(entry, people, currency) {
    const effect = entryEffect(entry);
    const name = (personId) => personName(people, personId);
    const rows = [...effect.changes.keys()]
      .map((personId) => ({
        personId,
        name: name(personId),
        paid: effect.paid.get(personId) || 0,
        share: effect.shares.get(personId) || 0,
        change: effect.changes.get(personId) || 0
      }))
      .filter((row) => row.paid !== 0 || row.share !== 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    let summary = "";
    let warning = "";

    if (entry.type === "pot") {
      summary = `${formatMoney(effect.total, currency)} goes into the pot held by ${name(entry.heldBy)}. People who put money in go ahead by that amount. ${name(entry.heldBy)} goes down by the total, because they are holding the cash.`;
    } else if (entry.split === "custom") {
      const shareSum = [...effect.shares.values()].reduce((sum, amount) => sum + amount, 0);
      summary = `${formatMoney(effect.total, currency)} was paid. Each person is charged the share you entered.`;
      if (Math.abs(shareSum - effect.total) > 0.009) {
        warning = `Shares add up to ${formatMoney(shareSum, currency)}, but the payments add up to ${formatMoney(effect.total, currency)}. Wallets follow the shares.`;
      }
    } else {
      const count = (entry.members || []).length;
      const each = count ? effect.total / count : 0;
      summary = `${count} ${count === 1 ? "person splits" : "people split"} ${formatMoney(effect.total, currency)}. Each share is ${formatMoney(each, currency)}. Whoever paid goes ahead; everyone else owes their share.`;
    }

    if (entry.type === "settle") {
      summary += " This is a transfer, so it is not counted as food.";
    }

    return { ...effect, rows, summary, warning };
  }

  function compute(ledger) {
    const settings = ledger.settings || {};
    const currency = settings.currency || "Rs.";
    const budgetPersonId = Number(settings.budgetPersonId);
    const people = ledger.people || [];
    const entries = [...(ledger.entries || [])].sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );
    const effects = entries.map(entryEffect);
    const balances = new Map(
      people.map((person) => [Number(person.id), Number(person.openingBalance) || 0])
    );

    for (const effect of effects) {
      for (const person of people) {
        const change = effect.changes.get(Number(person.id)) || 0;
        balances.set(Number(person.id), (balances.get(Number(person.id)) || 0) + change);
      }
    }

    const months = new Map();
    const foodByMonth = new Map();

    function ensureMonth(key) {
      if (!months.has(key)) {
        months.set(key, {
          key,
          label: monthLabel(key),
          collected: 0,
          ownShare: 0,
          consumed: 0
        });
      }
      return months.get(key);
    }

    for (const effect of effects) {
      const key = monthKey(effect.entry.date);
      const bucket = ensureMonth(key);

      if (effect.entry.type === "pot") {
        bucket.collected += effect.total;
        continue;
      }

      let consumed = 0;
      for (const amount of effect.shares.values()) consumed += amount;
      bucket.consumed += consumed;
      bucket.ownShare += effect.shares.get(budgetPersonId) || 0;

      if (effect.entry.type !== "settle") {
        if (!foodByMonth.has(key)) foodByMonth.set(key, new Map());
        const food = foodByMonth.get(key);
        for (const [personId, amount] of effect.shares) {
          food.set(personId, (food.get(personId) || 0) + amount);
        }
      }
    }

    const currentKey = monthKey(todayISO());
    ensureMonth(currentKey);

    const firstPot = effects.find((effect) => effect.entry.type === "pot");
    const rolloverStart = firstPot ? monthKey(firstPot.entry.date) : "";
    let carried = 0;

    const monthList = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
    for (const month of monthList) {
      month.carriedIn = 0;
      month.budget = month.collected + month.ownShare;
      month.groupSpend = month.consumed - month.ownShare;
      if (rolloverStart && month.key >= rolloverStart) {
        month.carriedIn = carried;
        month.budget += carried;
        carried = month.budget - month.consumed;
      }
      month.left = month.budget - month.consumed;
      month.isCurrent = month.key === currentKey;
    }

    const statsFrom = settings.statsFrom || "";
    const averageKeys = monthList
      .map((month) => month.key)
      .filter((key) => key >= statsFrom && key < currentKey && foodByMonth.has(key));
    const keysForAverage = averageKeys.length
      ? averageKeys
      : foodByMonth.has(currentKey)
        ? [currentKey]
        : [];
    const averageFood = new Map(people.map((person) => [Number(person.id), 0]));

    for (const key of keysForAverage) {
      const food = foodByMonth.get(key) || new Map();
      for (const person of people) {
        const personId = Number(person.id);
        averageFood.set(personId, averageFood.get(personId) + (food.get(personId) || 0));
      }
    }

    if (keysForAverage.length) {
      for (const person of people) {
        const personId = Number(person.id);
        averageFood.set(personId, averageFood.get(personId) / keysForAverage.length);
      }
    }

    const spending = effects.filter((effect) => effect.entry.type !== "pot");
    const dates = [...new Set(spending.map((effect) => effect.entry.date))].sort();
    const averageIsCurrentOnly =
      keysForAverage.length === 1 && keysForAverage[0] === currentKey;
    const averageLabel =
      keysForAverage.length === 1 ? monthLabel(keysForAverage[0]) : "Usual month";
    const current = monthList.find((month) => month.isCurrent) || monthList[monthList.length - 1];
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysLeft = Math.max(daysInMonth - dayOfMonth + 1, 0);
    const groupPace = dayOfMonth > 0 ? current.groupSpend / dayOfMonth : 0;

    return {
      settings,
      currency,
      budgetPersonId,
      budgetPersonName: personName(people, budgetPersonId),
      people,
      balances,
      effects,
      months: monthList,
      foodByMonth,
      averageFood,
      averageMonthCount: keysForAverage.length,
      averageIsCurrentOnly,
      averageLabel,
      current: {
        ...current,
        daysInMonth,
        dayOfMonth,
        daysLeft,
        groupPace,
        dailyRoom: daysLeft > 0 ? Math.max(current.left, 0) / daysLeft : 0,
        daysOfPot: groupPace > 0 ? current.left / groupPace : null
      },
      overall: {
        spent: spending.reduce((sum, effect) => sum + [...effect.shares.values()].reduce((a, b) => a + b, 0), 0),
        firstDate: dates[0] || "",
        lastDate: dates[dates.length - 1] || "",
        days: dates.length
      },
      net: [...balances.values()].reduce((sum, amount) => sum + amount, 0)
    };
  }

  function cleanPaymentList(payments, knownIds) {
    const merged = [];
    const indexByPerson = new Map();

    for (const payment of payments || []) {
      const personId = Number(payment.personId);
      const amount = Number(payment.amount);
      if (!knownIds.has(personId)) {
        return { error: "A payment names a person who is not in the book." };
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return { error: "Every payment needs an amount above zero." };
      }
      if (indexByPerson.has(personId)) {
        merged[indexByPerson.get(personId)].amount += amount;
      } else {
        indexByPerson.set(personId, merged.length);
        merged.push({ personId, amount });
      }
    }

    if (!merged.length) {
      return { error: "Add at least one payment." };
    }

    return { payments: merged };
  }

  function validate(input) {
    const errors = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, errors: ["The book must be an object."] };
    }

    const sourcePeople = Array.isArray(input.people) ? input.people : [];
    if (!sourcePeople.length) errors.push("Add at least one person.");

    const people = [];
    const knownIds = new Set();

    for (const person of sourcePeople) {
      const id = Number(person.id);
      const name = String(person.name || "").trim();
      const openingBalance = Number(person.openingBalance);
      if (!Number.isInteger(id) || id <= 0) {
        errors.push("Each person needs a positive id.");
        continue;
      }
      if (knownIds.has(id)) {
        errors.push(`Person id ${id} is used more than once.`);
        continue;
      }
      if (!name) {
        errors.push("Each person needs a name.");
        continue;
      }
      if (!Number.isFinite(openingBalance)) {
        errors.push(`${name} needs a numeric opening balance.`);
        continue;
      }
      knownIds.add(id);
      people.push({
        id,
        name,
        openingBalance,
        active: person.active !== false
      });
    }

    people.sort((a, b) => a.id - b.id);

    const sourceEntries = Array.isArray(input.entries) ? input.entries : [];
    const entries = [];
    const seenEntryIds = new Set();

    sourceEntries.forEach((entry, index) => {
      const id = String(entry.id || "").trim();
      const date = String(entry.date || "").trim();
      const title = String(entry.title || "").trim();
      const type = entry.type;

      if (!id) {
        errors.push(`Entry ${index + 1} needs an id.`);
        return;
      }
      if (seenEntryIds.has(id)) {
        errors.push(`Entry id ${id} is used more than once.`);
        return;
      }
      seenEntryIds.add(id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(`${title || id} needs a date like 2026-10-30.`);
        return;
      }
      if (!title) {
        errors.push(`The entry on ${date} needs a name.`);
        return;
      }
      if (!["meal", "pot", "settle"].includes(type)) {
        errors.push(`${title} has an unknown type.`);
        return;
      }

      const paidResult = cleanPaymentList(entry.paid, knownIds);
      if (paidResult.error) {
        errors.push(`${title}: ${paidResult.error}`);
        return;
      }

      if (type === "pot") {
        const heldBy = Number(entry.heldBy);
        if (!knownIds.has(heldBy)) {
          errors.push(`${title} needs a person who is holding the pot.`);
          return;
        }
        entries.push({
          id,
          date,
          title,
          type,
          heldBy,
          paid: paidResult.payments,
          order: index
        });
        return;
      }

      const split = entry.split === "custom" ? "custom" : entry.split === "equal" ? "equal" : "";
      if (!split) {
        errors.push(`${title} must be an equal split or a custom split.`);
        return;
      }

      const members = [];
      const seenMembers = new Set();
      for (const memberId of entry.members || []) {
        const personId = Number(memberId);
        if (!knownIds.has(personId) || seenMembers.has(personId)) continue;
        seenMembers.add(personId);
        members.push(personId);
      }
      if (!members.length) {
        errors.push(`${title} needs at least one person.`);
        return;
      }

      const cleaned = {
        id,
        date,
        title,
        type,
        split,
        members,
        paid: paidResult.payments,
        order: index
      };

      if (split === "custom") {
        const amounts = new Map(
          (entry.shares || []).map((share) => [Number(share.personId), Number(share.amount)])
        );
        const shares = [];
        for (const personId of members) {
          const amount = amounts.get(personId);
          if (!Number.isFinite(amount) || amount < 0) {
            errors.push(`${title} is missing a share for one of the people.`);
            return;
          }
          shares.push({ personId, amount });
        }
        cleaned.shares = shares;
      }

      entries.push(cleaned);
    });

    if (errors.length) return { ok: false, errors };

    entries.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    for (const entry of entries) delete entry.order;

    const settingsInput = input.settings || {};
    let budgetPersonId = Number(settingsInput.budgetPersonId);
    if (!knownIds.has(budgetPersonId)) budgetPersonId = people[0].id;

    const ledger = {
      settings: {
        currency: String(settingsInput.currency || "Rs."),
        currencyCode: String(settingsInput.currencyCode || "PKR"),
        budgetPersonId,
        statsFrom: String(settingsInput.statsFrom || "2026-09")
      },
      people,
      entries
    };

    return { ok: true, errors: [], ledger };
  }

  function nextPersonId(people) {
    return (people || []).reduce((max, person) => Math.max(max, Number(person.id) || 0), 0) + 1;
  }

  function nextEntryId(entries) {
    const max = (entries || []).reduce((current, entry) => {
      const match = String(entry.id || "").match(/^e(\d+)$/);
      return match ? Math.max(current, Number(match[1])) : current;
    }, 0);
    return `e${max + 1}`;
  }

  return {
    roundMoney,
    formatMoney,
    monthKey,
    monthLabel,
    todayISO,
    personName,
    totalOf,
    entryEffect,
    describeEntry,
    compute,
    validate,
    nextPersonId,
    nextEntryId
  };
});
