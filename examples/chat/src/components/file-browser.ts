import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Agent } from "pi-browser";

@customElement("file-browser")
export class FileBrowser extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
    }

    .header-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }

    .breadcrumb-segment {
      background: none;
      border: none;
      color: var(--accent);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
    }

    .breadcrumb-segment:hover {
      background: var(--bg-input);
    }

    .breadcrumb-separator {
      color: var(--text-muted);
      user-select: none;
    }

    .content {
      flex: 1;
      overflow-y: auto;
    }

    /* File listing */
    .file-list {
      padding: 4px 0;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text);
      transition: background 0.1s;
    }

    .file-item:hover {
      background: var(--bg-input);
    }

    .file-icon {
      font-size: 14px;
      width: 20px;
      text-align: center;
      flex-shrink: 0;
    }

    .file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-name.dir {
      color: var(--accent);
      font-weight: 500;
    }

    .empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }

    /* File viewer */
    .file-viewer {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .file-viewer-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
    }

    .back-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--accent);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 8px;
    }

    .back-btn:hover {
      background: var(--bg-input);
    }

    .file-path {
      font-size: 12px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-content {
      flex: 1;
      overflow: auto;
      padding: 12px;
    }

    .line-numbers {
      display: flex;
      font-size: 13px;
      line-height: 1.5;
      font-family: inherit;
    }

    .line-nums {
      padding-right: 12px;
      border-right: 1px solid var(--border);
      margin-right: 12px;
      text-align: right;
      user-select: none;
      color: var(--text-muted);
      opacity: 0.5;
      white-space: pre;
    }

    .line-code {
      flex: 1;
      min-width: 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text);
    }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      padding: 2px 8px;
      margin-left: auto;
    }

    .refresh-btn:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
  `;

  @property({ attribute: false }) agent!: Agent;
  @property({ type: Number }) agentVersion = 0;

  @state() private currentDir = "/";
  @state() private viewingFile: string | null = null;
  @state() private fileContent: string | null = null;

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("agentVersion")) {
      // Refresh current view when agent version changes
      if (this.viewingFile) {
        this.openFile(this.viewingFile);
      }
    }
  }

  private getEntries(): { name: string; isDir: boolean; fullPath: string }[] {
    if (!this.agent) return [];
    const allFiles = this.agent.fs.list(this.currentDir);
    const dirPrefix = this.currentDir === "/" ? "/" : this.currentDir + "/";

    // Collect unique immediate children
    const seen = new Set<string>();
    const entries: { name: string; isDir: boolean; fullPath: string }[] = [];

    for (const filePath of allFiles) {
      const relative = filePath.slice(dirPrefix.length);
      if (!relative) continue;

      const slashIdx = relative.indexOf("/");
      if (slashIdx === -1) {
        // Direct file
        if (!seen.has(relative)) {
          seen.add(relative);
          entries.push({ name: relative, isDir: false, fullPath: filePath });
        }
      } else {
        // Directory
        const dirName = relative.slice(0, slashIdx);
        if (!seen.has(dirName)) {
          seen.add(dirName);
          entries.push({
            name: dirName,
            isDir: true,
            fullPath: dirPrefix + dirName,
          });
        }
      }
    }

    // Sort: dirs first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  private navigateToDir(path: string) {
    this.currentDir = path;
    this.viewingFile = null;
    this.fileContent = null;
  }

  private openFile(path: string) {
    const content = this.agent.fs.read(path);
    this.viewingFile = path;
    this.fileContent = content ?? "(file not found)";
  }

  private goUp() {
    if (this.currentDir === "/") return;
    const parts = this.currentDir.split("/").filter(Boolean);
    parts.pop();
    this.currentDir = parts.length === 0 ? "/" : "/" + parts.join("/");
  }

  private getBreadcrumbs(): { label: string; path: string }[] {
    const crumbs: { label: string; path: string }[] = [{ label: "/", path: "/" }];
    if (this.currentDir === "/") return crumbs;
    const parts = this.currentDir.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += "/" + part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }

  private handleRefresh() {
    this.requestUpdate();
  }

  private renderFileViewer() {
    const lines = (this.fileContent ?? "").split("\n");
    const lineNums = lines.map((_, i) => i + 1).join("\n");

    return html`
      <div class="file-viewer">
        <div class="file-viewer-header">
          <button class="back-btn" @click=${() => { this.viewingFile = null; this.fileContent = null; }}>← Back</button>
          <span class="file-path">${this.viewingFile}</span>
        </div>
        <div class="file-content">
          <div class="line-numbers">
            <div class="line-nums">${lineNums}</div>
            <div class="line-code">${this.fileContent}</div>
          </div>
        </div>
      </div>
    `;
  }

  private renderFileList() {
    const entries = this.getEntries();
    const crumbs = this.getBreadcrumbs();

    return html`
      <div class="breadcrumb">
        ${crumbs.map(
          (c, i) => html`
            ${i > 0 ? html`<span class="breadcrumb-separator">/</span>` : nothing}
            <button class="breadcrumb-segment" @click=${() => this.navigateToDir(c.path)}>
              ${c.label}
            </button>
          `
        )}
      </div>
      <div class="file-list">
        ${this.currentDir !== "/"
          ? html`
              <div class="file-item" @click=${() => this.goUp()}>
                <span class="file-icon">📁</span>
                <span class="file-name dir">..</span>
              </div>
            `
          : nothing}
        ${entries.length === 0 && this.currentDir === "/"
          ? html`<div class="empty">No files in the virtual filesystem yet.<br>Chat with the agent to generate some!</div>`
          : nothing}
        ${entries.map(
          (entry) => html`
            <div
              class="file-item"
              @click=${() =>
                entry.isDir
                  ? this.navigateToDir(entry.fullPath)
                  : this.openFile(entry.fullPath)}
            >
              <span class="file-icon">${entry.isDir ? "📁" : "📄"}</span>
              <span class="file-name ${entry.isDir ? "dir" : ""}">${entry.name}</span>
            </div>
          `
        )}
      </div>
    `;
  }

  render() {
    return html`
      <div class="header">
        <span class="header-title">Files</span>
        <button class="refresh-btn" @click=${this.handleRefresh} title="Refresh">↻</button>
      </div>
      <div class="content">
        ${this.viewingFile ? this.renderFileViewer() : this.renderFileList()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "file-browser": FileBrowser;
  }
}
