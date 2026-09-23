// Lets Node load src/lib modules directly: resolves extensionless relative imports to their .ts file.
export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
    try { return await next(`${specifier}.ts`, context); } catch {}
  }
  return next(specifier, context);
}
