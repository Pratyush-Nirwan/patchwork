import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Patchwork — Multi-Team Engineering Issue Tracker",
  description:
    "Self-hosted, native-first engineering ticketing and Kanban platform with PostgreSQL LISTEN/NOTIFY real-time sync.",
};

const PREPAINT_SCRIPT = `(function(){try{var r=document.documentElement;var t=localStorage.getItem("patchwork_theme");if(t==="dark"||(!t&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)){r.classList.add("dark");}var rm=localStorage.getItem("patchwork_reduce_motion");if(rm==="true"){r.dataset.reduceMotion="true";}if(window.__PATCHWORK_TEST_DISABLE_ANIMATIONS__||${process.env.NEXT_PUBLIC_DISABLE_ANIMATIONS === "1" ? "true" : "false"}){r.dataset.testAnimations="off";}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased selection:bg-[var(--pw-accent)] selection:text-white">
        {children}
      </body>
    </html>
  );
}

