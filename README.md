# Lunch Book

A shared lunch ledger for the office. Everyone can open the site to see who owes, who gets money back, and what's left in the pot.

- **On GitHub Pages** the site is read-only. It shows whatever was last pushed.
- **On your computer** (`npm start`) you can edit it: add, edit, duplicate and delete entries, and manage people.

Node.js is the only requirement. There are no packages to install.

---

## Daily routine (about 30 seconds)

1. In this folder, run:
   ```bash
   npm start
   ```
2. Open **http://127.0.0.1:5501/**. The pill at the top says **Editing on**.
3. Press **Add expense** (or the **N** key, or **+** on a phone).
4. Fill in the form:
   - **Who paid?** This defaults to the pot holder. Type the **total bill**. Maths works too, e.g. `500+220`.
   - **Who ate?** This starts with the same people as the last lunch. Tap names to add or remove people.
   - **Split:** choose **Equal**, or **Custom amounts**. For custom, type the odd amounts (for example, someone who only had tea for 50), then press **Split the rest equally**.
   - The **preview** shows what changes in each wallet and in the pot before you save.
5. Press **Save** (or Ctrl+Enter). **Save & add another** keeps the date and the people, which helps for lunch followed by snacks.
6. At the end of the day, publish:
   ```bash
   git add data
   git commit -m "Lunch 24 Nov"
   git push
   ```

Shortcuts:
- **Duplicate** (copy icon on an entry) copies an old entry with today's date.
- **Delete** has an **Undo** button in the pop-up.
- **Record** on a *Settle up* row pre-fills the transfer.

## The five kinds of entry

| Type | When to use it | Effect |
|---|---|---|
| **Meal** | Someone paid for food | Payer goes **up** by what they paid; everyone who ate goes **down** by their share |
| **Pot money** | People hand cash to the pot holder | Each giver goes up; the holder goes down by the total, because they now hold the cash. The month's pot goes up |
| **Transfer** | Cash passed between two people and it wasn't food | Giver goes up, receiver goes down |
| **Tax / Tip** | Extra charge on some wallets | Those wallets go down. Not food, and the pot is unchanged |

**Wallet rule:** a wallet moves by *what they paid − their share*. Green means the group owes them. Red means they should pay in.

### The pot vs. "outside the pot"

The **pot** is the real cash the pot holder keeps for the group:

> **Left in pot** = left from last month **+** pot money collected **−** bills the holder paid from it

- When **the holder pays** a bill, it comes **from the pot**. The holder's own share doesn't count, because they pay for their own food personally.
- When **someone else pays** (the holder is absent or has no cash), that bill is **outside the pot**. The pot doesn't change. The payer's wallet goes up by what they paid, so it's credited to them.
- **Total food** = from the pot + outside the pot + the holder's own food. The overview shows all three on one bar, so you can see each part and the combined total.

Every entry carries a tag: **from pot**, **outside pot**, **into pot** or **own pocket**. The add form tells you which one it will be before you save.

The pot holder's wallet is shown as their **own** balance, with the pot cash they hold shown next to it, so the cash they hold for the group doesn't make them look like a debtor.

---

## Where the data lives

```
data/
  book.json              settings + people + list of months
  months/
    2026-08.json         every entry of that month, grouped by day
    2026-09.json
    ...
```

The data is split by month, for three reasons:
- Old months never change, so a save only rewrites the current month's file. Git diffs stay small and clear.
- Each file stays small, even after years of lunches.
- Every entry is **one line**, so the files are easy to read and to fix by hand.

### `book.json`

```json
{
  "version": 2,
  "settings": { "currency": "Rs.", "currencyCode": "PKR", "budgetHolder": "sammad", "statsFrom": "2026-09" },
  "people": [
    { "id": "sammad", "name": "Abdul Sammad", "openingBalance": -702.43, "active": true },
    ...
  ],
  "months": ["2026-08", "2026-09", "2026-10", "2026-11"]
}
```

- `id` is a short key used inside the month files. You can change the display `name` freely, but never change an `id`.
- `openingBalance` is the wallet before the first entry in the book.
- `active: false` hides a person from the forms. Their history is kept.
- `budgetHolder` is the person who holds the pot money.

### A month file

```json
{
  "month": "2026-11",
  "days": {
    "2026-11-23": [
      { "type": "meal", "title": "Lunch", "paidBy": { "sammad": 500 }, "shares": { "sammad": 70, "wajahat": 120, "umair": 120, "rizwan": 70, "junaid": 120 } },
      { "type": "meal", "title": "Snacks", "paidBy": { "sammad": 290 }, "for": ["sammad", "wajahat", "umair", "rizwan", "junaid"] }
    ]
  }
}
```

| Type | Shape |
|---|---|
| Meal, equal split | `{ "type": "meal", "title": "Lunch", "paidBy": { "sammad": 700 }, "for": ["sammad", "umair"] }` |
| Meal, custom split | `{ "type": "meal", "title": "Lunch", "paidBy": { "sammad": 520 }, "shares": { "sammad": 115, "umair": 60 } }` |
| Pot money | `{ "type": "pot", "title": "Funding", "heldBy": "sammad", "from": { "umair": 5000, "rizwan": 3000 } }` |
| Transfer | `{ "type": "transfer", "title": "Exchange", "from": "kashif", "to": "sammad", "amount": 400 }` |
| Tax / Tip | `{ "type": "tax", "title": "Tax", "charges": { "umair": 30, "junaid": 30 } }` |

Any entry can also have `"note": "free text"`. A `0` in `shares` means the person joined but paid nothing.

### Safety nets

- The server **checks every save**. Unknown people, missing amounts and bad dates are rejected with a clear message.
- Before a file is overwritten, the old copy goes to `data/.backup/<time>/`. The last 40 saves are kept, and the folder is git-ignored.
- **Months → Backup** downloads the whole book as one JSON file. **Months → CSV** exports every wallet movement for Excel or Sheets.
- Git history is the long-term record.

## Migration from the old format

The old single `data.json` (numeric ids) is kept in `archive/data-v1.json`. `scripts/migrate-v1.js` converted it. It refuses to write anything unless every wallet, every month's pot and the entry count come out identical under the old and new calculations. All 122 entries matched exactly.

## Files

| File | Purpose |
|---|---|
| `index.html`, `app.js`, `style.css` | The app (overview, activity, people, months, add/edit form) |
| `ledger.js` | Data model and all calculations (shared by the browser and the server) |
| `server.js` | Local server: serves the site, and saves to `data/` |
| `data/` | The book |
| `archive/data-v1.json` | The original pre-migration data, untouched |
| `scripts/migrate-v1.js` | The one-time migration script |
