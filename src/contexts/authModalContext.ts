import { createContext } from "react";

export type AuthModalContextValue = {
  openLogin: () => void;
  openRegister: () => void;
  close: () => void;
};

export const AuthModalContext = createContext<AuthModalContextValue | null>(
  null
);
