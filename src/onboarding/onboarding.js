import {
  isValidEcashAddress,
  normalizeEcashAddress,
} from "@xolosarmy/tonalli-core";

const API_BASE = "https://faucet.ecash.mx/v1/faucet";
const HEALTH_URL = `${API_BASE}/health`;
const STARTER_PACK_URL = `${API_BASE}/starter-pack`;
const EXPLORER_TX_URL = "https://explorer.xolosarmy.xyz/tx/";

const MESSAGES = {
  invalidAddress: "Pega una dirección válida de eCash, por ejemplo ecash:q...",
  idle: "Pega tu dirección eCash para iniciar.",
  validating: "Validando dirección eCash.",
  submitting: "Entregando Starter Pack Guardián RMZ...",
  networkError: "Error de red. Vuelve a intentarlo.",
  genericError: "No se pudo entregar el Starter Pack en este momento.",
  addressCooldown:
    "Energía de ignición en recarga. Esta dirección ya recibió su chispa inicial recientemente.",
  rateLimit:
    "Demasiados intentos por ahora. Espera unos minutos antes de volver a reclamar el Starter Pack.",
};

const toneClasses = {
  neutral: "border-white/10 bg-white/[0.03] text-gray-300",
  success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  warning: "border-yellow-200/30 bg-yellow-200/10 text-yellow-100",
  error: "border-red-300/30 bg-red-400/10 text-red-100",
};

const ADDRESS_PATTERN = /^(ecash:)?[qp][a-z0-9]{41}$/;

let turnstileTokenProvider = null;
let turnstileToken = null;

globalThis.RMZOnboarding = {
  setTurnstileTokenProvider(provider) {
    turnstileTokenProvider = provider;
  },
  setTurnstileToken(token) {
    turnstileToken = token || null;
    globalThis.dispatchEvent?.(
      new CustomEvent("rmz:onboarding:turnstile", {
        detail: { token: turnstileToken },
      }),
    );
  },
};

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

function formatBoolean(value) {
  if (value === undefined || value === null) return "...";
  return normalizeBoolean(value) ? "Sí" : "No";
}

function formatDryRun(value) {
  if (value === undefined || value === null) return "...";
  return normalizeBoolean(value) ? "Activo" : "Inactivo";
}

function formatRmzAtoms(value) {
  const atoms = String(value ?? "0");
  return atoms === "1" ? "1 átomo RMZ" : `${atoms} átomos RMZ`;
}

function getStarterPackConfig(payload) {
  return (
    payload?.starterPack ??
    payload?.config?.starterPack ??
    payload?.faucet?.starterPack ??
    {}
  );
}

