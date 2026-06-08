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
  ipCooldown: "Esta zona de red ya reclamó un Starter Pack recientemente.",
};

const toneClasses = {
  neutral: "border-white/10 bg-white/[0.03] text-gray-300",
  success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  warning: "border-yellow-200/30 bg-yellow-200/10 text-yellow-100",
  error: "border-red-300/30 bg-red-400/10 text-red-100",
};

let turnstileTokenProvider = null;

globalThis.RMZOnboarding = {
  setTurnstileTokenProvider(provider) {
    turnstileTokenProvider = provider;
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

function cleanAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function hasPlausibleAddressShape(address) {
  if (!address.startsWith("ecash:")) return false;
  if (address.startsWith("tokenaddr:")) return false;
  if (address.length < 42 || address.length > 64) return false;
  if (!/^ecash:[qp][a-z0-9]+$/.test(address)) return false;
  return true;
}

function validateAddress(value) {
  const address = cleanAddress(value);

  if (!hasPlausibleAddressShape(address)) {
    return { valid: false, address, message: MESSAGES.invalidAddress };
  }

  try {
    const normalized = normalizeEcashAddress(address);
    if (isValidEcashAddress(normalized)) {
      return { valid: true, address: normalized };
    }
  } catch {
    return { valid: false, address, message: MESSAGES.invalidAddress };
  }

  return { valid: false, address, message: MESSAGES.invalidAddress };
}

function setStatus(element, message, tone = "neutral") {
  element.className = `mt-5 rounded-md border p-4 text-sm leading-7 transition-opacity duration-300 ${toneClasses[tone]}`;
  element.textContent = message;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const message =
      payload?.error ??
      payload?.message ??
      payload?.reason ??
      `HTTP ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
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
    error?.payload?.error ?? error?.payload?.message ?? error?.message ?? "",
  );

  if (message.includes("Address already received a starter pack recently")) {
    return MESSAGES.addressCooldown;
  }

  if (message.includes("IP already used for starter pack recently")) {
    return MESSAGES.ipCooldown;
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
  ui.successRmz.textContent = starterPack.rmzAtoms ?? "...";
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
    starterPack.rmzAtoms ? `${starterPack.rmzAtoms} Átomos RMZ` : null,
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
  if (typeof turnstileTokenProvider !== "function") return null;
  return turnstileTokenProvider();
}

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
  let currentValidation = validateAddress("");

  const setFlowState = (nextState, message, tone = "neutral") => {
    state = nextState;
    ui.claimButton.disabled =
      !currentValidation.valid ||
      state === "validating" ||
      state === "submitting" ||
      state === "success";
    ui.claimButton.textContent =
      state === "submitting" ? "Enviando..." : "Recibir Starter Pack";
    setStatus(ui.claimStatus, message, tone);
  };

  const syncAddressValidation = () => {
    currentValidation = validateAddress(ui.addressInput.value);
    ui.addressMessage.classList.toggle(
      "hidden",
      currentValidation.valid || ui.addressInput.value.trim() === "",
    );
    ui.claimButton.disabled =
      !currentValidation.valid ||
      state === "validating" ||
      state === "submitting" ||
      state === "success";
  };

  ui.addressInput.addEventListener("input", () => {
    syncAddressValidation();
    if (state === "idle") return;
    if (currentValidation.valid) {
      setFlowState("idle", "Dirección lista para recibir Starter Pack.");
    } else {
      setFlowState("idle", MESSAGES.invalidAddress, "error");
    }
  });

  ui.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFlowState("validating", MESSAGES.validating);
    syncAddressValidation();

    if (!currentValidation.valid) {
      setFlowState("idle", MESSAGES.invalidAddress, "error");
      return;
    }

    setFlowState("submitting", MESSAGES.submitting);

    try {
      const turnstileToken = await getTurnstileToken();
      const payload = await apiRequest(STARTER_PACK_URL, {
        method: "POST",
        body: JSON.stringify({
          address: currentValidation.address,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });

      if (!payload?.ok) {
        throw Object.assign(
          new Error(payload?.error || MESSAGES.genericError),
          {
            payload,
          },
        );
      }

      renderSuccess(ui, payload);
      setFlowState(
        "success",
        "Starter Pack Guardián RMZ entregado.",
        "success",
      );
    } catch (error) {
      setFlowState("cooldown/error", mapBackendError(error), "error");
    }
  });

  syncAddressValidation();
  setFlowState("idle", MESSAGES.idle);

  apiRequest(HEALTH_URL)
    .then((payload) => renderHealth(ui, payload))
    .catch(() => renderHealthError(ui));
});
