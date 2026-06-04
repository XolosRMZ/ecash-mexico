import UniversalProvider from "@walletconnect/universal-provider";
import { WalletConnectModal } from "@walletconnect/modal";
import { ChronikClient } from "chronik-client";
import {
  getRMZAccessStatus,
  isValidEcashAddress,
  normalizeEcashAddress,
  resolveAlias,
} from "@xolosarmy/tonalli-core";

const PROJECT_ID = "d8772b58056b6812d57c181501dd854c";
const CHRONIK_URL = "https://chronik.xolosarmy.xyz";
const ECASH_CHAIN = "ecash:1";

const WALLETCONNECT_METADATA = {
  name: "Identidad RMZ",
  description: "Dashboard de identidad cultural de eCash México",
  url: "https://ecash.mx/identidad/",
  icons: ["https://ecash.mx/favicon.svg"],
};

const ECASH_NAMESPACE = {
  ecash: {
    chains: [ECASH_CHAIN],
    methods: [
      "ecash_getAddresses",
      "ecash_signMessage",
      "ecash_signAndBroadcastTransaction",
      "ecash_signAndBroadcast",
    ],
    events: ["accountsChanged", "chainChanged"],
  },
};

class ChronikAdapter {
  constructor(chronikUrl) {
    this.chronik = new ChronikClient([chronikUrl]);
  }

  async getTokenBalance(address, tokenId) {
    const result = await this.chronik.address(address).utxos();
    const utxos = this.extractUtxos(result);
    let totalAmount = 0n;

    for (const utxo of utxos) {
      const utxoTokenId = this.readTokenId(utxo);
      if (utxoTokenId !== tokenId) continue;

      const amount = this.readTokenAmount(utxo);
      if (amount === null) continue;

      totalAmount += amount;
    }

    if (totalAmount === 0n) return null;
    return { tokenId, amount: totalAmount.toString() };
  }

  extractUtxos(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.scriptUtxos)) {
      return result.scriptUtxos.flatMap(
        (scriptUtxo) => scriptUtxo?.utxos ?? [],
      );
    }
    if (Array.isArray(result?.utxos)) return result.utxos;
    return [];
  }

  readTokenId(utxo) {
    return (
      utxo?.token?.tokenId ??
      utxo?.slpMeta?.tokenId ??
      utxo?.slpToken?.tokenId ??
      null
    );
  }

  readTokenAmount(utxo) {
    const amount =
      utxo?.token?.atoms ?? utxo?.token?.amount ?? utxo?.slpToken?.amount;

    if (amount === undefined || amount === null) return null;

    try {
      return BigInt(amount.toString());
    } catch {
      return null;
    }
  }
}

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
  return null;
}

function normalizeAddressForCompare(address) {
  return String(address || "")
    .trim()
    .toLowerCase();
}

