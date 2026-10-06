export const metadata = {
  title: "Approval Desk",
  description: "A refund agent for an invented online shop.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
