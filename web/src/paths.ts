function pathPrefix(): string {
  const raw = import.meta.env.BASE_URL ?? "/";
  if (raw === "./" || raw === "") return "";
  return raw.replace(/\/$/, "");
}

/** Browser pathname for an in-app route (`/`, `/city/…`, `/about`). */
export function toAppPath(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const prefix = pathPrefix();
  if (!prefix) return path;
  return path === "/" ? `${prefix}/` : `${prefix}${path}`;
}

/** In-app route from `location.pathname` (strips deploy base when set). */
export function parseAppPath(pathname: string): string {
  const prefix = pathPrefix();
  if (prefix) {
    if (pathname === prefix || pathname === `${prefix}/`) return "/";
    if (pathname.startsWith(`${prefix}/`))
      return pathname.slice(prefix.length) || "/";
  }
  if (pathname.startsWith("/haze-history/"))
    return pathname.slice("/haze-history".length) || "/";
  return pathname || "/";
}