export function splitLocalePath(input = "/") {
  const pathname = input.split(/[?#]/)[0] || "/";
  const locale =
    pathname === "/ru" || pathname.startsWith("/ru/") ? "ru" : "en";
  const path = locale === "ru" ? pathname.slice(3) || "/" : pathname;
  return { locale, path };
}

export function localeHref(input, locale) {
  if (!input.startsWith("/") || input.startsWith("//")) return input;
  const suffixAt = input.search(/[?#]/);
  const suffix = suffixAt < 0 ? "" : input.slice(suffixAt);
  const { path } = splitLocalePath(input);
  const clean = path.replace(/\/$/, "") || "/";
  return (
    (locale === "ru" ? `/ru${clean === "/" ? "" : clean}` : clean) + suffix
  );
}
