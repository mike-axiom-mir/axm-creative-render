import { isAbsolute, relative, resolve, sep } from "node:path";

export function pathIsInside(root, target) {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const rel = relative(rootPath, targetPath);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  if (rel === ".." || rel.startsWith(`..${sep}`)) return false;
  return true;
}

export function requirePathInside(root, target, message = "path must remain inside root") {
  if (!pathIsInside(root, target)) throw new Error(message);
  return resolve(target);
}
