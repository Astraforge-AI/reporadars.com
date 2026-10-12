import { useEffect, useState } from "react";
import { ArrowRightIcon, LockKeyIcon } from "@phosphor-icons/react";
import { useLocale } from "../i18n.jsx";
import {
  AuthRequestError,
  confirmEmailToken,
  getSession,
  requestEmailLink,
  signOut,
} from "./client.js";

const emailPattern = /^\S+@\S+\.\S+$/;

function messageFor(error, t, isEmailRequest = false) {
  switch (error?.code) {
    case "INVALID_EMAIL":
      return t(
        "Enter a valid email address.",
        "Введите корректный адрес электронной почты.",
      );
    case "RATE_LIMITED":
      return t(
        "Please wait before trying again.",
        "Подождите перед повторной попыткой.",
      );
    case "INVALID_LINK":
      return t(
        "This email link is invalid or has expired. Request a new one.",
        "Эта ссылка из email недействительна или истекла. Запросите новую.",
      );
    case "ALREADY_SIGNED_IN":
      return t("You are already signed in.", "Вы уже вошли.");
    case "FORBIDDEN":
      return t(
        "This sign-in action is not available.",
        "Это действие входа недоступно.",
      );
    case "UNAVAILABLE":
      return isEmailRequest
        ? t(
            "We could not confirm email delivery. Please try again.",
            "Не удалось подтвердить доставку email. Попробуйте ещё раз.",
          )
        : t(
            "The sign-in service is unavailable right now.",
            "Служба входа сейчас недоступна.",
          );
    case "TIMEOUT":
      return isEmailRequest
        ? t(
            "The email request timed out, so we could not confirm delivery. Please try again.",
            "Время ожидания запроса email истекло, поэтому мы не смогли подтвердить доставку. Попробуйте ещё раз.",
          )
        : t(
            "The request timed out. Please try again.",
            "Время ожидания запроса истекло. Попробуйте ещё раз.",
          );
    default:
      return isEmailRequest
        ? t(
            "We could not reach the sign-in service, so we cannot confirm that a message was sent.",
            "Не удалось связаться со службой входа, поэтому мы не можем подтвердить отправку сообщения.",
          )
        : t(
            "We could not reach the sign-in service. Please try again.",
            "Не удалось связаться со службой входа. Попробуйте ещё раз.",
          );
  }
}

function emailTokenFromFragment() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get(
    "email-token",
  );
  if (!token) return null;
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  window.dispatchEvent(new Event("reporadars:navigation"));
  return token;
}

