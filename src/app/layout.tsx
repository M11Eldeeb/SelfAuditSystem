import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ScrollActivity } from "@/components/scroll-activity";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MG Warranty Management",
  description: "Monthly branch self-audit for warranty claims",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ScrollActivity />
        {children}
      </body>
    </html>
  );
}
