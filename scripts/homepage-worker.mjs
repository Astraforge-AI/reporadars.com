export const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Only explicitly built application resources are intercepted. All API traffic
// retains its original URL, headers, method and body through the origin fetch.
export function createHomepageWorker(files, originFetch = fetch) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const read = request.method === "GET" || request.method === "HEAD";
      if (!read) return originFetch(request);
      const canonicalPath =
        url.pathname === "/index.html"
          ? "/"
          : url.pathname.replace(/\/$/, "") || "/";
      const appRoute =
        files[canonicalPath]?.type.startsWith("text/html") &&
        !/\/404(?:\.html)?$/.test(canonicalPath);
      if (
        appRoute &&
        (url.hostname === "www.reporadars.com" ||
          (canonicalPath !== url.pathname && url.pathname !== "/index.html"))
      ) {
        url.hostname = "reporadars.com";
        url.pathname = canonicalPath;
        return Response.redirect(url.href, 308);
      }
      const key = url.pathname === "/index.html" ? "/" : url.pathname;
      let missingPage =
        !files[key] &&
        ["/skills/", "/journal/", "/ru/", "/account/", "/login/"].some(
          (prefix) => url.pathname.startsWith(prefix),
        );
      const russian = url.pathname === "/ru" || url.pathname.startsWith("/ru/");
      let file = missingPage
        ? russian
          ? files["/ru/404"]
          : files["/404.html"] || files["/404"]
        : files[key];
      if (!file) {
        if (url.pathname.startsWith("/reporadars-assets/"))
          return new Response("Asset not found", {
            status: 404,
            headers: {
              ...securityHeaders,
              "Content-Type": "text/plain; charset=utf-8",
            },
          });
        const origin = await originFetch(request);
        // Keep existing origin pages, APIs, assets and non-browser responses.
        // Only replace its HTML "not found" document for a browser navigation.
        const protectedPath = /^\/(?:api|v1|deckview-api|health)(?:\/|$)/.test(
          url.pathname,
        );
        const browserPage =
          !protectedPath &&
          !/\.[^/]+$/.test(url.pathname) &&
          (request.headers.get("Accept") || "").includes("text/html");
        if (
          origin.status !== 404 ||
          !browserPage ||
          !(origin.headers.get("Content-Type") || "").includes("text/html")
        )
          return origin;
        file = russian ? files["/ru/404"] : files["/404.html"] || files["/404"];
        if (!file) return origin;
        await origin.body?.cancel();
        missingPage = true;
      }
      const headers = new Headers({
        ...securityHeaders,
        "Content-Type": file.type,
        "Cache-Control": file.cache,
        ETag: file.etag,
        "X-Reporadars-Release": file.release,
      });
      if (file.language) headers.set("Content-Language", file.language);
      if (file.download)
        headers.set(
          "Content-Disposition",
          `attachment; filename="${file.download}"`,
        );
      const status = missingPage || /\/404(?:\.html)?$/.test(key) ? 404 : 200;
      if (
        status === 200 &&
        (request.headers.get("If-None-Match") || "").split(",").some((tag) => {
          // Cloudflare can weaken ETags when it compresses the response.
          // If-None-Match on GET/HEAD uses weak comparison.
          const value = tag.trim();
          return value === "*" || value.replace(/^W\//, "") === file.etag;
        })
      )
        return new Response(null, { status: 304, headers });
      if (request.method === "HEAD")
        return new Response(null, { headers, status });
      const bytes = Uint8Array.from(atob(file.body), (char) =>
        char.charCodeAt(0),
      );
      const body =
        file.encoding === "gzip"
          ? new Blob([bytes])
              .stream()
              .pipeThrough(new DecompressionStream("gzip"))
          : bytes;
      return new Response(body, { headers, status });
    },
  };
}
