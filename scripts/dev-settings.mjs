export function developmentSettings(
  authOrigin = process.env.AUTH_PREVIEW_API_ORIGIN,
) {
  if (authOrigin) {
    const url = new URL(authOrigin);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "The development auth proxy must be a loopback HTTP origin.",
      );
    }
  }
  return { authOrigin, host: "127.0.0.1" };
}
