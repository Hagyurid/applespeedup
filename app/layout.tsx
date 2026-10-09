import type { Metadata } from "next";
import "../web/styles.css";
import "../web/connected.css";

export const metadata: Metadata = {
  title: "에쁠가속기 | A+ Accelerator",
  description: "과목별 강의자료, OCR 교정본, 정리본, 문제풀이와 CASIO 프로젝트를 관리하는 학습 작업 공간",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
