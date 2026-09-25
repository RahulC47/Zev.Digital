import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AutomationStep {
  type: 'run_command' | 'open_url' | 'wait_ms' | 'type_text';
  value: string;
}

interface Automation {
  id: string;
  name: string;
  description: string;
  steps: AutomationStep[];
}

export default function HermesDesktop() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<{ step: number; text: string; error?: boolean }[]>([]);

  // Draft state for new/editing automation
  const [draft, setDraft] = useState<Automation | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('zev_automations');
    if (saved) {
      try {
        setAutomations(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const saveAutomations = (newAutos: Automation[]) => {
    setAutomations(newAutos);
    localStorage.setItem('zev_automations', JSON.stringify(newAutos));
  };

  const startCreate = () => {
    setDraft({
      id: crypto.randomUUID(),
      name: 'New Automation',
      description: '',
      steps: [{ type: 'run_command', value: '' }],
    });
    setEditingId('new');
    setRunLog([]);
  };

  const startEdit = (auto: Automation) => {
    setDraft({ ...auto, steps: [...auto.steps] });
    setEditingId(auto.id);
    setRunLog([]);
  };

  const saveDraft = () => {
    if (!draft) return;
    if (editingId === 'new') {
      saveAutomations([...automations, draft]);
    } else {
      saveAutomations(automations.map(a => a.id === draft.id ? draft : a));
    }
    setEditingId(null);
    setDraft(null);
  };

  const deleteAutomation = (id: string) => {
    saveAutomations(automations.filter(a => a.id !== id));
  };

  const runAutomation = async (auto: Automation) => {
    setRunningId(auto.id);
    setRunLog([]);
    
    for (let i = 0; i < auto.steps.length; i++) {
      const step = auto.steps[i];
      setRunLog(prev => [...prev, { step: i + 1, text: `Running step ${i + 1}: ${step.type}...` }]);
      
      try {
        const res = await invoke<{ success: boolean, output: string, error: string | null }>(
          "run_automation_step", 
          { step }
        );
        
        if (res.success) {
          setRunLog(prev => [...prev, { step: i + 1, text: `✓ ${res.output || 'Success'}` }]);
        } else {
          setRunLog(prev => [...prev, { step: i + 1, text: `✗ Failed: ${res.error || res.output}`, error: true }]);
          break; // Stop on error
        }
      } catch (e: any) {
        setRunLog(prev => [...prev, { step: i + 1, text: `✗ Error: ${e.toString()}`, error: true }]);
        break;
      }
    }
    
    setRunningId(null);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-8" style={{ color: "var(--text)" }}>
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight">🤖 Desktop Automations</h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Define workflows to control your PC, open apps, and run scripts.
            </p>
          </div>
          <button
            onClick={startCreate}
            disabled={editingId !== null}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            + New Automation
          </button>
        </div>

        {/* List View */}
        {!editingId && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {automations.length === 0 ? (
              <div className="col-span-2 rounded-xl border border-dashed p-12 text-center" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                No automations yet. Click "+ New Automation" to create one.
              </div>
            ) : (
              automations.map(auto => (
                <div key={auto.id} className="rounded-xl border p-5 flex flex-col transition hover:border-[var(--accent)]" style={{ borderColor: "var(--border)", backgroundColor: "var(--panel)" }}>
                  <div className="mb-2 flex items-start justify-between">
                    <h3 className="font-bold text-lg">{auto.name}</h3>
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(auto)} className="text-xs hover:opacity-70" style={{ color: "var(--accent)" }}>Edit</button>
                      <button onClick={() => deleteAutomation(auto.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                    </div>
                  </div>
                  <p className="mb-4 text-sm flex-1" style={{ color: "var(--muted)" }}>{auto.description || 'No description'}</p>
                  <div className="flex items-center justify-between mt-auto pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>{auto.steps.length} step(s)</span>
                    <button
                      onClick={() => runAutomation(auto)}
                      disabled={runningId !== null}
                      className="rounded px-4 py-1.5 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: "var(--text)", color: "var(--bg)" }}
                    >
                      {runningId === auto.id ? 'Running...' : 'Run ▶'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Editor View */}
        {editingId && draft && (
          <div className="rounded-xl border p-6" style={{ borderColor: "var(--border)", backgroundColor: "var(--panel)" }}>
            <h2 className="mb-6 text-xl font-bold">{editingId === 'new' ? 'Create Automation' : 'Edit Automation'}</h2>
            
            <div className="mb-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>Name</label>
                <input
                  className="w-full rounded border px-3 py-2 outline-none focus:border-[var(--accent)]"
                  style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  value={draft.name}
                  onChange={e => setDraft({...draft, name: e.target.value})}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>Description</label>
                <input
                  className="w-full rounded border px-3 py-2 outline-none focus:border-[var(--accent)]"
                  style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  value={draft.description}
                  onChange={e => setDraft({...draft, description: e.target.value})}
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="mb-3 block text-sm font-medium" style={{ color: "var(--muted)" }}>Steps</label>
              <div className="space-y-3">
                {draft.steps.map((step, idx) => (
                  <div key={idx} className="flex gap-3 rounded border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg)" }}>
                    <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: "var(--panel2)", color: "var(--muted)" }}>
                      {idx + 1}
                    </div>
                    <select
                      className="rounded border px-2 py-1.5 text-sm outline-none shrink-0 w-36"
                      style={{ backgroundColor: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}
                      value={step.type}
                      onChange={e => {
                        const newSteps = [...draft.steps];
                        newSteps[idx].type = e.target.value as any;
                        setDraft({...draft, steps: newSteps});
                      }}
                    >
                      <option value="run_command">PowerShell Command</option>
                      <option value="open_url">Open App/URL</option>
                      <option value="wait_ms">Wait (ms)</option>
                      <option value="type_text">Type Text (Clipboard)</option>
                    </select>
                    <input
                      className="flex-1 rounded border px-3 py-1.5 font-mono text-sm outline-none focus:border-[var(--accent)]"
                      style={{ backgroundColor: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}
                      value={step.value}
                      placeholder={step.type === 'run_command' ? 'echo "Hello"' : step.type === 'open_url' ? 'https://google.com' : step.type === 'wait_ms' ? '1000' : 'Text to type...'}
                      onChange={e => {
                        const newSteps = [...draft.steps];
                        newSteps[idx].value = e.target.value;
                        setDraft({...draft, steps: newSteps});
                      }}
                    />
                    <button
                      onClick={() => {
                        const newSteps = [...draft.steps];
                        newSteps.splice(idx, 1);
                        setDraft({...draft, steps: newSteps});
                      }}
                      className="text-red-400 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setDraft({...draft, steps: [...draft.steps, { type: 'run_command', value: '' }]})}
                className="mt-3 text-sm font-medium hover:opacity-80"
                style={{ color: "var(--accent)" }}
              >
                + Add Step
              </button>
            </div>

            <div className="flex justify-end gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => { setEditingId(null); setDraft(null); }}
                className="rounded px-4 py-2 text-sm font-medium transition hover:bg-white/5"
                style={{ color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                onClick={saveDraft}
                className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Save Automation
              </button>
            </div>
          </div>
        )}

        {/* Run Log */}
        {runLog.length > 0 && !editingId && (
          <div className="mt-8 rounded-xl border p-5" style={{ borderColor: "var(--border)", backgroundColor: "#000" }}>
            <h3 className="mb-3 font-mono text-sm" style={{ color: "var(--accent)" }}>Execution Log</h3>
            <div className="font-mono text-xs space-y-1">
              {runLog.map((log, i) => (
                <div key={i} className={log.error ? "text-red-400" : "text-gray-300"}>
                  <span className="opacity-50 mr-2">[{log.step}]</span> {log.text}
                </div>
              ))}
              {runningId && <div className="animate-pulse text-gray-500 mt-2">_</div>}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
