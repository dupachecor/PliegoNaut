import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import crypto from "node:crypto";

const ADMIN_EMAIL = process.env.NEXTAUTH_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.NEXTAUTH_ADMIN_PASSWORD;

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Correo Electrónico", type: "email", placeholder: "admin@pliegonaut.com" },
        password: { label: "Contraseña", type: "password" }
      },
      async authorize(credentials) {
        if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
          return null;
        }
        const emailOk = safeEqual(credentials?.email ?? "", ADMIN_EMAIL);
        const passwordOk = safeEqual(credentials?.password ?? "", ADMIN_PASSWORD);
        if (emailOk && passwordOk) {
          return { id: "1", name: "Admin", email: ADMIN_EMAIL };
        }
        return null;
      }
    })
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: "jwt",
  },
};
