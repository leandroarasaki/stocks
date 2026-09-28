# Watchlist

A small personal tool that charts a set of tickers, runs a couple of simple
technical strategies against them, and gives a Buy, Watch, Hold, or Sell read.
Prices update once a day on their own, no server to run or pay for.

## What is in here

```
index.html               the page itself
style.css                look and layout
app.js                   chart rendering, indicator math, the recommendation logic
data/tickers.json        the list of symbols tracked, edit this to change the watchlist
data/data.json           the price history the page reads, refreshed daily by the workflow
scripts/fetch_data.py    pulls fresh price history from Yahoo Finance
.github/workflows/       the schedule that runs fetch_data.py every day and saves the result
```

Right now data/data.json holds sample, made up numbers so the page has
something to show right away. Once the workflow below runs once, it gets
replaced with real prices and keeps refreshing daily from then on.

## Putting it online, step by step

1. Create a free GitHub account if you do not already have one, at
   github.com.
2. Create a new repository (the green "New" button), give it any name such
   as watchlist, and keep it public.
3. Upload every file in this folder into that repository, keeping the same
   folders (data, scripts, .github). On the repository page you can use "Add
   file" then "Upload files" and drag the whole folder in.
4. Open the repository's Settings tab, then Pages on the left. Under
   "Build and deployment", choose "Deploy from a branch", pick the main
   branch and the root folder, then save. GitHub will give you a web
   address, something like yourname.github.io/watchlist. That is the link
   you and your friend will use.
5. Open the Actions tab and allow workflows to run if it asks. Find "Update
   price data" in the list, open it, and press "Run workflow" once by hand
   so you do not have to wait for the schedule. After it finishes, the page
   will show real prices.
6. From here on the workflow runs by itself every weekday shortly after the
   US market closes, so the page is always current the next time either of
   you opens it.

## Changing the watchlist

Open data/tickers.json and add or remove entries. Each one needs:

```
{ "symbol": "TSLA", "yahoo": "TSLA", "type": "stock" }
```

The yahoo field is the ticker symbol as Yahoo Finance uses it, which for US
listed stocks and ETFs is almost always just the plain ticker. For crypto,
use type crypto and the Yahoo style symbol, like ETH-USD or BTC-USD.

After editing, either wait for the next scheduled run or trigger "Run
workflow" by hand from the Actions tab to pull the new symbol in right away.

## About the recommendation

It is a simple point system, nothing more. Each strategy you turn on votes
Buy, Sell, or neutral based on where price sits today relative to that
strategy's own rule (for example, price above both a short and long moving
average is a Buy vote for that strategy). The votes are averaged into one
of Buy, Watch, Hold, or Sell. You can change the moving average lengths and
the CCI period right on the page, the read updates instantly.

Wyckoff is left out of the automated scoring for now, since your actual
process leans on reading volume structure by eye rather than a fixed rule,
which is not something a formula can fairly stand in for. It can be added
later as a manual field, or as a simplified proxy, once you decide how much
of that judgment you are comfortable handing to a formula.

This is a personal reference tool built from public daily data. It is not
investment advice and it is not meant to replace your own judgment or your
TradingView setup, just to give a quick daily read the two of you can glance
at from any browser.
