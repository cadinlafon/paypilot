/** `firebase-functions/params` stand-in: values come from Worker vars/secrets. */
import { envString } from "../runtime";

export function defineSecret(name: string) {
  return { name, value: () => envString(name) ?? "" };
}
export function defineString(name: string, opts: { default?: string } = {}) {
  return { name, value: () => envString(name) ?? opts.default ?? "" };
}
export function defineBoolean(name: string, opts: { default?: boolean } = {}) {
  return { name, value: () => {
    const v = envString(name);
    return v === undefined ? !!opts.default : v === "true";
  } };
}
