import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayFlow | UK Payroll Workspace",
  description: "A modern payroll workspace for employers, employees, HMRC, RTI, CIS and pensions.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "PayFlow | UK payroll, under control.",
    description: "Payroll, HMRC, RTI and pensions in one modern workspace.",
    images: [{ url: "/og.png", width: 1736, height: 906, alt: "PayFlow UK payroll workspace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PayFlow | UK payroll, under control.",
    description: "Payroll, HMRC, RTI and pensions in one modern workspace.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
