(function () {
  "use strict";

  var LOCAL = location.protocol === "file:" || location.hostname === "127.0.0.1" || location.hostname === "localhost";
  var DATA_URL = LOCAL
    ? "status.sample.json"
    : "https://raw.githubusercontent.com/emmanuelebube13/scalablebrain-live/data/status.json";
  var SOURCE_URL = "https://github.com/emmanuelebube13/scalablebrain-live";
  var PORTFOLIO_URL = "https://emmanuelebube13.github.io/Portfolio/";
  /* Wording supplied by the owner. Keep it as written. */
  var PRACTICE_NOTE = "Scalable Brain is my data consulting practice, running since 2020. I design data models, pipelines and monitoring for systems where the numbers have to be right. Its flagship build is a live research and trading data platform, which you can explore below.";
  var OFFERINGS = [
    ["Data modeling", "Dimensional, relational and point-in-time models, with clear grain, keys and audit trails.", "#model", "See the data model"],
    ["Data pipelines and quality", "Automated ingestion, validation and quarantine, with lineage back to each source run.", "#map", "See the system map"],
    ["Telemetry and monitoring", "Live dashboards, job health, reconciliation and alerts.", "#telemetry", "See the telemetry"],
    ["Reporting and BI", "Power BI models and decision-ready reports.", PORTFOLIO_URL + "pbi-property-sales.html", "See a Power BI report"],
    ["Research validation", "Pre-registered tests, realistic cost modeling and forward-test records.", "#research", "See the research record"]
  ];
  var POLL_MS = 60000;
  var STALE_MIN = 20;

  var state = { data: null, error: false, table: "fact_market_prices", area: "market" };
  var view = document.getElementById("view");
  var params = new URLSearchParams(location.search);

  if (params.get("embed") === "1") document.documentElement.classList.add("embed");

  /* ---------- Formatting ---------- */
  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function absent(reason) {
    return '<span class="dim" title="' + esc(reason || "Not available") + '">—</span>';
  }
  function has(value) {
    return value !== null && value !== undefined;
  }
  function num(value, reason) {
    return has(value) ? esc(Number(value).toLocaleString("en-US")) : absent(reason);
  }
  function compact(value) {
    if (!has(value)) return absent("Not available");
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
  function isStale(d) {
    return (Date.now() - Date.parse(d.generated_at)) / 60000 > STALE_MIN;
  }
  var LABELS = {
    ok: ["●", "OK"], warn: ["▲", "Needs attention"], fault: ["✕", "Fault"],
    closed: ["○", "Market closed"], unknown: ["○", "Unknown"]
  };
  function status(code, label) {
    var key = LABELS[code] ? code : "unknown";
    return '<span class="status status-' + key + '"><span aria-hidden="true">' + LABELS[key][0] + "</span>" + esc(label || LABELS[key][1]) + "</span>";
  }
  function byId(list, id) {
    return (list || []).filter(function (x) { return x.id === id; })[0];
  }
  function systemBadge(id) {
    var item = state.data && byId(state.data.systems, id);
    return status(item ? item.status : "unknown");
  }
  function stat(label, value, sub) {
    return '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + value + "</div>" +
      (sub ? '<div class="stat-sub">' + esc(sub) + "</div>" : "") + "</div>";
  }
  function link(label, href, primary) {
    return '<a class="btn' + (primary ? " btn-primary" : "") + '" href="' + esc(href) + '">' + esc(label) + "</a>";
  }
  function sourceLink() {
    return '<a class="btn" href="' + SOURCE_URL + '" target="_blank" rel="noopener noreferrer">Source on GitHub</a>';
  }

  /* ---------- Overview ---------- */
  function verdictFor(d) {
    var systems = d.systems || [], jobs = d.scheduler || [];
    var faults = systems.filter(function (s) { return s.status === "fault"; }).length;
    var warns = systems.filter(function (s) { return s.status === "warn" || s.status === "unknown"; }).length;
    var jobIssues = jobs.filter(function (j) { return j.status !== "ok"; }).length;
    var closed = d.market && d.market.open === false;
    if (isStale(d)) {
      return { tone: "warn", code: "warn", text: "Updates have paused", why: "This page last heard from the system " + ago(d.generated_at) + ". It shows that data and does not guess at what has happened since." };
    }
    if (faults) return { tone: "fault", code: "fault", text: faults === 1 ? "A system has a fault" : faults + " systems have faults", why: "This is the real state of the system. Problems stay visible here until they are fixed." };
    if (warns) return { tone: "warn", code: "warn", text: warns === 1 ? "A system needs attention" : warns + " systems need attention", why: "This is the real state of the system. Problems stay visible here until they are fixed." };
    if (jobIssues) return { tone: "warn", code: "warn", text: jobIssues === 1 ? "No system faults. A scheduled job needs attention" : "No system faults. " + jobIssues + " scheduled jobs need attention", why: "This is the real state of the system. Problems stay visible here until they are fixed." };
    return { tone: "ok", code: "ok", text: "All systems are running normally", why: closed ? "The market is closed, so no new candles are expected." : "The market is open." };
  }

  function renderOverview(d) {
    var systems = d.systems || [], r = d.research || {}, trials = r.trials || {}, gate = d.gate, recon = d.reconciliation, f = r.forward || {};
    var v = verdictFor(d);
    var tables = (d.data && d.data.tables) || [];

    var systemRows = systems.map(function (s) {
      var seen = ago(s.as_of);
      return '<li class="sys"><div class="sys-head"><h3>' + esc(s.name) + "</h3>" + status(s.status) + "</div>" +
        '<p class="dim">' + esc(s.detail) + (seen ? ' <span class="nowrap">Latest data ' + esc(seen) + ".</span>" : "") + "</p></li>";
    }).join("");

    var jobs = (d.scheduler || []).map(function (j) {
      var seen = ago(j.last_run);
      return '<li class="job"><span class="job-name">' + esc(j.name) + '</span><span class="job-status">' + status(j.status) +
        '</span><span class="job-time mono"><span class="sr">Last run </span>' + (seen ? esc(seen) : absent("No run time reported")) + "</span></li>";
    }).join("");

    var reconText = recon
      ? (recon.divergences === 0 ? "No mismatches between broker and system records." : "Mismatches found between broker and system records.")
      : "Reconciliation status is not available.";

    return '<section class="hero">' +
      '<div class="hero-copy">' +
      '<p class="kicker">Real system on a practice account</p>' +
      "<h1>A data platform you can watch running</h1>" +
      '<p class="lede">' + PRACTICE_NOTE + "</p>" +
      '<p class="sub-lede">The platform is modelled in PostgreSQL. Every number below comes from the running system, with no login and no mock data.</p>' +
      '<div class="actions">' + link("See the data model", "#model", true) + link("Telemetry", "#telemetry") + link("System map", "#map") + link("Research record", "#research") + sourceLink() + "</div>" +
      "</div>" +
      '<div class="panel status-panel tone-' + v.tone + '">' +
      '<div class="verdict"><span class="verdict-mark" aria-hidden="true">' + LABELS[v.code][0] + "</span><div><strong>" + esc(v.text) + '</strong><p class="dim">' + esc(v.why) + "</p></div></div>" +
      '<ul class="sys-list">' + systemRows + "</ul>" +
      "</div></section>" +

      '<section class="band" aria-label="Key figures">' +
      stat("Rows in the modelled tables", compact(d.data && d.data.total_rows), "Across " + tables.length + " documented tables") +
      stat("Registered trials", num(trials.total), "Counted whether they pass or fail") +
      stat("Trials passed", num(trials.pass), "After costs, on the fixed rules") +
      stat("Forward-tested trades", num(r.forward && r.forward.trades), "In an append-only ledger") +
      "</section>" +

      '<div class="columns">' +
      '<section class="panel"><h2>Scheduled jobs</h2><p class="panel-note">The last recorded result of each job.</p><ul class="jobs">' + jobs + "</ul></section>" +
      '<div class="stack"><section class="panel"><h2>Risk controls</h2><p class="panel-note">An independent service checks every signal before it can become an order.</p>' +
      '<div class="control"><div class="sys-head"><h3>Reconciliation</h3>' + status(recon ? (recon.divergences === 0 ? "ok" : "warn") : "unknown") + '</div><p class="dim">' + esc(reconText) + "</p></div>" +
      '<div class="pair">' +
      stat("Orders rejected", gate ? num(gate.rejected) : absent("Not available"), "By the risk gate, since it started recording") +
      stat("Orders reduced", gate ? num(gate.reduced) : absent("Not available"), "By the risk gate, since it started recording") +
      "</div></section>" +
      '<section class="panel"><h2>Forward-test ledger</h2><p class="panel-note">New trades are recorded as they happen, in a table that refuses deletes. Results are not published.</p><div class="pair">' +
      stat("Trades recorded", num(f.trades)) + stat("Strategies recording", num(f.strategies)) + "</div></section></div></div>";
  }

  /* ---------- System map ---------- */
  function node(title, role, badge, cls) {
    return '<li class="node ' + (cls || "") + '"><h3>' + esc(title) + '</h3><p class="role">' + esc(role) + "</p>" + (badge || "") + "</li>";
  }
  function lane(title, note, nodes, foot) {
    return '<section class="lane panel"><div class="lane-head"><h2>' + esc(title) + '</h2><p class="dim">' + esc(note) + "</p></div>" +
      '<ol class="flow">' + nodes.join("") + "</ol>" + (foot ? '<p class="boundary">' + esc(foot) + "</p>" : "") + "</section>";
  }
  function connector(text) {
    return '<div class="connector"><span class="connector-line" aria-hidden="true"></span><span class="connector-text">' + esc(text) + "</span></div>";
  }

  function renderMap() {
    return '<div class="page-head"><h1>System map</h1>' +
      '<p class="lede">Three independent services make up the trading path. A separate research path tests new ideas before they can reach it. Status badges are live.</p>' +
      '<div class="map-key" aria-label="Key"><span class="key-item"><span class="key-swatch key-service" aria-hidden="true"></span>Running service, with live status</span><span class="key-item"><span class="key-swatch" aria-hidden="true"></span>Data source, store or step</span></div></div>' +
      lane("Research path", "Rules are written and fixed before a test runs, and the final test window is used once.", [
        node("Free data sources", "Prices plus public economic series and event calendars."),
        node("Point-in-time store", "Records when each value became known."),
        node("Registered card", "Fixes the rules and pass and kill criteria, with a file hash."),
        node("Backtest", "Search-window test with spreads, slippage and financing."),
        node("One-shot test", "A single run on held-back data."),
        node("Forward ledger", "New trades recorded as they happen. Closed rows cannot change.")
      ]) +
      connector("New ideas reach the trading path only by way of these tests") +
      lane("Trading path", "A signal must pass an independent risk service before it can become an order.", [
        node("Market data", "Broker candles with bid and ask, on several timeframes."),
        node("Brain", "Ingests data, checks quality, labels regimes and emits scored signals.", systemBadge("s1"), "service s1"),
        node("Cloud messaging", "Google Cloud Pub/Sub carries signals. Cloud Storage holds versioned model sets."),
        node("Guardian", "Applies layered risk checks and sizes or rejects each signal.", systemBadge("s3"), "service s3"),
        node("Hand", "Places orders, tracks fills and reconciles with the broker.", systemBadge("s2"), "service s2"),
        node("Practice account", "A broker practice account. This page shows no balances or positions.")
      ]) +
      connector("Status moves one way, out to this page") +
      lane("How this page gets its data", "Data moves one way. A private job pushes a small file out, and nothing here can connect back in.", [
        node("Private systems", "Databases and telemetry, with no public access from this page."),
        node("Export job", "Runs about every 5 minutes with read-only database sessions.", systemBadge("tele"), "service"),
        node("Safety check", "Blocks unknown fields, private-looking values and strategies still under test."),
        node("GitHub", "Holds only the latest status file, on a public branch."),
        node("This page", "A static site. It has no server, login or database of its own.")
      ], "If the export stops, this page keeps its last data and shows its age. It does not guess.");
  }

  /* ---------- Data model: entity-relationship diagram ----------
     Everything drawn here comes from data.tables[].links, .pk, .columns and
     .rows. Nodes are real buttons in a CSS layout; the lines are an SVG layer
     measured from those buttons, so the same code serves every screen width. */
  var DECISIONS = [
    ["Facts and dimensions", "Prices, signals, outcomes and trades are fact tables that join to shared dimensions, so one instrument means the same thing everywhere."],
    ["Point-in-time data", "External data stores both when a value applied and when it became known, which prevents look-ahead bias in backtests."],
    ["Tamper-resistant records", "A database trigger refuses deletes from the forward ledger and freezes each trade once it closes."],
    ["Full lineage", "A result traces back through its run, code version, parameters, costs and the card registered before the test."]
  ];
  var STORE_NAMES = { market: "Market and trading", research: "Research", external: "External data" };
  var STORES = ["market", "research", "external"];

  function shortName(name) {
    return name.replace(/^(research|ext)\./, "");
  }
  function breakable(text) {
    return esc(text).replace(/_/g, "_<wbr>");
  }
  function allTables(d) {
    return (d.data && d.data.tables) || [];
  }
  function parentsOf(t) {
    return (t.links || []).filter(function (n) { return n !== t.name; });
  }

  /* Rank each table by its longest chain of references, parents on the left.
     A table referenced but not published becomes a dashed, inert placeholder. */
  function buildGraph(tables, store) {
    var names = tables.map(function (t) { return t.name; });
    var mine = tables.filter(function (t) { return t.store === store; });
    var nodes = {};
    mine.forEach(function (t) { nodes[t.name] = { name: t.name, table: t, ghost: false }; });
    mine.forEach(function (t) {
      parentsOf(t).forEach(function (p) {
        if (!nodes[p] && names.indexOf(p) === -1) nodes[p] = { name: p, table: null, ghost: true };
      });
    });

    var edges = [];
    mine.forEach(function (t) {
      (t.links || []).forEach(function (p) {
        if (nodes[p]) edges.push({ parent: p, child: t.name, self: p === t.name, oneToOne: isOneToOne(t, nodes[p].table) });
      });
    });

    function rank(name, depth) {
      if (depth > 12) return 0;
      var n = nodes[name];
      if (!n.table) return 0;
      var parents = parentsOf(n.table).filter(function (p) { return nodes[p]; });
      if (!parents.length) return 0;
      return 1 + Math.max.apply(null, parents.map(function (p) { return rank(p, depth + 1); }));
    }
    var linked = {};
    edges.forEach(function (e) { if (!e.self) { linked[e.parent] = true; linked[e.child] = true; } });
    var columns = [], loose = [];
    Object.keys(nodes).forEach(function (name) {
      if (!linked[name]) { loose.push(name); return; }
      var r = rank(name, 0);
      (columns[r] = columns[r] || []).push(name);
    });

    /* A two-level group is a star: dimensions in the middle, facts either side. */
    if (columns.length === 2) {
      var dims = columns[0];
      var left = columns[1].filter(function (n) {
        var ps = parentsOf(nodes[n].table);
        return ps.length === 1 && ps[0] === dims[0];
      });
      var right = columns[1].filter(function (n) { return left.indexOf(n) === -1; });
      columns = left.length && right.length ? [left, dims.concat(loose), right] : [dims.concat(loose), columns[1]];
      return withOrder({ nodes: nodes, edges: edges, columns: columns, hub: left.length && right.length ? 1 : 0, loose: loose });
    }
    if (loose.length) (columns[0] = columns[0] || []).push.apply(columns[0], loose);

    /* Order each column by the average position of its parents, to limit crossings. */
    for (var c = 1; c < columns.length; c++) {
      var prior = {};
      for (var k = 0; k < c; k++) (columns[k] || []).forEach(function (n, i) { prior[n] = i / Math.max(1, columns[k].length - 1); });
      var weight = function (n) {
        var ps = parentsOf(nodes[n].table).filter(function (p) { return p in prior; });
        return ps.length ? ps.reduce(function (s, p) { return s + prior[p]; }, 0) / ps.length : 0.5;
      };
      columns[c] = columns[c].slice().sort(function (a, b) { return weight(a) - weight(b); });
    }
    return withOrder({ nodes: nodes, edges: edges, columns: columns, hub: 0, loose: loose });
  }

  function withOrder(g) {
    var seq = [], i = 0;
    g.order = {};
    if (g.columns[g.hub]) seq = seq.concat(g.columns[g.hub]);
    g.columns.forEach(function (col, c) { if (c !== g.hub) seq = seq.concat(col); });
    seq.forEach(function (n) { if (g.loose.indexOf(n) === -1) g.order[n] = i++; });
    return g;
  }

  /* One-to-one when the child's whole primary key is the column it shares with
     the parent's primary key. Otherwise the reference is many-to-one. */
  function isOneToOne(child, parent) {
    if (!parent || !child.pk || !parent.pk) return false;
    return child.pk.length === parent.pk.length && child.pk.every(function (c) { return parent.pk.indexOf(c) !== -1; }) && child.name !== parent.name;
  }

  function erNode(g, name, selected) {
    var n = g.nodes[name];
    var o = ' style="--o:' + (g.order[name] === undefined ? 999 : g.order[name]) + '"';
    if (n.ghost) {
      return '<div class="er-node er-ghost"' + o + ' data-node="' + esc(name) + '"><span class="er-name mono">' + breakable(shortName(name)) + '</span><span class="er-meta">Not published</span></div>';
    }
    var t = n.table, pk = t.pk || [], shown = pk.slice(0, 3);
    var parents = parentsOf(t);
    var label = t.name + ", about " + (has(t.rows) ? Number(t.rows).toLocaleString("en-US") : "unknown") + " rows, primary key " + pk.join(", ") +
      (parents.length ? ", references " + parents.join(" and ") : ", references no other table");
    var kind = /^dim_/.test(t.name) ? " er-dim" : "";
    var keys = shown.map(function (c) { return '<span class="er-key"><i>PK</i>' + esc(c) + "</span>"; }).join("") +
      (pk.length > shown.length ? '<span class="er-key er-more">and ' + (pk.length - shown.length) + " more</span>" : "");
    return '<button type="button" class="er-node' + kind + '"' + o + ' data-table="' + esc(t.name) + '" data-node="' + esc(t.name) + '" aria-pressed="' + (t.name === selected) + '" aria-label="' + esc(label) + '">' +
      '<span class="er-head"><span class="er-name mono">' + breakable(shortName(t.name)) + '</span><span class="er-rows mono">' + compact(t.rows) + "</span></span>" +
      '<span class="er-keys">' + keys + "</span></button>";
  }

  function modelBody(d) {
    var tables = allTables(d);
    if (!tables.length) return '<div class="panel empty"><p class="dim">No tables were received in the status file.</p></div>';
    var selected = tables.filter(function (t) { return t.name === state.table; })[0] || tables[0];
    if (selected.store !== state.area) state.area = selected.store;
    var g = buildGraph(tables, state.area);

    var tabs = STORES.filter(function (s) { return tables.some(function (t) { return t.store === s; }); }).map(function (s) {
      var count = tables.filter(function (t) { return t.store === s; }).length;
      return '<button type="button" class="tab" data-area="' + s + '" aria-pressed="' + (s === state.area) + '">' + esc(STORE_NAMES[s]) + ' <span class="tab-count mono">' + count + "</span></button>";
    }).join("");

    var columns = g.columns.map(function (col, i) {
      return '<div class="er-col' + (i === g.hub ? " er-hub" : "") + '">' + col.map(function (n) { return erNode(g, n, selected.name); }).join("") + "</div>";
    }).join("");

    var inArea = tables.filter(function (t) { return t.store === state.area; });
    var relCount = g.edges.length;
    var alt = STORE_NAMES[state.area] + ": " + inArea.length + " tables and " + relCount + " references. The list under the diagram gives the same tables as text.";

    return '<div class="model"><div class="model-main">' +
      '<div class="er-panel panel">' +
      '<div class="er-toolbar"><div class="tabs" role="group" aria-label="Choose a group of tables">' + tabs + "</div>" +
      '<ul class="er-legend" aria-label="Key">' +
      '<li><svg width="26" height="12" aria-hidden="true"><path d="M1 6H25M5 1V11"/></svg>One</li>' +
      '<li><svg width="26" height="12" aria-hidden="true"><path d="M1 6H25M16 6L25 1M16 6L25 11"/></svg>Many</li>' +
      "<li><span class=\"er-pk\">PK</span>Primary key</li></ul></div>" +
      '<div class="er-canvas" id="er-canvas" data-cols="' + g.columns.length + '" role="group" aria-label="' + esc(alt) + '">' +
      '<svg class="er-lines" id="er-lines" aria-hidden="true"></svg>' + columns + "</div>" +
      '<p class="er-hint">Select a table to see its grain, columns and relationships. The number on each table is its estimated row count.</p>' +
      "</div>" +
      '<section class="decisions"><h2>Why it is built this way</h2><div class="decision-grid">' + DECISIONS.map(function (x) {
        return '<div class="decision"><h3>' + esc(x[0]) + '</h3><p class="dim">' + esc(x[1]) + "</p></div>";
      }).join("") + "</div></section>" +
      "</div>" +
      '<div id="er-detail" class="er-detail">' + tableDetail(tables, selected) + "</div>" +
      "</div>";
  }

  function tableDetail(tables, selected) {
    var names = tables.map(function (t) { return t.name; });
    var linkOut = parentsOf(selected);
    var linkIn = tables.filter(function (t) { return t.name !== selected.name && (t.links || []).indexOf(selected.name) !== -1; }).map(function (t) { return t.name; });
    var chip = function (name) {
      return names.indexOf(name) !== -1
        ? '<button type="button" class="chip" data-table="' + esc(name) + '">' + esc(name) + "</button>"
        : '<span class="chip chip-static" title="This table is not published">' + esc(name) + "</span>";
    };
    var pk = selected.pk || [];
    var parentKeys = {};
    linkOut.forEach(function (p) {
      var t = tables.filter(function (x) { return x.name === p; })[0];
      ((t && t.pk) || []).forEach(function (c) { parentKeys[c] = true; });
    });
    var cols = (selected.columns || []).map(function (c) {
      var tags = (pk.indexOf(c.name) !== -1 ? '<span class="key">PK</span>' : "") + (parentKeys[c.name] ? '<span class="key key-fk">FK</span>' : "");
      return '<tr><td class="col-name">' + breakable(c.name) + tags + '</td><td class="col-type">' + esc(c.type) + "</td></tr>";
    }).join("");
    return '<article class="panel table-card">' +
      '<h2 class="mono table-title">' + esc(selected.name) + "</h2>" +
      "<p>" + esc(selected.note) + "</p>" +
      '<dl class="facts">' +
      '<div class="fact-wide"><dt>Grain</dt><dd>' + esc(selected.grain) + "</dd></div>" +
      '<div><dt>Rows (estimate)</dt><dd class="mono">' + num(selected.rows, "Count not available") + "</dd></div>" +
      '<div><dt>Size</dt><dd class="mono nowrap">' + (selected.mb < 1 ? "Under 1 MB" : num(selected.mb) + " MB") + "</dd></div>" +
      "</dl>" +
      (linkOut.length ? '<h3>References</h3><div class="chips">' + linkOut.map(chip).join("") + "</div>" : "") +
      (linkIn.length ? '<h3>Referenced by</h3><div class="chips">' + linkIn.map(chip).join("") + "</div>" : "") +
      "<h3>Columns (" + (selected.columns || []).length + ')</h3><div class="cols-wrap"><table class="cols"><thead><tr><th scope="col">Name</th><th scope="col">Type</th></tr></thead><tbody>' + cols + "</tbody></table></div>" +
      "</article>";
  }

  function tableIndex(tables) {
    var rows = STORES.map(function (store) {
      return tables.filter(function (t) { return t.store === store; }).map(function (t) {
        return '<tr><td><button type="button" class="link-btn mono" data-table="' + esc(t.name) + '">' + esc(t.name) + '</button><div class="index-grain dim">' + esc(t.grain) + '</div></td><td class="index-store dim">' + esc(STORE_NAMES[store]) + '</td><td class="num mono">' + compact(t.rows) + "</td></tr>";
      }).join("");
    }).join("");
    return '<details class="panel index"><summary>All ' + tables.length + ' tables as a list</summary><table class="index-table"><thead><tr><th scope="col">Table and grain</th><th scope="col" class="index-store">Group</th><th scope="col" class="num">Rows</th></tr></thead><tbody>' + rows + "</tbody></table></details>";
  }

  function renderModel(d) {
    var dd = d.data || {};
    return '<div class="page-head"><h1>Data model</h1>' +
      '<p class="lede">Columns, keys, links and row counts are read from the live database catalog. Grain and design notes are written by hand. No row-level data is published.</p></div>' +
      '<section class="band band-tight" aria-label="Model size">' +
      stat("Modelled rows", compact(dd.total_rows), "Estimated from the catalog") +
      stat("Storage", has(dd.total_gb) ? esc(dd.total_gb) + " GB" : absent(), "Including indexes") +
      stat("Price history from", dd.history_from ? esc(dd.history_from.slice(0, 4)) : absent(), "Longest timeframe") +
      stat("Timeframes", esc((dd.timeframes || []).length), (dd.timeframes || []).join(", ")) +
      "</section>" +
      '<div id="model-body">' + modelBody(d) + "</div>" +
      tableIndex(allTables(d));
  }

  function drawLines() {
    var canvas = document.getElementById("er-canvas");
    var svg = document.getElementById("er-lines");
    if (!canvas || !svg || !state.data) return;
    var g = buildGraph(allTables(state.data), state.area);
    var box;
    var stacked = getComputedStyle(canvas).display !== "grid";
    var railParents = [];
    if (stacked) {
      g.edges.forEach(function (e) { if (!e.self && railParents.indexOf(e.parent) === -1) railParents.push(e.parent); });
      railParents.sort(function (a, b) { return g.order[a] - g.order[b]; });
      canvas.style.paddingLeft = (railParents.length * 12 + 18) + "px";
    } else {
      canvas.style.paddingLeft = "";
    }
    box = canvas.getBoundingClientRect();
    var rects = {};
    canvas.querySelectorAll("[data-node]").forEach(function (el) {
      var r = el.getBoundingClientRect();
      rects[el.getAttribute("data-node")] = { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top };
    });
    svg.setAttribute("width", box.width);
    svg.setAttribute("height", box.height);
    svg.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);

    /* Work out which side of each node every line uses, then spread the lines
       along that side so they do not all meet at one point. */
    if (stacked) { svg.innerHTML = railPaths(g, rects, railParents); return; }
    var lines = [], sides = {};
    function claim(name, side, line, end) {
      var key = name + "|" + side;
      (sides[key] = sides[key] || []).push({ line: line, end: end });
    }
    g.edges.forEach(function (e) {
      if (e.self) return;
      var p = rects[e.parent], c = rects[e.child];
      if (!p || !c) return;
      var line = { e: e };
      if (c.l >= p.r) { line.dir = "h"; claim(e.parent, "r", line, "from"); claim(e.child, "l", line, "to"); }
      else { line.dir = "h"; claim(e.parent, "l", line, "from"); claim(e.child, "r", line, "to"); }
      lines.push(line);
    });
    function centre(name, axis) {
      var r = rects[axis === "x" ? name : name];
      return axis === "x" ? (r.l + r.r) / 2 : (r.t + r.b) / 2;
    }
    Object.keys(sides).forEach(function (key) {
      var parts = key.split("|"), name = parts[0], side = parts[1], list = sides[key], r = rects[name];
      var vertical = side === "t" || side === "b";
      list.sort(function (a, b) {
        var oa = a.end === "from" ? a.line.e.child : a.line.e.parent;
        var ob = b.end === "from" ? b.line.e.child : b.line.e.parent;
        return vertical ? centre(oa, "x") - centre(ob, "x") : centre(oa, "y") - centre(ob, "y");
      });
      list.forEach(function (item, i) {
        var f = (i + 1) / (list.length + 1), pt;
        if (vertical) pt = { x: r.l + (r.r - r.l) * f, y: side === "t" ? r.t : r.b };
        else pt = { x: side === "l" ? r.l : r.r, y: r.t + (r.b - r.t) * f };
        item.line[item.end] = pt;
      });
    });

    var sel = state.table;
    var paths = lines.map(function (l) {
      var a = l.from, b = l.to, d, ends;
      var on = l.e.child === sel || l.e.parent === sel ? " on" : "";
      {
        var s = b.x >= a.x ? 1 : -1, dx = Math.max(24, Math.abs(b.x - a.x) * 0.45);
        d = "M" + a.x + " " + a.y + "C" + (a.x + s * dx) + " " + a.y + "," + (b.x - s * dx) + " " + b.y + "," + b.x + " " + b.y;
        ends = "M" + (a.x + s * 6) + " " + (a.y - 5) + "V" + (a.y + 5);
        ends += l.e.oneToOne
          ? "M" + (b.x - s * 6) + " " + (b.y - 5) + "V" + (b.y + 5)
          : "M" + (b.x - s * 10) + " " + b.y + "L" + b.x + " " + (b.y - 6) + "M" + (b.x - s * 10) + " " + b.y + "L" + b.x + " " + (b.y + 6);
      }
      return '<path class="er-line' + on + (l.e.ghost ? " ghost" : "") + '" d="' + d + ends + '"/>';
    });
    g.edges.filter(function (e) { return e.self; }).forEach(function (e) {
      var r = rects[e.child];
      if (!r) return;
      var on = e.child === sel ? " on" : "";
      paths.push('<path class="er-line' + on + '" d="M' + (r.r - 34) + " " + r.t + "C" + (r.r - 34) + " " + (r.t - 20) + "," + (r.r - 8) + " " + (r.t - 20) + "," + (r.r - 8) + " " + r.t + '"/>');
    });
    /* Lines touching the selected table draw last, so they sit on top. */
    paths.sort(function (a, b) { return (a.indexOf(" on") !== -1) - (b.indexOf(" on") !== -1); });
    svg.innerHTML = paths.join("");
  }

  /* Phone layout: tables in one column, each parent with its own vertical rail,
     and a branch into each child ending in the same one or many mark. */
  function railPaths(g, rects, parents) {
    var incoming = {};
    g.edges.forEach(function (e) { if (!e.self) (incoming[e.child] = incoming[e.child] || []).push(e); });
    var sel = state.table, paths = [];
    Object.keys(incoming).forEach(function (child) {
      var c = rects[child];
      if (!c) return;
      var list = incoming[child].slice().sort(function (a, b) { return parents.indexOf(a.parent) - parents.indexOf(b.parent); });
      list.forEach(function (e, i) {
        var p = rects[e.parent];
        if (!p) return;
        var rail = 8 + parents.indexOf(e.parent) * 12;
        var py = Math.min(p.t + 16, p.b - 6);
        var cy = c.t + Math.min(16 + i * 14, c.b - c.t - 8);
        var on = e.child === sel || e.parent === sel ? " on" : "";
        var d = "M" + p.l + " " + py + "H" + rail + "V" + cy + "H" + c.l;
        d += "M" + (p.l - 6) + " " + (py - 5) + "V" + (py + 5);
        d += e.oneToOne
          ? "M" + (c.l - 6) + " " + (cy - 5) + "V" + (cy + 5)
          : "M" + (c.l - 10) + " " + cy + "L" + c.l + " " + (cy - 5) + "M" + (c.l - 10) + " " + cy + "L" + c.l + " " + (cy + 5);
        paths.push('<path class="er-line' + on + '" d="' + d + '"/>');
      });
    });
    g.edges.filter(function (e) { return e.self; }).forEach(function (e) {
      var r = rects[e.child];
      if (!r) return;
      paths.push('<path class="er-line' + (e.child === sel ? " on" : "") + '" d="M' + r.r + " " + (r.t + 10) + "c10 0 10 18 0 18M" + r.r + " " + (r.t + 28) + "l6 -5M" + r.r + " " + (r.t + 28) + 'l6 5"/>');
    });
    paths.sort(function (a, b) { return (a.indexOf(" on") !== -1) - (b.indexOf(" on") !== -1); });
    return paths.join("");
  }

  var observer = window.ResizeObserver ? new ResizeObserver(function () { window.requestAnimationFrame(drawLines); }) : null;
  function afterModelRender() {
    var canvas = document.getElementById("er-canvas");
    if (observer) { observer.disconnect(); if (canvas) observer.observe(canvas); }
    drawLines();
  }
  window.addEventListener("resize", function () { drawLines(); drawTimeline(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawLines);

  function refreshModelBody(focusSelector) {
    var host = document.getElementById("model-body");
    if (!host || !state.data) return;
    host.innerHTML = modelBody(state.data);
    afterModelRender();
    if (focusSelector) {
      var again = host.querySelector(focusSelector);
      if (again) again.focus({ preventScroll: true });
    }
  }

  /* ---------- Research record ---------- */
  var STAGES = [["idea", "Idea"], ["registered", "Registered"], ["backtest", "Backtest"], ["one_shot", "One-shot"], ["shadow", "Forward test"], ["killed", "Killed"]];

  function bars(rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r[1] || 0; }).concat([1]));
    return '<ul class="bars">' + rows.map(function (r) {
      var n = r[1] === undefined ? 0 : r[1];
      return '<li class="bar-row" title="' + esc(r[0]) + ": " + esc(n) + '"><span class="bar-label">' + esc(r[0]) + '</span><span class="bar-track" aria-hidden="true"><span class="bar" style="width:' + (n / max * 100) + '%"></span></span><span class="bar-n mono">' + num(n) + "</span></li>";
    }).join("") + "</ul>";
  }

  function renderResearch(d) {
    var r = d.research || {}, trials = r.trials || {}, stages = r.stages || {}, f = r.forward || {};
    var seen = ago(f.last_recorded);
    var rows = (r.killed_recent || []).map(function (k) {
      return '<li class="killed"><span class="killed-title">' + esc(k.title) + '</span><span class="killed-family dim">' + esc((k.family || "").replace(/_/g, " ")) + '</span><span class="killed-date mono">' + esc(k.date) + "</span></li>";
    }).join("");

    return '<div class="page-head"><h1>Research record</h1>' +
      '<p class="lede">Most trading ideas fail once real costs and repeated testing are counted. Every test is registered first and stays in the count, including the failures. Rules for ideas still under test stay private.</p></div>' +
      '<section class="headline panel">' +
      '<p class="headline-figure mono">' + num(trials.pass) + '<span class="headline-of"> of ' + num(trials.total) + "</span></p>" +
      '<div class="headline-copy"><strong>Registered trials that have passed</strong><p class="dim">None has met every rule so far. This count is the point of the record: it stays visible, and failed trials stay in it.</p></div>' +
      "</section>" +
      '<section class="band" aria-label="Research effort">' +
      stat("Killed by their own rules", num(trials.killed)) +
      stat("Backtest runs completed", num(r.runs_completed)) +
      stat("Trades simulated", num(r.trades_simulated)) +
      stat("Parameter points searched", num(r.search_points)) +
      "</section>" +
      '<div class="columns">' +
      '<section class="panel"><h2>Trial verdicts</h2><p class="panel-note">The recorded result of each registered trial.</p>' +
      bars([["Passed", trials.pass], ["Promising, not a pass", trials.promising], ["Inconclusive", trials.inconclusive], ["Killed", trials.killed], ["No verdict recorded", trials.pending]]) + "</section>" +
      '<section class="panel"><h2>Where ideas are now</h2><p class="panel-note">The current stage of each strategy idea.</p>' +
      bars(STAGES.map(function (s) { return [s[1], stages[s[0]]]; })) + "</section>" +
      "</div>" +
      '<section class="section"><h2>Forward-test ledger</h2><p class="section-note">New trades are recorded as they happen. Results are not published.</p>' +
      '<div class="band band-flush" aria-label="Forward-test ledger">' +
      stat("Trades recorded", num(f.trades)) +
      stat("Trades closed", num(f.closed)) +
      stat("Strategies recording", num(f.strategies)) +
      stat("Last new trade", seen ? esc(seen) : absent("No trades recorded")) +
      "</div></section>" +
      '<section class="section"><h2>Recently killed</h2><div class="panel panel-flush"><ul class="killed-list">' + rows + "</ul></div></section>";
  }

  /* ---------- Telemetry ----------
     A monitoring view of the current status file. Every mark is a value from
     that file: no history is stored or implied, so nothing here is a trend. */
  function tileFor(s) {
    var seen = ago(s.as_of);
    return '<li class="tile tile-' + esc(LABELS[s.status] ? s.status : "unknown") + '"><div class="tile-head"><h3>' + esc(s.name) + "</h3>" + status(s.status) + "</div>" +
      '<p class="dim">' + esc(s.detail) + "</p>" +
      '<p class="tile-age mono">' + (seen ? "Latest data " + esc(seen) : "No time reported") + "</p></li>";
  }

  function timelineRows(d) {
    var rows = [{ head: "Status file" }, { name: "This export", status: isStale(d) ? "warn" : "ok", at: d.generated_at }];
    rows.push({ head: "Services" });
    (d.systems || []).forEach(function (s) { rows.push({ name: s.name, status: s.status, at: s.as_of }); });
    rows.push({ head: "Scheduled jobs" });
    (d.scheduler || []).forEach(function (j) { rows.push({ name: j.name, status: j.status, at: j.last_run }); });
    return rows;
  }

  function mark(code, x, y) {
    if (code === "ok") return '<circle class="tl-ok" cx="' + x + '" cy="' + y + '" r="5"/>';
    if (code === "warn") return '<path class="tl-warn" d="M' + x + " " + (y - 6) + "L" + (x + 6) + " " + (y + 5) + "H" + (x - 6) + 'Z"/>';
    if (code === "fault") return '<path class="tl-cross" d="M' + (x - 5) + " " + (y - 5) + "L" + (x + 5) + " " + (y + 5) + "M" + (x + 5) + " " + (y - 5) + "L" + (x - 5) + " " + (y + 5) + '"/>';
    return '<circle class="tl-hollow" cx="' + x + '" cy="' + y + '" r="4.5"/>';
  }

  function drawTimeline() {
    var host = document.getElementById("tl-host");
    if (!host || !state.data) return;
    var rows = timelineRows(state.data);
    var width = Math.max(260, Math.floor(host.clientWidth));
    var narrow = width < 520;
    var labelW = narrow ? 118 : 172, ageW = narrow ? 66 : 92, rowH = 26, headH = 28, axisH = 34;
    var plotR = width - ageW - 10, plotW = plotR - labelW;
    var ages = rows.filter(function (r) { return r.at; }).map(function (r) { return (Date.now() - Date.parse(r.at)) / 1000; });
    var maxAge = Math.max(3 * 86400, Math.max.apply(null, ages.concat([60])) * 1.15);
    function xOf(sec) {
      return Math.round(plotR - (Math.log(Math.max(60, sec) / 60) / Math.log(maxAge / 60)) * plotW);
    }
    var ticks = [[60, "1 min"], [3600, "1 h"], [86400, "1 day"]];
    if (maxAge >= 7 * 86400 && !narrow) ticks.push([7 * 86400, "7 days"]);
    var y = 0, body = "";
    rows.forEach(function (r) {
      if (r.head) {
        body += '<text class="tl-group" x="0" y="' + (y + 18) + '">' + esc(r.head) + "</text>";
        y += headH;
        return;
      }
      var cy = y + rowH / 2;
      body += '<line class="tl-row" x1="0" x2="' + width + '" y1="' + (y + rowH) + '" y2="' + (y + rowH) + '"/>';
      body += '<text class="tl-name" x="0" y="' + (cy + 4) + '">' + esc(r.name) + "</text>";
      if (r.at) {
        var sec = (Date.now() - Date.parse(r.at)) / 1000, x = xOf(sec), code = LABELS[r.status] ? r.status : "unknown";
        body += '<line class="tl-stem" x1="' + x + '" x2="' + plotR + '" y1="' + cy + '" y2="' + cy + '"/>';
        body += "<g><title>" + esc(r.name) + ": " + esc(LABELS[code][1]) + ", " + esc(ago(r.at)) + "</title>" +
          '<rect x="' + (x - 10) + '" y="' + y + '" width="20" height="' + rowH + '" fill="transparent"/>' + mark(code, x, cy) + "</g>";
        body += '<text class="tl-age" x="' + width + '" y="' + (cy + 4) + '" text-anchor="end">' + esc(ago(r.at)) + "</text>";
      } else {
        body += '<text class="tl-age" x="' + width + '" y="' + (cy + 4) + '" text-anchor="end">No time</text>';
      }
      y += rowH;
    });
    var grid = ticks.map(function (t) {
      var x = xOf(t[0]);
      return '<line class="tl-grid" x1="' + x + '" x2="' + x + '" y1="0" y2="' + (y + 4) + '"/>' +
        '<text class="tl-tick" x="' + x + '" y="' + (y + 20) + '" text-anchor="middle">' + esc(t[1]) + "</text>";
    }).join("");
    var total = y + axisH;
    host.innerHTML = '<svg class="timeline" width="' + width + '" height="' + total + '" viewBox="0 0 ' + width + " " + total + '" role="img" aria-label="Time since each service and job last reported. The job list on this page gives the same ages as text.">' + grid + body + "</svg>";
  }

  function tableBars(items, widthOf, valueOf) {
    return '<ul class="bars bars-tables">' + items.map(function (t) {
      return '<li class="bar-row" title="' + esc(t.name) + ": " + esc(valueOf(t)) + '"><span class="bar-label mono">' + esc(t.name) + '</span><span class="bar-track" aria-hidden="true"><span class="bar bar-accent" style="width:' + widthOf(t) + '%"></span></span><span class="bar-n mono">' + esc(valueOf(t)) + "</span></li>";
    }).join("") + "</ul>";
  }

  function renderTelemetry(d) {
    var systems = d.systems || [], jobs = d.scheduler || [], gate = d.gate, recon = d.reconciliation;
    var r = d.research || {}, f = r.forward || {}, dd = d.data || {}, tables = allTables(d);
    var v = verdictFor(d);
    var jobsOk = jobs.filter(function (j) { return j.status === "ok"; }).length;
    var jobList = jobs.map(function (j) {
      var seen = ago(j.last_run);
      return '<li class="job"><span class="job-name">' + esc(j.name) + '</span><span class="job-status">' + status(j.status) +
        '</span><span class="job-time mono"><span class="sr">Last run </span>' + (seen ? esc(seen) : absent("No run time reported")) + "</span></li>";
    }).join("");

    var byRows = tables.filter(function (t) { return has(t.rows); }).slice().sort(function (a, b) { return b.rows - a.rows; });
    var maxRows = byRows.length ? byRows[0].rows : 1, minRows = byRows.length ? byRows[byRows.length - 1].rows : 1;
    var rowBars = tableBars(byRows, function (t) {
      return Math.max(1, Math.log10(t.rows + 1) / Math.log10(maxRows + 1) * 100);
    }, function (t) { return Number(t.rows).toLocaleString("en-US"); });

    var big = tables.filter(function (t) { return t.mb >= 1; }).slice().sort(function (a, b) { return b.mb - a.mb; });
    var smallCount = tables.filter(function (t) { return !(t.mb >= 1); }).length;
    var maxMb = big.length ? big[0].mb : 1;
    var sizeBars = tableBars(big, function (t) { return Math.max(1, t.mb / maxMb * 100); }, function (t) { return Number(t.mb).toLocaleString("en-US") + " MB"; });

    var closedPct = f.trades ? f.closed / f.trades * 100 : 0;
    var reconLabel = recon && recon.state ? recon.state.charAt(0).toUpperCase() + recon.state.slice(1) : "Unknown";

    return '<div class="page-head"><h1>Telemetry</h1>' +
      '<p class="lede">A monitoring view of the running system. Every mark is drawn from the current status file, so this shows the latest state and no history or trend.</p></div>' +

      '<div class="verdict-strip panel tone-' + v.tone + '"><div class="verdict"><span class="verdict-mark" aria-hidden="true">' + LABELS[v.code][0] + "</span><div><strong>" + esc(v.text) + '</strong><p class="dim">' + esc(v.why) + "</p></div></div></div>" +

      '<ul class="tiles">' + systems.map(tileFor).join("") + "</ul>" +

      '<div class="columns columns-wide">' +
      '<section class="panel"><h2>Freshness</h2><p class="panel-note">Time since each part of the system last reported. Further left is older. The scale is logarithmic so minutes and days fit together.</p>' +
      '<div id="tl-host" class="tl-host"></div>' +
      '<ul class="tl-key" aria-label="Key"><li><svg width="12" height="12" aria-hidden="true"><circle class="tl-ok" cx="6" cy="6" r="5"/></svg>OK</li><li><svg width="14" height="12" aria-hidden="true"><path class="tl-warn" d="M7 0L13 11H1Z"/></svg>Needs attention</li><li><svg width="12" height="12" aria-hidden="true"><path class="tl-cross" d="M1 1L11 11M11 1L1 11"/></svg>Fault</li><li><svg width="12" height="12" aria-hidden="true"><circle class="tl-hollow" cx="6" cy="6" r="4.5"/></svg>Market closed or unknown</li></ul></section>' +
      '<div class="stack">' +
      '<section class="panel"><h2>Job health</h2><p class="panel-note">' + jobsOk + " of " + jobs.length + ' jobs reported OK on their last run.</p><ul class="jobs">' + jobList + "</ul></section>" +
      '<div class="split">' +
      '<section class="panel"><h2>Risk gate</h2><p class="panel-note">Counters since the gate started recording.</p><div class="pair">' +
      stat("Rejected", gate ? num(gate.rejected) : absent("Not available")) +
      stat("Reduced", gate ? num(gate.reduced) : absent("Not available")) + "</div></section>" +
      '<section class="panel"><h2>Reconciliation</h2><p class="panel-note">Broker records compared with system records.</p><div class="pair">' +
      '<div class="stat"><div class="stat-label">State</div><div class="stat-text">' + status(recon ? (recon.divergences === 0 ? "ok" : "warn") : "unknown", reconLabel) + "</div></div>" +
      stat("Mismatches", recon ? num(recon.divergences) : absent("Not available")) + "</div></section>" +
      "</div></div></div>" +

      '<div class="columns section">' +
      '<section class="panel"><h2>Rows by table</h2><p class="panel-note">Estimates from the database catalog, ' + compact(dd.total_rows) + " in total. Bar length is logarithmic, because tables range from " + num(minRows) + " rows to " + num(maxRows) + ".</p>" + rowBars + "</section>" +
      '<div class="stack">' +
      '<section class="panel"><h2>Storage by table</h2><p class="panel-note">' + (has(dd.total_gb) ? esc(dd.total_gb) + " GB in total, including indexes. " : "") + "Bar length is proportional to size." + (smallCount ? " " + smallCount + " smaller tables each use under 1 MB and are not drawn." : "") + "</p>" + sizeBars + "</section>" +
      '<section class="panel"><h2>Forward ledger</h2><p class="panel-note">Forward-tested trades, recorded as they happen. Results are not published.</p><div class="pair">' +
      stat("Trades recorded", num(f.trades)) +
      stat("Trades closed", num(f.closed)) + "</div>" +
      '<div class="meter" role="img" aria-label="' + num(f.closed) + " of " + num(f.trades) + ' recorded trades have closed"><span class="meter-fill" style="width:' + closedPct + '%"></span></div>' +
      '<p class="meter-note dim">' + num(f.strategies) + " strategies recording. Last new trade " + (ago(f.last_recorded) ? esc(ago(f.last_recorded)) : "not recorded") + ".</p></section>" +
      "</div></div>";
  }

  /* ---------- About ---------- */
  function renderAbout() {
    return '<div class="page-head"><h1>About Scalable Brain</h1>' +
      '<p class="lede">' + PRACTICE_NOTE + "</p>" +
      '<div class="actions"><a class="btn" href="' + PORTFOLIO_URL + '" target="_top">Emmanuel Mbachu\'s portfolio</a>' + sourceLink() + "</div></div>" +
      '<section class="section-first"><h2>What the practice does</h2><p class="section-note">Each line links to work you can inspect.</p><ul class="offers">' +
      OFFERINGS.map(function (o) {
        var external = o[2].charAt(0) !== "#";
        return '<li class="offer"><h3>' + esc(o[0]) + '</h3><p class="dim">' + esc(o[1]) + '</p><a href="' + esc(o[2]) + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" + esc(o[3]) + "</a></li>";
      }).join("") + "</ul></section>" +
      '<section class="section"><h2>About this page</h2><p class="section-note">It lets anyone see the real system working, without access to the system itself.</p>' +
      '<div class="columns">' +
      '<section class="panel"><h3>What is shown</h3><ul class="plain">' +
      "<li>Service health and job results</li><li>The data model, with live row counts</li><li>Research counts and verdicts</li><li>Titles of hypotheses that have been killed</li></ul></section>" +
      '<section class="panel"><h3>What stays private</h3><ul class="plain">' +
      "<li>Balances, account details and profit or loss</li><li>Open positions and live signals</li><li>Rules and results of strategies still under test</li><li>Credentials, hostnames and network addresses</li></ul></section>" +
      '<section class="panel"><h3>Built with</h3><ul class="plain">' +
      "<li>PostgreSQL 16 and Python</li><li>Google Cloud Storage and Pub/Sub</li><li>A static front end on GitHub Pages</li></ul></section>" +
      '<section class="panel"><h3>How fresh is it?</h3><p class="dim">The export runs about every 5 minutes and files may be cached for a few more. The bar at the top always shows the age of the data.</p></section>' +
      "</div></section>" +
      '<p class="meta">For information only. This is not financial advice, trading advice or an offer of signals. Nothing here is a claim of trading returns.</p>';
  }

  /* ---------- Freshness bar ---------- */
  function updateFreshness() {
    var el = document.getElementById("freshness");
    var d = state.data;
    if (!d) {
      el.innerHTML = state.error ? status("warn", "Could not load live data") : '<span class="dim">Loading live data</span>';
      return;
    }
    var env = d.environment === "practice" ? "Practice account" : "Account type unknown";
    var market = d.market && d.market.label ? d.market.label : "";
    var bits = [env];
    if (isStale(d)) {
      el.innerHTML = status("warn", "Updates paused") + '<span class="fresh-bits">Showing data from ' + esc(ago(d.generated_at)) + "</span>" + bits.map(freshBit).join("");
      return;
    }
    if (market) bits.push(market);
    el.innerHTML = (state.error ? status("warn", "Could not refresh") : status("ok", "Live")) + '<span class="fresh-bits">Updated ' + esc(ago(d.generated_at)) + "</span>" + bits.map(freshBit).join("");
  }
  function freshBit(text) {
    return '<span class="fresh-bits">' + esc(text) + "</span>";
  }

  /* ---------- Routing ---------- */
  var VIEWS = { overview: renderOverview, telemetry: renderTelemetry, map: renderMap, model: renderModel, research: renderResearch, about: renderAbout };
  var TITLES = { overview: "Overview", telemetry: "Telemetry", map: "System map", model: "Data model", research: "Research record", about: "About" };

  function currentView() {
    var name = location.hash.replace("#", "");
    return VIEWS[name] ? name : "overview";
  }

  function errorBox() {
    return '<div class="page-head"><h1>' + esc(TITLES[currentView()]) + "</h1></div>" +
      '<div class="panel error-box tone-warn"><div class="verdict"><span class="verdict-mark" aria-hidden="true">▲</span><div><strong>Live data could not be loaded</strong>' +
      '<p class="dim">The connection to the status file failed, so no numbers are shown rather than guessed ones. The system map and the about page do not need live data.</p>' +
      '<div class="actions"><button id="retry" class="btn btn-primary" type="button">Try again</button>' + link("System map", "#map") + link("About", "#about") + "</div></div></div></div>";
  }

  function render() {
    var name = currentView();
    document.querySelectorAll(".nav a").forEach(function (a) {
      if (a.dataset.view === name) {
        a.setAttribute("aria-current", "page");
        if (a.scrollIntoView && a.parentElement.scrollWidth > a.parentElement.clientWidth) a.scrollIntoView({ block: "nearest", inline: "center" });
      } else a.removeAttribute("aria-current");
    });
    document.title = (name === "overview" ? "" : TITLES[name] + " | ") + "Scalable Brain live";
    updateFreshness();
    if (name === "about" || name === "map") {
      view.innerHTML = VIEWS[name]();
      return;
    }
    if (state.data) {
      var open = view.querySelector("details.index");
      var wasOpen = open && open.open;
      view.innerHTML = VIEWS[name](state.data);
      if (name === "model") {
        afterModelRender();
        if (wasOpen) view.querySelector("details.index").open = true;
      }
      if (name === "telemetry") drawTimeline();
    } else if (state.error) {
      view.innerHTML = errorBox();
    } else {
      view.innerHTML = '<div class="page-head"><h1>' + esc(TITLES[name]) + '</h1><p class="dim">Loading live data.</p></div>';
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
    var area = event.target.closest("[data-area]");
    if (area) {
      state.area = area.getAttribute("data-area");
      var first = allTables(state.data).filter(function (t) { return t.store === state.area; })[0];
      if (first) state.table = first.name;
      refreshModelBody('[data-area="' + state.area + '"]');
      return;
    }
    var button = event.target.closest("[data-table]");
    if (button) {
      var name = button.getAttribute("data-table");
      var fromIndex = button.classList.contains("link-btn");
      var fromDiagram = button.classList.contains("er-node");
      state.table = name;
      refreshModelBody('[data-node="' + name.replace(/"/g, "") + '"]');
      /* The detail sits under the diagram on smaller screens, so bring it into view. */
      var detail = document.getElementById("er-detail");
      var canvas = document.getElementById("er-canvas");
      var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (fromIndex && canvas) canvas.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      else if (detail && !fromDiagram) detail.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
      return;
    }
    if (event.target.id === "retry") {
      view.querySelector(".error-box strong").textContent = "Trying again";
      load();
    }
  });

  var themeButton = document.getElementById("theme");
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeButton.textContent = theme === "light" ? "Dark theme" : "Light theme";
    try { localStorage.setItem("sb-live-theme", theme); } catch (e) { /* storage may be blocked in an embed */ }
  }
  var saved = null;
  try { saved = localStorage.getItem("sb-live-theme"); } catch (e) { /* storage may be blocked in an embed */ }
  var wanted = params.get("theme");
  setTheme(wanted === "light" || wanted === "dark" ? wanted : saved || "dark");
  themeButton.addEventListener("click", function () {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
  });

  window.addEventListener("hashchange", function () {
    render();
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  });
  render();
  load();
  setInterval(load, POLL_MS);
  setInterval(updateFreshness, 30000);
})();
