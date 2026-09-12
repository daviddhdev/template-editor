import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorNote } from "../components/ui";
import { BrandLockup } from "../components/Brand";
import { meFn } from "../server/auth";
import { googleAuthUrlFn } from "../server/google";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s.redirect === "string" && s.redirect
      ? { redirect: s.redirect }
      : {},
  beforeLoad: async ({ search }) => {
    const res = await meFn().catch(() => null);
    if (res?.ok && res.data) throw redirect({ to: search.redirect || "/" });
  },
  component: LoginScreen,
});

export const LOGIN_REDIRECT_KEY = "ttg-login-redirect";

function LoginScreen() {
  const { redirect: redirectTo } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ error: string; hint?: string } | null>(
    null,
  );

  async function login() {
    setBusy(true);
    setError(null);
    try {
      sessionStorage.setItem(LOGIN_REDIRECT_KEY, redirectTo || "/");
      const res = await googleAuthUrlFn({
        data: { origin: window.location.origin },
      });
      if (res.ok) window.location.href = res.data.url;
      else {
        setError(res);
        setBusy(false);
      }
    } catch {
      setError({ error: "No se pudo iniciar la entrada con Google." });
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-canvas-soft px-6 py-24">
      <div className="w-full max-w-[452px] rounded-2xl border border-hairline bg-surface px-8 py-10 text-center shadow-e2 sm:px-13">
        <BrandLockup variant="full" className="mx-auto justify-center" />
        <h1 className="text-[32px] font-bold leading-[1.12] tracking-[-1px] text-ink">
          Entra en tu cuenta
        </h1>
        <p className="mt-3.5 text-base leading-normal text-ink-muted">
          Usa la cuenta de Google del trabajo para acceder a tus plantillas,
          datos y documentos en Talos.
        </p>
        <p className="mt-3 text-sm font-semibold text-primary">Tus datos, hechos documento.</p>

        <button
          onClick={login}
          disabled={busy}
          className="mt-8 h-13 w-full rounded-full bg-primary text-base font-semibold text-white shadow-e1 outline-none transition hover:bg-primary-active focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-primary/40"
        >
          {busy ? "Abriendo Google…" : "Continuar con Google"}
        </button>

        <p className="mt-[22px] text-[13.5px] leading-[1.55] text-ink-faint">
          Al entrar autorizas el acceso a tu Google Drive para leer plantillas y
          generar documentos. Nunca modificamos archivos sin tu permiso.
        </p>

        {error ? (
          <div className="mt-4 text-left">
            <ErrorNote title={error.error} hint={error.hint} />
          </div>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-[34px] text-center text-sm leading-normal text-ink-faint">
        ¿Problemas para entrar?{" "}
        <a
          className="text-primary hover:text-primary-active"
          href="mailto:it@mecides.es"
        >
          Escríbenos a soporte
        </a>
        .
      </div>
    </main>
  );
}
