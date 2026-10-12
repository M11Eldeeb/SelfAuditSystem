import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ScrollActivity } from "@/components/scroll-activity";
import { THEME_INIT_SCRIPT } from "@/components/theme";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Warranty Management Portal",
  description: "Monthly branch self-audit for warranty claims",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint so dark mode never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ScrollActivity />
        {children}
      </body>
    </html>
  );
}
