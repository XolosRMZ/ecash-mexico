import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAddressValidation,
  cleanAddressInput,
  setStatus,
  validateAddress,
} from "../src/onboarding/onboarding.js";

const VALID_Q = "qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
const VALID_ECASH_Q = `ecash:${VALID_Q}`;
const VALID_ECASH_P = "ecash:ppm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";

function makeClassList(initial = []) {
  const values = new Set(initial);

  return {
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

function makeUi(value) {
  const attrs = {};

  return {
    addressInput: {
      value,
      setAttribute(name, nextValue) {
        attrs[name] = nextValue;
      },
      getAttribute(name) {
        return attrs[name];
      },
    },
    addressMessage: {
      classList: makeClassList(["hidden"]),
    },
    claimButton: {
      disabled: true,
    },
  };
}

test("validateAddress accepts supported eCash address shapes", () => {
  assert.equal(validateAddress(VALID_ECASH_Q).valid, true);
  assert.equal(validateAddress(VALID_Q).valid, true);
  assert.equal(validateAddress(VALID_ECASH_P).valid, true);
});

test("cleanAddressInput normalizes aliases and removes unsafe characters", () => {
  assert.equal(cleanAddressInput(`xec:${VALID_Q}`), VALID_ECASH_Q);
  assert.equal(cleanAddressInput(`web+ecash:${VALID_Q}`), VALID_ECASH_Q);
  assert.equal(
    cleanAddressInput(" ecash:qpm2qszn hks23z7629mms6s4cwef74vcwvy22gdx6a "),
    VALID_ECASH_Q,
  );
  assert.equal(
    cleanAddressInput("<script>alert(1)</script>"),
    "scriptalert1script",
  );
});

test("validateAddress rejects invalid address input", () => {
  for (const value of [
    "<script>alert(1)</script>",
    "ecash:",
    "bitcoin:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
    "ecash:xpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
    "texto normal",
    "",
  ]) {
    assert.equal(validateAddress(value).valid, false, value);
  }
});

test("applyAddressValidation exposes invalid non-empty input accessibly", () => {
  const ui = makeUi("texto normal");

  applyAddressValidation(ui, { state: "idle" });

  assert.equal(ui.addressMessage.classList.contains("hidden"), false);
  assert.equal(ui.addressInput.getAttribute("aria-invalid"), "true");
  assert.equal(ui.claimButton.disabled, true);
});

test("applyAddressValidation hides the address message for empty input", () => {
  const ui = makeUi("");

  applyAddressValidation(ui, { state: "idle" });

  assert.equal(ui.addressMessage.classList.contains("hidden"), true);
  assert.equal(ui.addressInput.getAttribute("aria-invalid"), "false");
  assert.equal(ui.claimButton.disabled, true);
});

test("applyAddressValidation hides the address message for valid input", () => {
  const ui = makeUi(VALID_ECASH_Q);

  applyAddressValidation(ui, { state: "idle" });

  assert.equal(ui.addressMessage.classList.contains("hidden"), true);
  assert.equal(ui.addressInput.getAttribute("aria-invalid"), "false");
  assert.equal(ui.claimButton.disabled, false);
});

test("applyAddressValidation requires completed Turnstile when active", () => {
  const ui = makeUi(VALID_ECASH_Q);

  applyAddressValidation(ui, {
    state: "idle",
    turnstileRequired: true,
    turnstileCompleted: false,
  });

  assert.equal(ui.claimButton.disabled, true);

  applyAddressValidation(ui, {
    state: "idle",
    turnstileRequired: true,
    turnstileCompleted: true,
  });

  assert.equal(ui.claimButton.disabled, false);
});

test("setStatus uses alert role only for errors", () => {
  const element = {
    className: "",
    textContent: "",
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };

  setStatus(element, "Error", "error");
  assert.equal(element.textContent, "Error");
  assert.equal(element.attrs.role, "alert");

  setStatus(element, "Ok", "success");
  assert.equal(element.textContent, "Ok");
  assert.equal(element.attrs.role, "status");

  setStatus(element, "Listo");
  assert.equal(element.textContent, "Listo");
  assert.equal(element.attrs.role, "status");
});