function getNestedValue(payload, keys, fallback = undefined) {
  for (const key of keys) {
    const value = key
      .split(".")
      .reduce((current, part) => current?.[part], payload);
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function cleanAddressInput(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^web\+ecash:/i, "ecash:")
    .replace(/^xec:/i, "ecash:")
    .toLowerCase()
    .replace(/[^a-z0-9:]/g, "");
}

function normalizeAddressForValidation(value) {
  let cleaned = cleanAddressInput(value);

  if (cleaned.startsWith("tokenaddr:")) {
    return cleaned;
  }

  if (!cleaned.includes(":") && /^[qp][a-z0-9]{41}$/.test(cleaned)) {
    cleaned = `ecash:${cleaned}`;
  }

  return cleaned;
}

function hasPlausibleAddressShape(address) {
  if (!address.startsWith("ecash:")) return false;
  if (address.startsWith("tokenaddr:")) return false;
  return ADDRESS_PATTERN.test(address);
}

function validateAddress(value) {
  const address = normalizeAddressForValidation(value);

  if (!hasPlausibleAddressShape(address)) {
    return { valid: false, address, message: MESSAGES.invalidAddress };
  }

  try {
    const normalized = normalizeEcashAddress(address);
    if (isValidEcashAddress(normalized)) {
      return { valid: true, address: normalized };
    }
  } catch {
    // Fall back to the strict local shape check below.
  }

  if (ADDRESS_PATTERN.test(address)) {
    return { valid: true, address };
  }

  return { valid: false, address, message: MESSAGES.invalidAddress };
}

function isClaimButtonDisabled({
  valid,
  state,
  turnstileRequired = false,
  turnstileCompleted = false,
}) {
  return (
    !valid ||
    state === "validating" ||
    state === "submitting" ||
    state === "success" ||
    (turnstileRequired && !turnstileCompleted)
  );
}

function applyAddressValidation(ui, options = {}) {
  const cleaned = cleanAddressInput(ui.addressInput.value);

  if (ui.addressInput.value !== cleaned) {
    ui.addressInput.value = cleaned;
  }

  const currentValidation = validateAddress(cleaned);
  const hasValue = cleaned.trim() !== "";
  const isInvalid = hasValue && !currentValidation.valid;

  ui.addressMessage.classList.toggle("hidden", !isInvalid);
  ui.addressInput.setAttribute("aria-invalid", isInvalid ? "true" : "false");
  ui.claimButton.disabled = isClaimButtonDisabled({
    valid: currentValidation.valid,
    state: options.state,
    turnstileRequired: options.turnstileRequired,
    turnstileCompleted: options.turnstileCompleted,
  });

  return currentValidation;
}

function getTurnstileEnabled(payload) {
  return normalizeBoolean(
    getNestedValue(payload, [
      "turnstileEnabled",
      "turnstile.enabled",
      "config.turnstileEnabled",
    ]),
  );
}

function setStatus(element, message, tone = "neutral") {
  element.className = `mt-5 rounded-md border p-4 text-sm leading-7 transition-opacity duration-300 ${toneClasses[tone]}`;
  element.textContent = message;

  if (tone === "error") {
    element.setAttribute("role", "alert");
  } else {
    element.setAttribute("role", "status");
  }
}

async function readJsonResponse(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const backendError =
      payload?.error || payload?.message || `HTTP ${response.status}`;

    throw Object.assign(new Error(backendError), {
      status: response.status,
      payload,
      backendError,
    });
  }

  return payload ?? {};
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    ...options,
  });

  return readJsonResponse(response);
}

function mapBackendError(error) {
  if (error instanceof TypeError) {
    return MESSAGES.networkError;
  }

  const message = String(
    error?.backendError ??
      error?.payload?.error ??
      error?.payload?.message ??
      error?.message ??
      "",
  ).toLowerCase();

  const isAddressCooldown =
    message.includes("address already") ||
    message.includes("already received") ||
    (message.includes("address") &&
      (message.includes("cooldown") || message.includes("recently")));

  if (isAddressCooldown) {
    return MESSAGES.addressCooldown;
  }

  const isRateLimit =
    error?.status === 429 ||
    message.includes("too many") ||
    message.includes("rate limit") ||
    message.includes("rate-limit") ||
    message.includes("429") ||
    message.includes("cooldown") ||
    message.includes("recently") ||
    message.includes("ip");

  if (isRateLimit) {
    return MESSAGES.rateLimit;
  }

  return MESSAGES.genericError;
}

