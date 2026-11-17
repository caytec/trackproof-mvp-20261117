(function () {
  "use strict";

  var API_URL = window.API_URL || new URL("api/generate", document.baseURI).toString();
  var IS_GITHUB_PAGES = /\.github\.io$/i.test(window.location.hostname);
  var MAX_FIELD_LENGTH = 120;
  var MAX_FINAL_URL_LENGTH = 4000;
  var busy = false;
  var latestReport = null;
  var form = document.getElementById("campaign-form");
  var submitButton = document.getElementById("submit-button");
  var status = document.getElementById("status");
  var results = document.getElementById("results");

  function $(id) {
    return document.getElementById(id);
  }

  function hasControlCharacters(value) {
    return /[\u0000-\u001F\u007F\u2028\u2029]/.test(value);
  }

  function addIssue(issues, issue) {
    var exists = issues.some(function (current) {
      return current.severity === issue.severity &&
        current.title === issue.title &&
        current.explanation === issue.explanation;
    });

    if (!exists) issues.push(issue);
  }

  function readInput() {
    return {
      destination: $("destination").value.trim(),
      campaign: $("campaign").value.trim(),
      source: $("source").value.trim(),
      medium: $("medium").value.trim(),
      content: $("content").value.trim(),
      term: $("term").value.trim(),
      goal: $("goal").value
    };
  }

  function validateInput(input) {
    var fields = [
      ["destination", 2000],
      ["campaign", MAX_FIELD_LENGTH],
      ["source", 80],
      ["medium", 80],
      ["content", MAX_FIELD_LENGTH],
      ["term", MAX_FIELD_LENGTH]
    ];

    var valid = true;

    fields.forEach(function (field) {
      var name = field[0];
      var max = field[1];
      var element = $(name);
      var error = $(name + "-error");
      var value = input[name];
      var message = "";

      if (name !== "destination" && !value && ["campaign", "source", "medium"].indexOf(name) !== -1) {
        message = "This field is required.";
      } else if (value.length > max) {
        message = "Use " + max + " characters or fewer.";
      } else if (hasControlCharacters(value)) {
        message = "Control characters are not allowed.";
      } else if (name === "destination" && value) {
        try {
          var url = new URL(value);
          if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) {
            message = "Use a public HTTP or HTTPS URL without credentials.";
          }
        } catch (error) {
          message = "Enter a complete HTTP or HTTPS URL.";
        }
      }

      element.setAttribute("aria-invalid", message ? "true" : "false");
      error.textContent = message;
      if (message) valid = false;
    });

    return valid;
  }

  function buildUrl(input, issues) {
    var url;

    try {
      url = new URL(input.destination);
    } catch (error) {
      return "";
    }

    Array.from(url.searchParams.keys()).forEach(function (key) {
      if (/^utm_(source|medium|campaign|content|term)$/i.test(key)) {
        addIssue(issues, {
          severity: "warning",
          title: "Existing " + key + " parameter",
          explanation: "The destination already contains a UTM parameter. TrackProof replaces it to prevent conflicting values."
        });
        url.searchParams.delete(key);
      }
    });

    var values = {
      utm_source: input.source,
      utm_medium: input.medium,
      utm_campaign: input.campaign,
      utm_content: input.content,
      utm_term: input.term
    };

    Object.keys(values).forEach(function (name) {
      if (values[name]) {
        url.searchParams.set(name, values[name].trim().toLowerCase());
      }
    });

    return url.toString();
  }

  function hasSensitive(value) {
    var decoded = value;

    try {
      decoded = decodeURIComponent(value);
    } catch (error) {
      decoded = value;
    }

    return /[\w.+-]+@[\w-]+\.[\w.-]+/.test(decoded) ||
      /(?:\+?\d[\d\s().-]{7,}\d)/.test(decoded) ||
      /(?:api[_-]?key|token|secret|password)\s*[=:]/i.test(decoded);
  }

  function audit(input) {
    var issues = [];
    var url;

    try {
      url = new URL(input.destination);
      if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error("invalid");
      }
    } catch (error) {
      addIssue(issues, {
        severity: "blocker",
        title: "Invalid destination URL",
        explanation: "Use a complete public HTTP or HTTPS URL without credentials."
      });
      return { issues: issues, finalUrl: "", status: "blocked" };
    }

    [
      ["source", "utm_source"],
      ["medium", "utm_medium"],
      ["campaign", "utm_campaign"]
    ].forEach(function (item) {
      if (!input[item[0]]) {
        addIssue(issues, {
          severity: "blocker",
          title: "Missing " + item[1],
          explanation: "Add a value so reports can group this visit consistently."
        });
      }
    });

    ["source", "medium", "campaign", "content", "term"].forEach(function (key) {
      var value = input[key];

      if (/[A-Z]/.test(value)) {
        addIssue(issues, {
          severity: "warning",
          title: "Mixed casing",
          explanation: "TrackProof normalizes generated tracking values to lowercase to avoid split reporting."
        });
      }

      if (/\s/.test(value)) {
        addIssue(issues, {
          severity: "warning",
          title: "Spaces in tracking value",
          explanation: "Spaces are encoded, but underscores or hyphens are easier to read and keep consistent."
        });
      }

      if (hasSensitive(value)) {
        addIssue(issues, {
          severity: "blocker",
          title: "Potential sensitive data",
          explanation: "Do not place emails, phone numbers, secrets, or personal identifiers in campaign parameters."
        });
      }

      if (hasControlCharacters(value)) {
        addIssue(issues, {
          severity: "blocker",
          title: "Control characters detected",
          explanation: "Remove line breaks, tabs, or other invisible characters before sharing this campaign link."
        });
      }
    });

    if (url.hash) {
      addIssue(issues, {
        severity: "note",
        title: "Destination contains a fragment",
        explanation: "The fragment is preserved, but it is handled by the browser and is not sent to the server."
      });
    }

    var finalUrl = buildUrl(input, issues);

    if (finalUrl.length > 2000 && finalUrl.length <= MAX_FINAL_URL_LENGTH) {
      addIssue(issues, {
        severity: "warning",
        title: "Long final URL",
        explanation: "Long links can be difficult to share and may be truncated by some tools."
      });
    }

    if (finalUrl.length > MAX_FINAL_URL_LENGTH) {
      addIssue(issues, {
        severity: "blocker",
        title: "Final URL is too long",
        explanation: "Shorten the destination or campaign values before sharing this link."
      });
    }

    if (!input.content) {
      addIssue(issues, {
        severity: "note",
        title: "No campaign content",
        explanation: "Add utm_content when you need to distinguish buttons, creatives, or placements."
      });
    }

    var hasBlocker = issues.some(function (issue) {
      return issue.severity === "blocker";
    });

    var hasWarning = issues.some(function (issue) {
      return issue.severity === "warning";
    });

    return {
      issues: issues,
      finalUrl: finalUrl,
      status: hasBlocker ? "blocked" : hasWarning ? "review" : "ready"
    };
  }

  function namingSuggestion(input) {
    var pieces = [
      input.campaign || "campaign",
      input.source || "source",
      input.medium || "medium"
    ];

    return pieces.map(function (piece) {
      return piece.toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    }).join("_");
  }

  function fallback(input) {
    var auditResult = audit(input);

    return {
      schemaVersion: 1,
      input: input,
      finalUrl: auditResult.finalUrl,
      issues: auditResult.issues,
      status: auditResult.status,
      namingSuggestion: namingSuggestion(input),
      suggestedEvent: input.goal || "generate_lead",
      createdAt: new Date().toISOString(),
      provider: "rules-only"
    };
  }

  function validIssue(issue) {
    return issue &&
      typeof issue === "object" &&
      ["blocker", "warning", "note"].indexOf(issue.severity) !== -1 &&
      typeof issue.title === "string" &&
      issue.title.length <= 200 &&
      typeof issue.explanation === "string" &&
      issue.explanation.length <= 1000;
  }

  function validReport(report) {
    return report &&
      report.schemaVersion === 1 &&
      report.input &&
      typeof report.input === "object" &&
      typeof report.input.destination === "string" &&
      typeof report.input.campaign === "string" &&
      typeof report.input.source === "string" &&
      typeof report.input.medium === "string" &&
      typeof report.finalUrl === "string" &&
      report.finalUrl.length <= MAX_FINAL_URL_LENGTH &&
      ["ready", "review", "blocked"].indexOf(report.status) !== -1 &&
      Array.isArray(report.issues) &&
      report.issues.length <= 100 &&
      report.issues.every(validIssue);
  }

  function requestReport(input) {
    if (IS_GITHUB_PAGES) {
      return Promise.reject(new Error("Remote API unavailable on GitHub Pages"));
    }

    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }).then(function (response) {
      if (!response.ok) throw new Error("API request failed");
      return response.json();
    }).then(function (data) {
      if (!validReport(data)) throw new Error("Invalid report");
      return data;
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function render(report) {
    latestReport = report;
    results.hidden = false;
    $("status-badge").textContent = report.status;
    $("status-badge").className = "badge " + report.status;
    $("final-url").textContent = report.finalUrl || "No final URL was created.";
    $("event-suggestion").textContent = report.suggestedEvent || report.input.goal || "generate_lead";

    $("issues").innerHTML = report.issues.length ? report.issues.map(function (issue) {
      return "<article class=\"issue " + escapeHtml(issue.severity) + "\"><strong>" +
        escapeHtml(issue.severity) + " — " + escapeHtml(issue.title) + "</strong><p>" +
        escapeHtml(issue.explanation) + "</p></article>";
    }).join("") : "<p>No issues detected. This link is ready for structural review.</p>";

    var detailPairs = [
      ["Campaign", report.input.campaign],
      ["Source", report.input.source],
      ["Medium", report.input.medium],
      ["Content", report.input.content || "Not supplied"],
      ["Term", report.input.term || "Not supplied"],
      ["Goal", report.input.goal || "generate_lead"],
      ["Naming suggestion", report.namingSuggestion || namingSuggestion(report.input)],
      ["Provider", report.provider || "rules-only"]
    ];

    $("details").innerHTML = detailPairs.map(function (pair) {
      return "<dt>" + escapeHtml(pair[0]) + "</dt><dd>" + escapeHtml(pair[1]) + "</dd>";
    }).join("");

    $("results-announcement").textContent =
      "Audit complete. Status: " + report.status + ".";

    var reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    results.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start"
    });

    $("results-title").focus();
  }

  function markdown(report) {
    var issueText = report.issues.length ? report.issues.map(function (issue) {
      return "- **" + issue.severity + " — " + issue.title + "**: " + issue.explanation;
    }).join("\n") : "- No structural issues detected.";

    return "# TrackProof tracking contract\n\n" +
      "**Status:** " + report.status.toUpperCase() + "\n\n" +
      "**Campaign:** " + report.input.campaign + "\n" +
      "**Source:** " + report.input.source + "\n" +
      "**Medium:** " + report.input.medium + "\n" +
      "**Content:** " + (report.input.content || "Not supplied") + "\n" +
      "**Term:** " + (report.input.term || "Not supplied") + "\n" +
      "**Goal:** " + (report.input.goal || "generate_lead") + "\n" +
      "**Destination:** " + report.input.destination + "\n" +
      "**Final URL:** " + report.finalUrl + "\n" +
      "**Suggested event:** " + (report.suggestedEvent || report.input.goal) +
      "\n\n## Issues\n" + issueText +
      "\n\n_TrackProof checks campaign-link structure and naming consistency. It does not guarantee analytics or attribution correctness._";
  }

  function download(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    setTimeout(function () {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function csv(report) {
    var rows = [
      ["field", "value"],
      ["status", report.status],
      ["campaign", report.input.campaign],
      ["source", report.input.source],
      ["medium", report.input.medium],
      ["content", report.input.content],
      ["term", report.input.term],
      ["goal", report.input.goal],
      ["destination", report.input.destination],
      ["final_url", report.finalUrl],
      ["suggested_event", report.suggestedEvent || report.input.goal]
    ];

    report.issues.forEach(function (issue, index) {
      rows.push([
        "issue_" + (index + 1),
        issue.severity + ": " + issue.title + " — " + issue.explanation
      ]);
    });

    return rows.map(function (row) {
      return row.map(function (value) {
        return "\"" + String(value || "").replace(/"/g, "\"\"") + "\"";
      }).join(",");
    }).join("\n");
  }

  function copyFallback(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    var copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) throw new Error("Copy failed");
  }

  function copyText(text) {
    var operation;

    if (navigator.clipboard && window.isSecureContext) {
      operation = navigator.clipboard.writeText(text);
    } else {
      operation = Promise.resolve().then(function () {
        copyFallback(text);
      });
    }

    return operation.then(function () {
      status.setAttribute("role", "status");
      status.textContent = "Copied to your clipboard.";
    }).catch(function () {
      status.setAttribute("role", "alert");
      status.textContent = "Copy failed. Select and copy the text manually.";
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) return;

    var input = readInput();

    if (!validateInput(input)) {
      status.setAttribute("role", "alert");
      status.textContent = "Please fix the highlighted fields.";
      return;
    }

    busy = true;
    submitButton.disabled = true;
    status.setAttribute("role", "status");
    status.textContent = "Checking campaign structure…";

    var local = fallback(input);
    render(local);

    requestReport(input).then(function (remote) {
      render(remote);
      status.textContent = "Audit complete.";
    }).catch(function () {
      status.textContent = IS_GITHUB_PAGES
        ? "GitHub Pages rules-only mode is active. The local audit is ready."
        : "API unavailable. A rules-only audit is ready.";
    }).finally(function () {
      busy = false;
      submitButton.disabled = false;
    });
  });

  $("copy-url").addEventListener("click", function () {
    if (latestReport) copyText(latestReport.finalUrl);
  });

  $("copy-markdown").addEventListener("click", function () {
    if (latestReport) copyText(markdown(latestReport));
  });

  $("download-csv").addEventListener("click", function () {
    if (latestReport) {
      download(
        "trackproof-contract.csv",
        "\uFEFF" + csv(latestReport),
        "text/csv;charset=utf-8"
      );
    }
  });
}());
