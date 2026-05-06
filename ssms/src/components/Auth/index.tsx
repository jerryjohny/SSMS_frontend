import { FormEvent, useEffect, useRef, useState } from "react";

import { useAuth } from "../../authContext";
import { useI18n } from "../../i18nContext";
import "./styles.css";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

export default function Auth() {
  const { copy } = useI18n();
  const { login, loginWithGoogle } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) {
      return;
    }

    let cancelled = false;
    let frameId = 0;

    function tryRenderButton() {
      if (cancelled) {
        return;
      }

      if (!window.google?.accounts?.id) {
        frameId = window.setTimeout(tryRenderButton, 250);
        return;
      }

      googleButtonRef.current!.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response.credential) {
            return;
          }

          try {
            setIsSubmitting(true);
            setErrorMessage("");
            await loginWithGoogle(response.credential);
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : copy.auth.loginError);
          } finally {
            setIsSubmitting(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current!, {
        theme: "outline",
        size: "large",
        width: "100%",
        text: "continue_with",
      });
    }

    tryRenderButton();
    return () => {
      cancelled = true;
      window.clearTimeout(frameId);
    };
  }, [copy.auth.loginError, loginWithGoogle]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      await login(identifier, password);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : copy.auth.loginError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <section className="auth-card surface-panel">
        <div className="auth-card__intro">
          <div className="auth-brand">
            <img src="/ssms-mark.png" alt="SSMS" className="auth-logo" />
            <h1>SSMS</h1>
          </div>
          <p className="eyebrow">{copy.header.eyebrow}</p>
          <p className="auth-copy">{copy.auth.signInDescription}</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="panel-heading compact">
            <div>
              <h2>{copy.auth.signInTitle}</h2>
            </div>
          </div>

          <label className="field-stack">
            <span>{copy.auth.identifierLabel}</span>
            <input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={copy.auth.identifierPlaceholder}
              autoComplete="username"
            />
          </label>

          <label className="field-stack">
            <span>{copy.common.password}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={copy.auth.passwordPlaceholder}
              autoComplete="current-password"
            />
          </label>

          {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? copy.auth.signingIn : copy.auth.signIn}
          </button>

          <div className="auth-divider">
            <span>{copy.auth.continueWithGoogle}</span>
          </div>

          {GOOGLE_CLIENT_ID ? (
            <div ref={googleButtonRef} className="auth-google-slot" />
          ) : (
            <p className="muted-text">{copy.auth.googleUnavailable}</p>
          )}
        </form>
      </section>
    </div>
  );
}
