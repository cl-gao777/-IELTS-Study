import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const route=vi.hoisted(()=>({path:"/"}));
vi.mock("next/navigation",()=>({usePathname:()=>route.path}));
vi.mock("./study-heartbeat",()=>({StudyHeartbeat:()=>null}));
vi.mock("./vocabulary-capture",()=>({VocabularyCapture:()=>null}));
import { AppShell } from "./app-shell";
describe("top navigation destinations",()=>{
  it("exposes all existing learning and utility destinations without a sidebar",()=>{
    route.path="/";
    const html=renderToStaticMarkup(<AppShell theme="light"><p>Learning content</p></AppShell>);
    for(const href of ["/","/practice/reading","/practice/listening","/vocabulary","/morphology","/writing","/review","/materials","/analytics","/coach","/mock-exam","/settings"])expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain("<aside");expect(html).toContain('aria-label="更多页面"');expect(html).toContain('aria-label="打开导航菜单"');
  });
  it("marks a nested page in More and in the drawer",()=>{
    route.path="/materials/local-file";
    const html=renderToStaticMarkup(<AppShell theme="dark"><p>Learning content</p></AppShell>);
    expect(html.match(/aria-current="page"/g)).toHaveLength(2);
    const links=html.match(/<a\b[^>]*>/g) ?? [];
    expect(links.some(link=>link.includes('href="/materials"') && link.includes('aria-current="page"'))).toBe(true);
    expect(html).toContain('aria-label="切换浅色外观"');
  });
});