function renderTxid(txidsContainer, label, txid) {
  const wrapper = document.createElement("div");
  wrapper.className = "rounded-md border border-white/10 bg-black/35 p-3";

  const title = document.createElement("dt");
  title.className = "font-semibold text-gray-400";
  title.textContent = label;

  const value = document.createElement("dd");
  value.className = "space-mono mt-1 break-all text-sm text-white";

  if (!txid) {
    value.textContent = "Pendiente";
  } else if (String(txid).startsWith("dryrun-")) {
    value.textContent = `${txid} · Tx simulada en modo prueba.`;
  } else {
    const link = document.createElement("a");
    link.href = `${EXPLORER_TX_URL}${encodeURIComponent(txid)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "text-emerald-200 underline decoration-emerald-300/40";
    link.textContent = txid;
    value.append(link);
  }

  wrapper.append(title, value);
  txidsContainer.append(wrapper);
}

function renderSuccess(ui, payload) {
  const starterPack = payload?.starterPack ?? {};
  ui.successAddress.textContent = payload?.address ?? "";
  ui.successXec.textContent = starterPack.xec ?? starterPack.xecSats ?? "...";
  ui.successRmz.textContent =
    starterPack.rmzAtoms === undefined || starterPack.rmzAtoms === null
      ? "..."
      : formatRmzAtoms(starterPack.rmzAtoms);
  ui.successDryRun.textContent = formatDryRun(payload?.dryRun);
  ui.successTxids.replaceChildren();

  renderTxid(ui.successTxids, "Transacción XEC", payload?.txids?.xec);
  renderTxid(ui.successTxids, "Transacción RMZ", payload?.txids?.rmz);

  ui.addressInput.disabled = true;
  ui.claimButton.disabled = true;
  ui.form.classList.add("hidden");
  ui.successCard.classList.remove("hidden");
  ui.nextSteps.classList.remove("hidden");
}

function renderHealth(ui, payload) {
  const starterPack = getStarterPackConfig(payload);
  const enabled = getNestedValue(payload, [
    "starterPackEnabled",
    "starterPack.enabled",
    "config.starterPackEnabled",
  ]);
  const dryRun = getNestedValue(payload, ["dryRun", "config.dryRun"]);
  const turnstileEnabled = getNestedValue(payload, [
    "turnstileEnabled",
    "turnstile.enabled",
    "config.turnstileEnabled",
  ]);
  const cooldownDays = getNestedValue(payload, [
    "cooldownDays",
    "starterPack.cooldownDays",
    "config.cooldownDays",
  ]);

  ui.healthStatus.textContent = "Online";
  ui.healthStatus.className =
    "space-mono rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200";
  ui.healthEnabled.textContent = formatBoolean(enabled);
  ui.healthDryRun.textContent = formatDryRun(dryRun);
  ui.healthTurnstile.textContent = formatBoolean(turnstileEnabled);
  ui.healthCooldown.textContent =
    cooldownDays === undefined || cooldownDays === null
      ? "..."
      : `${cooldownDays}`;
  ui.healthAmounts.textContent = [
    starterPack.xec ? `${starterPack.xec} XEC` : null,
    starterPack.xecSats ? `${starterPack.xecSats} sats` : null,
    starterPack.rmzAtoms ? formatRmzAtoms(starterPack.rmzAtoms) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!ui.healthAmounts.textContent) {
    ui.healthAmounts.textContent = "Montos no publicados por health.";
  }

  if (normalizeBoolean(dryRun)) {
    ui.dryRunBanner.classList.remove("hidden");
  }

  if (normalizeBoolean(turnstileEnabled)) {
    ui.turnstileSlot.classList.remove("hidden");
  }
}

function renderHealthError(ui) {
  ui.healthStatus.textContent = "Sin señal";
  ui.healthStatus.className =
    "space-mono rounded-full border border-yellow-200/30 bg-yellow-200/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-yellow-100";
  ui.healthEnabled.textContent = "...";
  ui.healthDryRun.textContent = "...";
  ui.healthTurnstile.textContent = "...";
  ui.healthCooldown.textContent = "...";
  ui.healthAmounts.textContent = "No se pudo consultar health.";
}

async function getTurnstileToken() {
  if (turnstileToken) return turnstileToken;
  if (typeof turnstileTokenProvider !== "function") return null;
  return turnstileTokenProvider();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const ui = {
      dryRunBanner: document.getElementById("dry-run-banner"),
      healthStatus: document.getElementById("health-status"),
      healthEnabled: document.getElementById("health-enabled"),
      healthDryRun: document.getElementById("health-dry-run"),
      healthTurnstile: document.getElementById("health-turnstile"),
      healthCooldown: document.getElementById("health-cooldown"),
      healthAmounts: document.getElementById("health-amounts"),
      form: document.getElementById("claim-form"),
      addressInput: document.getElementById("input-address"),
      addressMessage: document.getElementById("address-message"),
      turnstileSlot: document.getElementById("turnstile-slot"),
      claimButton: document.getElementById("btn-claim"),
      claimStatus: document.getElementById("claim-status"),
      successCard: document.getElementById("success-card"),
      successAddress: document.getElementById("success-address"),
      successXec: document.getElementById("success-xec"),
      successRmz: document.getElementById("success-rmz"),
      successDryRun: document.getElementById("success-dry-run"),
      successTxids: document.getElementById("success-txids"),
      nextSteps: document.getElementById("next-steps"),
    };

    if (Object.values(ui).some((element) => !element)) {
      console.warn("[RMZ Onboarding] Missing expected onboarding UI elements.");
      return;
    }

    let state = "idle";
    let turnstileRequired = false;
    let turnstileCompleted = Boolean(turnstileToken);
    let currentValidation = validateAddress("");

    const setFlowState = (nextState, message, tone = "neutral") => {
      state = nextState;
      ui.claimButton.disabled = isClaimButtonDisabled({
        valid: currentValidation.valid,
        state,
        turnstileRequired,
        turnstileCompleted,
      });
      ui.claimButton.textContent =
        state === "submitting" ? "Enviando..." : "Recibir Starter Pack";
      setStatus(ui.claimStatus, message, tone);
    };

    const validateAndRenderAddress = () => {
      currentValidation = applyAddressValidation(ui, {
        state,
        turnstileRequired,
        turnstileCompleted,
      });
    };

    globalThis.addEventListener?.("rmz:onboarding:turnstile", (event) => {
      turnstileCompleted = Boolean(event.detail?.token);
      validateAndRenderAddress();
    });

    ui.addressInput.addEventListener("input", () => {
      validateAndRenderAddress();
      if (state === "idle") return;
      if (currentValidation.valid) {
        setFlowState("idle", "Dirección lista para recibir Starter Pack.");
      } else {
        setFlowState("idle", MESSAGES.invalidAddress, "error");
      }
    });

    ui.addressInput.addEventListener("paste", () => {
      window.setTimeout(() => {
        validateAndRenderAddress();
      }, 0);
    });

    ui.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFlowState("validating", MESSAGES.validating);
      validateAndRenderAddress();

      if (!currentValidation.valid) {
        setFlowState("idle", MESSAGES.invalidAddress, "error");
        return;
      }

      setFlowState("submitting", MESSAGES.submitting);

      try {
        const turnstileToken = await getTurnstileToken();
        const address = normalizeAddressForValidation(ui.addressInput.value);
        const payload = await apiRequest(STARTER_PACK_URL, {
          method: "POST",
          body: JSON.stringify({
            address,
            ...(turnstileToken ? { turnstileToken } : {}),
          }),
        });

        renderSuccess(ui, payload);
        setFlowState(
          "success",
          "Starter Pack Guardián RMZ entregado.",
          "success",
        );
      } catch (error) {
        console.warn("[onboarding] starter-pack failed", {
          status: error?.status,
          backendError: error?.backendError,
          payloadError: error?.payload?.error,
        });
        setFlowState("error", mapBackendError(error), "error");
      }
    });

    validateAndRenderAddress();
    setFlowState("idle", MESSAGES.idle);

    apiRequest(HEALTH_URL)
      .then((payload) => {
        renderHealth(ui, payload);
        turnstileRequired = getTurnstileEnabled(payload);
        validateAndRenderAddress();
      })
      .catch(() => renderHealthError(ui));
  });
}

export {
  applyAddressValidation,
  cleanAddressInput,
  isClaimButtonDisabled,
  setStatus,
  validateAddress,
};
