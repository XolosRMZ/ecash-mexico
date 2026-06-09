import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ALIAS_ERROR_MESSAGE,
  applyAliasValidation,
  cleanAliasInput,
  isEligibilityButtonDisabled,
  isVoteButtonDisabled,
  resetDisconnectedAssemblyUi,
  setAssemblyMessage,
  validateAlias,
} from "../src/asamblea/asamblea.js";

function makeClassList(initial = []) {
  const values = new Set(initial);

  return {
    add(name) {
      values.add(name);
    },
    remove(name) {
      values.delete(name);
    },
    toggle(name, force) {
      if (force) {
        values.add(name);
        return true;
      }

      values.delete(name);
      return false;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function makeElement({ value = "", hidden = true, disabled = false } = {}) {
  const attrs = {};

  return {
    value,
    textContent: "",
    disabled,
    classList: makeClassList(hidden ? ["hidden"] : []),
    children: ["existing"],
    setAttribute(name, nextValue) {
      attrs[name] = String(nextValue);
    },
    getAttribute(name) {
      return attrs[name];
    },
    replaceChildren() {
      this.children = [];
    },
  };
}

function makeUi(value) {
  return {
    inputAlias: makeElement({ value, hidden: false }),
    aliasErrorMsg: makeElement(),
    checkEligibilityButton: makeElement({ hidden: false, disabled: true }),
  };
}

test("validateAlias accepts valid .xec aliases", () => {
  for (const alias of ["xolosarmy.xec", "fernando-rmz.xec", "guardian8.xec"]) {
    assert.deepEqual(validateAlias(alias), { valid: true, normalized: alias });
  }
});

test("validateAlias rejects invalid aliases before backend calls", () => {
  for (const alias of [
    "voto asamblea.xec",
    ".xec",
    "-asamblea.xec",
    "asamblea-.xec",
    "asamblea..xec",
    "asamblea",
    "asamblea.com",
    "<script>alert(1)</script>",
    "",
  ]) {
    assert.equal(validateAlias(alias).valid, false, alias);
  }
});

test("cleanAliasInput normalizes case and trim without deleting internal spaces", () => {
  assert.equal(cleanAliasInput("XolosArmy.XEC"), "xolosarmy.xec");
  assert.equal(cleanAliasInput(" xolosarmy.xec "), "xolosarmy.xec");
  assert.equal(cleanAliasInput("voto asamblea.xec"), "voto asamblea.xec");
  assert.equal(
    validateAlias(cleanAliasInput("voto asamblea.xec")).valid,
    false,
  );
  assert.equal(
    cleanAliasInput("<script>alert(1)</script>"),
    "scriptalert1script",
  );
});

test("applyAliasValidation exposes invalid non-empty alias accessibly", () => {
  const ui = makeUi("voto asamblea.xec");

  applyAliasValidation(ui, { walletConnected: true });

  assert.equal(ui.inputAlias.getAttribute("aria-invalid"), "true");
  assert.equal(ui.aliasErrorMsg.classList.contains("hidden"), false);
  assert.equal(ui.aliasErrorMsg.getAttribute("role"), "alert");
  assert.equal(ui.aliasErrorMsg.textContent, ALIAS_ERROR_MESSAGE);
  assert.equal(ui.checkEligibilityButton.disabled, true);
});

test("applyAliasValidation leaves empty alias neutral", () => {
  const ui = makeUi("");

  applyAliasValidation(ui, { walletConnected: true });

  assert.equal(ui.inputAlias.getAttribute("aria-invalid"), "false");
  assert.equal(ui.aliasErrorMsg.classList.contains("hidden"), true);
  assert.equal(ui.checkEligibilityButton.disabled, true);
});

test("setAssemblyMessage uses alert only for errors and status for normal states", () => {
  const element = makeElement();

  setAssemblyMessage(element, "Alias inválido", "error");
  assert.equal(element.textContent, "Alias inválido");
  assert.equal(element.getAttribute("role"), "alert");
  assert.equal(element.classList.contains("hidden"), false);

  setAssemblyMessage(
    element,
    "Alias elegible para votar en esta Asamblea RMZ.",
    "status",
  );
  assert.equal(element.getAttribute("role"), "status");
});

test("eligibility button requires wallet, valid alias, and idle verification", () => {
  assert.equal(
    isEligibilityButtonDisabled({ walletConnected: false, aliasValid: true }),
    true,
  );
  assert.equal(
    isEligibilityButtonDisabled({ walletConnected: true, aliasValid: false }),
    true,
  );
  assert.equal(
    isEligibilityButtonDisabled({
      walletConnected: true,
      aliasValid: true,
      checkingEligibility: true,
    }),
    true,
  );
  assert.equal(
    isEligibilityButtonDisabled({ walletConnected: true, aliasValid: true }),
    false,
  );
});

test("applyAliasValidation wires eligibility button state", () => {
  const disconnected = makeUi("xolosarmy.xec");
  applyAliasValidation(disconnected, { walletConnected: false });
  assert.equal(disconnected.checkEligibilityButton.disabled, true);

  const invalid = makeUi("asamblea");
  applyAliasValidation(invalid, { walletConnected: true });
  assert.equal(invalid.checkEligibilityButton.disabled, true);

  const valid = makeUi("XolosArmy.XEC");
  applyAliasValidation(valid, { walletConnected: true });
  assert.equal(valid.inputAlias.value, "xolosarmy.xec");
  assert.equal(valid.checkEligibilityButton.disabled, false);

  applyAliasValidation(valid, {
    walletConnected: true,
    checkingEligibility: true,
  });
  assert.equal(valid.checkEligibilityButton.disabled, true);
});

test("vote button requires wallet, eligible alias, open proposal, choice, and idle flow", () => {
  assert.equal(
    isVoteButtonDisabled({
      walletConnected: true,
      aliasEligible: false,
      proposalOpen: true,
      choiceSelected: true,
    }),
    true,
  );
  assert.equal(
    isVoteButtonDisabled({
      walletConnected: true,
      aliasEligible: true,
      proposalOpen: true,
      choiceSelected: false,
    }),
    true,
  );
  assert.equal(
    isVoteButtonDisabled({
      walletConnected: true,
      aliasEligible: true,
      proposalOpen: true,
      choiceSelected: true,
      voteInProgress: true,
    }),
    true,
  );
  assert.equal(
    isVoteButtonDisabled({
      walletConnected: true,
      aliasEligible: true,
      proposalOpen: true,
      choiceSelected: true,
    }),
    false,
  );
});

test("disconnect reset clears alias, messages, selected choice, canonical message, and states", () => {
  const radios = [{ checked: true }, { checked: false }];
  const ui = {
    inputAlias: makeElement({ value: "xolosarmy.xec" }),
    aliasErrorMsg: makeElement({ hidden: false }),
    checkEligibilityButton: makeElement({ disabled: false }),
    eligibility: makeElement({ hidden: false }),
    voteButton: makeElement({ disabled: false }),
    voteStatus: makeElement({ hidden: false }),
    canonicalMessage: makeElement({ hidden: false }),
    auditLinks: makeElement({ hidden: false }),
    choicesList: {
      querySelectorAll() {
        return radios;
      },
    },
  };

  ui.canonicalMessage.textContent = "canonical vote";
  ui.auditLinks.children = ["link"];

  resetDisconnectedAssemblyUi(ui);

  assert.equal(ui.inputAlias.value, "");
  assert.equal(ui.inputAlias.getAttribute("aria-invalid"), "false");
  assert.equal(ui.aliasErrorMsg.classList.contains("hidden"), true);
  assert.equal(
    ui.eligibility.textContent,
    "Conecta Tonalli Wallet para verificar elegibilidad.",
  );
  assert.equal(ui.eligibility.getAttribute("role"), "status");
  assert.equal(ui.checkEligibilityButton.disabled, true);
  assert.equal(ui.voteButton.disabled, true);
  assert.equal(
    radios.every((radio) => radio.checked === false),
    true,
  );
  assert.equal(ui.canonicalMessage.textContent, "");
  assert.deepEqual(ui.auditLinks.children, []);
  assert.equal(ui.auditLinks.classList.contains("hidden"), true);
});

test("assembly HTML exposes accessible alias and status controls", () => {
  const html = readFileSync(
    new URL("../asamblea/index.html", import.meta.url),
    "utf8",
  );
  const inputTag =
    html.match(/<input[\s\S]*?id="input-alias"[\s\S]*?>/)?.[0] ?? "";
  const buttonTag =
    html.match(/<button[\s\S]*?id="btn-check-eligibility"[\s\S]*?>/)?.[0] ?? "";
  const errorTag =
    html.match(/<p[\s\S]*?id="alias-error-msg"[\s\S]*?>/)?.[0] ?? "";
  const statusTag =
    html.match(/<div[\s\S]*?id="ui-eligibility"[\s\S]*?>/)?.[0] ?? "";

  assert.match(inputTag, /type="text"/);
  assert.match(inputTag, /autocomplete="off"/);
  assert.match(inputTag, /spellcheck="false"/);
  assert.match(inputTag, /inputmode="text"/);
  assert.match(inputTag, /required/);
  assert.equal(
    inputTag.includes('pattern="^[a-z0-9][a-z0-9-]{1,62}\\.xec$"'),
    true,
  );
  assert.match(inputTag, /aria-describedby="alias-error-msg ui-eligibility"/);
  assert.match(inputTag, /aria-invalid="false"/);
  assert.match(inputTag, /disabled/);
  assert.match(buttonTag, /type="button"/);
  assert.match(buttonTag, /disabled/);
  assert.match(errorTag, /role="alert"/);
  assert.match(statusTag, /role="status"/);
});

test("assembly source avoids unsafe HTML assignment for dynamic content", () => {
  const files = [
    "../asamblea/index.html",
    "../src/asamblea/asamblea.js",
    "./asamblea.test.mjs",
  ];

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const forbidden = ["inner", "HTML"].join("");
    assert.equal(source.includes(forbidden), false, file);
  }
});
