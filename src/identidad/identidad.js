document.addEventListener("DOMContentLoaded", () => {
  const connectButton = document.getElementById("btn-connect");
  const disconnectButton = document.getElementById("btn-disconnect");
  const disconnectedState = document.getElementById("state-disconnected");
  const connectedState = document.getElementById("state-connected");

  if (
    !connectButton ||
    !disconnectButton ||
    !disconnectedState ||
    !connectedState
  ) {
    console.warn("[RMZ Identity] Missing expected identity UI elements.");
    return;
  }

  connectButton.addEventListener("click", () => {
    disconnectedState.classList.add("hidden");
    disconnectedState.classList.remove("block");
    connectedState.classList.remove("hidden");
    console.log(
      "[RMZ Identity] Phase A2 placeholder: connect clicked. WalletConnect arrives in Phase A3.",
    );
  });

  disconnectButton.addEventListener("click", () => {
    connectedState.classList.add("hidden");
    disconnectedState.classList.remove("hidden");
    disconnectedState.classList.add("block");
    console.log("[RMZ Identity] Phase A2 placeholder: disconnect clicked.");
  });
});
