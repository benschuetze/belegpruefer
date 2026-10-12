import { createContext, useContext } from "react";

/** Per render, never module state: Vercel serves concurrent requests from one instance. */
const NonceContext = createContext<string | undefined>(undefined);

export const NonceProvider = NonceContext.Provider;

export function useNonce(): string | undefined {
  return useContext(NonceContext);
}
