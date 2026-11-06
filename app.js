(function () {
  "use strict";

  var LOCAL = location.protocol === "file:" || location.hostname === "127.0.0.1" || location.hostname === "localhost";
  var DATA_URL = LOCAL
    ? "status.sample.json"
    : "https://raw.githubusercontent.com/emmanuelebube13/scalablebrain-live/data/status.json";
  var POLL_MS = 60000;
  var STALE_MIN = 20;

  var state = { data: null, error: false, table: "fact_market_prices" };
  var view = document.getElementById("view");
  var params = new URLSearchParams(location.search);

  if (params.get("embed") === "1") document.documentElement.classList.add("embed");

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function absent(reason) {
    return '<span class="dim" title="' + esc(reason || "Not available") + '">—</span>';
  }
  function num(value, reason) {
    return value === null || value === undefined ? absent(reason) : esc(Number(value).toLocaleString("en-US"));
  }
  function compact(value) {
    if (value === null || value === undefined) return absent("Not available");
    if (value >= 1e6) return esc((value / 1e6).toFixed(1)) + "M";
    if (value >= 1e4) return esc(Math.round(value / 1e3)) + "K";
    return esc(Number(value).toLocaleString("en-US"));
  }
  function ago(iso) {
    if (!iso) return null;
    var seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (seconds < 90) return "just now";
    if (seconds < 5400) return Math.round(seconds / 60) + " min ago";
    if (seconds < 129600) return Math.round(seconds / 3600) + " h ago";
    return Math.round(seconds / 86400) + " days ago";
  }
  var LABELS = {
    ok: ["●", "OK"], warn: ["▲", "Needs attention"], fault: ["✕", "Fault"],
    closed: ["○", "Market closed"], unknown: ["○", "Unknown"]
  };
  function status(code) {
    var key = LABELS[code] ? code : "unknown";
    return '<span class="status status-' + key + '"><span aria-hidden="true">' + LABELS[key][0] + "</span>" + LABELS[key][1] + "</span>";
  }
  function byId(list, id) {
    return (list || []).filter(function (x) { return x.id === id; })[0];
  }
  function systemBadge(id) {
    var item = state.data && byId(state.data.systems, id);
    return status(item ? item.status : "unknown");
  }
  function kpi(label, value, sub) {
    return '<div class="card kpi"><div class="label">' + esc(label) + '</div><div class="value">' + value + "</div>" +
      (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") + "</div>";
  }

  function renderOverview(d) {
    var systems = d.systems || [];
    var bad = systems.filter(function (s) { return s.status === "fault"; }).length;
    var warn = systems.filter(function (s) { return s.status === "warn" || s.status === "unknown"; }).length;
    var tone = bad ? "fault" : warn ? "warn" : "ok";
    var text = bad
      ? "A system has a fault"
      : warn ? "A system needs attention" : "All systems are running normally";
    var why = bad || warn
      ? "This is the real state of the system. Faults stay visible here until they are fixed."
      : (d.market && d.market.open ? "The market is open." : "The market is closed, so no new candles are expected.");

    var systemCards = systems.map(function (s) {
      var seen = ago(s.as_of);
      return '<div class="card"><div class="sys-head"><h3>' + esc(s.name) + "</h3>" + status(s.status) + "</div>" +
        '<p class="dim" style="margin:0">' + esc(s.detail) + "</p>" +
        (seen ? '<p class="meta">Latest data ' + esc(seen) + "</p>" : "") + "</div>";
    }).join("");

    var jobs = (d.scheduler || []).map(function (j) {
      var seen = ago(j.last_run);
      return "<tr><td>" + esc(j.name) + "</td><td>" + status(j.status) + '</td><td class="num mono small">' +
        (seen ? esc(seen) : absent("No run time reported")) + "</td></tr>";
    }).join("");

    var gate = d.gate, recon = d.reconciliation, r = d.research || {}, trials = r.trials || {};
    var reconText = recon
      ? (recon.divergences === 0 ? "No mismatches between broker and system records." : "Mismatches found between broker and system records.")
      : "Reconciliation status is not available.";

    return "<h1>Live system view</h1>" +
      '<p class="lede">A real quantitative research and trading platform, running on a practice account. ' +
      "Every number below comes from the running system, with no login and no mock data.</p>" +
      '<div class="verdict tone-' + tone + '"><div><strong>' + esc(text) + '</strong><span class="dim">' + esc(why) + "</span></div></div>" +
      '<div class="grid g4">' +
      kpi("Rows in the modelled tables", compact(d.data && d.data.total_rows), "Across " + ((d.data && d.data.tables) || []).length + " documented tables") +
      kpi("Registered trials", num(trials.total), "Counted whether they pass or fail") +
      kpi("Trials passed", num(trials.pass), "After costs, on the fixed rules") +
      kpi("Forward-tested trades", num(r.forward && r.forward.trades), "Recorded in an append-only ledger") +
      "</div>" +
      "<h2>Core systems</h2>" +
      '<div class="grid g4">' + systemCards + "</div>" +
      "<h2>Scheduled jobs</h2>" +
      '<div class="card table-card"><table><thead><tr><th>Job</th><th>Last result</th><th class="num">Last run</th></tr></thead><tbody>' + jobs + "</tbody></table></div>" +
      "<h2>Risk controls</h2>" +
      '<div class="grid g3">' +
      '<div class="card"><div class="sys-head"><h3>Reconciliation</h3>' + status(recon ? (recon.divergences === 0 ? "ok" : "warn") : "unknown") + '</div><p class="dim" style="margin:0">' + esc(reconText) + "</p></div>" +
      kpi("Orders rejected by the risk gate", gate ? num(gate.rejected) : absent("Not available"), "Since the gate started recording") +
      kpi("Orders reduced by the risk gate", gate ? num(gate.reduced) : absent("Not available"), "Since the gate started recording") +
      "</div>";
  }

  function node(title, role, badge, cls) {
    return '<div class="node ' + (cls || "") + '"><h3>' + esc(title) + '</h3><p class="role">' + esc(role) + "</p>" + (badge || "") + "</div>";
  }
  function flow(nodes) {
    return '<div class="flow">' + nodes.join('<span class="arrow" aria-hidden="true">→</span>') + "</div>";
  }

  function renderMap() {
    return "<h1>System map</h1>" +
      '<p class="lede">Three independent services make up the trading path. A separate research path tests new ideas before they can reach it. Status badges are live.</p>' +
      '<section class="lane"><h2>Trading path</h2>' +
      "<p class=\"dim\">A signal must pass an independent risk service before it can become an order.</p>" +
      flow([
        node("Market data", "Broker candles with bid and ask, on several timeframes."),
        node("Brain", "Ingests data, checks quality, labels regimes and emits scored signals.", systemBadge("s1"), "s1"),
        node("Cloud messaging", "Google Cloud Pub/Sub carries signals. Cloud Storage holds versioned model sets."),
        node("Guardian", "Applies layered risk checks and sizes or rejects each signal.", systemBadge("s3"), "s3"),
        node("Hand", "Places orders, tracks fills and reconciles with the broker.", systemBadge("s2"), "s2"),
        node("Practice account", "A broker practice account. This page shows no balances or positions.")
      ]) + "</section>" +
      '<section class="lane"><h2>Research path</h2>' +
      '<p class="dim">Rules are written and fixed before a test runs, and the final test window is used once.</p>' +
      flow([
        node("Free data sources", "Prices plus public economic series and event calendars."),
        node("Point-in-time store", "Records when each value became known."),
        node("Registered card", "Fixes the rules and pass and kill criteria, with a file hash."),
        node("Backtest", "Search-window test with spreads, slippage and financing."),
        node("One-shot test", "A single run on held-back data."),
        node("Forward ledger", "New trades recorded as they happen. Closed rows cannot change.")
      ]) + "</section>" +
      '<section class="lane"><h2>How this page gets its data</h2>' +
      '<p class="dim">Data moves one way. A private job pushes a small file out, and nothing here can connect back in.</p>' +
      flow([
        node("Private systems", "Databases and telemetry, with no public access from this page."),
        node("Export job", "Runs about every 5 minutes with read-only database sessions.", systemBadge("tele")),
        node("Safety check", "Blocks unknown fields, private-looking values and strategies still under test."),
        node("GitHub", "Holds only the latest status file, on a public branch."),
        node("This page", "A static site. It has no server, login or database of its own.")
      ]) +
      '<p class="boundary">If the export stops, this page keeps its last data and shows its age. It does not guess.</p></section>';
  }

  var DECISIONS = [
    ["Facts and dimensions", "Prices, signals, outcomes and trades are fact tables that join to shared dimensions, so one instrument means the same thing everywhere."],
    ["Point-in-time data", "External data stores both when a value applied and when it became known, which prevents look-ahead bias in backtests."],
    ["Tamper-resistant records", "A database trigger refuses deletes from the forward ledger and freezes each trade once it closes."],
    ["Full lineage", "A result traces back through its run, code version, parameters, costs and the card registered before the test."]
  ];
  var STORE_NAMES = { market: "Market and trading", research: "Research", external: "External data" };

  function renderModel(d) {
    var tables = (d.data && d.data.tables) || [];
    var selected = tables.filter(function (t) { return t.name === state.table; })[0] || tables[0];
    var list = ["market", "research", "external"].map(function (store) {
      var items = tables.filter(function (t) { return t.store === store; }).map(function (t) {
        return '<button type="button" class="table-btn" data-table="' + esc(t.name) + '" aria-pressed="' + (t === selected) + '">' +
          '<span class="mono">' + esc(t.name) + '</span><span class="count mono">' + compact(t.rows) + "</span></button>";
      }).join("");
      return "<h3>" + esc(STORE_NAMES[store]) + "</h3>" + items;
    }).join("");

    var detail = absent("No tables received");
    if (selected) {
      var names = tables.map(function (t) { return t.name; });
      var linkOut = (selected.links || []).filter(function (n) { return n !== selected.name; });
      var linkIn = tables.filter(function (t) {
        return t.name !== selected.name && (t.links || []).indexOf(selected.name) !== -1;
      }).map(function (t) { return t.name; });
      var chip = function (name) {
        return names.indexOf(name) !== -1
          ? '<button type="button" class="pill" data-table="' + esc(name) + '">' + esc(name) + "</button>"
          : '<span class="pill">' + esc(name) + "</span>";
      };
      var pk = selected.pk || [];
      var cols = (selected.columns || []).map(function (c) {
        return "<tr><td>" + esc(c.name) + (pk.indexOf(c.name) !== -1 ? '<span class="key">Primary key</span>' : "") + "</td><td>" + esc(c.type) + "</td></tr>";
      }).join("");
      detail = '<div class="card"><h2 class="mono" style="margin:0 0 6px;overflow-wrap:anywhere">' + esc(selected.name) + "</h2>" +
        "<p>" + esc(selected.note) + "</p>" +
        '<div class="facts">' +
        '<div><div class="label">Grain</div><div style="line-height:18px">' + esc(selected.grain) + "</div></div>" +
        '<div><div class="label">Rows (estimate)</div><div class="value">' + num(selected.rows, "Count not available") + "</div></div>" +
        '<div><div class="label">Size</div><div class="value">' + (selected.mb < 1 ? "Under 1 MB" : num(selected.mb) + " MB") + "</div></div>" +
        "</div>" +
        (linkOut.length ? '<p class="small dim" style="margin-bottom:6px">References</p><div>' + linkOut.map(chip).join("") + "</div>" : "") +
        (linkIn.length ? '<p class="small dim" style="margin:10px 0 6px">Referenced by</p><div>' + linkIn.map(chip).join("") + "</div>" : "") +
        '<h3 style="margin-top:18px">Columns</h3><table class="cols"><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>' + cols + "</tbody></table></div>";
    }

    return "<h1>Data model</h1>" +
      '<p class="lede">Select a table to see its grain, keys and relationships. Columns, keys, links and row counts are read from the live database catalog. Grain and design notes are written by hand. No row-level data is published.</p>' +
      '<div class="grid g4" style="margin:20px 0">' +
      kpi("Modelled rows", compact(d.data && d.data.total_rows), "Estimated from the database catalog") +
      kpi("Storage", d.data ? esc(d.data.total_gb) + " GB" : absent(), "Including indexes") +
      kpi("Price history from", d.data && d.data.history_from ? esc(d.data.history_from.slice(0, 4)) : absent(), "Longest timeframe") +
      kpi("Timeframes", d.data ? esc((d.data.timeframes || []).length) : absent(), ((d.data && d.data.timeframes) || []).join(", ")) +
      "</div>" +
      '<div class="grid g2" style="margin-bottom:20px">' + DECISIONS.map(function (x) {
        return '<div class="card"><h3>' + esc(x[0]) + '</h3><p class="dim" style="margin:0">' + esc(x[1]) + "</p></div>";
      }).join("") + "</div>" +
      '<div class="model"><div class="card table-list">' + list + "</div><div>" + detail + "</div></div>";
  }

  var STAGES = [["idea", "Idea"], ["registered", "Registered"], ["backtest", "Backtest"], ["one_shot", "One-shot"], ["shadow", "Forward test"], ["killed", "Killed"]];

  function renderResearch(d) {
    var r = d.research || {}, trials = r.trials || {}, stages = r.stages || {}, f = r.forward || {};
    var max = Math.max.apply(null, STAGES.map(function (s) { return stages[s[0]] || 0; }).concat([1]));
    var bars = STAGES.map(function (s) {
      var n = stages[s[0]];
      return '<div class="bar-row"><span class="small">' + esc(s[1]) + '</span><div class="bar-track"><div class="bar" style="width:' + ((n || 0) / max * 100) + '%"></div></div><span class="n">' + num(n === undefined ? 0 : n) + "</span></div>";
    }).join("");
    var rows = (r.killed_recent || []).map(function (k) {
      return "<tr><td>" + esc(k.title) + '</td><td class="dim small">' + esc((k.family || "").replace(/_/g, " ")) + '</td><td class="num mono small">' + esc(k.date) + "</td></tr>";
    }).join("");
    var seen = ago(f.last_recorded);

    return "<h1>Research record</h1>" +
      '<p class="lede">Most trading ideas fail once real costs and repeated testing are counted. Every test is registered first and stays in the count, including the failures. Rules for ideas still under test stay private.</p>' +
      '<div class="grid g4" style="margin:20px 0">' +
      kpi("Registered trials", num(trials.total)) +
      kpi("Passed", num(trials.pass), "None has met every rule so far") +
      kpi("Killed by their own rules", num(trials.killed)) +
      kpi("Backtest runs completed", num(r.runs_completed)) +
      "</div>" +
      '<div class="grid g2">' +
      '<div class="card"><h3>Where ideas are now</h3><p class="small dim">Current stage of each strategy idea.</p>' + bars + "</div>" +
      '<div class="card"><h3>Trial verdicts</h3><table><tbody>' +
      '<tr><td>Passed</td><td class="num mono">' + num(trials.pass) + "</td></tr>" +
      '<tr><td>Promising, but not a pass</td><td class="num mono">' + num(trials.promising) + "</td></tr>" +
      '<tr><td>Inconclusive</td><td class="num mono">' + num(trials.inconclusive) + "</td></tr>" +
      '<tr><td>Killed</td><td class="num mono">' + num(trials.killed) + "</td></tr>" +
      '<tr><td>No verdict recorded</td><td class="num mono">' + num(trials.pending) + "</td></tr>" +
      "</tbody></table></div></div>" +
      "<h2>Forward-test ledger</h2>" +
      '<div class="grid g4">' +
      kpi("Trades recorded", num(f.trades)) +
      kpi("Trades closed", num(f.closed)) +
      kpi("Strategies recording", num(f.strategies)) +
      kpi("Last new trade", seen ? esc(seen) : absent("No trades recorded"), "Results are not published") +
      "</div>" +
      "<h2>Recently killed</h2>" +
      '<div class="card table-card"><table><thead><tr><th>Hypothesis</th><th>Family</th><th class="num">Killed</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  function renderAbout() {
    return "<h1>About this page</h1>" +
      '<p class="lede">Scalable Brain is a data and trading research platform that has been in development for years. This page lets anyone see the real system working, without access to the system itself.</p>' +
      '<div class="grid g2" style="margin-top:20px">' +
      '<div class="card"><h3>What is shown</h3><ul class="plain">' +
      "<li>Service health and job results</li><li>The data model, with live row counts</li><li>Research counts and verdicts</li><li>Titles of hypotheses that have been killed</li></ul></div>" +
      '<div class="card"><h3>What stays private</h3><ul class="plain">' +
      "<li>Balances, account details and profit or loss</li><li>Open positions and live signals</li><li>Rules and results of strategies still under test</li><li>Credentials, hostnames and network addresses</li></ul></div>" +
      '<div class="card"><h3>Built with</h3><ul class="plain">' +
      "<li>PostgreSQL 16 and Python</li><li>Google Cloud Storage and Pub/Sub</li><li>A static front end on GitHub Pages</li></ul></div>" +
      '<div class="card"><h3>How fresh is it?</h3><p class="dim" style="margin:0">The export runs about every 5 minutes and files may be cached for a few more. The bar at the top always shows the age of the data.</p></div>' +
      "</div>" +
      '<p class="meta" style="margin-top:20px">For information only. This is not financial advice or an offer of any service. Nothing here is a claim of trading returns. <a href="https://github.com/emmanuelebube13/scalablebrain-live">Source for this page and its export job</a>.</p>';
  }

  function updateFreshness() {
    var el = document.getElementById("freshness");
    var d = state.data;
    if (!d) {
      el.textContent = state.error ? "Could not load live data" : "Loading live data";
      return;
    }
    var minutes = (Date.now() - Date.parse(d.generated_at)) / 60000;
    var env = d.environment === "practice" ? "Practice account" : "Account type unknown";
    if (minutes > STALE_MIN) {
      el.innerHTML = status("warn") + " <b>Updates paused.</b> Showing data from " + esc(ago(d.generated_at)) + ". " + esc(env) + ".";
    } else {
      el.innerHTML = status("ok").replace("OK", "Live") + " Updated " + esc(ago(d.generated_at)) + ". " + esc(env) + ". " + esc(d.market ? d.market.label : "") + ".";
    }
  }

  var VIEWS = { overview: renderOverview, map: renderMap, model: renderModel, research: renderResearch, about: renderAbout };

  function currentView() {
    var name = location.hash.replace("#", "");
    return VIEWS[name] ? name : "overview";
  }

  function render() {
    var name = currentView();
    document.querySelectorAll(".nav a").forEach(function (a) {
      if (a.dataset.view === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    updateFreshness();
    if (name === "about" || name === "map") {
      view.innerHTML = VIEWS[name]();
      return;
    }
    if (state.data) {
      view.innerHTML = VIEWS[name](state.data);
    } else if (state.error) {
      view.innerHTML = '<div class="verdict tone-warn error-box"><div><strong>Live data could not be loaded</strong><p class="dim" style="margin:4px 0 10px">The connection to the status file failed. Try again in a moment.</p><button id="retry" class="ghost" type="button">Try again</button></div></div>';
    } else {
      view.innerHTML = '<p class="dim">Loading live data.</p>';
    }
  }

  function load() {
    return fetch(DATA_URL + "?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      })
      .then(function (data) {
        var changed = !state.data || state.data.generated_at !== data.generated_at;
        state.data = data;
        state.error = false;
        if (changed) render(); else updateFreshness();
      })
      .catch(function () {
        state.error = true;
        if (state.data) updateFreshness(); else render();
      });
  }

  view.addEventListener("click", function (event) {
    var button = event.target.closest("[data-table]");
    if (button) {
      state.table = button.getAttribute("data-table");
      render();
      return;
    }
    if (event.target.id === "retry") load();
  });

  var themeButton = document.getElementById("theme");
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeButton.textContent = theme === "light" ? "Dark theme" : "Light theme";
    try { localStorage.setItem("sb-live-theme", theme); } catch (e) { /* storage may be blocked in an embed */ }
  }
  var saved = null;
  try { saved = localStorage.getItem("sb-live-theme"); } catch (e) { /* storage may be blocked in an embed */ }
  setTheme(params.get("theme") || saved || "dark");
  themeButton.addEventListener("click", function () {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
  });

  window.addEventListener("hashchange", function () {
    render();
    window.scrollTo(0, 0);
  });
  render();
  load();
  setInterval(load, POLL_MS);
  setInterval(updateFreshness, 30000);
})();
