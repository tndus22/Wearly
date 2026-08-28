import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wearly | 공유 한 번으로 완성되는 AI 옷장',
  description:
    '쇼핑몰 상품 URL을 공유하면 구매한 옷을 자동으로 정리하고 날씨와 일정에 맞는 코디를 추천하는 AI 옷장',
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
