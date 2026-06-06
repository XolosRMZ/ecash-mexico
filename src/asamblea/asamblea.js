import UniversalProvider from "@walletconnect/universal-provider";
import { WalletConnectModal } from "@walletconnect/modal";
import {
  isValidEcashAddress,
  normalizeEcashAddress,
} from "@xolosarmy/tonalli-core";

const PROJECT_ID = "d8772b58056b6812d57c181501dd854c";
const ECASH_CHAIN = "ecash:1";
const PROPOSAL_ID = "rmz-b3-001";
const API_BASE = "https://assembly.ecash.mx/v1/assembly";

const WALLETCONNECT_METADATA = {
  name: "Asamblea RMZ",
  description: "Votación RMZ con Tonalli Wallet y alias .xec",
  url: "https://ecash.mx/asamblea/",
  icons: ["https://ecash.mx/favicon.svg"],
};

const ECASH_NAMESPACE = {
  ecash: {
    chains: [ECASH_CHAIN],
    methods: ["ecash_getAddresses", "ecash_signMessage"],
    events: ["accountsChanged", "chainChanged"],
  },
};

function normalizeEcashAccount(account) {
  if (!account || typeof account !== "string") {
    throw new Error("WalletConnect account is empty or invalid.");
  }

  const trimmed = account.trim();

  if (trimmed.startsWith("ecash:q") || trimmed.startsWith("ecash:p")) {
    return trimmed;
  }

  const lastEcashIndex = trimmed.lastIndexOf("ecash:");
  if (lastEcashIndex >= 0) {
    return trimmed.slice(lastEcashIndex);
  }

  const parts = trimmed.split(":");
  const lastPart = parts[parts.length - 1];

  if (lastPart?.startsWith("q") || lastPart?.startsWith("p")) {
    return `ecash:${lastPart}`;
  }

  throw new Error(`Unable to normalize eCash account: ${account}`);
}

function getFirstEcashAccount(session) {
  const directAccounts = session?.namespaces?.ecash?.accounts ?? [];
  if (directAccounts.length > 0) return directAccounts[0];

  const namespaceEntry = Object.entries(session?.namespaces ?? {}).find(
    ([namespace, value]) =>
      namespace.startsWith("ecash") && Array.isArray(value?.accounts),
  );

  return namespaceEntry?.[1]?.accounts?.[0] ?? null;
}

function extractFirstWalletAddress(response) {
  if (Array.isArray(response)) return response[0] ?? null;
  if (typeof response?.address === "string") return response.address;
  if (Array.isArray(response?.addresses)) return response.addresses[0] ?? null;
  if (Array.isArray(response?.result)) return response.result[0] ?? null;
  if (typeof response?.result?.address === "string") {
    return response.result.address;
  }
  if (Array.isArray(response?.result?.addresses)) {
    return response.result.addresses[0] ?? null;
  }
  return null;
}

function normalizeAlias(alias) {
  const value = String(alias || "")
    .trim()
    .toLowerCase();

  if (!value) return "";
  return value.endsWith(".xec") ? value : `${value}.xec`;
}

function formatDate(value) {
  if (!value) return "...";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isProposalOpen(proposal) {
  if (!proposal) return false;

  const now = Date.now();
  const startsAt = proposal.startsAt
    ? new Date(proposal.startsAt).getTime()
    : null;
  const endsAt = proposal.endsAt ? new Date(proposal.endsAt).getTime() : null;

  if (proposal.status && proposal.status !== "open") return false;
  if (startsAt && now < startsAt) return false;
  if (endsAt && now >= endsAt) return false;
  return true;
}

function getBackendError(error, fallback) {
  if (error?.backendMessage) return error.backendMessage;
  if (error?.message) return error.message;
  return fallback;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    ...options,
  });

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
    error.backendMessage = message;
    error.payload = payload;
    throw error;
  }

  return payload;
}

