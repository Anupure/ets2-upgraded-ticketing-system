import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { randomUUID } from "node:crypto";
import { provisionWallet } from "./booking-service.js";
import { prisma } from "./prisma.js";

function usernameFor(email: string) {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18) || "passenger";
  return `${local}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google" || !user.email) return false;
      const googleProfile = profile as typeof profile & { email_verified?: boolean };
      if (googleProfile.email_verified !== true) return false;

      const email = user.email.toLowerCase();
      const displayName = (user.name || email.split("@")[0] || "Passenger").slice(0, 60);
      const dbUser = await prisma.user.upsert({
        where: { email },
        update: {
          name: user.name?.slice(0, 120),
          image: user.image,
          emailVerified: new Date(),
        },
        create: {
          email,
          name: user.name?.slice(0, 120),
          displayName,
          username: usernameFor(email),
          image: user.image,
          emailVerified: new Date(),
          role: "PASSENGER",
          status: "ACTIVE",
        },
        select: { id: true, status: true },
      });

      if (dbUser.status !== "ACTIVE") return false;
      await provisionWallet(prisma, dbUser.id);
      return true;
    },
    async jwt({ token }) {
      if (!token.email) return token;
      const dbUser = await prisma.user.findUnique({
        where: { email: token.email.toLowerCase() },
        select: { id: true, role: true, status: true },
      });
      if (!dbUser || dbUser.status !== "ACTIVE") {
        delete token.userId;
        delete token.role;
        return token;
      }
      token.userId = dbUser.id;
      token.role = dbUser.role;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
        session.user.role = typeof token.role === "string" ? token.role : "PASSENGER";
      }
      return session;
    },
  },
});
