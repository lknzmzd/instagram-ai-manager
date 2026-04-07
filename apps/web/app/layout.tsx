import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Instagram AI Manager",
  description: "AI → Canva → Instagram system"
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}