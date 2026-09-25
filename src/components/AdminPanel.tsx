import React, { useState } from 'react';
import { 
  Sparkles, 
  Calendar, 
  Receipt, 
  UploadCloud, 
  MessageCircle, 
  Scissors, 
  Plus, 
  Search, 
  CheckCircle2, 
  Clock, 
  Phone, 
  User, 
  Trash2, 
  Eye, 
  FileText, 
  Printer, 
  TrendingUp, 
  Check, 
  X, 
  Image as ImageIcon, 
  Video as VideoIcon, 
  DollarSign,
  Send,
  AlertCircle
} from 'lucide-react';
import { 
  SalonService, 
  Artist, 
  GalleryWork, 
  Appointment, 
  BillOrder, 
  CustomerEnquiry, 
  RetailProduct,
  BillItem
} from '../types/salon';
import { SALON_INFO } from '../data/initialData';
import { 
  openWhatsApp, 
  getAppointmentReminderMessage, 
  getAppointmentWhatsAppMessage,
  getInvoiceWhatsAppMessage,
  getEnquiryFollowUpMessage,
  getFeedbackFollowUpMessage
} from '../utils/whatsapp';

interface AdminPanelProps {
  services: SalonService[];
  artists: Artist[];
  galleryItems: GalleryWork[];
  appointments: Appointment[];
  bills: BillOrder[];
  enquiries: CustomerEnquiry[];
  retailProducts: RetailProduct[];
  onAddGalleryWork: (work: GalleryWork) => void;
  onDeleteGalleryWork: (id: string) => void;
  onUpdateAppointmentStatus: (id: string, status: Appointment['status']) => void;
  onAddAppointment: () => void;
  onCreateBill: (bill: BillOrder) => void;
  onUpdateEnquiry: (id: string, status: CustomerEnquiry['status'], followUpNotes?: string) => void;
  onAddService: (service: SalonService) => void;
  onViewInvoice: (bill: BillOrder) => void;
  onCloseAdmin: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  services,
  artists,
  galleryItems,
  appointments,
  bills,
  enquiries,
  retailProducts,
  onAddGalleryWork,
  onDeleteGalleryWork,
  onUpdateAppointmentStatus,
  onAddAppointment,
  onCreateBill,
  onUpdateEnquiry,
  onAddService,
  onViewInvoice,
  onCloseAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'appointments' | 'billing' | 'uploader' | 'enquiries' | 'services'>('dashboard');

  // Search & filter states
  const [aptSearch, setAptSearch] = useState('');
  const [aptStatusFilter, setAptStatusFilter] = useState<string>('all');
  const [billSearch, setBillSearch] = useState('');
  const [enqStatusFilter, setEnqStatusFilter] = useState<string>('all');

  // New Bill POS Form State
  const [billCustomerName, setBillCustomerName] = useState('');
  const [billCustomerPhone, setBillCustomerPhone] = useState('');
  const [billCustomerEmail, setBillCustomerEmail] = useState('');
  const [billStaffName, setBillStaffName] = useState('Pooja (Front Desk)');
  const [selectedItems, setSelectedItems] = useState<BillItem[]>([]);
  const [billDiscount, setBillDiscount] = useState<number>(0);
  const [billTaxIncluded, setBillTaxIncluded] = useState<boolean>(true);
  const [billTip, setBillTip] = useState<number>(0);
  const [billPaymentMode, setBillPaymentMode] = useState<BillOrder['paymentMode']>('UPI');
  const [billNotes, setBillNotes] = useState('');
  const [showPosSuccess, setShowPosSuccess] = useState(false);

