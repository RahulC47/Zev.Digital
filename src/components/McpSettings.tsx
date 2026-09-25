import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Settings, McpServer, McpTool } from '../lib/api';

export default function McpSettings({ settings, onChange }: { 
  settings: Settings; 
  onChange: (s: Partial<Settings>) => void; 
}) {
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const mcpServers = settings.mcp_servers || [];

  const handleUpdate = (idx: number, updated: McpServer) => {
    const newServers = [...mcpServers];
    newServers[idx] = updated;
    onChange({ mcp_servers: newServers });
  };

  const handleRemove = (idx: number) => {
    const newServers = [...mcpServers];
    newServers.splice(idx, 1);
    onChange({ mcp_servers: newServers });
  };

  const handleAdd = () => {
    onChange({
      mcp_servers: [
        ...mcpServers,
        {
          id: crypto.randomUUID(),
          name: 'New Server',
          transport: 'stdio',
          url: '',
          enabled: true,
        },
      ],
    });
  };

  const testServer = async (server: McpServer) => {
    setTestingServer(server.id);
    setTools(null);
    setTestError(null);
    
    try {
      // Temporarily enable just this one for the test if we had a targeted endpoint, 
      // but for now list_mcp_tools lists all enabled ones. 
      // We'll just call the global list and filter.
      const res = await invoke<McpTool[]>("list_mcp_tools");
      setTools(res.filter(t => t.server_id === server.id));
      if (res.filter(t => t.server_id === server.id).length === 0) {
          setTestError("Connected, but no tools returned or server is disabled.");
      }
    } catch (e: any) {
      setTestError(e.toString());
    } finally {
      setTestingServer(null);
    }
  };

  return (
    <div className="mt-8 border-t border-[var(--border)] pt-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold" style={{ color: "var(--text)" }}>
            ⚡ MCP Tools
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Connect AI to your local tools, databases, and APIs via the Model Context Protocol.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          className="rounded px-3 py-1.5 text-sm font-medium transition hover:opacity-80"
          style={{ backgroundColor: "var(--accent)", color: "#fff" }}
        >
          + Add Server
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {mcpServers.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            No MCP servers configured yet.
          </div>
        )}

        {mcpServers.map((server, idx) => (
          <div key={server.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--panel)" }}>
            <div className="flex gap-4">
              <div className="flex-1 space-y-3">
                <div className="flex gap-3">
                  <input
                    className="flex-1 rounded border px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                    style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                    value={server.name}
                    onChange={(e) => handleUpdate(idx, { ...server, name: e.target.value })}
                    placeholder="Server Name (e.g. Local Filesystem)"
                  />
                  <select
                    className="rounded border px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                    style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                    value={server.transport}
                    onChange={(e) => handleUpdate(idx, { ...server, transport: e.target.value as 'http' | 'stdio' })}
                  >
                    <option value="stdio">stdio (Command)</option>
                    <option value="http">HTTP (URL)</option>
                  </select>
                </div>

                <input
                  className="w-full rounded border px-3 py-1.5 font-mono text-sm outline-none focus:border-[var(--accent)]"
                  style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  value={server.url}
                  onChange={(e) => handleUpdate(idx, { ...server, url: e.target.value })}
                  placeholder={server.transport === 'stdio' ? 'npx -y @modelcontextprotocol/server-filesystem /path' : 'http://localhost:8000'}
                />

                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={(e) => handleUpdate(idx, { ...server, enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  
                  <button
                    type="button"
                    onClick={() => testServer(server)}
                    disabled={!server.enabled || testingServer === server.id}
                    className="text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                    style={{ color: "var(--accent)" }}
                  >
                    {testingServer === server.id ? 'Testing...' : 'Test Connection'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="ml-auto text-sm text-red-400 hover:text-red-300 transition"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>

            {/* Test Results Area */}
            {(tools !== null || testError) && (
              <div className="mt-4 rounded border p-3 text-sm" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg)" }}>
                {testError ? (
                  <div className="text-red-400">Error: {testError}</div>
                ) : tools && tools.length > 0 ? (
                  <div>
                    <div className="mb-2 font-medium" style={{ color: "var(--accent)" }}>✓ Connected ({tools.length} tools available)</div>
                    <ul className="list-disc pl-5 space-y-1" style={{ color: "var(--muted)" }}>
                      {tools.map(t => (
                        <li key={t.name}>
                          <span style={{ color: "var(--text)" }}>{t.name}</span> — {t.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