export function EmailAuthPanel() {
  const { locale, t, link } = useLocale();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [user, setUser] = useState(null);
  const [pendingToken, setPendingToken] = useState(null);
  const [notice, setNotice] = useState("");
  const [canRequestNewLink, setCanRequestNewLink] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    setSignup(
      new URLSearchParams(window.location.search).get("mode") === "signup",
    );
    const captureEmailToken = () => {
      const token = emailTokenFromFragment();
      if (!token) return;
      setPendingToken(token);
      setCanRequestNewLink(false);
      setNotice("");
    };
    captureEmailToken();
    window.addEventListener("hashchange", captureEmailToken);
    let active = true;
    getSession()
      .then((session) => {
        if (active && session?.user) setUser(session.user);
      })
      .catch(() => {
        if (active)
          setNotice(
            t(
              "We could not check your sign-in status. You can still request an email link.",
              "Не удалось проверить статус входа. Вы всё равно можете запросить ссылку по email.",
            ),
          );
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
      window.removeEventListener("hashchange", captureEmailToken);
    };
  }, [t]);

  const requestLink = async (event) => {
    event.preventDefault();
    if (busyAction) return;
    if (!emailPattern.test(email.trim())) {
      setNotice(
        t(
          "Enter a valid email address.",
          "Введите корректный адрес электронной почты.",
        ),
      );
      return;
    }
    setBusyAction("request");
    setNotice("");
    try {
      await requestEmailLink(email.trim(), locale === "ru" ? "ru" : "en");
      setNotice(
        signup
          ? t(
              "Check your email for a confirmation link. Your account is created only after you confirm it in this browser.",
              "Проверьте email: ссылка подтверждения создаст аккаунт только после подтверждения в этом браузере.",
            )
          : t(
              "Check your email for a confirmation link. You will sign in only after you confirm it in this browser.",
              "Проверьте email: вход произойдёт только после подтверждения в этом браузере.",
            ),
      );
    } catch (error) {
      setNotice(messageFor(error, t, true));
    } finally {
      setBusyAction("");
    }
  };

  const confirmSignIn = async () => {
    if (!pendingToken || busyAction) return;
    setBusyAction("confirm");
    setNotice("");
    try {
      const result = await confirmEmailToken(pendingToken);
      if (!result?.user?.email) throw new AuthRequestError("UNAVAILABLE");
      setUser(result.user);
      setPendingToken(null);
    } catch (error) {
      setCanRequestNewLink(error?.code === "INVALID_LINK");
      setNotice(messageFor(error, t));
    } finally {
      setBusyAction("");
    }
  };

  const requestNewLink = () => {
    setPendingToken(null);
    setCanRequestNewLink(false);
    setNotice("");
  };

  const logout = async () => {
    if (busyAction) return;
    setBusyAction("signout");
    setNotice("");
    try {
      await signOut();
      setUser(null);
      setNotice(t("Signed out.", "Вы вышли из аккаунта."));
    } catch (error) {
      setNotice(messageFor(error, t));
    } finally {
      setBusyAction("");
    }
  };

  if (pendingToken && !user?.email) {
    return (
      <>
        <h1>
          {t("CONFIRM SIGN-IN", "ПОДТВЕРДИТЕ ВХОД")}
          <b>.</b>
        </h1>
        <p className="login-lede">
          {t(
            "For your safety, confirm this sign-in in the same browser where you requested the email link.",
            "Для безопасности подтвердите вход в том же браузере, где запрашивали ссылку из email.",
          )}
        </p>
        <button
          className="editorial-primary"
          type="button"
          onClick={confirmSignIn}
          disabled={busyAction === "confirm"}
        >
          {busyAction === "confirm"
            ? t("Confirming…", "Подтверждаем…")
            : t("Confirm sign-in", "Подтвердить вход")}
        </button>
        <p id="login-notice" className="editorial-notice" role="status">
          {notice}
        </p>
        {canRequestNewLink && (
          <button
            className="editorial-secondary"
            type="button"
            onClick={requestNewLink}
          >
            {t("Request a new link", "Запросить новую ссылку")}
          </button>
        )}
      </>
    );
  }

  if (user?.email) {
    return (
      <>
        <h1>
          {t("SIGNED IN", "ВЫ ВОШЛИ")}
          <b>.</b>
        </h1>
        <p className="login-lede">{user.email}</p>
        <button
          className="editorial-primary"
          type="button"
          onClick={logout}
          disabled={busyAction === "signout"}
        >
          {busyAction === "signout"
            ? t("Signing out…", "Выходим…")
            : t("Sign out", "Выйти")}
        </button>
        <p id="login-notice" className="editorial-notice" role="status">
          {notice}
        </p>
        <a className="workspace-link" href={link("/account")}>
          {t(
            "Open local workspace (no cloud sync)",
            "Открыть локальное рабочее пространство (без облачной синхронизации)",
          )}{" "}
          <ArrowRightIcon size={20} aria-hidden="true" />
        </a>
      </>
    );
  }

  return (
    <>
      <h1>
        {signup
          ? t("CREATE A RADAR", "СОЗДАТЬ РАДАР")
          : t("SIGN IN TO YOUR RADAR", "ВОЙТИ В РАДАР")}
        <b>.</b>
      </h1>
      <p className="login-lede">
        {signup
          ? t(
              "Enter your email for a confirmation link. An account is created only after you confirm it.",
              "Введите email для ссылки подтверждения. Аккаунт создаётся только после подтверждения.",
            )
          : t(
              "Save, publish, and review skills you trust.",
              "Сохраняйте, публикуйте и проверяйте навыки, которым доверяете.",
            )}
      </p>
      <form onSubmit={requestLink} noValidate aria-busy={checkingSession}>
        <label htmlFor="login-email">
          {t("Email address", "Адрес электронной почты")}
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-describedby="login-notice"
        />
        <button
          className="editorial-primary"
          type="submit"
          disabled={busyAction === "request"}
        >
          {busyAction === "request"
            ? t("Sending…", "Отправляем…")
            : t("Continue with email", "Продолжить с email")}
        </button>
        <button
          className="editorial-secondary"
          type="button"
          onClick={() =>
            setNotice(
              t(
                "GitHub sign-in is not available.",
                "Вход через GitHub недоступен.",
              ),
            )
          }
        >
          {t("Continue with GitHub", "Продолжить через GitHub")}
        </button>
      </form>
      <div className="login-divider" aria-hidden="true">
        <span />
        {t("or", "или")}
        <span />
      </div>
      <p id="login-notice" className="editorial-notice" role="status">
        {notice ||
          (checkingSession
            ? t("Checking sign-in status…", "Проверяем статус входа…")
            : "")}
      </p>
      <p className="login-safety">
        <LockKeyIcon size={33} weight="thin" aria-hidden="true" />
        {t(
          "We never install a skill without your explicit command.",
          "Мы никогда не устанавливаем навык без вашей явной команды.",
        )}
      </p>
      <p className="login-switch">
        {signup
          ? t("Already have an account?", "Уже есть аккаунт?")
          : t("New here?", "Впервые здесь?")}{" "}
        <a href={link(signup ? "/login" : "/login?mode=signup")}>
          {signup
            ? t("Sign in", "Войти")
            : t("Create an account", "Создать аккаунт")}
        </a>
      </p>
      <a className="workspace-link" href={link("/account")}>
        {t(
          "Open local workspace (no sign-in or cloud sync)",
          "Открыть локальное рабочее пространство (без входа и облачной синхронизации)",
        )}{" "}
        <ArrowRightIcon size={20} aria-hidden="true" />
      </a>
    </>
  );
}
