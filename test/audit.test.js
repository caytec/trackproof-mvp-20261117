"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function buildUrl(input) {
  const url = new URL(input.destination);

  for (const key of Array.from(url.searchParams.keys())) {
    if (/^utm_(source|medium|campaign|content|term)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }

  const values = {
    utm_source: input.source,
    utm_medium: input.medium,
    utm_campaign: input.campaign,
    utm_content: input.content,
    utm_term: input.term
  };

  Object.keys(values).forEach((name) => {
    if (values[name]) url.searchParams.set(name, values[name].toLowerCase());
  });

  return url.toString();
}

test("preserves non-UTM query parameters and replaces UTM parameters case-insensitively", () => {
  const result = buildUrl({
    destination: "https://example.com/page?ref=mail&UTM_Source=old",
    source: "Newsletter",
    medium: "Email",
    campaign: "Spring Launch",
    content: "",
    term: ""
  });

  assert.equal(
    result,
    "https://example.com/page?ref=mail&utm_source=newsletter&utm_medium=email&utm_campaign=spring+launch"
  );
});

test("preserves destination fragments", () => {
  const result = buildUrl({
    destination: "https://example.com/page#pricing",
    source: "social",
    medium: "paid",
    campaign: "launch",
    content: "",
    term: ""
  });

  assert.match(result, /#pricing$/);
});

test("encodes tracking values through URLSearchParams", () => {
  const result = buildUrl({
    destination: "https://example.com/page",
    source: "email",
    medium: "newsletter",
    campaign: "spring & summer",
    content: "",
    term: ""
  });

  assert.match(result, /utm_campaign=spring\+%26+summer/);
});
