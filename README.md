# Lunch book

A shared lunch book for the office. Everyone can open the site and see who is ahead, who owes, and what is left in the pot.

The book is `data.json`. Update it on your computer, then commit and push. GitHub Pages shows the new numbers. It cannot save edits.

## Update the book

```bash
npm start
```

Open http://127.0.0.1:5501/manage.html

Add the meal and press **Save entry**. That writes `data.json`. Commit and push when the team should see it.

The shared page is http://127.0.0.1:5501/

Node.js is required. No packages are installed.

## What an entry means

A person's wallet moves by **what they paid minus their share**.

**Meal.** Someone paid for food. Split the bill equally, or type each person's share.

**Pot.** People hand cash to the person holding the lunch money. Each payer goes ahead by what they put in. The holder's wallet goes down by the total, because they are holding the cash. The monthly pot goes up by the same total.

**Transfer.** Cash moved between people and it was not food. Wallets change the same way as a meal, but it is left out of each person's food total.

The pot for a month starts with money collected, plus anything left from last month. It goes down by what everyone except the budget person ate. That person's own food is not taken out of the pot.

**Opening balance** is the wallet before the first entry in this file.

## Files

- `index.html` — the shared page
- `manage.html` — the local editing page
- `data.json` — the book
- `ledger.js` — the calculations
- `server.js` — the local server that can save
