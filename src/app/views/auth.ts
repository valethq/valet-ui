import type { AuthStatus } from "../api";
import { el } from "../dom";

export function renderAuth(
  root: HTMLElement,
  status: AuthStatus,
  submit: (values: { token: string; password: string }) => Promise<void>,
): void {
  const error = el("div", { class: "error" });
  const card = el("div", { class: "card" });
  const form = el("form");

  const password = el("input", { type: "password", required: "", autocomplete: "current-password" });
  const button = el("button", { type: "submit", text: status.needsSetup ? "Set password" : "Sign in" });

  if (status.needsSetup) {
    const token = el("input", { type: "text", required: "", autocomplete: "off" });
    form.append(
      el("label", { for: "f-token", text: "Setup token" }),
      token,
      el("label", { for: "f-password", text: "New owner password" }),
      password,
    );
    token.id = "f-token";
    password.id = "f-password";
    password.autocomplete = "new-password";
  } else {
    form.append(el("label", { for: "f-password", text: "Password" }), password);
    password.id = "f-password";
  }
  form.append(button, error);

  card.append(
    el("h1", { text: status.needsSetup ? "Set owner password" : "Sign in" }),
    el("div", {
      class: "sub",
      text: status.needsSetup ? "First boot: paste the one-time setup token from the valet log." : "valet",
    }),
    form,
  );
  root.replaceChildren(el("div", { class: "auth" }, card));

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    button.disabled = true;
    error.textContent = "";
    const tokenInput = form.querySelector<HTMLInputElement>("#f-token");
    submit({ token: tokenInput?.value ?? "", password: password.value }).catch((e: unknown) => {
      button.disabled = false;
      error.textContent = e instanceof Error ? e.message : String(e);
    });
  });
}
