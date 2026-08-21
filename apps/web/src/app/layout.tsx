import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PUBG Camp Platform",
  description: "Fundação técnica da plataforma de campeonatos PUBG PC.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={geist.variable}>
        <a className="skip-link" href="#conteudo-principal">
          Ir para o conteúdo principal
        </a>
        <div id="conteudo-principal" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
