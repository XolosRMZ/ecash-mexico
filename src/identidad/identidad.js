import UniversalProvider from "@walletconnect/universal-provider";
import { WalletConnectModal } from "@walletconnect/modal";
import { ChronikClient } from "chronik-client";
import {
  getRMZAccessStatus,
  isValidEcashAddress,
  normalizeEcashAddress,
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
    methods: ["ecash_getAddresses", "ecash_signAndBroadcastTransaction"],
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
  const cleanAccount = String(account ?? "").trim();
  const embeddedAddressMarker = ":ecash:";

  if (cleanAccount.includes(embeddedAddressMarker)) {
    return cleanAccount.slice(cleanAccount.indexOf(embeddedAddressMarker) + 1);
  }

  if (cleanAccount.startsWith("ecash:q")) {
    return cleanAccount;
  }

  const addressMatch = cleanAccount.match(/ecash:[qp][a-z0-9]+$/i);
  if (addressMatch) {
    return addressMatch[0];
  }

  throw new Error(
    `Unable to normalize eCash WalletConnect account: ${cleanAccount}`,
  );
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

document.addEventListener("DOMContentLoaded", () => {
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
    !ui.votingStatus
  ) {
    console.warn("[RMZ Identity] Missing expected identity UI elements.");
    return;
  }

  let provider;
  const modal = new WalletConnectModal({ projectId: PROJECT_ID });
  const adapter = new ChronikAdapter(CHRONIK_URL);

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
    setConnectLoading(false);
  };

  const showConnected = () => {
    ui.disconnectedState.classList.add("hidden");
    ui.disconnectedState.classList.remove("block");
    ui.connectedState.classList.remove("hidden");
  };

  const applyHolderStatus = (address, status) => {
    ui.address.textContent = address;
    ui.votingStatus.textContent = "Próximamente";

    if (status === "holder") {
      ui.alias.textContent = "Guardián RMZ";
      ui.rmzStatus.textContent = "Guardián RMZ";
      ui.telegramStatus.textContent = "Activo";
      ui.faucetStatus.textContent = "Desbloqueada";
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

  const restoreDashboard = async (session) => {
    const account = getFirstEcashAccount(session);
    const address = normalizeEcashAddress(normalizeEcashAccount(account));

    if (!isValidEcashAddress(address)) {
      throw new Error(`Invalid eCash address from wallet: ${address}`);
    }

    showConnected();
    ui.address.textContent = address;
    ui.alias.textContent = "Verificando RMZ...";
    ui.rmzStatus.textContent = "Verificando...";
    ui.telegramStatus.textContent = "Verificando...";
    ui.faucetStatus.textContent = "Verificando...";
    ui.votingStatus.textContent = "Próximamente";

    const status = await getRMZAccessStatus(address, adapter);
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
