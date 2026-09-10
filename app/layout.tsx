import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wearly | 내 사진으로 미리 입어보는 AI 옷장',
  description:
    '상품 URL을 내 옷장에 저장하고 전신사진에 실제 옷을 입혀보며 날씨와 장소별 코디를 비교하는 AI 가상 피팅 서비스',
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
