import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./ux.css";

export const metadata: Metadata = {
  title: {
    default: "SupportAI",
    template: "%s · SupportAI",
  },
  description: "AI customer support, knowledge management and agent operations.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
