import workspaceHtml from '../web/connected.html?raw';
import { requireChatGPTUser, chatGPTSignOutPath } from './chatgpt-auth';
import Script from 'next/script';

export const dynamic = 'force-dynamic';
const workspaceBody = workspaceHtml.split('<body>')[1].split('<script')[0].split('</body>')[0];

export default async function Home() {
  await requireChatGPTUser('/');
  return <>
    <div dangerouslySetInnerHTML={{ __html: workspaceBody }} />
    <footer className="account-footer"><a href={chatGPTSignOutPath('/')} target="_top">로그아웃</a></footer>
    <Script type="module" src="/web/connected.js?v=pack-print-1" strategy="afterInteractive" />
  </>;
}
