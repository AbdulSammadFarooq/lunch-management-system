# Lunch Ledger

A simple responsive lunch expense and wallet management system built with HTML, CSS, vanilla JavaScript and JSON.

## Files

- `index.html` - UI
- `style.css` - responsive styling
- `app.js` - calculations and rendering
- `data.json` - the only file you normally need to edit

## Data model

Each person has an `initialBalance`.

Each day has:
- `participants`: IDs of people who ate lunch
- `expenses`: one or more payments, each with `amount` and `paidBy`
- optional `label`: a name such as `Lunch`, `Snacks`, or `Dinner`

Multiple entries may use the same `date`. Each entry is calculated with its own participants and split, then the dashboard combines them into one date while keeping the transactions separate and labeled.

## Formula

`totalExpense = sum(expenses.amount)`

`perHead = totalExpense / participants.length`

For each participant:

`dailyChange = amountPaidByPerson - perHead`

For non-participants:

`dailyChange = 0`

`currentWallet = initialBalance + sum(all dailyChange values)`

## Example

If 4 people eat and the total expense is Rs. 1000:

`perHead = 1000 / 4 = Rs. 250`

If Abdul pays Rs. 1000:

- Abdul: +750
- Other 3 participants: -250 each
- Everyone who did not eat: 0

## Adding a new day

Add another object to `days` in `data.json`:

```json
{
  "date": "2026-08-29",
  "participants": [1, 2, 5],
  "expenses": [
    { "amount": 750, "paidBy": 1 }
  ]
}
```

For another transaction on the same date, add a second object with the same `date` and a different `label`. Its participants and expense will be calculated independently.

You can have 2, 5, 10, or any number of participants.

## Running

Use VS Code Live Server, or any local HTTP server. Do not open `index.html` directly with `file://`, because browsers block the JSON fetch in that mode.