  // Artist Uploader Form State
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadArtistId, setUploadArtistId] = useState(artists[0]?.id || 'art-1');
  const [uploadMediaType, setUploadMediaType] = useState<'image' | 'video'>('image');
  const [uploadMediaUrl, setUploadMediaUrl] = useState('');
  const [uploadThumbnailUrl, setUploadThumbnailUrl] = useState('');
  const [uploadCategory, setUploadCategory] = useState<GalleryWork['category']>('Bridal');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTagsStr, setUploadTagsStr] = useState('Bridal, HD Makeup, Airbrush');
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState('');

  // New Service Form State
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceCategory, setNewServiceCategory] = useState<SalonService['category']>('Threading & Waxing');
  const [newServicePrice, setNewServicePrice] = useState<number>(2500);
  const [newServiceDuration, setNewServiceDuration] = useState<number>(60);
  const [newServiceDesc, setNewServiceDesc] = useState('');
  const [newServiceTier, setNewServiceTier] = useState<SalonService['tier']>('Signature');
  const [serviceAddedSuccess, setServiceAddedSuccess] = useState('');

  // File reader preview handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    setUploadMediaType(isVideo ? 'video' : 'image');

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadMediaUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Submit Artist Work
  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle.trim() || !uploadMediaUrl.trim()) return;

    const artistObj = artists.find((a) => a.id === uploadArtistId);
    const tags = uploadTagsStr.split(',').map((t) => t.trim()).filter(Boolean);

    const newWork: GalleryWork = {
      id: `gw-${Date.now()}`,
      title: uploadTitle.trim(),
      artistId: uploadArtistId,
      artistName: artistObj ? artistObj.name : 'Master Stylist',
      mediaType: uploadMediaType,
      mediaUrl: uploadMediaUrl,
      thumbnailUrl: uploadMediaType === 'video' ? (uploadThumbnailUrl || 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=600&q=80') : undefined,
      category: uploadCategory,
      description: uploadDescription.trim() || 'Transformative artistry crafted at Glossy Looks Women Salon.',
      tags: tags.length ? tags : ['Artistry', 'Glossy Looks'],
      likes: 1,
      createdAt: new Date().toISOString().split('T')[0],
      featured: true,
    };

    onAddGalleryWork(newWork);
    setUploadSuccessMsg('✨ Work successfully published to the live Gallery!');
    setUploadTitle('');
    setUploadMediaUrl('');
    setUploadThumbnailUrl('');
    setUploadDescription('');
    setTimeout(() => setUploadSuccessMsg(''), 4000);
  };

  // Add Item to Current Bill
  const addItemToBill = (item: { name: string; type: 'service' | 'product'; price: number }, stylist?: string) => {
    setSelectedItems((prev) => {
      const existing = prev.find((i) => i.name === item.name);
      if (existing) {
        return prev.map((i) => (i.name === item.name ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...prev,
        {
          id: `bi-${Date.now()}-${Math.random()}`,
          name: item.name,
          type: item.type,
          price: item.price,
          quantity: 1,
          stylistName: stylist || 'Priya Sharma',
        },
      ];
    });
  };

  const removeItemFromBill = (id: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.id !== id));
  };

  const updateItemQty = (id: string, delta: number) => {
    setSelectedItems((prev) =>
      prev
        .map((i) => {
          if (i.id === id) {
            const newQty = i.quantity + delta;
            return newQty > 0 ? { ...i, quantity: newQty } : null;
          }
          return i;
        })
        .filter(Boolean) as BillItem[]
    );
  };

  // Bill Calculations
  const billSubtotal = selectedItems.reduce((acc, curr) => acc + curr.price * curr.quantity, 0);
  const billTaxAmount = billTaxIncluded ? Math.round(billSubtotal * 0.05 * 100) / 100 : 0;
  const billGrandTotal = Math.max(0, billSubtotal - billDiscount + billTaxAmount + Number(billTip || 0));

  // Handle Create Bill Submit
  const handleCreateBillSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!billCustomerName.trim() || !billCustomerPhone.trim()) {
      alert('Please enter customer name and phone number.');
      return;
    }
    if (selectedItems.length === 0) {
      alert('Please add at least one service or retail product to the bill.');
      return;
    }

    const newInvoiceNo = `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const formattedDate = `${now.toISOString().split('T')[0]} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const newBill: BillOrder = {
      id: `bill-${Date.now()}`,
      invoiceNumber: newInvoiceNo,
      customerName: billCustomerName.trim(),
      customerPhone: billCustomerPhone.trim(),
      customerEmail: billCustomerEmail.trim() || undefined,
      items: selectedItems,
      subtotal: billSubtotal,
      discountAmount: Number(billDiscount || 0),
      taxAmount: billTaxAmount,
      tipAmount: Number(billTip || 0),
      grandTotal: billGrandTotal,
      paymentMode: billPaymentMode,
      paymentStatus: 'Paid',
      staffName: billStaffName,
      createdAt: formattedDate,
      notes: billNotes.trim() || undefined,
    };

    onCreateBill(newBill);
    setShowPosSuccess(true);
    // Reset form
    setBillCustomerName('');
    setBillCustomerPhone('');
    setBillCustomerEmail('');
    setSelectedItems([]);
    setBillDiscount(0);
    setBillTip(0);
    setBillNotes('');

    // Open WhatsApp invoice dispatch option
    const msg = getInvoiceWhatsAppMessage(newBill);
    setTimeout(() => {
      setShowPosSuccess(false);
      onViewInvoice(newBill);
    }, 1200);
  };

  // Add Service Submit
  const handleAddServiceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServiceName.trim()) return;

    const newSrv: SalonService = {
      id: `srv-${Date.now()}`,
      name: newServiceName.trim(),
      category: newServiceCategory,
      price: Number(newServicePrice),
      durationMinutes: Number(newServiceDuration),
      description: newServiceDesc.trim() || 'Signature salon treatment with organic ingredients.',
      tier: newServiceTier,
      popular: false,
      image: 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=600&q=80',
    };

    onAddService(newSrv);
    setServiceAddedSuccess('Service successfully added to menu!');
    setNewServiceName('');
    setNewServiceDesc('');
    setTimeout(() => setServiceAddedSuccess(''), 3000);
  };

  // Total Metrics calculations
  const totalRevenue = bills.reduce((acc, b) => acc + b.grandTotal, 0);
  const pendingAppointments = appointments.filter((a) => a.status === 'pending');
  const todayAppointments = appointments.filter((a) => a.date === new Date().toISOString().split('T')[0]);
  const newEnquiries = enquiries.filter((e) => e.status === 'New');

  return (
    <div className="bg-[#FAF7F5] min-h-screen pb-16">
      
      {/* Admin Top Navigation Bar */}
      <div className="bg-[#2D2424] text-white border-b border-[#3D3232] sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#E5B5B7] text-[#2D2424] flex items-center justify-center font-bold text-sm">
                GL
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-serif-luxury text-lg font-bold">Glossy Looks Staff & Artist Suite</h1>
                  <span className="text-[10px] bg-[#3E3232] text-[#E5B5B7] px-2 py-0.5 rounded-full border border-[#524444]">
                    Manager Portal
                  </span>
                </div>
                <p className="text-[11px] text-[#A89898]">Appointments • POS Billing • Gallery Upload • WhatsApp CRM</p>
              </div>
            </div>

            <button
              onClick={onCloseAdmin}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <span>Back to Customer View</span>
              <X className="w-4 h-4" />
            </button>

          </div>

          {/* Sub Navigation Tabs */}
          <div className="flex overflow-x-auto space-x-1 pb-2 pt-1 scrollbar-none text-xs">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === 'dashboard' ? 'bg-[#FAF7F5] text-[#2D2424] font-bold' : 'text-[#D8C7C7] hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5 text-[#8C3A42]" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('appointments')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === 'appointments' ? 'bg-[#FAF7F5] text-[#2D2424] font-bold' : 'text-[#D8C7C7] hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-[#8C3A42]" />
              <span>Appointments Desk</span>
              {pendingAppointments.length > 0 && (
                <span className="bg-[#8C3A42] text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {pendingAppointments.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('billing')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === 'billing' ? 'bg-[#FAF7F5] text-[#2D2424] font-bold' : 'text-[#D8C7C7] hover:text-white'
              }`}
            >
              <Receipt className="w-3.5 h-3.5 text-[#8C3A42]" />
              <span>POS Billing & Orders</span>
            </button>

            <button
              onClick={() => setActiveTab('uploader')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === 'uploader' ? 'bg-[#FAF7F5] text-[#2D2424] font-bold' : 'text-[#D8C7C7] hover:text-white'
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5 text-[#8C3A42]" />
              <span>Artist Work Uploader</span>
            </button>

            <button
              onClick={() => setActiveTab('enquiries')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === 'enquiries' ? 'bg-[#FAF7F5] text-[#2D2424] font-bold' : 'text-[#D8C7C7] hover:text-white'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5 text-[#8C3A42]" />
              <span>Enquiries & WhatsApp CRM</span>
              {newEnquiries.length > 0 && (
                <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {newEnquiries.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('services')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === 'services' ? 'bg-[#FAF7F5] text-[#2D2424] font-bold' : 'text-[#D8C7C7] hover:text-white'
              }`}
            >
              <Scissors className="w-3.5 h-3.5 text-[#8C3A42]" />
              <span>Services Editor</span>
            </button>
          </div>

        </div>
      </div>

      {/* Main Tab Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* TAB 1: OVERVIEW DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in duration-200">
            
            {/* Quick Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              
              <div className="bg-white p-5 rounded-2xl border border-[#E6DDD8] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-[#7A6B6B]">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Sales Billed</span>
                  <DollarSign className="w-4 h-4 text-[#8C3A42]" />
                </div>
                <p className="font-serif-luxury text-3xl font-bold text-[#2D2424]">
                  {SALON_INFO.currency}{totalRevenue.toLocaleString('en-IN')}
                </p>
                <p className="text-[11px] text-emerald-700 font-medium">
                  {bills.length} Invoices generated & paid
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-[#E6DDD8] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-[#7A6B6B]">
                  <span className="text-xs font-semibold uppercase tracking-wider">Active Bookings</span>
                  <Calendar className="w-4 h-4 text-[#8C3A42]" />
                </div>
                <p className="font-serif-luxury text-3xl font-bold text-[#2D2424]">
                  {appointments.length}
                </p>
                <p className="text-[11px] text-[#8C3A42] font-medium">
                  {pendingAppointments.length} pending review • {todayAppointments.length} scheduled today
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-[#E6DDD8] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-[#7A6B6B]">
                  <span className="text-xs font-semibold uppercase tracking-wider">Customer Enquiries</span>
                  <MessageCircle className="w-4 h-4 text-[#22C55E]" />
                </div>
                <p className="font-serif-luxury text-3xl font-bold text-[#2D2424]">
                  {enquiries.length}
                </p>
                <p className="text-[11px] text-emerald-700 font-medium">
                  {newEnquiries.length} require WhatsApp follow-up
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-[#E6DDD8] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-[#7A6B6B]">
                  <span className="text-xs font-semibold uppercase tracking-wider">Portfolio Works</span>
                  <UploadCloud className="w-4 h-4 text-[#8C3A42]" />
                </div>
                <p className="font-serif-luxury text-3xl font-bold text-[#2D2424]">
                  {galleryItems.length}
                </p>
                <p className="text-[11px] text-[#7A6B6B]">
                  Photos & reels live in customer gallery
                </p>
              </div>

            </div>

            {/* Quick Actions Shortcuts */}
            <div className="bg-white rounded-2xl p-6 border border-[#E6DDD8] space-y-4">
              <h3 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                Staff Fast Actions
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button
                  onClick={() => setActiveTab('billing')}
                  className="flex items-center gap-3 p-4 rounded-xl bg-[#FAF7F5] hover:bg-[#FAF0F1] border border-[#E8DDD8] hover:border-[#E8C5C8] text-left transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-[#FAF0F1] text-[#8C3A42] flex items-center justify-center shrink-0">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#2D2424]">Create Walk-in Bill</p>
                    <p className="text-[11px] text-[#7A6B6B]">Generate invoice & send to WhatsApp</p>
                  </div>
                </button>

                <button
                  onClick={() => onAddAppointment()}
                  className="flex items-center gap-3 p-4 rounded-xl bg-[#FAF7F5] hover:bg-[#FAF0F1] border border-[#E8DDD8] hover:border-[#E8C5C8] text-left transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-[#FAF0F1] text-[#8C3A42] flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#2D2424]">Book Client Slot</p>
                    <p className="text-[11px] text-[#7A6B6B]">Schedule phone or walk-in appointment</p>
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('uploader')}
                  className="flex items-center gap-3 p-4 rounded-xl bg-[#FAF7F5] hover:bg-[#FAF0F1] border border-[#E8DDD8] hover:border-[#E8C5C8] text-left transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-[#FAF0F1] text-[#8C3A42] flex items-center justify-center shrink-0">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#2D2424]">Upload Artist Work</p>
                    <p className="text-[11px] text-[#7A6B6B]">Publish photos or bridal reels</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Recent Appointments & Recent Bills Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Today's / Upcoming Appointments */}
              <div className="bg-white rounded-2xl p-5 border border-[#E6DDD8] space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-[#E8DDD8]">
                  <h4 className="font-serif-luxury text-base font-bold text-[#2D2424]">
                    Upcoming Schedule
                  </h4>
                  <button
                    onClick={() => setActiveTab('appointments')}
                    className="text-xs text-[#8C3A42] font-semibold hover:underline"
                  >
                    View All ({appointments.length}) →
                  </button>
                </div>

                <div className="space-y-2">
                  {appointments.slice(0, 4).map((apt) => (
                    <div
                      key={apt.id}
                      className="p-3 rounded-xl bg-[#FAF7F5] border border-[#EDE1DD] flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#2D2424]">{apt.customerName}</span>
                          <span className="font-mono text-[10px] text-[#8C3A42]">{apt.referenceCode}</span>
                        </div>
                        <p className="text-[#6B5A5A] text-[11px] line-clamp-1">{apt.serviceNames.join(', ')}</p>
                        <p className="text-[#7A6B6B] text-[10px]">
                          {apt.date} at {apt.timeSlot} • Stylist: {apt.artistName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            apt.status === 'confirmed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : apt.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {apt.status}
                        </span>
                        <button
                          onClick={() => {
                            const msg = getAppointmentReminderMessage(apt);
                            openWhatsApp(apt.customerPhone, msg);
                          }}
                          className="text-[10px] text-[#25D366] hover:underline font-semibold flex items-center gap-1"
                        >
                          <MessageCircle className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Bills & Invoices */}
              <div className="bg-white rounded-2xl p-5 border border-[#E6DDD8] space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-[#E8DDD8]">
                  <h4 className="font-serif-luxury text-base font-bold text-[#2D2424]">
                    Recent Invoices
                  </h4>
                  <button
                    onClick={() => setActiveTab('billing')}
                    className="text-xs text-[#8C3A42] font-semibold hover:underline"
                  >
                    Billing Desk ({bills.length}) →
                  </button>
                </div>

                <div className="space-y-2">
                  {bills.slice(0, 4).map((bill) => (
                    <div
                      key={bill.id}
                      className="p-3 rounded-xl bg-[#FAF7F5] border border-[#EDE1DD] flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#2D2424]">{bill.customerName}</span>
                          <span className="font-mono text-[10px] text-[#7A6B6B]">{bill.invoiceNumber}</span>
                        </div>
                        <p className="text-[11px] text-[#6B5A5A]">
                          {bill.items.length} items • Paid via {bill.paymentMode}
                        </p>
                        <p className="text-[10px] text-[#7A6B6B]">{bill.createdAt}</p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className="font-serif-luxury font-bold text-sm text-[#8C3A42]">
                          {SALON_INFO.currency}{bill.grandTotal.toLocaleString('en-IN')}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onViewInvoice(bill)}
                            className="text-[11px] text-[#2D2424] hover:underline flex items-center gap-0.5"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View</span>
                          </button>
                          <button
                            onClick={() => {
                              const msg = getInvoiceWhatsAppMessage(bill);
                              openWhatsApp(bill.customerPhone, msg);
                            }}
                            className="text-[11px] text-[#25D366] hover:underline flex items-center gap-0.5"
                          >
                            <MessageCircle className="w-3 h-3" />
                            <span>Share</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* TAB 2: APPOINTMENTS DESK */}
        {activeTab === 'appointments' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            
            {/* Control Bar */}
            <div className="bg-white p-4 rounded-2xl border border-[#E6DDD8] flex flex-wrap items-center justify-between gap-4">
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative w-64">
                  <Search className="w-4 h-4 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by name, ref, phone..."
                    value={aptSearch}
                    onChange={(e) => setAptSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-[#FAF7F5] border border-[#D9C4BE] rounded-lg text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                  />
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1 text-xs">
                  {['all', 'pending', 'confirmed', 'completed', 'cancelled'].map((st) => (
                    <button
                      key={st}
                      onClick={() => setAptStatusFilter(st)}
                      className={`px-3 py-1 rounded-lg capitalize font-medium transition-colors ${
                        aptStatusFilter === st
                          ? 'bg-[#8C3A42] text-white'
                          : 'bg-[#FAF7F5] text-[#5A4B4B] hover:bg-[#F3ECE8]'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={onAddAppointment}
                className="flex items-center gap-1.5 bg-[#8C3A42] hover:bg-[#742F36] text-white py-2 px-4 rounded-xl text-xs font-semibold shadow-xs transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>New Walk-in / Phone Booking</span>
              </button>

            </div>

            {/* Appointments List */}
            <div className="bg-white rounded-2xl border border-[#E6DDD8] overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#FAF7F5] border-b border-[#E6DDD8] text-[#8C3A42] font-semibold">
                      <th className="py-3 px-4">Ref & Date</th>
                      <th className="py-3 px-4">Customer Details</th>
                      <th className="py-3 px-4">Services & Specialist</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Follow-up & Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDE1DD]">
                    {appointments
                      .filter((apt) => {
                        const matchesFilter = aptStatusFilter === 'all' || apt.status === aptStatusFilter;
                        const matchesSearch =
                          apt.customerName.toLowerCase().includes(aptSearch.toLowerCase()) ||
                          apt.referenceCode.toLowerCase().includes(aptSearch.toLowerCase()) ||
                          apt.customerPhone.includes(aptSearch);
                        return matchesFilter && matchesSearch;
                      })
                      .map((apt) => (
                        <tr key={apt.id} className="hover:bg-[#FAF7F5]/50 transition-colors">
                          <td className="py-3.5 px-4">
                            <span className="font-mono font-bold text-[#8C3A42]">{apt.referenceCode}</span>
                            <p className="text-[11px] text-[#2D2424] font-medium mt-0.5">{apt.date}</p>
                            <p className="text-[10px] text-[#7A6B6B]">{apt.timeSlot}</p>
                          </td>

                          <td className="py-3.5 px-4">
                            <p className="font-bold text-[#2D2424]">{apt.customerName}</p>
                            <p className="text-[#6B5A5A] text-[11px]">{apt.customerPhone}</p>
                            {apt.customerEmail && <p className="text-[10px] text-[#7A6B6B]">{apt.customerEmail}</p>}
                            <span className="text-[10px] text-[#8C3A42] font-semibold">
                              By {apt.bookedBy === 'staff' ? 'Front Desk Staff' : 'Customer Self-book'}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 max-w-xs">
                            <p className="font-medium text-[#2D2424]">{apt.serviceNames.join(', ')}</p>
                            <p className="text-[11px] text-[#8C3A42] mt-0.5">Specialist: {apt.artistName}</p>
                            {apt.notes && (
                              <p className="text-[10px] text-[#7A6B6B] italic mt-0.5">"{apt.notes}"</p>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right font-serif-luxury font-bold text-sm text-[#2D2424]">
                            {SALON_INFO.currency}{apt.totalAmount.toLocaleString('en-IN')}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            <select
                              value={apt.status}
                              onChange={(e) => onUpdateAppointmentStatus(apt.id, e.target.value as Appointment['status'])}
                              className={`text-[11px] font-semibold px-2 py-1 rounded-lg border focus:outline-none ${
                                apt.status === 'confirmed'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : apt.status === 'pending'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : apt.status === 'completed'
                                  ? 'bg-blue-50 text-blue-800 border-blue-300'
                                  : 'bg-red-50 text-red-800 border-red-300'
                              }`}
                            >
                              <option value="pending">Pending</option>
                              <option value="confirmed">Confirmed</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </td>

                          <td className="py-3.5 px-4 text-right space-y-1">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Send WhatsApp Reminder */}
                              <button
                                onClick={() => {
                                  const msg = getAppointmentReminderMessage(apt);
                                  openWhatsApp(apt.customerPhone, msg);
                                }}
                                title="Send reminder via WhatsApp"
                                className="px-2 py-1 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-md text-[11px] font-semibold flex items-center gap-1"
                              >
                                <MessageCircle className="w-3 h-3" />
                                <span>Remind</span>
                              </button>

                              {/* Create Bill Quick Shortcut */}
                              <button
                                onClick={() => {
                                  setBillCustomerName(apt.customerName);
                                  setBillCustomerPhone(apt.customerPhone);
                                  if (apt.customerEmail) setBillCustomerEmail(apt.customerEmail);
                                  // Pre-add services to bill
                                  const itemsToAdd: BillItem[] = apt.serviceNames.map((sName) => {
                                    const matchSrv = services.find((s) => s.name === sName);
                                    return {
                                      id: `bi-${Date.now()}-${Math.random()}`,
                                      name: sName,
                                      type: 'service',
                                      price: matchSrv ? matchSrv.price : 2000,
                                      quantity: 1,
                                      stylistName: apt.artistName,
                                    };
                                  });
                                  setSelectedItems(itemsToAdd);
                                  setActiveTab('billing');
                                }}
                                title="Bill this appointment"
                                className="px-2 py-1 bg-[#FAF7F5] border border-[#D9C4BE] hover:bg-[#FAF0F1] text-[#2D2424] rounded-md text-[11px] font-semibold flex items-center gap-1"
                              >
                                <Receipt className="w-3 h-3 text-[#8C3A42]" />
                                <span>Bill</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 3: POS BILLING & ORDERS */}
        {activeTab === 'billing' && (
          <div className="space-y-8 animate-in fade-in duration-200">
            
            {showPosSuccess && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <p className="text-xs font-semibold">
                  Invoice generated successfully! Generating preview and preparing WhatsApp share...
                </p>
              </div>
            )}

            {/* POS Billing Terminal: Left form, Right item picker */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Current Bill Summary & Checkout Form */}
              <div className="lg:col-span-6 bg-white rounded-2xl p-6 border border-[#E6DDD8] shadow-sm space-y-5">
                <div className="flex justify-between items-center pb-3 border-b border-[#E8DDD8]">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-[#8C3A42]" />
                    <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                      POS Register & Bill Generator
                    </h3>
                  </div>
                  <span className="text-xs text-[#7A6B6B] font-mono">
                    Terminal #1 • Active
                  </span>
                </div>

                <form onSubmit={handleCreateBillSubmit} className="space-y-4">
                  {/* Customer Information */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                        Customer Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Shalini Roy"
                        value={billCustomerName}
                        onChange={(e) => setBillCustomerName(e.target.value)}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                        WhatsApp Phone *
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="e.g. +91 98765 43210"
                        value={billCustomerPhone}
                        onChange={(e) => setBillCustomerPhone(e.target.value)}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                        Email (Optional)
                      </label>
                      <input
                        type="email"
                        placeholder="e.g. shalini@example.com"
                        value={billCustomerEmail}
                        onChange={(e) => setBillCustomerEmail(e.target.value)}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                        Handled By (Staff)
                      </label>
                      <input
                        type="text"
                        value={billStaffName}
                        onChange={(e) => setBillStaffName(e.target.value)}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      />
                    </div>
                  </div>

                  {/* Billed Items List */}
                  <div className="space-y-2 pt-2 border-t border-[#E8DDD8]">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-[#5A4B4B] uppercase tracking-wide">
                        Bill Items ({selectedItems.length})
                      </label>
                      {selectedItems.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedItems([])}
                          className="text-[11px] text-red-600 hover:underline"
                        >
                          Clear Items
                        </button>
                      )}
                    </div>

                    {selectedItems.length === 0 ? (
                      <div className="p-4 bg-[#FAF7F5] rounded-xl border border-dashed border-[#D9C8C4] text-center text-xs text-[#7A6B6B]">
                        Click services or retail items on the right panel to add them to this bill.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {selectedItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-2 rounded-lg bg-[#FAF7F5] border border-[#E3D6D2] text-xs"
                          >
                            <div className="flex-1 pr-2">
                              <p className="font-semibold text-[#2D2424]">{item.name}</p>
                              <p className="text-[10px] text-[#7A6B6B]">
                                {item.type} {item.stylistName ? `• ${item.stylistName}` : ''}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 bg-white border border-[#D9C4BE] rounded-md px-1.5 py-0.5">
                                <button
                                  type="button"
                                  onClick={() => updateItemQty(item.id, -1)}
                                  className="text-[#7A6B6B] hover:text-[#2D2424]"
                                >
                                  -
                                </button>
                                <span className="font-mono text-xs w-4 text-center">{item.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => updateItemQty(item.id, 1)}
                                  className="text-[#7A6B6B] hover:text-[#2D2424]"
                                >
                                  +
                                </button>
                              </div>

                              <span className="font-mono font-semibold w-16 text-right">
                                {SALON_INFO.currency}{(item.price * item.quantity).toLocaleString('en-IN')}
                              </span>

                              <button
                                type="button"
                                onClick={() => removeItemFromBill(item.id)}
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Discounts, Tax, Gratuity, Payment Mode */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#E8DDD8]">
                    <div className="space-y-1">
                      <label className="text-[11px] text-[#5A4B4B]">Discount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={billDiscount}
                        onChange={(e) => setBillDiscount(Number(e.target.value))}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-2.5 py-1.5 text-xs text-[#2D2424]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-[#5A4B4B]">Stylist Gratuity (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={billTip}
                        onChange={(e) => setBillTip(Number(e.target.value))}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-2.5 py-1.5 text-xs text-[#2D2424]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-[#5A4B4B]">Payment Mode</label>
                      <select
                        value={billPaymentMode}
                        onChange={(e) => setBillPaymentMode(e.target.value as BillOrder['paymentMode'])}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-2 py-1.5 text-xs text-[#2D2424]"
                      >
                        <option value="UPI">UPI / GPay / PhonePe</option>
                        <option value="Credit/Debit Card">Credit/Debit Card</option>
                        <option value="Cash">Cash at Counter</option>
                        <option value="Net Banking">Net Banking</option>
                      </select>
                    </div>
                  </div>

                  {/* Calculations Summary */}
                  <div className="p-3 bg-[#FAF7F5] rounded-xl border border-[#E3D6D2] space-y-1 text-xs">
                    <div className="flex justify-between text-[#6B5A5A]">
                      <span>Subtotal:</span>
                      <span className="font-mono">{SALON_INFO.currency}{billSubtotal.toLocaleString('en-IN')}</span>
                    </div>
                    {billDiscount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Discount:</span>
                        <span className="font-mono">-{SALON_INFO.currency}{billDiscount.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[#6B5A5A]">
                      <span>GST (5%):</span>
                      <span className="font-mono">{SALON_INFO.currency}{billTaxAmount.toLocaleString('en-IN')}</span>
                    </div>
                    {billTip > 0 && (
                      <div className="flex justify-between text-[#6B5A5A]">
                        <span>Stylist Tip:</span>
                        <span className="font-mono">{SALON_INFO.currency}{billTip.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[#D9C4BE] text-[#2D2424]">
                      <span>Grand Total:</span>
                      <span className="font-serif-luxury text-lg text-[#8C3A42] font-bold">
                        {SALON_INFO.currency}{billGrandTotal.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    id="generate-bill-btn"
                    className="w-full flex items-center justify-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white py-3 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    <span>Generate Bill & Send WhatsApp Invoice</span>
                  </button>

                </form>
              </div>

              {/* Right Column: Quick Item Catalogs (Services & Retail Products) */}
              <div className="lg:col-span-6 space-y-6">
                
                {/* Services Quick Picker */}
                <div className="bg-white rounded-2xl p-5 border border-[#E6DDD8] shadow-sm space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-[#E8DDD8]">
                    <h4 className="font-serif-luxury text-base font-bold text-[#2D2424]">
                      Salon Services Menu
                    </h4>
                    <span className="text-[11px] text-[#7A6B6B]">Click to add to bill</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                    {services.map((srv) => (
                      <div
                        key={srv.id}
                        onClick={() => addItemToBill({ name: srv.name, type: 'service', price: srv.price }, 'Priya Sharma')}
                        className="p-2.5 rounded-xl bg-[#FAF7F5] hover:bg-[#FAF0F1] hover:border-[#E8C5C8] border border-[#E8DDD8] cursor-pointer transition-colors flex items-center justify-between"
                      >
                        <div className="pr-2">
                          <p className="font-semibold text-xs text-[#2D2424] line-clamp-1">{srv.name}</p>
                          <p className="text-[10px] text-[#7A6B6B]">{srv.category} • {srv.durationMinutes}m</p>
                        </div>
                        <span className="font-mono font-bold text-xs text-[#8C3A42] whitespace-nowrap">
                          {SALON_INFO.currency}{srv.price.toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Retail Products Quick Picker */}
                <div className="bg-white rounded-2xl p-5 border border-[#E6DDD8] shadow-sm space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-[#E8DDD8]">
                    <h4 className="font-serif-luxury text-base font-bold text-[#2D2424]">
                      Salon Retail Products
                    </h4>
                    <span className="text-[11px] text-[#7A6B6B]">Serums, Shampoos, Kits</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {retailProducts.map((prod) => (
                      <div
                        key={prod.id}
                        onClick={() => addItemToBill({ name: prod.name, type: 'product', price: prod.price })}
                        className="p-2.5 rounded-xl bg-[#FAF7F5] hover:bg-[#FAF0F1] hover:border-[#E8C5C8] border border-[#E8DDD8] cursor-pointer transition-colors flex items-center justify-between"
                      >
                        <div className="pr-2">
                          <p className="font-semibold text-xs text-[#2D2424] line-clamp-1">{prod.name}</p>
                          <p className="text-[10px] text-[#7A6B6B]">{prod.brand} • In Stock: {prod.stock}</p>
                        </div>
                        <span className="font-mono font-bold text-xs text-[#8C3A42] whitespace-nowrap">
                          {SALON_INFO.currency}{prod.price.toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>

            {/* Invoices History Table */}
            <div className="bg-white rounded-2xl p-6 border border-[#E6DDD8] shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8DDD8]">
                <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                  Past Invoices & Receipts ({bills.length})
                </h3>

                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search invoices..."
                    value={billSearch}
                    onChange={(e) => setBillSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-[#FAF7F5] border border-[#D9C4BE] rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#FAF7F5] text-[#8C3A42] font-semibold border-b border-[#E6DDD8]">
                      <th className="py-2.5 px-3">Invoice #</th>
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3">Date & Time</th>
                      <th className="py-2.5 px-3">Items</th>
                      <th className="py-2.5 px-3">Payment</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDE1DD]">
                    {bills
                      .filter((b) =>
                        b.invoiceNumber.toLowerCase().includes(billSearch.toLowerCase()) ||
                        b.customerName.toLowerCase().includes(billSearch.toLowerCase()) ||
                        b.customerPhone.includes(billSearch)
                      )
                      .map((bill) => (
                        <tr key={bill.id} className="hover:bg-[#FAF7F5]/60 transition-colors">
                          <td className="py-3 px-3 font-mono font-bold text-[#8C3A42]">{bill.invoiceNumber}</td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-[#2D2424]">{bill.customerName}</p>
                            <p className="text-[10px] text-[#7A6B6B]">{bill.customerPhone}</p>
                          </td>
                          <td className="py-3 px-3 text-[#5A4B4B]">{bill.createdAt}</td>
                          <td className="py-3 px-3 text-[#5A4B4B]">{bill.items.length} items</td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                              {bill.paymentMode} ({bill.paymentStatus})
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-serif-luxury font-bold text-sm text-[#2D2424]">
                            {SALON_INFO.currency}{bill.grandTotal.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => onViewInvoice(bill)}
                                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#FAF7F5] border border-[#D9C4BE] hover:bg-[#F0EAE6] text-[#2D2424] flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3 text-[#8C3A42]" />
                                <span>Receipt</span>
                              </button>
                              <button
                                onClick={() => {
                                  const msg = getInvoiceWhatsAppMessage(bill);
                                  openWhatsApp(bill.customerPhone, msg);
                                }}
                                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#25D366] text-white hover:bg-[#20bd5a] flex items-center gap-1"
                              >
                                <MessageCircle className="w-3 h-3" />
                                <span>WhatsApp</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        )}

        {/* TAB 4: ARTIST WORK UPLOADER */}
        {activeTab === 'uploader' && (
          <div className="space-y-8 animate-in fade-in duration-200">
            
            {uploadSuccessMsg && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 text-xs font-semibold">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>{uploadSuccessMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Upload Form */}
              <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-[#E6DDD8] shadow-sm space-y-5">
                <div className="flex items-center gap-2 pb-3 border-b border-[#E8DDD8]">
                  <UploadCloud className="w-5 h-5 text-[#8C3A42]" />
                  <div>
                    <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                      Makeup Artist & Stylist Work Uploader
                    </h3>
                    <p className="text-[11px] text-[#7A6B6B]">
                      Upload photos or video reels from client transformations to display instantly in the live gallery
                    </p>
                  </div>
                </div>

                <form onSubmit={handleUploadSubmit} className="space-y-4">
                  
                  {/* Title */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                      Work Title / Look Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Royal Airbrush Bridal Makeover & Floral Updo"
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Artist Attribution */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                        Artist Name *
                      </label>
                      <select
                        value={uploadArtistId}
                        onChange={(e) => setUploadArtistId(e.target.value)}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      >
                        {artists.map((art) => (
                          <option key={art.id} value={art.id}>
                            {art.name} ({art.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Category */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                        Look Category *
                      </label>
                      <select
                        value={uploadCategory}
                        onChange={(e) => setUploadCategory(e.target.value as GalleryWork['category'])}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      >
                        <option value="Bridal">Bridal Makeover</option>
                        <option value="Party Makeup">Party / Cocktail Makeup</option>
                        <option value="Hair Styling">Hair Styling & Balayage</option>
                        <option value="Facial Glow">Facial Glow & Skin Prep</option>
                        <option value="Nail Art">Chrome & Gel Nail Art</option>
                        <option value="Reception">Reception Couture</option>
                      </select>
                    </div>
                  </div>

                  {/* Media Type Toggle */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                      Media Type
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setUploadMediaType('image')}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          uploadMediaType === 'image'
                            ? 'bg-[#8C3A42] text-white shadow-xs'
                            : 'bg-[#FAF7F5] text-[#5A4B4B] border border-[#D9C4BE]'
                        }`}
                      >
                        <ImageIcon className="w-4 h-4" />
                        <span>High-Res Photo</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setUploadMediaType('video')}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          uploadMediaType === 'video'
                            ? 'bg-[#8C3A42] text-white shadow-xs'
                            : 'bg-[#FAF7F5] text-[#5A4B4B] border border-[#D9C4BE]'
                        }`}
                      >
                        <VideoIcon className="w-4 h-4" />
                        <span>Video / Transformation Reel</span>
                      </button>
                    </div>
                  </div>

                  {/* File Upload Selector (Drag & drop / File picker) */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                      Upload from Device (File or Camera)
                    </label>
                    <div className="border-2 border-dashed border-[#D9C4BE] rounded-xl p-4 text-center bg-[#FAF7F5] hover:bg-[#FAF0F1] transition-colors relative">
                      <input
                        type="file"
                        accept={uploadMediaType === 'video' ? 'video/*' : 'image/*'}
                        onChange={handleFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <UploadCloud className="w-7 h-7 text-[#8C3A42] mx-auto mb-1" />
                      <p className="text-xs font-semibold text-[#2D2424]">
                        Click to select {uploadMediaType === 'video' ? 'video reel' : 'image'} or drag & drop here
                      </p>
                      <p className="text-[10px] text-[#7A6B6B]">
                        Supports JPG, PNG, WEBP, MP4, MOV (Auto converted & previewed)
                      </p>
                    </div>
                  </div>

                  {/* Or External Media URL */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                      Or Paste Direct Image / Video URL
                    </label>
                    <input
                      type="url"
                      placeholder="https://images.unsplash.com/... or https://...video.mp4"
                      value={uploadMediaUrl}
                      onChange={(e) => setUploadMediaUrl(e.target.value)}
                      className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                    />
                  </div>

                  {uploadMediaType === 'video' && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                        Video Thumbnail Poster URL (Optional)
                      </label>
                      <input
                        type="url"
                        placeholder="https://images.unsplash.com/... for video cover image"
                        value={uploadThumbnailUrl}
                        onChange={(e) => setUploadThumbnailUrl(e.target.value)}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      />
                    </div>
                  )}

                  {/* Description */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                      Techniques & Client Notes
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Describe products used, shade names, or client occasion..."
                      value={uploadDescription}
                      onChange={(e) => setUploadDescription(e.target.value)}
                      className="w-full p-2.5 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                    />
                  </div>

                  {/* Tags */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#5A4B4B] uppercase tracking-wide">
                      Search Tags (Comma separated)
                    </label>
                    <input
                      type="text"
                      placeholder="Bridal, Airbrush, Kundan, 24K Gold"
                      value={uploadTagsStr}
                      onChange={(e) => setUploadTagsStr(e.target.value)}
                      className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424]"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    id="submit-artist-work-btn"
                    disabled={!uploadMediaUrl || !uploadTitle}
                    className="w-full flex items-center justify-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] disabled:opacity-50 text-white py-3 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>Publish Work to Salon Gallery</span>
                  </button>

                </form>
              </div>

              {/* Right Column: Live Card Preview & Uploaded Works List */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Live Card Preview */}
                <div className="bg-white rounded-2xl p-5 border border-[#E6DDD8] shadow-sm space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-[#E8DDD8]">
                    <h4 className="font-serif-luxury text-base font-bold text-[#2D2424]">
                      Live Gallery Card Preview
                    </h4>
                    <span className="text-[10px] text-[#8C3A42] font-semibold uppercase">Instant Display</span>
                  </div>

                  {uploadMediaUrl ? (
                    <div className="rounded-xl overflow-hidden border border-[#D9C4BE] bg-black aspect-[4/5] relative">
                      {uploadMediaType === 'video' ? (
                        <video
                          src={uploadMediaUrl}
                          controls
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src={uploadMediaUrl}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/80 to-transparent text-white">
                        <span className="text-[10px] uppercase font-bold text-[#E8C5C8]">{uploadCategory}</span>
                        <h5 className="font-serif-luxury text-base font-bold leading-tight line-clamp-1">
                          {uploadTitle || 'Untitled Look'}
                        </h5>
                        <p className="text-[10px] text-[#D8C7C7]">
                          By {artists.find((a) => a.id === uploadArtistId)?.name || 'Artist'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-[4/5] rounded-xl border border-dashed border-[#D9C4BE] bg-[#FAF7F5] flex flex-col items-center justify-center p-6 text-center text-xs text-[#7A6B6B]">
                      <ImageIcon className="w-8 h-8 text-[#A89898] mb-2" />
                      <p className="font-semibold text-[#2D2424]">Preview will appear here</p>
                      <p className="text-[10px] mt-1">Select an image/video file or paste URL above</p>
                    </div>
                  )}
                </div>

                {/* Manage Works in Gallery */}
                <div className="bg-white rounded-2xl p-5 border border-[#E6DDD8] shadow-sm space-y-3">
                  <h4 className="font-serif-luxury text-base font-bold text-[#2D2424]">
                    Active Gallery Works ({galleryItems.length})
                  </h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {galleryItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-xl bg-[#FAF7F5] border border-[#E8DDD8] flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <div className="w-10 h-10 rounded-lg bg-black overflow-hidden shrink-0">
                            <img
                              src={item.thumbnailUrl || item.mediaUrl}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="overflow-hidden">
                            <p className="font-semibold text-[#2D2424] truncate">{item.title}</p>
                            <p className="text-[10px] text-[#7A6B6B]">
                              {item.category} • By {item.artistName}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => onDeleteGalleryWork(item.id)}
                          className="text-red-500 hover:text-red-700 p-1 shrink-0"
                          title="Remove from gallery"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* TAB 5: ENQUIRIES & WHATSAPP FOLLOW-UP HUB */}
        {activeTab === 'enquiries' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            
            {/* Header and Filter */}
            <div className="bg-white p-4 rounded-2xl border border-[#E6DDD8] flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                  Customer Enquiries & WhatsApp Follow-up Hub
                </h3>
                <p className="text-[11px] text-[#7A6B6B]">
                  One-click WhatsApp follow-ups with tailored response templates
                </p>
              </div>

              <div className="flex items-center gap-1 text-xs">
                {['all', 'New', 'Contacted', 'Converted', 'Closed'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setEnqStatusFilter(st)}
                    className={`px-3 py-1 rounded-lg capitalize font-medium transition-colors ${
                      enqStatusFilter === st
                        ? 'bg-[#8C3A42] text-white'
                        : 'bg-[#FAF7F5] text-[#5A4B4B] hover:bg-[#F3ECE8]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Enquiries Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {enquiries
                .filter((enq) => enqStatusFilter === 'all' || enq.status === enqStatusFilter)
                .map((enq) => (
                  <div
                    key={enq.id}
                    className="bg-white rounded-2xl p-5 border border-[#E6DDD8] shadow-xs flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      
                      {/* Top status */}
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                            enq.status === 'New'
                              ? 'bg-emerald-100 text-emerald-800'
                              : enq.status === 'Contacted'
                              ? 'bg-blue-100 text-blue-800'
                              : enq.status === 'Converted'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {enq.status}
                        </span>
                        <span className="text-[10px] text-[#7A6B6B]">{enq.createdAt}</span>
                      </div>

                      {/* Customer Info */}
                      <div>
                        <h4 className="font-bold text-base text-[#2D2424]">{enq.customerName}</h4>
                        <div className="flex items-center gap-2 text-xs text-[#6B5A5A] mt-0.5">
                          <Phone className="w-3 h-3 text-[#8C3A42]" />
                          <span>{enq.customerPhone}</span>
                        </div>
                        {enq.customerEmail && (
                          <p className="text-[11px] text-[#7A6B6B]">{enq.customerEmail}</p>
                        )}
                      </div>

                      {/* Service of Interest */}
                      <div className="p-2.5 bg-[#FAF7F5] rounded-xl border border-[#EDE1DD] text-xs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase font-bold text-[#8C3A42]">Interested In</span>
                          {enq.preferredDate && (
                            <span className="text-[10px] text-[#7A6B6B]">Date: {enq.preferredDate}</span>
                          )}
                        </div>
                        <p className="font-semibold text-[#2D2424]">{enq.serviceOfInterest}</p>
                        <p className="text-[11px] text-[#5A4B4B] italic">"{enq.message}"</p>
                      </div>

                      {enq.followUpNotes && (
                        <p className="text-[10px] text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                          Follow-up note: {enq.followUpNotes}
                        </p>
                      )}

                    </div>

                    {/* Follow-up Action Buttons */}
                    <div className="pt-3 border-t border-[#E8DDD8] space-y-2">
                      <button
                        onClick={() => {
                          const msg = getEnquiryFollowUpMessage(enq);
                          openWhatsApp(enq.customerPhone, msg);
                          onUpdateEnquiry(enq.id, 'Contacted', 'WhatsApp message sent with service quotation');
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-[#25D366] hover:bg-[#20bd5a] text-white py-2 rounded-xl text-xs font-semibold shadow-xs transition-colors"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Launch WhatsApp Follow-up</span>
                      </button>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#6B5A5A]">Mark status:</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => onUpdateEnquiry(enq.id, 'Converted', 'Client confirmed package booking')}
                            className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-medium hover:bg-purple-100"
                          >
                            Converted
                          </button>
                          <button
                            onClick={() => onUpdateEnquiry(enq.id, 'Closed', 'Archived enquiry')}
                            className="px-2 py-0.5 rounded bg-gray-50 text-gray-700 border border-gray-200 font-medium hover:bg-gray-100"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>
                ))}
            </div>

          </div>
        )}

        {/* TAB 6: SERVICES CATALOG EDITOR */}
        {activeTab === 'services' && (
          <div className="space-y-8 animate-in fade-in duration-200">
            
            {serviceAddedSuccess && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 text-xs font-semibold">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>{serviceAddedSuccess}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Add New Service Form */}
              <div className="lg:col-span-5 bg-white rounded-2xl p-6 border border-[#E6DDD8] shadow-sm space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-[#E8DDD8]">
                  <Scissors className="w-5 h-5 text-[#8C3A42]" />
                  <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                    Add New Salon Service
                  </h3>
                </div>

                <form onSubmit={handleAddServiceSubmit} className="space-y-3.5 text-xs">
                  <div className="space-y-1">
                    <label className="font-bold text-[#5A4B4B] uppercase">Service Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Diamond Microdermabrasion Facial"
                      value={newServiceName}
                      onChange={(e) => setNewServiceName(e.target.value)}
                      className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-[#5A4B4B] uppercase">Category</label>
                      <select
                        value={newServiceCategory}
                        onChange={(e) => setNewServiceCategory(e.target.value as SalonService['category'])}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-2.5 py-2 text-xs"
                      >
                        <option value="Threading & Waxing">Threading & Waxing</option>
                        <option value="Skin Care & Facials">Skin Care & Facials</option>
                        <option value="Body Care & Massage">Body Care & Massage</option>
                        <option value="Manicure & Pedicure">Manicure & Pedicure</option>
                        <option value="Hair Cut, Wash & Styling">Hair Cut, Wash & Styling</option>
                        <option value="Hair Colour">Hair Colour</option>
                        <option value="Hair Spa & Treatments">Hair Spa & Treatments</option>
                        <option value="Pre-Bridal Packages">Pre-Bridal Packages</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-[#5A4B4B] uppercase">Tier</label>
                      <select
                        value={newServiceTier}
                        onChange={(e) => setNewServiceTier(e.target.value as SalonService['tier'])}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-2.5 py-2 text-xs"
                      >
                        <option value="Classic">Classic</option>
                        <option value="Signature">Signature</option>
                        <option value="Luxury Royal">Luxury Royal</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-[#5A4B4B] uppercase">Price (₹) *</label>
                      <input
                        type="number"
                        min="100"
                        required
                        value={newServicePrice}
                        onChange={(e) => setNewServicePrice(Number(e.target.value))}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-[#5A4B4B] uppercase">Duration (mins) *</label>
                      <input
                        type="number"
                        min="15"
                        required
                        value={newServiceDuration}
                        onChange={(e) => setNewServiceDuration(Number(e.target.value))}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-[#5A4B4B] uppercase">Description</label>
                    <textarea
                      rows={2}
                      placeholder="Highlights, formulations, benefits..."
                      value={newServiceDesc}
                      onChange={(e) => setNewServiceDesc(e.target.value)}
                      className="w-full p-2.5 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-1.5 bg-[#8C3A42] hover:bg-[#742F36] text-white py-2.5 rounded-xl font-semibold transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Service to Menu</span>
                  </button>
                </form>
              </div>

              {/* Current Services List */}
              <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-[#E6DDD8] shadow-sm space-y-3">
                <h4 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                  Active Salon Services ({services.length})
                </h4>
                <div className="divide-y divide-[#EDE1DD] max-h-[500px] overflow-y-auto pr-1">
                  {services.map((srv) => (
                    <div key={srv.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-[#2D2424]">{srv.name}</p>
                        <p className="text-[10px] text-[#7A6B6B]">
                          {srv.category} • {srv.tier} • {srv.durationMinutes} mins
                        </p>
                      </div>
                      <span className="font-serif-luxury font-bold text-sm text-[#8C3A42]">
                        {SALON_INFO.currency}{srv.price.toLocaleString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}

      </div>

    </div>
  );
};
