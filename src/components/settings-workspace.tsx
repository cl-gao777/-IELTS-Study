"use client";

import { useState } from "react";

import ui from "./page-ui.module.css";
import styles from "./settings.module.css";

interface ProviderSummary {
  name: string;
  model: string;
  wireApi: string;
}

export function SettingsWorkspace({
  providers,
  notionConfigured,
  databasePath,
}: {
  providers: ProviderSummary[];
  notionConfigured: boolean;
  databasePath: string;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  async function syncNotion() {
    setSyncing(true);
    setSyncMessage("");
    const response = await fetch("/api/notion/sync", { method: "POST" });
    const payload = (await response.json()) as { message?: string };
    setSyncMessage(payload.message ?? "No response.");
    setSyncing(false);
  }

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Private single-user system</p>
          <h1>Settings & backup</h1>
          <p>
            密钥只在服务器读取，不会发送到浏览器。AI 按顺序尝试 provider，失败后自动切换。
          </p>
        </div>
      </header>

      <div className={styles.settingsGrid}>
        <section className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>AI runtime</p>
              <h2>Provider fallback chain</h2>
            </div>
            <span className={providers.length ? ui.statusPill : ui.pill}>
              {providers.length ? `${providers.length} ready` : "Local fallback"}
            </span>
          </div>
          {providers.length ? (
            <div className={styles.providerList}>
              {providers.map((provider, index) => (
                <div key={`${provider.name}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{provider.name}</strong>
                    <small>
                      {provider.model} · {provider.wireApi}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={ui.notice}>
              未找到可用 provider。系统仍可使用本地确定性反馈；在服务器配置
              AI_PROVIDERS_JSON、单一 AI_* 环境变量或 ~/.codex 后会自动启用。
            </div>
          )}
          <div className={styles.codeHint}>
            <code>AI_PROVIDERS_JSON</code>
            <span>→</span>
            <code>AI_BASE_URL / AI_API_KEY / AI_MODEL</code>
            <span>→</span>
            <code>CODEX_HOME</code>
          </div>
        </section>

        <section className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Portable backup</p>
              <h2>Export all learning data</h2>
            </div>
          </div>
          <p>
            下载包含任务、单词、练习、作文、对话、错题和 mock 记录的 JSON
            备份。
          </p>
          <a className={ui.button} href="/api/export">
            Download JSON backup
          </a>
          <div className={styles.path}>
            <small>Database</small>
            <code>{databasePath}</code>
          </div>
        </section>

        <section className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Optional Notion backup</p>
              <h2>One-way snapshot</h2>
            </div>
            <span className={notionConfigured ? ui.statusPill : ui.pill}>
              {notionConfigured ? "Configured" : "Not configured"}
            </span>
          </div>
          <p>
            通过官方 API 在指定父页面下创建带时间的备份页。Notion
            不是主数据库，失败不会影响学习。
          </p>
          <button
            className={ui.buttonSecondary}
            type="button"
            onClick={syncNotion}
            disabled={syncing || !notionConfigured}
          >
            {syncing ? "Backing up…" : "Backup to Notion now"}
          </button>
          {syncMessage && <div className={ui.notice}>{syncMessage}</div>}
          {!notionConfigured && (
            <div className={styles.envList}>
              <code>NOTION_TOKEN</code>
              <code>NOTION_PARENT_PAGE_ID</code>
            </div>
          )}
        </section>

        <section className={`${ui.panel} ${ui.panelDark}`}>
          <p className={ui.eyebrow}>Privacy boundary</p>
          <h2>One learner, one database</h2>
          <p>
            当前版本没有注册、公开分享、多人协作或云端账号系统。服务器访问权限就是工作区边界。
          </p>
        </section>
      </div>
    </div>
  );
}

