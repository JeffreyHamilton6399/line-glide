import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Line Glide — a Line Rider–style physics sandbox",
  description:
    "Draw lines, build tracks, and watch a little rider sled through your creation in this browser physics sandbox.",
  keywords: ["Line Rider", "physics game", "sandbox", "canvas", "Next.js"],
  authors: [{ name: "Line Glide" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Line Glide",
    description: "A Line Rider–style physics sandbox in your browser.",
    siteName: "Line Glide",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Line Glide",
    description: "A Line Rider–style physics sandbox in your browser.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
