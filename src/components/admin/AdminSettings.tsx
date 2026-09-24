import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Store, 
  MapPin, 
  MessageSquareHeart, 
  ShieldCheck, 
  FileText, 
  CheckCircle2, 
  Save, 
  ExternalLink, 
  Plus, 
  User, 
  Lock, 
  Mail, 
  Phone, 
  Clock,
  Printer,
  RotateCcw,
  Zap,
  Check,
  AlertCircle
} from 'lucide-react';
import { SalonSettings, WhatsAppSettings, AuditLog, AdminUser, AdminRole, PrinterSettings } from '../../types/admin';
import { createAdminUser, getAdminUsers } from '../../services/authService';

interface AdminSettingsProps {
  salonSettings: SalonSettings;
  whatsappSettings: WhatsAppSettings;
  auditLogs: AuditLog[];
  currentUser: AdminUser;
  onUpdateSalonSettings: (newSettings: SalonSettings) => void;
  onUpdateWhatsAppSettings: (newSettings: WhatsAppSettings) => void;
}

export const AdminSettings: React.FC<AdminSettingsProps> = ({
  salonSettings,
  whatsappSettings,
  auditLogs,
  currentUser,
  onUpdateSalonSettings,
  onUpdateWhatsAppSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'google' | 'feedback' | 'team' | 'printer' | 'audit'>('profile');
  
  // Local form states
  const [profileForm, setProfileForm] = useState<SalonSettings>(salonSettings);
  const [feedbackForm, setFeedbackForm] = useState<WhatsAppSettings>(whatsappSettings);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Printer settings form state
  const [printerForm, setPrinterForm] = useState<PrinterSettings>({
    enabled: true,
    printerName: 'POS-80C Thermal Printer',
    connectionType: 'local_agent',
    paperWidth: '3inch',
    autoPrint: true,
    autoCut: true,
    copies: 1,
    networkIp: '192.168.1.100',
  });
  const [printerSaveSuccess, setPrinterSaveSuccess] = useState(false);
  const [testPrintStatus, setTestPrintStatus] = useState<string | null>(null);
  const [recentPrintJobs, setRecentPrintJobs] = useState<any[]>([]);

  // Fetch initial printer settings from backend
  useEffect(() => {
    fetch('/api/printer/settings')
      .then(res => res.json())
      .then(data => {
        if (data && data.printerName) {
          setPrinterForm(data);
        }
      })
      .catch(err => console.warn('Could not load printer settings:', err));

    fetch('/api/printer/jobs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRecentPrintJobs(data);
      })
      .catch(() => {});
  }, []);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSalonSettings(profileForm);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleSaveFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateWhatsAppSettings(feedbackForm);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleSavePrinterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/printer/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-secure-token-2026',
        },
        body: JSON.stringify(printerForm),
      });
      if (res.ok) {
        setPrinterSaveSuccess(true);
        setTimeout(() => setPrinterSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.warn('Error saving printer settings:', err);
    }
  };

  const handleTestPrint = async () => {
    setTestPrintStatus('Dispatching ESC/POS test receipt with autocut to print queue...');
    try {
      const res = await fetch('/api/printer/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-secure-token-2026',
        },
        body: JSON.stringify({
          paperWidth: printerForm.paperWidth,
          autoCut: printerForm.autoCut,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestPrintStatus(`Test print job queued (Job ID: ${data.job?.id || 'pjob-test'}). Ready for salon print agent!`);
        // Refresh queue
        fetch('/api/printer/jobs')
          .then(r => r.json())
          .then(d => Array.isArray(d) && setRecentPrintJobs(d))
          .catch(() => {});
      } else {
        setTestPrintStatus(`Test print error: ${data.error || 'Check printer agent'}`);
      }
    } catch (err: any) {
      setTestPrintStatus(`Print job error: ${err.message}`);
    }
    setTimeout(() => setTestPrintStatus(null), 5000);
  };

  const handleReprintLastInvoice = async () => {
    setTestPrintStatus('Fetching latest bill to generate duplicate thermal receipt...');
    try {
      const res = await fetch('/api/printer/reprint/latest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-secure-token-2026',
        },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestPrintStatus(`Reprint job created for invoice ${data.invoiceNumber}! Status: PENDING.`);
        fetch('/api/printer/jobs')
          .then(r => r.json())
          .then(d => Array.isArray(d) && setRecentPrintJobs(d))
          .catch(() => {});
      } else {
        setTestPrintStatus(data.error || 'No invoices found to reprint.');
      }
    } catch (err: any) {
      setTestPrintStatus(`Reprint error: ${err.message}`);
    }
    setTimeout(() => setTestPrintStatus(null), 5000);
  };

  const existingUsers = getAdminUsers();

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">Salon Administration & Configuration</h2>
          <p className="text-xs text-stone-500">
            Configure studio details, WhatsApp feedback automation, thermal receipt printers, and security audit logs.
          </p>
        </div>
      </div>

      {/* TABS */}
      <div className="flex items-center gap-2 border-b border-stone-200 pb-2 text-xs overflow-x-auto">
        {[
          { id: 'profile', label: 'Salon Profile & Hours', icon: Store },
          { id: 'google', label: 'Google Business Profile', icon: MapPin },
          { id: 'feedback', label: 'Feedback Automation', icon: MessageSquareHeart },
          { id: 'printer', label: 'Thermal Printer Settings', icon: Printer },
          { id: 'audit', label: `Audit Logs (${auditLogs.length})`, icon: FileText },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-medium whitespace-nowrap transition-all cursor-pointer ${
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

      {/* TAB 1: SALON PROFILE */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6">
          <div className="border-b border-stone-100 pb-3">
            <h3 className="font-serif font-bold text-base text-[#2D2424]">Salon Business Information</h3>
            <p className="text-xs text-stone-500">These details appear on customer invoices and booking confirmations</p>
          </div>

          {saveSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Salon profile settings saved successfully!</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Business Name *</label>
              <input
                type="text"
                required
                value={profileForm.businessName}
                onChange={(e) => setProfileForm({ ...profileForm, businessName: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Salon Subtitle / Type</label>
              <input
                type="text"
                disabled
                value="Professional Women Salon"
                className="w-full p-2.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-700 font-medium"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-stone-700 mb-1">Studio Address *</label>
              <input
                type="text"
                required
                value={profileForm.address}
                onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
              />
              <p className="text-[11px] text-stone-400 mt-1">31, Vinayak Nagar, Gachibowli, Hyderabad, Telangana 500032</p>
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Telephone Contact *</label>
              <input
                type="tel"
                required
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Official Email *</label>
              <input
                type="email"
                required
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">WhatsApp Reception Number</label>
              <input
                type="tel"
                value={profileForm.whatsappNumber}
                onChange={(e) => setProfileForm({ ...profileForm, whatsappNumber: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Opening Time</label>
                <input
                  type="time"
                  value={profileForm.openingTime}
                  onChange={(e) => setProfileForm({ ...profileForm, openingTime: e.target.value })}
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Closing Time</label>
                <input
                  type="time"
                  value={profileForm.closingTime}
                  onChange={(e) => setProfileForm({ ...profileForm, closingTime: e.target.value })}
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-stone-100">
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Profile Changes</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: GOOGLE BUSINESS PROFILE */}
      {activeTab === 'google' && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-5 text-xs">
          <div className="border-b border-stone-100 pb-3">
            <h3 className="font-serif font-bold text-base text-[#2D2424]">Google Local Business & Maps</h3>
            <p className="text-xs text-stone-500">Maps direction links and Google review destinations for satisfied clients</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Google Maps Direction URL</label>
              <input
                type="url"
                value={profileForm.googleMapsUrl}
                onChange={(e) => setProfileForm({ ...profileForm, googleMapsUrl: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Google Review URL (Dispatched to 'Good' Ratings)</label>
              <input
                type="url"
                value={profileForm.googleReviewUrl}
                onChange={(e) => setProfileForm({ ...profileForm, googleReviewUrl: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-stone-100">
            <button
              type="button"
              onClick={handleSaveProfile}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8C3A42] text-white font-medium text-xs"
            >
              <Save className="w-4 h-4" />
              <span>Save URLs</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: FEEDBACK AUTOMATION */}
      {activeTab === 'feedback' && (
        <form onSubmit={handleSaveFeedback} className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-5 text-xs">
          <div className="border-b border-stone-100 pb-3">
            <h3 className="font-serif font-bold text-base text-[#2D2424]">Meta WhatsApp Review Automation Engine</h3>
            <p className="text-xs text-stone-500">3-Tier automated logic: Good ➔ Google Review, Average ➔ Feedback, Bad ➔ Manager Followup</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-stone-50 border border-stone-200">
              <input
                type="checkbox"
                id="waEnabled"
                checked={feedbackForm.enabled}
                onChange={(e) => setFeedbackForm({ ...feedbackForm, enabled: e.target.checked })}
                className="rounded text-[#8C3A42] focus:ring-[#8C3A42]"
              />
              <label htmlFor="waEnabled" className="font-semibold text-stone-800">
                Enable Automated WhatsApp Feedback Prompts after Appointment Completion
              </label>
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Approved Meta Template Name</label>
              <input
                type="text"
                value={feedbackForm.templateName}
                onChange={(e) => setFeedbackForm({ ...feedbackForm, templateName: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white font-mono text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Delay After Appointment Completion (Minutes)</label>
              <select
                value={feedbackForm.delayMinutes}
                onChange={(e) => setFeedbackForm({ ...feedbackForm, delayMinutes: Number(e.target.value) })}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white text-xs"
              >
                <option value={15}>15 Minutes</option>
                <option value={30}>30 Minutes (Recommended)</option>
                <option value={60}>1 Hour</option>
                <option value={120}>2 Hours</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-stone-100">
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8C3A42] text-white font-medium text-xs"
            >
              <Save className="w-4 h-4" />
              <span>Save Feedback Settings</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: THERMAL PRINTER SETTINGS (MOZZ RESTAURANT-GRADE ARCHITECTURE) */}
      {activeTab === 'printer' && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6 text-xs">
          <div className="border-b border-stone-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2D2424]">Thermal Receipt Printer Setup</h3>
              <p className="text-xs text-stone-500">
                Support for 3-inch (80mm) and 4-inch (104mm) ESC/POS autocut thermal printers via salon print-agent bridge
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestPrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold text-xs border border-stone-300 transition-colors cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-600" />
                <span>Test Print</span>
              </button>

              <button
                type="button"
                onClick={handleReprintLastInvoice}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold text-xs border border-stone-300 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
                <span>Reprint Last Invoice</span>
              </button>
            </div>
          </div>

          {printerSaveSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Printer settings saved successfully!</span>
            </div>
          )}

          {testPrintStatus && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center gap-2">
              <Printer className="w-4 h-4 text-blue-600 shrink-0" />
              <span>{testPrintStatus}</span>
            </div>
          )}

          <form onSubmit={handleSavePrinterSettings} className="space-y-4">
            
            {/* Enable toggle */}
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-stone-50 border border-stone-200">
              <input
                type="checkbox"
                id="printerEnabled"
                checked={printerForm.enabled}
                onChange={(e) => setPrinterForm({ ...printerForm, enabled: e.target.checked })}
                className="rounded text-[#8C3A42] focus:ring-[#8C3A42] w-4 h-4"
              />
              <label htmlFor="printerEnabled" className="font-semibold text-stone-800 text-xs cursor-pointer">
                Enable Thermal POS Receipt Printing for Walk-In & Billing Orders
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Printer Name */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Printer Device Name *</label>
                <input
                  type="text"
                  required
                  value={printerForm.printerName}
                  onChange={(e) => setPrinterForm({ ...printerForm, printerName: e.target.value })}
                  placeholder="e.g. POS-80C Thermal Printer, Epson TM-T82"
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
                />
              </div>

              {/* Connection Type */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Printer Architecture / Connection</label>
                <select
                  value={printerForm.connectionType}
                  onChange={(e) => setPrinterForm({ ...printerForm, connectionType: e.target.value as any })}
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
                >
                  <option value="local_agent">Salon Print Agent / Bridge (Recommended - Silent ESC/POS)</option>
                  <option value="browser_direct">Browser Direct System Dialog (Formatted 80mm)</option>
                  <option value="network_ip">Network Thermal Printer (IP Socket 9100)</option>
                </select>
              </div>

              {/* Paper Width (3inch vs 4inch) */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Paper Roll Width *</label>
                <select
                  value={printerForm.paperWidth}
                  onChange={(e) => setPrinterForm({ ...printerForm, paperWidth: e.target.value as any })}
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white font-semibold text-stone-800"
                >
                  <option value="3inch">3-Inch Thermal Paper (Approx. 80mm standard roll)</option>
                  <option value="4inch">4-Inch Thermal Paper (Approx. 104mm / 112mm wide roll)</option>
                </select>
              </div>

              {/* Number of copies */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Number of Receipt Copies</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={printerForm.copies}
                  onChange={(e) => setPrinterForm({ ...printerForm, copies: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-lg border border-stone-300 bg-white"
                />
              </div>

              {/* Auto print & Autocut toggles */}
              <div className="flex items-center gap-3 p-3 rounded-lg border border-stone-200 bg-stone-50">
                <input
                  type="checkbox"
                  id="autoPrintCheck"
                  checked={printerForm.autoPrint}
                  onChange={(e) => setPrinterForm({ ...printerForm, autoPrint: e.target.checked })}
                  className="rounded text-[#8C3A42]"
                />
                <label htmlFor="autoPrintCheck" className="text-stone-800 font-medium">
                  Auto-print bill immediately upon successful payment
                </label>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border border-stone-200 bg-stone-50">
                <input
                  type="checkbox"
                  id="autoCutCheck"
                  checked={printerForm.autoCut}
                  onChange={(e) => setPrinterForm({ ...printerForm, autoCut: e.target.checked })}
                  className="rounded text-[#8C3A42]"
                />
                <label htmlFor="autoCutCheck" className="text-stone-800 font-medium">
                  Send ESC/POS Auto-Cut Command (<code className="font-mono text-[10px] text-[#8C3A42]">GS V 66 0</code>)
                </label>
              </div>

            </div>

            {/* Print Agent Bridge Information */}
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-stone-600">
              <span className="font-semibold text-stone-800 block text-xs">
                Local Salon Print-Agent Bridge Architecture
              </span>
              <p className="text-[11px] leading-relaxed text-stone-600">
                Whenever a walk-in or appointment bill is marked PAID, a print job is deposited in the salon print queue.
                The local salon bridge software polls <code className="bg-stone-200 px-1 py-0.5 rounded text-[10px] font-mono">/api/printer/jobs/pending</code> and executes native hardware ESC/POS commands directly to your USB thermal printer.
              </p>
            </div>

            <div className="flex justify-end pt-3 border-t border-stone-100">
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Save Printer Configuration</span>
              </button>
            </div>
          </form>

          {/* Live Print Queue Table */}
          <div className="border border-stone-200 rounded-xl overflow-hidden pt-3 bg-stone-50">
            <div className="px-4 pb-2 flex justify-between items-center">
              <h4 className="font-semibold text-xs text-stone-800">Recent Print Jobs & Queue Status</h4>
              <span className="text-[10px] text-stone-500 font-mono">Queue Polling Active</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] bg-white">
                <thead className="bg-stone-100 text-stone-600 border-y border-stone-200 font-semibold">
                  <tr>
                    <th className="py-2 px-3">Job ID</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Width</th>
                    <th className="py-2 px-3">Autocut</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {recentPrintJobs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-4 text-stone-400">
                        No recent print jobs recorded in queue.
                      </td>
                    </tr>
                  ) : (
                    recentPrintJobs.slice(0, 5).map((job) => (
                      <tr key={job.id}>
                        <td className="py-2 px-3 font-mono font-bold text-[#8C3A42]">{job.id}</td>
                        <td className="py-2 px-3 uppercase text-stone-700">{job.type}</td>
                        <td className="py-2 px-3">{job.paperWidth}</td>
                        <td className="py-2 px-3">{job.autoCut ? 'Yes' : 'No'}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            job.status === 'printed' 
                              ? 'bg-emerald-100 text-emerald-800' 
                              : (job.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')
                          }`}>
                            {job.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-stone-500">{new Date(job.createdAt).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-stone-200">
            <h3 className="font-serif font-bold text-base text-[#2D2424]">Administrative Security Audit Trail</h3>
            <p className="text-xs text-stone-500">Full audit log of login events, appointment completions, and billing activities</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Entity</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {auditLogs.map(log => (
                  <tr key={log.id} className="hover:bg-stone-50/80">
                    <td className="py-2.5 px-4 whitespace-nowrap text-stone-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-[#2D2424] whitespace-nowrap">
                      {log.actorName} ({log.actorRole})
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="font-medium text-stone-800 bg-stone-100 px-2 py-0.5 rounded text-[10px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-stone-600 whitespace-nowrap">
                      {log.entity} #{log.entityId.slice(-6)}
                    </td>
                    <td className="py-2.5 px-4 text-stone-600">
                      {log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
};
