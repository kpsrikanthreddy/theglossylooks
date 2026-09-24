import React, { useState, useEffect } from 'react';
import { 
  MessageCircle, 
  CheckCircle2, 
  AlertCircle, 
  Settings as SettingsIcon, 
  FileText, 
  ListFilter, 
  Send, 
  RefreshCw, 
  ShieldCheck, 
  Copy,
  ExternalLink,
  Search,
  Check,
  Zap,
  Code2,
  Terminal,
  CheckCheck,
  Eye
} from 'lucide-react';
import { WhatsAppMessageLog, WhatsAppSettings } from '../../types/admin';

interface AdminWhatsAppProps {
  settings: WhatsAppSettings;
  messageLogs: WhatsAppMessageLog[];
  onUpdateSettings: (newSettings: WhatsAppSettings) => void;
}

export const AdminWhatsApp: React.FC<AdminWhatsAppProps> = ({
  settings,
  messageLogs: initialLogs,
  onUpdateSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'connection' | 'templates' | 'automation' | 'logs'>('connection');
  const [localSettings, setLocalSettings] = useState<WhatsAppSettings>(settings);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Live Backend Status
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedReq, setCopiedReq] = useState(false);
  const [copiedRes, setCopiedRes] = useState(false);

  // Live Message Logs (actively synced from /api/whatsapp/logs)
  const [liveLogs, setLiveLogs] = useState<WhatsAppMessageLog[]>(initialLogs);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  const [inspectingLog, setInspectingLog] = useState<WhatsAppMessageLog | null>(null);

  // Send Test Template Modal State
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('+91 94401 23456');
  const [testName, setTestName] = useState('Priya');
  const [testTemplate, setTestTemplate] = useState('glossylooks_feedback');
  const [testLanguage, setTestLanguage] = useState('en');
  const [includeVariables, setIncludeVariables] = useState(true);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResultDetailed, setTestResultDetailed] = useState<{
    success: boolean;
    apiAccepted: boolean;
    httpStatus: number;
    messageId?: string | null;
    error?: {
      code?: number | string;
      message?: string;
      error_data?: any;
      fbtrace_id?: string;
    } | null;
    templateName: string;
    to: string;
    requestPayload: any;
    metaResponse: any;
    message: string;
  } | null>(null);

  // Filter & Search for Message Logs
  const [logSearch, setLogSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED'>('ALL');

  // Phone normalization preview according to rule:
  // For Indian number: +91 94401 23456 -> 919440123456 (E.164 without +)
  const getNormalizedPreview = (input: string): string => {
    if (!input) return '';
    let d = input.replace(/\D/g, '').replace(/^0+/, '');
    if (d.length === 10) return '91' + d;
    if (d.length === 12 && d.startsWith('91')) return d;
    if (d.length === 13 && d.startsWith('910')) return '91' + d.substring(3);
    return d;
  };

  // Fetch live backend status
  const fetchBackendStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
      }
    } catch (err) {
      console.warn('Could not fetch backend status (local dev mode):', err);
    }
  };

  // Fetch live transmission logs from backend
  const fetchLiveLogs = async () => {
    setIsRefreshingLogs(true);
    try {
      const res = await fetch('/api/whatsapp/logs');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLiveLogs(data.map((l: any) => ({
            id: l.id,
            customerName: l.customerName,
            customerPhone: l.customerPhone,
            templateName: l.templateName || 'glossylooks_feedback',
            direction: l.direction,
            messageType: l.messageType,
            status: (l.status || 'SENT').toUpperCase(),
            waMessageId: l.waMessageId,
            apiAccepted: l.apiAccepted,
            httpStatus: l.httpStatus,
            errorCode: l.errorCode,
            errorMessage: l.errorMessage,
            errorData: l.errorData,
            fbtraceId: l.fbtraceId,
            contacts: l.contacts,
            messagePreview: l.messageText || l.messagePreview,
            rawRequest: l.rawRequest,
            rawResponse: l.rawResponse,
            timestamp: l.createdAt || l.timestamp || new Date().toISOString(),
            appointmentId: l.appointmentId,
            isTest: l.isTest,
          })));
        }
      }
    } catch (err) {
      console.warn('Could not refresh logs:', err);
    } finally {
      setIsRefreshingLogs(false);
    }
  };

  useEffect(() => {
    fetchBackendStatus();
    fetchLiveLogs();
    const interval = setInterval(() => {
      fetchBackendStatus();
      fetchLiveLogs();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(localSettings);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
        setIsTesting(false);
        setTestResult({
          success: true,
          message: `Webhook Status: ${data.webhookStatus}. Handshake endpoint ready at /api/whatsapp/webhook.`,
        });
      } else {
        throw new Error('Server returned ' + res.status);
      }
    } catch (err: any) {
      setIsTesting(false);
      setTestResult({
        success: false,
        message: 'Ping failed: ' + (err?.message || 'Server offline'),
      });
    }
  };

  // Dispatch Test Template to Meta Cloud API (No Simulation)
  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSendingTest(true);
    setTestResultDetailed(null);

    try {
      const res = await fetch('/api/whatsapp/send-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-test-token',
        },
        body: JSON.stringify({
          toPhone: testPhone,
          customerName: testName,
          templateName: testTemplate,
          languageCode: testLanguage,
          includeVariables,
        }),
      });

      const data = await res.json();
      setIsSendingTest(false);
      setTestResultDetailed(data);
      fetchLiveLogs();
      fetchBackendStatus();
    } catch (err: any) {
      setIsSendingTest(false);
      setTestResultDetailed({
        success: false,
        apiAccepted: false,
        httpStatus: 0,
        templateName: testTemplate,
        to: getNormalizedPreview(testPhone),
        requestPayload: { error: 'Network failure before dispatch' },
        metaResponse: { error: { message: err?.message || 'Network error' } },
        error: { code: 'CLIENT_NETWORK_ERROR', message: err?.message || 'Failed to communicate with server' },
        message: err?.message || 'Network error executing test message dispatch.',
      });
    }
  };

  const currentHost = typeof window !== 'undefined' ? window.location.origin : 'https://glossylooks.ai.studio';
  const webhookUrl = `${currentHost}/api/whatsapp/webhook`;
  const defaultVerifyToken = 'glossy_looks_webhook_verify_token_2026';

  const copyToClipboard = (text: string, type: 'url' | 'token') => {
    navigator.clipboard.writeText(text);
    if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  // Filter logs
  const filteredLogs = liveLogs.filter(log => {
    if (statusFilter !== 'ALL' && log.status.toUpperCase() !== statusFilter) return false;
    if (logSearch) {
      const q = logSearch.toLowerCase();
      const matchName = log.customerName.toLowerCase().includes(q);
      const matchPhone = log.customerPhone.includes(q);
      const matchTemplate = (log.templateName || '').toLowerCase().includes(q);
      const matchWamid = (log.waMessageId || '').toLowerCase().includes(q);
      const matchErr = (log.errorMessage || '').toLowerCase().includes(q) || String(log.errorCode || '').includes(q);
      const matchPreview = (log.messagePreview || '').toLowerCase().includes(q);
      if (!matchName && !matchPhone && !matchTemplate && !matchWamid && !matchErr && !matchPreview) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">WhatsApp Business Cloud API</h2>
          <p className="text-xs text-stone-500">
            Automated customer feedback workflow, approved template delivery, and delivery status audit logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsTestModalOpen(true);
              setTestResultDetailed(null);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-[#8C3A42] hover:bg-[#722F36] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Test Template</span>
          </button>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Webhook: {serverStatus?.webhookStatus || settings.webhookStatus}</span>
          </span>
        </div>
      </div>

      {/* TABS */}
      <div className="flex items-center gap-2 border-b border-stone-200 pb-2 text-xs overflow-x-auto">
        {[
          { id: 'connection', label: 'WhatsApp Connection', icon: ShieldCheck },
          { id: 'templates', label: 'Approved Templates', icon: FileText },
          { id: 'automation', label: 'Feedback Automation', icon: SettingsIcon },
          { id: 'logs', label: `Message Logs (${liveLogs.length})`, icon: ListFilter },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all whitespace-nowrap cursor-pointer ${
                isActive 
                  ? 'bg-[#8C3A42] text-white shadow-xs font-semibold' 
                  : 'text-stone-600 hover:bg-stone-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: CONNECTION SETTINGS */}
      {activeTab === 'connection' && (
        <div className="space-y-6">

          {/* META WEBHOOK REGISTRATION HELPER */}
          <div className="bg-gradient-to-r from-stone-900 to-[#2D2424] text-white rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  <Zap className="w-3.5 h-3.5" />
                  Meta Webhook Configuration
                </span>
                <h3 className="font-serif font-bold text-lg text-white mt-1">
                  Connect Webhook in Meta for Developers
                </h3>
                <p className="text-xs text-stone-300 max-w-2xl mt-1">
                  Paste this Callback URL and Verify Token in your Meta App Dashboard under WhatsApp &rarr; Configuration &rarr; Webhook.
                  Subscribed fields: <span className="text-amber-200 font-mono">messages</span>.
                </p>
              </div>

              <a
                href="https://developers.facebook.com/apps/"
                target="_blank"
                rel="noreferrer"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
              >
                <span>Open Meta Dashboard</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="bg-black/30 p-3 rounded-xl border border-white/10 space-y-1">
                <span className="text-[10px] text-stone-400 uppercase tracking-wider font-semibold block">
                  Callback URL (Meta Webhook Endpoint)
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-stone-200 truncate select-all">{webhookUrl}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(webhookUrl, 'url')}
                    className="p-1 rounded hover:bg-white/10 text-stone-300 hover:text-white cursor-pointer"
                    title="Copy URL"
                  >
                    {copiedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="bg-black/30 p-3 rounded-xl border border-white/10 space-y-1">
                <span className="text-[10px] text-stone-400 uppercase tracking-wider font-semibold block">
                  Verify Token (Hub Verify Token)
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-stone-200 truncate select-all">{defaultVerifyToken}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(defaultVerifyToken, 'token')}
                    className="p-1 rounded hover:bg-white/10 text-stone-300 hover:text-white cursor-pointer"
                    title="Copy Token"
                  >
                    {copiedToken ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* STATUS CARDS */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-stone-100 pb-4">
              <div>
                <h3 className="font-serif font-bold text-base text-[#2D2424]">Cloud API Status & Credentials</h3>
                <p className="text-xs text-stone-500">Official Meta WhatsApp Business Cloud configuration & health check</p>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Testing Webhook...' : 'Ping Webhook'}</span>
              </button>
            </div>

            {testResult && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testResult.success 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold block">Connection Status</span>
                <span className="font-serif text-sm font-bold text-[#2D2424]">
                  {serverStatus?.connection || 'Configured'}
                </span>
                <p className="text-[11px] text-stone-500 pt-1">
                  Meta WhatsApp Cloud API v22.0
                </p>
              </div>

              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold block">Approved Template</span>
                <span className="font-mono text-sm font-semibold text-[#8C3A42]">
                  {serverStatus?.feedbackTemplate || 'glossylooks_feedback'}
                </span>
                <p className="text-[11px] text-stone-500 pt-1">
                  Dispatched as <code className="bg-stone-200 px-1 py-0.2 rounded font-mono text-[10px]">type: "template"</code>
                </p>
              </div>

              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold block">Phone Number ID</span>
                <span className="font-mono text-sm font-semibold text-[#2D2424]">
                  {serverStatus?.phoneNumberId || settings.phoneNumberId}
                </span>
                <p className="text-[11px] text-stone-500 pt-1">
                  Status: {serverStatus?.phoneNumberStatus || 'Configured'}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold block">Access Token Security</span>
                <span className="font-mono text-sm font-semibold text-stone-700 tracking-widest">
                  {serverStatus?.maskedToken || settings.maskedToken}
                </span>
                <p className="text-[11px] text-emerald-700 pt-1 font-medium">
                  ✓ Token masked & stored server-side only (Never exposed to client)
                </p>
              </div>

              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1 md:col-span-2">
                <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold block">Webhook Handshake Status</span>
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    {serverStatus?.webhookStatus || settings.webhookStatus}
                  </span>
                  <span className="text-stone-500 text-[11px]">
                    Last event received: {serverStatus?.lastWebhookReceived ? new Date(serverStatus.lastWebhookReceived).toLocaleString() : 'Active'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TEMPLATES */}
      {activeTab === 'templates' && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2D2424]">Approved Meta WhatsApp Template</h3>
              <p className="text-xs text-stone-500">Official template structure for brand-new customer feedback</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsTestModalOpen(true);
                setTestResultDetailed(null);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-[#8C3A42] hover:bg-[#722F36] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Test This Template</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            
            {/* Primary Feedback Template */}
            <div className="p-4 rounded-xl bg-[#FAF7F5] border border-stone-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#8C3A42]">glossylooks_feedback</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">APPROVED</span>
              </div>
              <div className="text-stone-700 text-[11px] bg-white p-3 rounded-lg border border-stone-200 space-y-2">
                <p className="italic leading-relaxed">
                  "Hi &#123;&#123;1&#125;&#125;,<br/><br/>
                  Thank you for visiting The Glossy Looks! ✨<br/><br/>
                  We'd love to know about your experience.<br/><br/>
                  How was your visit?"
                </p>
                <div className="pt-2 border-t border-stone-100 flex flex-wrap gap-1.5 font-sans font-medium text-[10px]">
                  <span className="px-2 py-1 rounded bg-stone-100 text-stone-700 border border-stone-200">[ 😊 Good ]</span>
                  <span className="px-2 py-1 rounded bg-stone-100 text-stone-700 border border-stone-200">[ 😐 Average ]</span>
                  <span className="px-2 py-1 rounded bg-stone-100 text-stone-700 border border-stone-200">[ 😞 Bad ]</span>
                </div>
              </div>
              <p className="text-[11px] text-stone-600">
                <span className="font-semibold text-stone-800">Rule:</span> Sent as <code className="bg-stone-200 px-1 py-0.5 rounded font-mono text-[10px]">type: "template"</code>.
                Allows business to reach customers who have never messaged first.
              </p>
            </div>

            {/* Google Review URL Automation for Good Ratings */}
            <div className="p-4 rounded-xl bg-[#FAF7F5] border border-stone-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#8C3A42]">Good Feedback &rarr; Google Review</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">AUTOMATIC</span>
              </div>
              <div className="text-stone-700 text-[11px] bg-white p-3 rounded-lg border border-stone-200 space-y-2">
                <p className="italic leading-relaxed">
                  "Thank you so much, &#123;&#123;customer_name&#125;&#125;! 😊✨<br/>
                  We're happy you enjoyed your visit to The Glossy Looks.<br/><br/>
                  We'd really appreciate it if you could share your experience on Google:<br/>
                  <span className="text-[#8C3A42] font-semibold">&#123;&#123;GOOGLE_REVIEW_URL&#125;&#125;</span><br/><br/>
                  Thank you for supporting us! 💖"
                </p>
              </div>
              <p className="text-[11px] text-stone-600">
                <span className="font-semibold text-stone-800">Constraint:</span> Google review URL is ONLY sent for Good replies. Never sent for Average or Bad.
              </p>
            </div>

          </div>
        </div>
      )}

      {/* TAB 3: AUTOMATION SETTINGS */}
      {activeTab === 'automation' && (
        <form onSubmit={handleSaveSettings} className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-stone-100 pb-4">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2D2424]">Feedback Workflow Automation</h3>
              <p className="text-xs text-stone-500">Configure delays and auto-routing rules</p>
            </div>
            {saveSuccess && (
              <span className="text-emerald-700 text-xs font-semibold flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-lg">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved Successfully
              </span>
            )}
          </div>

          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between p-4 rounded-xl bg-stone-50 border border-stone-200">
              <div>
                <span className="font-semibold text-stone-800 block">Automated Feedback Dispatch</span>
                <p className="text-stone-500 text-[11px] mt-0.5">
                  Automatically schedules approved WhatsApp feedback template when appointment is marked Completed.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.enabled}
                  onChange={(e) => setLocalSettings({ ...localSettings, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#8C3A42]"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-stone-700 font-medium mb-1">Feedback Trigger Delay (Minutes)</label>
                <select
                  value={localSettings.delayMinutes}
                  onChange={(e) => setLocalSettings({ ...localSettings, delayMinutes: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
                >
                  <option value={15}>15 Minutes after completion</option>
                  <option value={30}>30 Minutes after completion (Recommended)</option>
                  <option value={60}>1 Hour after completion</option>
                  <option value={120}>2 Hours after completion</option>
                </select>
                <p className="text-[11px] text-stone-500 mt-1">Default 30 minutes gives guests time to return home.</p>
              </div>

              <div>
                <label className="block text-stone-700 font-medium mb-1">Approved Template Name</label>
                <input
                  type="text"
                  value={localSettings.templateName || 'glossylooks_feedback'}
                  onChange={(e) => setLocalSettings({ ...localSettings, templateName: e.target.value })}
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white font-mono"
                />
                <p className="text-[11px] text-stone-500 mt-1">Registered template on Meta Business Manager: glossylooks_feedback</p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-stone-50 border border-stone-200">
              <div>
                <span className="font-semibold text-stone-800 block">Send Google Review Link for Good (😊) Ratings</span>
                <p className="text-stone-500 text-[11px] mt-0.5">
                  Only highly satisfied customers receive the Google Review invitation. Average and Bad responses are never sent this link.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.sendGoogleReviewOnGood}
                  onChange={(e) => setLocalSettings({ ...localSettings, sendGoogleReviewOnGood: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#8C3A42]"></div>
              </label>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-lg bg-[#8C3A42] text-white hover:bg-[#722F36] font-medium text-xs shadow-xs cursor-pointer"
            >
              Save Automation Settings
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: MESSAGE LOGS (Requirement 7) */}
      {activeTab === 'logs' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden space-y-4 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2D2424]">Live Message Transmission & Audit Logs</h3>
              <p className="text-xs text-stone-500">
                Full delivery tracking from Meta API acceptance to delivery receipt webhooks
              </p>
            </div>

            {/* FILTERS & REFRESH */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Search customer, phone, wamid..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs w-52"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="SENT">Sent</option>
                <option value="DELIVERED">Delivered</option>
                <option value="READ">Read</option>
                <option value="FAILED">Failed</option>
                <option value="RECEIVED">Received</option>
              </select>

              <button
                type="button"
                onClick={fetchLiveLogs}
                disabled={isRefreshingLogs}
                className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                title="Refresh logs from backend"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-stone-500">
              <MessageCircle className="w-10 h-10 text-stone-300 mx-auto mb-2" />
              <p className="text-sm font-medium">No messages matching criteria.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-stone-200 rounded-xl">
              {/* EXACT COLUMNS MANDATED BY REQUIREMENT 7:
                  Customer, Phone, Template, Meta Message ID, API Accepted, Status, Error Code, Error Message, Timestamp */}
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
                  <tr>
                    <th className="py-3 px-3.5">Customer</th>
                    <th className="py-3 px-3">Phone</th>
                    <th className="py-3 px-3">Template</th>
                    <th className="py-3 px-3">Meta Message ID</th>
                    <th className="py-3 px-3 text-center">API Accepted</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-3">Error Code</th>
                    <th className="py-3 px-3">Error Message</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Timestamp</th>
                    <th className="py-3 px-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredLogs.map(log => {
                    const isAccepted = log.apiAccepted !== undefined ? log.apiAccepted : (log.status !== 'FAILED');
                    const hasError = log.errorCode || (log.status === 'FAILED');

                    return (
                      <tr key={log.id} className="hover:bg-stone-50/80 transition-colors">
                        {/* 1. Customer */}
                        <td className="py-3 px-3.5 font-semibold text-[#2D2424] whitespace-nowrap">
                          <span>{log.customerName}</span>
                          {log.isTest && (
                            <span className="ml-1.5 px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded font-mono text-[9px] font-bold">
                              TEST
                            </span>
                          )}
                        </td>

                        {/* 2. Phone */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-stone-700">
                          {log.customerPhone}
                        </td>

                        {/* 3. Template */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="font-mono text-[10px] bg-stone-100 text-stone-800 px-2 py-0.5 rounded border border-stone-200">
                            {log.templateName || 'glossylooks_feedback'}
                          </span>
                        </td>

                        {/* 4. Meta Message ID */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {log.waMessageId ? (
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-[10px] text-[#8C3A42] max-w-[130px] truncate block" title={log.waMessageId}>
                                {log.waMessageId}
                              </span>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(log.waMessageId || '')}
                                className="text-stone-400 hover:text-stone-600 p-0.5 cursor-pointer"
                                title="Copy Message ID"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-stone-400 text-[10px]">—</span>
                          )}
                        </td>

                        {/* 5. API Accepted */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {isAccepted ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>Yes ({log.httpStatus || 200})</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                              <span>No ({log.httpStatus || 'Err'})</span>
                            </span>
                          )}
                        </td>

                        {/* 6. Status (Requirement 6: sent, delivered, read, failed) */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            log.status === 'READ' 
                              ? 'bg-blue-100 text-blue-800 border border-blue-200' 
                              : log.status === 'DELIVERED' 
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                : log.status === 'FAILED'
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                  : log.status === 'RECEIVED'
                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {log.status}
                          </span>
                        </td>

                        {/* 7. Error Code */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {log.errorCode ? (
                            <span className="font-mono text-rose-700 font-semibold text-[10px] bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                              {log.errorCode}
                            </span>
                          ) : (
                            <span className="text-stone-400 text-[10px]">—</span>
                          )}
                        </td>

                        {/* 8. Error Message */}
                        <td className="py-3 px-3 max-w-[170px]">
                          {log.errorMessage ? (
                            <span className="text-rose-600 text-[11px] truncate block" title={log.errorMessage}>
                              {log.errorMessage}
                            </span>
                          ) : (
                            <span className="text-stone-400 text-[11px]">None</span>
                          )}
                        </td>

                        {/* 9. Timestamp */}
                        <td className="py-3 px-3.5 whitespace-nowrap text-stone-500 text-[11px]">
                          {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(log.timestamp).toLocaleDateString()}
                        </td>

                        {/* View JSON Details */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setInspectingLog(log)}
                            className="px-2 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium text-[10px] flex items-center gap-1 ml-auto cursor-pointer"
                            title="Inspect Meta Request & Response"
                          >
                            <Code2 className="w-3 h-3" />
                            <span>Payload</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SEND TEST TEMPLATE MODAL (Requirements 8, 9, 11, 12) */}
      {isTestModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 className="font-serif font-bold text-lg text-[#2D2424]">Send Test Template (glossylooks_feedback)</h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Business-initiated approved Meta template. Works for brand-new customers who have never messaged +91 89857 99459.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setIsTestModalOpen(false); setTestResultDetailed(null); }}
                className="text-stone-400 hover:text-stone-600 text-xl font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {/* LIVE OUTCOME DISPLAY (Requirements 11 & 12) */}
            {testResultDetailed && (
              <div className="space-y-4 animate-fadeIn">
                {testResultDetailed.apiAccepted ? (
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs space-y-2">
                    <div className="flex items-center justify-between font-bold text-emerald-950">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Meta API Accepted (HTTP {testResultDetailed.httpStatus})</span>
                      </div>
                      <span className="font-mono text-[10px] bg-emerald-200/80 px-2 py-0.5 rounded">
                        Initial Status: SENT
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-800">
                      Message ID: <span className="font-bold">{testResultDetailed.messageId || 'wamid generated'}</span>
                    </div>
                    <p className="text-[11px] text-emerald-700 leading-relaxed">
                      ✓ Meta Cloud API accepted the template dispatch. Delivery to the device (<span className="font-semibold">DELIVERED</span>) and read receipts (<span className="font-semibold">READ</span>) will be updated asynchronously as Meta webhook events arrive.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-rose-950">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>Meta API Rejected Request (HTTP {testResultDetailed.httpStatus})</span>
                    </div>
                    <p className="text-[11px] text-rose-800">
                      <span className="font-semibold">Error {testResultDetailed.error?.code}:</span> {testResultDetailed.error?.message}
                    </p>
                  </div>
                )}

                {/* EXACT META API REQUEST & RESPONSE TRANSPARENCY */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Exact Request Payload (Requirement 11) */}
                  <div className="bg-stone-900 text-stone-100 rounded-xl p-3.5 space-y-2 border border-stone-800">
                    <div className="flex items-center justify-between text-[11px] border-b border-stone-800 pb-1.5">
                      <span className="font-semibold text-amber-300 flex items-center gap-1">
                        <Terminal className="w-3.5 h-3.5" />
                        Exact Meta API Request (Token Masked)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(testResultDetailed.requestPayload, null, 2));
                          setCopiedReq(true);
                          setTimeout(() => setCopiedReq(false), 2000);
                        }}
                        className="text-stone-400 hover:text-white flex items-center gap-1 text-[10px] cursor-pointer"
                      >
                        {copiedReq ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="font-mono text-[10px] text-stone-300 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                      {JSON.stringify(testResultDetailed.requestPayload, null, 2)}
                    </pre>
                  </div>

                  {/* Exact Meta Response (Requirement 12) */}
                  <div className="bg-stone-900 text-stone-100 rounded-xl p-3.5 space-y-2 border border-stone-800">
                    <div className="flex items-center justify-between text-[11px] border-b border-stone-800 pb-1.5">
                      <span className="font-semibold text-emerald-300 flex items-center gap-1">
                        <Code2 className="w-3.5 h-3.5" />
                        Exact Meta API Response
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(testResultDetailed.metaResponse, null, 2));
                          setCopiedRes(true);
                          setTimeout(() => setCopiedRes(false), 2000);
                        }}
                        className="text-stone-400 hover:text-white flex items-center gap-1 text-[10px] cursor-pointer"
                      >
                        {copiedRes ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="font-mono text-[10px] text-stone-300 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                      {JSON.stringify(testResultDetailed.metaResponse, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSendTestMessage} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="block text-stone-800 font-semibold">
                  Customer Mobile Number (Enter ANY mobile number)
                </label>
                <input
                  type="text"
                  required
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+91 94401 23456 or 9440123456"
                  className="w-full p-2.5 rounded-lg border border-stone-300 font-mono text-xs bg-white focus:ring-2 focus:ring-[#8C3A42]"
                />
                <div className="p-2 rounded-lg bg-stone-50 border border-stone-200 text-[11px] text-stone-600 flex items-center justify-between">
                  <span>Phone Normalization Rule (E.164 without +):</span>
                  <span className="font-mono font-bold text-[#8C3A42] bg-white px-2 py-0.5 rounded border border-stone-200">
                    to: "{getNormalizedPreview(testPhone)}"
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-700 font-medium mb-1">Guest Name (for template body variable)</label>
                  <input
                    type="text"
                    required
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    placeholder="Priya"
                    className="w-full p-2 rounded-lg border border-stone-300 bg-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-stone-700 font-medium mb-1">Approved Template Name</label>
                  <input
                    type="text"
                    required
                    value={testTemplate}
                    onChange={(e) => setTestTemplate(e.target.value)}
                    placeholder="glossylooks_feedback"
                    className="w-full p-2 rounded-lg border border-stone-300 bg-white font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-700 font-medium mb-1">Template Language Code</label>
                  <select
                    value={testLanguage}
                    onChange={(e) => setTestLanguage(e.target.value)}
                    className="w-full p-2 rounded-lg border border-stone-300 bg-white text-xs"
                  >
                    <option value="en">en (English)</option>
                    <option value="en_US">en_US (English US)</option>
                    <option value="en_GB">en_GB (English UK)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="inclVars"
                    checked={includeVariables}
                    onChange={(e) => setIncludeVariables(e.target.checked)}
                    className="rounded border-stone-300 text-[#8C3A42] focus:ring-[#8C3A42]"
                  />
                  <label htmlFor="inclVars" className="text-stone-700 select-none cursor-pointer">
                    Include customer name in body parameters
                  </label>
                </div>
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] space-y-1">
                <span className="font-semibold block text-amber-950">
                  Business-Initiated WhatsApp Cloud API Rules:
                </span>
                <p className="leading-relaxed">
                  Brand-new customers outside the 24-hour service window cannot receive free-form text.
                  This test sends the approved template <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">glossylooks_feedback</code> with <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">type: "template"</code>.
                  The customer does not need to have messaged us first.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => { setIsTestModalOpen(false); setTestResultDetailed(null); }}
                  className="px-4 py-2 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 cursor-pointer text-xs"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSendingTest}
                  className="px-5 py-2 rounded-lg bg-[#8C3A42] text-white hover:bg-[#722F36] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 text-xs shadow-xs"
                >
                  <Send className={`w-3.5 h-3.5 ${isSendingTest ? 'animate-pulse' : ''}`} />
                  <span>{isSendingTest ? 'Sending to Meta Graph API...' : 'Dispatch Template Now'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECT LOG DETAILS MODAL */}
      {inspectingLog && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 className="font-serif font-bold text-base text-[#2D2424]">Message Log Audit Details</h3>
                <p className="text-xs text-stone-500 font-mono">ID: {inspectingLog.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingLog(null)}
                className="text-stone-400 hover:text-stone-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs bg-stone-50 p-3.5 rounded-xl border border-stone-200">
              <div>
                <span className="text-stone-400 text-[10px] block">Customer</span>
                <span className="font-semibold text-stone-800">{inspectingLog.customerName}</span>
              </div>
              <div>
                <span className="text-stone-400 text-[10px] block">Phone</span>
                <span className="font-mono text-stone-800">{inspectingLog.customerPhone}</span>
              </div>
              <div>
                <span className="text-stone-400 text-[10px] block">Template</span>
                <span className="font-mono text-stone-800">{inspectingLog.templateName || 'glossylooks_feedback'}</span>
              </div>
              <div>
                <span className="text-stone-400 text-[10px] block">Meta Message ID</span>
                <span className="font-mono text-[#8C3A42] text-[11px] truncate block">{inspectingLog.waMessageId || 'None'}</span>
              </div>
              <div>
                <span className="text-stone-400 text-[10px] block">API Accepted</span>
                <span className="font-semibold">{inspectingLog.apiAccepted ? 'Yes (200)' : 'No'}</span>
              </div>
              <div>
                <span className="text-stone-400 text-[10px] block">Delivery Status</span>
                <span className="font-bold uppercase text-[#8C3A42]">{inspectingLog.status}</span>
              </div>
            </div>

            {/* Raw Request & Response Details */}
            <div className="space-y-3 text-xs">
              <div>
                <span className="font-semibold text-stone-700 block mb-1">Dispatched Request Payload:</span>
                <pre className="p-3 bg-stone-900 text-stone-200 rounded-xl font-mono text-[10px] max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(inspectingLog.rawRequest || { note: 'Historical record' }, null, 2)}
                </pre>
              </div>

              <div>
                <span className="font-semibold text-stone-700 block mb-1">Meta Cloud API Response:</span>
                <pre className="p-3 bg-stone-900 text-stone-200 rounded-xl font-mono text-[10px] max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(inspectingLog.rawResponse || { status: inspectingLog.status, messageId: inspectingLog.waMessageId }, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setInspectingLog(null)}
                className="px-4 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