document.addEventListener("DOMContentLoaded", () => {
  const ui = {
    connectButton: document.getElementById("btn-connect"),
    disconnectButton: document.getElementById("btn-disconnect"),
    walletStatus: document.getElementById("ui-wallet-status"),
    aliasLabel: document.getElementById("ui-alias"),
    address: document.getElementById("ui-address"),
    inputAlias: document.getElementById("input-alias"),
    checkEligibilityButton: document.getElementById("btn-check-eligibility"),
    eligibility: document.getElementById("ui-eligibility"),
    proposalTitle: document.getElementById("proposal-title"),
    proposalStatus: document.getElementById("proposal-status"),
    proposalSummary: document.getElementById("proposal-summary"),
    proposalStart: document.getElementById("proposal-start"),
    proposalEnd: document.getElementById("proposal-end"),
    choicesList: document.getElementById("choices-list"),
    voteButton: document.getElementById("btn-vote"),
    voteStatus: document.getElementById("ui-vote-status"),
    messageDetails: document.getElementById("message-details"),
    canonicalMessage: document.getElementById("canonical-message"),
    auditLinks: document.getElementById("audit-links"),
    refreshResultsButton: document.getElementById("btn-refresh-results"),
    resultsList: document.getElementById("results-list"),
    effectiveVotes: document.getElementById("effective-votes"),
    supersededVotes: document.getElementById("superseded-votes"),
    invalidVotes: document.getElementById("invalid-votes"),
  };

  if (Object.values(ui).some((element) => !element)) {
    console.warn("[RMZ Assembly] Missing expected assembly UI elements.");
    return;
  }

  let provider;
  const modal = new WalletConnectModal({ projectId: PROJECT_ID });
  let currentAddress = "";
  let currentAlias = "";
  let proposal = null;
  let results = null;
  let eligibility = null;
  let selectedChoiceId = "";
  let preparedVote = null;
  let isBusy = false;

  const setStatus = (message, tone = "neutral") => {
    const toneClasses = {
      neutral: "border-white/10 bg-white/[0.03] text-gray-300",
      success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
      warning: "border-yellow-200/30 bg-yellow-200/10 text-yellow-100",
      error: "border-red-300/30 bg-red-400/10 text-red-100",
    };

    ui.voteStatus.className = `mt-4 rounded-md border p-4 text-sm leading-7 ${toneClasses[tone]}`;
    ui.voteStatus.textContent = message;
  };

  const setEligibilityMessage = (content, tone = "neutral") => {
    const toneClasses = {
      neutral: "border-white/10 bg-white/[0.03] text-gray-300",
      success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
      warning: "border-yellow-200/30 bg-yellow-200/10 text-yellow-100",
      error: "border-red-300/30 bg-red-400/10 text-red-100",
    };

    ui.eligibility.className = `mt-4 rounded-md border p-4 text-sm leading-7 ${toneClasses[tone]}`;
    ui.eligibility.replaceChildren();

    if (typeof content === "string") {
      ui.eligibility.textContent = content;
      return;
    }

    ui.eligibility.append(content);
  };

  const resetVotePreparation = () => {
    preparedVote = null;
    ui.messageDetails.classList.add("hidden");
    ui.messageDetails.removeAttribute("open");
    ui.canonicalMessage.textContent = "";
    ui.auditLinks.classList.add("hidden");
    ui.auditLinks.replaceChildren();
  };

  const renderVotingEnabledState = () => {
    const open = isProposalOpen(proposal);
    const canVote =
      open &&
      Boolean(currentAddress) &&
      Boolean(eligibility?.eligible) &&
      Boolean(selectedChoiceId) &&
      !isBusy;

    ui.voteButton.disabled = !canVote;

    if (!open) {
      ui.voteButton.textContent = "Propuesta cerrada";
      return;
    }

    if (isBusy) {
      ui.voteButton.textContent = "Procesando...";
      return;
    }

    ui.voteButton.textContent = "Preparar voto";
  };

  const setWalletConnected = (address) => {
    currentAddress = address;
    ui.walletStatus.textContent = "Conectada";
    ui.walletStatus.className =
      "space-mono rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200";
    ui.aliasLabel.textContent = "Alias pendiente";
    ui.address.textContent = address;
    ui.connectButton.disabled = true;
    ui.disconnectButton.disabled = false;
    ui.inputAlias.disabled = false;
    ui.checkEligibilityButton.disabled = false;
    setEligibilityMessage("Wallet conectada. Verifica tu alias .xec.");
    resetVotePreparation();
    renderVotingEnabledState();
  };

  const setWalletDisconnected = () => {
    currentAddress = "";
    currentAlias = "";
    eligibility = null;
    selectedChoiceId = "";
    preparedVote = null;
    ui.walletStatus.textContent = "Desconectada";
    ui.walletStatus.className =
      "space-mono rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400";
    ui.aliasLabel.textContent = "Alias pendiente";
    ui.address.textContent = "ecash:...";
    ui.connectButton.disabled = false;
    ui.connectButton.textContent = "Conectar Tonalli Wallet";
    ui.disconnectButton.disabled = true;
    ui.inputAlias.disabled = true;
    ui.inputAlias.value = "";
    ui.checkEligibilityButton.disabled = true;
    ui.checkEligibilityButton.textContent = "Verificar";
    setEligibilityMessage(
      "Conecta Tonalli Wallet para verificar elegibilidad.",
    );
    resetVotePreparation();
    renderVotingEnabledState();
  };

  const renderProposal = () => {
    if (!proposal) return;

    ui.proposalTitle.textContent = proposal.title ?? PROPOSAL_ID;
    ui.proposalSummary.textContent = proposal.summary ?? "";
    ui.proposalStart.textContent = formatDate(proposal.startsAt);
    ui.proposalEnd.textContent = formatDate(proposal.endsAt);
    ui.proposalStatus.textContent = proposal.status ?? PROPOSAL_ID;
    ui.proposalStatus.className = isProposalOpen(proposal)
      ? "space-mono rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200"
      : "space-mono rounded-full border border-yellow-200/30 bg-yellow-200/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-yellow-200";

    ui.choicesList.replaceChildren();

    for (const choice of proposal.choices ?? []) {
      const label = document.createElement("label");
      label.className =
        "flex cursor-pointer items-center justify-between gap-4 rounded-md border border-white/10 bg-black/30 px-4 py-3 transition hover:border-emerald-300/40";

      const text = document.createElement("span");
      text.className = "font-semibold text-white";
      text.textContent = choice.label ?? choice.id;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "assembly-choice";
      input.value = choice.id;
      input.className = "h-5 w-5 accent-emerald-300";
      input.addEventListener("change", () => {
        selectedChoiceId = choice.id;
        resetVotePreparation();
        renderVotingEnabledState();
        setStatus("Voto seleccionado. Prepara la firma con Tonalli Wallet.");
      });

      label.append(text, input);
      ui.choicesList.append(label);
    }

    if (!isProposalOpen(proposal)) {
      setStatus("La propuesta no está abierta para votar.", "warning");
    }

    renderVotingEnabledState();
  };

  const renderResults = () => {
    const totals = results?.totals ?? {};
    const choices =
      proposal?.choices ?? Object.keys(totals).map((id) => ({ id }));
    ui.resultsList.replaceChildren();

    for (const choice of choices) {
      const id = choice.id;
      const card = document.createElement("div");
      card.className =
        "rounded-md border border-emerald-300/20 bg-black/35 p-5";

      const label = document.createElement("span");
      label.className = "block text-sm font-semibold text-gray-300";
      label.textContent = choice.label ?? id;

      const total = document.createElement("span");
      total.className = "space-mono mt-2 block text-3xl text-emerald-200";
      total.textContent = String(totals[id] ?? 0);

      const key = document.createElement("span");
      key.className = "space-mono mt-2 block text-[10px] text-gray-500";
      key.textContent = id;

      card.append(label, total, key);
      ui.resultsList.append(card);
    }

    ui.effectiveVotes.textContent = String(results?.effectiveVotes ?? 0);
    ui.supersededVotes.textContent = String(results?.supersededVotes ?? 0);
    ui.invalidVotes.textContent = String(results?.invalidVotes ?? 0);
  };

  const renderEligibility = (payload) => {
    eligibility = payload;
    resetVotePreparation();

    const aliasRecord = payload?.aliasRecord ?? payload?.alias ?? null;
    const aliasStatus =
      aliasRecord?.status ?? aliasRecord?.aliasStatus ?? payload?.aliasStatus;

    if (payload?.eligible && aliasStatus && aliasStatus !== "confirmed") {
      eligibility = {
        ...payload,
        eligible: false,
        reason:
          "Alias no confirmado. La asamblea no acepta aliases pendientes.",
      };
    }

    if (!eligibility?.eligible) {
      const reason =
        eligibility?.reason ?? eligibility?.error ?? "No elegible para votar.";
      ui.aliasLabel.textContent = currentAlias || "Alias no elegible";
      setEligibilityMessage(reason, "error");
      setStatus("Alias no elegible. La votación sigue deshabilitada.", "error");
      renderVotingEnabledState();
      return;
    }

    const wrapper = document.createElement("div");

    const title = document.createElement("p");
    title.className = "font-bold text-emerald-100";
    title.textContent = "Eligible to vote";
    wrapper.append(title);

    const facts = [
      ["alias", currentAlias],
      ["txid", aliasRecord?.txid],
      ["blockheight", aliasRecord?.blockheight ?? aliasRecord?.blockHeight],
      ["RMZ atoms", payload?.rmzAtoms ?? payload?.rmz?.atoms],
    ];

    for (const [label, value] of facts) {
      if (value === undefined || value === null || value === "") continue;
      const row = document.createElement("p");
      row.className = "space-mono mt-1 break-all text-xs text-emerald-100";
      row.textContent = `${label}: ${value}`;
      wrapper.append(row);
    }

    ui.aliasLabel.textContent = currentAlias;
    setEligibilityMessage(wrapper, "success");
    setStatus("Alias elegible. Selecciona una opción para votar.", "success");
    renderVotingEnabledState();
  };

  const renderAuditLinks = () => {
    const links = [
      [`${API_BASE}/proposals/${PROPOSAL_ID}/results`, "Resultados públicos"],
      [`${API_BASE}/proposals/${PROPOSAL_ID}/votes`, "Votos públicos"],
      [`${API_BASE}/proposals/${PROPOSAL_ID}/audit.jsonl`, "Audit JSONL"],
    ];

    ui.auditLinks.replaceChildren();

    for (const [href, label] of links) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className =
        "space-mono break-all rounded-md border border-white/10 bg-black/35 p-3 text-xs text-emerald-200 transition hover:border-emerald-300/50";
      link.textContent = `${label}: ${href}`;
      ui.auditLinks.append(link);
    }

    ui.auditLinks.classList.remove("hidden");
  };

  const getPrimaryWalletAccount = async (session) => {
    try {
      const walletAddresses = await provider.request({
        method: "ecash_getAddresses",
        params: {},
      });
      return (
        extractFirstWalletAddress(walletAddresses) ??
        getFirstEcashAccount(session)
      );
    } catch (error) {
      console.debug("[RMZ Assembly] ecash_getAddresses failed.", error);
      return getFirstEcashAccount(session);
    }
  };

  const handleAccount = async (rawAccount) => {
    const address = normalizeEcashAddress(normalizeEcashAccount(rawAccount));

    if (!isValidEcashAddress(address)) {
      throw new Error(`Invalid eCash address from wallet: ${address}`);
    }

    setWalletConnected(address);
  };

  const restoreWalletSession = async () => {
    if (!provider?.session) return;

    try {
      const rawAccount = await getPrimaryWalletAccount(provider.session);
      if (rawAccount) await handleAccount(rawAccount);
    } catch (error) {
      console.warn(
        "[RMZ Assembly] Unable to restore WalletConnect session:",
        error,
      );
    }
  };

  const initializeProvider = async () => {
    provider = await UniversalProvider.init({
      projectId: PROJECT_ID,
      metadata: WALLETCONNECT_METADATA,
    });

    provider.on("display_uri", (uri) => {
      modal.openModal({ uri });
    });

    provider.on("session_delete", setWalletDisconnected);
    provider.on("disconnect", setWalletDisconnected);
    provider.on("accountsChanged", async () => {
      if (!provider?.session) return;
      try {
        const rawAccount = await getPrimaryWalletAccount(provider.session);
        if (rawAccount) await handleAccount(rawAccount);
      } catch (error) {
        console.error("[RMZ Assembly] Unable to refresh account.", error);
        setWalletDisconnected();
      }
    });

    await restoreWalletSession();
  };

  const loadProposal = async () => {
    try {
      const [proposalPayload, resultsPayload] = await Promise.all([
        apiRequest(`/proposals/${PROPOSAL_ID}`),
        apiRequest(`/proposals/${PROPOSAL_ID}/results`),
      ]);

      proposal = proposalPayload;
      results = resultsPayload;
      renderProposal();
      renderResults();
    } catch (error) {
      console.error("[RMZ Assembly] Proposal load failed.", error);
      ui.proposalTitle.textContent = "No se pudo cargar la propuesta";
      ui.proposalSummary.textContent = getBackendError(
        error,
        "Error al consultar la asamblea.",
      );
      setStatus("No se pudo cargar la propuesta.", "error");
    }
  };

  const refreshResults = async () => {
    try {
      ui.refreshResultsButton.disabled = true;
      results = await apiRequest(`/proposals/${PROPOSAL_ID}/results`);
      renderResults();
    } catch (error) {
      console.error("[RMZ Assembly] Results refresh failed.", error);
      setStatus(
        getBackendError(error, "No se pudieron actualizar resultados."),
        "error",
      );
    } finally {
      ui.refreshResultsButton.disabled = false;
    }
  };

  const checkEligibility = async () => {
    if (!currentAddress) {
      setEligibilityMessage("Conecta Tonalli Wallet primero.", "warning");
      return;
    }

    currentAlias = normalizeAlias(ui.inputAlias.value);
    if (!currentAlias) {
      setEligibilityMessage("Escribe un alias .xec.", "warning");
      return;
    }

    ui.inputAlias.value = currentAlias;
    ui.checkEligibilityButton.disabled = true;
    ui.checkEligibilityButton.textContent = "Verificando...";
    eligibility = null;
    renderVotingEnabledState();

    try {
      const payload = await apiRequest("/eligibility/check", {
        method: "POST",
        body: JSON.stringify({
          alias: currentAlias,
          wallet: currentAddress,
        }),
      });
      renderEligibility(payload);
    } catch (error) {
      console.error("[RMZ Assembly] Eligibility check failed.", error);
      setEligibilityMessage(
        getBackendError(error, "No se pudo verificar elegibilidad."),
        "error",
      );
      setStatus(
        "Error de elegibilidad. La votación sigue deshabilitada.",
        "error",
      );
    } finally {
      ui.checkEligibilityButton.disabled = false;
      ui.checkEligibilityButton.textContent = "Verificar";
      renderVotingEnabledState();
    }
  };

  const ensureFreshEligibility = async () => {
    if (!currentAlias || !currentAddress) {
      throw new Error("Verifica alias y wallet antes de votar.");
    }

    const payload = await apiRequest("/eligibility/check", {
      method: "POST",
      body: JSON.stringify({
        alias: currentAlias,
        wallet: currentAddress,
      }),
    });
    renderEligibility(payload);

    if (!eligibility?.eligible) {
      throw new Error(eligibility?.reason ?? "Alias no elegible.");
    }
  };

  const signMessage = async (message, challengeId) => {
    const response = await provider.request({
      method: "ecash_signMessage",
      params: {
        message,
        challengeId,
        address: currentAddress,
      },
    });

    const result = response?.result ?? response;
    const signature =
      typeof result === "string"
        ? result
        : (result?.signature ?? result?.sig ?? result?.base64Signature);
    const publicKey = result?.publicKey ?? result?.publicKeyHex;

    if (!publicKey) {
      throw new Error(
        "Tonalli Wallet must return publicKey for Assembly voting.",
      );
    }

    return {
      address: result?.address,
      publicKey,
      signature,
      challengeId: result?.challengeId ?? challengeId,
    };
  };

  const prepareAndSubmitVote = async () => {
    if (!isProposalOpen(proposal)) {
      setStatus("La propuesta no está abierta para votar.", "warning");
      return;
    }

    if (!selectedChoiceId) {
      setStatus("Selecciona una opción antes de votar.", "warning");
      return;
    }

    isBusy = true;
    resetVotePreparation();
    renderVotingEnabledState();

    try {
      setStatus("preparing vote: verificando elegibilidad en backend.");
      await ensureFreshEligibility();

      setStatus("preparing vote: solicitando mensaje canónico al backend.");
      preparedVote = await apiRequest("/votes/prepare", {
        method: "POST",
        body: JSON.stringify({
          proposalId: PROPOSAL_ID,
          alias: currentAlias,
          wallet: currentAddress,
          choiceId: selectedChoiceId,
        }),
      });

      ui.canonicalMessage.textContent = preparedVote.message;
      ui.messageDetails.classList.remove("hidden");
      ui.messageDetails.setAttribute("open", "");

      setStatus(
        "awaiting wallet signature: confirma la firma en Tonalli Wallet.",
      );
      const signed = await signMessage(
        preparedVote.message,
        preparedVote.challengeId,
      );

      if (!signed.signature) {
        throw new Error("Tonalli Wallet no devolvió signature.");
      }

      setStatus("submitting vote: enviando firma al backend.");
      const submission = await apiRequest("/votes", {
        method: "POST",
        body: JSON.stringify({
          proposalId: PROPOSAL_ID,
          voteId: preparedVote.voteId,
          challengeId: signed.challengeId,
          alias: currentAlias,
          wallet: currentAddress,
          publicKey: signed.publicKey,
          signature: signed.signature,
          message: preparedVote.message,
        }),
      });

      if (submission?.accepted !== true) {
        throw new Error(
          submission?.error ??
            submission?.reason ??
            "Voto rechazado por backend.",
        );
      }

      setStatus(
        "vote accepted: voto aceptado y publicado para auditoría.",
        "success",
      );
      renderAuditLinks();
      await refreshResults();
    } catch (error) {
      console.error("[RMZ Assembly] Vote flow failed.", error);
      setStatus(getBackendError(error, "No se pudo enviar el voto."), "error");
    } finally {
      isBusy = false;
      renderVotingEnabledState();
    }
  };

  ui.connectButton.addEventListener("click", async () => {
    ui.connectButton.disabled = true;
    ui.connectButton.textContent = "Conectando...";

    try {
      if (!provider) await initializeProvider();

      const session = await provider.connect({ namespaces: ECASH_NAMESPACE });
      modal.closeModal();

      if (!session) throw new Error("WalletConnect did not return a session.");

      const rawAccount = await getPrimaryWalletAccount(session);
      if (!rawAccount) {
        throw new Error("WalletConnect did not return an eCash account.");
      }

      await handleAccount(rawAccount);
    } catch (error) {
      modal.closeModal();
      console.error("[RMZ Assembly] WalletConnect failed.", error);
      setStatus(
        "No se pudo conectar Tonalli Wallet. Intenta de nuevo.",
        "error",
      );
      setWalletDisconnected();
    }
  });

  ui.disconnectButton.addEventListener("click", async () => {
    try {
      if (provider?.session) await provider.disconnect();
    } catch (error) {
      console.error("[RMZ Assembly] Disconnect failed.", error);
    } finally {
      setWalletDisconnected();
    }
  });

  ui.checkEligibilityButton.addEventListener("click", checkEligibility);
  ui.inputAlias.addEventListener("keydown", (event) => {
    if (event.key === "Enter") checkEligibility();
  });
  ui.voteButton.addEventListener("click", prepareAndSubmitVote);
  ui.refreshResultsButton.addEventListener("click", refreshResults);

  setWalletDisconnected();
  loadProposal();
  initializeProvider().catch((error) => {
    console.error("[RMZ Assembly] WalletConnect init failed.", error);
  });
});