document.addEventListener("DOMContentLoaded", () => {
  console.debug("[RMZ Identity] Browser polyfills:", {
    hasBuffer: typeof globalThis.Buffer !== "undefined",
    hasGlobal: typeof globalThis.global !== "undefined",
    hasProcess: typeof globalThis.process !== "undefined",
  });

  const ui = {
    connectButton: document.getElementById("btn-connect"),
    disconnectButton: document.getElementById("btn-disconnect"),
    disconnectedState: document.getElementById("state-disconnected"),
    connectedState: document.getElementById("state-connected"),
    alias: document.getElementById("ui-alias"),
    address: document.getElementById("ui-address"),
    rmzStatus: document.getElementById("ui-rmz-status"),
    telegramStatus: document.getElementById("ui-telegram-status"),
    faucetStatus: document.getElementById("ui-faucet-status"),
    votingStatus: document.getElementById("ui-voting-status"),
  };

  const aliasSetupSection = document.getElementById("alias-setup-section");
  const inputAlias = document.getElementById("input-alias");
  const btnVerifyAlias = document.getElementById("btn-verify-alias");
  const aliasErrorMsg = document.getElementById("alias-error-msg");
  const aliasSuccessMsg = document.getElementById("alias-success-msg");

  if (
    !ui.connectButton ||
    !ui.disconnectButton ||
    !ui.disconnectedState ||
    !ui.connectedState ||
    !ui.alias ||
    !ui.address ||
    !ui.rmzStatus ||
    !ui.telegramStatus ||
    !ui.faucetStatus ||
    !ui.votingStatus ||
    !aliasSetupSection ||
    !inputAlias ||
    !btnVerifyAlias ||
    !aliasErrorMsg ||
    !aliasSuccessMsg
  ) {
    console.warn("[RMZ Identity] Missing expected identity UI elements.");
    return;
  }

  let provider;
  const modal = new WalletConnectModal({ projectId: PROJECT_ID });
  const adapter = new ChronikAdapter(CHRONIK_URL);
  let currentConnectedAddress = "";

  const setConnectLoading = (isLoading) => {
    ui.connectButton.disabled = isLoading;
    ui.connectButton.textContent = isLoading
      ? "Conectando..."
      : "Conectar Tonalli Wallet";
  };

  const showDisconnected = () => {
    ui.connectedState.classList.add("hidden");
    ui.disconnectedState.classList.remove("hidden");
    ui.disconnectedState.classList.add("block");
    ui.alias.textContent = "Wallet desconectada";
    ui.address.textContent = "ecash:...";
    ui.rmzStatus.textContent = "No verificado";
    ui.telegramStatus.textContent = "Requiere RMZ";
    ui.faucetStatus.textContent = "Limitada";
    ui.votingStatus.textContent = "Próximamente";
    currentConnectedAddress = "";
    inputAlias.value = "";
    aliasErrorMsg.textContent = "";
    aliasErrorMsg.classList.add("hidden");
    aliasSuccessMsg.textContent = "";
    aliasSuccessMsg.classList.add("hidden");
    aliasSetupSection.classList.add("hidden");
    inputAlias.disabled = false;
    btnVerifyAlias.disabled = false;
    btnVerifyAlias.textContent = "Verificar";
    setConnectLoading(false);
  };

  const showConnected = () => {
    ui.disconnectedState.classList.add("hidden");
    ui.disconnectedState.classList.remove("block");
    ui.connectedState.classList.remove("hidden");
  };

  const clearAliasMessages = () => {
    aliasErrorMsg.textContent = "";
    aliasErrorMsg.classList.add("hidden");
    aliasSuccessMsg.textContent = "";
    aliasSuccessMsg.classList.add("hidden");
  };

  const showAliasError = (message) => {
    aliasErrorMsg.textContent = message;
    aliasErrorMsg.classList.remove("hidden");
    aliasSuccessMsg.textContent = "";
    aliasSuccessMsg.classList.add("hidden");
  };

  const showAliasSuccess = (message) => {
    aliasSuccessMsg.textContent = message;
    aliasSuccessMsg.classList.remove("hidden");
    aliasErrorMsg.textContent = "";
    aliasErrorMsg.classList.add("hidden");
  };

  const resetAliasVerification = () => {
    inputAlias.value = "";
    clearAliasMessages();
    aliasSetupSection.classList.add("hidden");
    inputAlias.disabled = false;
    btnVerifyAlias.disabled = false;
    btnVerifyAlias.textContent = "Verificar";
  };

  const applyHolderStatus = (address, status) => {
    ui.address.textContent = address;
    ui.votingStatus.textContent = "Próximamente";
    aliasSetupSection.classList.add("hidden");

    if (status === "holder") {
      ui.alias.textContent = "Guardián RMZ";
      ui.rmzStatus.textContent = "Guardián RMZ";
      ui.telegramStatus.textContent = "Activo";
      ui.faucetStatus.textContent = "Desbloqueada";
      inputAlias.disabled = false;
      btnVerifyAlias.disabled = false;
      btnVerifyAlias.textContent = "Verificar";
      aliasSetupSection.classList.remove("hidden");
      return;
    }

    if (status === "error") {
      ui.alias.textContent = "Wallet conectada";
      ui.rmzStatus.textContent = "Error de red";
      ui.telegramStatus.textContent = "Requiere RMZ";
      ui.faucetStatus.textContent = "Limitada";
      return;
    }

    ui.alias.textContent = "Wallet conectada";
    ui.rmzStatus.textContent = "No verificado";
    ui.telegramStatus.textContent = "Requiere RMZ";
    ui.faucetStatus.textContent = "Limitada";
  };

  const handleAliasVerification = async () => {
    const aliasValue = inputAlias.value.trim();
    clearAliasMessages();

    if (!aliasValue) {
      showAliasError("Escribe un alias .xec.");
      return;
    }

    btnVerifyAlias.disabled = true;
    btnVerifyAlias.textContent = "Verificando...";

    try {
      const resolution = await resolveAlias(aliasValue);

      if (resolution === null) {
        showAliasError("Alias no registrado en eCash.");
        return;
      }

      if (!resolution?.address) {
        showAliasError("El servidor de alias no devolvió dirección.");
        return;
      }

      const resolvedAddress = normalizeAddressForCompare(resolution.address);
      const connectedAddress = normalizeAddressForCompare(
        currentConnectedAddress,
      );

      if (resolvedAddress !== connectedAddress) {
        showAliasError("Ese alias no pertenece a la wallet conectada.");
        return;
      }

      ui.alias.textContent = resolution.alias;
      showAliasSuccess("Alias verificado. Identidad confirmada.");
      inputAlias.disabled = true;
      btnVerifyAlias.disabled = true;
      btnVerifyAlias.textContent = "Verificado";
      console.debug("[RMZ Identity] Alias verified:", resolution);
    } catch (error) {
      console.error("[RMZ Identity] Alias verification failed.", error);
      showAliasError(
        "No se pudo consultar el servidor de aliases. Intenta de nuevo.",
      );
    } finally {
      if (!inputAlias.disabled) {
        btnVerifyAlias.disabled = false;
        btnVerifyAlias.textContent = "Verificar";
      }
    }
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
      console.debug("[RMZ Identity] ecash_getAddresses failed.", error);
      return getFirstEcashAccount(session);
    }
  };

  const restoreDashboard = async (session) => {
    const rawAccount = await getPrimaryWalletAccount(session);
    const address = normalizeEcashAddress(normalizeEcashAccount(rawAccount));

    console.debug("[RMZ Identity] WalletConnect account:", rawAccount);
    console.debug("[RMZ Identity] Normalized eCash address:", address);
    console.debug(
      "[RMZ Identity] isValidEcashAddress:",
      isValidEcashAddress(address),
    );

    if (!isValidEcashAddress(address)) {
      throw new Error(`Invalid eCash address from wallet: ${address}`);
    }

    showConnected();
    resetAliasVerification();
    ui.address.textContent = address;
    ui.alias.textContent = "Verificando RMZ...";
    ui.rmzStatus.textContent = "Verificando...";
    ui.telegramStatus.textContent = "Verificando...";
    ui.faucetStatus.textContent = "Verificando...";
    ui.votingStatus.textContent = "Próximamente";

    const status = await getRMZAccessStatus(address, adapter);
    currentConnectedAddress = address;
    applyHolderStatus(address, status);
  };

  const initializeProvider = async () => {
    provider = await UniversalProvider.init({
      projectId: PROJECT_ID,
      metadata: WALLETCONNECT_METADATA,
    });

    provider.on("display_uri", (uri) => {
      modal.openModal({ uri });
    });

    provider.on("session_delete", showDisconnected);
    provider.on("disconnect", showDisconnected);
    provider.on("accountsChanged", async () => {
      if (!provider?.session) return;
      try {
        await restoreDashboard(provider.session);
      } catch (error) {
        console.error("[RMZ Identity] Unable to refresh account.", error);
        showDisconnected();
      }
    });

    if (provider.session) {
      try {
        await restoreDashboard(provider.session);
      } catch (error) {
        console.error("[RMZ Identity] Unable to restore session.", error);
        showDisconnected();
      }
    }
  };

  ui.connectButton.addEventListener("click", async () => {
    setConnectLoading(true);

    try {
      if (!provider) await initializeProvider();

      const session = await provider.connect({ namespaces: ECASH_NAMESPACE });
      modal.closeModal();

      if (!session) throw new Error("WalletConnect did not return a session.");

      try {
        await restoreDashboard(session);
      } catch (error) {
        console.error("[RMZ Identity] Invalid wallet address.", error);
        alert("La wallet devolvió una dirección eCash inválida.");
        showDisconnected();
      }
    } catch (error) {
      modal.closeModal();
      console.error("[RMZ Identity] WalletConnect failed.", error);
      alert("No se pudo conectar Tonalli Wallet. Intenta de nuevo.");
      showDisconnected();
    } finally {
      setConnectLoading(false);
    }
  });

  if (btnVerifyAlias) {
    btnVerifyAlias.addEventListener("click", handleAliasVerification);
  }

  inputAlias.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleAliasVerification();
  });

  ui.disconnectButton.addEventListener("click", async () => {
    try {
      if (provider?.session) {
        await provider.disconnect();
      }
    } catch (error) {
      console.error("[RMZ Identity] Disconnect failed.", error);
    } finally {
      showDisconnected();
    }
  });

  initializeProvider().catch((error) => {
    console.error("[RMZ Identity] WalletConnect init failed.", error);
    showDisconnected();
  });
});
