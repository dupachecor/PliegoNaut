import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Correo Electrónico", type: "email", placeholder: "admin@pliegonaut.com" },
        password: { label: "Contraseña", type: "password" }
      },
      async authorize(credentials) {
        if (credentials?.email === "admin@pliegonaut.com" && credentials?.password === "admin") {
          return { id: "1", name: "Admin", email: "admin@pliegonaut.com" };
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
