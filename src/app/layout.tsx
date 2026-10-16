import type {Metadata} from 'next';
import {AppShell} from '@/components/app-shell';
import {product} from '@/lib/product';
import {getPreferences} from '@/server/preferences';
import '@fontsource-variable/source-sans-3/index.css';
import './globals.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:product.name,description:product.subtitle};
export default function RootLayout({children}:{children:React.ReactNode}){const prefs=getPreferences();return <html lang="zh-CN" data-theme={prefs.theme} suppressHydrationWarning><body><AppShell theme={prefs.theme}>{children}</AppShell></body></html>;}
