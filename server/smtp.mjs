import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import tls from "node:tls";
import { createTransport } from "nodemailer";

export function createAbortableTlsSocketProvider({ host, port, signal, connect = tls.connect }) {
  let socket;
  let callback;
  let settled = false;
  const fail = (error) => {
    if (settled || !callback) return;
    settled = true;
    callback(error);
  };
  const destroy = (error = new Error("mail delivery aborted")) => {
    if (!socket) return;
    socket.destroy(error);
    fail(error);
  };
  const abort = () => destroy(new Error("mail delivery aborted"));
  return {
    getSocket(_options, done) {
      callback = done;
      if (signal?.aborted) return abort();
      const connection = { host, port, rejectUnauthorized: true };
      if (!isIP(host)) connection.servername = host;
      socket = connect(connection);
      signal?.addEventListener("abort", abort, { once: true });
      socket.once("error", fail);
      socket.once("secureConnect", () => {
        if (signal?.aborted) return abort();
        if (!settled) {
          settled = true;
          done(null, { connection: socket, secured: true });
        }
      });
    },
    destroy(error) {
      signal?.removeEventListener("abort", abort);
      destroy(error);
    },
  };
}

async function privateJson(pathname) {
  if (!pathname || !pathname.startsWith("/")) throw new Error("MAIL_CONFIG_FILE must be an absolute path");
  const metadata = await stat(pathname);
  if (!metadata.isFile() || metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) {
    throw new Error("MAIL_CONFIG_FILE must be a private file owned by this user");
  }
  try {
    return JSON.parse(await readFile(pathname, "utf8"));
  } catch {
    throw new Error("MAIL_CONFIG_FILE is not valid JSON");
  }
}

export async function createSmtpSender({ configPath }) {
  const config = await privateJson(configPath);
  if (
    typeof config.host !== "string" || !config.host || config.port !== 465 || config.secure !== true
    || config.authMethod !== "LOGIN" || typeof config.user !== "string" || !config.user
    || typeof config.password !== "string" || !config.password || typeof config.from !== "string" || !config.from
  ) throw new Error("MAIL_CONFIG_FILE must configure SMTPS port 465 with LOGIN credentials");

  return async function sendMail({ to, url, locale }, { signal } = {}) {
    const socketProvider = createAbortableTlsSocketProvider({ host: config.host, port: 465, signal });
    const transport = createTransport({
      host: config.host,
      port: 465,
      secure: true,
      requireTLS: true,
      authMethod: "LOGIN",
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 7_000,
      greetingTimeout: 7_000,
      socketTimeout: 7_000,
      tls: { rejectUnauthorized: true },
      logger: false,
      debug: false,
      getSocket: socketProvider.getSocket,
    });
    const close = () => { socketProvider.destroy(new Error("mail delivery aborted")); transport.close(); };
    if (signal?.aborted) throw new Error("mail delivery aborted");
    signal?.addEventListener("abort", close, { once: true });
    const subject = locale === "ru" ? "Ваша ссылка для входа" : "Your sign-in link";
    const text = locale === "ru" ? `Откройте ссылку для входа: ${url}` : `Open this sign-in link: ${url}`;
    try {
      await transport.sendMail({ from: config.from, to, subject, text });
    } finally {
      signal?.removeEventListener("abort", close);
      transport.close();
    }
  };
}
